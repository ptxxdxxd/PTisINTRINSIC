/**
 * Writes oracle/fixtures/*.json: meshes and Intrinsic's results on them, for
 * the Python suite to recompute with libigl, potpourri3d, scipy and mpmath.
 *
 * Usage: node scripts/export-fixtures.ts
 *
 * Numbers are written with JSON.stringify, which prints the shortest decimal
 * that round-trips to the same binary64 value, so Python reads back exactly
 * the doubles that were computed here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cone,
  cornerAngles,
  faceAreas,
  faceEdgeLengths,
  gaussianBump,
  mulberry32,
  plane,
  saddle,
  sphericalCap,
  triangleAngle,
  triangleArea,
  vertexAreas,
  vertexCurvature,
  type Surface,
  type TriangleMesh,
} from '../src/core/index.ts';

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'oracle', 'fixtures');

interface MeshFixture {
  name: string;
  /** "embedded": lengths are chord lengths of positions. "intrinsic": lengths only. */
  kind: 'embedded' | 'intrinsic';
  vertexCount: number;
  faces: number[][];
  positions?: number[][];
  /** Per face, the length of the edge opposite each corner (libigl's convention). */
  faceEdgeLengths: number[][];
  results: {
    faceAreas: number[];
    /** Per face, the angle at each corner. */
    cornerAngles: number[][];
    isBoundary: boolean[];
    vertexCurvature: number[];
    barycentricAreas: number[];
    mixedAreas: number[];
  };
}

function meshFixture(
  name: string,
  mesh: TriangleMesh,
  lengths: Float64Array,
  positions: Float64Array | undefined,
): MeshFixture {
  const angles = cornerAngles(mesh, lengths);
  const faces: number[][] = [];
  const perFaceLengths: number[][] = [];
  const perFaceAngles: number[][] = [];
  for (let f = 0; f < mesh.faceCount; f++) {
    faces.push(Array.from(mesh.halfedgeVertex.subarray(3 * f, 3 * f + 3)));
    perFaceLengths.push(faceEdgeLengths(mesh, lengths, f));
    perFaceAngles.push(Array.from(angles.subarray(3 * f, 3 * f + 3)));
  }
  const fixture: MeshFixture = {
    name,
    kind: positions === undefined ? 'intrinsic' : 'embedded',
    vertexCount: mesh.vertexCount,
    faces,
    faceEdgeLengths: perFaceLengths,
    results: {
      faceAreas: Array.from(faceAreas(mesh, lengths)),
      cornerAngles: perFaceAngles,
      isBoundary: Array.from({ length: mesh.vertexCount }, (_, v) => mesh.isBoundaryVertex(v)),
      vertexCurvature: Array.from(vertexCurvature(mesh, angles)),
      barycentricAreas: Array.from(vertexAreas(mesh, lengths, 'barycentric')),
      mixedAreas: Array.from(vertexAreas(mesh, lengths, 'mixed')),
    },
  };
  if (positions !== undefined) {
    fixture.positions = Array.from({ length: mesh.vertexCount }, (_, v) =>
      Array.from(positions.subarray(3 * v, 3 * v + 3)),
    );
  }
  return fixture;
}

function surfaceFixture(name: string, s: Surface): MeshFixture {
  return meshFixture(name, s.mesh, s.lengths, s.lengthsMatchPositions ? s.positions : undefined);
}

/** A flat grid with every edge scaled by a random factor in [0.9, 1.1]: no embedding. */
function perturbedGrid(): MeshFixture {
  const { mesh, lengths } = plane({ resolution: 8 });
  const random = mulberry32(2026);
  const scaled = lengths.map((l) => l * (0.9 + 0.2 * random()));
  return meshFixture('perturbed-grid-8', mesh, scaled, undefined);
}

/**
 * Needle-shaped triangles where textbook formulas fail: thin isosceles
 * triangles, nearly degenerate thin triangles, and nearly flat obtuse ones.
 */
function needles(): { sides: number[]; area: number; angles: number[] }[] {
  const random = mulberry32(1999);
  const candidates: number[][] = [];
  for (let k = 1; k <= 15; k++) candidates.push([1, 1, 10 ** -k]);
  for (let i = 0; i < 100; i++) {
    const delta = 10 ** -(1 + 14 * random());
    const excess = 10 ** -(1 + 14 * random());
    candidates.push([1, 1 - delta, delta * (1 + excess)]);
  }
  for (let i = 0; i < 100; i++) {
    const a = 0.5 + 0.5 * random();
    const b = 0.5 + 0.5 * random();
    candidates.push([a, b, (a + b) * (1 - 10 ** -(1 + 14 * random()))]);
  }
  const result = [];
  for (const [a, b, c] of candidates as [number, number, number][]) {
    let area: number;
    try {
      area = triangleArea(a, b, c);
    } catch {
      continue; // rounding pushed the candidate outside the triangle inequality
    }
    if (area === 0) continue;
    result.push({
      sides: [a, b, c],
      area,
      // Angle opposite each side in turn.
      angles: [triangleAngle(a, b, c), triangleAngle(b, c, a), triangleAngle(c, a, b)],
    });
  }
  return result;
}

const meshes: MeshFixture[] = [
  surfaceFixture('plane-jitter-12', plane({ resolution: 12, jitter: 0.2, seed: 12 })),
  surfaceFixture('bump-16', gaussianBump({ resolution: 16, height: 0.5, width: 0.4 })),
  surfaceFixture('saddle-16', saddle({ resolution: 16, bend: 0.5 })),
  surfaceFixture('cap-16', sphericalCap({ resolution: 16, radius: 2 })),
  surfaceFixture('cone-6x12', cone({ deficit: 1.2345, rings: 6, sectors: 12 })),
  perturbedGrid(),
];

mkdirSync(outputDirectory, { recursive: true });
for (const fixture of meshes) {
  writeFileSync(join(outputDirectory, `${fixture.name}.json`), JSON.stringify(fixture));
}
const needleList = needles();
writeFileSync(join(outputDirectory, 'needles.json'), JSON.stringify(needleList));
console.log(
  `wrote ${meshes.length} meshes and ${needleList.length} needle triangles to ${outputDirectory}`,
);
