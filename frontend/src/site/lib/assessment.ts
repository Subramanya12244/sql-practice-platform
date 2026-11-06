/**
 * Assessment answers are checked by the database (migration 011), which holds only SHA-256
 * fingerprints of the expected results. The browser runs the learner's code and sends the
 * fingerprint of what it produced; reference solutions and expected outputs never reach the
 * browser before the attempt is submitted. The same functions compute the stored fingerprints
 * at build time (frontend/scripts/build-assessments.mts), so both sides normalise identically.
 */
import { normalizeValue } from "./resultCompare";

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SQL result fingerprint: lower-cased column names in order, values normalised exactly as the
 * practice grader does, rows sorted unless the question grades row order.
 */
export function sqlCanonical(columns: string[], rows: unknown[][], ordered: boolean): string {
  const r = rows.map((row) => JSON.stringify(row.map(normalizeValue)));
  if (!ordered) r.sort();
  return JSON.stringify({ c: columns.map((c) => c.trim().toLowerCase()), r });
}
export const sqlFingerprint = (columns: string[], rows: unknown[][], ordered: boolean) => sha256(sqlCanonical(columns, rows, ordered));

/** Prints one canonical JSON line per hidden case (value, or the exception type it raised). */
export const PY_CASES_HARNESS = String.raw`
import json as _dfj
def _df_canon(v):
    if v is None or isinstance(v, (bool, str)): return v
    if isinstance(v, int): return v
    if isinstance(v, float): return round(v, 6)
    if isinstance(v, (list, tuple)): return [_df_canon(x) for x in v]
    if isinstance(v, (set, frozenset)): return sorted((_df_canon(x) for x in v), key=lambda x: _dfj.dumps(x, sort_keys=True, default=str))
    if isinstance(v, dict): return {"__dict__": sorted(([_df_canon(k), _df_canon(x)] for k, x in v.items()), key=lambda p: _dfj.dumps(p[0], sort_keys=True, default=str))}
    if hasattr(v, "__iter__") and not hasattr(v, "keys"): return [_df_canon(x) for x in v]
    return repr(v)
for _df_case in _DF_CASES:
    try:
        _df_out = {"v": _df_canon(eval(_df_case))}
    except Exception as _df_e:
        _df_out = {"e": type(_df_e).__name__}
    print("__DF_CASE__" + _dfj.dumps(_df_out, sort_keys=True, ensure_ascii=False, default=str))
`;
export const pyCasesProgram = (cases: string[]) => `_DF_CASES = ${JSON.stringify(cases)}\n${PY_CASES_HARNESS}`;
export function readCases(stdout: string): string[] {
  return stdout.split("\n").filter((l) => l.startsWith("__DF_CASE__")).map((l) => l.slice("__DF_CASE__".length));
}
export const pyFingerprints = (outputs: string[]) => Promise.all(outputs.map(sha256));

export interface PublicItem {
  id: string; kind: "sql" | "python"; title: string; difficulty: string; topic: string;
  problem: string; objective?: string; ordered?: boolean; starter?: string; example?: string; cases?: string[];
}
export interface ItemResult { id: string; passed: boolean; cases_passed?: number; cases_total?: number; answered: boolean; reference: string; explanation: string }
export interface AttemptResult { id: string; score: number; total: number; submitted_at: string; started_at: string; items: ItemResult[] }
