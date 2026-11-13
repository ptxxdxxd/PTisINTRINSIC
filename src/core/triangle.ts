/**
 * Area of a triangle from its three edge lengths.
 *
 * Heron's formula loses most of its significant digits on needle-shaped
 * triangles, where two sides nearly sum to the third. This is Kahan's
 * rearrangement: with the sides sorted so that x >= y >= z, every factor under
 * the square root is formed without catastrophic cancellation, so the result
 * is accurate to a few ulps whatever the triangle's shape.
 *
 * W. Kahan, "Miscalculating Area and Angles of a Needle-like Triangle",
 * lecture notes, 1999, section 2.
 *
 * @throws RangeError if a length is negative or not finite, or if the lengths
 *   violate the triangle inequality. Degenerate (collinear) triangles have area 0.
 */
export function triangleArea(a: number, b: number, c: number): number {
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
  if (!(z >= 0) || !Number.isFinite(x)) {
    throw new RangeError(`edge lengths must be finite and non-negative: ${a}, ${b}, ${c}`);
  }
  const zMinusXMinusY = z - (x - y);
  if (zMinusXMinusY < 0) {
    throw new RangeError(`edge lengths violate the triangle inequality: ${a}, ${b}, ${c}`);
  }
  // The parentheses are load-bearing; do not "simplify" them.
  return 0.25 * Math.sqrt((x + (y + z)) * zMinusXMinusY * (z + (x - y)) * (x + (y - z)));
}
