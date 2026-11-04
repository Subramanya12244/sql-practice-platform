import type { ExecuteResult, SubmitResult, TableSchema } from "../../types";
import { execute, submit, type SqlDb } from "./sqlRunner";
import type { OrderKey } from "./resultCompare";

const QUERY_TIMEOUT_MS = 8000;

interface Handle {
  db: SqlDb;
  terminate: () => void;
}

let handle: Promise<Handle> | null = null;

/** Start (once) a PGlite worker seeded with Northwind. Browser only. */
export function getDb(): Promise<Handle> {
  if (!handle) {
    handle = (async () => {
      const { PGliteWorker } = await import("@electric-sql/pglite/worker");
      const w = new Worker(new URL("./pglite.worker.ts", import.meta.url), { type: "module" });
      const db = await PGliteWorker.create(w);
      return { db: db as unknown as SqlDb, terminate: () => w.terminate() };
    })().catch((err) => {
      handle = null;
      throw err;
    });
  }
  return handle;
}

/** A runaway query can't be cancelled inside wasm, so kill the worker and start fresh. */
async function withTimeout<T>(work: (db: SqlDb) => Promise<T>, onTimeout: () => T): Promise<T> {
  const h = await getDb();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      h.terminate();
      handle = null;
      resolve(onTimeout());
    }, QUERY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work(h.db), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const TIMEOUT_MSG = `Query took longer than ${QUERY_TIMEOUT_MS / 1000}s and was stopped.`;

export function runQuery(sql: string): Promise<ExecuteResult> {
  return withTimeout<ExecuteResult>(
    (db) => execute(db, sql),
    () => ({ success: false, columns: [], rows: [], error_type: "TIMEOUT", message: TIMEOUT_MSG }),
  );
}

/** Table/column list for editor autocomplete, read from the live database. */
export async function getSchemas(): Promise<TableSchema[]> {
  const { db } = await getDb();
  const [res] = await db.exec(
    `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
    { rowMode: "array" },
  );
  const byTable = new Map<string, TableSchema>();
  for (const [table, column, type, nullable] of res.rows as string[][]) {
    if (!byTable.has(table)) byTable.set(table, { table_name: table, columns: [] });
    byTable.get(table)!.columns.push({ name: column, data_type: type, is_nullable: nullable === "YES" });
  }
  return [...byTable.values()];
}

export function submitQuery(
  sql: string,
  reference: string,
  sortRequired: boolean,
  orderBy: OrderKey[] | null,
): Promise<SubmitResult> {
  return withTimeout<SubmitResult>(
    (db) => submit(db, sql, reference, sortRequired, orderBy),
    () => ({ correct: false, message: TIMEOUT_MSG, feedback: [], level_changed: false }),
  );
}
