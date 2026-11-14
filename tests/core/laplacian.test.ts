import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  TriangleMesh,
  conjugateGradient,
  cotanLaplacian,
  cotanWeights,
  nonDelaunayEdges,
  plane,
} from '../../src/core/index.ts';
import { dirichletSystem } from '../support/linear-algebra.ts';
import { randomIntrinsicMetric, randomOpenSurface } from '../support/random-surfaces.ts';

const flatMesh = fc
  .record({
    resolution: fc.integer({ min: 2, max: 16 }),
    jitter: fc.double({ min: 0, max: 0.2, noNaN: true }),
    seed: fc.integer({ min: 0, max: 2 ** 31 }),
  })
  .map((o) => plane(o));
const coefficient = fc.double({ min: -3, max: 3, noNaN: true });

describe('cotan Laplacian', () => {
  it('gives each edge of an equilateral triangle the weight cot(60°)/2', () => {
    const weights = cotanWeights(TriangleMesh.fromFaces(3, [0, 1, 2]), Float64Array.of(1, 1, 1));
    for (const w of weights) expect(w).toBeCloseTo(1 / (2 * Math.sqrt(3)), 15);
  });

  it('is symmetric, annihilates constants and is positive semidefinite', () => {
    fc.assert(
      fc.property(
        fc.oneof(randomOpenSurface, randomIntrinsicMetric),
        fc.integer(),
        ({ mesh, lengths }, seed) => {
          const l = cotanLaplacian(mesh, lengths);
          let scale = 0;
          for (const [i, j, x] of l.entries()) {
            expect(l.get(j, i)).toBe(x);
            scale = Math.max(scale, Math.abs(x));
          }
          const ones = new Float64Array(mesh.vertexCount).fill(1);
          for (const y of l.multiply(ones)) expect(Math.abs(y)).toBeLessThanOrEqual(1e-12 * scale);
          // A quadratic form check on a pseudo-random vector.
          const x = Float64Array.from({ length: mesh.vertexCount }, (_, v) =>
            Math.sin(seed + 12.9898 * v),
          );
          const lx = l.multiply(x);
          const energy = x.reduce((s, xi, i) => s + xi * lx[i], 0);
          expect(energy).toBeGreaterThanOrEqual(-1e-12 * scale * mesh.vertexCount);
        },
      ),
    );
  });

  it('reproduces linear functions on flat meshes (linear precision)', () => {
    fc.assert(
      fc.property(flatMesh, coefficient, coefficient, coefficient, (s, a, b, c) => {
        const u = Float64Array.from(
          { length: s.mesh.vertexCount },
          (_, v) => a * s.positions[3 * v] + b * s.positions[3 * v + 1] + c,
        );
        const lu = cotanLaplacian(s.mesh, s.lengths).multiply(u);
        for (let v = 0; v < u.length; v++) {
          if (!s.mesh.isBoundaryVertex(v)) expect(Math.abs(lu[v])).toBeLessThanOrEqual(1e-12);
        }
      }),
    );
  });

  it('measures the Dirichlet energy of a linear function exactly', () => {
    // u = ax + by on the square [-1, 1]²: ∫|∇u|² = 4(a² + b²), and uᵀLu is
    // exactly the Dirichlet energy of the piecewise-linear interpolant.
    fc.assert(
      fc.property(flatMesh, coefficient, coefficient, (s, a, b) => {
        const u = Float64Array.from(
          { length: s.mesh.vertexCount },
          (_, v) => a * s.positions[3 * v] + b * s.positions[3 * v + 1],
        );
        const lu = cotanLaplacian(s.mesh, s.lengths).multiply(u);
        const energy = u.reduce((sum, ui, i) => sum + ui * lu[i], 0);
        expect(energy).toBeCloseTo(4 * (a * a + b * b), 10);
      }),
    );
  });

  it('solves the Dirichlet problem for linear boundary data exactly, with conjugate gradients', () => {
    const s = plane({ resolution: 32, jitter: 0.2, seed: 9 });
    const g = (v: number) => 0.3 + 1.7 * s.positions[3 * v] - 0.9 * s.positions[3 * v + 1];
    const system = dirichletSystem(
      cotanLaplacian(s.mesh, s.lengths),
      (v) => s.mesh.isBoundaryVertex(v),
      g,
    );
    const result = conjugateGradient(system.matrix, system.rhs, { tolerance: 1e-12 });
    expect(result.converged).toBe(true);
    system.interior.forEach((v, k) => {
      expect(Math.abs(result.x[k] - g(v))).toBeLessThanOrEqual(1e-9);
    });
  });

  it('has negative weights on exactly the non-Delaunay edges', () => {
    const s = plane({ resolution: 12, jitter: 0.2, seed: 4 });
    const weights = cotanWeights(s.mesh, s.lengths);
    const negative = new Set(nonDelaunayEdges(s.mesh, s.lengths));
    expect(negative.size).toBeGreaterThan(0);
    for (let e = 0; e < s.mesh.edgeCount; e++) {
      if (s.mesh.isBoundaryEdge(e) || Math.abs(weights[e]) < 1e-12) continue;
      expect(negative.has(e)).toBe(weights[e] < 0);
    }
  });
});

describe('cotan weights on the boundary', () => {
  it('are negative on a boundary edge that faces an obtuse angle', () => {
    // Sides 1, 1 and 1.9: the long edge faces 143.6°. It is a boundary edge,
    // so no flip can remove it, and nonDelaunayEdges (interior only) is empty.
    const mesh = TriangleMesh.fromFaces(3, [0, 1, 2]);
    const lengths = new Float64Array(3).fill(1);
    const long = mesh.halfedgeEdge[mesh.findHalfedge(0, 1)];
    lengths[long] = 1.9;
    const weights = cotanWeights(mesh, lengths);
    expect(weights[long]).toBeLessThan(-0.6);
    expect(weights.filter((w) => w > 0)).toHaveLength(2);
    expect(nonDelaunayEdges(mesh, lengths)).toEqual([]);
  });
});
