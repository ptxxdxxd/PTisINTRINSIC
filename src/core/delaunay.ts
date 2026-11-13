/**
 * Intrinsic Delaunay triangulation by edge flipping.
 *
 * An interior edge is Delaunay when the two angles opposite it sum to at most
 * π, i.e. its cotan weight is non-negative. Flipping a non-Delaunay edge
 * replaces it with the other diagonal of its two faces, laid out flat in the
 * plane, and the length of that diagonal is measured in the same layout. The
 * surface itself does not change: the same metric is just cut into different
 * triangles, so every vertex keeps its angle sum and curvature. Repeating until
 * no edge is non-Delaunay terminates (Bobenko and Springborn 2007), and the
 * cotan Laplacian of the result has non-negative weights, which gives it a
 * maximum principle.
 *
 * Flips may produce parallel edges, loops and faces that repeat a vertex (a
 * Δ-complex). The intrinsic Delaunay triangulation sometimes needs them, so
 * they are allowed (see TriangleMesh.flipEdge), and with them every
 * non-Delaunay edge can be flipped.
 *
 * Bobenko and Springborn, "A Discrete Laplace–Beltrami Operator for Simplicial
 * Surfaces", Discrete Comput. Geom. 38, 2007; Sharp, Soliman and Crane,
 * "Navigating Intrinsic Triangulations", ACM TOG 38(4), 2019.
 */
import { cotanWeights } from './laplacian.ts';
import { nextHalfedge, prevHalfedge, type TriangleMesh } from './mesh.ts';
import { triangleAngle, triangleArea } from './triangle.ts';

/**
 * Edges with cotan weight below −tolerance are treated as non-Delaunay. The
 * tolerance keeps rounding noise on cocircular quadrilaterals (weight exactly
 * 0 in real arithmetic, as on a regular grid) from causing pointless flips.
 */
export const DELAUNAY_TOLERANCE = 1e-12;

/** Interior edges whose opposite angles sum to more than π. */
export function nonDelaunayEdges(mesh: TriangleMesh, lengths: Float64Array): number[] {
  const weights = cotanWeights(mesh, lengths);
  const result: number[] = [];
  for (let e = 0; e < mesh.edgeCount; e++) {
    if (!mesh.isBoundaryEdge(e) && weights[e] < -DELAUNAY_TOLERANCE) result.push(e);
  }
  return result;
}

export interface IntrinsicDelaunayResult {
  readonly mesh: TriangleMesh;
  readonly lengths: Float64Array;
  readonly flips: number;
}

/**
 * Flips edges until the triangulation is intrinsically Delaunay. The input
 * mesh and lengths are not modified.
 */
export function intrinsicDelaunay(
  input: TriangleMesh,
  inputLengths: Float64Array,
  options: { readonly maxFlips?: number } = {},
): IntrinsicDelaunayResult {
  const mesh = input.clone();
  const lengths = inputLengths.slice();
  const queue = nonDelaunayEdges(mesh, lengths);
  const queued = new Uint8Array(mesh.edgeCount);
  for (const e of queue) queued[e] = 1;
  // Termination is guaranteed in exact arithmetic; this guard turns a
  // floating-point cycle, should one ever occur, into an error.
  const flipLimit = options.maxFlips ?? 50 * mesh.edgeCount + 1000;
  let flips = 0;

  for (let e = queue.pop(); e !== undefined; e = queue.pop()) {
    queued[e] = 0;
    if (mesh.isBoundaryEdge(e) || edgeWeight(mesh, lengths, e) >= -DELAUNAY_TOLERANCE) continue;

    const newLength = flippedLength(mesh, lengths, e);
    // flipEdge refuses only boundary edges and edges with both halfedges in
    // one face. The second kind faces the two base angles of an isosceles
    // triangle, whose cotangents are positive, so it is never non-Delaunay.
    if (!mesh.flipEdge(e)) throw new Error(`non-Delaunay edge ${e} could not be flipped`);
    lengths[e] = newLength;
    if (++flips > flipLimit) {
      throw new Error(`edge flipping did not terminate within ${flipLimit} flips`);
    }
    // The four edges of the quadrilateral may have stopped being Delaunay.
    const h = mesh.edgeHalfedge[e];
    for (const outer of [
      nextHalfedge(h),
      prevHalfedge(h),
      nextHalfedge(mesh.halfedgeTwin[h]),
      prevHalfedge(mesh.halfedgeTwin[h]),
    ]) {
      const neighbour = mesh.halfedgeEdge[outer];
      if (queued[neighbour] === 0) {
        queued[neighbour] = 1;
        queue.push(neighbour);
      }
    }
  }
  return { mesh, lengths, flips };
}

/** Cotan weight of an interior edge, from its two faces. */
function edgeWeight(mesh: TriangleMesh, lengths: Float64Array, e: number): number {
  const h = mesh.edgeHalfedge[e];
  return (
    (cornerCotangent(mesh, lengths, h) + cornerCotangent(mesh, lengths, mesh.halfedgeTwin[h])) / 2
  );
}

/** cot of the angle facing the edge of halfedge h, in the face of h. */
function cornerCotangent(mesh: TriangleMesh, lengths: Float64Array, h: number): number {
  const a = lengths[mesh.halfedgeEdge[h]];
  const b = lengths[mesh.halfedgeEdge[nextHalfedge(h)]];
  const c = lengths[mesh.halfedgeEdge[prevHalfedge(h)]];
  return (b * b + c * c - a * a) / (4 * triangleArea(a, b, c));
}

/** Interior angle at the tail of halfedge h, in the face of h. */
function cornerAngle(mesh: TriangleMesh, lengths: Float64Array, h: number): number {
  return triangleAngle(
    lengths[mesh.halfedgeEdge[nextHalfedge(h)]],
    lengths[mesh.halfedgeEdge[h]],
    lengths[mesh.halfedgeEdge[prevHalfedge(h)]],
  );
}

/**
 * Length of the other diagonal of the two faces of edge i–j, opposite corners
 * k and l. Unfold both faces into the plane around vertex i: the diagonal k–l
 * subtends the angle θ = ∠jik + ∠jil at i, and by the law of cosines, in a form
 * that stays accurate for small θ,
 *
 *     |kl|² = (|ik| − |il|)² + 4 |ik| |il| sin²(θ / 2).
 */
function flippedLength(mesh: TriangleMesh, lengths: Float64Array, e: number): number {
  const h0 = mesh.edgeHalfedge[e];
  const h1 = mesh.halfedgeTwin[h0];
  // In face f0 = (i, j, k): the corner at i is h0 and the side i–k is prev(h0).
  // In face f1 = (j, i, l): the corner at i is next(h1) and the side i–l is next(h1).
  const ik = lengths[mesh.halfedgeEdge[prevHalfedge(h0)]];
  const il = lengths[mesh.halfedgeEdge[nextHalfedge(h1)]];
  const s = Math.sin(
    (cornerAngle(mesh, lengths, h0) + cornerAngle(mesh, lengths, nextHalfedge(h1))) / 2,
  );
  return Math.sqrt((ik - il) * (ik - il) + 4 * ik * il * s * s);
}
