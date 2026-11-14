import type { ReactNode } from 'react';
import { toCsv, toObj, toVtk, type ExportField, type ExportMesh } from '../core/index.ts';
import { CountingChart, DimensionChart } from './Charts.tsx';
import { FIELDS, type FieldId } from './fields.ts';
import { download, formatMilliseconds, formatNumber } from './format.ts';
import {
  EIGENFUNCTIONS_KEPT,
  PRESETS,
  coneSectors,
  type Fields,
  type SpectrumData,
  type Summary,
  type SurfaceKind,
  type SurfaceSpec,
} from './model.ts';

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  display?: string;
}) {
  return (
    <label className="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-valuetext={props.display}
        onChange={(event) => {
          props.onChange(Number(event.target.value));
        }}
      />
      <output>{props.display ?? formatNumber(props.value)}</output>
    </label>
  );
}

export function SurfaceControls(props: {
  spec: SurfaceSpec;
  onChange: (spec: SurfaceSpec) => void;
}) {
  const { spec, onChange } = props;
  return (
    <>
      <label className="field">
        <span className="visually-hidden">Surface</span>
        <select
          value={spec.kind}
          onChange={(event) => {
            onChange(PRESETS[event.target.value as SurfaceKind].spec);
          }}
        >
          {Object.entries(PRESETS).map(([kind, preset]) => (
            <option key={kind} value={kind}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      {spec.kind === 'cone' ? (
        <>
          <Slider
            label="Rings"
            min={3}
            max={22}
            step={1}
            value={spec.rings}
            display={`${spec.rings} × ${coneSectors(spec.rings)}`}
            onChange={(rings) => {
              onChange({ ...spec, rings });
            }}
          />
          <Slider
            label="Apex angle deficit"
            min={0.1}
            max={5.5}
            step={0.1}
            value={spec.deficit}
            display={`${formatNumber(spec.deficit)} rad`}
            onChange={(deficit) => {
              onChange({ ...spec, deficit });
            }}
          />
        </>
      ) : (
        <>
          <Slider
            label="Cells per side"
            min={4}
            max={32}
            step={2}
            value={spec.resolution}
            onChange={(resolution) => {
              onChange({ ...spec, resolution });
            }}
          />
          <Slider
            label="Vertex jitter"
            min={0}
            max={0.2}
            step={0.01}
            value={spec.jitter}
            onChange={(jitter) => {
              onChange({ ...spec, jitter });
            }}
          />
          {spec.kind === 'bump' && (
            <>
              <Slider
                label="Height"
                min={-1.5}
                max={1.5}
                step={0.05}
                value={spec.height}
                onChange={(height) => {
                  onChange({ ...spec, height });
                }}
              />
              <Slider
                label="Width"
                min={0.2}
                max={1}
                step={0.05}
                value={spec.width}
                onChange={(width) => {
                  onChange({ ...spec, width });
                }}
              />
            </>
          )}
          {spec.kind === 'saddle' && (
            <Slider
              label="Bend"
              min={-1.5}
              max={1.5}
              step={0.05}
              value={spec.bend}
              onChange={(bend) => {
                onChange({ ...spec, bend });
              }}
            />
          )}
          {spec.kind === 'cap' && (
            <Slider
              label="Sphere radius"
              min={1.5}
              max={6}
              step={0.1}
              value={spec.radius}
              onChange={(radius) => {
                onChange({ ...spec, radius });
              }}
            />
          )}
        </>
      )}
    </>
  );
}

function Row(props: { label: string; children: ReactNode; id?: string; value?: number }) {
  return (
    <div className="row">
      <dt>{props.label}</dt>
      <dd data-testid={props.id} data-value={props.value}>
        {props.children}
      </dd>
    </div>
  );
}

export function Readouts({ summary }: { summary: Summary }) {
  const { timings } = summary;
  return (
    <>
      <section aria-labelledby="gauss-bonnet">
        <h2 id="gauss-bonnet">Gauss–Bonnet check</h2>
        <dl>
          <Row label="Sum of angle defects" id="total-curvature">
            {summary.totalCurvature.toFixed(12)}
          </Row>
          <Row label={`2π × Euler characteristic (${summary.eulerCharacteristic})`}>
            {summary.gaussBonnetTarget.toFixed(12)}
          </Row>
          <Row label="Difference" id="gauss-bonnet-residual" value={summary.gaussBonnetResidual}>
            {formatNumber(summary.gaussBonnetResidual)}
          </Row>
        </dl>
        <p className="note">
          The two agree to rounding on any mesh, however coarse: a theorem. As a check it covers the
          mesh connectivity and each triangle&rsquo;s angle sum, not the individual angles.
        </p>
      </section>
      <section aria-labelledby="accuracy">
        <h2 id="accuracy">Against the exact surface</h2>
        <dl>
          {summary.apex !== null && (
            <Row label="Apex defect, computed / prescribed" id="apex">
              {summary.apex.computed.toFixed(12)} / {summary.apex.exact.toFixed(12)}
            </Row>
          )}
          <Row label="Largest curvature error" id="max-error" value={summary.maxCurvatureError}>
            {formatNumber(summary.maxCurvatureError)}
          </Row>
          <Row label="Root-mean-square error">{formatNumber(summary.rmsCurvatureError)}</Row>
        </dl>
        <p className="note">
          Pointwise curvature converges on regular meshes only. Add jitter and the error stops
          shrinking with resolution.
        </p>
      </section>
      <section aria-labelledby="mesh">
        <h2 id="mesh">Mesh</h2>
        <dl>
          <Row label="Vertices / edges / faces" id="counts" value={summary.vertices}>
            {summary.vertices} / {summary.edges} / {summary.faces}
          </Row>
          <Row label="Area">{formatNumber(summary.area)}</Row>
          <Row label="Non-Delaunay edges as generated" id="non-delaunay-input">
            {summary.nonDelaunayInput}
          </Row>
          <Row label="Flips made / non-Delaunay edges left" id="flips" value={summary.flips}>
            {summary.flips} / {summary.nonDelaunay}
          </Row>
          <Row
            label="Smallest cotan weight"
            id="smallest-weight"
            value={summary.smallestCotanWeight}
          >
            {formatNumber(summary.smallestCotanWeight)}
          </Row>
          <Row label="Time: mesh, flips, curvature">
            {formatMilliseconds(timings.generate)}, {formatMilliseconds(timings.flip)},{' '}
            {formatMilliseconds(timings.curvature)}
          </Row>
        </dl>
      </section>
    </>
  );
}

export function Inspector(props: {
  vertex: number | null;
  fields: Fields;
  distance: Float64Array | null;
}) {
  const { vertex, fields, distance } = props;
  if (vertex === null || vertex >= fields.area.length) {
    return <p className="note">Click the surface to inspect a vertex.</p>;
  }
  return (
    <dl data-testid="inspector">
      <Row label="Vertex">
        {vertex}
        {fields.boundary[vertex] === 1 ? ' (boundary)' : ''}
      </Row>
      <Row label="Neighbours">{fields.degree[vertex]}</Row>
      <Row label="Angle defect">{formatNumber(fields.angleDefect[vertex])}</Row>
      <Row label="Gaussian curvature">{formatNumber(fields.gaussian[vertex])}</Row>
      <Row label="Exact curvature">{formatNumber(fields.exact[vertex])}</Row>
      <Row label="Vertex area">{formatNumber(fields.area[vertex])}</Row>
      {distance !== null && <Row label="Distance">{formatNumber(distance[vertex])}</Row>}
    </dl>
  );
}

export function SpectrumPanel(props: {
  summary: Summary;
  spectrum: SpectrumData | null;
  busy: boolean;
  onCompute: () => void;
  mode: number;
  onMode: (mode: number) => void;
  showMode: boolean;
}) {
  const { summary, spectrum } = props;
  if (!summary.spectrumAvailable) {
    return (
      <p className="note">
        The eigenvalues come from a dense solve, limited to 1,100 vertices. This mesh has{' '}
        {summary.vertices}.
      </p>
    );
  }
  if (spectrum === null) {
    return (
      <>
        <p className="note">
          All {summary.vertices} eigenvalues of the Laplacian, by a dense symmetric eigensolve. It
          can take several seconds on the larger meshes; the time is reported.
        </p>
        <button type="button" onClick={props.onCompute} disabled={props.busy}>
          {props.busy ? 'Computing…' : 'Compute spectrum'}
        </button>
      </>
    );
  }
  return (
    <>
      <p className="note" data-testid="spectrum-summary">
        {spectrum.values.length} eigenvalues in {formatMilliseconds(spectrum.milliseconds)}. The
        first is {formatNumber(spectrum.values[0])} (constants); the next three are{' '}
        {[1, 2, 3].map((k) => formatNumber(spectrum.values[k])).join(', ')}.
      </p>
      {props.showMode && (
        <Slider
          label="Mode shown"
          min={1}
          max={Math.min(EIGENFUNCTIONS_KEPT, spectrum.values.length) - 1}
          step={1}
          value={props.mode}
          display={`${props.mode}: λ = ${formatNumber(spectrum.values[props.mode])}`}
          onChange={props.onMode}
        />
      )}
      <CountingChart spectrum={spectrum} />
      <DimensionChart spectrum={spectrum} />
    </>
  );
}

export function ColourControls(props: {
  field: FieldId;
  onField: (field: FieldId) => void;
  sources: readonly number[];
  /** Vertices of the surface on screen, or null while the first one computes. */
  vertexCount: number | null;
  onSource: (vertex: number) => void;
  wireframe: boolean;
  onWireframe: (on: boolean) => void;
  contours: boolean;
  onContours: (on: boolean) => void;
  contourSpacing: number;
}) {
  const { field, sources, vertexCount } = props;
  const distance = field === 'distance';
  return (
    <>
      <label className="field">
        <span className="visually-hidden">Field</span>
        <select
          value={field}
          onChange={(event) => {
            props.onField(event.target.value as FieldId);
          }}
        >
          {Object.entries(FIELDS).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="note">{FIELDS[field].note}</p>
      {distance && (
        <p className="note" data-testid="sources">
          {sources.length === 0
            ? 'Click the surface to place a source.'
            : `From vertex ${sources.join(', ')}. Click to move the source; shift-click to add one.`}
        </p>
      )}
      {distance && vertexCount !== null && (
        <label className="field inline">
          <span>Source vertex</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={vertexCount - 1}
            value={sources.length === 0 ? '' : sources[sources.length - 1]}
            onChange={(event) => {
              const vertex = event.target.valueAsNumber;
              if (Number.isInteger(vertex) && vertex >= 0 && vertex < vertexCount) {
                props.onSource(vertex);
              }
            }}
          />
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={props.wireframe}
          onChange={(event) => {
            props.onWireframe(event.target.checked);
          }}
        />
        Show edges
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={props.contours || distance}
          disabled={distance}
          onChange={(event) => {
            props.onContours(event.target.checked);
          }}
        />
        Contour lines
        {props.contourSpacing > 0 ? ` every ${formatNumber(props.contourSpacing)}` : ''}
      </label>
    </>
  );
}

export function ExportButtons(props: {
  drawing: ExportMesh;
  fields: readonly ExportField[];
  title: string;
}) {
  const { drawing, fields, title } = props;
  return (
    <>
      <div className="buttons">
        <button
          type="button"
          onClick={() => {
            download('intrinsic.vtk', toVtk(drawing, fields, title), 'text/plain');
          }}
        >
          VTK
        </button>
        <button
          type="button"
          onClick={() => {
            download('intrinsic.obj', toObj(drawing, title), 'text/plain');
          }}
        >
          OBJ
        </button>
        <button
          type="button"
          onClick={() => {
            download('intrinsic.csv', toCsv(drawing, fields), 'text/csv');
          }}
        >
          CSV
        </button>
      </div>
      <p className="note">
        The mesh as drawn, with every field computed so far. VTK opens in ParaView.
      </p>
    </>
  );
}
