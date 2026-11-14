import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HeatMethod,
  MeshError,
  TriangleMesh,
  cone,
  edgeLengthsFromPositions,
  gaussianBump,
  intrinsicDelaunay,
  plane,
  sphericalCap,
  type Surface,
} from '../../src/core/index.ts';
import { ellipsoid } from '../support/closed-surfaces.ts';
import { randomOpenSurface, randomSphere } from '../support/random-surfaces.ts';

interface Errors {
  readonly max: number;
  readonly mean: number;
}

function errors(distance: Float64Array, exact: (v: number) => number): Errors {
  let max = 0;
  let sum = 0;
  for (let v = 0; v < distance.length; v++) {
    const e = Math.abs(distance[v] - exact(v));
    max = Math.max(max, e);
    sum += e;
  }
  return { max, mean: sum / distance.length };
}

const point = (s: { positions: Float64Array }, v: number) => s.positions.subarray(3 * v, 3 * v + 3);

/** Great-circle distance between two points on a sphere centred at the origin. */
function greatCircle(p: ArrayLike<number>, q: ArrayLike<number>, radius: number): number {
  const cross = Math.hypot(
    p[1] * q[2] - p[2] * q[1],
    p[2] * q[0] - p[0] * q[2],
    p[0] * q[1] - p[1] * q[0],
  );
  return radius * Math.atan2(cross, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]);
}

/** Centre vertex of a grid surface with an even resolution. */
const centre = (n: number) => (n / 2) * (n + 1) + n / 2;

/** A 1 × m strip of unit squares: vertices 2k at (k, 0) and 2k + 1 at (k, 1). */
function strip(m: number): { mesh: TriangleMesh; lengths: Float64Array } {
  const faces: number[] = [];
  const positions = new Float64Array(6 * (m + 1));
  for (let k = 0; k <= m; k++) {
    positions.set([k, 0, 0, k, 1, 0], 6 * k);
    if (k < m) faces.push(2 * k, 2 * k + 2, 2 * k + 1, 2 * k + 1, 2 * k + 2, 2 * k + 3);
  }
  const mesh = TriangleMesh.fromFaces(2 * (m + 1), faces);
  return { mesh, lengths: edgeLengthsFromPositions(mesh, positions) };
}

