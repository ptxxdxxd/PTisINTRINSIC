import type { CsrMatrix } from './sparse.ts';

export interface ConjugateGradientOptions {
  /** Stop when ||b − A x|| <= tolerance · ||b||. */
  readonly tolerance?: number;
  readonly maxIterations?: number;
  /** Jacobi (diagonal) preconditioning; requires a positive diagonal. */
  readonly preconditioner?: 'jacobi' | 'none';
  /** Starting guess; zero when omitted. */
  readonly initialGuess?: Float64Array;
}

export interface ConjugateGradientResult {
  readonly x: Float64Array;
  readonly iterations: number;
  /** ||b − A x|| / ||b||, recomputed from scratch at the end. */
  readonly relativeResidual: number;
  readonly converged: boolean;
}

/**
 * Preconditioned conjugate gradient for a symmetric positive definite A, or a
 * positive semidefinite A with b in its range (e.g. a Neumann Laplacian with a
 * mean-free right-hand side).
 *
 * Y. Saad, "Iterative Methods for Sparse Linear Systems", 2nd ed., SIAM 2003,
 * section 9.2.
 */
export function conjugateGradient(
  a: CsrMatrix,
  b: Float64Array,
  options: ConjugateGradientOptions = {},
): ConjugateGradientResult {
  const n = b.length;
  if (a.rows !== n || a.cols !== n) {
    throw new RangeError(`need a square ${n} x ${n} matrix, got ${a.rows} x ${a.cols}`);
  }
  const tolerance = options.tolerance ?? 1e-10;
  const maxIterations = options.maxIterations ?? 10 * n;
  const inverseDiagonal = new Float64Array(n).fill(1);
  if ((options.preconditioner ?? 'jacobi') === 'jacobi') {
    const d = a.diagonal();
    for (let i = 0; i < n; i++) {
      if (!(d[i] > 0)) throw new RangeError(`Jacobi preconditioning needs A[${i}][${i}] > 0`);
      inverseDiagonal[i] = 1 / d[i];
    }
  }

  const x = options.initialGuess ? Float64Array.from(options.initialGuess) : new Float64Array(n);
  const bNorm = Math.sqrt(dot(b, b));
  if (bNorm === 0) {
    return { x: new Float64Array(n), iterations: 0, relativeResidual: 0, converged: true };
  }
  const r = a.multiply(x);
  for (let i = 0; i < n; i++) r[i] = b[i] - r[i];
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = inverseDiagonal[i] * r[i];
  const p = Float64Array.from(z);
  const ap = new Float64Array(n);
  let rz = dot(r, z);

  let iterations = 0;
  while (Math.sqrt(dot(r, r)) > tolerance * bNorm && iterations < maxIterations) {
    a.multiply(p, ap);
    const alpha = rz / dot(p, ap);
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
      z[i] = inverseDiagonal[i] * r[i];
    }
    const rzNext = dot(r, z);
    const beta = rzNext / rz;
    rz = rzNext;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    iterations++;
  }

  // The recursively updated residual drifts from the true one; report the true one.
  const trueResidual = a.multiply(x);
  for (let i = 0; i < n; i++) trueResidual[i] = b[i] - trueResidual[i];
  const relativeResidual = Math.sqrt(dot(trueResidual, trueResidual)) / bNorm;
  return { x, iterations, relativeResidual, converged: relativeResidual <= tolerance };
}

function dot(u: Float64Array, v: Float64Array): number {
  let s = 0;
  for (let i = 0; i < u.length; i++) s += u[i] * v[i];
  return s;
}
