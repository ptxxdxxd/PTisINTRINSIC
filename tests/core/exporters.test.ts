import { describe, expect, it } from 'vitest';
import { toCsv, toObj, toVtk } from '../../src/core/index.ts';

// A unit square split in two, with values that need all 17 digits.
const mesh = {
  positions: [0, 0, 0, 1, 0, 0, 1, 1, 0.1 + 0.2, 0, 1, -1e-300],
  faces: [0, 1, 2, 0, 2, 3],
};
const fields = [
  { name: 'gaussian curvature', values: [1 / 3, NaN, -2.5, 0] },
  { name: 'distance', values: [0, 1, Math.SQRT2, 1] },
];

describe('toVtk', () => {
  it('writes a legacy unstructured-grid file that reads back to the same doubles', () => {
    const lines = toVtk(mesh, fields, 'two\ntriangles').trimEnd().split('\n');
    expect(lines.slice(0, 5)).toEqual([
      '# vtk DataFile Version 3.0',
      'two triangles',
      'ASCII',
      'DATASET UNSTRUCTURED_GRID',
      'POINTS 4 double',
    ]);
    const points = lines.slice(5, 9).flatMap((line) => line.split(' ').map(Number));
    expect(points).toEqual(mesh.positions);
    expect(lines.slice(9, 12)).toEqual(['CELLS 2 8', '3 0 1 2', '3 0 2 3']);
    expect(lines.slice(12, 15)).toEqual(['CELL_TYPES 2', '5', '5']);
    expect(lines.slice(15, 18)).toEqual([
      'POINT_DATA 4',
      'SCALARS gaussian_curvature double 1',
      'LOOKUP_TABLE default',
    ]);
    expect(lines.slice(18, 22)).toEqual([String(1 / 3), 'nan', '-2.5', '0']);
    expect(lines.slice(22, 24)).toEqual(['SCALARS distance double 1', 'LOOKUP_TABLE default']);
    expect(lines.slice(24).map(Number)).toEqual(fields[1].values);
    expect(lines).toHaveLength(28);
  });

  it('omits POINT_DATA without fields and keeps the title to one short line', () => {
    const text = toVtk(mesh, [], `  ${'x'.repeat(400)}  `);
    expect(text).not.toContain('POINT_DATA');
    expect(text.split('\n')[1]).toHaveLength(255);
    expect(text.endsWith('3 0 2 3\nCELL_TYPES 2\n5\n5\n')).toBe(true);
  });
});

describe('toObj', () => {
  it('writes vertices and 1-based faces', () => {
    expect(toObj(mesh, 'a  square')).toBe(
      [
        '# a square',
        'v 0 0 0',
        'v 1 0 0',
        `v 1 1 ${0.1 + 0.2}`,
        'v 0 1 -1e-300',
        'f 1 2 3',
        'f 1 3 4',
        '',
      ].join('\n'),
    );
  });
});

describe('toCsv', () => {
  it('writes one row per vertex with empty cells for NaN', () => {
    const rows = toCsv(mesh, fields).trimEnd().split('\n');
    expect(rows[0]).toBe('vertex,x,y,z,gaussian_curvature,distance');
    expect(rows[1]).toBe(`0,0,0,0,${1 / 3},0`);
    expect(rows[2]).toBe('1,1,0,0,,1');
    expect(rows).toHaveLength(5);
    expect(toCsv(mesh, [])).toContain('vertex,x,y,z\n0,0,0,0\n');
  });
});

describe('export validation', () => {
  it('rejects malformed meshes and fields', () => {
    expect(() => toObj({ positions: [0, 0], faces: [] }, '')).toThrow(/three numbers/);
    expect(() => toObj({ positions: mesh.positions, faces: [0, 1] }, '')).toThrow(/three numbers/);
    for (const bad of [4, -1, 0.5]) {
      expect(() => toObj({ positions: mesh.positions, faces: [0, 1, bad] }, '')).toThrow(
        /not a vertex/,
      );
    }
    expect(() => toCsv(mesh, [{ name: 'short', values: [1] }])).toThrow(/has 1 values, need 4/);
    // NaN means "undefined" and is written; infinity has no representation.
    const infinite = [{ name: 'd', values: [0, Infinity, 0, 0] }];
    expect(() => toVtk(mesh, infinite, 't')).toThrow(/contains Infinity/);
    expect(() => toCsv(mesh, infinite)).toThrow(/contains Infinity/);
    expect(toVtk(mesh, [], '  ').split('\n')[1]).toBe('Intrinsic mesh');
    const zeros = [0, 0, 0, 0];
    expect(() => toCsv(mesh, [{ name: ' ', values: zeros }])).toThrow(/empty or used twice/);
    expect(() =>
      toVtk(
        mesh,
        [
          { name: 'a b', values: zeros },
          { name: 'a_b', values: zeros },
        ],
        't',
      ),
    ).toThrow(/empty or used twice/);
  });
});
