import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CsrMatrix } from '../../src/core/index.ts';
import { dense } from '../support/linear-algebra.ts';

describe('CsrMatrix', () => {
  it('sorts columns, sums duplicates and keeps empty rows', () => {
    const m = CsrMatrix.fromTriplets(3, 4, [2, 0, 2, 0, 2], [3, 1, 0, 1, 3], [1, 2, 3, 4, 5]);
    expect(dense(m)).toEqual([
      [0, 6, 0, 0],
      [0, 0, 0, 0],
      [3, 0, 0, 6],
    ]);
    expect(Array.from(m.rowStart)).toEqual([0, 1, 1, 3]);
    expect(Array.from(m.columnIndex)).toEqual([1, 0, 3]);
    expect(m.get(2, 3)).toBe(6);
    expect(m.get(1, 1)).toBe(0);
    expect(m.get(2, 1)).toBe(0);
    expect(Array.from(m.diagonal())).toEqual([0, 0, 0]);
  });

  it('multiplies like the dense matrix it stores', () => {
    const triplet = fc.tuple(
      fc.integer({ min: 0, max: 7 }),
      fc.integer({ min: 0, max: 5 }),
      fc.double({ min: -10, max: 10, noNaN: true }),
    );
    fc.assert(
      fc.property(
        fc.array(triplet, { maxLength: 60 }),
        fc.array(fc.double({ min: -10, max: 10, noNaN: true }), { minLength: 6, maxLength: 6 }),
        (triplets, x) => {
          const m = CsrMatrix.fromTriplets(
            8,
            6,
            triplets.map((t) => t[0]),
            triplets.map((t) => t[1]),
            triplets.map((t) => t[2]),
          );
          const expected = new Array<number>(8).fill(0);
          for (const [i, j, v] of triplets) expected[i] += v * x[j];
          const y = m.multiply(Float64Array.from(x));
          for (let i = 0; i < 8; i++) expect(y[i]).toBeCloseTo(expected[i], 9);
        },
      ),
    );
  });

  it('rejects malformed input', () => {
    expect(() => CsrMatrix.fromTriplets(2, 2, [0], [0, 1], [1])).toThrow(RangeError);
    expect(() => CsrMatrix.fromTriplets(2, 2, [2], [0], [1])).toThrow(/outside/);
    expect(() => CsrMatrix.fromTriplets(2, 2, [0], [-1], [1])).toThrow(/outside/);
    expect(() => CsrMatrix.fromTriplets(2, 2, [0.5], [0], [1])).toThrow(/outside/);
    const m = CsrMatrix.fromTriplets(2, 3, [0], [0], [1]);
    expect(() => m.multiply(new Float64Array(2))).toThrow(RangeError);
    expect(() => m.multiply(new Float64Array(3), new Float64Array(3))).toThrow(RangeError);
  });
});
