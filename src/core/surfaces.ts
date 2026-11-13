/**
 * Test surfaces with known curvature.
 *
 * The height fields are graphs z = f(x, y) over the square [-1, 1]², sampled on
 * a regular grid whose cells are all split along the same diagonal (so every
 * interior vertex has six neighbours). Their edge lengths are the distances
 * between the sampled points, and the exact Gaussian curvature of the smooth
 * surface at each vertex is
 *
 *     K = (f_xx f_yy − f_xy²) / (1 + f_x² + f_y²)².
 *
 * The cone is built intrinsically: its edge lengths come from a flat sector of
 * angle 2π − deficit with its two straight sides glued, so every vertex except
 * the apex is exactly flat and the apex carries the whole deficit.
 */
import { edgeLengthsFromPositions } from './geometry.ts';
import { TriangleMesh } from './mesh.ts';
import { mulberry32 } from './random.ts';

export type KnownCurvature =
  | {
      /** Exact Gaussian curvature of the smooth surface at each vertex. */
      readonly kind: 'pointwise';
      readonly gaussian: Float64Array;
    }
  | {
      /** Flat everywhere except one vertex. */
      readonly kind: 'cone';
      readonly apex: number;
      readonly apexDefect: number;
    };

export interface Surface {
  readonly mesh: TriangleMesh;
  /** The metric: one length per edge. Every computation uses these. */
  readonly lengths: Float64Array;
  /** Vertex positions (xyz triples), used for drawing. */
  readonly positions: Float64Array;
  /** True when each edge length equals the distance between its endpoints in `positions`. */
  readonly lengthsMatchPositions: boolean;
  readonly exact: KnownCurvature;
}

export interface GridOptions {
  /** Cells per side; the grid has (resolution + 1)² vertices. */
  readonly resolution: number;
  /**
   * In-plane random displacement of interior vertices, as a fraction of the
   * cell size, in [0, 0.2]. Up to 0.2 no triangle can fold over.
   */
  readonly jitter?: number;
  readonly seed?: number;
}

/** Height and its first and second derivatives at (x, y): [f, fx, fy, fxx, fyy, fxy]. */
type HeightFunction = (
  x: number,
  y: number,
) => readonly [number, number, number, number, number, number];

export function plane(options: GridOptions): Surface {
  return heightField(options, () => [0, 0, 0, 0, 0, 0]);
}

/** z = height · exp(−(x² + y²) / (2 width²)). */
export function gaussianBump(
  options: GridOptions & { readonly height: number; readonly width: number },
): Surface {
  const { height, width } = options;
  requirePositive('width', width);
  requireFinite('height', height);
  const s2 = width * width;
  return heightField(options, (x, y) => {
    const g = height * Math.exp(-(x * x + y * y) / (2 * s2));
    return [
      g,
      (-x * g) / s2,
      (-y * g) / s2,
      g * ((x * x) / (s2 * s2) - 1 / s2),
      g * ((y * y) / (s2 * s2) - 1 / s2),
      (g * x * y) / (s2 * s2),
    ];
  });
}

/** z = bend · (x² − y²): negative curvature everywhere. */
export function saddle(options: GridOptions & { readonly bend: number }): Surface {
  const { bend } = options;
  requireFinite('bend', bend);
  return heightField(options, (x, y) => [
    bend * (x * x - y * y),
    2 * bend * x,
    -2 * bend * y,
    2 * bend,
    -2 * bend,
    0,
  ]);
}

/**
 * Part of a sphere of the given radius above the square, as the graph
 * z = sqrt(R² − x² − y²) − R. Exact curvature is 1/R² everywhere. The radius
 * must exceed √2 so the whole square lies under the sphere.
 */
export function sphericalCap(options: GridOptions & { readonly radius: number }): Surface {
  const { radius } = options;
  if (!(radius > Math.SQRT2) || !Number.isFinite(radius)) {
    throw new RangeError(`radius must be finite and greater than sqrt(2), got ${radius}`);
  }
  const r2 = radius * radius;
  return heightField(options, (x, y) => {
    const w = r2 - x * x - y * y;
    const root = Math.sqrt(w);
    const w32 = w * root;
    return [
      root - radius,
      -x / root,
      -y / root,
      -(r2 - y * y) / w32,
      -(r2 - x * x) / w32,
      -(x * y) / w32,
    ];
  });
}

export interface ConeOptions {
  /** Angle defect at the apex in radians, in (0, 2π). */
  readonly deficit: number;
  /** Rings of vertices around the apex. */
  readonly rings: number;
  /** Vertices per ring, at least 3. */
  readonly sectors: number;
}

/**
 * A cone of slant length 1 with the given apex deficit.
 *
 * Lengths come from the flat sector, so they are exact for the intrinsic cone.
 * Positions place the vertices on a right circular cone for drawing; its
 * straight chords are slightly shorter than the sector lengths, so
 * `lengthsMatchPositions` is false.
 */
