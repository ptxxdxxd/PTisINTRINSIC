import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  angleSums,
  compensatedSum,
  cone,
  cornerAngles,
  gaussBonnetResidual,
  gaussianBump,
  gaussianCurvature,
  plane,
  saddle,
  sphericalCap,
  vertexAreas,
  vertexCurvature,
  type Surface,
  type VertexAreaScheme,
} from '../../src/core/index.ts';
import {
  randomIntrinsicMetric,
  randomOpenSurface,
  randomSphere,
  randomTorus,
  type Metric,
} from '../support/random-surfaces.ts';

function curvatureOf({ mesh, lengths }: Pick<Metric, 'mesh' | 'lengths'>): Float64Array {
  return vertexCurvature(mesh, cornerAngles(mesh, lengths));
}

describe('discrete Gauss–Bonnet', () => {
  // 550 random meshes in total. The identity is exact in real arithmetic for
  // any valid metric, so the only error is floating-point rounding.
  const holds = (metric: Metric) => {
    const residual = gaussBonnetResidual(metric.mesh, curvatureOf(metric));
    expect(Math.abs(residual), metric.label).toBeLessThanOrEqual(1e-10);
  };

  it('holds on the library surfaces (χ = 1)', () => {
    fc.assert(fc.property(randomOpenSurface, holds), { numRuns: 200 });
  });

  it('holds on closed spheres (χ = 2)', () => {
    fc.assert(fc.property(randomSphere, holds), { numRuns: 150 });
  });

  it('holds on tori (χ = 0)', () => {
    fc.assert(fc.property(randomTorus, holds), { numRuns: 100 });
  });

  it('holds for metrics that come from no embedding', () => {
    fc.assert(fc.property(randomIntrinsicMetric, holds), { numRuns: 100 });
  });
});

describe('vertex curvature', () => {
  it('is zero inside a flat mesh and π/2 at its corners', () => {
    const s = plane({ resolution: 10, jitter: 0.2, seed: 11 });
    const k = curvatureOf(s);
    const n = 10;
    const corners = new Set([0, n, n * (n + 1), (n + 1) ** 2 - 1]);
    for (let v = 0; v < s.mesh.vertexCount; v++) {
      const expected = corners.has(v) ? Math.PI / 2 : 0;
      expect(Math.abs(k[v] - expected)).toBeLessThanOrEqual(1e-13);
    }
  });

  it('puts the whole deficit of a cone at its apex', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 2 * Math.PI - 0.01, noNaN: true }),
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 3, max: 32 }),
        (deficit, rings, sectors) => {
          const s = cone({ deficit, rings, sectors });
          const k = curvatureOf(s);
          expect(Math.abs(k[0] - deficit)).toBeLessThanOrEqual(1e-14);
          for (let v = 1; v < s.mesh.vertexCount; v++) {
            if (!s.mesh.isBoundaryVertex(v)) expect(Math.abs(k[v])).toBeLessThanOrEqual(1e-13);
          }
        },
      ),
    );
  });

  it('adds up the corner angles at each vertex', () => {
    const s = gaussianBump({ resolution: 6, height: 0.5, width: 0.4 });
    const angles = cornerAngles(s.mesh, s.lengths);
    const sums = angleSums(s.mesh, angles);
    const expected = new Float64Array(s.mesh.vertexCount);
    for (let h = 0; h < angles.length; h++) expected[s.mesh.halfedgeVertex[h]] += angles[h];
    for (let v = 0; v < sums.length; v++) expect(sums[v]).toBeCloseTo(expected[v], 14);
  });

  it('leaves the pointwise estimate undefined on the boundary', () => {
    const s = saddle({ resolution: 4, bend: 0.5 });
    const k = gaussianCurvature(s.mesh, curvatureOf(s), vertexAreas(s.mesh, s.lengths, 'mixed'));
    for (let v = 0; v < s.mesh.vertexCount; v++) {
      expect(Number.isNaN(k[v])).toBe(s.mesh.isBoundaryVertex(v));
    }
  });
});

describe('convergence to the smooth surface', () => {
  /** Largest pointwise error over interior vertices with |x|, |y| <= 0.75. */
  function pointwiseError(s: Surface, scheme: VertexAreaScheme): number {
    if (s.exact.kind !== 'pointwise') throw new Error('surface has no pointwise curvature');
    const k = gaussianCurvature(s.mesh, curvatureOf(s), vertexAreas(s.mesh, s.lengths, scheme));
    let worst = 0;
    for (let v = 0; v < s.mesh.vertexCount; v++) {
      const x = s.positions[3 * v];
      const y = s.positions[3 * v + 1];
      if (Math.max(Math.abs(x), Math.abs(y)) > 0.75) continue;
      worst = Math.max(worst, Math.abs(k[v] - s.exact.gaussian[v]));
    }
    return worst;
  }

  const surfaces = {
    bump: (n: number) => gaussianBump({ resolution: n, height: 0.5, width: 0.4 }),
    saddle: (n: number) => saddle({ resolution: n, bend: 0.5 }),
    'spherical cap': (n: number) => sphericalCap({ resolution: n, radius: 2 }),
  };

  // Measured orders between n = 32 and n = 64 are 1.93 to 2.01 (docs/results.md has the table).
  // The threshold sits below that so a change that breaks second-order
  // convergence fails, while rounding noise does not.
  it.each(
    Object.entries(surfaces).flatMap(([name, make]) =>
      (['barycentric', 'mixed'] as const).map((scheme) => [name, scheme, make] as const),
    ),
  )('converges at second order on a regular grid: %s, %s areas', (_name, scheme, make) => {
    const order = Math.log2(pointwiseError(make(32), scheme) / pointwiseError(make(64), scheme));
    expect(order).toBeGreaterThan(1.8);
  });

  it('converges in integrated form even on jittered meshes', () => {
    // Total curvature of the R = 2 cap above the disk r <= 0.6, against
    // 2π(1 − sqrt(1 − a²/R²)). Pointwise estimates do not converge on these
    // meshes (Borrelli, Cazals and Morvan 2003); sums over a region do.
    const radius = 2;
    const a = 0.6;
    const exact = 2 * Math.PI * (1 - Math.sqrt(1 - (a * a) / (radius * radius)));
    const error = (n: number, seed: number) => {
      const s = sphericalCap({ resolution: n, radius, jitter: 0.2, seed });
      const k = curvatureOf(s);
      const inside: number[] = [];
      for (let v = 0; v < s.mesh.vertexCount; v++) {
        if (Math.hypot(s.positions[3 * v], s.positions[3 * v + 1]) <= a) inside.push(k[v]);
      }
      return Math.abs(compensatedSum(inside) - exact);
    };
    for (const seed of [1, 2, 3]) {
      // At least first order: three halvings of h must cut the error by 8.
      expect(error(128, seed)).toBeLessThan(error(16, seed) / 8);
    }
  });
});
