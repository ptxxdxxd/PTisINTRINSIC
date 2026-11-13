export { angleSums, gaussBonnetResidual, gaussianCurvature, vertexCurvature } from './curvature.ts';
export {
  cornerAngles,
  edgeLengthsFromPositions,
  faceAreas,
  faceEdgeLengths,
  validateEdgeLengths,
  vertexAreas,
  type VertexAreaScheme,
} from './geometry.ts';
export { MeshError, TriangleMesh, halfedgeFace, nextHalfedge, prevHalfedge } from './mesh.ts';
export { mulberry32 } from './random.ts';
export { compensatedSum } from './summation.ts';
export {
  cone,
  gaussianBump,
  plane,
  saddle,
  sphericalCap,
  type ConeOptions,
  type GridOptions,
  type KnownCurvature,
  type Surface,
} from './surfaces.ts';
export { triangleAngle, triangleArea } from './triangle.ts';
