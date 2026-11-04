/** Runs Python in the Pyodide worker with a wall-clock limit. Browser only. */
export interface PyResult {
  ok: boolean;
  stdout: string;
  error?: string;
  /** Where it failed: loading Python, the learner's code, the tests, or the time limit. */
  phase?: "load" | "code" | "tests" | "timeout";
  ms: number;
}

export const PY_TIMEOUT_MS = 10_000;
/** First run downloads Python (~10 MB, cached afterwards). */
const FIRST_RUN_TIMEOUT_MS = 90_000;

let worker: Worker | null = null;
let warmed = false;
let seq = 0;

function getWorker() {
  worker ??= new Worker(new URL("./pyodide.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/** Kill the worker (stops runaway code instantly); the next run starts a fresh interpreter. */
export function resetPython() {
  worker?.terminate();
  worker = null;
  warmed = false;
}

export function runPython(code: string, tests?: string, timeoutMs = PY_TIMEOUT_MS): Promise<PyResult> {
  const w = getWorker();
  const id = ++seq;
  const started = performance.now();
  const limit = warmed ? timeoutMs : FIRST_RUN_TIMEOUT_MS;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      w.removeEventListener("message", onMsg);
      resetPython();
      resolve({ ok: false, phase: "timeout", stdout: "", error: `Stopped after ${Math.round(limit / 1000)}s — check for an infinite loop.`, ms: limit });
    }, limit);
    function onMsg(e: MessageEvent<{ id: number } & Omit<PyResult, "ms">>) {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      w.removeEventListener("message", onMsg);
      if (e.data.phase !== "load") warmed = true;
      resolve({ ...e.data, ms: Math.round(performance.now() - started) });
    }
    w.addEventListener("message", onMsg);
    w.postMessage({ id, code, tests });
  });
}
