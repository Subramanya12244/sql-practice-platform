/**
 * ETL Pipeline Playback engine: a deterministic simulation of SOURCE → EXTRACT → VALIDATE → TRANSFORM → LOAD → TARGET.
 * Fixed fixtures, a virtual clock, no I/O. It teaches pipeline behaviour (watermarks, idempotency, quarantine, retries, dead
 * letters, SCD2, CDC, dependencies). Durations are virtual milliseconds, not measurements of any real system.
 */
export interface SrcRow { id: number; customer: string | null; amount: number; updated: string }

export const SOURCE: SrcRow[] = [
  { id: 1, customer: "ana", amount: 120, updated: "2026-03-01" },
  { id: 2, customer: "ben", amount: 75, updated: "2026-03-01" },
  { id: 3, customer: "chen", amount: -20, updated: "2026-03-02" }, // invalid: negative amount
  { id: 4, customer: null, amount: 60, updated: "2026-03-02" }, // invalid: no customer
  { id: 5, customer: "dia", amount: 200, updated: "2026-03-03" },
  { id: 5, customer: "dia", amount: 210, updated: "2026-03-04" }, // duplicate id, newer version
  { id: 6, customer: "eli", amount: 90, updated: "2026-03-04" },
  { id: 7, customer: "fay", amount: 45, updated: "2026-03-05" },
];

export type Stage = "source" | "extract" | "validate" | "transform" | "load" | "target";
export const STAGES: Stage[] = ["source", "extract", "validate", "transform", "load", "target"];

export type Failure = "none" | "extract-fails-twice" | "extract-always-fails" | "transform-crash-row-6" | "load-fails-once" | "load-always-fails";

export interface PipelineOptions {
  mode: "full" | "incremental";
  /** Incremental: only rows updated after this date are extracted. */
  watermark: string;
  dedupe: boolean;
  /** Bad rows go to quarantine and the run continues. When false, the first bad row fails the run. */
  quarantine: boolean;
  /** Load by key (re-running is safe) or append (re-running duplicates). */
  load: "upsert" | "append";
  failure: Failure;
  maxRetries: number;
  /** After retries are exhausted, park the batch in a dead-letter queue instead of failing the run. */
  deadLetter: boolean;
  /** Rows already in the target before this run (for rerun and incremental demos). */
  targetBefore: TgtRow[];
}

export interface TgtRow { id: number; customer: string; amount: number; updated: string; amount_usd_cents: number }

export const DEFAULT_PIPELINE: PipelineOptions = { mode: "full", watermark: "2026-03-02", dedupe: true, quarantine: true, load: "upsert", failure: "none", maxRetries: 2, deadLetter: true, targetBefore: [] };

export interface Counts { in?: number; out?: number; rejected?: number; retries?: number; errors?: number }

export interface EtlFrame {
  stage: Stage;
  status: "ok" | "warn" | "fail" | "retry" | "skipped";
  title: string;
  detail: string;
  at: number;
  counts: Counts;
  rows?: Record<string, unknown>[];
  rejected?: { id: number | null; reason: string }[];
  checkpoint?: string;
}

export interface PipelineRun {
  frames: EtlFrame[];
  target: TgtRow[];
  quarantine: { id: number | null; reason: string }[];
  deadLetter: SrcRow[];
  status: "success" | "success-with-rejects" | "failed" | "dead-lettered";
  /** The watermark to save for the next run (null when the run did not finish cleanly, so nothing is skipped next time). */
  checkpoint: string | null;
  durationMs: number;
  retries: number;
}

const COST: Record<Stage, number> = { source: 0, extract: 120, validate: 40, transform: 60, load: 90, target: 0 };

export function validateRow(r: SrcRow): string | null {
  if (r.customer === null || r.customer === "") return "customer is missing";
  if (r.amount < 0) return "amount is negative";
  return null;
}

export const transformRow = (r: SrcRow): TgtRow => ({ id: r.id, customer: (r.customer ?? "").toUpperCase(), amount: r.amount, updated: r.updated, amount_usd_cents: Math.round(r.amount * 100) });

