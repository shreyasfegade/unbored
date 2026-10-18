/**
 * Main-thread handle on the engine. Requests go to the Web Worker; if one
 * can't be started (tests, a blocked worker), the engine runs inline instead,
 * same code and same answers.
 */
import type { EngineRequest, ExplainResult } from "./host";
import { PackError } from "./pack";
import type { PipelineResult } from "./pipeline";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  if (typeof Worker === "undefined" || import.meta.env?.MODE === "test") {
    workerBroken = true;
    return null;
  }
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, result, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(error.kind === "network" || error.kind === "corrupt" ? new PackError(error.kind, error.message) : new Error(error.message));
    };
    worker.onerror = () => {
      // A worker that can't even load: fail what's waiting, run inline from now on.
      workerBroken = true;
      worker = null;
      for (const p of pending.values()) p.reject(new Error("engine worker failed"));
      pending.clear();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

async function call<T>(req: EngineRequest): Promise<T> {
  const w = getWorker();
  if (!w) {
    const { handle } = await import("./host");
    return (await handle(req)) as T;
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, req });
  });
}

export const engine = {
  /** Start loading the pack and building the index in the background. */
  warm: () => call<null>({ op: "warm" }),
  recommend: (body: Extract<EngineRequest, { op: "recommend" }>["body"], opts?: Extract<EngineRequest, { op: "recommend" }>["opts"]) =>
    call<PipelineResult>({ op: "recommend", body, opts }),
  explain: (body: Extract<EngineRequest, { op: "explain" }>["body"], targetId: string) =>
    call<ExplainResult>({ op: "explain", body, targetId }),
};
