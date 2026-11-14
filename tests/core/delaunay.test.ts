import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DELAUNAY_TOLERANCE,
  TriangleMesh,
  compensatedSum,
  cornerAngles,
  cotanLaplacian,
  edgeLengthsFromPositions,
  faceAreas,
  gaussianBump,
  intrinsicDelaunay,
  mulberry32,
  nonDelaunayEdges,
  plane,
  saddle,
  sphericalCap,
  validateEdgeLengths,
  vertexCurvature,
} from '../../src/core/index.ts';
import { ellipsoid } from '../support/closed-surfaces.ts';
import { randomIntrinsicMetric, randomOpenSurface } from '../support/random-surfaces.ts';

describe('TriangleMesh.flipEdge', () => {
  it('swaps the diagonal of a quadrilateral', () => {
    // Square 0-1-2-3 split along 0–2.
    const mesh = TriangleMesh.fromFaces(4, [0, 1, 2, 0, 2, 3]);
    const diagonal = mesh.halfedgeEdge[mesh.findHalfedge(0, 2)];
    expect(mesh.flipEdge(diagonal)).toBe(true);
    expect(mesh.edgeVertices(diagonal).sort()).toEqual([1, 3]);
    expect(mesh.findHalfedge(0, 2)).toBe(-1);
    const rebuilt = TriangleMesh.fromFaces(4, mesh.halfedgeVertex);
    expect(rebuilt.edgeCount).toBe(mesh.edgeCount);
  });

  it('refuses only boundary edges and edges with both halfedges in one face', () => {
    const square = TriangleMesh.fromFaces(4, [0, 1, 2, 0, 2, 3]);
    expect(square.flipEdge(square.halfedgeEdge[square.findHalfedge(0, 1)])).toBe(false);

    // In a tetrahedron every pair of vertices is already joined, so any flip
    // makes a parallel edge. Those are allowed.
    const tetrahedron = TriangleMesh.fromFaces(4, [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2]);
    for (let e = 0; e < tetrahedron.edgeCount; e++) {
      const mesh = tetrahedron.clone();
      expect(mesh.flipEdge(e)).toBe(true);
      mesh.validateConnectivity();
      expect(edgePairs(mesh).size).toBe(mesh.edgeCount - 1);
    }

    // A pillow: two triangles glued along all three edges. Both faces of 0–1
    // have third vertex 2, so the flip makes the loop 2–2 and leaves 0 and 1
    // with degree 1. Edge 1–2 then has both halfedges in one face.
    const pillow = TriangleMesh.fromFaces(3, [0, 1, 2, 1, 0, 2]);
    const diagonal = pillow.halfedgeEdge[pillow.findHalfedge(0, 1)];
    const side = pillow.halfedgeEdge[pillow.findHalfedge(1, 2)];
    expect(pillow.flipEdge(diagonal)).toBe(true);
    pillow.validateConnectivity();
    expect(pillow.edgeVertices(diagonal)).toEqual([2, 2]);
    expect(pillow.outgoingHalfedges(0)).toHaveLength(1);
    expect(pillow.flipEdge(side)).toBe(false);
    // Flipping the loop gives 0–1 back.
    expect(pillow.flipEdge(diagonal)).toBe(true);
    pillow.validateConnectivity();
    expect(pillow.edgeVertices(diagonal).sort()).toEqual([0, 1]);
  });

  it('stays valid when a flip duplicates a boundary edge', () => {
    // Found by the property test below (n = 2, picks [488192355, 1808445752,
    // 1877117490, 24171969]): the new edge runs opposite to the only halfedge
    // of an existing boundary edge.
    const mesh = plane({ resolution: 2 }).mesh.clone();
    for (const pick of [488192355, 1808445752, 1877117490, 24171969]) {
      mesh.flipEdge(pick % mesh.edgeCount);
    }
    mesh.validateConnectivity();
    expect(edgePairs(mesh).size).toBeLessThan(mesh.edgeCount);
  });

  it('keeps the mesh valid through any sequence of flips', () => {
    const meshes = fc.oneof(
      fc.integer({ min: 1, max: 8 }).map((n) => plane({ resolution: n }).mesh),
      fc.integer({ min: 2, max: 5 }).map((n) => ellipsoid(n, n + 1, [1, 1, 1]).mesh),
    );
    fc.assert(
      fc.property(meshes, fc.array(fc.nat(), { maxLength: 60 }), (input, picks) => {
        const mesh = input.clone();
        for (const pick of picks) {
          const e = pick % mesh.edgeCount;
          const before = mesh.edgeVertices(e).sort();
          if (!mesh.flipEdge(e)) continue;
          // A second flip restores the edge; a third redoes the first.
          expect(mesh.flipEdge(e)).toBe(true);
          expect(mesh.edgeVertices(e).sort()).toEqual(before);
          expect(mesh.flipEdge(e)).toBe(true);
        }
        mesh.validateConnectivity();
        expect(mesh.eulerCharacteristic()).toBe(input.eulerCharacteristic());
        for (let v = 0; v < mesh.vertexCount; v++) {
          expect(mesh.isBoundaryVertex(v)).toBe(input.isBoundaryVertex(v));
        }
      }),
      // Before boundary edges were handled, about 1 in 1,900 random flip
      // sequences broke the mesh; enough runs to catch a regression like that.
      { numRuns: 2000 },
    );
  });
});

