import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { toCsv, toObj, toVtk, type ExportField } from '../core/index.ts';
import { ComputeClient } from './client.ts';
import { cssGradient } from './colormap.ts';
import { FIELDS, contourStep, fieldRange, type FieldId } from './fields.ts';
import { download, formatNumber } from './format.ts';
import { PRESETS, type SpectrumData, type SurfaceSpec, type Triangulation } from './model.ts';
import { Inspector, Readouts, SpectrumPanel, SurfaceControls } from './Panels.tsx';
import type { Built } from './protocol.ts';

interface Job {
  readonly spec: SurfaceSpec;
  readonly triangulation: Triangulation;
}

// three.js is most of the download; load it after the page and its numbers are up.
const Viewport = lazy(() => import('./Viewport.tsx').then((m) => ({ default: m.Viewport })));

let sharedClient: ComputeClient | null = null;
const client = () => (sharedClient ??= new ComputeClient());

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function App() {
  const [job, setJob] = useState<Job>({ spec: PRESETS.bump.spec, triangulation: 'input' });
  const [result, setResult] = useState<{ job: Job; built: Built } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [field, setField] = useState<FieldId>('gaussian');
  const [contours, setContours] = useState(false);
  const [wireframe, setWireframe] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [sources, setSources] = useState<readonly number[]>([]);
  const [distance, setDistance] = useState<{ built: Built; values: Float64Array } | null>(null);
  const [spectrum, setSpectrum] = useState<{ built: Built; data: SpectrumData } | null>(null);
  const [spectrumBusy, setSpectrumBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [mode, setMode] = useState(1);

  useEffect(() => {
    let current = true;
    client()
      .build(job.spec, job.triangulation)
      .then(
        (built) => {
          if (!current) return;
          setResult({ job, built });
          setProblem(null);
        },
        (error: unknown) => {
          if (current) setProblem(message(error));
        },
      );
    return () => {
      current = false;
    };
  }, [job]);

  const built = result?.built ?? null;
  const building = result?.job !== job && problem === null;
  const busy = building || pending > 0;
  const distanceValues = distance !== null && distance.built === built ? distance.values : null;
  const spectrumData = spectrum !== null && spectrum.built === built ? spectrum.data : null;

  /** A new surface or triangulation invalidates everything picked or computed on the old one. */
  const startJob = (next: Job) => {
    setJob(next);
    setSources([]);
    setSelected(null);
    setSpectrumBusy(false);
  };

  const measureFrom = (target: Built, next: readonly number[]) => {
    setSources(next);
    setPending((count) => count + 1);
    client()
      .distance(next)
      .finally(() => {
        setPending((count) => count - 1);
      })
      .then(
        (values) => {
          setDistance({ built: target, values });
          setProblem(null);
        },
        (error: unknown) => {
          setProblem(message(error));
        },
      );
  };

  const computeSpectrum = (target: Built) => {
    setSpectrumBusy(true);
    setPending((count) => count + 1);
    client()
      .spectrum()
      .finally(() => {
        setPending((count) => count - 1);
      })
      .then(
        (data) => {
          setSpectrum({ built: target, data });
          setSpectrumBusy(false);
        },
        (error: unknown) => {
          setProblem(message(error));
          setSpectrumBusy(false);
        },
      );
  };

  const chooseField = (next: FieldId) => {
    setField(next);
    if (built === null || building) return;
    if (next === 'distance' && sources.length === 0) {
      measureFrom(built, [Math.floor(built.summary.vertices / 2)]);
    }
    if (next === 'eigen' && spectrumData === null && built.summary.spectrumAvailable) {
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
  const range = useMemo(() => fieldRange(values, info.map), [values, info.map]);
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
  const title = `Intrinsic: ${PRESETS[job.spec.kind].label}, ${built?.summary.vertices ?? 0} vertices`;

  return (
    <div className="app">
      <header className="masthead">
        <h1>Intrinsic</h1>
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
              description={`${PRESETS[job.spec.kind].label} coloured by ${info.label.toLowerCase()}`}
            />
          </Suspense>
        )}
        <div className="legend" aria-hidden={built === null}>
          <span data-testid="legend-low">{formatNumber(range[0])}</span>
          <span className="legend-bar" style={{ background: cssGradient(info.map) }} />
          <span data-testid="legend-high">{formatNumber(range[1])}</span>
        </div>
        <p className="status" role="status" data-testid="status">
          {problem !== null ? `Error: ${problem}` : busy ? 'Computing…' : 'Ready'}
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
          <label className="field">
            <span className="visually-hidden">Field</span>
            <select
              value={field}
              onChange={(event) => {
                chooseField(event.target.value as FieldId);
              }}
            >
              {Object.entries(FIELDS).map(([id, { label }]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="note">{info.note}</p>
          {field === 'distance' && (
            <p className="note" data-testid="sources">
              {sources.length === 0
                ? 'Click the surface to place a source.'
                : `From vertex ${sources.join(', ')}. Click to move the source; shift-click to add one.`}
            </p>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={wireframe}
              onChange={(event) => {
                setWireframe(event.target.checked);
              }}
            />
            Show edges
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={contours || field === 'distance'}
              disabled={field === 'distance'}
              onChange={(event) => {
                setContours(event.target.checked);
              }}
            />
            Contour lines{spacing > 0 ? ` every ${formatNumber(spacing)}` : ''}
          </label>
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
                busy={spectrumBusy}
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
              <div className="buttons">
                <button
                  type="button"
                  onClick={() => {
                    download(
                      'intrinsic.vtk',
                      toVtk(built.drawing, exportFields(built), title),
                      'text/plain',
                    );
                  }}
                >
                  VTK
                </button>
                <button
                  type="button"
                  onClick={() => {
                    download('intrinsic.obj', toObj(built.drawing, title), 'text/plain');
                  }}
                >
                  OBJ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    download(
                      'intrinsic.csv',
                      toCsv(built.drawing, exportFields(built)),
                      'text/csv',
                    );
                  }}
                >
                  CSV
                </button>
              </div>
              <p className="note">
                The mesh as drawn, with every field computed so far. VTK opens in ParaView.
              </p>
            </section>
          </>
        )}

        <section aria-labelledby="about">
          <h2 id="about">What this is</h2>
          <p className="note">
            Every number here is computed in your browser from the edge lengths of the mesh. Each
            method is tested against a closed-form answer and against libigl, geometry-central,
            SciPy and mpmath; the repository has the tests and the measured accuracy.
          </p>
        </section>
      </aside>
    </div>
  );
}
