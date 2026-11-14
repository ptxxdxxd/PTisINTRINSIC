/** The compute worker: keeps the numerical work off the page's thread. */
import { ComputeService, type ComputeRequest, type ComputeResponse } from './protocol.ts';

/** The part of the dedicated-worker global scope used here. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<ComputeRequest>) => void) | null;
  postMessage(message: ComputeResponse): void;
}

const scope = self as unknown as WorkerScope;
const service = new ComputeService();
scope.onmessage = (event) => {
  scope.postMessage(service.handle(event.data));
};
