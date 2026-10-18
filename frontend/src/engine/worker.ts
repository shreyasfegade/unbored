/// <reference lib="webworker" />
/**
 * The engine's Web Worker, so ranking never stalls the reveal animation.
 * Messages: { id, req: EngineRequest } in, { id, ok, result | error } out.
 */
import { handle, type EngineRequest } from "./host";
import { PackError } from "./pack";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<{ id: number; req: EngineRequest }>) => {
  const { id, req } = e.data;
  try {
    const result = await handle(req);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    const kind = err instanceof PackError ? err.kind : "engine";
    self.postMessage({ id, ok: false, error: { kind, message: (err as Error).message } });
  }
};
