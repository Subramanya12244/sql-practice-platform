/**
 * Data quality rules → SQL, run on an isolated dataset instance (read-only in effect: every
 * query is rolled back). Identifiers are validated against the dataset's real schema and quoted.
 */
import type { ExecuteResult } from "../../types";
import type { SchemaTable } from "../types";
import { dataSink } from "./dataSync";

export type RuleType =
  | "not_null" | "unique" | "primary_key" | "foreign_key" | "data_type" | "schema"
  | "date_range" | "outlier" | "missing_records" | "reconciliation" | "row_count" | "business_rule";

export interface Rule {
  id: string;
  name: string;
  type: RuleType;
  table: string;
  /** Column(s) the rule applies to (unique/primary_key may use several). */
  columns?: string[];
  refTable?: string;
  refColumn?: string;
  /** data_type: integer | numeric | date | email | boolean */
  expected?: string;
  /** schema: expected column list */
  expectedColumns?: string[];
  min?: string;
  max?: string;
  /** outlier: z-score threshold */
  threshold?: number;
  /** reconciliation: columns to compare between source (table) and target (refTable) by key (columns[0]). */
  compare?: string[];
  /** row_count: allowed absolute difference */
  tolerance?: number;
  /** business_rule: a boolean SQL expression every row must satisfy, e.g. "amount >= 0" */
  condition?: string;
  suggested?: boolean;
}

export const RULE_LABELS: Record<RuleType, string> = {
  not_null: "NULL check", unique: "Duplicate detection", primary_key: "Primary key validation", foreign_key: "Foreign key validation",
  data_type: "Data type validation", schema: "Schema validation", date_range: "Invalid date detection", outlier: "Outlier detection",
  missing_records: "Missing record detection", reconciliation: "Source-to-target reconciliation", row_count: "Row-count reconciliation",
  business_rule: "Business rule",
};

export interface RuleResult {
  ruleId: string;
  name: string;
  type: RuleType;
  table: string;
  /** Records checked (for table-level rules: 1). */
  checked: number;
  failed: number;
  status: "pass" | "fail" | "error";
  message: string;
  sample?: { columns: string[]; rows: unknown[][] };
  sql: string;
}

