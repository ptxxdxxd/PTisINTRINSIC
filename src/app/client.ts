import type { SpectrumData, SurfaceSpec, Triangulation } from './model.ts';
import type { Built, ComputeRequest, ComputeResponse } from './protocol.ts';

type Pending = (response: ComputeResponse) => void;
type Body = ComputeRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;

/** Promise interface to the compute worker. Requests are answered in the order they were sent. */
export class ComputeClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<ComputeResponse>) => {
      const resolve = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      resolve?.(event.data);
    };
  }

  private send(body: Body): Promise<ComputeResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ ...body, id });
    });
  }

  async build(spec: SurfaceSpec, triangulation: Triangulation): Promise<Built> {
    const response = await this.send({ type: 'build', spec, triangulation });
    if (response.type !== 'built') throw new Error(failure(response));
    return response;
  }

  async distance(sources: readonly number[]): Promise<Float64Array> {
    const response = await this.send({ type: 'distance', sources });
    if (response.type !== 'distance') throw new Error(failure(response));
    return response.values;
  }

  async spectrum(): Promise<SpectrumData> {
    const response = await this.send({ type: 'spectrum' });
    if (response.type !== 'spectrum') throw new Error(failure(response));
    return response.spectrum;
  }

  dispose(): void {
    this.worker.terminate();
  }
}

function failure(response: ComputeResponse): string {
  return response.type === 'error' ? response.message : `unexpected ${response.type} response`;
}
