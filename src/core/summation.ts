/**
 * Sum with Neumaier's variant of Kahan compensated summation: the error does
 * not grow with the number of terms, and it stays correct when a term is larger
 * than the running sum.
 *
 * A. Neumaier, "Rundungsfehleranalyse einiger Verfahren zur Summation
 * endlicher Summen", ZAMM 54 (1974).
 */
export function compensatedSum(values: Iterable<number>): number {
  let sum = 0;
  let compensation = 0;
  for (const x of values) {
    const t = sum + x;
    compensation += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
    sum = t;
  }
  return sum + compensation;
}
