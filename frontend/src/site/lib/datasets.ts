import { getDb, registerDataset, type DatasetSource } from "./browserDb";
import type { SqlDb } from "./sqlRunner";
import type { SchemaTable } from "../types";

export interface DatasetInfo {
  id: string;
  title: string;
  description: string;
  tables: string[];
  rows?: number;
  edgeCases?: string[];
  /** "builtin" ships with the site; "custom" was generated or imported in this browser. */
  kind: "builtin" | "custom";
}

export interface CustomDataset extends DatasetInfo {
  kind: "custom";
  sql: string;
  createdAt: string;
}

export const NORTHWIND_INFO: DatasetInfo = {
  id: "northwind",
  title: "Northwind",
  description: "Classic trading company: customers, orders, products, employees, suppliers and shippers.",
  tables: ["categories", "customers", "employees", "order_details", "orders", "products", "shippers", "suppliers"],
  kind: "builtin",
};

const CUSTOM_KEY = "sqlp.custom.datasets";
/** localStorage is ~5 MB per origin; keep custom datasets well below that. */
export const MAX_CUSTOM_SQL = 1_500_000;

export async function loadBuiltinDatasets(): Promise<DatasetInfo[]> {
  try {
    const res = await fetch("/data/datasets/index.json");
    if (!res.ok) return [NORTHWIND_INFO];
    const list = (await res.json()) as Omit<DatasetInfo, "kind">[];
    return [NORTHWIND_INFO, ...list.map((d) => ({ ...d, kind: "builtin" as const }))];
  } catch {
    return [NORTHWIND_INFO];
  }
}

export function loadCustomDatasets(): CustomDataset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as CustomDataset[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomDataset(d: Omit<CustomDataset, "kind" | "createdAt">): { ok: true } | { ok: false; error: string } {
  if (d.sql.length > MAX_CUSTOM_SQL) return { ok: false, error: `Dataset is too large to keep in this browser (${Math.round(d.sql.length / 1024)} KB; limit ${MAX_CUSTOM_SQL / 1000} KB).` };
  const list = loadCustomDatasets().filter((x) => x.id !== d.id);
  list.unshift({ ...d, kind: "custom", createdAt: new Date().toISOString() });
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, 10)));
    registerDataset({ id: d.id, sql: d.sql });
    return { ok: true };
  } catch {
    return { ok: false, error: "This browser refused to store the dataset (storage full or disabled)." };
  }
}

export function deleteCustomDataset(id: string) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(loadCustomDatasets().filter((x) => x.id !== id)));
  } catch {
    /* ignore */
  }
}

/** Make every known dataset queryable by id. */
export function registerAll(builtins: DatasetInfo[], customs: CustomDataset[]) {
  for (const d of builtins) if (d.id !== "northwind") registerDataset({ id: d.id, url: `/data/datasets/${d.id}.sql` });
  for (const d of customs) registerDataset({ id: d.id, sql: d.sql } as DatasetSource);
}

/**
 * Read tables, columns, primary keys and foreign keys from the dataset's own catalog —
 * so the explorer and ER diagram always describe what the database really contains.
 */
export async function describeDataset(dataset: string): Promise<SchemaTable[]> {
  const { db } = await getDb(dataset);
  return describeWith(db);
}

export async function describeWith(db: SqlDb): Promise<SchemaTable[]> {
  const [cols] = await db.exec(
    `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.character_maximum_length
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`,
    { rowMode: "array" },
  );
  const [keys] = await db.exec(
    `SELECT tc.table_name, kcu.column_name, tc.constraint_type, ccu.table_name, ccu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND tc.constraint_type = 'FOREIGN KEY'
      WHERE tc.table_schema = 'public' AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`,
    { rowMode: "array" },
  );
  const pk = new Set<string>();
  const fk = new Map<string, { table: string; column: string }>();
  for (const [t, c, kind, rt, rc] of keys.rows as string[][]) {
    if (kind === "PRIMARY KEY") pk.add(`${t}.${c}`);
    else if (rt && rc) fk.set(`${t}.${c}`, { table: rt, column: rc });
  }
  const tables = new Map<string, SchemaTable>();
  for (const [t, c, type, nullable, len] of cols.rows as (string | null)[][]) {
    if (!tables.has(t!)) tables.set(t!, { name: t!, columns: [] });
    tables.get(t!)!.columns.push({
      name: c!,
      type: len ? `${type}(${len})` : type!,
      pk: pk.has(`${t}.${c}`),
      notNull: nullable === "NO",
      fk: fk.get(`${t}.${c}`) ?? null,
    });
  }
  return [...tables.values()];
}

/** Row counts per table (exact). */
export async function tableCounts(dataset: string, tables: string[]): Promise<Record<string, number>> {
  const { db } = await getDb(dataset);
  const out: Record<string, number> = {};
  for (const t of tables) {
    const [r] = await db.exec(`SELECT COUNT(*) FROM "${t.replace(/"/g, '""')}"`, { rowMode: "array" });
    out[t] = Number((r.rows[0] as unknown[])[0]);
  }
  return out;
}

// ── Saved queries and history, per dataset (browser only) ──────────────────
export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  at: string;
}
const HIST_KEY = (d: string) => `sqlp.history.${d}`;
const SAVED_KEY = (d: string) => `sqlp.saved.${d}`;

function readList<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}
function writeList<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export const getHistory = (d: string) => readList<{ sql: string; at: string; ok: boolean; rows?: number }>(HIST_KEY(d));
export function addHistory(d: string, entry: { sql: string; ok: boolean; rows?: number }) {
  const list = getHistory(d).filter((h) => h.sql !== entry.sql);
  writeList(HIST_KEY(d), [{ ...entry, at: new Date().toISOString() }, ...list].slice(0, 30));
}
export const clearHistory = (d: string) => writeList(HIST_KEY(d), []);

export const getSaved = (d: string) => readList<SavedQuery>(SAVED_KEY(d));
export function saveQuery(d: string, name: string, sql: string): SavedQuery[] {
  const list = [{ id: crypto.randomUUID(), name: name.trim() || "Untitled", sql, at: new Date().toISOString() }, ...getSaved(d)].slice(0, 50);
  writeList(SAVED_KEY(d), list);
  return list;
}
export function deleteSaved(d: string, id: string): SavedQuery[] {
  const list = getSaved(d).filter((q) => q.id !== id);
  writeList(SAVED_KEY(d), list);
  return list;
}

/** CSV with RFC 4180 quoting; NULL becomes an empty field. */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const q = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\r\n");
}

export function download(name: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
