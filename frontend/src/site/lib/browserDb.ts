import type { ExecuteResult, SubmitResult, TableSchema } from "../../types";
import { execute, submit, type SqlDb } from "./sqlRunner";
import type { OrderKey } from "./resultCompare";

const QUERY_TIMEOUT_MS = 8000;

interface Handle {
  db: SqlDb;
  terminate: () => void;
}

/** Where a dataset's SQL comes from: a shipped file, or SQL held in this browser. */
export type DatasetSource = { id: string; url: string } | { id: string; sql: string };
export const NORTHWIND: DatasetSource = { id: "northwind", url: "/data/northwind.sql" };

const handles = new Map<string, Promise<Handle>>();
const sources = new Map<string, DatasetSource>([[NORTHWIND.id, NORTHWIND]]);

/** Tell the runner how to load a dataset before querying it by id. */
export function registerDataset(src: DatasetSource) {
  const prev = sources.get(src.id);
  sources.set(src.id, src);
  // Changed content (e.g. a regenerated custom dataset): drop the old instance.
  if (prev && JSON.stringify(prev) !== JSON.stringify(src)) resetDb(src.id);
}

/** Start (once per dataset) a PGlite worker seeded with that dataset. Browser only. */
export function getDb(dataset = NORTHWIND.id): Promise<Handle> {
  let h = handles.get(dataset);
  if (!h) {
    const src = sources.get(dataset);
    if (!src) return Promise.reject(new Error(`Unknown dataset "${dataset}"`));
    h = (async () => {
      const { PGliteWorker } = await import("@electric-sql/pglite/worker");
      const w = new Worker(new URL("./pglite.worker.ts", import.meta.url), { type: "module" });
      const meta = "sql" in src ? { sql: src.sql } : { url: src.url };
      // A distinct id per dataset keeps PGlite's tab-leader election per instance.
      const db = await PGliteWorker.create(w, { id: `sqlp-${dataset}`, meta });
      return { db: db as unknown as SqlDb, terminate: () => w.terminate() };
    })().catch((err) => {
      handles.delete(dataset);
      throw err;
    });
    handles.set(dataset, h);
  }
  return h;
}

/** Throw away a dataset's instance; the next query reloads it from its source (a fresh copy). */
export function resetDb(dataset = NORTHWIND.id) {
  const h = handles.get(dataset);
  handles.delete(dataset);
  void h?.then((x) => x.terminate()).catch(() => undefined);
}

/** A runaway query can't be cancelled inside wasm, so kill the worker and start fresh. */
async function withTimeout<T>(work: (db: SqlDb) => Promise<T>, onTimeout: () => T, dataset = NORTHWIND.id): Promise<T> {
  const h = await getDb(dataset);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resetDb(dataset);
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

export function runQuery(sql: string, dataset = NORTHWIND.id): Promise<ExecuteResult> {
  return withTimeout<ExecuteResult>(
    (db) => execute(db, sql),
    () => ({ success: false, columns: [], rows: [], error_type: "TIMEOUT", message: TIMEOUT_MSG }),
    dataset,
  );
}

/** Table/column list for editor autocomplete, read from the live database. */
export async function getSchemas(dataset = NORTHWIND.id): Promise<TableSchema[]> {
  const { db } = await getDb(dataset);
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
  dataset = NORTHWIND.id,
): Promise<SubmitResult> {
  return withTimeout<SubmitResult>(
    (db) => submit(db, sql, reference, sortRequired, orderBy),
    () => ({ correct: false, message: TIMEOUT_MSG, feedback: [], level_changed: false }),
    dataset,
  );
}
