/**
 * Browser-only ETL simulator: Source -> Extract -> Transform -> Validate -> Load over arrays of
 * records. Pure functions, no network and no database, so every node is unit-tested and a pipeline
 * runs the same way every time. Samples are capped so a large file cannot freeze the page.
 */
export type Row = Record<string, unknown>;
export type NodeKind = "source-csv" | "source-json" | "source-db" | "select" | "filter" | "convert" | "nulls" | "dedupe" | "aggregate" | "join" | "validate" | "output";

export interface EtlNode { id: string; kind: NodeKind; label?: string; inputs: string[]; config: Record<string, unknown> }
export interface Pipeline { nodes: EtlNode[] }
export const MAX_ROWS = 50_000;

export class EtlError extends Error {}

export const NODE_INFO: Record<NodeKind, { title: string; group: "Source" | "Transform" | "Validate" | "Load"; inputs: 0 | 1 | 2; help: string }> = {
  "source-csv": { title: "CSV source", group: "Source", inputs: 0, help: "Reads rows from CSV text. The first line is the header." },
  "source-json": { title: "JSON source", group: "Source", inputs: 0, help: "Reads a JSON array of objects, or one JSON object per line." },
  "source-db": { title: "Database source", group: "Source", inputs: 0, help: "A simulated database table with built-in sample rows." },
  select: { title: "Select columns", group: "Transform", inputs: 1, help: "Keeps only the listed columns, in that order." },
  filter: { title: "Filter rows", group: "Transform", inputs: 1, help: "Keeps rows where a column meets a condition." },
  convert: { title: "Convert type", group: "Transform", inputs: 1, help: "Converts a column to a number, date (ISO), boolean or text." },
  nulls: { title: "Handle nulls", group: "Transform", inputs: 1, help: "Drops rows with a missing value, or fills it." },
  dedupe: { title: "Remove duplicates", group: "Transform", inputs: 1, help: "Keeps the first row for each key (all columns when no key is given)." },
  aggregate: { title: "Aggregate", group: "Transform", inputs: 1, help: "Groups rows and computes count, sum, avg, min or max." },
  join: { title: "Join", group: "Transform", inputs: 2, help: "Joins the first input (left) to the second (right) on a key." },
  validate: { title: "Validate", group: "Validate", inputs: 1, help: "Checks rules. Either fails the run or drops rows that break them." },
  output: { title: "Load to destination", group: "Load", inputs: 1, help: "The destination table. Exactly one is required." },
};

