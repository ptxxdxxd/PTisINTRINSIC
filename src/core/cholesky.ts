/**
 * Sparse Cholesky factorization A = L Lᵀ of a symmetric positive definite
 * matrix, for systems that are solved many times with different right-hand
 * sides.
 *
 * The rows and columns are first reordered by reverse Cuthill–McKee, which
 * pulls the nonzeros of a mesh matrix into a narrow band around the diagonal.
 * The factor is then stored by envelope (also called profile or skyline): row
 * k keeps every entry from its first nonzero column to the diagonal. Cholesky
 * creates no nonzeros outside the envelope, so no symbolic analysis is needed.
 * For a triangle mesh with n vertices the envelope holds on the order of n^1.5
 * numbers.
 *
 * A. George and J. W. H. Liu, "Computer Solution of Large Sparse Positive
 * Definite Systems", Prentice-Hall 1981, chapter 4 (the ordering and the
 * envelope method).
 */
import type { CsrMatrix } from './sparse.ts';

/** Relative asymmetry |a_ij − a_ji| tolerated before the matrix is rejected. */
const SYMMETRY_TOLERANCE = 1e-12;

/**
 * Reverse Cuthill–McKee ordering of the graph of a matrix with a symmetric
 * nonzero pattern: `order[k]` is the index that becomes row and column k.
 */
export function reverseCuthillMcKee(a: CsrMatrix): Int32Array {
  const n = a.rows;
  const degree = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    for (let p = a.rowStart[i]; p < a.rowStart[i + 1]; p++) {
      if (a.columnIndex[p] !== i) degree[i]++;
    }
  }
  const byDegree = (u: number, v: number) => degree[u] - degree[v] || u - v;
  const placed = new Uint8Array(n);
  const mark = new Int32Array(n).fill(-1);
  let stamp = 0;

  /**
   * Breadth-first search from `root` over the nodes not placed yet. Fills
   * `order` with the visit order, each node's new neighbours by increasing
   * degree (the Cuthill–McKee rule).
   */
  const search = (root: number, order: number[]): { levels: number; lastLevel: number } => {
    const tag = stamp++;
    order.length = 0;
    order.push(root);
    mark[root] = tag;
    let levels = 0;
    let lastLevel = 0;
    for (let levelStart = 0; levelStart < order.length; levels++) {
      lastLevel = levelStart;
      const levelEnd = order.length;
      for (let q = levelStart; q < levelEnd; q++) {
        const u = order[q];
        const from = order.length;
        for (let p = a.rowStart[u]; p < a.rowStart[u + 1]; p++) {
          const v = a.columnIndex[p];
          if (mark[v] !== tag && placed[v] === 0) {
            mark[v] = tag;
            order.push(v);
          }
        }
        order.push(...order.splice(from).sort(byDegree));
      }
      levelStart = levelEnd;
    }
    return { levels, lastLevel };
  };

  const result = new Int32Array(n);
  let filled = 0;
  const order: number[] = [];
  const nodes = Array.from({ length: n }, (_, i) => i).sort(byDegree);
  for (const seed of nodes) {
    if (placed[seed] === 1) continue;
    // Find a pseudo-peripheral start (George and Liu): keep moving to a node
    // of lowest degree in the last level while the number of levels grows.
    let best = seed;
    let depth = 0;
    for (let root = seed; ;) {
      const { levels, lastLevel } = search(root, order);
      if (levels <= depth) break;
      depth = levels;
      best = root;
      root = order.slice(lastLevel).sort(byDegree)[0];
    }
    search(best, order);
    for (const v of order) {
      placed[v] = 1;
      result[filled++] = v;
    }
  }
  return result.reverse();
}

export class SparseCholesky {
  /** Size of the system. */
  readonly size: number;
  /** Numbers stored in the factor. */
  readonly envelopeSize: number;
  private readonly order: Int32Array;
  /** Row k of L holds columns first[k]..k at values[rowStart[k]..rowStart[k + 1]). */
  private readonly first: Int32Array;
  private readonly rowStart: Int32Array;
  private readonly values: Float64Array;

