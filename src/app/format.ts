/** A number at four significant digits, or as 1.23e-13 when very small or large. */
export function formatNumber(x: number): string {
  if (Number.isNaN(x)) return 'undefined';
  if (x === 0) return '0';
  const size = Math.abs(x);
  if (size < 1e-3 || size >= 1e5) return x.toExponential(2);
  return String(Number(x.toPrecision(4)));
}

export function formatMilliseconds(ms: number): string {
  return ms < 10
    ? `${ms.toFixed(1)} ms`
    : ms < 1000
      ? `${ms.toFixed(0)} ms`
      : `${(ms / 1000).toFixed(2)} s`;
}

/** Offers `text` to the browser as a file download. */
export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
