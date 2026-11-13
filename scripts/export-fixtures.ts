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
  CsrMatrix,
  conjugateGradient,
  cone,
  cornerAngles,
  cotanLaplacian,
  faceAreas,
  faceEdgeLengths,
  gaussianBump,
  intrinsicDelaunay,
  laplacianSpectrum,
  mulberry32,
  plane,
  saddle,
  sphericalCap,
  symmetricEigen,
  triangleAngle,
  triangleArea,
  vertexAreas,
  vertexCurvature,
  type Surface,
  TriangleMesh,
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
    /** Cotan stiffness matrix as (row, column, value) triplets. */
    laplacian: number[][];
    /** The intrinsic Delaunay triangulation of the same metric. */
    delaunay: {
      flips: number;
      faces: number[][];
      faceEdgeLengths: number[][];
      laplacian: number[][];
    };
    /** Full spectrum of L φ = λ M φ with the barycentric lumped mass. */
    spectrum: { values: number[]; vectors: number[][] };
    /** L u = 0 inside, u = boundaryValues on the boundary, solved by conjugate gradients. */
    dirichlet: {
      boundaryValues: number[];
      solution: number[];
      relativeResidual: number;
    };
  };
}

/** All eigenvalues and the first `count` eigenfunctions. */
function spectrumOf(stiffness: CsrMatrix, mass: Float64Array, count: number) {
  const { values, vectors } = laplacianSpectrum(stiffness, mass);
  const n = mass.length;
  return {
    values: Array.from(values),
    vectors: Array.from({ length: count }, (_, k) =>
      Array.from(vectors.subarray(k * n, (k + 1) * n)),
    ),
  };
}

/** Random symmetric matrices of assorted sizes, with Intrinsic's eigen-decomposition. */
function symmetricMatrices() {
  const random = mulberry32(31337);
  return [1, 2, 3, 5, 10, 20, 40, 80, 150].map((n) => {
    const a = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        a[i * n + j] = 200 * random() - 100;
        a[j * n + i] = a[i * n + j];
      }
    }
    const { values, vectors } = symmetricEigen(a, n);
    return {
      matrix: Array.from({ length: n }, (_, i) => Array.from(a.subarray(i * n, (i + 1) * n))),
      values: Array.from(values),
      vectors: Array.from({ length: n }, (_, k) =>
        Array.from(vectors.subarray(k * n, (k + 1) * n)),
      ),
    };
  });
}

function faceList(mesh: TriangleMesh): number[][] {
  return Array.from({ length: mesh.faceCount }, (_, f) =>
    Array.from(mesh.halfedgeVertex.subarray(3 * f, 3 * f + 3)),
  );
}

function lengthsPerFace(mesh: TriangleMesh, lengths: Float64Array): number[][] {
  return Array.from({ length: mesh.faceCount }, (_, f) => faceEdgeLengths(mesh, lengths, f));
}

function triplets(matrix: CsrMatrix): number[][] {
  return Array.from(matrix.entries());
}

/** Solves L u = 0 with u = g on the boundary, by conjugate gradients on the interior block. */
function dirichlet(mesh: TriangleMesh, laplacian: CsrMatrix, g: (v: number) => number) {
  const index = new Int32Array(mesh.vertexCount).fill(-1);
  const interior: number[] = [];
  for (let v = 0; v < mesh.vertexCount; v++) {
    if (!mesh.isBoundaryVertex(v)) index[v] = interior.push(v) - 1;
  }
  const rows: number[] = [];
  const cols: number[] = [];
  const values: number[] = [];
  const rhs = new Float64Array(interior.length);
  for (const [i, j, x] of laplacian.entries()) {
    if (index[i] === -1) continue;
    if (index[j] === -1) rhs[index[i]] -= x * g(j);
    else {
      rows.push(index[i]);
      cols.push(index[j]);
      values.push(x);
    }
  }
  const matrix = CsrMatrix.fromTriplets(interior.length, interior.length, rows, cols, values);
  const result = conjugateGradient(matrix, rhs, { tolerance: 1e-12 });
  if (!result.converged) throw new Error('Dirichlet solve did not converge');
  const boundaryValues = Array.from({ length: mesh.vertexCount }, (_, v) => g(v));
  const solution = boundaryValues.slice();
  interior.forEach((v, k) => (solution[v] = result.x[k]));
  return { boundaryValues, solution, relativeResidual: result.relativeResidual };
}

function meshFixture(
  name: string,
  mesh: TriangleMesh,
  lengths: Float64Array,
  positions: Float64Array | undefined,
): MeshFixture {
  const angles = cornerAngles(mesh, lengths);
  const perFaceAngles = Array.from({ length: mesh.faceCount }, (_, f) =>
    Array.from(angles.subarray(3 * f, 3 * f + 3)),
  );
  const laplacian = cotanLaplacian(mesh, lengths);
  const delaunay = intrinsicDelaunay(mesh, lengths);
  // The oracle checks the flipped faces with libigl, which rebuilds edges from
  // the face list and so would merge parallel edges. Only simplicial results
  // make that check meaningful.
  try {
    TriangleMesh.fromFaces(delaunay.mesh.vertexCount, delaunay.mesh.halfedgeVertex);
  } catch (error) {
    throw new Error(`${name}: flipped mesh is not simplicial`, { cause: error });
  }
  const fixture: MeshFixture = {
    name,
    kind: positions === undefined ? 'intrinsic' : 'embedded',
    vertexCount: mesh.vertexCount,
    faces: faceList(mesh),
    faceEdgeLengths: lengthsPerFace(mesh, lengths),
    results: {
      faceAreas: Array.from(faceAreas(mesh, lengths)),
      cornerAngles: perFaceAngles,
      isBoundary: Array.from({ length: mesh.vertexCount }, (_, v) => mesh.isBoundaryVertex(v)),
      vertexCurvature: Array.from(vertexCurvature(mesh, angles)),
      barycentricAreas: Array.from(vertexAreas(mesh, lengths, 'barycentric')),
      mixedAreas: Array.from(vertexAreas(mesh, lengths, 'mixed')),
      laplacian: triplets(laplacian),
      spectrum: spectrumOf(laplacian, vertexAreas(mesh, lengths, 'barycentric'), 12),
      delaunay: {
        flips: delaunay.flips,
        faces: faceList(delaunay.mesh),
        faceEdgeLengths: lengthsPerFace(delaunay.mesh, delaunay.lengths),
        laplacian: triplets(cotanLaplacian(delaunay.mesh, delaunay.lengths)),
      },
      // Arbitrary smooth-ish boundary data; only agreement with a direct solve matters.
      dirichlet: dirichlet(mesh, laplacian, (v) => Math.cos(0.37 * v) + 0.01 * v),
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
  surfaceFixture('steep-bump-16', gaussianBump({ resolution: 16, height: 1.5, width: 0.3 })),
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
writeFileSync(
  join(outputDirectory, 'symmetric-matrices.json'),
  JSON.stringify(symmetricMatrices()),
);
console.log(
  `wrote ${meshes.length} meshes, ${needleList.length} needle triangles and the symmetric matrices to ${outputDirectory}`,
);