  private constructor(
    order: Int32Array,
    first: Int32Array,
    rowStart: Int32Array,
    values: Float64Array,
  ) {
    this.size = order.length;
    this.envelopeSize = values.length;
    this.order = order;
    this.first = first;
    this.rowStart = rowStart;
    this.values = values;
  }

  /**
   * Factors a symmetric positive definite matrix. Throws RangeError when the
   * matrix is not square or not symmetric, and when a pivot is not positive
   * (the matrix is not positive definite to working precision).
   */
  static factor(a: CsrMatrix): SparseCholesky {
    const n = a.rows;
    if (a.cols !== n) throw new RangeError(`need a square matrix, got ${n} x ${a.cols}`);
    const order = reverseCuthillMcKee(a);
    const position = new Int32Array(n);
    for (let k = 0; k < n; k++) position[order[k]] = k;

    const first = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      const i = order[k];
      let lowest = k;
      for (let p = a.rowStart[i]; p < a.rowStart[i + 1]; p++) {
        lowest = Math.min(lowest, position[a.columnIndex[p]]);
      }
      first[k] = lowest;
    }
    const rowStart = new Int32Array(n + 1);
    for (let k = 0; k < n; k++) rowStart[k + 1] = rowStart[k] + (k - first[k] + 1);
    const values = new Float64Array(rowStart[n]);
    for (let k = 0; k < n; k++) {
      const i = order[k];
      for (let p = a.rowStart[i]; p < a.rowStart[i + 1]; p++) {
        const j = a.columnIndex[p];
        const value = a.values[p];
        const m = position[j];
        if (m <= k) {
          values[rowStart[k] + m - first[k]] = value;
        } else {
          const mirror = a.get(j, i);
          const scale = Math.max(Math.abs(value), Math.abs(mirror));
          if (!(Math.abs(value - mirror) <= SYMMETRY_TOLERANCE * scale)) {
            throw new RangeError(`matrix is not symmetric at (${i}, ${j})`);
          }
        }
      }
    }

    // Row-by-row Cholesky inside the envelope:
    //   L_kj = (A_kj − Σ_m L_km L_jm) / L_jj,   L_kk = sqrt(A_kk − Σ_m L_km²).
    for (let k = 0; k < n; k++) {
      const fk = first[k];
      const rk = rowStart[k] - fk;
      for (let j = fk; j < k; j++) {
        const fj = first[j];
        const rj = rowStart[j] - fj;
        let sum = values[rk + j];
        for (let m = Math.max(fk, fj); m < j; m++) sum -= values[rk + m] * values[rj + m];
        values[rk + j] = sum / values[rj + j];
      }
      let pivot = values[rk + k];
      for (let m = fk; m < k; m++) pivot -= values[rk + m] * values[rk + m];
      if (!(pivot > 0)) {
        throw new RangeError(`matrix is not positive definite (pivot ${pivot} at row ${order[k]})`);
      }
      values[rk + k] = Math.sqrt(pivot);
    }
    return new SparseCholesky(order, first, rowStart, values);
  }

  /** Solves A x = b. */
  solve(b: Float64Array): Float64Array {
    const n = this.size;
    if (b.length !== n) throw new RangeError(`need ${n} right-hand side values, got ${b.length}`);
    const { order, first, rowStart, values } = this;
    const y = new Float64Array(n);
    // L y = P b, a row at a time.
    for (let k = 0; k < n; k++) {
      const rk = rowStart[k] - first[k];
      let sum = b[order[k]];
      for (let m = first[k]; m < k; m++) sum -= values[rk + m] * y[m];
      y[k] = sum / values[rk + k];
    }
    // Lᵀ z = y, a column of Lᵀ (a row of L) at a time.
    for (let k = n - 1; k >= 0; k--) {
      const rk = rowStart[k] - first[k];
      const z = y[k] / values[rk + k];
      y[k] = z;
      for (let m = first[k]; m < k; m++) y[m] -= values[rk + m] * z;
    }
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) x[order[k]] = y[k];
    return x;
  }
}