export function runPipeline(options: Partial<PipelineOptions> = {}): PipelineRun {
  const o: PipelineOptions = { ...DEFAULT_PIPELINE, ...options };
  const frames: EtlFrame[] = [];
  let clock = 0, retries = 0;
  const quarantine: PipelineRun["quarantine"] = [];
  const deadLetter: SrcRow[] = [];
  const push = (f: Omit<EtlFrame, "at">) => frames.push({ ...f, at: clock });
  const result = (status: PipelineRun["status"], target: TgtRow[], checkpoint: string | null): PipelineRun => ({ frames, target, quarantine, deadLetter, status, checkpoint, durationMs: clock, retries });

  push({ stage: "source", status: "ok", title: `Source holds ${SOURCE.length} rows`, detail: "The source table, including two bad rows and a duplicate key.", counts: { out: SOURCE.length }, rows: SOURCE as unknown as Record<string, unknown>[] });

  // Runs one stage action with retry on injected transient failures.
  const attempt = (stage: Stage, failsFor: number | "always", label: string): boolean => {
    let tries = 0;
    for (;;) {
      clock += COST[stage];
      const fails = failsFor === "always" || tries < failsFor;
      if (!fails) return true;
      if (tries >= o.maxRetries) { push({ stage, status: "fail", title: `${label} failed for good`, detail: `${tries} retries used (limit ${o.maxRetries}). Retrying forever would hide a real outage.`, counts: { retries: tries, errors: tries + 1 } }); return false; }
      tries++; retries++;
      const wait = 100 * 2 ** (tries - 1);
      push({ stage, status: "retry", title: `${label} failed, retry ${tries} of ${o.maxRetries}`, detail: `Transient error. Waiting ${wait} ms (exponential backoff) before trying again.`, counts: { retries: tries, errors: tries } });
      clock += wait;
    }
  };

  // EXTRACT
  const extractFails = o.failure === "extract-fails-twice" ? 2 : o.failure === "extract-always-fails" ? "always" : 0;
  if (!attempt("extract", extractFails, "Extract")) return result("failed", o.targetBefore, null);
  let rows = SOURCE;
  if (o.mode === "incremental") rows = SOURCE.filter((r) => r.updated > o.watermark);
  push({ stage: "extract", status: "ok", title: o.mode === "incremental" ? `Extracted ${rows.length} of ${SOURCE.length} rows (updated after ${o.watermark})` : `Extracted all ${rows.length} rows (full load)`,
    detail: o.mode === "incremental" ? "A watermark remembers how far the last run got, so only newer rows are read. Cheap, but it misses rows whose timestamp is never updated." : "A full load reads everything every time. Simple and self-healing, but it grows with the table.", counts: { in: SOURCE.length, out: rows.length }, rows: rows as unknown as Record<string, unknown>[] });

  // VALIDATE
  const good: SrcRow[] = [];
  const rejected: PipelineRun["quarantine"] = [];
  for (const r of rows) { const why = validateRow(r); if (why) rejected.push({ id: r.id, reason: why }); else good.push(r); }
  clock += COST.validate;
  if (rejected.length && !o.quarantine) {
    push({ stage: "validate", status: "fail", title: `Row ${rejected[0].id} failed: ${rejected[0].reason}`, detail: "Quarantine is off, so one bad row stops the whole run. Nothing was loaded.", counts: { in: rows.length, out: 0, rejected: rejected.length, errors: 1 }, rejected });
    return result("failed", o.targetBefore, null);
  }
  quarantine.push(...rejected);
  push({ stage: "validate", status: rejected.length ? "warn" : "ok", title: `${good.length} valid, ${rejected.length} rejected`, detail: rejected.length ? "Rejected rows are set aside in a quarantine table with the reason, so the good rows continue and the bad ones can be fixed later." : "Every row passed the quality checks (customer present, amount not negative).", counts: { in: rows.length, out: good.length, rejected: rejected.length }, rejected, rows: good as unknown as Record<string, unknown>[] });

  // TRANSFORM (with dedupe)
  let work = good;
  if (o.dedupe) {
    const latest = new Map<number, SrcRow>();
    for (const r of work) { const p = latest.get(r.id); if (!p || r.updated >= p.updated) latest.set(r.id, r); }
    work = [...latest.values()];
  }
  clock += COST.transform;
  if (o.failure === "transform-crash-row-6" && work.some((r) => r.id === 6)) {
    push({ stage: "transform", status: "fail", title: "Transform crashed on row 6", detail: "A bug in the transform step. Nothing was loaded, and the watermark is not advanced, so the next run re-reads these rows.", counts: { in: good.length, out: 0, errors: 1 } });
    return result("failed", o.targetBefore, null);
  }
  const out = work.map(transformRow);
  push({ stage: "transform", status: "ok", title: `${out.length} rows transformed${o.dedupe && good.length !== out.length ? ` (${good.length - out.length} duplicate removed)` : ""}`, detail: `${o.dedupe ? "Deduplication keeps the newest version of each key. " : "Deduplication is off, so the duplicate key is passed on. "}Customer names are upper-cased and the amount is converted to cents.`, counts: { in: good.length, out: out.length }, rows: out as unknown as Record<string, unknown>[] });

  // LOAD
  const loadFails = o.failure === "load-fails-once" ? 1 : o.failure === "load-always-fails" ? "always" : 0;
  if (!attempt("load", loadFails, "Load")) {
    if (o.deadLetter) {
      deadLetter.push(...work);
      push({ stage: "load", status: "warn", title: `${work.length} rows parked in the dead-letter queue`, detail: "The batch could not be loaded, so it is saved with its error for later replay instead of being lost. The run ends without advancing the checkpoint.", counts: { in: out.length, out: 0, errors: 1 } });
      return result("dead-lettered", o.targetBefore, null);
    }
    return result("failed", o.targetBefore, null);
  }
  const target = [...o.targetBefore];
  let inserted = 0, updated = 0;
  for (const r of out) {
    const at = target.findIndex((t) => t.id === r.id);
    if (o.load === "upsert" && at >= 0) { target[at] = r; updated++; } else { target.push(r); inserted++; }
  }
  const dupKeys = new Set(target.map((t) => t.id)).size !== target.length;
  push({ stage: "load", status: dupKeys ? "warn" : "ok", title: `${inserted} inserted, ${updated} updated`, detail: o.load === "upsert" ? "Upsert by key: running the same load again changes nothing. That property is called idempotency." : `Append only: running this load again adds the same rows again.${dupKeys ? " The target now holds duplicate keys." : ""}`, counts: { in: out.length, out: inserted + updated }, rows: out as unknown as Record<string, unknown>[] });
  push({ stage: "target", status: "ok", title: `Target holds ${target.length} rows`, detail: dupKeys ? "Duplicate ids exist in the target: a data quality problem caused by a non-idempotent load." : "One row per key.", counts: { out: target.length }, rows: target as unknown as Record<string, unknown>[] });

  const maxUpdated = rows.reduce((m, r) => (r.updated > m ? r.updated : m), o.watermark);
  const checkpoint = o.mode === "incremental" ? maxUpdated : null;
  if (checkpoint) frames[frames.length - 1].checkpoint = checkpoint;
  return result(quarantine.length ? "success-with-rejects" : "success", target, checkpoint);
}

