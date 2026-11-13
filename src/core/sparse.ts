/**
 * Compressed sparse row (CSR) matrix: the nonzeros of row i are
 * values[rowStart[i] .. rowStart[i + 1]), at the columns in columnIndex,
 * sorted by column within each row.
 */
export class CsrMatrix {
  readonly rows: number;
  readonly cols: number;
  readonly rowStart: Int32Array;
  readonly columnIndex: Int32Array;
  readonly values: Float64Array;

  private constructor(
    rows: number,
    cols: number,
    rowStart: Int32Array,
    columnIndex: Int32Array,
    values: Float64Array,
  ) {
    this.rows = rows;
    this.cols = cols;
    this.rowStart = rowStart;
    this.columnIndex = columnIndex;
    this.values = values;
  }

  /**
   * Builds a matrix from (row, column, value) triplets. Duplicate positions are
   * summed, as in finite-element assembly.
   */
  static fromTriplets(
    rows: number,
    cols: number,
    rowIndex: ArrayLike<number>,
    colIndex: ArrayLike<number>,
    value: ArrayLike<number>,
  ): CsrMatrix {
    const count = rowIndex.length;
    if (colIndex.length !== count || value.length !== count) {
      throw new RangeError('triplet arrays must have the same length');
    }
    // Bucket the triplets by row (a counting sort), then sort each row's
    // handful of entries by column and merge duplicates.
    const start = new Int32Array(rows + 1);
    for (let t = 0; t < count; t++) {
      const i = rowIndex[t];
      const j = colIndex[t];
      if (
        !Number.isInteger(i) ||
        i < 0 ||
        i >= rows ||
        !Number.isInteger(j) ||
        j < 0 ||
        j >= cols
      ) {
        throw new RangeError(`triplet ${t} at (${i}, ${j}) is outside a ${rows} x ${cols} matrix`);
      }
      start[i + 1]++;
    }
    for (let i = 0; i < rows; i++) start[i + 1] += start[i];
    const fill = start.slice(0, rows);
    const order = new Int32Array(count);
    for (let t = 0; t < count; t++) order[fill[rowIndex[t]]++] = t;

    const outStart = new Int32Array(rows + 1);
    const outColumn = new Int32Array(count);
    const outValue = new Float64Array(count);
    let nonzeros = 0;
    for (let i = 0; i < rows; i++) {
      const row = Array.from(order.subarray(start[i], start[i + 1]));
      row.sort((a, b) => colIndex[a] - colIndex[b]);
      let previous = -1;
      for (const t of row) {
        const j = colIndex[t];
        if (j === previous) {
          outValue[nonzeros - 1] += value[t];
        } else {
          outColumn[nonzeros] = j;
          outValue[nonzeros] = value[t];
          nonzeros++;
          previous = j;
        }
      }
      outStart[i + 1] = nonzeros;
    }
    return new CsrMatrix(
      rows,
      cols,
      outStart,
      outColumn.slice(0, nonzeros),
      outValue.slice(0, nonzeros),
    );
  }

  /** y = A x. Writes into `out` when given. */
  multiply(x: Float64Array, out: Float64Array = new Float64Array(this.rows)): Float64Array {
    if (x.length !== this.cols || out.length !== this.rows) {
      throw new RangeError(`cannot multiply a ${this.rows} x ${this.cols} matrix by ${x.length}`);
    }
    const { rowStart, columnIndex, values } = this;
    for (let i = 0; i < this.rows; i++) {
      let sum = 0;
      for (let k = rowStart[i]; k < rowStart[i + 1]; k++) sum += values[k] * x[columnIndex[k]];
      out[i] = sum;
    }
    return out;
  }

  /** Entry (i, j), or 0 when it is not stored. */
  get(i: number, j: number): number {
    let lo = this.rowStart[i];
    let hi = this.rowStart[i + 1] - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = this.columnIndex[mid];
      if (c === j) return this.values[mid];
      if (c < j) lo = mid + 1;
      else hi = mid - 1;
    }
    return 0;
  }

  diagonal(): Float64Array {
    const d = new Float64Array(Math.min(this.rows, this.cols));
    for (let i = 0; i < d.length; i++) d[i] = this.get(i, i);
    return d;
  }

  /** Stored entries as (row, column, value) triplets in row order. */
  *entries(): Generator<[number, number, number]> {
    for (let i = 0; i < this.rows; i++) {
      for (let k = this.rowStart[i]; k < this.rowStart[i + 1]; k++) {
        yield [i, this.columnIndex[k], this.values[k]];
      }
    }
  }
}
