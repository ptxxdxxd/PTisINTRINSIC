import { describe, expect, it } from 'vitest';
import {
  CsrMatrix,
  DENSE_EIGEN_LIMIT,
  cotanLaplacian,
  gaussianBump,
  heatTrace,
  laplacianSpectrum,
  plane,
  spectralDimension,
  squareNeumannHeatTrace,
  vertexAreas,
} from '../../src/core/index.ts';

/** Spectrum of the unit square: the [-1, 1]² grid with lengths halved. */
function unitSquareSpectrum(n: number) {
  const s = plane({ resolution: n });
  const lengths = s.lengths.map((l) => l / 2);
  return laplacianSpectrum(
    cotanLaplacian(s.mesh, lengths),
    vertexAreas(s.mesh, lengths, 'barycentric'),
  );
}

// Neumann eigenvalues of the unit square, π²(m² + k²), in ascending order.
const EXACT = [0, 1, 1, 2, 4, 4, 5, 5, 8, 9, 9].map((k) => k * Math.PI * Math.PI);

describe('laplacianSpectrum', () => {
  it('returns M-orthonormal eigenfunctions with L φ = λ M φ', () => {
    const s = gaussianBump({ resolution: 8, height: 0.5, width: 0.4 });
    const stiffness = cotanLaplacian(s.mesh, s.lengths);
    const mass = vertexAreas(s.mesh, s.lengths, 'barycentric');
    const { values, vectors } = laplacianSpectrum(stiffness, mass);
    const n = mass.length;
    const scale = values[n - 1];
    for (let k = 0; k < n; k++) {
      const phi = vectors.subarray(k * n, (k + 1) * n);
      const lphi = stiffness.multiply(Float64Array.from(phi));
      for (let i = 0; i < n; i++) {
        expect(Math.abs(lphi[i] - values[k] * mass[i] * phi[i])).toBeLessThan(1e-12 * scale);
      }
      for (const l of [0, k, n - 1]) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += phi[i] * mass[i] * vectors[l * n + i];
        expect(Math.abs(dot - (l === k ? 1 : 0))).toBeLessThan(1e-11);
      }
    }
    // The constant function is the zero mode.
    expect(Math.abs(values[0])).toBeLessThan(1e-12 * scale);
  });

  it('converges at second order to the unit square Neumann eigenvalues', () => {
    // Measured orders between n = 12 and 24: 1.98 to 2.04 (docs/results.md).
    const coarse = unitSquareSpectrum(12).values;
    const fine = unitSquareSpectrum(24).values;
    for (let k = 1; k < EXACT.length; k++) {
      const order = Math.log2(Math.abs(coarse[k] - EXACT[k]) / Math.abs(fine[k] - EXACT[k]));
      expect(order, `λ${k}`).toBeGreaterThan(1.8);
      expect(Math.abs(fine[k] - EXACT[k]) / EXACT[k]).toBeLessThan(0.02);
    }
  });

  it('rejects bad input and meshes beyond the dense limit', () => {
    const identity = CsrMatrix.fromTriplets(2, 2, [0, 1], [0, 1], [1, 1]);
    expect(() => laplacianSpectrum(identity, Float64Array.of(1))).toThrow(RangeError);
    expect(() => laplacianSpectrum(identity, Float64Array.of(1, 0))).toThrow(/positive/);
    const big = DENSE_EIGEN_LIMIT + 1;
    const huge = CsrMatrix.fromTriplets(big, big, [], [], []);
    expect(() => laplacianSpectrum(huge, new Float64Array(big).fill(1))).toThrow(/limit/);
  });
});

describe('heat trace', () => {
  it('approaches the continuum trace of the unit square under refinement', () => {
    // At diffusion times well above h², the mesh trace converges to the exact
    // one; below h² the mesh runs out of eigenvalues, so those are not tested.
    const coarse = unitSquareSpectrum(12).values;
    const fine = unitSquareSpectrum(24).values;
    for (const t of [0.03, 0.1, 0.3]) {
      const exact = squareNeumannHeatTrace(t);
      const errorCoarse = Math.abs(heatTrace(coarse, t) / exact - 1);
      const errorFine = Math.abs(heatTrace(fine, t) / exact - 1);
      expect(errorFine, `t = ${t}`).toBeLessThan(errorCoarse / 3);
      expect(errorFine).toBeLessThan(0.01);
    }
  });

  it('computes the spectral dimension as −2 d ln Z / d ln t', () => {
    const values = unitSquareSpectrum(8).values;
    for (const t of [1e-3, 1e-2, 0.1, 1]) {
      const h = 1e-5;
      const numeric =
        (-2 *
          (Math.log(heatTrace(values, t * (1 + h))) - Math.log(heatTrace(values, t * (1 - h))))) /
        (Math.log(1 + h) - Math.log(1 - h));
      expect(spectralDimension(values, t)).toBeCloseTo(numeric, 6);
    }
    // A finite mesh looks zero-dimensional at both ends of the scale.
    expect(spectralDimension(values, 1e-7)).toBeLessThan(0.01);
    expect(spectralDimension(values, 10)).toBeLessThan(1e-6);
  });
});

describe('squareNeumannHeatTrace', () => {
  it('agrees with direct summation where both series apply', () => {
    for (const t of [0.05, 0.1, 1 / (Math.PI * Math.PI), 0.2, 1]) {
      let theta = 0;
      for (let m = 0; m < 200; m++) theta += Math.exp(-m * m * Math.PI * Math.PI * t);
      expect(squareNeumannHeatTrace(t)).toBeCloseTo(theta * theta, 13);
    }
  });

  it('matches the small-time expansion A/(4πt) + P/(8√(πt)) + 1/4', () => {
    // For the unit square A = 1 and P = 4; the four right-angle corners give
    // 1/4. Every other term is exponentially small.
    for (const t of [1e-2, 1e-3, 1e-4, 1e-6]) {
      const expansion = 1 / (4 * Math.PI * t) + 1 / (2 * Math.sqrt(Math.PI * t)) + 0.25;
      expect(squareNeumannHeatTrace(t) / expansion - 1).toBeCloseTo(0, 13);
    }
  });

  it('scales with the side length and tends to 1', () => {
    expect(squareNeumannHeatTrace(0.4, 2)).toBeCloseTo(squareNeumannHeatTrace(0.1, 1), 13);
    expect(squareNeumannHeatTrace(50)).toBeCloseTo(1, 13);
    expect(() => squareNeumannHeatTrace(0)).toThrow(RangeError);
    expect(() => squareNeumannHeatTrace(1, -1)).toThrow(RangeError);
  });
});
