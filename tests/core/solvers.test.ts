import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CsrMatrix, conjugateGradient, mulberry32 } from '../../src/core/index.ts';

/** Tridiagonal (−1, 2, −1): the 1D Dirichlet Laplacian, SPD. */
function poisson1d(n: number): CsrMatrix {
  const rows: number[] = [];
  const cols: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    rows.push(i);
    cols.push(i);
    values.push(2);
    if (i > 0) {
      rows.push(i, i - 1);
      cols.push(i - 1, i);
      values.push(-1, -1);
    }
  }
  return CsrMatrix.fromTriplets(n, n, rows, cols, values);
}

/** Random sparse symmetric strictly diagonally dominant matrix: SPD. */
function randomSpd(n: number, seed: number, scale: (i: number) => number = () => 1): CsrMatrix {
  const random = mulberry32(seed);
  const rows: number[] = [];
  const cols: number[] = [];
  const values: number[] = [];
  const rowSum = new Float64Array(n);
  for (let k = 0; k < 4 * n; k++) {
    const i = Math.floor(random() * n);
    const j = Math.floor(random() * n);
    if (i === j) continue;
    const v = (random() - 0.5) * scale(i) * scale(j);
    rows.push(i, j);
    cols.push(j, i);
    values.push(v, v);
    rowSum[i] += Math.abs(v);
    rowSum[j] += Math.abs(v);
  }
  for (let i = 0; i < n; i++) {
    rows.push(i);
    cols.push(i);
    values.push(rowSum[i] + scale(i) * scale(i));
  }
  return CsrMatrix.fromTriplets(n, n, rows, cols, values);
}

describe('conjugateGradient', () => {
  it('solves the 1D Poisson problem in at most n iterations', () => {
    const n = 64;
    const a = poisson1d(n);
    const exact = Float64Array.from({ length: n }, (_, i) =>
      Math.sin((3 * Math.PI * (i + 1)) / (n + 1)),
    );
    const result = conjugateGradient(a, a.multiply(exact), { tolerance: 1e-13 });
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(n);
    for (let i = 0; i < n; i++) expect(result.x[i]).toBeCloseTo(exact[i], 10);
  });

  it('reaches the requested residual on random SPD systems', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 80 }), fc.integer(), (n, seed) => {
        const a = randomSpd(n, seed);
        const random = mulberry32(seed ^ 0x9e3779b9);
        const b = Float64Array.from({ length: n }, () => random() - 0.5);
        const result = conjugateGradient(a, b, { tolerance: 1e-10 });
        expect(result.converged).toBe(true);
        expect(result.relativeResidual).toBeLessThanOrEqual(1e-10);
      }),
    );
  });

  it('needs fewer iterations with Jacobi preconditioning on a badly scaled system', () => {
    const n = 200;
    const a = randomSpd(n, 7, (i) => 10 ** ((3 * i) / n));
    const b = new Float64Array(n).fill(1);
    const jacobi = conjugateGradient(a, b, { tolerance: 1e-10 });
    const plain = conjugateGradient(a, b, { tolerance: 1e-10, preconditioner: 'none' });
    expect(jacobi.converged && plain.converged).toBe(true);
    expect(jacobi.iterations).toBeLessThan(plain.iterations / 2);
  });

  it('reports failure honestly when it runs out of iterations', () => {
    const a = poisson1d(100);
    const result = conjugateGradient(a, new Float64Array(100).fill(1), { maxIterations: 3 });
    expect(result.converged).toBe(false);
    expect(result.iterations).toBe(3);
    expect(result.relativeResidual).toBeGreaterThan(1e-10);
  });

  it('returns at once for a zero right-hand side or an exact initial guess', () => {
    const a = poisson1d(10);
    expect(conjugateGradient(a, new Float64Array(10)).iterations).toBe(0);
    const x = Float64Array.from({ length: 10 }, (_, i) => i);
    const result = conjugateGradient(a, a.multiply(x), { initialGuess: x });
    expect(result.iterations).toBe(0);
    expect(Array.from(result.x)).toEqual(Array.from(x));
  });

  it('rejects mismatched sizes and a non-positive diagonal under Jacobi', () => {
    const a = poisson1d(4);
    expect(() => conjugateGradient(a, new Float64Array(3))).toThrow(RangeError);
    const singular = CsrMatrix.fromTriplets(2, 2, [0, 1], [0, 1], [1, 0]);
    expect(() => conjugateGradient(singular, Float64Array.of(1, 1))).toThrow(/Jacobi/);
  });
});
