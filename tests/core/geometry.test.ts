import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  TriangleMesh,
  compensatedSum,
  cornerAngles,
  edgeLengthsFromPositions,
  faceAreas,
  faceEdgeLengths,
  plane,
  validateEdgeLengths,
  vertexAreas,
} from '../../src/core/index.ts';
import { randomIntrinsicMetric, randomOpenSurface } from '../support/random-surfaces.ts';

const singleTriangle = TriangleMesh.fromFaces(3, [0, 1, 2]);

describe('edge lengths', () => {
  it('measures edges from positions', () => {
    const positions = Float64Array.of(0, 0, 0, 3, 0, 0, 0, 4, 0);
    // Edges are (0,1), (1,2), (2,0).
    expect(Array.from(edgeLengthsFromPositions(singleTriangle, positions))).toEqual([3, 5, 4]);
  });

  it('rejects a position array of the wrong size', () => {
    expect(() => edgeLengthsFromPositions(singleTriangle, new Float64Array(8))).toThrow(RangeError);
  });

  it('lists the edge opposite each corner', () => {
    // Corner 0 is vertex 0, opposite edge (1,2) of length 5, and so on.
    expect(faceEdgeLengths(singleTriangle, Float64Array.of(3, 5, 4), 0)).toEqual([5, 4, 3]);
  });

  it.each([
    ['the wrong count', Float64Array.of(1, 1)],
    ['a zero length', Float64Array.of(1, 0, 1)],
    ['a NaN length', Float64Array.of(1, Number.NaN, 1)],
    ['an infinite length', Float64Array.of(1, Number.POSITIVE_INFINITY, 1)],
    ['a triangle inequality violation', Float64Array.of(1, 3, 1)],
    ['a degenerate face', Float64Array.of(1, 2, 1)],
  ])('rejects %s', (_label, lengths) => {
    expect(() => {
      validateEdgeLengths(singleTriangle, lengths);
    }).toThrow(RangeError);
  });
});

describe('areas and angles', () => {
  it('sums face areas to the area of the square, jitter or not', () => {
    for (const jitter of [0, 0.2]) {
      const s = plane({ resolution: 7, jitter, seed: 3 });
      expect(compensatedSum(faceAreas(s.mesh, s.lengths))).toBeCloseTo(4, 13);
    }
  });

  it('gives every face an angle sum of π', () => {
    fc.assert(
      fc.property(fc.oneof(randomOpenSurface, randomIntrinsicMetric), ({ mesh, lengths }) => {
        const angles = cornerAngles(mesh, lengths);
        for (let f = 0; f < mesh.faceCount; f++) {
          const sum = angles[3 * f] + angles[3 * f + 1] + angles[3 * f + 2];
          expect(Math.abs(sum - Math.PI)).toBeLessThanOrEqual(4 * Number.EPSILON * Math.PI);
        }
      }),
    );
  });

  it('indexes angles by corner', () => {
    const angles = cornerAngles(singleTriangle, Float64Array.of(3, 5, 4));
    // Vertex 0 is the right angle between the legs of length 3 and 4.
    expect(angles[0]).toBe(Math.PI / 2);
    expect(angles[1]).toBeCloseTo(Math.atan2(4, 3), 15);
    expect(angles[2]).toBeCloseTo(Math.atan2(3, 4), 15);
  });

  it.each(['barycentric', 'mixed'] as const)(
    'partitions the surface area among vertices (%s)',
    (scheme) => {
      fc.assert(
        fc.property(fc.oneof(randomOpenSurface, randomIntrinsicMetric), ({ mesh, lengths }) => {
          const total = compensatedSum(faceAreas(mesh, lengths));
          const areas = vertexAreas(mesh, lengths, scheme);
          expect(compensatedSum(areas)).toBeCloseTo(total, 12);
          for (const a of areas) expect(a).toBeGreaterThan(0);
        }),
      );
    },
  );

  it('gives an obtuse corner half the triangle and the others a quarter', () => {
    // Sides 1, 1, 1.9: the corner between the two unit sides is obtuse.
    // Edges are (0,1) = 1.9, (1,2) = 1, (2,0) = 1, so vertex 2 is the obtuse corner.
    const lengths = Float64Array.of(1.9, 1, 1);
    const [area] = faceAreas(singleTriangle, lengths);
    const mixed = vertexAreas(singleTriangle, lengths, 'mixed');
    expect(Array.from(mixed)).toEqual([area / 4, area / 4, area / 2]);
  });

  it('splits an equilateral triangle into equal Voronoi thirds', () => {
    const lengths = Float64Array.of(1, 1, 1);
    const mixed = vertexAreas(singleTriangle, lengths, 'mixed');
    for (const a of mixed) expect(a).toBeCloseTo(Math.sqrt(3) / 12, 15);
  });
});
