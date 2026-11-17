/**
 * Profile a CSV in the browser: column types, missing values, duplicate rows, distinct counts, numeric spread and outliers.
 * Everything is computed from the rows given; nothing is estimated, sampled or sent anywhere. Types are inferred from the values
 * (ISO dates only), so a column that is "mostly numbers" reports its non-numbers as invalid values instead of hiding them.
 */
import { MAX_ROWS, parseCsv } from "./lab/etl";

export type ColType = "integer" | "decimal" | "boolean" | "date" | "text" | "empty";

export interface NumberStats { min: number; max: number; mean: number; median: number; q1: number; q3: number; outliers: number; lowFence: number; highFence: number }
export interface Bin { from: number; to: number; count: number }

export interface ColumnProfile {
  name: string;
  type: ColType;
  rows: number;
  missing: number;
  distinct: number;
  /** Non-missing values that do not fit the column's type. */
  invalid: number;
  invalidSamples: string[];
  top: { value: string; count: number }[];
  /** Distinct, never missing: a candidate key. */
  unique: boolean;
  /** A text column where a typed pattern still fits at least half the values: probably mixed formats, not free text. */
  mixed?: { type: ColType; share: number };
  stats?: NumberStats;
  histogram?: Bin[];
  minLength?: number;
  maxLength?: number;
}

export interface Profile {
  rows: number;
  columns: ColumnProfile[];
  duplicateRows: number;
  duplicateSamples: string[][];
  /** Cells that are missing, over every column. */
  missingCells: number;
}

export interface Issue { level: "problem" | "note"; column?: string; text: string }

const MISSING = new Set(["", "null", "na", "n/a", "nan", "none", "nil", "-", "--", "?"]);
export const isMissing = (v: string) => MISSING.has(v.trim().toLowerCase());

const INT = /^[+-]?\d+$/;
const DEC = /^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/;
const BOOL = /^(true|false|t|f|yes|no)$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isDate(v: string): boolean {
  const m = DATE.exec(v.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Share of non-missing values a type must cover to name the column; the rest are reported as invalid. */
export const TYPE_THRESHOLD = 0.9;

export function inferType(values: string[]): { type: ColType; invalid: string[]; mixed?: { type: ColType; share: number } } {
  const v = values.map((x) => x.trim());
  if (v.length === 0) return { type: "empty", invalid: [] };
  const tests: [ColType, (s: string) => boolean][] = [
    ["integer", (s) => INT.test(s)],
    ["decimal", (s) => DEC.test(s)],
    ["date", isDate],
    ["boolean", (s) => BOOL.test(s)],
  ];
  for (const [type, ok] of tests) {
    const hits = v.filter(ok).length;
    if (hits / v.length >= TYPE_THRESHOLD) return { type, invalid: v.filter((s) => !ok(s)) };
  }
  const best = tests.map(([type, ok]) => ({ type, share: v.filter(ok).length / v.length })).sort((a, b) => b.share - a.share)[0];
  return best.share >= 0.5 ? { type: "text", invalid: [], mixed: best } : { type: "text", invalid: [] };
}

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export function numberStats(values: number[]): NumberStats | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr, highFence = q3 + 1.5 * iqr;
  return {
    min: s[0], max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length, median: quantile(s, 0.5), q1, q3,
    lowFence, highFence, outliers: s.filter((x) => x < lowFence || x > highFence).length,
  };
}

export function histogram(values: number[], bins = 10): Bin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values), max = Math.max(...values);
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const n = Math.min(bins, new Set(values).size);
  const w = (max - min) / n;
  const out: Bin[] = Array.from({ length: n }, (_, i) => ({ from: min + i * w, to: min + (i + 1) * w, count: 0 }));
  for (const x of values) out[Math.min(n - 1, Math.floor((x - min) / w))].count++;
  return out;
}

export function profileRows(rows: Record<string, string>[]): Profile {
  const names = rows.length ? Object.keys(rows[0]) : [];
  const columns: ColumnProfile[] = names.map((name) => {
    const all = rows.map((r) => r[name] ?? "");
    const present = all.filter((x) => !isMissing(x));
    const { type, invalid, mixed } = inferType(present);
    const counts = new Map<string, number>();
    for (const x of present) counts.set(x.trim(), (counts.get(x.trim()) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([value, count]) => ({ value, count }));
    const col: ColumnProfile = {
      name, type, rows: rows.length, missing: all.length - present.length, distinct: counts.size,
      invalid: invalid.length, invalidSamples: [...new Set(invalid)].slice(0, 5), top,
      unique: present.length === rows.length && counts.size === rows.length && rows.length > 0,
    };
    if (mixed) col.mixed = mixed;
    if (type === "integer" || type === "decimal") {
      const nums = present.filter((x) => DEC.test(x.trim())).map(Number);
      col.stats = numberStats(nums);
      col.histogram = histogram(nums);
    }
    if (type === "text") {
      col.minLength = Math.min(...present.map((x) => x.length));
      col.maxLength = Math.max(...present.map((x) => x.length));
    }
    return col;
  });
  const seen = new Set<string>();
  let duplicateRows = 0;
  const duplicateSamples: string[][] = [];
  for (const r of rows) {
    const vals = names.map((n) => (r[n] ?? "").trim());
    const key = JSON.stringify(vals);
    if (seen.has(key)) { duplicateRows++; if (duplicateSamples.length < 3) duplicateSamples.push(vals); } else seen.add(key);
  }
  return { rows: rows.length, columns, duplicateRows, duplicateSamples, missingCells: columns.reduce((s, c) => s + c.missing, 0) };
}

export class ProfileError extends Error {}

/** The header's column names exactly as written. parseCsv builds objects, so repeated names would collapse into one key there. */
export function headerNames(text: string): string[] {
  const t = text.replace(/\r\n?/g, "\n");
  const names: string[] = [];
  let field = "", quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { names.push(field.trim()); field = ""; }
    else if (c === "\n") { if (field !== "" || names.length) break; /* skip leading blank lines */ }
    else field += c;
  }
  if (field !== "" || names.length) names.push(field.trim());
  return names;
}

