import { describe, expect, it } from 'vitest';
import {
  cone,
  edgeLengthsFromPositions,
  gaussianBump,
  plane,
  saddle,
  sphericalCap,
  validateEdgeLengths,
} from '../../src/core/index.ts';

describe('surface generators', () => {
  const all = [
    plane({ resolution: 6, jitter: 0.2, seed: 5 }),
    gaussianBump({ resolution: 6, height: 0.5, width: 0.4 }),
    saddle({ resolution: 6, bend: 0.5 }),
    sphericalCap({ resolution: 6, radius: 2 }),
    cone({ deficit: 1, rings: 4, sectors: 9 }),
  ];

  it('produce valid metrics on disks', () => {
    for (const s of all) {
      expect(() => {
        validateEdgeLengths(s.mesh, s.lengths);
      }).not.toThrow();
      expect(s.mesh.eulerCharacteristic()).toBe(1);
      expect(s.positions).toHaveLength(3 * s.mesh.vertexCount);
    }
  });

  it('say truthfully whether the lengths are the chord lengths of the positions', () => {
    for (const s of all) {
      const chords = edgeLengthsFromPositions(s.mesh, s.positions);
      const match = chords.every((l, e) => l === s.lengths[e]);
      expect(match).toBe(s.lengthsMatchPositions);
    }
  });

  it('report the curvature of a sphere as 1/R² everywhere', () => {
    const s = sphericalCap({ resolution: 8, radius: 3, jitter: 0.1, seed: 2 });
    if (s.exact.kind !== 'pointwise') throw new Error('expected pointwise curvature');
    for (const k of s.exact.gaussian) expect(k).toBeCloseTo(1 / 9, 14);
  });

  it('jitter interior vertices only, reproducibly', () => {
    const a = plane({ resolution: 6, jitter: 0.2, seed: 9 });
    const b = plane({ resolution: 6, jitter: 0.2, seed: 9 });
    const c = plane({ resolution: 6, jitter: 0.2, seed: 10 });
    const regular = plane({ resolution: 6 });
    expect(a.positions).toEqual(b.positions);
    expect(a.positions).not.toEqual(c.positions);
    for (let v = 0; v < a.mesh.vertexCount; v++) {
      const moved =
        a.positions[3 * v] !== regular.positions[3 * v] ||
        a.positions[3 * v + 1] !== regular.positions[3 * v + 1];
      expect(moved).toBe(!a.mesh.isBoundaryVertex(v));
    }
  });

  it.each([
    ['a zero resolution', () => plane({ resolution: 0 })],
    ['a fractional resolution', () => plane({ resolution: 2.5 })],
    ['too much jitter', () => plane({ resolution: 4, jitter: 0.3 })],
    ['negative jitter', () => plane({ resolution: 4, jitter: -0.1 })],
    ['a zero bump width', () => gaussianBump({ resolution: 4, height: 1, width: 0 })],
    ['a non-finite bump height', () => gaussianBump({ resolution: 4, height: Infinity, width: 1 })],
    ['a non-finite bend', () => saddle({ resolution: 4, bend: Number.NaN })],
    ['a sphere too small to cover the square', () => sphericalCap({ resolution: 4, radius: 1.4 })],
    ['a zero deficit', () => cone({ deficit: 0, rings: 2, sectors: 6 })],
    ['a full-turn deficit', () => cone({ deficit: 2 * Math.PI, rings: 2, sectors: 6 })],
    ['too few sectors', () => cone({ deficit: 1, rings: 2, sectors: 2 })],
    ['no rings', () => cone({ deficit: 1, rings: 0, sectors: 6 })],
  ])('reject %s', (_label, make) => {
    expect(make).toThrow(RangeError);
  });
});
