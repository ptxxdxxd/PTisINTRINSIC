import fc from 'fast-check';
import {
  cone,
  edgeLengthsFromPositions,
  gaussianBump,
  plane,
  saddle,
  sphericalCap,
  type Surface,
  type TriangleMesh,
} from '../../src/core/index.ts';
import { ellipsoid, torus } from './closed-surfaces.ts';

export interface Metric {
  readonly label: string;
  readonly mesh: TriangleMesh;
  readonly lengths: Float64Array;
}

const resolution = fc.integer({ min: 1, max: 14 });
const jitter = fc.double({ min: 0, max: 0.2, noNaN: true });
const seed = fc.integer({ min: 0, max: 2 ** 31 });

const fromSurface = (label: string, s: Surface): Metric => ({
  label,
  mesh: s.mesh,
  lengths: s.lengths,
});

/** The library's surfaces, with random parameters. */
export const randomOpenSurface: fc.Arbitrary<Metric> = fc.oneof(
  fc.record({ resolution, jitter, seed }).map((o) => fromSurface('plane', plane(o))),
  fc
    .record({
      resolution,
      jitter,
      seed,
      height: fc.double({ min: -2, max: 2, noNaN: true }),
      width: fc.double({ min: 0.1, max: 2, noNaN: true }),
    })
    .map((o) => fromSurface('bump', gaussianBump(o))),
  fc
    .record({ resolution, jitter, seed, bend: fc.double({ min: -2, max: 2, noNaN: true }) })
    .map((o) => fromSurface('saddle', saddle(o))),
  fc
    .record({ resolution, jitter, seed, radius: fc.double({ min: 1.5, max: 20, noNaN: true }) })
    .map((o) => fromSurface('cap', sphericalCap(o))),
  fc
    .record({
      deficit: fc.double({ min: 0.01, max: 2 * Math.PI - 0.01, noNaN: true }),
      rings: fc.integer({ min: 1, max: 10 }),
      sectors: fc.integer({ min: 3, max: 24 }),
    })
    .map((o) => fromSurface('cone', cone(o))),
);

/** Ellipsoids with random axes and random radial noise: closed, χ = 2. */
export const randomSphere: fc.Arbitrary<Metric> = fc
  .record({
    rings: fc.integer({ min: 2, max: 10 }),
    sectors: fc.integer({ min: 3, max: 16 }),
    axes: fc.tuple(
      fc.double({ min: 0.2, max: 5, noNaN: true }),
      fc.double({ min: 0.2, max: 5, noNaN: true }),
      fc.double({ min: 0.2, max: 5, noNaN: true }),
    ),
    noise: fc.array(fc.double({ min: -0.2, max: 0.2, noNaN: true }), {
      minLength: 200,
      maxLength: 200,
    }),
  })
  .map(({ rings, sectors, axes, noise }) => {
    const { mesh, positions } = ellipsoid(rings, sectors, axes, (v) => noise[v % noise.length]);
    return { label: 'sphere', mesh, lengths: edgeLengthsFromPositions(mesh, positions) };
  });

/** Tori with random radii and resolution: closed, χ = 0. */
export const randomTorus: fc.Arbitrary<Metric> = fc
  .record({
    major: fc.double({ min: 1.5, max: 10, noNaN: true }),
    ratio: fc.double({ min: 0.05, max: 0.6, noNaN: true }),
    around: fc.integer({ min: 3, max: 20 }),
    tube: fc.integer({ min: 3, max: 12 }),
  })
  .map(({ major, ratio, around, tube }) => {
    const { mesh, positions } = torus(major, major * ratio, around, tube);
    return { label: 'torus', mesh, lengths: edgeLengthsFromPositions(mesh, positions) };
  });

/**
 * Metrics that come from no embedding at all: a flat grid whose edge lengths
 * are each scaled by an independent random factor in [0.9, 1.1]. On the grid's
 * right isosceles triangles that keeps every triangle inequality strict.
 */
export const randomIntrinsicMetric: fc.Arbitrary<Metric> = fc
  .record({
    resolution: fc.integer({ min: 1, max: 12 }),
    factors: fc.array(fc.double({ min: 0.9, max: 1.1, noNaN: true }), {
      minLength: 64,
      maxLength: 64,
    }),
  })
  .map(({ resolution: n, factors }) => {
    const { mesh, lengths } = plane({ resolution: n });
    const scaled = lengths.map((l, e) => l * factors[e % factors.length]);
    return { label: 'intrinsic', mesh, lengths: scaled };
  });
