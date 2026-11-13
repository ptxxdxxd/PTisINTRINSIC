import { CsrMatrix } from '../../src/core/index.ts';

/** Restricts L u = 0 to interior vertices with u fixed to g on the boundary. */
export function dirichletSystem(
  laplacian: CsrMatrix,
  isBoundary: (v: number) => boolean,
  boundaryValue: (v: number) => number,
): { matrix: CsrMatrix; rhs: Float64Array; interior: number[] } {
  const n = laplacian.rows;
  const index = new Int32Array(n).fill(-1);
  const interior: number[] = [];
  for (let v = 0; v < n; v++) {
    if (!isBoundary(v)) {
      index[v] = interior.length;
      interior.push(v);
    }
  }
  const rows: number[] = [];
  const cols: number[] = [];
  const values: number[] = [];
  const rhs = new Float64Array(interior.length);
  for (const [i, j, x] of laplacian.entries()) {
    if (index[i] === -1) continue;
    if (index[j] === -1) rhs[index[i]] -= x * boundaryValue(j);
    else {
      rows.push(index[i]);
      cols.push(index[j]);
      values.push(x);
    }
  }
  return {
    matrix: CsrMatrix.fromTriplets(interior.length, interior.length, rows, cols, values),
    rhs,
    interior,
  };
}

export function dense(m: CsrMatrix): number[][] {
  const out = Array.from({ length: m.rows }, () => new Array<number>(m.cols).fill(0));
  for (const [i, j, x] of m.entries()) out[i][j] = x;
  return out;
}
