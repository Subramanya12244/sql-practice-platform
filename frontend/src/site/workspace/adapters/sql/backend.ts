/**
 * Where the SQL adapter gets its database. The adapter never starts a second PGlite: in the app it calls the existing worker
 * (lib/browserDb.ts); in tests the same existing runner functions (lib/sqlRunner.ts `execute` and `submit`) are pointed at a
 * PGlite instance. Both paths keep every statement rolled back.
 */
import { createContext } from "react";
import type { ExecuteResult, SubmitResult } from "../../../../types";
import type { OrderKey } from "../../../lib/resultCompare";
import { HIDDEN_ROWS, execute, submit, type RunOptions, type SqlDb } from "../../../lib/sqlRunner";

export interface SqlBackend {
  /**
   * Run one SQL text (rolled back). Never throws: a failure is `{ success: false }`. With `opts.policy` the backend must check the
   * SQL against the policy before it reaches the database (lib/sqlRunner does; a backend that ignores it is a bug).
   */
  run(sql: string, dataset: string, opts?: Pick<RunOptions, "policy">): Promise<ExecuteResult>;
  /** The existing grader: run the learner's SQL and the reference, compare, and (on Northwind) check hidden test rows. */
  submit(sql: string, reference: string, sortRequired: boolean, orderBy: OrderKey[] | null, dataset: string, opts?: Pick<RunOptions, "policy">): Promise<SubmitResult>;
  /** Throw away the dataset's database so the next run starts from a fresh copy. */
  reset(dataset: string): void | Promise<void>;
}

/** The app's backend: the existing PGlite worker. `lib/browserDb` is loaded on first use so importing the adapter stays light. */
export const browserBackend: SqlBackend = {
  async run(sql, dataset, opts) {
    const db = await import("../../../lib/browserDb");
    // Without a policy: the app's own runner path, unchanged. With one: the same worker and the same time limit, but the shared
    // runner checks the policy first. (browserDb.runQuery has no policy parameter; see docs/WORKSPACE_SQL_SAFETY.md, interface request.)
    if (!opts?.policy) return db.runQuery(sql, dataset);
    return withLimit<ExecuteResult>(db, dataset, (h) => execute(h, sql, opts), () => ({ success: false, columns: [], rows: [], error_type: "TIMEOUT", message: TIMEOUT_MESSAGE(db.QUERY_TIMEOUT_MS) }));
  },
  async submit(sql, reference, sortRequired, orderBy, dataset, opts) {
    const db = await import("../../../lib/browserDb");
    if (!opts?.policy) return db.submitQuery(sql, reference, sortRequired, orderBy, dataset);
    return withLimit<SubmitResult>(db, dataset, (h) => submit(h, sql, reference, sortRequired, orderBy, dataset === "northwind" ? HIDDEN_ROWS : null, opts), () => ({ correct: false, message: TIMEOUT_MESSAGE(db.QUERY_TIMEOUT_MS), feedback: [], level_changed: false }));
  },
  async reset(dataset) {
    const { resetDb } = await import("../../../lib/browserDb");
    resetDb(dataset);
  },
};

/** browserDb's time limit (a runaway query cannot be cancelled in wasm: the worker is dropped and restarted) around a policy-checked call. */
async function withLimit<T>(db: typeof import("../../../lib/browserDb"), dataset: string, work: (h: SqlDb) => Promise<T>, onTimeout: () => T): Promise<T> {
  const handle = await db.getDb(dataset);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => { timer = setTimeout(() => { db.resetDb(dataset); resolve(onTimeout()); }, db.QUERY_TIMEOUT_MS); });
  try { return await Promise.race([work(handle.db), timeout]); } finally { clearTimeout(timer); }
}

export const TIMEOUT_MESSAGE = (ms: number) => `Query took longer than ${ms / 1000}s and was stopped.`;

/**
 * A backend over one PGlite / `SqlDb` instance, using the same `execute` and `submit` the app uses. `timeoutMs` mirrors
 * browserDb's limit (a runaway query cannot be cancelled inside wasm, so the caller gets a TIMEOUT result and the query is
 * left to finish). Hidden test rows apply to Northwind only, as in browserDb.submitQuery.
 */
export function createDbBackend(db: SqlDb, opts: { timeoutMs?: number; onReset?: (dataset: string) => void } = {}): SqlBackend {
  const limited = <T,>(work: Promise<T>, onTimeout: () => T): Promise<T> => {
    if (!opts.timeoutMs) return work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(onTimeout()), opts.timeoutMs); });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  };
  return {
    run: (sql, _dataset, runOpts) => limited(execute(db, sql, runOpts), () => ({ success: false, columns: [], rows: [], error_type: "TIMEOUT", message: TIMEOUT_MESSAGE(opts.timeoutMs!) })),
    submit: (sql, reference, sortRequired, orderBy, dataset, runOpts) =>
      limited(submit(db, sql, reference, sortRequired, orderBy, dataset === "northwind" ? HIDDEN_ROWS : null, runOpts), () => ({ correct: false, message: TIMEOUT_MESSAGE(opts.timeoutMs!), feedback: [], level_changed: false })),
    reset: (dataset) => opts.onReset?.(dataset),
  };
}

/** The visualizer reads its backend from here (for EXPLAIN ANALYZE and the compare tab). Defaults to the app's worker. */
export const SqlBackendContext = createContext<SqlBackend>(browserBackend);