// ── Parsing ──────────────────────────────────────────────────────────────
/** Minimal CSV: commas, double-quoted fields with "" escapes, CRLF or LF. Returns rows keyed by the header. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], quoted = false;
  const t = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ""));
  if (!head) return [];
  const names = head.map((h) => h.trim());
  if (body.length > MAX_ROWS) throw new EtlError(`The file has more than ${MAX_ROWS.toLocaleString()} rows; this simulator reads at most that many.`);
  return body.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? ""])));
}

export function parseJson(text: string): Row[] {
  const s = text.trim();
  if (!s) return [];
  let data: unknown;
  try { data = JSON.parse(s); } catch {
    try { data = s.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch { throw new EtlError("The JSON could not be read. Use an array of objects, or one object per line."); }
  }
  const list = Array.isArray(data) ? data : [data];
  if (!list.every((x) => x && typeof x === "object" && !Array.isArray(x))) throw new EtlError("Every JSON item must be an object, like {\"id\": 1}.");
  if (list.length > MAX_ROWS) throw new EtlError(`More than ${MAX_ROWS.toLocaleString()} records.`);
  return list as Row[];
}

// ── Sample data ──────────────────────────────────────────────────────────
export const SAMPLES = {
  orders_csv: `order_id,customer_id,order_date,amount,status
1001,C1, 2026-01-05 ,120.50,shipped
1002,C2,2026-01-06,,shipped
1003,C1,01/07/2026,"1,200.00",SHIPPED
1003,C1,01/07/2026,"1,200.00",SHIPPED
1004,C3,not a date,15.00,cancelled
1005,C9,2026-01-09,42.00,shipped
1006,C2,2026-01-10,-5.00,shipped
`,
  customers_json: `[{"customer_id":"C1","name":"Asha","country":"IN"},{"customer_id":"C2","name":"Ben","country":"US"},{"customer_id":"C3","name":"Chen","country":"CN"}]`,
  products_db: [{ product_id: 1, name: "Keyboard", price: 25 }, { product_id: 2, name: "Mouse", price: 12.5 }, { product_id: 3, name: "Monitor", price: 180 }] as Row[],
};
export const dbTables: Record<string, Row[]> = { products: SAMPLES.products_db };

// ── Helpers ──────────────────────────────────────────────────────────────
const isNull = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const str = (c: Record<string, unknown>, k: string, fallback = "") => (typeof c[k] === "string" ? (c[k] as string) : fallback);
const list = (c: Record<string, unknown>, k: string): string[] => (Array.isArray(c[k]) ? (c[k] as unknown[]).map(String).filter(Boolean) : typeof c[k] === "string" ? (c[k] as string).split(",").map((s) => s.trim()).filter(Boolean) : []);
const need = (c: Record<string, unknown>, k: string, what: string) => { const v = str(c, k).trim(); if (!v) throw new EtlError(`Choose ${what}.`); return v; };
const hasCol = (rows: Row[], col: string) => rows.length === 0 || rows.some((r) => col in r);
const colCheck = (rows: Row[], col: string) => { if (!hasCol(rows, col)) throw new EtlError(`There is no column "${col}". Columns available: ${Object.keys(rows[0] ?? {}).join(", ") || "none"}.`); };

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (isNull(v)) return null;
  const n = Number(String(v).replace(/[\s,$]/g, ""));
  return Number.isFinite(n) ? n : null;
}
export function toIsoDate(v: unknown): string | null {
  if (isNull(v)) return null;
  const s = String(v).trim();
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  else if ((mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [m, d, y] = [+mt[1], +mt[2], +mt[3]];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
const toBool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return ["true", "yes", "y", "1"].includes(s) ? true : ["false", "no", "n", "0"].includes(s) ? false : null;
};

const compare = (a: unknown, op: string, b: string): boolean => {
  const na = toNumber(a), nb = toNumber(b);
  const numeric = na !== null && nb !== null;
  const x = numeric ? na : String(a ?? ""), y = numeric ? nb : b;
  switch (op) {
    case "=": return x === y; case "!=": return x !== y;
    case ">": return x > y; case ">=": return x >= y; case "<": return x < y; case "<=": return x <= y;
    case "contains": return String(a ?? "").toLowerCase().includes(b.toLowerCase());
    case "is null": return isNull(a); case "is not null": return !isNull(a);
    default: throw new EtlError(`Unknown condition "${op}".`);
  }
};

export interface NodeResult { rows: Row[]; notes: string[] }

/** Run one node on its input rows. Throws EtlError with a message a learner can act on. */
export function runNode(node: EtlNode, inputs: Row[][]): NodeResult {
  const c = node.config;
  const rows = inputs[0] ?? [];
  const notes: string[] = [];
  switch (node.kind) {
    case "source-csv": return { rows: parseCsv(str(c, "text")), notes };
    case "source-json": return { rows: parseJson(str(c, "text")), notes };
    case "source-db": {
      const t = str(c, "table", "products");
      if (!dbTables[t]) throw new EtlError(`Unknown table "${t}". Available: ${Object.keys(dbTables).join(", ")}.`);
      return { rows: dbTables[t].map((r) => ({ ...r })), notes };
    }
    case "select": {
      const cols = list(c, "columns");
      if (!cols.length) throw new EtlError("Choose at least one column to keep.");
      cols.forEach((k) => colCheck(rows, k));
      return { rows: rows.map((r) => Object.fromEntries(cols.map((k) => [k, r[k]]))), notes };
    }
    case "filter": {
      const col = need(c, "column", "a column"); colCheck(rows, col);
      const op = str(c, "op", "="), val = str(c, "value");
      return { rows: rows.filter((r) => compare(r[col], op, val)), notes };
    }
    case "convert": {
      const col = need(c, "column", "a column"); colCheck(rows, col);
      const to = str(c, "to", "number"), onError = str(c, "onError", "null");
      let bad = 0;
      const out = rows.map((r) => {
        const v = r[col];
        const next = to === "number" ? toNumber(v) : to === "date" ? toIsoDate(v) : to === "boolean" ? toBool(v) : isNull(v) ? null : String(v).trim();
        if (next === null && !isNull(v)) bad++;
        if (next === null && !isNull(v) && onError === "fail") throw new EtlError(`"${String(v)}" in column "${col}" is not a valid ${to}. Set the node to "make it empty" to continue, or clean the source first.`);
        return { ...r, [col]: next };
      });
      if (bad) notes.push(`${bad} value${bad === 1 ? "" : "s"} could not be converted to ${to} and became empty.`);
      return { rows: out, notes };
    }
    case "nulls": {
      const col = need(c, "column", "a column"); colCheck(rows, col);
      const strategy = str(c, "strategy", "drop");
      if (strategy === "drop") { const out = rows.filter((r) => !isNull(r[col])); if (out.length < rows.length) notes.push(`Dropped ${rows.length - out.length} row(s) with an empty ${col}.`); return { rows: out, notes }; }
      let fill: unknown = c.value;
      if (strategy === "mean") { const nums = rows.map((r) => toNumber(r[col])).filter((x): x is number => x !== null); if (!nums.length) throw new EtlError(`No numbers in "${col}" to average.`); fill = nums.reduce((a, b) => a + b, 0) / nums.length; }
      else if (isNull(fill)) throw new EtlError("Enter the value to fill in.");
      return { rows: rows.map((r) => (isNull(r[col]) ? { ...r, [col]: fill } : r)), notes };
    }
    case "dedupe": {
      const keys = list(c, "keys");
      keys.forEach((k) => colCheck(rows, k));
      const seen = new Set<string>();
      const out = rows.filter((r) => { const k = JSON.stringify(keys.length ? keys.map((x) => r[x]) : Object.entries(r)); if (seen.has(k)) return false; seen.add(k); return true; });
      if (out.length < rows.length) notes.push(`Removed ${rows.length - out.length} duplicate row(s).`);
      return { rows: out, notes };
    }
    case "aggregate": {
      const by = list(c, "groupBy"), fn = str(c, "fn", "count"), col = str(c, "column"), as = str(c, "as") || (fn === "count" ? "count" : `${fn}_${col}`);
      by.forEach((k) => colCheck(rows, k));
      if (fn !== "count") { if (!col) throw new EtlError(`Choose the column to ${fn}.`); colCheck(rows, col); }
      const groups = new Map<string, Row[]>();
      for (const r of rows) { const k = JSON.stringify(by.map((x) => r[x])); groups.set(k, [...(groups.get(k) ?? []), r]); }
      const out = [...groups.values()].map((g) => {
        const nums = fn === "count" ? [] : g.map((r) => toNumber(r[col])).filter((x): x is number => x !== null);
        const v = fn === "count" ? g.length : !nums.length ? null : fn === "sum" ? nums.reduce((a, b) => a + b, 0) : fn === "avg" ? nums.reduce((a, b) => a + b, 0) / nums.length : fn === "min" ? Math.min(...nums) : fn === "max" ? Math.max(...nums) : (() => { throw new EtlError(`Unknown function "${fn}".`); })();
        return { ...Object.fromEntries(by.map((x) => [x, g[0][x]])), [as]: v };
      });
      return { rows: out, notes };
    }
    case "join": {
      const right = inputs[1] ?? [];
      const lk = need(c, "leftKey", "the left key"), rk = need(c, "rightKey", "the right key"), kind = str(c, "kind", "inner");
      colCheck(rows, lk); colCheck(right, rk);
      const index = new Map<string, Row[]>();
      for (const r of right) { const k = String(r[rk]); index.set(k, [...(index.get(k) ?? []), r]); }
      const out: Row[] = [];
      const rightCols = [...new Set(right.flatMap((r) => Object.keys(r)))];
      for (const l of rows) {
        const m = index.get(String(l[lk]));
        if (m) for (const r of m) out.push({ ...l, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k in l ? `${k}_right` : k, v])) });
        else if (kind === "left") out.push({ ...l, ...Object.fromEntries(rightCols.map((k) => [k in l ? `${k}_right` : k, null])) });
      }
      if (kind === "inner" && rows.some((l) => !index.has(String(l[lk])))) notes.push(`${rows.filter((l) => !index.has(String(l[lk]))).length} left row(s) had no match and were dropped. A left join keeps them.`);
      return { rows: out, notes };
    }
    case "validate": {
      const rules = (Array.isArray(c.rules) ? c.rules : []) as { column: string; rule: string; arg?: string }[];
      if (!rules.length) throw new EtlError("Add at least one rule.");
      const failing = new Map<number, string[]>();
      rules.forEach((rl) => {
        colCheck(rows, rl.column);
        const seen = new Map<string, number>();
        rows.forEach((r, i) => {
          const v = r[rl.column];
          let ok = true;
          if (rl.rule === "not-null") ok = !isNull(v);
          else if (rl.rule === "min") ok = toNumber(v) !== null && toNumber(v)! >= Number(rl.arg);
          else if (rl.rule === "max") ok = toNumber(v) !== null && toNumber(v)! <= Number(rl.arg);
          else if (rl.rule === "regex") { try { ok = new RegExp(rl.arg ?? "").test(String(v ?? "")); } catch { throw new EtlError(`"${rl.arg}" is not a valid pattern.`); } }
          else if (rl.rule === "unique") { const k = String(v); ok = !seen.has(k); seen.set(k, i); }
          else throw new EtlError(`Unknown rule "${rl.rule}".`);
          if (!ok) failing.set(i, [...(failing.get(i) ?? []), `${rl.column} ${rl.rule}${rl.arg ? " " + rl.arg : ""}`]);
        });
      });
      if (!failing.size) { notes.push(`All ${rows.length} rows passed ${rules.length} rule(s).`); return { rows, notes }; }
      const summary = [...new Set([...failing.values()].flat())].join("; ");
      if (str(c, "onFail", "fail") === "fail") throw new EtlError(`${failing.size} of ${rows.length} rows failed validation (${summary}). The load was stopped so bad data does not reach the destination.`);
      notes.push(`Dropped ${failing.size} row(s) that broke: ${summary}.`);
      return { rows: rows.filter((_, i) => !failing.has(i)), notes };
    }
    case "output": return { rows, notes: [`Loaded ${rows.length} row(s) into "${str(c, "name", "target_table")}".`] };
  }
}