export function cone(options: ConeOptions): Surface {
  const { deficit, rings, sectors } = options;
  if (!(deficit > 0 && deficit < 2 * Math.PI)) {
    throw new RangeError(`deficit must lie in (0, 2π), got ${deficit}`);
  }
  requireCount('rings', rings, 1);
  requireCount('sectors', sectors, 3);
  const sectorAngle = 2 * Math.PI - deficit;
  const step = sectorAngle / sectors;
  const vertexCount = 1 + rings * sectors;
  const index = (ring: number, spoke: number) => 1 + (ring - 1) * sectors + (spoke % sectors);

  const faces: number[] = [];
  for (let j = 0; j < sectors; j++) faces.push(0, index(1, j), index(1, j + 1));
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = index(i, j);
      const b = index(i + 1, j);
      const c = index(i + 1, j + 1);
      const d = index(i, j + 1);
      faces.push(a, b, c, a, c, d);
    }
  }
  const mesh = TriangleMesh.fromFaces(vertexCount, faces);

  // Slant distance of every vertex (the apex is at 0), and the spoke of every
  // vertex other than the apex.
  const radius = (v: number) => (v === 0 ? 0 : Math.floor((v - 1) / sectors + 1) / rings);
  const spoke = (v: number) => (v - 1) % sectors;
  const lengths = new Float64Array(mesh.edgeCount);
  for (let e = 0; e < mesh.edgeCount; e++) {
    const [u, v] = mesh.edgeVertices(e);
    const su = radius(u);
    const sv = radius(v);
    const sameSpoke = u === 0 || v === 0 || spoke(u) === spoke(v);
    const half = sameSpoke ? 0 : Math.sin(step / 2);
    // Law of cosines in the form that stays accurate for small angles.
    lengths[e] = Math.sqrt((su - sv) * (su - sv) + 4 * su * sv * half * half);
  }

  const baseRadius = sectorAngle / (2 * Math.PI);
  const height = Math.sqrt(1 - baseRadius * baseRadius);
  const positions = new Float64Array(3 * vertexCount);
  positions[2] = height;
  for (let v = 1; v < vertexCount; v++) {
    const s = radius(v);
    const azimuth = (2 * Math.PI * spoke(v)) / sectors;
    positions[3 * v] = s * baseRadius * Math.cos(azimuth);
    positions[3 * v + 1] = s * baseRadius * Math.sin(azimuth);
    positions[3 * v + 2] = height * (1 - s);
  }

  return {
    mesh,
    lengths,
    positions,
    lengthsMatchPositions: false,
    exact: { kind: 'cone', apex: 0, apexDefect: deficit },
  };
}

function heightField(options: GridOptions, f: HeightFunction): Surface {
  const { resolution: n, jitter = 0, seed = 1 } = options;
  requireCount('resolution', n, 1);
  if (!(jitter >= 0 && jitter <= 0.2)) {
    throw new RangeError(`jitter must lie in [0, 0.2], got ${jitter}`);
  }
  const side = n + 1;
  const vertexCount = side * side;
  const cell = 2 / n;
  const random = mulberry32(seed);

  const positions = new Float64Array(3 * vertexCount);
  const gaussian = new Float64Array(vertexCount);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const v = row * side + col;
      let x = -1 + col * cell;
      let y = -1 + row * cell;
      if (jitter > 0 && row > 0 && row < n && col > 0 && col < n) {
        x += (2 * random() - 1) * jitter * cell;
        y += (2 * random() - 1) * jitter * cell;
      }
      const [z, fx, fy, fxx, fyy, fxy] = f(x, y);
      const w = 1 + fx * fx + fy * fy;
      positions[3 * v] = x;
      positions[3 * v + 1] = y;
      positions[3 * v + 2] = z;
      gaussian[v] = (fxx * fyy - fxy * fxy) / (w * w);
    }
  }

  const faces: number[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const lowerLeft = row * side + col;
      const lowerRight = lowerLeft + 1;
      const upperLeft = lowerLeft + side;
      const upperRight = upperLeft + 1;
      faces.push(lowerLeft, lowerRight, upperRight, lowerLeft, upperRight, upperLeft);
    }
  }
  const mesh = TriangleMesh.fromFaces(vertexCount, faces);
  return {
    mesh,
    lengths: edgeLengthsFromPositions(mesh, positions),
    positions,
    lengthsMatchPositions: true,
    exact: { kind: 'pointwise', gaussian },
  };
}

function requireCount(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}, got ${value}`);
  }
}

function requirePositive(name: string, value: number): void {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be positive and finite, got ${value}`);
  }
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite, got ${value}`);
  }
}
