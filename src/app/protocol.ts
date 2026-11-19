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

type Message = Readonly<Record<string, unknown>>;

const isMessage = (value: unknown): value is Message =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumberList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'number');

/** Only the message's own keys count; an inherited one such as `toString` is not a field. */
const own = (message: Message, name: string): unknown =>
  Object.hasOwn(message, name) ? message[name] : undefined;

const show = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
};

function numberField(message: Message, name: string, where: string): number {
  const value = own(message, name);
  if (typeof value !== 'number') {
    throw new TypeError(`${where}.${name} must be a number, got ${show(value)}`);
  }
  return value;
}

/**
 * The surface spec rebuilt from the fields its kind uses, so nothing else in the message
 * travels on. The numbers' ranges are checked by the surface constructors in `src/core`.
 */
function parseSpec(value: unknown): SurfaceSpec {
  if (!isMessage(value)) throw new TypeError(`request.spec must be an object, got ${show(value)}`);
  const number = (name: string) => numberField(value, name, 'request.spec');
  const grid = () => ({
    resolution: number('resolution'),
    jitter: number('jitter'),
    seed: number('seed'),
  });
  const kind = own(value, 'kind');
  switch (kind) {
    case 'plane':
      return { kind, ...grid() };
    case 'bump':
      return { kind, ...grid(), height: number('height'), width: number('width') };
    case 'saddle':
      return { kind, ...grid(), bend: number('bend') };
    case 'cap':
      return { kind, ...grid(), radius: number('radius') };
    case 'cone':
      return { kind, rings: number('rings'), deficit: number('deficit') };
    default:
      throw new TypeError(
        `request.spec.kind must be plane, bump, saddle, cap or cone, got ${show(kind)}`,
      );
  }
}

/**
 * Checks a message from the page against `ComputeRequest` and returns a copy made of the
 * expected fields only. The worker's messages come from this app's own page, but they are
 * where data crosses into the worker, so they are checked there once.
 */
export function parseRequest(message: unknown): ComputeRequest {
  if (!isMessage(message)) throw new TypeError(`request must be an object, got ${show(message)}`);
  const id = own(message, 'id');
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
    throw new TypeError(`request.id must be an integer, got ${show(id)}`);
  }
  const type = own(message, 'type');
  switch (type) {
    case 'build': {
      const triangulation = own(message, 'triangulation');
      if (triangulation !== 'input' && triangulation !== 'delaunay') {
        throw new TypeError(
          `request.triangulation must be "input" or "delaunay", got ${show(triangulation)}`,
        );
      }
      return { id, type, spec: parseSpec(own(message, 'spec')), triangulation };
    }
    case 'distance': {
      const sources = own(message, 'sources');
      if (!isNumberList(sources)) {
        throw new TypeError(`request.sources must be an array of numbers, got ${show(sources)}`);
      }
      return { id, type, sources: [...sources] };
    }
    case 'spectrum':
      return { id, type };
    default:
      throw new TypeError(
        `request.type must be "build", "distance" or "spectrum", got ${show(type)}`,
      );
  }
}

/** The worker's state machine, separate from the worker so it can be tested directly. */
export class ComputeService {
  private session: Session | null = null;

  handle(message: unknown): ComputeResponse {
    // Answer under the message's id when it has one, so the caller's request settles.
    const claimed = isMessage(message) ? own(message, 'id') : undefined;
    const id = typeof claimed === 'number' ? claimed : -1;
    try {
      const request = parseRequest(message);
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
