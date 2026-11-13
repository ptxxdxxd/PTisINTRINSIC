/**
 * Closed surfaces for Gauss–Bonnet tests. They are not part of the library:
 * the app only offers surfaces with boundary.
 */
import { TriangleMesh } from '../../src/core/index.ts';

export interface EmbeddedMesh {
  mesh: TriangleMesh;
  positions: Float64Array;
}

/**
 * Latitude-longitude sphere (χ = 2) on an ellipsoid with the given semi-axes;
 * `bump(v)` pushes each vertex out along its radius by a relative amount.
 */
export function ellipsoid(
  rings: number,
  sectors: number,
  axes: readonly [number, number, number],
  bump: (vertex: number) => number = () => 0,
): EmbeddedMesh {
  // Vertex 0 is the north pole, then rings - 1 latitude circles, then the south pole.
  const vertexCount = 2 + (rings - 1) * sectors;
  const south = vertexCount - 1;
  const at = (ring: number, s: number) => 1 + (ring - 1) * sectors + (s % sectors);
  const faces: number[] = [];
  for (let s = 0; s < sectors; s++) {
    faces.push(0, at(1, s), at(1, s + 1));
    faces.push(south, at(rings - 1, s + 1), at(rings - 1, s));
  }
  for (let ring = 1; ring < rings - 1; ring++) {
    for (let s = 0; s < sectors; s++) {
      faces.push(at(ring, s), at(ring + 1, s), at(ring + 1, s + 1));
      faces.push(at(ring, s), at(ring + 1, s + 1), at(ring, s + 1));
    }
  }
  const positions = new Float64Array(3 * vertexCount);
  const place = (v: number, polar: number, azimuth: number) => {
    const r = 1 + bump(v);
    positions[3 * v] = axes[0] * r * Math.sin(polar) * Math.cos(azimuth);
    positions[3 * v + 1] = axes[1] * r * Math.sin(polar) * Math.sin(azimuth);
    positions[3 * v + 2] = axes[2] * r * Math.cos(polar);
  };
  place(0, 0, 0);
  place(south, Math.PI, 0);
  for (let ring = 1; ring < rings; ring++) {
    for (let s = 0; s < sectors; s++) {
      place(at(ring, s), (Math.PI * ring) / rings, (2 * Math.PI * s) / sectors);
    }
  }
  return { mesh: TriangleMesh.fromFaces(vertexCount, faces), positions };
}

/** Torus of revolution (χ = 0), major radius R about the z axis, tube radius r < R. */
export function torus(major: number, minor: number, around: number, tube: number): EmbeddedMesh {
  const vertexCount = around * tube;
  const at = (i: number, j: number) => (i % around) * tube + (j % tube);
  const faces: number[] = [];
  for (let i = 0; i < around; i++) {
    for (let j = 0; j < tube; j++) {
      faces.push(at(i, j), at(i + 1, j), at(i + 1, j + 1));
      faces.push(at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  const positions = new Float64Array(3 * vertexCount);
  for (let i = 0; i < around; i++) {
    const u = (2 * Math.PI * i) / around;
    for (let j = 0; j < tube; j++) {
      const w = (2 * Math.PI * j) / tube;
      const v = at(i, j);
      positions[3 * v] = (major + minor * Math.cos(w)) * Math.cos(u);
      positions[3 * v + 1] = (major + minor * Math.cos(w)) * Math.sin(u);
      positions[3 * v + 2] = minor * Math.sin(w);
    }
  }
  return { mesh: TriangleMesh.fromFaces(vertexCount, faces), positions };
}