export interface QualityRun {
  id: string;
  at: string;
  dataset: string;
  results: RuleResult[];
  score: number | null;
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
type Run = (sql: string) => Promise<ExecuteResult>;

export class RuleError extends Error {}

/** Check that every table/column a rule names really exists. */
export function validateRule(r: Rule, schema: SchemaTable[]): string[] {
  const errs: string[] = [];
  const t = (name?: string) => schema.find((x) => x.name === name);
  const table = t(r.table);
  if (!table) return [`Unknown table "${r.table}".`];
  const has = (tb: SchemaTable, c: string) => tb.columns.some((x) => x.name === c);
  for (const c of r.columns ?? []) if (!has(table, c)) errs.push(`Unknown column "${r.table}.${c}".`);
  const needsColumns: RuleType[] = ["not_null", "unique", "primary_key", "foreign_key", "data_type", "date_range", "outlier", "missing_records", "reconciliation"];
  if (needsColumns.includes(r.type) && !r.columns?.length) errs.push("Pick a column.");
  if (["foreign_key", "missing_records", "reconciliation", "row_count"].includes(r.type)) {
    const ref = t(r.refTable);
    if (!ref) errs.push(`Unknown reference table "${r.refTable ?? ""}".`);
    else {
      const refCol = r.refColumn ?? r.columns?.[0];
      if (r.type !== "row_count" && refCol && !has(ref, refCol)) errs.push(`Unknown column "${r.refTable}.${refCol}".`);
      for (const c of r.compare ?? []) if (!has(table, c) || !has(ref, c)) errs.push(`Column "${c}" must exist in both tables.`);
    }
  }
  if (r.type === "business_rule") {
    if (!r.condition?.trim()) errs.push("Write a condition.");
    else if (/;|--|\/\*/.test(r.condition)) errs.push("The condition must be a single expression (no ; or comments).");
  }
  if (r.type === "data_type" && !["integer", "numeric", "date", "email", "boolean"].includes(r.expected ?? "")) errs.push("Pick an expected type.");
  if (r.type === "schema" && !r.expectedColumns?.length) errs.push("List the expected columns.");
  return errs;
}

const PATTERN: Record<string, string> = {
  integer: "^-?[0-9]+$",
  numeric: "^-?[0-9]+(\\.[0-9]+)?$",
  date: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
  email: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
  boolean: "^(true|false|t|f|yes|no|y|n|1|0)$",
};

/**
 * For row-level rules: SQL selecting the failing rows from the table (alias t).
 * Table-level rules (schema, row_count) return null and are evaluated separately.
 */
export function failingRowsSql(r: Rule): string | null {
  const T = q(r.table);
  const c = r.columns?.[0] ? q(r.columns[0]) : "";
  const cols = (r.columns ?? []).map(q).join(", ");
  switch (r.type) {
    case "not_null":
      return `SELECT t.* FROM ${T} t WHERE t.${c} IS NULL`;
    case "unique":
      return `SELECT t.* FROM ${T} t WHERE (${(r.columns ?? []).map((x) => `t.${q(x)}`).join(", ")}) IN (SELECT ${cols} FROM ${T} GROUP BY ${cols} HAVING COUNT(*) > 1)`;
    case "primary_key":
      return `SELECT t.* FROM ${T} t WHERE ${(r.columns ?? []).map((x) => `t.${q(x)} IS NULL`).join(" OR ")} OR (${(r.columns ?? []).map((x) => `t.${q(x)}`).join(", ")}) IN (SELECT ${cols} FROM ${T} GROUP BY ${cols} HAVING COUNT(*) > 1)`;
    case "foreign_key":
      return `SELECT t.* FROM ${T} t WHERE t.${c} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(r.refTable!)} p WHERE p.${q(r.refColumn ?? r.columns![0])} = t.${c})`;
    case "data_type":
      return `SELECT t.* FROM ${T} t WHERE t.${c} IS NOT NULL AND NOT (t.${c}::text ~* '${PATTERN[r.expected!]}')`;
    case "date_range": {
      const parts = [r.min ? `t.${c} < DATE '${r.min.replace(/'/g, "")}'` : "", r.max ? `t.${c} > DATE '${r.max.replace(/'/g, "")}'` : ""].filter(Boolean);
      return `SELECT t.* FROM ${T} t WHERE t.${c} IS NOT NULL AND (${parts.join(" OR ") || "FALSE"})`;
    }
    case "outlier":
      return `SELECT t.* FROM ${T} t, (SELECT AVG(${c}::numeric) AS m, STDDEV_POP(${c}::numeric) AS s FROM ${T}) z WHERE z.s > 0 AND ABS((t.${c}::numeric - z.m) / z.s) > ${Number(r.threshold ?? 3)}`;
    case "missing_records":
      return `SELECT t.* FROM ${T} t WHERE NOT EXISTS (SELECT 1 FROM ${q(r.refTable!)} x WHERE x.${q(r.refColumn ?? r.columns![0])} = t.${c})`;
    case "reconciliation":
      return `SELECT t.* FROM ${T} t JOIN ${q(r.refTable!)} x ON x.${q(r.refColumn ?? r.columns![0])} = t.${c} WHERE ${(r.compare ?? []).map((k) => `t.${q(k)} IS DISTINCT FROM x.${q(k)}`).join(" OR ") || "FALSE"}`;
    case "business_rule":
      return `SELECT t.* FROM ${T} t WHERE (${r.condition}) IS NOT TRUE`;
    default:
      return null;
  }
}

export async function runRule(r: Rule, schema: SchemaTable[], run: Run): Promise<RuleResult> {
  const base = { ruleId: r.id, name: r.name, type: r.type, table: r.table };
  const errs = validateRule(r, schema);
  if (errs.length) return { ...base, checked: 0, failed: 0, status: "error", message: errs.join(" "), sql: "" };

  if (r.type === "schema") {
    const actual = schema.find((x) => x.name === r.table)!.columns.map((c) => c.name);
    const missing = r.expectedColumns!.filter((c) => !actual.includes(c));
    const extra = actual.filter((c) => !r.expectedColumns!.includes(c));
    const ok = !missing.length && !extra.length;
    return { ...base, checked: 1, failed: ok ? 0 : 1, status: ok ? "pass" : "fail", message: ok ? "Columns match." : [missing.length ? `missing: ${missing.join(", ")}` : "", extra.length ? `unexpected: ${extra.join(", ")}` : ""].filter(Boolean).join("; "), sql: "-- compared against information_schema.columns" };
  }
  if (r.type === "row_count") {
    const sql = `SELECT (SELECT COUNT(*) FROM ${q(r.table)}) AS source_rows, (SELECT COUNT(*) FROM ${q(r.refTable!)}) AS target_rows`;
    const res = await run(sql);
    if (!res.success) return { ...base, checked: 0, failed: 0, status: "error", message: res.message ?? "failed", sql };
    const [a, b] = (res.rows[0] as number[]).map(Number);
    const ok = Math.abs(a - b) <= (r.tolerance ?? 0);
    return { ...base, checked: 1, failed: ok ? 0 : 1, status: ok ? "pass" : "fail", message: `source ${a} rows, target ${b} rows${ok ? "" : ` (difference ${Math.abs(a - b)})`}`, sql, sample: { columns: res.columns, rows: res.rows } };
  }

  const failing = failingRowsSql(r)!;
  const sql = `SELECT (SELECT COUNT(*) FROM ${q(r.table)}) AS checked, (SELECT COUNT(*) FROM (${failing}) f) AS failed`;
  const counts = await run(sql);
  if (!counts.success) return { ...base, checked: 0, failed: 0, status: "error", message: counts.message ?? "failed", sql: failing };
  const [checked, failed] = (counts.rows[0] as number[]).map(Number);
  const sample = failed ? await run(`${failing} LIMIT 50`) : null;
  return {
    ...base,
    checked,
    failed,
    status: failed ? "fail" : "pass",
    message: failed ? `${failed} of ${checked} record(s) fail` : `All ${checked} record(s) pass`,
    sample: sample?.success ? { columns: sample.columns, rows: sample.rows } : undefined,
    sql: failing,
  };
}

/**
 * Quality score = mean over rules of the pass rate, where a row-level rule's pass rate is
 * (checked − failed) / checked and a table-level rule (schema, row count) is 1 or 0.
 * Rules that errored are excluded and reported separately.
 */
export function qualityScore(results: RuleResult[]): number | null {
  const scored = results.filter((r) => r.status !== "error" && r.checked > 0);
  if (!scored.length) return null;
  return Math.round((100 * scored.reduce((s, r) => s + (r.checked - r.failed) / r.checked, 0)) / scored.length);
}

/** Suggested starter rules from the real schema (+ an id-naming heuristic for undeclared foreign keys). */
export function suggestRules(schema: SchemaTable[]): Rule[] {
  const out: Rule[] = [];
  const pkOf = new Map(schema.map((t) => [t.name, t.columns.filter((c) => c.pk).map((c) => c.name)]));
  for (const t of schema) {
    const pk = pkOf.get(t.name) ?? [];
    if (pk.length) out.push({ id: `pk-${t.name}`, name: `${t.name}: primary key`, type: "primary_key", table: t.name, columns: pk, suggested: true });
    for (const c of t.columns) {
      if (c.fk) out.push({ id: `fk-${t.name}-${c.name}`, name: `${t.name}.${c.name} → ${c.fk.table}`, type: "foreign_key", table: t.name, columns: [c.name], refTable: c.fk.table, refColumn: c.fk.column, suggested: true });
      else if (c.name.endsWith("_id") && !c.pk) {
        const target = schema.find((x) => x.name !== t.name && (pkOf.get(x.name) ?? []).includes(c.name));
        if (target) out.push({ id: `fk-${t.name}-${c.name}`, name: `${t.name}.${c.name} → ${target.name} (no declared FK)`, type: "foreign_key", table: t.name, columns: [c.name], refTable: target.name, refColumn: c.name, suggested: true });
      }
      if (!c.notNull && !c.pk) out.push({ id: `nn-${t.name}-${c.name}`, name: `${t.name}.${c.name}: not null`, type: "not_null", table: t.name, columns: [c.name], suggested: true });
      if (/email/i.test(c.name)) out.push({ id: `dt-${t.name}-${c.name}`, name: `${t.name}.${c.name}: valid email`, type: "data_type", table: t.name, columns: [c.name], expected: "email", suggested: true });
    }
  }
  return out;
}

// ── Saved rules and runs (this browser) ─────────────────────────────────
const RULES = (d: string) => `sqlp.dq.rules.${d}`;
const RUNS = (d: string) => `sqlp.dq.runs.${d}`;
const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};
export const getRules = (d: string) => read<Rule[] | null>(RULES(d), null);
const RULES_AT = (d: string) => `sqlp.dq.rulesAt.${d}`;
export function saveRules(d: string, rules: Rule[]) {
  write(RULES(d), rules);
  write(RULES_AT(d), new Date().toISOString());
  dataSink()?.rules(d, rules);
}
export const getRuns = (d: string) => read<QualityRun[]>(RUNS(d), []);
/** Runs are kept without sample rows to stay small. */
export function saveRun(d: string, run: QualityRun) {
  write(RUNS(d), [{ ...run, results: run.results.map(({ sample: _s, ...r }) => r) }, ...getRuns(d)].slice(0, 20));
  dataSink()?.run(d, run);
}

/** Per-rule change in failed records between two runs (negative = improvement). */
export function compareRuns(older: QualityRun, newer: QualityRun) {
  return newer.results.map((r) => {
    const before = older.results.find((x) => x.ruleId === r.ruleId);
    return { ruleId: r.ruleId, name: r.name, before: before?.failed ?? null, after: r.failed, delta: before ? r.failed - before.failed : null };
  });
}
