import { describe, expect, it } from 'vitest';
import { compensatedSum, mulberry32 } from '../../src/core/index.ts';

describe('compensatedSum', () => {
  it('recovers small terms that plain summation loses', () => {
    const values = [1, 1e100, 1, -1e100];
    expect(values.reduce((s, x) => s + x, 0)).toBe(0);
    expect(compensatedSum(values)).toBe(2);
  });

  it('sums an empty list to 0', () => {
    expect(compensatedSum([])).toBe(0);
  });
});

describe('mulberry32', () => {
  it('matches an independent implementation', () => {
    // nativeprng (npm): Mulberry32.setState(1985); getUint32() === 3527837133.
    expect(mulberry32(1985)() * 2 ** 32).toBe(3527837133);
  });

  it('is reproducible and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
