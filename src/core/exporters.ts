/**
 * Text exports of a triangle mesh with per-vertex scalar fields: legacy VTK
 * (opens in ParaView), Wavefront OBJ and CSV.
 *
 * Numbers are written with JavaScript's default formatting, the shortest
 * decimal that reads back to the same double, so nothing is lost on export.
 */

/** A plain or typed array of numbers. */
export type Numbers = ArrayLike<number> & Iterable<number>;

export interface ExportMesh {
  /** xyz per vertex. */
  readonly positions: Numbers;
  /** Three vertex indices per face. */
  readonly faces: Numbers;
}

export interface ExportField {
  readonly name: string;
  /** One value per vertex; NaN marks "not defined here". */
  readonly values: Numbers;
}

function checked(mesh: ExportMesh, fields: readonly ExportField[]): { n: number; m: number } {
  if (mesh.positions.length % 3 !== 0 || mesh.faces.length % 3 !== 0) {
    throw new RangeError('positions and faces must hold three numbers per vertex and per face');
  }
  const n = mesh.positions.length / 3;
  for (const v of mesh.faces) {
    if (!Number.isInteger(v) || v < 0 || v >= n) {
      throw new RangeError(`face index ${v} is not a vertex`);
    }
  }
  const names = new Set<string>();
  for (const field of fields) {
    const name = identifier(field.name);
    if (field.values.length !== n) {
      throw new RangeError(`field "${field.name}" has ${field.values.length} values, need ${n}`);
    }
    if (name === '' || names.has(name)) {
      throw new RangeError(`field name "${field.name}" is empty or used twice`);
    }
    names.add(name);
  }
  return { n, m: mesh.faces.length / 3 };
}

/** The formats have a way to write "undefined" (NaN) but none for infinity. */
function finite(x: number, name: string): number {
  if (!Number.isFinite(x)) throw new RangeError(`field "${name}" contains ${x}`);
  return x;
}

/** Field names become single tokens: runs of anything but letters, digits, '.', '-' turn into '_'. */
function identifier(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9.-]+/g, '_');
}

/**
 * Legacy ASCII VTK with each field as POINT_DATA scalars; NaN is written as
 * "nan". The dataset type is UNSTRUCTURED_GRID with triangle cells (type 5):
 * ParaView reads it like POLYDATA, and so does meshio, which rejects POLYDATA.
 */
export function toVtk(mesh: ExportMesh, fields: readonly ExportField[], title: string): string {
  const { n, m } = checked(mesh, fields);
  // The title is the file's second line: one line, at most 256 characters.
  const header = title.replace(/\s+/g, ' ').trim().slice(0, 255) || 'Untitled mesh';
  const lines = ['# vtk DataFile Version 3.0', header, 'ASCII', 'DATASET UNSTRUCTURED_GRID'];
  lines.push(`POINTS ${n} double`);
  for (let v = 0; v < n; v++) {
    lines.push(
      `${mesh.positions[3 * v]} ${mesh.positions[3 * v + 1]} ${mesh.positions[3 * v + 2]}`,
    );
  }
  lines.push(`CELLS ${m} ${4 * m}`);
  for (let f = 0; f < m; f++) {
    lines.push(`3 ${mesh.faces[3 * f]} ${mesh.faces[3 * f + 1]} ${mesh.faces[3 * f + 2]}`);
  }
  lines.push(`CELL_TYPES ${m}`);
  for (let f = 0; f < m; f++) lines.push('5');
  if (fields.length > 0) lines.push(`POINT_DATA ${n}`);
  for (const field of fields) {
    lines.push(`SCALARS ${identifier(field.name)} double 1`, 'LOOKUP_TABLE default');
    for (let v = 0; v < n; v++) {
      const x = field.values[v];
      lines.push(Number.isNaN(x) ? 'nan' : String(finite(x, field.name)));
    }
  }
  return lines.join('\n') + '\n';
}

/** Wavefront OBJ: geometry only (the format has no per-vertex scalars). Indices are 1-based. */
export function toObj(mesh: ExportMesh, title: string): string {
  const { n, m } = checked(mesh, []);
  const lines = [`# ${title.replace(/\s+/g, ' ').trim()}`];
  for (let v = 0; v < n; v++) {
    lines.push(
      `v ${mesh.positions[3 * v]} ${mesh.positions[3 * v + 1]} ${mesh.positions[3 * v + 2]}`,
    );
  }
  for (let f = 0; f < m; f++) {
    lines.push(
      `f ${mesh.faces[3 * f] + 1} ${mesh.faces[3 * f + 1] + 1} ${mesh.faces[3 * f + 2] + 1}`,
    );
  }
  return lines.join('\n') + '\n';
}

/** One row per vertex: index, position, then each field. NaN becomes an empty cell. */
export function toCsv(mesh: ExportMesh, fields: readonly ExportField[]): string {
  const { n } = checked(mesh, fields);
  const lines = [['vertex', 'x', 'y', 'z', ...fields.map((f) => identifier(f.name))].join(',')];
  for (let v = 0; v < n; v++) {
    const row: (number | string)[] = [
      v,
      mesh.positions[3 * v],
      mesh.positions[3 * v + 1],
      mesh.positions[3 * v + 2],
    ];
    for (const field of fields) {
      const x = field.values[v];
      row.push(Number.isNaN(x) ? '' : finite(x, field.name));
    }
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}
