/**
 * Geodesic distance by the heat method, from edge lengths only.
 *
 * Heat released at the source spreads along shortest paths, so the gradient of
 * a short-time heat distribution points straight away from the source. Three
 * steps turn that into distance:
 *
 *   1. one backward-Euler heat step from the sources: (M + t L) u = δ;
 *   2. the unit field X = −∇u / |∇u| in every face;
 *   3. the function whose gradient is closest to X: L φ = −∇·X.
 *
 * L is the cotan stiffness matrix and M the lumped (barycentric) mass matrix.
 * Both systems are factored once, so each new source set costs two triangular
 * solves. The boundary is insulated (Neumann conditions).
 *
 * The result is an approximation that smooths the true distance over a length
 * of about √t; the default t is the squared mean edge length. Accuracy needs a
 * reasonable triangulation: flip to intrinsic Delaunay first (delaunay.ts) on
 * meshes with obtuse angles.
 *
 * Crane, Weischedel and Wardetzky, "Geodesics in Heat: A New Approach to
 * Computing Distance Based on Heat Flow", ACM Trans. Graph. 32(5), 2013.
 */
import { SparseCholesky } from './cholesky.ts';
import { faceAreas, faceEdgeLengths, vertexAreas } from './geometry.ts';
import { cornerCotangents, cotanLaplacian } from './laplacian.ts';
import { MeshError, type TriangleMesh } from './mesh.ts';
import { CsrMatrix } from './sparse.ts';
import { compensatedSum } from './summation.ts';

/** Smallest positive double with full precision, 2^-1022. */
const SMALLEST_NORMAL = 2.2250738585072014e-308;

/**
 * Relative variation of u across a face below which the face counts as flat.
 * Rounding in the heat solve is a few hundred times smaller; away from exact
 * symmetry the variation is many orders of magnitude larger.
 */
const FLAT_FACE_TOLERANCE = 1e-12;

export interface HeatMethodOptions {
  /**
   * The heat step is t = timeCoefficient · (mean edge length)². Default 1.
   * Larger values smooth the result more; they are needed on meshes more than
   * about 700 edges across, where the heat otherwise underflows.
   */
  readonly timeCoefficient?: number;
}

export class HeatMethod {
  /** The heat step t. */
  readonly time: number;
  private readonly mesh: TriangleMesh;
  private readonly cotangent: Float64Array;
  /** Per face: the layout v0 = (0, 0), v1 = (base, 0), v2 = (apexX, apexY). */
  private readonly layout: Float64Array;
  private readonly heat: SparseCholesky;
  private readonly poisson: SparseCholesky;

  /** Builds and factors both systems. Throws MeshError when the mesh is not connected. */
  constructor(mesh: TriangleMesh, lengths: Float64Array, options: HeatMethodOptions = {}) {
    const coefficient = options.timeCoefficient ?? 1;
    if (!(coefficient > 0) || !Number.isFinite(coefficient)) {
      throw new RangeError(`timeCoefficient must be positive and finite, got ${coefficient}`);
    }
    requireConnected(mesh);
    const n = mesh.vertexCount;
    const meanLength = compensatedSum(lengths) / mesh.edgeCount;
    this.time = coefficient * meanLength * meanLength;
    this.mesh = mesh;
    this.cotangent = cornerCotangents(mesh, lengths);

    const area = faceAreas(mesh, lengths);
    this.layout = new Float64Array(3 * mesh.faceCount);
    for (let f = 0; f < mesh.faceCount; f++) {
      // side[c] is opposite corner c, so the base v0–v1 is side[2].
      const side = faceEdgeLengths(mesh, lengths, f);
      const base = side[2];
      this.layout[3 * f] = base;
      this.layout[3 * f + 1] = (side[1] * side[1] + base * base - side[0] * side[0]) / (2 * base);
      this.layout[3 * f + 2] = (2 * area[f]) / base;
    }

    const stiffness = cotanLaplacian(mesh, lengths);
    const mass = vertexAreas(mesh, lengths, 'barycentric');
    const rows: number[] = [];
    const cols: number[] = [];
    const heatValues: number[] = [];
    const pinnedRows: number[] = [];
    const pinnedCols: number[] = [];
    const pinnedValues: number[] = [];
    for (const [i, j, value] of stiffness.entries()) {
      rows.push(i);
      cols.push(j);
      heatValues.push(this.time * value + (i === j ? mass[i] : 0));
      // L is singular (constants). Fixing φ = 0 at the last vertex removes its
      // row and column and leaves a positive definite system.
      if (i < n - 1 && j < n - 1) {
        pinnedRows.push(i);
        pinnedCols.push(j);
        pinnedValues.push(value);
      }
    }
    this.heat = SparseCholesky.factor(CsrMatrix.fromTriplets(n, n, rows, cols, heatValues));
    this.poisson = SparseCholesky.factor(
      CsrMatrix.fromTriplets(n - 1, n - 1, pinnedRows, pinnedCols, pinnedValues),
    );
  }

