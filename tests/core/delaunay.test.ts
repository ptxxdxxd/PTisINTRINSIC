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

  it('refuses boundary edges and flips that would duplicate an edge', () => {
    const square = TriangleMesh.fromFaces(4, [0, 1, 2, 0, 2, 3]);
    expect(square.flipEdge(square.halfedgeEdge[square.findHalfedge(0, 1)])).toBe(false);
    // In a tetrahedron every pair of vertices is already joined.
    const tetrahedron = TriangleMesh.fromFaces(4, [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2]);
    for (let e = 0; e < tetrahedron.edgeCount; e++) expect(tetrahedron.flipEdge(e)).toBe(false);
  });

  it('refuses a flip onto a boundary edge whose only halfedge runs the other way', () => {
    // Regression: found by the property test below (counterexample n = 2,
    // picks [488192355, 1808445752, 1877117490, 24171969]).
    const mesh = plane({ resolution: 2 }).mesh.clone();
    for (const pick of [488192355, 1808445752, 1877117490, 24171969]) {
      mesh.flipEdge(pick % mesh.edgeCount);
    }
    expect(() => TriangleMesh.fromFaces(mesh.vertexCount, mesh.halfedgeVertex)).not.toThrow();
  });

  it('keeps the mesh valid through any sequence of flips', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.array(fc.nat(), { maxLength: 40 }),
        (n, picks) => {
          const mesh = plane({ resolution: n }).mesh.clone();
          for (const pick of picks) mesh.flipEdge(pick % mesh.edgeCount);
          const rebuilt = TriangleMesh.fromFaces(mesh.vertexCount, mesh.halfedgeVertex);
          expect(rebuilt.edgeCount).toBe(mesh.edgeCount);
          expect(Array.from(rebuilt.halfedgeTwin)).toEqual(Array.from(mesh.halfedgeTwin));
          for (let v = 0; v < mesh.vertexCount; v++) {
            const fan = mesh.outgoingHalfedges(v);
            expect(fan).toHaveLength(rebuilt.outgoingHalfedges(v).length);
            expect(mesh.isBoundaryVertex(v)).toBe(rebuilt.isBoundaryVertex(v));
          }
          for (let e = 0; e < mesh.edgeCount; e++) {
            expect(mesh.halfedgeEdge[mesh.edgeHalfedge[e]]).toBe(e);
          }
        },
      ),
      // Before the fix for boundary edges, about 1 in 1,900 random flip
      // sequences failed here; enough runs to catch a regression like that.
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
        expect(result.blocked).toEqual([]);
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

  it('reports edges it cannot flip', () => {
    // A flattened tetrahedron: the long edge 0–1 faces two angles near π, but
    // its other diagonal 2–3 is already an edge.
    const positions = Float64Array.of(-1, 0, 0, 1, 0, 0, 0, 0.1, 0, 0, -0.1, 0.01);
    const mesh = TriangleMesh.fromFaces(4, [0, 1, 2, 1, 0, 3, 0, 2, 3, 1, 3, 2]);
    const lengths = edgeLengthsFromPositions(mesh, positions);
    const result = intrinsicDelaunay(mesh, lengths);
    expect(result.flips).toBe(0);
    expect(result.blocked).toContain(mesh.halfedgeEdge[mesh.findHalfedge(0, 1)]);
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