describe('HeatMethod', () => {
  it('approaches Euclidean distance on the flat square under refinement', () => {
    // Measured mean errors from the centre: 4.5e-2, 2.6e-2, 1.6e-2 at
    // n = 8, 16, 32 (docs/results.md). This slow, roughly first-order
    // convergence is the general case; see the off-axis test below.
    const bounds = [0.05, 0.03, 0.018];
    let previous = Infinity;
    for (const [k, n] of [8, 16, 32].entries()) {
      const s = plane({ resolution: n });
      const d = new HeatMethod(s.mesh, s.lengths).distance([centre(n)]);
      const origin = point(s, centre(n));
      const { mean, max } = errors(d, (v) =>
        Math.hypot(point(s, v)[0] - origin[0], point(s, v)[1] - origin[1]),
      );
      expect(mean).toBeLessThan(bounds[k]);
      expect(mean).toBeLessThan(previous);
      expect(max).toBeLessThan(0.13);
      previous = mean;
    }
  });

  it('converges at second order from the apex of a cone, a symmetric special case', () => {
    // Measured max errors: 3.98e-3 and 9.95e-4 (order 2.00).
    const run = (rings: number, sectors: number) => {
      const s = cone({ deficit: 2, rings, sectors });
      const d = new HeatMethod(s.mesh, s.lengths).distance([0]);
      const ring = (v: number) => (v === 0 ? 0 : Math.floor((v - 1) / sectors + 1));
      // The mesh is symmetric under rotation, so each ring is at one distance.
      for (let v = 1; v + 1 < d.length; v++) {
        if (ring(v) === ring(v + 1)) expect(Math.abs(d[v] - d[v + 1])).toBeLessThan(1e-11);
      }
      return errors(d, (v) => ring(v) / rings).max;
    };
    const coarse = run(8, 24);
    const fine = run(16, 48);
    expect(fine).toBeLessThan(1.2e-3);
    expect(Math.log2(coarse / fine)).toBeGreaterThan(1.8);
  });

  it('converges at second order from the pole of the unit sphere, likewise symmetric', () => {
    // Measured max errors: 2.23e-2 and 5.60e-3 (order 1.99).
    const run = (n: number) => {
      const s = ellipsoid(n, 2 * n, [1, 1, 1]);
      const d = new HeatMethod(s.mesh, edgeLengthsFromPositions(s.mesh, s.positions)).distance([0]);
      return errors(d, (v) => greatCircle(point(s, v), point(s, 0), 1)).max;
    };
    const coarse = run(12);
    const fine = run(24);
    expect(fine).toBeLessThan(7e-3);
    expect(Math.log2(coarse / fine)).toBeGreaterThan(1.8);
  });

  it('converges at about first order from a general vertex', () => {
    // From the apex or a pole the problem is one-dimensional and the error
    // falls at second order. From any other vertex it does not. Measured
    // largest errors from an equator vertex of the sphere: 1.3e-1 and 8.5e-2.
    const run = (n: number) => {
      const s = ellipsoid(n, 2 * n, [1, 1, 1]);
      const source = 1 + Math.floor(n / 2 - 1) * 2 * n;
      const d = new HeatMethod(s.mesh, edgeLengthsFromPositions(s.mesh, s.positions)).distance([
        source,
      ]);
      return errors(d, (v) => greatCircle(point(s, v), point(s, source), 1)).max;
    };
    const coarse = run(12);
    const fine = run(24);
    expect(fine).toBeLessThan(coarse);
    expect(fine).toBeLessThan(0.1);
    expect(Math.log2(coarse / fine)).toBeLessThan(1.2);
  });

  it('is more accurate on the intrinsic Delaunay triangulation', () => {
    // A steep spherical cap: the grid triangles stretch towards the corners
    // and 512 edges are not Delaunay. Measured max errors: 0.155 as generated
    // (and growing under refinement), 0.051 after flipping.
    const radius = 1.6;
    const s = sphericalCap({ resolution: 32, radius });
    const onSphere = (v: number) => [point(s, v)[0], point(s, v)[1], point(s, v)[2] + radius];
    const exact = (v: number) => greatCircle(onSphere(v), onSphere(centre(32)), radius);
    const raw = new HeatMethod(s.mesh, s.lengths).distance([centre(32)]);
    const flipped = intrinsicDelaunay(s.mesh, s.lengths);
    const better = new HeatMethod(flipped.mesh, flipped.lengths).distance([centre(32)]);
    expect(flipped.flips).toBe(512);
    expect(errors(raw, exact).max).toBeGreaterThan(0.12);
    expect(errors(better, exact).max).toBeLessThan(0.06);
  });

  it('is exactly zero at a single source and finite everywhere', () => {
    fc.assert(
      fc.property(fc.oneof(randomOpenSurface, randomSphere), fc.nat(), (m, pick) => {
        const source = pick % m.mesh.vertexCount;
        const d = new HeatMethod(m.mesh, m.lengths).distance([source]);
        expect(d[source]).toBe(0);
        expect(d.every(Number.isFinite)).toBe(true);
        expect(Math.max(...d)).toBeGreaterThan(0);
      }),
      { numRuns: 60 },
    );
  });

  it('scales with the metric', () => {
    const s = gaussianBump({ resolution: 10, jitter: 0.1, seed: 5, height: 0.7, width: 0.6 });
    const d = new HeatMethod(s.mesh, s.lengths).distance([17]);
    const scaled = (k: number) =>
      new HeatMethod(
        s.mesh,
        s.lengths.map((x) => x * k),
      ).distance([17]);
    // A power of two changes no rounding, so the result scales exactly.
    for (const k of [2 ** 40, 2 ** -40]) {
      expect(Array.from(scaled(k))).toEqual(Array.from(d, (x) => x * k));
    }
    const tripled = scaled(3);
    for (let v = 0; v < d.length; v++) expect(Math.abs(tripled[v] / 3 - d[v])).toBeLessThan(1e-12);
  });

  it('measures from the nearest of several sources', () => {
    const s = plane({ resolution: 32 });
    const solver = new HeatMethod(s.mesh, s.lengths);
    const a = 0;
    const b = s.mesh.vertexCount - 1;
    const both = solver.distance([a, b]);
    // The shift puts the mean over the sources at zero.
    expect(Math.abs(both[a] + both[b])).toBeLessThan(1e-12);
    // Duplicates and order do not matter.
    expect(Array.from(solver.distance(new Set([b, a])))).toEqual(Array.from(both));
    expect(Array.from(solver.distance([a, b, a, a]))).toEqual(Array.from(both));
    // Close to the smaller of the two single-source distances; the heat step
    // rounds off the ridge between them (measured difference 0.10).
    const fromA = solver.distance([a]);
    const fromB = solver.distance([b]);
    for (let v = 0; v < both.length; v++) {
      expect(Math.abs(both[v] - Math.min(fromA[v], fromB[v]))).toBeLessThan(0.12);
    }
    // With every vertex a source the distance is zero.
    const all = solver.distance(Array.from({ length: s.mesh.vertexCount }, (_, v) => v));
    expect(all.every((x) => x === 0)).toBe(true);
  });

  it('ignores faces the heat reaches from all sides at once', () => {
    // From one vertex of a regular tetrahedron the opposite face is equally
    // far at all three corners, so u is constant there up to rounding.
    // Normalizing that rounding noise gave 0.76, 0.76 and 1.08 for three
    // vertices that symmetry makes equidistant. The value checked, √3/2, is
    // what the method returns on four vertices, not the distance (which is 1):
    // this mesh is far too coarse and the test is about symmetry only.
    const tetrahedron = TriangleMesh.fromFaces(4, [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2]);
    const d = new HeatMethod(tetrahedron, new Float64Array(6).fill(1)).distance([0]);
    expect(d[0]).toBe(0);
    for (const v of [1, 2, 3]) expect(d[v]).toBeCloseTo(Math.sqrt(3) / 2, 14);
  });

  it('works on a triangulation with loops and repeated vertices', () => {
    // The narrow bump from the Delaunay tests, whose intrinsic Delaunay
    // triangulation has a loop edge.
    const s = gaussianBump({
      resolution: 10,
      jitter: 0.15736119030043483,
      seed: 279462913,
      height: -1.4975862205028534,
      width: 0.13635363595094532,
    });
    const flipped = intrinsicDelaunay(s.mesh, s.lengths);
    const d = new HeatMethod(flipped.mesh, flipped.lengths).distance([0]);
    expect(d[0]).toBe(0);
    expect(d.every(Number.isFinite)).toBe(true);
    // Corner to corner across the square is 2√2 in the plane, more over the bump.
    expect(d[d.length - 1]).toBeGreaterThan(2.7);
    expect(d[d.length - 1]).toBeLessThan(3.2);
  });

  it('uses the squared mean edge length times the coefficient as its time step', () => {
    const mesh = TriangleMesh.fromFaces(3, [0, 1, 2]);
    const lengths = Float64Array.of(3, 4, 5);
    expect(new HeatMethod(mesh, lengths).time).toBe(16);
    expect(new HeatMethod(mesh, lengths, { timeCoefficient: 0.25 }).time).toBe(4);
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => new HeatMethod(mesh, lengths, { timeCoefficient: bad })).toThrow(RangeError);
    }
  });

  it('refuses to answer where the heat underflows, and a longer time step fixes it', () => {
    // Heat falls by a constant factor per edge. 1,000 unit squares in a row
    // take it below the smallest normal double; without the check the
    // distance stopped growing at 849.
    const s = strip(1000);
    expect(() => new HeatMethod(s.mesh, s.lengths).distance([0])).toThrow(
      /underflowed at \d+ vert/,
    );
    const d = new HeatMethod(s.mesh, s.lengths, { timeCoefficient: 100 }).distance([0]);
    expect(Math.abs(d[2000] - 1000)).toBeLessThan(0.5);
  });

  it('refuses a time step so long that the heat evens out', () => {
    // Unchecked, a coefficient of 1e13 gave a corner-to-corner distance of
    // 1.35 on the flat square (true 2.83), and 1e15 gave zero everywhere.
    const s = plane({ resolution: 16 });
    const solver = new HeatMethod(s.mesh, s.lengths, { timeCoefficient: 1e15 });
    expect(() => solver.distance([0])).toThrow(/constant to rounding on \d+ of 512 faces/);
    const fine = new HeatMethod(s.mesh, s.lengths, { timeCoefficient: 1e6 }).distance([0]);
    expect(fine[fine.length - 1]).toBeGreaterThan(2.5);
    expect(fine[fine.length - 1]).toBeLessThan(3.2);
  });

  it('rejects edge lengths that do not make triangles', () => {
    const mesh = TriangleMesh.fromFaces(3, [0, 1, 2]);
    expect(() => new HeatMethod(mesh, Float64Array.of(1, 2, 1))).toThrow(/degenerate/);
  });

  it('rejects bad sources and disconnected meshes', () => {
    const s: Surface = plane({ resolution: 2 });
    const solver = new HeatMethod(s.mesh, s.lengths);
    expect(() => solver.distance([])).toThrow(/at least one/);
    for (const bad of [-1, 9, 1.5, NaN]) expect(() => solver.distance([bad])).toThrow(RangeError);
    const two = TriangleMesh.fromFaces(6, [0, 1, 2, 3, 4, 5]);
    expect(() => new HeatMethod(two, new Float64Array(6).fill(1))).toThrow(MeshError);
    expect(() => new HeatMethod(two, new Float64Array(6).fill(1))).toThrow(/2 parts/);
  });
});