  /**
   * Approximate geodesic distance from the nearest source vertex to every
   * vertex. The result is shifted so that its mean over the sources is 0, as
   * geometry-central does: with one source the distance there is exactly 0.
   * Values are not guaranteed to be non-negative; on coarse or badly shaped
   * meshes some can dip below zero.
   */
  distance(sources: Iterable<number>): Float64Array {
    const n = this.mesh.vertexCount;
    const delta = new Float64Array(n);
    let count = 0;
    for (const v of sources) {
      if (!Number.isInteger(v) || v < 0 || v >= n) {
        throw new RangeError(`source ${v} is not a vertex of this mesh`);
      }
      if (delta[v] === 0) count++;
      delta[v] = 1;
    }
    if (count === 0) throw new RangeError('need at least one source vertex');
    // Every vertex is a source: the distance is zero and there is no heat flow to read.
    if (count === n) return new Float64Array(n);
    const u = this.heat.solve(delta);
    // Heat decays geometrically with the number of edges from the source and
    // eventually leaves the range of doubles. Its direction is meaningless
    // there, and the distance would silently stop growing.
    let lost = 0;
    for (let v = 0; v < n; v++) if (!(Math.abs(u[v]) >= SMALLEST_NORMAL)) lost++;
    if (lost > 0) {
      throw new RangeError(
        `the heat underflowed at ${lost} vertices far from the sources; use a larger timeCoefficient`,
      );
    }
    const phi = new Float64Array(n);
    phi.set(this.poisson.solve(this.divergence(u).subarray(0, n - 1)));

    let atSources = 0;
    for (let v = 0; v < n; v++) atSources += delta[v] * phi[v];
    const shift = atSources / count;
    for (let v = 0; v < n; v++) phi[v] -= shift;
    return phi;
  }

  /** −∇·X integrated over each vertex's cell, for X = −∇u / |∇u|. */
  private divergence(u: Float64Array): Float64Array {
    const { mesh, cotangent, layout } = this;
    const result = new Float64Array(mesh.vertexCount);
    for (let f = 0; f < mesh.faceCount; f++) {
      const v0 = mesh.halfedgeVertex[3 * f];
      const v1 = mesh.halfedgeVertex[3 * f + 1];
      const v2 = mesh.halfedgeVertex[3 * f + 2];
      let d1 = u[v1] - u[v0];
      let d2 = u[v2] - u[v0];
      // Only the direction of ∇u matters. Scaling the differences first keeps
      // their squares from underflowing far from the source, where u is tiny.
      const scale = Math.max(Math.abs(d1), Math.abs(d2));
      // Where u is constant across a face up to rounding (a face that every
      // path from the sources reaches at once, as symmetry can arrange), the
      // differences are noise and normalizing them would turn that noise into
      // a unit vector. Such a face has no direction and contributes nothing.
      const size = Math.max(Math.abs(u[v0]), Math.abs(u[v1]), Math.abs(u[v2]));
      if (scale <= FLAT_FACE_TOLERANCE * size) continue;
      d1 /= scale;
      d2 /= scale;
      // u is linear on the face, so e · ∇u is the difference of u along e.
      const gx = d1 / layout[3 * f];
      const gy = (d2 - gx * layout[3 * f + 1]) / layout[3 * f + 2];
      const norm = Math.hypot(gx, gy);
      // The integrated divergence at a corner is ½ Σ cot(opposite angle) e · X
      // over the two edges e leaving it (Crane et al., section 3.2).
      const c0 = cotangent[3 * f] / (2 * norm);
      const c1 = cotangent[3 * f + 1] / (2 * norm);
      const c2 = cotangent[3 * f + 2] / (2 * norm);
      result[v0] += c2 * d1 + c1 * d2;
      result[v1] += -c2 * d1 + c0 * (d2 - d1);
      result[v2] += -c1 * d2 + c0 * (d1 - d2);
    }
    return result;
  }
}

function requireConnected(mesh: TriangleMesh): void {
  const parent = Int32Array.from({ length: mesh.vertexCount }, (_, v) => v);
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  let components = mesh.vertexCount;
  for (let e = 0; e < mesh.edgeCount; e++) {
    const [a, b] = mesh.edgeVertices(e).map(find);
    if (a !== b) {
      parent[a] = b;
      components--;
    }
  }
  if (components !== 1) {
    throw new MeshError(`the heat method needs a connected mesh; this one has ${components} parts`);
  }
}
