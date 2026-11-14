import { useEffect, useEffectEvent, useState } from 'react';
import { ComputeClient } from './client.ts';
import type { FieldId } from './fields.ts';
import { PRESETS, type SpectrumData, type SurfaceSpec, type Triangulation } from './model.ts';
import type { Built } from './protocol.ts';

export interface Job {
  readonly spec: SurfaceSpec;
  readonly triangulation: Triangulation;
}

let sharedClient: ComputeClient | null = null;
const client = () => (sharedClient ??= new ComputeClient());

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The surface being computed and everything computed on it, kept in the worker. A distance
 * or a spectrum belongs to the surface it was computed on and is dropped when that changes.
 * `field` is the view on screen: a new surface recomputes what that view needs.
 */
export function useComputation(field: FieldId) {
  const [job, setJob] = useState<Job>({ spec: PRESETS.bump.spec, triangulation: 'input' });
  const [result, setResult] = useState<{ job: Job; built: Built } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sources, setSources] = useState<readonly number[]>([]);
  const [distance, setDistance] = useState<{ built: Built; values: Float64Array } | null>(null);
  const [spectrum, setSpectrum] = useState<{ built: Built; data: SpectrumData } | null>(null);
  const [spectrumBusy, setSpectrumBusy] = useState(false);
  const [pending, setPending] = useState(0);

  const built = result?.built ?? null;
  const building = result?.job !== job && problem === null;

  /** A new surface or triangulation invalidates everything picked or computed on the old one. */
  const startJob = (next: Job) => {
    setJob(next);
    setSources([]);
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

  // A distance or eigenfunction view shows numbers computed on one surface. When a new
  // surface arrives, compute them again rather than leave the view empty.
  const refreshView = useEffectEvent((target: Built) => {
    if (field === 'distance') measureFrom(target, [Math.floor(target.summary.vertices / 2)]);
    if (field === 'eigen' && target.summary.spectrumAvailable) computeSpectrum(target);
  });

  useEffect(() => {
    let current = true;
    client()
      .build(job.spec, job.triangulation)
      .then(
        (next) => {
          if (!current) return;
          setResult({ job, built: next });
          setProblem(null);
          refreshView(next);
        },
        (error: unknown) => {
          if (current) setProblem(message(error));
        },
      );
    return () => {
      current = false;
    };
  }, [job]);

  return {
    job,
    built,
    building,
    busy: building || pending > 0,
    problem,
    /** The kind of surface on screen, which lags the controls while a new one computes. */
    shownKind: result?.job.spec.kind ?? job.spec.kind,
    sources,
    distance: distance !== null && distance.built === built ? distance.values : null,
    spectrum: spectrum !== null && spectrum.built === built ? spectrum.data : null,
    spectrumBusy,
    startJob,
    measureFrom,
    computeSpectrum,
  };
}
