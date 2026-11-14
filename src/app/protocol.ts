/** Messages between the page and the compute worker. */
import {
  Session,
  type Drawing,
  type Fields,
  type SpectrumData,
  type Summary,
  type SurfaceSpec,
  type Triangulation,
} from './model.ts';

export type ComputeRequest =
  | {
      readonly id: number;
      readonly type: 'build';
      readonly spec: SurfaceSpec;
      readonly triangulation: Triangulation;
    }
  | { readonly id: number; readonly type: 'distance'; readonly sources: readonly number[] }
  | { readonly id: number; readonly type: 'spectrum' };

export interface Built {
  readonly drawing: Drawing;
  readonly fields: Fields;
  readonly summary: Summary;
}

export type ComputeResponse =
  | ({ readonly id: number; readonly type: 'built' } & Built)
  | { readonly id: number; readonly type: 'distance'; readonly values: Float64Array }
  | { readonly id: number; readonly type: 'spectrum'; readonly spectrum: SpectrumData }
  | { readonly id: number; readonly type: 'error'; readonly message: string };

/** The worker's state machine, separate from the worker so it can be tested directly. */
export class ComputeService {
  private session: Session | null = null;

  handle(request: ComputeRequest): ComputeResponse {
    const { id } = request;
    try {
      if (request.type === 'build') {
        this.session = new Session(request.spec, request.triangulation);
        const { drawing, fields, summary } = this.session;
        return { id, type: 'built', drawing, fields, summary };
      }
      if (this.session === null) throw new Error('no surface has been built yet');
      if (request.type === 'distance') {
        return { id, type: 'distance', values: this.session.distance(request.sources) };
      }
      return { id, type: 'spectrum', spectrum: this.session.spectrum() };
    } catch (error) {
      return { id, type: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }
}
