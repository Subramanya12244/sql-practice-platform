/**
 * Which query the SQL Practice visualization shows, and how it relates to the editor. Pure: no React, no DOM, no storage.
 *
 * The visualization belongs to the newest SUCCESSFULLY executed query. A query that failed is never shown in its place, and nothing
 * is shown until the learner has run something (the question's starter or reference query is never visualized for them).
 * An explicit pick (the button on a failed latest run, or a History entry) is a "pin" that only lasts until the next execution.
 *
 * Status of what is displayed:
 *   current          it is the query in the editor (or, reason "failed-run", the editor's query, which failed: the steps show where it stopped)
 *   last-successful  it is the newest successful run, but the editor holds something else ("edited") or the newest run failed ("latest-failed")
 *   stale            it is an earlier query ("older-run"), or a failed run the editor has since moved away from ("edited-failed")
 *   none             nothing is displayed ("no-run": nothing executed yet; "not-visualized": a successful run exists but was not asked for yet; "only-failed": every run so far failed)
 */
export interface ExecLike {
  at: string;
  sql: string;
  ok: boolean;
}

export type VizStatus = "current" | "last-successful" | "stale" | "none";
export type VizReason = "matches-editor" | "failed-run" | "edited" | "latest-failed" | "older-run" | "edited-failed" | "no-run" | "not-visualized" | "only-failed";

/** An explicit choice of a query to show, valid until the next execution is recorded (`after` is `execs[0].at` when it was made). */
export interface VizPin {
  sql: string;
  after: string;
}

export interface VizSourceInput {
  /** Executions of this question, newest first (the order of `getExecs`). */
  execs: readonly ExecLike[];
  /** The text now in the editor; `undefined` when unknown (then the editor is taken to match). */
  draft?: string;
  /** True once the learner asked for the visualization (Visualize button or the Visualize tab link); until then nothing is shown. */
  started: boolean;
  pin?: VizPin | null;
}

export interface VizSource {
  status: VizStatus;
  reason: VizReason;
  /** The query to display, or null. */
  sql: string | null;
  /** The newest successfully executed query, or null. */
  lastSuccessfulSql: string | null;
  /** The newest executed query, successful or not, or null. */
  latestSql: string | null;
}

/** Whitespace and a trailing semicolon do not make a different query. Case and comments do. */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().replace(/\s*;+$/, "");
}

export const sameSql = (a: string | null | undefined, b: string | null | undefined): boolean =>
  a != null && b != null && normalizeSql(a) === normalizeSql(b);

export function lastSuccessful(execs: readonly ExecLike[]): ExecLike | null {
  return execs.find((e) => e.ok && e.sql.trim() !== "") ?? null;
}

export function vizSource({ execs, draft, started, pin }: VizSourceInput): VizSource {
  const latest = execs[0] ?? null;
  const good = lastSuccessful(execs);
  const lastSuccessfulSql = good?.sql ?? null;
  const latestSql = latest?.sql ?? null;
  const live = pin && pin.after === (latest?.at ?? "") ? pin.sql : null;
  const shown = live ?? (started ? lastSuccessfulSql : null);
  const base = { sql: shown, lastSuccessfulSql, latestSql };
  const editorMatches = (sql: string) => draft === undefined || sameSql(draft, sql);

  if (shown === null) return { ...base, status: "none", reason: execs.length === 0 ? "no-run" : good ? "not-visualized" : "only-failed" };
  if (sameSql(shown, lastSuccessfulSql)) {
    if (latest && !latest.ok) return { ...base, status: "last-successful", reason: "latest-failed" };
    return { ...base, ...(editorMatches(shown) ? { status: "current", reason: "matches-editor" } : { status: "last-successful", reason: "edited" }) } as VizSource;
  }
  if (latest && !latest.ok && sameSql(shown, latestSql)) {
    return { ...base, ...(editorMatches(shown) ? { status: "current", reason: "failed-run" } : { status: "stale", reason: "edited-failed" }) } as VizSource;
  }
  return { ...base, status: "stale", reason: "older-run" };
}

/** Plain, short wording for each state (also what the notice component shows). */
export function vizNoticeText(status: VizStatus, reason: VizReason): string {
  switch (`${status}/${reason}`) {
    case "current/matches-editor": return "Showing the query in your editor.";
    case "current/failed-run": return "This query failed. The steps show where it stopped.";
    case "last-successful/edited": return "You changed the editor since this ran. Showing your last successful run.";
    case "last-successful/latest-failed": return "Your latest run failed. Showing your last successful run, not the editor.";
    case "stale/older-run": return "Showing an earlier query, not your latest successful run.";
    case "stale/edited-failed": return "This failed run is not the query in your editor any more.";
    case "none/only-failed": return "Your runs so far failed, so there is nothing to show yet.";
    case "none/not-visualized": return "Press the button to visualize your last successful run.";
    default: return "Nothing to show yet. Run a query, then visualize it here.";
  }
}
