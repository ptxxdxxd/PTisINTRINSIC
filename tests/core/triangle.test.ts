import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { triangleAngle, triangleArea } from '../../src/core/triangle.ts';

describe('triangleArea', () => {
  it('is exact on a 3-4-5 right triangle', () => {
    expect(triangleArea(3, 4, 5)).toBe(6);
  });

  it('matches sqrt(3)/4 on the unit equilateral triangle', () => {
    expect(triangleArea(1, 1, 1)).toBeCloseTo(Math.sqrt(3) / 4, 15);
  });

  it('returns 0 for a collinear triangle', () => {
    expect(triangleArea(1, 2, 3)).toBe(0);
  });

  it.each([
    [1, 1, 3],
    [-1, 1, 1],
    [Number.NaN, 1, 1],
    [Number.POSITIVE_INFINITY, 1, 1],
  ])('rejects (%d, %d, %d)', (a, b, c) => {
    expect(() => triangleArea(a, b, c)).toThrow(RangeError);
  });

  it('does not depend on the order of the sides', () => {
    fc.assert(
      fc.property(validTriangle(), ([a, b, c]) => {
        const area = triangleArea(a, b, c);
        expect(triangleArea(b, c, a)).toBe(area);
        expect(triangleArea(c, a, b)).toBe(area);
        expect(triangleArea(b, a, c)).toBe(area);
      }),
    );
  });

  it('scales exactly by 4^k when every side is scaled by 2^k', () => {
    // Multiplying by a power of two is exact in binary floating point, so the
    // scaled computation performs the same roundings and the identity is exact.
    fc.assert(
      fc.property(validTriangle(), fc.integer({ min: -20, max: 20 }), ([a, b, c], k) => {
        const s = 2 ** k;
        expect(triangleArea(s * a, s * b, s * c)).toBe(4 ** k * triangleArea(a, b, c));
      }),
    );
  });

  it('agrees with the cross-product area of triangles built from points', () => {
    const coordinate = fc.double({ min: -1, max: 1, noNaN: true });
    const point = fc.tuple(coordinate, coordinate);
    fc.assert(
      fc.property(point, point, point, (p, q, r) => {
        const crossArea =
          0.5 * Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]));
        // Below this area the lengths themselves are too ill-conditioned for a
        // fixed absolute tolerance to mean anything; needle accuracy is checked
        // against a 50-digit reference in the Python oracle instead.
        fc.pre(crossArea > 1e-3);
        const a = Math.hypot(q[0] - r[0], q[1] - r[1]);
        const b = Math.hypot(p[0] - r[0], p[1] - r[1]);
        const c = Math.hypot(p[0] - q[0], p[1] - q[1]);
        expect(Math.abs(triangleArea(a, b, c) - crossArea)).toBeLessThan(1e-11);
      }),
    );
  });
});

describe('triangleAngle', () => {
  it('returns the right angle of a 3-4-5 triangle exactly', () => {
    expect(triangleAngle(5, 3, 4)).toBe(Math.PI / 2);
  });

  it('returns π/3 for an equilateral triangle', () => {
    expect(triangleAngle(1, 1, 1)).toBeCloseTo(Math.PI / 3, 15);
  });

  it('returns exactly π and 0 for a collinear triangle', () => {
    expect(triangleAngle(3, 1, 2)).toBe(Math.PI);
    expect(triangleAngle(1, 2, 3)).toBe(0);
  });

  it('is symmetric in the two adjacent sides', () => {
    fc.assert(
      fc.property(validTriangle(), ([a, b, c]) => {
        expect(triangleAngle(c, a, b)).toBe(triangleAngle(c, b, a));
      }),
    );
  });

  it('gives three angles that sum to π', () => {
    fc.assert(
      fc.property(validTriangle(), ([a, b, c]) => {
        const sum = triangleAngle(a, b, c) + triangleAngle(b, c, a) + triangleAngle(c, a, b);
        expect(Math.abs(sum - Math.PI)).toBeLessThanOrEqual(4 * Number.EPSILON * Math.PI);
      }),
    );
  });

  it('agrees with atan2 of the cross and dot products for triangles built from points', () => {
    const coordinate = fc.double({ min: -1, max: 1, noNaN: true });
    const point = fc.tuple(coordinate, coordinate);
    fc.assert(
      fc.property(point, point, point, (p, q, r) => {
        const u = [q[0] - p[0], q[1] - p[1]] as const;
        const w = [r[0] - p[0], r[1] - p[1]] as const;
        fc.pre(Math.abs(u[0] * w[1] - u[1] * w[0]) > 1e-3);
        const expected = Math.atan2(Math.abs(u[0] * w[1] - u[1] * w[0]), u[0] * w[0] + u[1] * w[1]);
        const opposite = Math.hypot(q[0] - r[0], q[1] - r[1]);
        expect(triangleAngle(opposite, Math.hypot(...u), Math.hypot(...w))).toBeCloseTo(
          expected,
          11,
        );
      }),
    );
  });

  it.each([
    [1, 0, 1],
    [1, 1, -1],
    [-1, 1, 1],
    [3, 1, 1],
    [Number.NaN, 1, 1],
    [1, Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1, 1],
    [1, Number.POSITIVE_INFINITY, 1],
  ])('rejects opposite %d with sides %d and %d', (c, a, b) => {
    expect(() => triangleAngle(c, a, b)).toThrow(RangeError);
  });
});

/** Side lengths of a non-degenerate triangle, built from two sides and the angle between them. */
function validTriangle(): fc.Arbitrary<[number, number, number]> {
  const side = fc.double({ min: 1e-3, max: 1e3, noNaN: true });
  const angle = fc.double({ min: 1e-3, max: Math.PI - 1e-3, noNaN: true });
  return (
    fc
      .tuple(side, side, angle)
      .map(([a, b, theta]): [number, number, number] => {
        const c = Math.sqrt(Math.max(0, a * a + b * b - 2 * a * b * Math.cos(theta)));
        return [a, b, c];
      })
      // Rounding in the law of cosines can push c a hair outside [|a-b|, a+b].
      .filter(([a, b, c]) => c > 0 && c - Math.abs(a - b) >= 0 && a + b - c >= 0)
  );
}
