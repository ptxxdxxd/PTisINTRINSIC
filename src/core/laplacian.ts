/**
 * The cotan Laplacian, built from edge lengths only.
 *
 * Edge ij gets the weight w_ij = (cot α + cot β) / 2, where α and β are the
 * angles opposite the edge in its one or two faces. The stiffness matrix is
 *
 *     L_ij = −w_ij (i ≠ j, ij an edge),    L_ii = Σ_j w_ij,
 *
 * the matrix of the Dirichlet energy of piecewise-linear functions, so it is
 * symmetric and positive semidefinite with the constants in its kernel. Sign
 * convention: libigl's cotmatrix is −L.
 *
 * Pinkall and Polthier, "Computing Discrete Minimal Surfaces and Their
 * Conjugates", Experimental Mathematics 2(1), 1993.
 */
import { faceEdgeLengths } from './geometry.ts';
import { nextHalfedge, type TriangleMesh } from './mesh.ts';
import { CsrMatrix } from './sparse.ts';
import { triangleArea } from './triangle.ts';

/**
 * Cotangent of each corner angle, indexed by halfedge like cornerAngles:
 * cot θ = (b² + c² − a²) / 4A for the corner opposite side a.
 */
export function cornerCotangents(mesh: TriangleMesh, lengths: Float64Array): Float64Array {
  const cot = new Float64Array(3 * mesh.faceCount);
  for (let f = 0; f < mesh.faceCount; f++) {
    const side = faceEdgeLengths(mesh, lengths, f);
    const fourArea = 4 * triangleArea(side[0], side[1], side[2]);
    const sq = [side[0] * side[0], side[1] * side[1], side[2] * side[2]] as const;
    cot[3 * f] = (sq[1] + sq[2] - sq[0]) / fourArea;
    cot[3 * f + 1] = (sq[2] + sq[0] - sq[1]) / fourArea;
    cot[3 * f + 2] = (sq[0] + sq[1] - sq[2]) / fourArea;
  }
  return cot;
}

/** Cotan weight of every edge. Negative weights occur exactly on non-Delaunay edges. */
export function cotanWeights(mesh: TriangleMesh, lengths: Float64Array): Float64Array {
  const cot = cornerCotangents(mesh, lengths);
  const weights = new Float64Array(mesh.edgeCount);
  for (let h = 0; h < cot.length; h++) {
    // The corner at the tail of h faces the edge of next(h).
    weights[mesh.halfedgeEdge[nextHalfedge(h)]] += cot[h] / 2;
  }
  return weights;
}

/** Cotan stiffness matrix L (positive semidefinite). */
export function cotanLaplacian(mesh: TriangleMesh, lengths: Float64Array): CsrMatrix {
  const weights = cotanWeights(mesh, lengths);
  const rows: number[] = [];
  const cols: number[] = [];
  const values: number[] = [];
  for (let e = 0; e < mesh.edgeCount; e++) {
    const [i, j] = mesh.edgeVertices(e);
    const w = weights[e];
    rows.push(i, j, i, j);
    cols.push(j, i, i, j);
    values.push(-w, -w, w, w);
  }
  return CsrMatrix.fromTriplets(mesh.vertexCount, mesh.vertexCount, rows, cols, values);
}
