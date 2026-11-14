/**
 * Everything the page shows, computed from a surface description. Pure
 * functions and one stateful Session, with no browser APIs, so the same code
 * runs in the worker and under Vitest.
 */
import {
  DENSE_EIGEN_LIMIT,
  HeatMethod,
  compensatedSum,
  cone,
  cornerAngles,
  cotanLaplacian,
  cotanWeights,
  faceAreas,
  gaussBonnetResidual,
  gaussianBump,
  gaussianCurvature,
  intrinsicDelaunay,
  laplacianSpectrum,
  nonDelaunayEdges,
  plane,
  saddle,
  spectralDimension,
  heatTrace,
  sphericalCap,
  squareNeumannHeatTrace,
  vertexAreas,
  vertexCurvature,
  type Surface,
  type TriangleMesh,
} from '../core/index.ts';

interface Grid {
  /** Cells per side. */
  readonly resolution: number;
  /** Random in-plane displacement, as a fraction of the cell size. */
  readonly jitter: number;
  readonly seed: number;
}

export type SurfaceSpec =
  | ({ readonly kind: 'plane' } & Grid)
  | ({ readonly kind: 'bump'; readonly height: number; readonly width: number } & Grid)
  | ({ readonly kind: 'saddle'; readonly bend: number } & Grid)
  | ({ readonly kind: 'cap'; readonly radius: number } & Grid)
  | { readonly kind: 'cone'; readonly rings: number; readonly deficit: number };

export type SurfaceKind = SurfaceSpec['kind'];

/** 'input' computes on the mesh as generated; 'delaunay' on its intrinsic Delaunay triangulation. */
export type Triangulation = 'input' | 'delaunay';

export const PRESETS: Readonly<Record<SurfaceKind, { label: string; spec: SurfaceSpec }>> = {
  bump: {
    label: 'Gaussian bump',
    spec: { kind: 'bump', resolution: 24, jitter: 0, seed: 1, height: 0.6, width: 0.45 },
  },
  saddle: {
    label: 'Saddle',
    spec: { kind: 'saddle', resolution: 24, jitter: 0, seed: 1, bend: 0.6 },
  },
  cap: {
    label: 'Spherical cap',
    spec: { kind: 'cap', resolution: 24, jitter: 0, seed: 1, radius: 2 },
  },
  cone: { label: 'Cone', spec: { kind: 'cone', rings: 14, deficit: 1.2 } },
  plane: { label: 'Flat square', spec: { kind: 'plane', resolution: 24, jitter: 0.15, seed: 1 } },
};

/** The cone has twice as many vertices around as rings outwards. */
export const coneSectors = (rings: number): number => 2 * rings;

export function createSurface(spec: SurfaceSpec): Surface {
  switch (spec.kind) {
    case 'plane':
      return plane(spec);
    case 'bump':
      return gaussianBump(spec);
    case 'saddle':
      return saddle(spec);
    case 'cap':
      return sphericalCap(spec);
    case 'cone':
      return cone({ deficit: spec.deficit, rings: spec.rings, sectors: coneSectors(spec.rings) });
  }
}

/** What the viewport draws: always the mesh as generated, whichever triangulation is computed on. */
export interface Drawing {
  readonly positions: Float64Array;
  readonly faces: Uint32Array;
  /** Vertex pairs. */
  readonly edges: Uint32Array;
  /** False for the cone: its lengths are exact for the intrinsic cone, its positions only a picture. */
  readonly lengthsMatchPositions: boolean;
}

/** Per-vertex values. NaN marks vertices where a quantity is not defined. */
export interface Fields {
  /** 2π minus the angle sum inside, π minus it on the boundary: curvature integrated over the vertex. */
  readonly angleDefect: Float64Array;
  /** Angle defect divided by the vertex area; NaN on the boundary. */
  readonly gaussian: Float64Array;
  /** Gaussian curvature of the smooth surface; NaN on the boundary and at a cone's apex. */
  readonly exact: Float64Array;
  /** gaussian − exact. */
  readonly error: Float64Array;
  /** Mixed Voronoi area of each vertex. */
  readonly area: Float64Array;
  readonly degree: Uint16Array;
  readonly boundary: Uint8Array;
}

