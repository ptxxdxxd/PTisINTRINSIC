import { describe, expect, it } from 'vitest';
import { colorAt, colorRamp, cssGradient } from '../../src/app/colormap.ts';
import { FIELDS, contourStep, fieldRange } from '../../src/app/fields.ts';
import {
  EIGENFUNCTIONS_KEPT,
  PRESETS,
  Session,
  coneSectors,
  weylCount,
  type SurfaceKind,
} from '../../src/app/model.ts';
import { ComputeService } from '../../src/app/protocol.ts';
import { squareNeumannHeatTrace } from '../../src/core/index.ts';

const kinds = Object.keys(PRESETS) as SurfaceKind[];
const small = (kind: SurfaceKind) => {
  const spec = PRESETS[kind].spec;
  return spec.kind === 'cone' ? { ...spec, rings: 6 } : { ...spec, resolution: 8 };
};

describe('Session', () => {
  it.each(kinds)(
    'builds the %s preset with consistent fields and a closed Gauss–Bonnet sum',
    (kind) => {
      const { summary, fields, drawing } = new Session(PRESETS[kind].spec, 'input');
      const n = summary.vertices;
      expect(drawing.positions).toHaveLength(3 * n);
      expect(drawing.faces).toHaveLength(3 * summary.faces);
      expect(drawing.edges).toHaveLength(2 * summary.edges);
      expect(summary.vertices - summary.edges + summary.faces).toBe(summary.eulerCharacteristic);
      expect(summary.eulerCharacteristic).toBe(1);
      expect(summary.boundaryLoops).toBe(1);
      expect(Math.abs(summary.gaussBonnetResidual)).toBeLessThan(1e-10);
      expect(summary.totalCurvature).toBeCloseTo(2 * Math.PI, 9);
      expect(summary.spectrumAvailable).toBe(true);
      for (let v = 0; v < n; v++) {
        // Pointwise curvature exists exactly at interior vertices.
        expect(Number.isNaN(fields.gaussian[v])).toBe(fields.boundary[v] === 1);
        expect(fields.area[v]).toBeGreaterThan(0);
        if (!Number.isNaN(fields.error[v])) {
          expect(fields.error[v]).toBe(fields.gaussian[v] - fields.exact[v]);
        }
      }
      expect(fields.area.reduce((a, b) => a + b)).toBeCloseTo(summary.area, 10);
      expect(drawing.lengthsMatchPositions).toBe(kind !== 'cone');
    },
  );

  it('reports the flat square as flat and the cone as flat away from its apex', () => {
    const flat = new Session(PRESETS.plane.spec, 'input').summary;
    expect(flat.maxCurvatureError).toBeLessThan(1e-9);
    expect(flat.apex).toBeNull();
    expect(flat.area).toBeCloseTo(4, 12);

    const session = new Session(PRESETS.cone.spec, 'input');
    expect(session.summary.apex?.computed).toBeCloseTo(1.2, 12);
    expect(session.summary.apex?.exact).toBe(1.2);
    expect(session.summary.maxCurvatureError).toBeLessThan(1e-9);
    expect(Number.isNaN(session.fields.exact[0])).toBe(true);
    expect(session.summary.vertices).toBe(1 + 14 * coneSectors(14));
  });

  it('computes on the intrinsic Delaunay triangulation without changing the surface', () => {
    const spec = PRESETS.cap.spec;
    const input = new Session(spec, 'input');
    const flipped = new Session(spec, 'delaunay');
    expect(input.summary.flips).toBe(0);
    expect(input.summary.nonDelaunay).toBe(input.summary.nonDelaunayInput);
    expect(input.summary.nonDelaunayInput).toBeGreaterThan(0);
    expect(input.summary.smallestCotanWeight).toBeLessThan(0);

    expect(flipped.summary.flips).toBeGreaterThan(0);
    expect(flipped.summary.nonDelaunay).toBe(0);
    expect(flipped.summary.nonDelaunayInput).toBe(input.summary.nonDelaunayInput);
    expect(flipped.summary.smallestCotanWeight).toBeGreaterThan(-1e-12);
    expect(flipped.summary.area).toBeCloseTo(input.summary.area, 12);
    // Same picture, same integrated curvature at every vertex.
    expect(flipped.drawing.faces).toEqual(input.drawing.faces);
    for (let v = 0; v < input.summary.vertices; v++) {
      expect(flipped.fields.angleDefect[v]).toBeCloseTo(input.fields.angleDefect[v], 12);
    }
  });

  it('measures distance from one or several sources and reuses the factorization', () => {
    const session = new Session(small('saddle'), 'delaunay');
    const one = session.distance([40]);
    expect(one[40]).toBe(0);
    expect(Math.max(...one)).toBeGreaterThan(1);
    const two = session.distance([0, 80]);
    expect(Math.abs(two[0] + two[80])).toBeLessThan(1e-12);
    expect(() => session.distance([999])).toThrow(/not a vertex/);
  });

  it('computes the spectrum once, with the continuum curves for the square only', () => {
    const session = new Session(small('plane'), 'input');
    const spectrum = session.spectrum();
    expect(session.spectrum()).toBe(spectrum);
    const n = session.summary.vertices;
    expect(spectrum.values).toHaveLength(n);
    expect(Math.abs(spectrum.values[0])).toBeLessThan(1e-9);
    // The square has side 2: its first non-zero eigenvalue is (π/2)².
    // On this coarse jittered 9 × 9 grid the mesh value is 2.3% low.
    expect(spectrum.values[1] / (Math.PI / 2) ** 2).toBeGreaterThan(0.95);
    expect(spectrum.values[1] / (Math.PI / 2) ** 2).toBeLessThan(1);
    expect(spectrum.vectors).toHaveLength(EIGENFUNCTIONS_KEPT);
    expect(spectrum.vectors[1]).toHaveLength(n);
    expect(spectrum.area).toBeCloseTo(4, 12);
    expect(spectrum.perimeter).toBeCloseTo(8, 12);

    const last = spectrum.times.length - 1;
    expect(spectrum.times[0]).toBeCloseTo(0.25 * session.summary.meanEdgeLength ** 2, 12);
    expect(spectrum.times[last]).toBeCloseTo(4, 12);
    expect(spectrum.trace[0]).toBeGreaterThan(spectrum.trace[last]);
    expect(spectrum.trace[last]).toBeGreaterThan(1);
    expect(spectrum.exactTrace?.[last]).toBe(squareNeumannHeatTrace(4, 2));
    // In between, the continuum square is two-dimensional to the heat kernel
    // up to its boundary term; at t equal to the area almost nothing is left.
    const middle = spectrum.exactDimension ?? new Float64Array();
    expect(middle[0]).toBeGreaterThan(1.5);
    expect(middle[0]).toBeLessThan(2);
    expect(middle[last]).toBeLessThan(0.1);
    expect(spectrum.milliseconds).toBeGreaterThan(0);

    const curved = new Session(small('bump'), 'input').spectrum();
    expect(curved.exactTrace).toBeNull();
    expect(curved.exactDimension).toBeNull();
  });

  it('refuses a spectrum beyond the dense limit', () => {
    const big = new Session({ kind: 'plane', resolution: 34, jitter: 0, seed: 1 }, 'input');
    expect(big.summary.spectrumAvailable).toBe(false);
    expect(() => big.spectrum()).toThrow(RangeError);
  });
});

