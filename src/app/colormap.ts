/** Colour maps, as functions of t in [0, 1] returning sRGB components in [0, 1]. */
export type Rgb = readonly [number, number, number];
export type ColorMapName = 'sequential' | 'diverging';

/**
 * Cubehelix: brightness rises monotonically while the hue winds around the
 * grey axis, so the map still reads in greyscale. D. A. Green, "A colour
 * scheme for the display of astronomical intensity images", Bull. Astron.
 * Soc. India 39, 2011. Parameters: start 0.5, −1.5 rotations, hue 1, gamma 1;
 * the ends are trimmed so neither is pure black or white.
 */
function cubehelix(t: number): Rgb {
  const level = 0.12 + 0.8 * t;
  const angle = 2 * Math.PI * (0.5 / 3 + 1 - 1.5 * level);
  const amplitude = (level * (1 - level)) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    level + amplitude * (-0.14861 * cos + 1.78277 * sin),
    level + amplitude * (-0.29227 * cos - 0.90649 * sin),
    level + amplitude * (1.97294 * cos),
  ];
}

const COOL: Rgb = [0.23, 0.3, 0.75];
const MIDDLE: Rgb = [0.93, 0.93, 0.93];
const WARM: Rgb = [0.71, 0.02, 0.15];

/** Blue through light grey to red, for signed quantities centred on zero. */
function diverging(t: number): Rgb {
  const [from, to, s] = t < 0.5 ? [COOL, MIDDLE, 2 * t] : [MIDDLE, WARM, 2 * t - 1];
  const mix = (c: 0 | 1 | 2) => from[c] + (to[c] - from[c]) * s;
  return [mix(0), mix(1), mix(2)];
}

export function colorAt(map: ColorMapName, t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, t));
  const [r, g, b] = map === 'sequential' ? cubehelix(clamped) : diverging(clamped);
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
}

/** RGBA bytes of the map sampled at `size` points, for a lookup texture. */
export function colorRamp(map: ColorMapName, size = 256): Uint8Array {
  const data = new Uint8Array(4 * size);
  for (let k = 0; k < size; k++) {
    const [r, g, b] = colorAt(map, k / (size - 1));
    data.set([Math.round(255 * r), Math.round(255 * g), Math.round(255 * b), 255], 4 * k);
  }
  return data;
}

/** The map as a CSS gradient, for the legend. */
export function cssGradient(map: ColorMapName, stops = 17): string {
  const colors = Array.from({ length: stops }, (_, k) => {
    const [r, g, b] = colorAt(map, k / (stops - 1));
    return `rgb(${Math.round(255 * r)} ${Math.round(255 * g)} ${Math.round(255 * b)})`;
  });
  return `linear-gradient(to right, ${colors.join(', ')})`;
}