describe('intrinsicDelaunay', () => {
  const nonDelaunaySurface = fc.oneof(
    randomOpenSurface,
    randomIntrinsicMetric,
    fc
      .record({
        resolution: fc.integer({ min: 4, max: 20 }),
        height: fc.double({ min: 0.5, max: 2, noNaN: true }),
        width: fc.double({ min: 0.15, max: 0.5, noNaN: true }),
      })
      .map((o) => ({ label: 'steep bump', ...gaussianBump(o) })),
  );

  it('makes every interior edge Delaunay without changing the surface', () => {
    fc.assert(
      fc.property(nonDelaunaySurface, ({ mesh, lengths }) => {
        const before = { mesh: mesh.clone(), lengths: lengths.slice() };
        const result = intrinsicDelaunay(mesh, lengths);
        result.mesh.validateConnectivity();
        expect(nonDelaunayEdges(result.mesh, result.lengths)).toEqual([]);
        validateEdgeLengths(result.mesh, result.lengths);
        // Same metric, different triangles: curvature and area are unchanged.
        const k0 = vertexCurvature(mesh, cornerAngles(mesh, lengths));
        const k1 = vertexCurvature(result.mesh, cornerAngles(result.mesh, result.lengths));
        for (let v = 0; v < k0.length; v++) expect(Math.abs(k1[v] - k0[v])).toBeLessThan(1e-12);
        const a0 = compensatedSum(faceAreas(mesh, lengths));
        const a1 = compensatedSum(faceAreas(result.mesh, result.lengths));
        expect(Math.abs(a1 - a0)).toBeLessThanOrEqual(1e-12 * a0);
        // The input is untouched.
        expect(Array.from(mesh.halfedgeVertex)).toEqual(Array.from(before.mesh.halfedgeVertex));
        expect(Array.from(lengths)).toEqual(Array.from(before.lengths));
      }),
      { numRuns: 150 },
    );
  });

  it('measures new edges correctly: on a flat mesh they are straight-line distances', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = plane({ resolution: 16, jitter: 0.2, seed });
      const result = intrinsicDelaunay(s.mesh, s.lengths);
      expect(result.flips).toBeGreaterThan(0);
      const straight = edgeLengthsFromPositions(result.mesh, s.positions);
      for (let e = 0; e < straight.length; e++) {
        expect(Math.abs(result.lengths[e] - straight[e])).toBeLessThanOrEqual(1e-14);
      }
    }
  });

  it('gives a Laplacian whose off-diagonal entries are all non-positive', () => {
    for (const s of [
      saddle({ resolution: 20, bend: 2 }),
      sphericalCap({ resolution: 20, radius: 2, jitter: 0.2, seed: 3 }),
    ]) {
      expect(nonDelaunayEdges(s.mesh, s.lengths).length).toBeGreaterThan(0);
      const result = intrinsicDelaunay(s.mesh, s.lengths);
      for (const [i, j, x] of cotanLaplacian(result.mesh, result.lengths).entries()) {
        if (i !== j) expect(x).toBeLessThanOrEqual(DELAUNAY_TOLERANCE);
      }
    }
  });

  it('does nothing to a mesh that is already Delaunay', () => {
    const s = plane({ resolution: 8 });
    const result = intrinsicDelaunay(s.mesh, s.lengths);
    expect(result.flips).toBe(0);
    const again = intrinsicDelaunay(...withFlips(saddle({ resolution: 10, bend: 2 })));
    expect(again.flips).toBe(0);
  });

  it('flips only where the metric is irregular', () => {
    // Jitter the left half of a regular grid. Every flip should happen there;
    // the regular right half, whose diagonals have weight 0 up to rounding,
    // must come out unchanged.
    const n = 16;
    const s = plane({ resolution: n });
    const positions = s.positions.slice();
    const random = mulberry32(5);
    for (let row = 1; row < n; row++) {
      for (let col = 1; col < n / 2; col++) {
        const v = row * (n + 1) + col;
        positions[3 * v] += (2 * random() - 1) * 0.2 * (2 / n);
        positions[3 * v + 1] += (2 * random() - 1) * 0.2 * (2 / n);
      }
    }
    const lengths = edgeLengthsFromPositions(s.mesh, positions);
    const result = intrinsicDelaunay(s.mesh, lengths);
    expect(result.flips).toBeGreaterThan(0);
    for (let e = 0; e < s.mesh.edgeCount; e++) {
      const [a, b] = s.mesh.edgeVertices(e);
      if (Math.min(positions[3 * a], positions[3 * b]) > 0.25) {
        expect(result.mesh.edgeVertices(e)).toEqual([a, b]);
      }
    }
  });

  it('reaches Delaunay through a parallel edge', () => {
    // A flattened tetrahedron: the long edge 0–1 faces two angles near π, and
    // its other diagonal 2–3 is already an edge.
    const positions = Float64Array.of(-1, 0, 0, 1, 0, 0, 0, 0.1, 0, 0, -0.1, 0.01);
    const mesh = TriangleMesh.fromFaces(4, [0, 1, 2, 1, 0, 3, 0, 2, 3, 1, 3, 2]);
    const result = expectDelaunayOfSameSurface(mesh, edgeLengthsFromPositions(mesh, positions));
    expect(result.flips).toBeGreaterThan(0);
    expect(edgePairs(result.mesh).size).toBeLessThan(result.mesh.edgeCount);
  });

  it('reaches Delaunay through a loop', () => {
    // A pillow of two triangles with sides 1.9, 1, 1. The long edge faces two
    // angles of 143.6°; its flip is a loop at vertex 2 whose length follows
    // from unfolding both faces around vertex 0, where each has angle
    // acos(0.95): 2 sin(acos 0.95) = 2√(1 − 0.95²).
    const mesh = TriangleMesh.fromFaces(3, [0, 1, 2, 1, 0, 2]);
    const long = mesh.halfedgeEdge[mesh.findHalfedge(0, 1)];
    const lengths = new Float64Array(mesh.edgeCount).fill(1);
    lengths[long] = 1.9;
    const result = expectDelaunayOfSameSurface(mesh, lengths);
    expect(result.flips).toBe(1);
    expect(result.mesh.edgeVertices(long)).toEqual([2, 2]);
    expect(result.lengths[long]).toBeCloseTo(2 * Math.sqrt(1 - 0.95 ** 2), 15);
  });

  it('reaches Delaunay on a narrow bump that needs a loop', () => {
    // One of 20 in a sweep of 3,000 random bumps that stopped short of
    // Delaunay while flips that create loops or parallel edges were refused.
    const s = gaussianBump({
      resolution: 10,
      jitter: 0.15736119030043483,
      seed: 279462913,
      height: -1.4975862205028534,
      width: 0.13635363595094532,
    });
    const result = expectDelaunayOfSameSurface(s.mesh, s.lengths);
    const loops = Array.from({ length: result.mesh.edgeCount }, (_, e) =>
      result.mesh.edgeVertices(e),
    ).filter(([a, b]) => a === b);
    expect(loops.length).toBeGreaterThan(0);
  });

  it('leaves a cocircular edge alone even next to a real flip', () => {
    // Vertices 0..3 are a square with corner 0 pulled outwards, so diagonal
    // 0–2 must flip to 1–3. Vertex 4 lies on the circle through 1, 2, 3, so
    // after that flip edge 1–2 has weight 0 within rounding: Delaunay either
    // way, and the tolerance says leave it.
    const positions = Float64Array.of(
      ...[-0.1, -0.1, 0],
      ...[1, 0, 0],
      ...[1, 1, 0],
      ...[0, 1, 0],
      ...[0.5 + Math.SQRT1_2, 0.5, 0],
    );
    const mesh = TriangleMesh.fromFaces(5, [0, 1, 2, 0, 2, 3, 1, 4, 2]);
    const result = intrinsicDelaunay(mesh, edgeLengthsFromPositions(mesh, positions));
    expect(result.flips).toBe(1);
    expect(result.mesh.findHalfedge(1, 2)).not.toBe(-1);
    expect(result.mesh.findHalfedge(1, 3) + result.mesh.findHalfedge(3, 1)).toBeGreaterThan(-2);
    expect(nonDelaunayEdges(result.mesh, result.lengths)).toEqual([]);
  });

  it('stops with an error instead of looping forever', () => {
    const s = saddle({ resolution: 12, bend: 2 });
    expect(() => intrinsicDelaunay(s.mesh, s.lengths, { maxFlips: 3 })).toThrow(
      /did not terminate/,
    );
  });
});