describe('weylCount', () => {
  it('counts the square’s eigenvalues to within its lattice-point error', () => {
    // Neumann eigenvalues of the side-2 square are (π/2)²(m² + n²), m, n ≥ 0.
    const exact = (lambda: number) => {
      let count = 0;
      for (let m = 0; m < 200; m++) {
        for (let n = 0; n < 200; n++) if ((Math.PI / 2) ** 2 * (m * m + n * n) <= lambda) count++;
      }
      return count;
    };
    for (const lambda of [200, 1000, 5000]) {
      const law = weylCount(lambda, 4, 8);
      expect(Math.abs(exact(lambda) - law) / law).toBeLessThan(0.03);
      // Without the boundary term the law undercounts by much more.
      expect(exact(lambda) - weylCount(lambda, 4, 0)).toBeGreaterThan(
        0.5 * (law - weylCount(lambda, 4, 0)),
      );
    }
  });
});

describe('ComputeService', () => {
  it('answers build, distance and spectrum requests and reports errors', () => {
    const service = new ComputeService();
    const early = service.handle({ id: 1, type: 'spectrum' });
    expect(early).toEqual({ id: 1, type: 'error', message: 'no surface has been built yet' });

    const built = service.handle({
      id: 2,
      type: 'build',
      spec: small('bump'),
      triangulation: 'input',
    });
    expect(built.type).toBe('built');
    expect(built.id).toBe(2);
    const distance = service.handle({ id: 3, type: 'distance', sources: [0] });
    expect(distance.type === 'distance' && distance.values[0]).toBe(0);
    const spectrum = service.handle({ id: 4, type: 'spectrum' });
    expect(spectrum.type === 'spectrum' && spectrum.spectrum.values).toHaveLength(81);

    const bad = service.handle({ id: 5, type: 'distance', sources: [] });
    expect(bad).toEqual({ id: 5, type: 'error', message: 'need at least one source vertex' });
    const invalid = service.handle({
      id: 6,
      type: 'build',
      spec: { kind: 'cap', resolution: 8, jitter: 0, seed: 1, radius: 1 },
      triangulation: 'input',
    });
    expect(invalid.type === 'error' && invalid.message).toMatch(/radius must be/);
  });
});