// ── Slowly changing dimension, type 2 ────────────────────────────────────
export interface DimRow { key: string; city: string; from: string; to: string | null; current: boolean }

/** SCD2: a changed attribute closes the current row and inserts a new current row. History is kept. */
export function applyScd2(dim: DimRow[], changes: { key: string; city: string; on: string }[]): { dim: DimRow[]; notes: string[] } {
  const out = dim.map((r) => ({ ...r }));
  const notes: string[] = [];
  for (const c of changes) {
    const cur = out.find((r) => r.key === c.key && r.current);
    if (!cur) { out.push({ key: c.key, city: c.city, from: c.on, to: null, current: true }); notes.push(`${c.key} is new: inserted as the current row.`); continue; }
    if (cur.city === c.city) { notes.push(`${c.key} unchanged: nothing to do.`); continue; }
    cur.to = c.on; cur.current = false;
    out.push({ key: c.key, city: c.city, from: c.on, to: null, current: true });
    notes.push(`${c.key} moved ${cur.city} → ${c.city}: the old row is closed on ${c.on} and a new current row is added. Facts that happened before ${c.on} still join to ${cur.city}.`);
  }
  return { dim: out, notes };
}

// ── CDC: apply a change feed ─────────────────────────────────────────────
export interface Change { op: "insert" | "update" | "delete"; id: number; value?: number; seq: number }

/** Apply changes in sequence order. Replaying the same feed gives the same table (idempotent), because each change is keyed. */
export function applyCdc(table: Record<number, number>, feed: Change[]): { table: Record<number, number>; notes: string[] } {
  const t = { ...table };
  const notes: string[] = [];
  for (const c of [...feed].sort((a, b) => a.seq - b.seq)) {
    if (c.op === "delete") { delete t[c.id]; notes.push(`#${c.seq} delete ${c.id}: row removed.`); }
    else { const had = c.id in t; t[c.id] = c.value ?? 0; notes.push(`#${c.seq} ${c.op} ${c.id} = ${c.value}: ${had ? "overwrote the existing row" : "added the row"}.`); }
  }
  return { table: t, notes };
}

// ── Pipeline dependencies ────────────────────────────────────────────────
export interface Task { id: string; deps: string[]; fails?: boolean }
export type TaskState = "success" | "failed" | "skipped";

/** Run tasks in dependency order. A failed task makes everything downstream skip. Returns the order and each task's state. */
export function runDag(tasks: Task[]): { order: string[]; state: Record<string, TaskState>; cycle: boolean } {
  const state: Record<string, TaskState> = {};
  const order: string[] = [];
  const left = new Map(tasks.map((t) => [t.id, t]));
  while (left.size) {
    const ready = [...left.values()].filter((t) => t.deps.every((d) => d in state));
    if (!ready.length) return { order, state, cycle: true };
    for (const t of ready.sort((a, b) => a.id.localeCompare(b.id))) {
      state[t.id] = t.deps.some((d) => state[d] !== "success") ? "skipped" : t.fails ? "failed" : "success";
      order.push(t.id); left.delete(t.id);
    }
  }
  return { order, state, cycle: false };
}
