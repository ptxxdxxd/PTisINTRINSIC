import { Suspense, lazy, useMemo, useState } from 'react';
import type { ExportField } from '../core/index.ts';
import { cssGradient } from './colormap.ts';
import { useComputation, type Job } from './computation.ts';
import { FIELDS, contourStep, fieldRange, type FieldId } from './fields.ts';
import { formatNumber } from './format.ts';
import { PRESETS } from './model.ts';
import {
  ColourControls,
  ExportButtons,
  Inspector,
  Readouts,
  SpectrumPanel,
  SurfaceControls,
} from './Panels.tsx';
import type { Built } from './protocol.ts';
import { AUTHOR, STAMP } from './signature.ts';

// three.js is most of the download; load it after the page and its numbers are up.
const Viewport = lazy(() => import('./Viewport.tsx').then((m) => ({ default: m.Viewport })));

export function App() {
  const [field, setField] = useState<FieldId>('gaussian');
  const [contours, setContours] = useState(false);
  const [wireframe, setWireframe] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState(1);
  const computation = useComputation(field);
  const { job, built, building, sources, measureFrom, computeSpectrum } = computation;
  const distanceValues = computation.distance;
  const spectrumData = computation.spectrum;

  const startJob = (next: Job) => {
    computation.startJob(next);
    setSelected(null);
  };

  const chooseField = (next: FieldId) => {
    setField(next);
    if (built === null || building) return;
    if (next === 'distance' && sources.length === 0) {
      measureFrom(built, [Math.floor(built.summary.vertices / 2)]);
    }
    if (
      next === 'eigen' &&
      spectrumData === null &&
      !computation.spectrumBusy &&
      built.summary.spectrumAvailable
    ) {
      computeSpectrum(built);
    }
  };

  const pickVertex = (vertex: number, add: boolean) => {
    setSelected(vertex);
    if (field !== 'distance' || built === null || building) return;
    measureFrom(built, add ? [...new Set([...sources, vertex])] : [vertex]);
  };

  const info = FIELDS[field];
  const values = useMemo(() => {
    if (built === null) return new Float64Array(0);
    const missing = () => new Float64Array(built.summary.vertices).fill(NaN);
    if (field === 'distance') return distanceValues ?? missing();
    if (field === 'eigen') return spectrumData?.vectors[mode] ?? missing();
    return built.fields[field];
  }, [built, field, distanceValues, spectrumData, mode]);
  const range = useMemo(
    () => fieldRange(values, info.map, info.floor),
    [values, info.map, info.floor],
  );
  // Nothing to show yet (a spectrum still computing): no numbers on the colour bar.
  const defined = useMemo(() => values.some(Number.isFinite), [values]);
  const spacing = contours || field === 'distance' ? contourStep(range) : 0;

  const exportFields = (target: Built): ExportField[] => {
    const { fields } = target;
    const list: ExportField[] = [
      { name: 'gaussian_curvature', values: fields.gaussian },
      { name: 'exact_curvature', values: fields.exact },
      { name: 'angle_defect', values: fields.angleDefect },
      { name: 'vertex_area', values: fields.area },
    ];
    if (distanceValues !== null) list.push({ name: 'geodesic_distance', values: distanceValues });
    if (spectrumData !== null) {
      list.push({ name: `eigenfunction_${mode}`, values: spectrumData.vectors[mode] });
    }
    return list;
  };
  const shown = computation.shownKind;
  const title = `PTisINTRINSIC: ${PRESETS[shown].label}, ${built?.summary.vertices ?? 0} vertices`;

  return (
    <div className="app">
      <header className="masthead">
        <h1>PTisINTRINSIC</h1>
        <p>
          Curvature, the Laplacian, its spectrum and geodesic distance on a triangle mesh, computed
          from edge lengths alone and checked against exact answers.
        </p>
      </header>

      <main className="stage">
        {built !== null && (
          <Suspense fallback={<div className="viewport" />}>
            <Viewport
              drawing={built.drawing}
              values={values}
              map={info.map}
              range={range}
              contourSpacing={spacing}
              wireframe={wireframe}
              sources={field === 'distance' ? sources : []}
              selected={selected}
              onPick={pickVertex}
              viewKey={shown}
              description={`${PRESETS[shown].label} coloured by ${info.label.toLowerCase()}. Click a vertex to inspect it.`}
            />
          </Suspense>
        )}
        <div className="legend" aria-hidden={built === null}>
          <span data-testid="legend-low">{defined ? formatNumber(range[0]) : '—'}</span>
          <span className="legend-bar" style={{ background: cssGradient(info.map) }} />
          <span data-testid="legend-high">{defined ? formatNumber(range[1]) : '—'}</span>
        </div>
        <p className="status" role="status" data-testid="status">
          {computation.problem !== null
            ? `Error: ${computation.problem}`
            : computation.busy
              ? 'Computing…'
              : 'Ready'}
        </p>
        {built !== null && !built.drawing.lengthsMatchPositions && (
          <p className="note">
            The numbers are for the exact cone, defined by its edge lengths. The picture places its
            vertices on a right circular cone, whose straight chords are slightly shorter.
          </p>
        )}
        {built !== null && built.summary.flips > 0 && (
          <p className="note">
            Drawn: the mesh as generated. Computed on: its intrinsic Delaunay triangulation, which
            has the same vertices and the same surface but {built.summary.flips} edges re-routed.
          </p>
        )}
      </main>

      <aside className="panel" aria-label="Controls and results">
        <section aria-labelledby="surface">
          <h2 id="surface">Surface</h2>
          <SurfaceControls
            spec={job.spec}
            onChange={(spec) => {
              startJob({ ...job, spec });
            }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={job.triangulation === 'delaunay'}
              onChange={(event) => {
                startJob({ ...job, triangulation: event.target.checked ? 'delaunay' : 'input' });
              }}
            />
            Compute on the intrinsic Delaunay triangulation
          </label>
        </section>

        <section aria-labelledby="colour">
          <h2 id="colour">Colour by</h2>
          <ColourControls
            field={field}
            onField={chooseField}
            sources={sources}
            vertexCount={built?.summary.vertices ?? null}
            onSource={(vertex) => {
              pickVertex(vertex, false);
            }}
            wireframe={wireframe}
            onWireframe={setWireframe}
            contours={contours}
            onContours={setContours}
            contourSpacing={spacing}
          />
        </section>

        {built !== null && (
          <>
            <section aria-labelledby="inspector">
              <h2 id="inspector">Vertex</h2>
              <Inspector vertex={selected} fields={built.fields} distance={distanceValues} />
            </section>
            <Readouts summary={built.summary} />
            <section aria-labelledby="spectrum">
              <h2 id="spectrum">Spectrum</h2>
              <SpectrumPanel
                summary={built.summary}
                spectrum={spectrumData}
                busy={computation.spectrumBusy}
                onCompute={() => {
                  computeSpectrum(built);
                }}
                mode={mode}
                onMode={setMode}
                showMode={field === 'eigen'}
              />
            </section>
            <section aria-labelledby="export">
              <h2 id="export">Export</h2>
              <ExportButtons drawing={built.drawing} fields={exportFields(built)} title={title} />
            </section>
          </>
        )}

        <section aria-labelledby="about">
          <h2 id="about">What this is</h2>
          <p className="note">
            Every number here is computed in your browser from the edge lengths of the mesh. The
            methods are tested against closed-form answers and against libigl, geometry-central,
            SciPy and mpmath; the repository says which is checked against what, and how closely.
          </p>
        </section>

        <footer className="signature">
          <pre aria-hidden="true">{STAMP}</pre>
          <span className="visually-hidden">Made by {AUTHOR}</span>
        </footer>
      </aside>
    </div>
  );
}