describe('fields and colours', () => {
  it('centres signed fields on zero and spans the others', () => {
    expect(fieldRange(Float64Array.of(NaN, -1, 3), 'diverging')).toEqual([-3, 3]);
    expect(fieldRange(Float64Array.of(NaN, 2, 5), 'sequential')).toEqual([2, 5]);
    expect(fieldRange(Float64Array.of(7, 7), 'sequential')).toEqual([7, 8]);
    expect(fieldRange(Float64Array.of(0, 0), 'diverging')).toEqual([-1, 1]);
    expect(fieldRange(Float64Array.of(NaN), 'sequential')).toEqual([0, 1]);
    expect(Object.keys(FIELDS)).toHaveLength(7);
  });

  it('picks round contour spacings', () => {
    expect(contourStep([0, 2.5])).toBeCloseTo(0.2, 12);
    expect(contourStep([0, 14])).toBe(1);
    expect(contourStep([-3, 3], 6)).toBe(1);
    expect(contourStep([1, 1])).toBe(0);
  });

  it('keeps the sequential map rising in brightness and the diverging map neutral at zero', () => {
    const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let previous = -1;
    for (let k = 0; k <= 50; k++) {
      const now = luminance(colorAt('sequential', k / 50));
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
    const [r, g, b] = colorAt('diverging', 0.5);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(colorAt('diverging', 0)[2]).toBeGreaterThan(colorAt('diverging', 0)[0]);
    expect(colorAt('diverging', 1)[0]).toBeGreaterThan(colorAt('diverging', 1)[2]);
    expect(colorAt('sequential', -5)).toEqual(colorAt('sequential', 0));
    for (const map of ['sequential', 'diverging'] as const) {
      for (let k = 0; k <= 20; k++) {
        for (const c of colorAt(map, k / 20)) expect(c >= 0 && c <= 1).toBe(true);
      }
    }
    const ramp = colorRamp('diverging', 3);
    expect(Array.from(ramp)).toEqual([59, 77, 191, 255, 237, 237, 237, 255, 181, 5, 38, 255]);
    expect(cssGradient('diverging', 2)).toBe(
      'linear-gradient(to right, rgb(59 77 191), rgb(181 5 38))',
    );
  });
});
