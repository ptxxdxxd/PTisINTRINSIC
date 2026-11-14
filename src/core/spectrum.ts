/**
 * Spectrum of the cotan Laplacian and quantities built from it.
 *
 * With stiffness L and lumped (diagonal) mass M, the discrete eigenproblem is
 * the generalized one L φ = λ M φ. Writing ψ = M^{1/2} φ turns it into the
 * symmetric problem M^{-1/2} L M^{-1/2} ψ = λ ψ, which the dense solver
 * handles; the eigenfunctions φ come out M-orthonormal: φ_jᵀ M φ_k = δ_jk.
 */
import { symmetricEigen } from './eigen.ts';
import type { CsrMatrix } from './sparse.ts';

/**
 * Largest mesh the dense eigensolver accepts. Its cost grows as n³, from
 * about a second to several seconds over the last doubling (docs/results.md
 * has measured times), so beyond this a sparse eigensolver is needed.
 */
export const DENSE_EIGEN_LIMIT = 1100;

export interface LaplacianSpectrum {
  /** Eigenvalues in ascending order; the first is 0 (constants) up to rounding. */
  readonly values: Float64Array;
  /** Row k (entries k·n to k·n + n − 1) is eigenfunction k, M-orthonormal. */
  readonly vectors: Float64Array;
}

/** Full spectrum of L φ = λ M φ for a stiffness matrix and a positive lumped mass. */
export function laplacianSpectrum(stiffness: CsrMatrix, mass: Float64Array): LaplacianSpectrum {
  const n = stiffness.rows;
  if (stiffness.cols !== n || mass.length !== n) {
    throw new RangeError(`need a square stiffness matrix and ${n} masses`);
  }
  if (n > DENSE_EIGEN_LIMIT) {
    throw new RangeError(
      `${n} vertices exceeds the dense eigensolver limit of ${DENSE_EIGEN_LIMIT}`,
    );
  }
  const scale = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!(mass[i] > 0)) throw new RangeError(`mass of vertex ${i} must be positive`);
    scale[i] = 1 / Math.sqrt(mass[i]);
  }
  const a = new Float64Array(n * n);
  for (const [i, j, x] of stiffness.entries()) a[i * n + j] = scale[i] * x * scale[j];
  const { values, vectors } = symmetricEigen(a, n);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) vectors[k * n + i] *= scale[i];
  }
  return { values, vectors };
}

/** Heat trace Z(t) = Σ_k exp(−λ_k t). */
export function heatTrace(eigenvalues: Float64Array, t: number): number {
  let z = 0;
  for (const lambda of eigenvalues) z += Math.exp(-lambda * t);
  return z;
}

/**
 * Spectral dimension d(t) = −2 d ln Z / d ln t = 2t Σ λ e^{−λt} / Σ e^{−λt},
 * evaluated exactly from the eigenvalues rather than by differencing.
 *
 * On a smooth surface d(t) → 2 as t → 0. On a mesh it falls back to 0 at both
 * ends: for t well below h² there are no eigenvalues left to resolve the
 * diffusion (the mesh has only n of them), and for large t only the constant
 * mode survives.
 */
export function spectralDimension(eigenvalues: Float64Array, t: number): number {
  let z = 0;
  let weighted = 0;
  for (const lambda of eigenvalues) {
    const w = Math.exp(-lambda * t);
    z += w;
    weighted += lambda * w;
  }
  return (2 * t * weighted) / z;
}

/**
 * Heat trace of the Neumann Laplacian on a square of the given side, whose
 * eigenvalues are (π/side)²(m² + k²) for m, k ≥ 0. Z(t) = θ(t)² with
 * θ(t) = Σ_{m≥0} exp(−(πm/side)² t); for small t, θ uses the Jacobi theta
 * transformation, which converges quickly there:
 *
 *     θ(t) = 1/2 + (side / (2 sqrt(π t))) · (1 + 2 Σ_{k≥1} exp(−k² side² / t)).
 */
export function squareNeumannHeatTrace(t: number, side = 1): number {
  if (!(t > 0) || !(side > 0)) throw new RangeError('t and side must be positive');
  const x = (Math.PI * Math.PI * t) / (side * side);
  let theta: number;
  if (x >= 1) {
    theta = 0;
    for (let m = 0; ; m++) {
      const term = Math.exp(-m * m * x);
      theta += term;
      if (term < 1e-17 * theta) break;
    }
  } else {
    let sum = 1;
    for (let k = 1; ; k++) {
      const term = 2 * Math.exp((-k * k * side * side) / t);
      sum += term;
      if (term < 1e-17 * sum) break;
    }
    theta = 0.5 + (side / (2 * Math.sqrt(Math.PI * t))) * sum;
  }
  return theta * theta;
}