function withFlips(s: { mesh: TriangleMesh; lengths: Float64Array }): [TriangleMesh, Float64Array] {
  const result = intrinsicDelaunay(s.mesh, s.lengths);
  return [result.mesh, result.lengths];
}

/** Distinct unordered vertex pairs joined by an edge; fewer than edgeCount means parallel edges or loops. */
function edgePairs(mesh: TriangleMesh): Set<string> {
  const pairs = new Set<string>();
  for (let e = 0; e < mesh.edgeCount; e++) {
    const [a, b] = mesh.edgeVertices(e);
    pairs.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
  return pairs;
}

/** Runs intrinsicDelaunay and checks the result is valid, Delaunay, and the same surface. */
function expectDelaunayOfSameSurface(mesh: TriangleMesh, lengths: Float64Array) {
  const result = intrinsicDelaunay(mesh, lengths);
  result.mesh.validateConnectivity();
  validateEdgeLengths(result.mesh, result.lengths);
  expect(nonDelaunayEdges(result.mesh, result.lengths)).toEqual([]);
  const k0 = vertexCurvature(mesh, cornerAngles(mesh, lengths));
  const k1 = vertexCurvature(result.mesh, cornerAngles(result.mesh, result.lengths));
  for (let v = 0; v < k0.length; v++) expect(Math.abs(k1[v] - k0[v])).toBeLessThan(1e-12);
  const a0 = compensatedSum(faceAreas(mesh, lengths));
  const a1 = compensatedSum(faceAreas(result.mesh, result.lengths));
  expect(Math.abs(a1 - a0)).toBeLessThanOrEqual(1e-12 * a0);
  return result;
}
