/**
 * Intrinsic geometry of a triangle mesh: everything here is computed from one
 * length per edge. Vertex positions are only a convenient way to produce those
 * lengths; no function in this module looks at an embedding.
 */
import { nextHalfedge, prevHalfedge, type TriangleMesh } from './mesh.ts';
import { cosineNumerator, triangleAngle, triangleArea } from './triangle.ts';

/** Euclidean length of every edge, from vertex positions stored as xyz triples. */
export function edgeLengthsFromPositions(
  mesh: TriangleMesh,
  positions: Float64Array,
): Float64Array {
  if (positions.length !== 3 * mesh.vertexCount) {
    throw new RangeError(`expected ${3 * mesh.vertexCount} coordinates, got ${positions.length}`);
  }
  const lengths = new Float64Array(mesh.edgeCount);
  for (let e = 0; e < mesh.edgeCount; e++) {
    const [i, j] = mesh.edgeVertices(e);
    lengths[e] = Math.hypot(
      positions[3 * j] - positions[3 * i],
      positions[3 * j + 1] - positions[3 * i + 1],
      positions[3 * j + 2] - positions[3 * i + 2],
    );
  }
  return lengths;
}

/**
 * Edge lengths accepted by validateEdgeLengths. The area and angle formulas
 * multiply four lengths, which under- or overflows a double beyond this range.
 */
export const SMALLEST_EDGE_LENGTH = 1e-75;
export const LARGEST_EDGE_LENGTH = 1e75;

/**
 * Checks that the lengths describe a valid piecewise-flat metric: one positive
 * length per edge, within the range above, and a strictly positive area in
 * every face.
 *
 * @throws RangeError naming the first offending edge or face.
 */
export function validateEdgeLengths(mesh: TriangleMesh, lengths: Float64Array): void {
  if (lengths.length !== mesh.edgeCount) {
    throw new RangeError(`expected ${mesh.edgeCount} edge lengths, got ${lengths.length}`);
  }
  for (let e = 0; e < mesh.edgeCount; e++) {
    const l = lengths[e];
    if (!(l > 0) || !Number.isFinite(l)) {
      throw new RangeError(`edge ${e} has invalid length ${l}`);
    }
    if (l < SMALLEST_EDGE_LENGTH || l > LARGEST_EDGE_LENGTH) {
      throw new RangeError(
        `edge ${e} has length ${l}, outside ${SMALLEST_EDGE_LENGTH} to ${LARGEST_EDGE_LENGTH}; rescale the mesh`,
      );
    }
  }
  for (let f = 0; f < mesh.faceCount; f++) {
    const [a, b, c] = faceEdgeLengths(mesh, lengths, f);
    let area: number;
    try {
      area = triangleArea(a, b, c);
    } catch {
      area = Number.NaN;
    }
    if (!(area > 0)) {
      throw new RangeError(`face ${f} is degenerate or violates the triangle inequality`);
    }
  }
}

/** Lengths of the edges opposite corners 0, 1 and 2 of a face. */
export function faceEdgeLengths(
  mesh: TriangleMesh,
  lengths: Float64Array,
  f: number,
): [number, number, number] {
  const e = mesh.halfedgeEdge;
  // The edge opposite corner c is the edge of halfedge 3f + (c + 1) mod 3.
  return [lengths[e[3 * f + 1]], lengths[e[3 * f + 2]], lengths[e[3 * f]]];
}

/** Area of every face. */
export function faceAreas(mesh: TriangleMesh, lengths: Float64Array): Float64Array {
  const areas = new Float64Array(mesh.faceCount);
  for (let f = 0; f < mesh.faceCount; f++) {
    const [a, b, c] = faceEdgeLengths(mesh, lengths, f);
    areas[f] = triangleArea(a, b, c);
  }
  return areas;
}

/**
 * Interior angle at every corner, indexed by halfedge: entry h is the angle of
 * face(h) at the tail vertex of h.
 */
export function cornerAngles(mesh: TriangleMesh, lengths: Float64Array): Float64Array {
  const edge = mesh.halfedgeEdge;
  const angles = new Float64Array(edge.length);
  for (let h = 0; h < edge.length; h++) {
    const opposite = lengths[edge[nextHalfedge(h)]];
    angles[h] = triangleAngle(opposite, lengths[edge[h]], lengths[edge[prevHalfedge(h)]]);
  }
  return angles;
}

export type VertexAreaScheme = 'barycentric' | 'mixed';

/**
 * Area attributed to each vertex; the areas sum to the total surface area.
 *
 * - `barycentric`: one third of each incident face.
 * - `mixed`: the Voronoi area inside non-obtuse faces, and a half or a quarter of
 *   an obtuse face (half to the obtuse corner), as in Meyer, Desbrun, Schröder
 *   and Barr, "Discrete Differential-Geometry Operators for Triangulated
 *   2-Manifolds", 2003, section 3.3.
 */
export function vertexAreas(
  mesh: TriangleMesh,
  lengths: Float64Array,
  scheme: VertexAreaScheme,
): Float64Array {
  const areas = new Float64Array(mesh.vertexCount);
  const vertex = mesh.halfedgeVertex;
  for (let f = 0; f < mesh.faceCount; f++) {
    // Corner c sits at vertex[3f + c]; side[c] is the edge opposite it.
    const side = faceEdgeLengths(mesh, lengths, f);
    const area = triangleArea(side[0], side[1], side[2]);
    if (scheme === 'barycentric') {
      for (let c = 0; c < 3; c++) areas[vertex[3 * f + c]] += area / 3;
      continue;
    }
    const sq = [side[0] * side[0], side[1] * side[1], side[2] * side[2]] as const;
    // (adjacent sides squared − opposite side squared) for each corner: the
    // numerator of its cosine and of its cotangent, negative when it is obtuse.
    const numerator = [
      cosineNumerator(side[0], side[1], side[2]),
      cosineNumerator(side[1], side[2], side[0]),
      cosineNumerator(side[2], side[0], side[1]),
    ];
    const obtuse = numerator.map((x) => x < 0);
    if (obtuse[0] || obtuse[1] || obtuse[2]) {
      for (let c = 0; c < 3; c++) areas[vertex[3 * f + c]] += obtuse[c] ? area / 2 : area / 4;
      continue;
    }
    const cot = numerator.map((x) => x / (4 * area));
    for (let c = 0; c < 3; c++) {
      const c1 = (c + 1) % 3;
      const c2 = (c + 2) % 3;
      // Voronoi part of corner c: (|side c1|² cot(c1) + |side c2|² cot(c2)) / 8.
      areas[vertex[3 * f + c]] += (sq[c1] * cot[c1] + sq[c2] * cot[c2]) / 8;
    }
  }
  return areas;
}
