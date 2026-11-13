/**
 * Eigenvalues and eigenvectors of a dense symmetric matrix.
 *
 * Householder reduction to tridiagonal form followed by the implicit QL
 * algorithm: the EISPACK routines tred2 and tql2 (Bowdler, Martin, Reinsch and
 * Wilkinson, Handbook for Automatic Computation, Vol. II, Linear Algebra,
 * 1971). This is a port of the public-domain JAMA version (The MathWorks and
 * NIST, math.nist.gov/javanumerics/jama) to typed arrays, with an iteration
 * limit added. It works on W, the transpose of JAMA's eigenvector matrix V
 * (w[r·n + c] = V[c][r]), so the inner loops of both stages run along
 * contiguous memory and each eigenvector comes out as one contiguous row.
 *
 * Cost is O(n³) time and O(n²) memory: fine up to about a thousand rows.
 */

export interface SymmetricEigen {
  /** Eigenvalues in ascending order. */
  readonly values: Float64Array;
  /** n × n array whose row k (entries k·n to k·n + n − 1) is the unit eigenvector for values[k]. */
  readonly vectors: Float64Array;
}

export interface SymmetricEigenOptions {
  /**
   * QL iterations allowed per eigenvalue before giving up with an error. The
   * implicit shifts converge in two or three iterations in practice.
   */
  readonly maxIterations?: number;
}

/**
 * Eigen-decomposition of a symmetric matrix given as a row-major n × n array.
 * Only the lower triangle is read.
 */
export function symmetricEigen(
  matrix: Float64Array,
  n: number,
  options: SymmetricEigenOptions = {},
): SymmetricEigen {
  if (!Number.isInteger(n) || n < 1 || matrix.length !== n * n) {
    throw new RangeError(`expected an ${n} x ${n} matrix, got ${matrix.length} entries`);
  }
  // Scale by a power of two so the largest entry lies in [1, 2), as LAPACK's
  // dsyev scales by its norm. The scaling is exact, and it keeps the deflation
  // threshold eps · ||T|| a normal number and the rotations clear of overflow
  // however small or large A is.
  let largest = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      const x = matrix[i * n + j];
      if (!Number.isFinite(x)) throw new RangeError(`entry (${i}, ${j}) is not finite`);
      largest = Math.max(largest, Math.abs(x));
    }
  }
  const exponent = largest === 0 ? 0 : Math.floor(Math.log2(largest));
  // W starts as A, which is symmetric, so its layout does not matter yet.
  const w = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      const x = timesPowerOfTwo(matrix[i * n + j], -exponent);
      w[i * n + j] = x;
      w[j * n + i] = x;
    }
  }
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  tridiagonalize(w, d, e, n);
  diagonalize(w, d, e, n, options.maxIterations ?? 64);
  for (let k = 0; k < n; k++) d[k] = timesPowerOfTwo(d[k], exponent);
  return { values: d, vectors: w };
}

/** x · 2^k, in steps so that 2^k itself never overflows or underflows. */
function timesPowerOfTwo(x: number, k: number): number {
  let y = x;
  let rest = k;
  while (rest > 1000) {
    y *= 2 ** 1000;
    rest -= 1000;
  }
  while (rest < -1000) {
    y *= 2 ** -1000;
    rest += 1000;
  }
  return y * 2 ** rest;
}

