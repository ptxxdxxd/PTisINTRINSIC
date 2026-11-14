/**
 * Area of a triangle from its three edge lengths.
 *
 * Heron's formula loses most of its significant digits on needle-shaped
 * triangles, where two sides nearly sum to the third. This is Kahan's
 * rearrangement: with the sides sorted so that x >= y >= z, every factor under
 * the square root is formed without catastrophic cancellation, so the result
 * is accurate to a few ulps whatever the triangle's shape, as long as the
 * product of four lengths stays in range (lengths between about 1e-75 and
 * 1e75; validateEdgeLengths enforces that for a mesh).
 *
 * W. Kahan, "Miscalculating Area and Angles of a Needle-like Triangle",
 * lecture notes, 1999, section 2.
 *
 * @throws RangeError if a length is negative or not finite, or if the lengths
 *   violate the triangle inequality. Degenerate (collinear) triangles have area 0.
 */
export function triangleArea(a: number, b: number, c: number): number {
  // Checked before sorting: comparisons with NaN would leave it unsorted.
  if (!(a >= 0 && b >= 0 && c >= 0) || !Number.isFinite(a + b + c)) {
    throw new RangeError(`edge lengths must be finite and non-negative: ${a}, ${b}, ${c}`);
  }
  let x = a;
  let y = b;
  let z = c;
  let t: number;
  if (x < y) {
    t = x;
    x = y;
    y = t;
  }
  if (y < z) {
    t = y;
    y = z;
    z = t;
  }
  if (x < y) {
    t = x;
    x = y;
    y = t;
  }
  const zMinusXMinusY = z - (x - y);
  if (zMinusXMinusY < 0) {
    throw new RangeError(`edge lengths violate the triangle inequality: ${a}, ${b}, ${c}`);
  }
  // The parentheses are load-bearing; do not "simplify" them.
  return 0.25 * Math.sqrt((x + (y + z)) * zMinusXMinusY * (z + (x - y)) * (x + (y - z)));
}

/**
 * Interior angle opposite the side of length `c`, given the two sides `a` and
 * `b` that meet at it.
 *
 * acos((a² + b² − c²) / 2ab) loses most of its digits for angles near 0 and
 * near π. Kahan's half-angle formula keeps full relative accuracy for every
 * shape of triangle. Kahan 1999, section 3.
 *
 * @throws RangeError if `a` or `b` is not positive and finite, `c` is negative,
 *   or the lengths violate the triangle inequality.
 */
export function triangleAngle(c: number, a: number, b: number): number {
  let p = a;
  let q = b;
  if (p < q) {
    p = b;
    q = a;
  }
  if (!(q > 0) || !Number.isFinite(p)) {
    throw new RangeError(`the sides meeting at the angle must be positive and finite: ${a}, ${b}`);
  }
  let mu: number;
  if (q >= c && c >= 0) {
    mu = c - (p - q);
  } else if (c > q) {
    mu = q - (p - c);
  } else {
    throw new RangeError(`opposite side must be non-negative: ${c}`);
  }
  // mu < 0 means c is too short; (p − c) + q < 0 means c is too long.
  const longSide = p - c + q;
  if (mu < 0 || longSide < 0 || !Number.isFinite(c)) {
    throw new RangeError(`edge lengths violate the triangle inequality: ${c}, ${a}, ${b}`);
  }
  // The parentheses are load-bearing. A straight angle gives x / 0 = Infinity
  // and atan(Infinity) = π/2, so the result is exactly π.
  return 2 * Math.atan(Math.sqrt(((p - q + c) * mu) / ((p + (q + c)) * longSide)));
}
