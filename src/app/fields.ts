import type { ColorMapName } from './colormap.ts';

export type FieldId =
  'gaussian' | 'exact' | 'error' | 'angleDefect' | 'area' | 'distance' | 'eigen';

export interface FieldInfo {
  readonly label: string;
  readonly map: ColorMapName;
  /** What the numbers are, in one sentence. */
  readonly note: string;
}

export const FIELDS: Readonly<Record<FieldId, FieldInfo>> = {
  gaussian: {
    label: 'Gaussian curvature',
    map: 'diverging',
    note: 'Angle defect divided by the vertex area. Not defined on the boundary.',
  },
  exact: {
    label: 'Exact curvature of the smooth surface',
    map: 'diverging',
    note: 'From the formula for the surface, for comparison. Not defined at a cone’s apex.',
  },
  error: {
    label: 'Curvature error (computed − exact)',
    map: 'diverging',
    note: 'How far the mesh value is from the smooth surface’s.',
  },
  angleDefect: {
    label: 'Angle defect',
    map: 'diverging',
    note: '2π minus the angles around a vertex (π on the boundary): curvature integrated over the vertex.',
  },
  area: { label: 'Vertex area', map: 'sequential', note: 'Mixed Voronoi area of each vertex.' },
  distance: {
    label: 'Geodesic distance',
    map: 'sequential',
    note: 'Heat-method distance along the surface from the marked vertices; an approximation, smoothed over about one edge length.',
  },
  eigen: {
    label: 'Laplacian eigenfunction',
    map: 'diverging',
    note: 'A vibration mode of the surface with an insulated boundary.',
  },
};

/** Colour range: symmetric about zero for signed fields, min to max otherwise. */
export function fieldRange(values: Float64Array, map: ColorMapName): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const x of values) {
    if (!Number.isFinite(x)) continue;
    low = Math.min(low, x);
    high = Math.max(high, x);
  }
  if (low > high) return [0, 1];
  if (map === 'diverging') {
    const size = Math.max(Math.abs(low), Math.abs(high)) || 1;
    return [-size, size];
  }
  return low === high ? [low, low + 1] : [low, high];
}

/** A round contour spacing giving about `count` lines across the range. */
export function contourStep([low, high]: readonly [number, number], count = 14): number {
  const rough = (high - low) / count;
  if (!(rough > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(rough));
  return power * ([1, 2, 5, 10].find((m) => m * power >= rough) ?? 10);
}