/** Householder reduction to tridiagonal form (EISPACK tred2). JAMA's V[r][c] is w[c·n + r]. */
function tridiagonalize(w: Float64Array, d: Float64Array, e: Float64Array, n: number): void {
  for (let j = 0; j < n; j++) d[j] = w[j * n + (n - 1)];

  for (let i = n - 1; i > 0; i--) {
    // Scale to avoid under- and overflow.
    let scale = 0;
    let h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) {
        d[j] = w[j * n + (i - 1)];
        w[j * n + i] = 0;
        w[i * n + j] = 0;
      }
    } else {
      // Generate the Householder vector.
      for (let k = 0; k < i; k++) {
        d[k] /= scale;
        h += d[k] * d[k];
      }
      let f = d[i - 1];
      let g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;

      // Apply the similarity transformation to the remaining columns.
      for (let j = 0; j < i; j++) {
        f = d[j];
        w[i * n + j] = f;
        g = e[j] + w[j * n + j] * f;
        for (let k = j + 1; k <= i - 1; k++) {
          g += w[j * n + k] * d[k];
          e[k] += w[j * n + k] * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) {
        e[j] /= h;
        f += e[j] * d[j];
      }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j];
        g = e[j];
        for (let k = j; k <= i - 1; k++) w[j * n + k] -= f * e[k] + g * d[k];
        d[j] = w[j * n + (i - 1)];
        w[j * n + i] = 0;
      }
    }
    d[i] = h;
  }

  // Accumulate the transformations.
  for (let i = 0; i < n - 1; i++) {
    w[i * n + (n - 1)] = w[i * n + i];
    w[i * n + i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = w[(i + 1) * n + k] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += w[(i + 1) * n + k] * w[j * n + k];
        for (let k = 0; k <= i; k++) w[j * n + k] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) w[(i + 1) * n + k] = 0;
  }
  for (let j = 0; j < n; j++) {
    d[j] = w[j * n + (n - 1)];
    w[j * n + (n - 1)] = 0;
  }
  w[(n - 1) * n + (n - 1)] = 1;
  e[0] = 0;
}

/** Implicit QL iteration on the tridiagonal matrix, then sort (EISPACK tql2). */
function diagonalize(
  w: Float64Array,
  d: Float64Array,
  e: Float64Array,
  n: number,
  maxIterations: number,
): void {
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;

  let f = 0;
  // A subdiagonal entry below eps · ||T|| is set to zero, which perturbs T by
  // no more than the rounding of the iteration itself. JAMA, like EISPACK's
  // tql2, compares against the running maximum of |d| + |e| over the rows
  // reached so far instead. When the leading rows are tiny next to the rest,
  // that maximum times eps underflows to 0, no entry ever counts as small,
  // and the shift (d[l+1] − d[l]) / 2e[l] overflows (a fuzzed 4 × 4 matrix
  // with entries from 1e-14 down to 1e-322 came back NaN).
  let tst1 = 0;
  for (let l = 0; l < n; l++) tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    // Find a small subdiagonal element.
    let m = l;
    while (m < n && Math.abs(e[m]) > eps * tst1) m++;

    // If m == l, d[l] is already an eigenvalue; otherwise iterate.
    if (m > l) {
      let iterations = 0;
      do {
        if (++iterations > maxIterations) {
          throw new Error(`QL iteration did not converge for eigenvalue ${l}`);
        }
        // Compute the implicit shift.
        let g = d[l];
        let p = (d[l + 1] - g) / (2 * e[l]);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r);
        d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;

        // Implicit QL transformation.
        p = d[m];
        let c = 1;
        let c2 = c;
        let c3 = c;
        const el1 = e[l + 1];
        let s = 0;
        let s2 = 0;
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i];
          h = c * p;
          r = Math.hypot(p, e[i]);
          e[i + 1] = s * r;
          s = e[i] / r;
          c = p / r;
          p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          // Accumulate the transformation into eigenvectors i and i + 1.
          const row = i * n;
          const next = (i + 1) * n;
          for (let k = 0; k < n; k++) {
            h = w[next + k];
            w[next + k] = s * w[row + k] + c * h;
            w[row + k] = c * w[row + k] - s * h;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]) / dl1;
        e[l] = s * p;
        d[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += f;
    e[l] = 0;
  }

  // Sort into ascending order (selection sort: each eigenvector moves at most once).
  for (let i = 0; i < n - 1; i++) {
    let k = i;
    let p = d[i];
    for (let j = i + 1; j < n; j++) {
      if (d[j] < p) {
        k = j;
        p = d[j];
      }
    }
    if (k !== i) {
      d[k] = d[i];
      d[i] = p;
      for (let j = 0; j < n; j++) {
        const t = w[i * n + j];
        w[i * n + j] = w[k * n + j];
        w[k * n + j] = t;
      }
    }
  }
}
