import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { symmetricEigen } from '../../src/core/index.ts';

function check(a: Float64Array, n: number) {
  const { values, vectors } = symmetricEigen(a, n);
  let norm = 0;
  for (const x of a) norm = Math.max(norm, Math.abs(x));
  // Backward stability: residuals and orthogonality of order n·ε·||A||.
  const tolerance = 50 * n * Number.EPSILON * Math.max(norm, 1);
  for (let k = 0; k < n; k++) {
    if (k > 0) expect(values[k]).toBeGreaterThanOrEqual(values[k - 1]);
    for (let i = 0; i < n; i++) {
      let av = 0;
      for (let j = 0; j < n; j++) av += a[i * n + j] * vectors[k * n + j];
      expect(Math.abs(av - values[k] * vectors[k * n + i])).toBeLessThanOrEqual(tolerance);
    }
    for (let l = 0; l < n; l++) {
      let dot = 0;
      for (let i = 0; i < n; i++) dot += vectors[k * n + i] * vectors[l * n + i];
      expect(Math.abs(dot - (k === l ? 1 : 0))).toBeLessThanOrEqual(50 * n * Number.EPSILON);
    }
  }
  return values;
}

function symmetric(n: number, entry: (i: number, j: number) => number): Float64Array {
  const a = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      a[i * n + j] = entry(i, j);
      a[j * n + i] = a[i * n + j];
    }
  }
  return a;
}

describe('symmetricEigen', () => {
  it('diagonalizes random symmetric matrices', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }).chain((n) =>
          fc.tuple(
            fc.constant(n),
            fc.array(fc.double({ min: -100, max: 100, noNaN: true }), {
              minLength: n * n,
              maxLength: n * n,
            }),
          ),
        ),
        ([n, raw]) => {
          const a = symmetric(n, (i, j) => raw[i * n + j]);
          const values = check(a, n);
          let trace = 0;
          for (let i = 0; i < n; i++) trace += a[i * n + i];
          const sum = values.reduce((s, x) => s + x, 0);
          expect(Math.abs(sum - trace)).toBeLessThanOrEqual(1e-10 * (1 + Math.abs(trace)) * n);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('gets the known eigenvalues of the 1D Dirichlet Laplacian', () => {
    // tridiag(−1, 2, −1) of size n has eigenvalues 2 − 2cos(kπ/(n + 1)).
    const n = 30;
    const a = symmetric(n, (i, j) => (i === j ? 2 : i - j === 1 ? -1 : 0));
    const values = check(a, n);
    for (let k = 1; k <= n; k++) {
      expect(values[k - 1]).toBeCloseTo(2 - 2 * Math.cos((k * Math.PI) / (n + 1)), 13);
    }
  });

  it('handles repeated eigenvalues, zero and already diagonal matrices', () => {
    expect(
      Array.from(
        check(
          symmetric(5, (i, j) => (i === j ? 3 : 0)),
          5,
        ),
      ),
    ).toEqual([3, 3, 3, 3, 3]);
    expect(Array.from(check(new Float64Array(16), 4))).toEqual([0, 0, 0, 0]);
    expect(
      Array.from(
        check(
          symmetric(3, (i, j) => (i === j ? [5, -1, 2][i] : 0)),
          3,
        ),
      ),
    ).toEqual([-1, 2, 5]);
    // All ones: eigenvalues 0 (n − 1 times) and n.
    const values = check(
      symmetric(6, () => 1),
      6,
    );
    for (let k = 0; k < 5; k++) expect(Math.abs(values[k])).toBeLessThan(1e-14);
    expect(values[5]).toBeCloseTo(6, 13);
  });

  it('rejects malformed input', () => {
    expect(() => symmetricEigen(new Float64Array(5), 2)).toThrow(RangeError);
    expect(() => symmetricEigen(new Float64Array(0), 0)).toThrow(RangeError);
    expect(() => symmetricEigen(Float64Array.of(1, 0, Number.NaN, 1), 2)).toThrow(/not finite/);
  });
});