// ── Graph ────────────────────────────────────────────────────────────────
/** Problems with the wiring itself, before anything runs. */
export function validatePipeline(p: Pipeline): string[] {
  const errors: string[] = [];
  const ids = new Set(p.nodes.map((n) => n.id));
  if (ids.size !== p.nodes.length) errors.push("Two nodes share the same id.");
  for (const n of p.nodes) {
    const need = NODE_INFO[n.kind].inputs;
    const name = n.label || NODE_INFO[n.kind].title;
    if (n.inputs.length !== need) errors.push(`${name} needs ${need === 0 ? "no input" : `${need} input${need > 1 ? "s" : ""}`} but has ${n.inputs.length}.`);
    for (const i of n.inputs) if (!ids.has(i)) errors.push(`${name} points at a node that no longer exists.`);
  }
  const outputs = p.nodes.filter((n) => n.kind === "output");
  if (outputs.length !== 1) errors.push(outputs.length === 0 ? "Add one destination (Load) node." : "Use exactly one destination node.");
  if (errors.length === 0 && topoOrder(p) === null) errors.push("The pipeline loops back on itself. Data must flow in one direction.");
  return errors;
}

/** Node ids in run order, or null if there is a cycle. */
export function topoOrder(p: Pipeline): string[] | null {
  const left = new Map(p.nodes.map((n) => [n.id, n.inputs.filter((i) => p.nodes.some((x) => x.id === i)).length]));
  const order: string[] = [];
  const queue = p.nodes.filter((n) => left.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const n of p.nodes) if (n.inputs.includes(id)) { left.set(n.id, left.get(n.id)! - n.inputs.filter((i) => i === id).length); if (left.get(n.id) === 0) queue.push(n.id); }
  }
  return order.length === p.nodes.length ? order : null;
}