/** Parse and profile CSV text. Throws ProfileError with a plain message when there is nothing to profile. */
export function profileCsv(text: string): Profile {
  let rows: Record<string, string>[];
  try { rows = parseCsv(text).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")]))); } catch (e) { throw new ProfileError(e instanceof Error ? e.message : "The CSV could not be read."); }
  if (rows.length === 0) throw new ProfileError("No data rows found. The first line must be the header, followed by at least one row.");
  const header = headerNames(text);
  if (new Set(header).size !== header.length) throw new ProfileError("Two columns have the same name in the header. Rename one and try again.");
  return profileRows(rows);
}

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : "0%");

/** Plain statements about what the profile found, problems first. Each one is a count that is in the profile above it. */
export function issuesOf(p: Profile): Issue[] {
  const out: Issue[] = [];
  if (p.duplicateRows > 0) out.push({ level: "problem", text: `${p.duplicateRows.toLocaleString()} duplicate row${p.duplicateRows === 1 ? "" : "s"}: identical to an earlier row in every column.` });
  for (const c of p.columns) {
    if (c.type === "empty") { out.push({ level: "problem", column: c.name, text: `Every value in ${c.name} is missing.` }); continue; }
    if (c.missing > 0) out.push({ level: "problem", column: c.name, text: `${c.missing.toLocaleString()} of ${c.rows.toLocaleString()} values missing in ${c.name} (${pct(c.missing, c.rows)}).` });
    if (c.invalid > 0) out.push({ level: "problem", column: c.name, text: `${c.invalid.toLocaleString()} value${c.invalid === 1 ? "" : "s"} in ${c.name} do not fit ${c.type}, for example ${c.invalidSamples.map((s) => `"${s}"`).join(", ")}.` });
    if (c.mixed) out.push({ level: "problem", column: c.name, text: `${c.name} looks like ${c.mixed.type} but only ${pct(Math.round(c.mixed.share * c.rows), c.rows)} of its values fit; the rest are in another format, so it is read as text.` });
    if (c.stats && c.stats.outliers > 0) out.push({ level: "note", column: c.name, text: `${c.stats.outliers.toLocaleString()} outlier${c.stats.outliers === 1 ? "" : "s"} in ${c.name}: outside ${fmt(c.stats.lowFence)} to ${fmt(c.stats.highFence)} (1.5 × IQR).` });
    if (c.distinct === 1 && c.rows > 1 && c.missing === 0) out.push({ level: "note", column: c.name, text: `${c.name} has one value in every row ("${c.top[0].value}").` });
  }
  const keys = p.columns.filter((c) => c.unique).map((c) => c.name);
  if (keys.length) out.push({ level: "note", text: `Possible key column${keys.length === 1 ? "" : "s"}: ${keys.join(", ")} (every value present and different).` });
  return out;
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 100) / 100);
}

/** A Markdown report of the profile, for the learner to keep. */
export function reportMarkdown(p: Profile, name: string): string {
  const lines = [
    `# Data profile: ${name}`, "",
    `- Rows: ${p.rows.toLocaleString()}`, `- Columns: ${p.columns.length}`, `- Duplicate rows: ${p.duplicateRows.toLocaleString()}`, `- Missing cells: ${p.missingCells.toLocaleString()}`, "",
    "## Columns", "", "| Column | Type | Missing | Distinct | Invalid |", "| --- | --- | --- | --- | --- |",
    ...p.columns.map((c) => `| ${c.name} | ${c.type} | ${c.missing} (${pct(c.missing, c.rows)}) | ${c.distinct} | ${c.invalid} |`), "",
    "## Findings", "",
  ];
  const issues = issuesOf(p);
  lines.push(...(issues.length ? issues.map((i) => `- ${i.level === "problem" ? "Problem" : "Note"}: ${i.text}`) : ["- No problems found by these checks."]));
  lines.push("", `Profiled in the browser by DataForge. Types are inferred from values (a type needs ${TYPE_THRESHOLD * 100}% of the non-missing values); outliers use the 1.5 × IQR rule.`);
  return lines.join("\n");
}

export { MAX_ROWS };
