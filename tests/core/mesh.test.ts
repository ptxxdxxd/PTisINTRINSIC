import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MeshError,
  TriangleMesh,
  halfedgeFace,
  nextHalfedge,
  plane,
  prevHalfedge,
} from '../../src/core/index.ts';
import { ellipsoid, torus } from '../support/closed-surfaces.ts';

describe('TriangleMesh topology', () => {
  it('counts a grid disk correctly', () => {
    const n = 5;
    const { mesh } = plane({ resolution: n });
    expect(mesh.vertexCount).toBe((n + 1) ** 2);
    expect(mesh.faceCount).toBe(2 * n * n);
    expect(mesh.edgeCount).toBe(3 * n * n + 2 * n);
    expect(mesh.eulerCharacteristic()).toBe(1);
    const loops = mesh.boundaryLoops();
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4 * n);
  });

  it('has Euler characteristic 2 for a sphere and 0 for a torus', () => {
    const sphere = ellipsoid(6, 8, [1, 1, 1]).mesh;
    expect(sphere.eulerCharacteristic()).toBe(2);
    expect(sphere.boundaryLoops()).toEqual([]);
    const ring = torus(2, 0.5, 9, 6).mesh;
    expect(ring.eulerCharacteristic()).toBe(0);
    expect(ring.boundaryLoops()).toEqual([]);
  });

  it('finds both boundary loops of an annulus', () => {
    // 4 x 4 grid of cells with the middle 2 x 2 cells removed.
    const side = 5;
    const faces: number[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        if (row >= 1 && row <= 2 && col >= 1 && col <= 2) continue;
        const a = row * side + col;
        faces.push(a, a + 1, a + side + 1, a, a + side + 1, a + side);
      }
    }
    // The centre vertex (2, 2) is no longer used, so renumber to drop it.
    const used = [...new Set(faces)].sort((x, y) => x - y);
    const renumber = new Map(used.map((v, i) => [v, i]));
    const mesh = TriangleMesh.fromFaces(
      used.length,
      faces.map((v) => renumber.get(v) ?? -1),
    );
    expect(mesh.eulerCharacteristic()).toBe(0);
    const loops = mesh.boundaryLoops().map((loop) => loop.length);
    expect(loops.sort((x, y) => x - y)).toEqual([8, 16]);
  });

  it('keeps the halfedge invariants on every surface', () => {
    const surfaces = fc.oneof(
      fc.integer({ min: 1, max: 8 }).map((n) => plane({ resolution: n }).mesh),
      fc
        .tuple(fc.integer({ min: 2, max: 7 }), fc.integer({ min: 3, max: 9 }))
        .map(([r, s]) => ellipsoid(r, s, [1, 1, 1]).mesh),
      fc
        .tuple(fc.integer({ min: 3, max: 8 }), fc.integer({ min: 3, max: 8 }))
        .map(([a, b]) => torus(2, 0.5, a, b).mesh),
    );
    fc.assert(
      fc.property(surfaces, (mesh) => {
        const halfedges = 3 * mesh.faceCount;
        let fanTotal = 0;
        for (let v = 0; v < mesh.vertexCount; v++) {
          const fan = mesh.outgoingHalfedges(v);
          fanTotal += fan.length;
          for (const h of fan) expect(mesh.halfedgeVertex[h]).toBe(v);
        }
        expect(fanTotal).toBe(halfedges);
        for (let h = 0; h < halfedges; h++) {
          expect(nextHalfedge(prevHalfedge(h))).toBe(h);
          expect(halfedgeFace(nextHalfedge(h))).toBe(halfedgeFace(h));
          const twin = mesh.halfedgeTwin[h];
          if (twin === -1) {
            expect(mesh.isBoundaryEdge(mesh.halfedgeEdge[h])).toBe(true);
            continue;
          }
          expect(mesh.halfedgeTwin[twin]).toBe(h);
          expect(mesh.halfedgeEdge[twin]).toBe(mesh.halfedgeEdge[h]);
          expect(mesh.halfedgeVertex[twin]).toBe(mesh.tipVertex(h));
        }
        for (let e = 0; e < mesh.edgeCount; e++) {
          expect(mesh.halfedgeEdge[mesh.edgeHalfedge[e]]).toBe(e);
        }
      }),
    );
  });

  it('reports the endpoints of an edge', () => {
    const mesh = TriangleMesh.fromFaces(3, [0, 1, 2]);
    const endpoints = Array.from({ length: mesh.edgeCount }, (_, e) => mesh.edgeVertices(e));
    expect(endpoints).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
    expect(mesh.isBoundaryVertex(0)).toBe(true);
  });
});

describe('TriangleMesh validation', () => {
  it.each([
    ['too few vertices', 2, [0, 1, 2], /vertexCount/],
    ['a partial face', 3, [0, 1], /multiple of 3/],
    ['no faces', 3, [], /multiple of 3/],
    ['an index out of range', 3, [0, 1, 3], /out of range/],
    ['a fractional index', 3, [0, 1, 1.5], /out of range/],
    ['a repeated vertex', 3, [0, 1, 1], /repeats a vertex/],
    ['inconsistent orientation', 4, [0, 1, 2, 0, 1, 3], /same direction/],
    ['an edge with three faces', 5, [0, 1, 2, 1, 0, 3, 0, 1, 4], /same direction/],
    ['a bow-tie vertex', 5, [0, 1, 2, 0, 3, 4], /more than one boundary fan/],
    ['an unused vertex', 4, [0, 1, 2], /does not belong to any face/],
  ])('rejects %s', (_label, vertexCount, faces, message) => {
    expect(() => TriangleMesh.fromFaces(vertexCount, faces)).toThrow(MeshError);
    expect(() => TriangleMesh.fromFaces(vertexCount, faces)).toThrow(message);
  });

  it('rejects a closed fan glued to a disk at one vertex', () => {
    // Vertex 0 is the apex of a closed tetrahedron-like cap and also a corner of
    // an extra triangle, so its faces form two fans.
    const faces = [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2, 0, 4, 5];
    expect(() => TriangleMesh.fromFaces(6, faces)).toThrow(/more than one boundary fan|single fan/);
  });

  it('rejects two closed fans meeting at one vertex', () => {
    // Two tetrahedra sharing only vertex 0: every halfedge has a twin, but the
    // faces around vertex 0 split into two separate cycles.
    const tetra = (a: number, b: number, c: number) => [0, a, b, 0, b, c, 0, c, a, a, c, b];
    const faces = [...tetra(1, 2, 3), ...tetra(4, 5, 6)];
    expect(() => TriangleMesh.fromFaces(7, faces)).toThrow(/single fan/);
  });
});