export interface Summary {
  readonly vertices: number;
  readonly edges: number;
  readonly faces: number;
  readonly boundaryLoops: number;
  readonly eulerCharacteristic: number;
  readonly area: number;
  readonly meanEdgeLength: number;
  /** Σ angle defects, its exact value 2πχ, and the difference. */
  readonly totalCurvature: number;
  readonly gaussBonnetTarget: number;
  readonly gaussBonnetResidual: number;
  /** Edges of the generated mesh that are not Delaunay, and flips performed (0 for 'input'). */
  readonly nonDelaunayInput: number;
  readonly flips: number;
  /** On the triangulation computed on. */
  readonly nonDelaunay: number;
  readonly smallestCotanWeight: number;
  /** Largest and root-mean-square |gaussian − exact| over the vertices where both exist. */
  readonly maxCurvatureError: number;
  readonly rmsCurvatureError: number;
  /** Cone only: the apex defect computed and prescribed. */
  readonly apex: { readonly computed: number; readonly exact: number } | null;
  readonly spectrumAvailable: boolean;
  /** Wall-clock milliseconds of each stage, as measured in this run. */
  readonly timings: {
    readonly generate: number;
    readonly flip: number;
    readonly curvature: number;
  };
}

export interface SpectrumData {
  /** All eigenvalues of L φ = λ M φ, ascending. */
  readonly values: Float64Array;
  /** The first eigenfunctions, M-orthonormal. */
  readonly vectors: Float64Array[];
  readonly area: number;
  readonly perimeter: number;
  /** Heat trace Z(t) = Σ exp(−λ t) and spectral dimension −2 d ln Z / d ln t on a log grid of t. */
  readonly times: Float64Array;
  readonly trace: Float64Array;
  readonly dimension: Float64Array;
  /** The same two curves for the continuum square; only for the flat square. */
  readonly exactTrace: Float64Array | null;
  readonly exactDimension: Float64Array | null;
  readonly milliseconds: number;
}

export const EIGENFUNCTIONS_KEPT = 16;
const HEAT_SAMPLES = 61;

export class Session {
  readonly drawing: Drawing;
  readonly fields: Fields;
  readonly summary: Summary;
  private readonly spec: SurfaceSpec;
  private readonly mesh: TriangleMesh;
  private readonly lengths: Float64Array;
  private readonly perimeter: number;
  private heat: HeatMethod | null = null;
  private spectrumCache: SpectrumData | null = null;

  constructor(spec: SurfaceSpec, triangulation: Triangulation) {
    this.spec = spec;
    let clock = performance.now();
    const lap = () => {
      const now = performance.now();
      const elapsed = now - clock;
      clock = now;
      return elapsed;
    };
    const surface = createSurface(spec);
    const generate = lap();

    const input = surface.mesh;
    const nonDelaunayInput = nonDelaunayEdges(input, surface.lengths).length;
    const flipped = triangulation === 'delaunay' ? intrinsicDelaunay(input, surface.lengths) : null;
    const mesh = flipped?.mesh ?? input;
    const lengths = flipped?.lengths ?? surface.lengths;
    const flip = lap();
    this.mesh = mesh;
    this.lengths = lengths;

    const n = mesh.vertexCount;
    const angleDefect = vertexCurvature(mesh, cornerAngles(mesh, lengths));
    const area = vertexAreas(mesh, lengths, 'mixed');
    const gaussian = gaussianCurvature(mesh, angleDefect, area);
    const boundary = Uint8Array.from({ length: n }, (_, v) => Number(mesh.isBoundaryVertex(v)));
    const exact = new Float64Array(n).fill(NaN);
    if (surface.exact.kind === 'pointwise') {
      for (let v = 0; v < n; v++) if (boundary[v] === 0) exact[v] = surface.exact.gaussian[v];
    } else {
      for (let v = 0; v < n; v++) if (boundary[v] === 0 && v !== surface.exact.apex) exact[v] = 0;
    }
    const error = Float64Array.from(gaussian, (k, v) => k - exact[v]);
    let worst = 0;
    let squares = 0;
    let compared = 0;
    for (const e of error) {
      if (Number.isNaN(e)) continue;
      worst = Math.max(worst, Math.abs(e));
      squares += e * e;
      compared++;
    }
    const curvature = lap();

    const drawEdges = new Uint32Array(2 * input.edgeCount);
    for (let e = 0; e < input.edgeCount; e++) drawEdges.set(input.edgeVertices(e), 2 * e);
    this.drawing = {
      positions: surface.positions,
      faces: Uint32Array.from(input.halfedgeVertex),
      edges: drawEdges,
      lengthsMatchPositions: surface.lengthsMatchPositions,
    };
    this.fields = {
      angleDefect,
      gaussian,
      exact,
      error,
      area,
      degree: Uint16Array.from({ length: n }, (_, v) => mesh.outgoingHalfedges(v).length),
      boundary,
    };

    let perimeter = 0;
    for (let e = 0; e < mesh.edgeCount; e++) if (mesh.isBoundaryEdge(e)) perimeter += lengths[e];
    this.perimeter = perimeter;
    const residual = gaussBonnetResidual(mesh, angleDefect);
    const target = 2 * Math.PI * mesh.eulerCharacteristic();
    this.summary = {
      vertices: n,
      edges: mesh.edgeCount,
      faces: mesh.faceCount,
      boundaryLoops: mesh.boundaryLoops().length,
      eulerCharacteristic: mesh.eulerCharacteristic(),
      area: compensatedSum(faceAreas(mesh, lengths)),
      meanEdgeLength: compensatedSum(lengths) / mesh.edgeCount,
      totalCurvature: target + residual,
      gaussBonnetTarget: target,
      gaussBonnetResidual: residual,
      nonDelaunayInput,
      flips: flipped?.flips ?? 0,
      nonDelaunay: flipped === null ? nonDelaunayInput : nonDelaunayEdges(mesh, lengths).length,
      smallestCotanWeight: Math.min(...cotanWeights(mesh, lengths)),
      maxCurvatureError: worst,
      rmsCurvatureError: compared === 0 ? 0 : Math.sqrt(squares / compared),
      apex:
        surface.exact.kind === 'cone'
          ? { computed: angleDefect[surface.exact.apex], exact: surface.exact.apexDefect }
          : null,
      spectrumAvailable: n <= DENSE_EIGEN_LIMIT,
      timings: { generate, flip, curvature },
    };
  }

