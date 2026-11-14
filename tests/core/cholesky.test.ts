import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CsrMatrix,
  SparseCholesky,
  TriangleMesh,
  cotanLaplacian,
  mulberry32,
  plane,
  reverseCuthillMcKee,
  vertexAreas,
} from '../../src/core/index.ts';
import { ellipsoid } from '../support/closed-surfaces.ts';

/** Random sparse symmetric matrix, strictly diagonally dominant with a positive diagonal. */
const positiveDefinite = fc
  .integer({ min: 1, max: 40 })
  .chain((n) =>
    fc.record({
      n: fc.constant(n),
      links: fc.array(
        fc.tuple(fc.nat(n - 1), fc.nat(n - 1), fc.double({ min: -2, max: 2, noNaN: true })),
        { maxLength: 4 * n },
      ),
      margin: fc.array(fc.double({ min: 0.01, max: 3, noNaN: true }), {
        minLength: n,
        maxLength: n,
      }),
    }),
  )
  .map(({ n, links, margin }) => {
    const rows: number[] = [];
    const cols: number[] = [];
    const values: number[] = [];
    const diagonal = Float64Array.from(margin);
    for (const [i, j, x] of links) {
      if (i === j) continue;
      rows.push(i, j);
      cols.push(j, i);
      values.push(x, x);
      diagonal[i] += Math.abs(x);
      diagonal[j] += Math.abs(x);
    }
    for (let i = 0; i < n; i++) {
      rows.push(i);
      cols.push(i);
      values.push(diagonal[i]);
    }
    return CsrMatrix.fromTriplets(n, n, rows, cols, values);
  });

const matrix = (n: number, entries: [number, number, number][]) =>
  CsrMatrix.fromTriplets(
    n,
    n,
    entries.map((e) => e[0]),
    entries.map((e) => e[1]),
    entries.map((e) => e[2]),
  );

/** Path graph Laplacian plus the identity, with its vertices relabelled by `label`. */
function shuffledPath(n: number, label: Int32Array): CsrMatrix {
  const entries: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    entries.push([label[i], label[i], 3]);
    if (i + 1 < n) entries.push([label[i], label[i + 1], -1], [label[i + 1], label[i], -1]);
  }
  return matrix(n, entries);
}

function shuffle(n: number, seed: number): Int32Array {
  const random = mulberry32(seed);
  const label = Int32Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [label[i], label[j]] = [label[j], label[i]];
  }
  return label;
}

describe('reverseCuthillMcKee', () => {
  it('returns a permutation, also for disconnected graphs', () => {
    fc.assert(
      fc.property(positiveDefinite, (a) => {
        const order = reverseCuthillMcKee(a);
        expect(Array.from(order).sort((x, y) => x - y)).toEqual(
          Array.from({ length: a.rows }, (_, i) => i),
        );
      }),
    );
  });

  it('recovers the path order from a shuffled path', () => {
    const n = 200;
    const label = shuffle(n, 7);
    const order = reverseCuthillMcKee(shuffledPath(n, label));
    const position = new Int32Array(n);
    for (let k = 0; k < n; k++) position[order[k]] = k;
    for (let i = 0; i + 1 < n; i++) {
      expect(Math.abs(position[label[i]] - position[label[i + 1]])).toBe(1);
    }
    // A tridiagonal envelope: the diagonal and one entry to its left per row.
    expect(SparseCholesky.factor(shuffledPath(n, label)).envelopeSize).toBe(2 * n - 1);
  });

  it('gives a shuffled grid the envelope of its natural numbering', () => {
    const s = plane({ resolution: 24 });
    const n = s.mesh.vertexCount;
    const envelope = (label: Int32Array) => {
      const entries: [number, number, number][] = [];
      for (const [i, j, x] of cotanLaplacian(s.mesh, s.lengths).entries()) {
        entries.push([label[i], label[j], x + (i === j ? 1 : 0)]);
      }
      return SparseCholesky.factor(matrix(n, entries)).envelopeSize;
    };
    // Row-by-row numbering of the 25 × 25 grid has half-bandwidth 26. A random
    // numbering would have an envelope of about n² / 3 = 130,000. Without
    // sorting neighbours by degree the shuffled grids come out 1.5% larger.
    const natural = envelope(Int32Array.from({ length: n }, (_, i) => i));
    expect(natural).toBe(11325);
    for (const seed of [3, 4]) expect(envelope(shuffle(n, seed))).toBe(natural);
  });

  it('starts from an end of a long closed tube, not from its lowest-degree vertex', () => {
    // A sphere mesh with 40 rings of 6 vertices is a long tube. A vertex added
    // inside a face half-way along has degree 3, the lowest, so the search
    // begins there; it must move to a pole. Numbering outwards from the middle
    // instead gives an envelope of 3,222.
    const s = ellipsoid(40, 6, [1, 1, 1]);
    const n = s.mesh.vertexCount;
    const faces = Array.from(s.mesh.halfedgeVertex);
    const middle = 3 * Math.floor(s.mesh.faceCount / 2);
    const [a, b, c] = faces.slice(middle, middle + 3);
    faces.splice(middle, 3, a, b, n, b, c, n, c, a, n);
    const mesh = TriangleMesh.fromFaces(n + 1, faces);
    const entries: [number, number, number][] = [];
    const degree = new Int32Array(n + 1);
    for (let e = 0; e < mesh.edgeCount; e++) {
      const [i, j] = mesh.edgeVertices(e);
      entries.push([i, j, -1], [j, i, -1]);
      degree[i]++;
      degree[j]++;
    }
    degree.forEach((d, i) => entries.push([i, i, d + 1]));
    expect(Math.min(...degree)).toBe(degree[n]);

    const graph = matrix(n + 1, entries);
    const order = reverseCuthillMcKee(graph);
    // The poles are vertices 0 and n − 1.
    expect([order[0], order[n]].sort((x, y) => x - y)).toEqual([0, n - 1]);
    expect(SparseCholesky.factor(graph).envelopeSize).toBe(1830);
  });
});

