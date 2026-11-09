import { classifyError } from "./diagnostics";

/** Runs Python in the Pyodide worker with a wall-clock limit. Browser only. */
export interface PyResult {
  ok: boolean;
  stdout: string;
  error?: string;
  /** Where it failed: loading Python, the learner's code, the tests, or the time limit. */
  phase?: "load" | "code" | "tests" | "timeout" | "stopped";
  /** 1-based line in the learner's code that raised, when Python reports it. */
  errorLine?: number;
  ms: number;
}

export const PY_TIMEOUT_MS = 10_000;
/** First run downloads Python (~10 MB, cached afterwards). */
export const FIRST_RUN_TIMEOUT_MS = 90_000;

interface QueuedRun {
  id: number;
  code: string;
  tests?: string;
  timeoutMs: number;
  stdin: string;
  files?: Record<string, string>;
  resolve: (r: PyResult) => void;
}

interface ActiveRun {
  req: QueuedRun;
  timer: ReturnType<typeof setTimeout>;
  started: number;
  limit: number;
}

let worker: Worker | null = null;
let warmed = false;
let seq = 0;
let activeRun: ActiveRun | null = null;
const queue: QueuedRun[] = [];

type WorkerFactory = () => Worker;
let workerFactory: WorkerFactory = () =>
  new Worker(new URL("./pyodide.worker.ts", import.meta.url), { type: "module" });

/** For testing: allows injecting a mock Worker factory. */
export function setWorkerFactoryForTest(fn: WorkerFactory | null) {
  if (fn) {
    workerFactory = fn;
  } else {
    workerFactory = () =>
      new Worker(new URL("./pyodide.worker.ts", import.meta.url), { type: "module" });
  }
}

export const isPythonWarmed = (): boolean => warmed;

/** Diagnostic insight into current queue state for tests and Debug Center. */
export function getQueueStatus() {
  return {
    isRunning: activeRun !== null,
    activeId: activeRun?.req.id ?? null,
    queuedCount: queue.length,
    warmed,
  };
}

function handleWorkerMessage(e: MessageEvent<{ id: number } & Omit<PyResult, "ms">>) {
  if (!activeRun || activeRun.req.id !== e.data.id) {
    // Ignore stale message or mismatch from previous/aborted runs
    return;
  }

  const current = activeRun;
  activeRun = null;
  clearTimeout(current.timer);

  if (e.data.phase !== "load") {
    warmed = true;
  }

  const res: PyResult = {
    ...e.data,
    ms: Math.round(performance.now() - current.started),
  };

  if (!res.ok && res.error) {
    if (res.phase === "load") {
      classifyError(res.error, "PYTHON_RUNTIME_ERROR", "python_workspace");
    } else if (res.phase === "tests") {
      classifyError(res.error, "ASSESSMENT_ERROR", "python_practice");
    } else {
      classifyError(res.error, "PYTHON_EXECUTION_ERROR", "python_workspace");
    }
  }

  current.req.resolve(res);
  pumpQueue();
}

function handleWorkerError(e: ErrorEvent | Error | unknown) {
  if (!activeRun) return;

  const current = activeRun;
  activeRun = null;
  clearTimeout(current.timer);

  const errMsg = e instanceof ErrorEvent ? e.message : (e as Error)?.message || "Unknown worker error occurred.";
  terminateWorkerAndSettle("load", `Worker error: ${errMsg}`);

  current.req.resolve({
    ok: false,
    phase: "load",
    stdout: "",
    error: `Worker crashed: ${errMsg}`,
    ms: Math.round(performance.now() - current.started),
  });
}

function getWorker(): Worker {
  if (!worker) {
    worker = workerFactory();
    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
  }
  return worker;
}

function terminateWorker() {
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  }
  warmed = false;
}

function terminateWorkerAndSettle(phase: "stopped" | "timeout" | "load", errorReason: string) {
  terminateWorker();

  // Settle active run if present
  if (activeRun) {
    const current = activeRun;
    activeRun = null;
    clearTimeout(current.timer);
    const ms = phase === "timeout" ? current.limit : Math.round(performance.now() - current.started);
    current.req.resolve({
      ok: false,
      phase,
      stdout: "",
      error: errorReason,
      ms,
    });
  }

  // Settle all queued runs with "stopped" so callers never hang
  while (queue.length > 0) {
    const waiting = queue.shift()!;
    waiting.resolve({
      ok: false,
      phase: "stopped",
      stdout: "",
      error: `Execution cancelled: worker was terminated (${errorReason}).`,
      ms: 0,
    });
  }
}

function pumpQueue() {
  if (activeRun !== null || queue.length === 0) {
    return;
  }

  const nextReq = queue.shift()!;
  let w: Worker;
  try {
    w = getWorker();
  } catch (err) {
    // If worker creation failed synchronously
    nextReq.resolve({
      ok: false,
      phase: "load",
      stdout: "",
      error: `Failed to create worker: ${(err as Error).message ?? err}`,
      ms: 0,
    });
    pumpQueue();
    return;
  }

  const limit =
    nextReq.timeoutMs !== PY_TIMEOUT_MS
      ? nextReq.timeoutMs
      : warmed
      ? PY_TIMEOUT_MS
      : FIRST_RUN_TIMEOUT_MS;
  const started = performance.now();

  const timer = setTimeout(() => {
    if (activeRun && activeRun.req.id === nextReq.id) {
      const timeoutErr = `Stopped after ${Math.round(limit / 1000)}s — check for an infinite loop.`;
      classifyError(timeoutErr, "PYTHON_EXECUTION_ERROR", "python_workspace", { code: "PY_TIMEOUT" });
      terminateWorkerAndSettle("timeout", timeoutErr);
    }
  }, limit);

  activeRun = {
    req: nextReq,
    timer,
    started,
    limit,
  };

  try {
    w.postMessage({
      id: nextReq.id,
      code: nextReq.code,
      tests: nextReq.tests,
      stdin: nextReq.stdin,
      files: nextReq.files,
    });
  } catch (postErr) {
    clearTimeout(timer);
    activeRun = null;
    nextReq.resolve({
      ok: false,
      phase: "load",
      stdout: "",
      error: `Failed to post message to worker: ${(postErr as Error).message ?? postErr}`,
      ms: 0,
    });
    pumpQueue();
  }
}

/** Kill the worker (stops runaway code instantly); the next run starts a fresh interpreter. */
export function resetPython(reason = "Interpreter reset.") {
  terminateWorkerAndSettle("stopped", reason);
}

/** Stop whatever is running now; pending runs resolve as "stopped". */
export function stopPython() {
  terminateWorkerAndSettle("stopped", "Stopped.");
}

export function runPython(
  code: string,
  tests?: string,
  timeoutMs = PY_TIMEOUT_MS,
  stdin = "",
  files?: Record<string, string>
): Promise<PyResult> {
  return new Promise<PyResult>((resolve) => {
    const item: QueuedRun = {
      id: ++seq,
      code,
      tests,
      timeoutMs,
      stdin,
      files,
      resolve,
    };
    queue.push(item);
    pumpQueue();
  });
}