export type NodeStatus = "ok" | "error" | "skipped" | "idle";
export interface LogEntry { level: "info" | "warn" | "error"; node?: string; message: string }
export interface RunResult {
  status: Record<string, NodeStatus>;
  outputs: Record<string, Row[]>;
  /** Rows each node received, for the input preview. */
  inputsOf: Record<string, Row[]>;
  logs: LogEntry[];
  ok: boolean;
}

export function runPipeline(p: Pipeline): RunResult {
  const res: RunResult = { status: Object.fromEntries(p.nodes.map((n) => [n.id, "idle" as NodeStatus])), outputs: {}, inputsOf: {}, logs: [], ok: false };
  const wiring = validatePipeline(p);
  if (wiring.length) { res.logs = wiring.map((message) => ({ level: "error", message })); return res; }
  const label = (n: EtlNode) => n.label || NODE_INFO[n.kind].title;
  for (const id of topoOrder(p)!) {
    const n = p.nodes.find((x) => x.id === id)!;
    if (n.inputs.some((i) => res.status[i] !== "ok")) { res.status[id] = "skipped"; res.logs.push({ level: "warn", node: id, message: `${label(n)}: skipped because an earlier step did not finish.` }); continue; }
    const ins = n.inputs.map((i) => res.outputs[i]);
    res.inputsOf[id] = ins[0] ?? [];
    try {
      const r = runNode(n, ins);
      res.outputs[id] = r.rows; res.status[id] = "ok";
      const inCount = ins.reduce((a, x) => a + x.length, 0);
      res.logs.push({ level: "info", node: id, message: n.inputs.length ? `${label(n)}: ${inCount} row(s) in, ${r.rows.length} out.` : `${label(n)}: read ${r.rows.length} row(s).` });
      for (const note of r.notes) res.logs.push({ level: "warn", node: id, message: `${label(n)}: ${note}` });
    } catch (e) {
      res.status[id] = "error";
      res.logs.push({ level: "error", node: id, message: `${label(n)}: ${e instanceof EtlError ? e.message : "Something unexpected went wrong in this step."}` });
    }
  }
  res.ok = Object.values(res.status).every((s) => s === "ok");
  return res;
}

// ── Preset ───────────────────────────────────────────────────────────────
export const PRESET_CLEAN_ORDERS: Pipeline = { nodes: [
  { id: "src", kind: "source-csv", label: "Orders export", inputs: [], config: { text: SAMPLES.orders_csv } },
  { id: "amt", kind: "convert", label: "Amount to number", inputs: ["src"], config: { column: "amount", to: "number", onError: "null" } },
  { id: "dt", kind: "convert", label: "Order date to date", inputs: ["amt"], config: { column: "order_date", to: "date", onError: "null" } },
  { id: "nul", kind: "nulls", label: "Drop rows without amount", inputs: ["dt"], config: { column: "amount", strategy: "drop" } },
  { id: "dup", kind: "dedupe", label: "One row per order", inputs: ["nul"], config: { keys: ["order_id"] } },
  { id: "val", kind: "validate", label: "Business rules", inputs: ["dup"], config: { onFail: "drop", rules: [{ column: "amount", rule: "min", arg: "0" }, { column: "order_date", rule: "not-null" }] } },
  { id: "out", kind: "output", label: "orders_clean", inputs: ["val"], config: { name: "orders_clean" } },
] };
