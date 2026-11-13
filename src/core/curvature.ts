/**
 * Discrete curvature from corner angles.
 *
 * At an interior vertex the curvature is the angle defect 2π − Σθ: the
 * integrated Gaussian curvature of the vertex's neighbourhood. At a boundary
 * vertex it is π − Σθ: the turning angle of the boundary, i.e. integrated
 * geodesic curvature. With these conventions the curvatures of all vertices
 * sum to exactly 2πχ, the discrete Gauss–Bonnet theorem, for any triangle mesh
 * and any valid edge lengths.
 */
import type { TriangleMesh } from './mesh.ts';
import { compensatedSum } from './summation.ts';

/** Sum of the corner angles at each vertex. */
export function angleSums(mesh: TriangleMesh, angles: Float64Array): Float64Array {
  const sums = new Float64Array(mesh.vertexCount);
  for (let v = 0; v < mesh.vertexCount; v++) {
    sums[v] = compensatedSum(mesh.outgoingHalfedges(v).map((h) => angles[h]));
  }
  return sums;
}

/** Angle defect at interior vertices, boundary turning angle at boundary vertices. */
export function vertexCurvature(mesh: TriangleMesh, angles: Float64Array): Float64Array {
  const sums = angleSums(mesh, angles);
  const curvature = new Float64Array(mesh.vertexCount);
  for (let v = 0; v < mesh.vertexCount; v++) {
    curvature[v] = (mesh.isBoundaryVertex(v) ? Math.PI : 2 * Math.PI) - sums[v];
  }
  return curvature;
}

/** Σ curvature − 2πχ. Zero up to rounding for every valid mesh. */
export function gaussBonnetResidual(mesh: TriangleMesh, curvature: Float64Array): number {
  return compensatedSum(curvature) - 2 * Math.PI * mesh.eulerCharacteristic();
}

/**
 * Pointwise Gaussian curvature estimate: angle defect divided by vertex area.
 * NaN at boundary vertices, where the angle defect is not defined.
 */
export function gaussianCurvature(
  mesh: TriangleMesh,
  curvature: Float64Array,
  areas: Float64Array,
): Float64Array {
  const k = new Float64Array(mesh.vertexCount);
  for (let v = 0; v < mesh.vertexCount; v++) {
    k[v] = mesh.isBoundaryVertex(v) ? Number.NaN : curvature[v] / areas[v];
  }
  return k;
}