describe('SparseCholesky', () => {
  it('solves a 2 × 2 system by hand', () => {
    // 4x + 2y = 2, 2x + 3y = 1 has the solution (1/2, 0).
    const solver = SparseCholesky.factor(
      matrix(2, [
        [0, 0, 4],
        [0, 1, 2],
        [1, 0, 2],
        [1, 1, 3],
      ]),
    );
    const x = solver.solve(Float64Array.of(2, 1));
    expect(x[0]).toBeCloseTo(0.5, 15);
    expect(x[1]).toBeCloseTo(0, 15);
    expect(solver.size).toBe(2);
  });

  it('solves random positive definite systems to rounding error', () => {
    fc.assert(
      fc.property(positiveDefinite, fc.integer({ min: 0, max: 2 ** 31 }), (a, seed) => {
        const random = mulberry32(seed);
        const expected = Float64Array.from({ length: a.rows }, () => 2 * random() - 1);
        const x = SparseCholesky.factor(a).solve(a.multiply(expected));
        // Diagonal dominance with margin >= 0.01 bounds the condition number
        // by about 16 / 0.01 here.
        for (let i = 0; i < a.rows; i++) expect(Math.abs(x[i] - expected[i])).toBeLessThan(1e-11);
      }),
    );
  });

  it('keeps tiny far-field values positive where conjugate gradient returns zeros', () => {
    // One backward-Euler heat step from a corner of a 65 × 65 grid. The heat
    // decays geometrically with distance, down to about 1e-32 at the far
    // corner. The heat method needs the direction of its gradient there.
    const s = plane({ resolution: 64 });
    const n = s.mesh.vertexCount;
    const mass = vertexAreas(s.mesh, s.lengths, 'barycentric');
    const t = (2 / 64) ** 2;
    const entries: [number, number, number][] = [];
    for (const [i, j, x] of cotanLaplacian(s.mesh, s.lengths).entries()) {
      entries.push([i, j, t * x + (i === j ? mass[i] : 0)]);
    }
    const delta = new Float64Array(n);
    delta[0] = 1;
    const u = SparseCholesky.factor(matrix(n, entries)).solve(delta);
    expect(Math.min(...u)).toBeGreaterThan(0);
    expect(u[n - 1]).toBeLessThan(1e-30);
  });

  it('rejects a matrix with one off-diagonal entry changed, wherever the ordering puts it', () => {
    // Only one triangle is factored, so an unchecked asymmetry would be
    // solved as a different, symmetric system without any error.
    fc.assert(
      fc.property(positiveDefinite, fc.nat(), fc.boolean(), (a, pick, remove) => {
        // A stored zero is the same matrix with or without it, and −0.5 is the
        // one value the change below maps to itself.
        const entries = Array.from(a.entries()).filter(
          ([i, j, x]) => i !== j && x !== 0 && x !== -0.5,
        );
        fc.pre(entries.length > 0);
        const [row, col] = entries[pick % entries.length];
        const changed = Array.from(a.entries())
          .filter(([i, j]) => !(remove && i === row && j === col))
          .map(([i, j, x]): [number, number, number] => [
            i,
            j,
            !remove && i === row && j === col ? x * 1.5 + 0.25 : x,
          ]);
        expect(() => SparseCholesky.factor(matrix(a.rows, changed))).toThrow(/not symmetric/);
      }),
    );
  });

  it('rejects matrices that are not square, symmetric and positive definite', () => {
    expect(() => SparseCholesky.factor(CsrMatrix.fromTriplets(2, 3, [0], [0], [1]))).toThrow(
      /square/,
    );
    const lopsided: [number, number, number][] = [
      [0, 0, 2],
      [1, 1, 2],
      [0, 1, 1],
      [1, 0, 1.001],
    ];
    expect(() => SparseCholesky.factor(matrix(2, lopsided))).toThrow(/not symmetric/);
    expect(() => SparseCholesky.factor(matrix(2, lopsided.slice(0, 3)))).toThrow(/not symmetric/);
    const offDiagonal = (x: number): [number, number, number][] => [
      [0, 0, 1],
      [1, 1, 1],
      [0, 1, x],
      [1, 0, x],
    ];
    expect(() => SparseCholesky.factor(matrix(2, offDiagonal(2)))).toThrow(/positive definite/);
    expect(() => SparseCholesky.factor(matrix(2, offDiagonal(1)))).toThrow(/pivot 0/);
    expect(() => SparseCholesky.factor(matrix(2, offDiagonal(NaN)))).toThrow(RangeError);
    expect(() =>
      SparseCholesky.factor(matrix(2, offDiagonal(0.5))).solve(new Float64Array(3)),
    ).toThrow(/right-hand side/);
  });
});