  /** Heat-method distance from the given vertices. The factorization is kept for later calls. */
  distance(sources: readonly number[]): Float64Array {
    this.heat ??= new HeatMethod(this.mesh, this.lengths);
    return this.heat.distance(sources);
  }

  /** Full spectrum by a dense eigensolve; cached. Throws RangeError above DENSE_EIGEN_LIMIT vertices. */
  spectrum(): SpectrumData {
    if (this.spectrumCache !== null) return this.spectrumCache;
    const start = performance.now();
    const { mesh, lengths, summary } = this;
    const n = mesh.vertexCount;
    const { values, vectors } = laplacianSpectrum(
      cotanLaplacian(mesh, lengths),
      vertexAreas(mesh, lengths, 'barycentric'),
    );

    // From a quarter of the squared edge length (below it the mesh resolves
    // nothing) to the area (beyond it only the constant mode is left).
    const first = 0.25 * summary.meanEdgeLength ** 2;
    const times = Float64Array.from(
      { length: HEAT_SAMPLES },
      (_, k) => first * (summary.area / first) ** (k / (HEAT_SAMPLES - 1)),
    );
    const isSquare = this.spec.kind === 'plane';
    const step = 1e-4;
    const exactLog = (t: number) => Math.log(squareNeumannHeatTrace(t, 2));
    this.spectrumCache = {
      values,
      vectors: Array.from({ length: Math.min(EIGENFUNCTIONS_KEPT, n) }, (_, k) =>
        vectors.slice(k * n, (k + 1) * n),
      ),
      area: summary.area,
      perimeter: this.perimeter,
      times,
      trace: times.map((t) => heatTrace(values, t)),
      dimension: times.map((t) => spectralDimension(values, t)),
      exactTrace: isSquare ? times.map((t) => squareNeumannHeatTrace(t, 2)) : null,
      // −2 d ln Z / d ln t by a central difference in ln t.
      exactDimension: isSquare
        ? times.map((t) => -(exactLog(t * Math.exp(step)) - exactLog(t * Math.exp(-step))) / step)
        : null,
      milliseconds: performance.now() - start,
    };
    return this.spectrumCache;
  }
}

/**
 * Weyl's law with its boundary term for an insulated (Neumann) boundary: the
 * number of eigenvalues up to λ is about (A λ + P √λ) / 4π.
 */
export function weylCount(lambda: number, area: number, perimeter: number): number {
  return (area * lambda + perimeter * Math.sqrt(lambda)) / (4 * Math.PI);
}
