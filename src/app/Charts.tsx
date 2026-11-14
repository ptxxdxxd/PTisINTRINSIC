import { weylCount, type SpectrumData } from './model.ts';

const WIDTH = 320;
const HEIGHT = 190;
const MARGIN = { left: 38, right: 10, top: 10, bottom: 30 };

interface Scale {
  (value: number): number;
  readonly ticks: readonly number[];
}

function linear(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain;
  const scale = (value: number) =>
    range[0] + ((value - d0) / (d1 - d0 || 1)) * (range[1] - range[0]);
  // Ticks at 1, 2 or 5 times a power of ten, about four of them.
  const rough = (d1 - d0) / 4 || 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = power * ([1, 2, 5, 10].find((m) => m * power >= rough) ?? 10);
  const ticks: number[] = [];
  for (let t = Math.ceil(d0 / step) * step; t <= d1 + 1e-9 * step; t += step) ticks.push(t);
  return Object.assign(scale, { ticks });
}

const path = (points: readonly (readonly [number, number])[]) =>
  points.map(([x, y], k) => `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

const tickLabel = (value: number) => String(Number(value.toPrecision(3)));

function Axes(props: { x: Scale; y: Scale; xLabel: string; xTicks?: readonly [number, string][] }) {
  const { x, y } = props;
  const bottom = HEIGHT - MARGIN.bottom;
  const xTicks = props.xTicks ?? x.ticks.map((t) => [t, tickLabel(t)] as const);
  return (
    <g className="axes">
      <path d={`M${MARGIN.left},${MARGIN.top}V${bottom}H${WIDTH - MARGIN.right}`} />
      {y.ticks.map((t) => (
        <g key={t} transform={`translate(${MARGIN.left},${y(t)})`}>
          <line x2={WIDTH - MARGIN.left - MARGIN.right} className="grid" />
          <text x={-5} dy="0.32em" textAnchor="end">
            {tickLabel(t)}
          </text>
        </g>
      ))}
      {xTicks.map(([t, label]) => (
        <text key={t} x={x(t)} y={bottom + 13} textAnchor="middle">
          {label}
        </text>
      ))}
      <text x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 2} textAnchor="middle">
        {props.xLabel}
      </text>
    </g>
  );
}

/** Number of eigenvalues below λ (steps) against Weyl's law (dashed). */
export function CountingChart({ spectrum }: { spectrum: SpectrumData }) {
  const shown = Math.min(spectrum.values.length, 120);
  const top = spectrum.values[shown - 1];
  const x = linear([0, top], [MARGIN.left, WIDTH - MARGIN.right]);
  const y = linear([0, shown], [HEIGHT - MARGIN.bottom, MARGIN.top]);
  const steps: [number, number][] = [[x(0), y(0)]];
  for (let k = 0; k < shown; k++) {
    const lambda = Math.max(0, spectrum.values[k]);
    steps.push([x(lambda), y(k)], [x(lambda), y(k + 1)]);
  }
  const weyl = Array.from({ length: 60 }, (_, k) => {
    const lambda = (top * k) / 59;
    return [
      x(lambda),
      y(Math.min(shown, weylCount(lambda, spectrum.area, spectrum.perimeter))),
    ] as const;
  });
  return (
    <figure>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Eigenvalue counting function">
        <Axes x={x} y={y} xLabel="λ" />
        <path className="series reference" d={path(weyl)} />
        <path className="series" d={path(steps)} />
      </svg>
      <figcaption>
        Eigenvalues below λ, for the first {shown} of {spectrum.values.length}. Dashed: Weyl&rsquo;s
        law (Aλ + P√λ) / 4π with this surface&rsquo;s area and boundary length. The mesh follows it
        until its eigenfunctions wiggle on the scale of an edge.
      </figcaption>
    </figure>
  );
}

/** Spectral dimension −2 d ln Z / d ln t of the heat trace, against t on a log axis. */
export function DimensionChart({ spectrum }: { spectrum: SpectrumData }) {
  const { times, dimension, exactDimension } = spectrum;
  const logs = Array.from(times, Math.log10);
  const x = linear([logs[0], logs[logs.length - 1]], [MARGIN.left, WIDTH - MARGIN.right]);
  const y = linear([0, 2.5], [HEIGHT - MARGIN.bottom, MARGIN.top]);
  const curve = (values: Float64Array) =>
    path(Array.from(values, (d, k) => [x(logs[k]), y(Math.min(2.5, Math.max(0, d)))] as const));
  const decades: [number, string][] = [];
  for (let p = Math.ceil(logs[0]); p <= logs[logs.length - 1]; p++) decades.push([p, `10^${p}`]);
  return (
    <figure>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Spectral dimension">
        <Axes x={x} y={y} xLabel="diffusion time t" xTicks={decades} />
        {exactDimension !== null && <path className="series reference" d={curve(exactDimension)} />}
        <path className="series" d={curve(dimension)} />
      </svg>
      <figcaption>
        Spectral dimension −2 d ln Z / d ln t of the heat trace Z(t) = Σ exp(−λt), from the computed
        eigenvalues and nothing else. It nears 2 only in between: at small t the mesh has too few
        modes, at large t the surface&rsquo;s finite size takes over.
        {exactDimension !== null && ' Dashed: the exact curve for the continuous square.'}
      </figcaption>
    </figure>
  );
}
