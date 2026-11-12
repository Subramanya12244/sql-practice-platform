/**
 * The Query Cinema's script, as pure data: one *step* per thing SQL does to the rows, in SQL's logical order, each with the
 * real rows it moved (from `rowTrace.ts`), the exact counts (from `visualize.ts`) and the teaching text for that step.
 * Nothing here runs a query or touches the DOM, so stepping and replaying never re-execute anything.
 *
 * A FROM with joins becomes one FROM step (the first table is read) followed by one JOIN step per join, because the learner
 * should see the tables, then the matching. Everything else maps one stage to one step.
 *
 * Logical order only: these steps are the order SQL *defines* its clauses to apply. PostgreSQL's physical plan can differ and
 * is shown separately (Execution plan tab). Nothing here claims otherwise.
 */
import type { Stage, Visualization } from "../visualize";
import { baseFrame, emptyFacts, type Board, type FlowFrame, type FrameKind, type IdKind } from "./rowFlow";
import type { RowTrace } from "./rowTrace";

export interface StepText {
  /** What SQL does here, in one sentence. */
  does: string;
  /** Why the stage is needed. */
  why: string;
  /** Which rows changed, with the real numbers. */
  changed: string;
  /** What would happen without this clause, with the real numbers where they are known. */
  ifRemoved: string;
}

export interface CinemaStep {
  id: string;
  /** Short name on the pipeline rail: FROM, JOIN, WHERE ... */
  label: string;
  clause: Stage["clause"];
  stageIndex: number;
  joinIndex?: number;
  kind: FrameKind;
  title: string;
  board?: Board;
  frame?: FlowFrame;
  summary: string;
  limited?: string;
  identity: IdKind;
  /** Rows entering and leaving, exact (not the drawn sample). */
  rowsIn?: number;
  rowsOut?: number;
  /** The words of this clause as the learner wrote them, so the fragment can be shown beside the animation. */
  fragment?: string;
  /** The predicate, key list or join condition this step applies. */
  expr?: string;
  /** The ON condition when this is a join step. */
  on?: string;
  joinKind?: string;
  source?: Stage["source"];
  text: StepText;
  /** True when no row-level board exists: the stage is explained and its sample table shown instead. */
  tableOnly: boolean;
  /** Why a stage has no row data, if it does not. */
  note?: string;
}

const n = (v: number | undefined) => (v === undefined ? "?" : v.toLocaleString());
const rows = (v: number | undefined) => `${n(v)} ${v === 1 ? "row" : "rows"}`;

/* ---------- column choice ---------- */

/**
 * Which columns of a wide row to draw. Columns the query names come first (they are why the row matters), then the leading
 * columns, up to `max`; the original order is kept. A 24-column joined row would otherwise be unreadable.
 */
export function pickColumns(cols: string[], sql: string, max: number, mustHave: string[] = [], empty: ReadonlySet<number> = new Set()): number[] {
  if (cols.length <= max) return cols.map((_, i) => i);
  const text = sql.toLowerCase();
  const bare = (c: string) => c.split(".").pop()!.toLowerCase();
  const mentioned = (c: string) => new RegExp(`(^|[^\\w])${bare(c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`).test(text);
  const chosen = new Set<number>();
  cols.forEach((c, i) => { if (chosen.size < max && mustHave.some((m) => m.toLowerCase() === c.toLowerCase())) chosen.add(i); });
  cols.forEach((c, i) => { if (chosen.size < max && mentioned(c)) chosen.add(i); });
  // Filler comes from the leading columns, but a column that is NULL in every row drawn tells the learner nothing.
  cols.forEach((_, i) => { if (chosen.size < max && !empty.has(i)) chosen.add(i); });
  cols.forEach((_, i) => { if (chosen.size < max) chosen.add(i); });
  return [...chosen].sort((a, b) => a - b);
}

/** Column names (as they appear in `cols`) that an ON condition or predicate mentions: drawn highlighted. */
export function keyColumns(expr: string | undefined, cols: string[]): Set<string> {
  const out = new Set<string>();
  if (!expr) return out;
  const text = expr.toLowerCase();
  for (const c of cols) {
    const full = c.toLowerCase();
    if (new RegExp(`(^|[^\\w.])${full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`).test(text)) out.add(c);
  }
  return out;
}

/* ---------- text ---------- */

const GENERIC: Record<string, Pick<StepText, "does" | "why">> = {
  from: { does: "Reads the rows of the first table. Every later step works on these rows.", why: "SQL has to know which rows exist before it can match, filter, group or sort anything." },
  join: { does: "Pairs each row with the rows of the next table whose join key matches.", why: "Related facts live in different tables. The join puts them side by side so one row can describe both." },
  where: { does: "Tests the condition on every row. Rows where it is true stay; rows where it is false or NULL (unknown) are dropped.", why: "Filtering early means the later steps (grouping, sorting) only handle rows you care about." },
  "group by": { does: "Collects rows that share the same key into one group each, and computes the aggregates (COUNT, SUM ...) per group.", why: "Aggregates answer questions about sets of rows (per customer, per country). Groups define those sets." },
  having: { does: "Tests the condition on each group's aggregate values. Groups where it is true stay; the others are dropped.", why: "WHERE runs before grouping and cannot see aggregates. HAVING is the filter that can." },
  window: { does: "Computes a value over a window of related rows without merging them. Every row stays.", why: "Rankings and running totals need the other rows' values while keeping each row." },
  select: { does: "Computes the output columns for each row (or one row per group when there are aggregates).", why: "This is where the query decides what the result looks like." },
  distinct: { does: "Keeps one row from each set of identical rows and drops the repeats.", why: "Removes duplicates so each distinct value appears once." },
  "order by": { does: "Puts the rows into the requested order. Before this, SQL promises no particular order.", why: "A result has no reliable order unless ORDER BY says so." },
  limit: { does: "Keeps only the first rows (after skipping any OFFSET) and cuts off the rest.", why: "Returns just the top results, which is cheaper and easier to read." },
  union: { does: "Combines the rows of two queries into one result.", why: "Brings similar rows from different sources into one list." },
  intersect: { does: "Keeps only the rows that appear in both queries.", why: "Finds what two sources have in common." },
  except: { does: "Keeps the rows of the first query that do not appear in the second.", why: "Finds what is in one source but missing from the other." },
};

export interface Counts { rowsIn?: number; rowsOut?: number; leftRows?: number; rightRows?: number; matchedPairs?: number; unmatchedLeft?: number; unmatchedRight?: number }

/** What would happen without this clause. Numbers are the exact counts the visualizer already measured. */
export function ifRemoved(clause: Stage["clause"] | "join", c: Counts, kind?: string): string {
  switch (clause) {
    case "from": return "There would be nothing to work on: every query needs a source of rows.";
    case "where": return c.rowsIn !== undefined && c.rowsOut !== undefined
      ? `All ${rows(c.rowsIn)} would continue instead of ${n(c.rowsOut)}${c.rowsIn > c.rowsOut ? ` (${n(c.rowsIn - c.rowsOut)} more rows to group and sort)` : ""}.`
      : "Every row would continue to the next step.";
    case "having": return c.rowsIn !== undefined ? `All ${n(c.rowsIn)} ${c.rowsIn === 1 ? "group" : "groups"} would be returned, including the ones whose aggregates fail the condition.` : "Every group would be returned.";
    case "group by": return "The aggregates would no longer be per group: they would run over all rows at once (or SQL would reject the query if plain columns are selected beside aggregates).";
    case "order by": return "The rows would come back in whatever order PostgreSQL produced them, which SQL does not guarantee and which can change between runs.";
    case "limit": return c.rowsIn !== undefined ? `All ${rows(c.rowsIn)} would be returned instead of ${n(c.rowsOut)}.` : "All rows would be returned.";
    case "distinct": return c.rowsIn !== undefined && c.rowsOut !== undefined ? `All ${rows(c.rowsIn)} would stay, including ${n(c.rowsIn - c.rowsOut)} repeated ${c.rowsIn - c.rowsOut === 1 ? "row" : "rows"}.` : "Repeated rows would stay.";
    case "select": return "The result would not have the columns you asked for.";
    case "window": return "The ranking or running value would not exist.";
    case "join":
      return /LEFT|RIGHT|FULL/i.test(kind ?? "")
        ? `With an INNER JOIN, the rows with no partner would be dropped instead of kept with NULLs${c.unmatchedLeft || c.unmatchedRight ? ` (${n((c.unmatchedLeft ?? 0) + (c.unmatchedRight ?? 0))} such ${(c.unmatchedLeft ?? 0) + (c.unmatchedRight ?? 0) === 1 ? "row" : "rows"})` : ""}.`
        : c.leftRows !== undefined && c.rightRows !== undefined
          ? `Without the ON condition every left row would pair with every right row: ${n(c.leftRows)} × ${n(c.rightRows)} = ${n(c.leftRows * c.rightRows)} rows instead of ${n(c.matchedPairs ?? c.rowsOut)}.`
          : "Without the ON condition every left row would pair with every right row.";
    default: return "The result would be different.";
  }
}

/** Which rows changed, in words, from the frame's own facts and the exact counts. */
function changedText(step: { kind: FrameKind; clause: Stage["clause"] }, f: FlowFrame | undefined, c: Counts): string {
  const x = f?.variants?.length ? f.variants[f.variants.length - 1].facts : f?.facts;
  switch (step.kind) {
    case "scan": return `${rows(c.rowsOut ?? c.rowsIn)} enter${(c.rowsOut ?? c.rowsIn) === 1 ? "s" : ""}. Nothing is removed yet.`;
    case "join": return `${n(c.matchedPairs)} matched ${c.matchedPairs === 1 ? "pair" : "pairs"} make ${rows(c.rowsOut)}${c.unmatchedLeft ? `; ${n(c.unmatchedLeft)} left ${c.unmatchedLeft === 1 ? "row" : "rows"} had no partner` : ""}${c.unmatchedRight ? `; ${n(c.unmatchedRight)} right ${c.unmatchedRight === 1 ? "row" : "rows"} had no partner` : ""}.`;
    case "filter": return c.rowsIn !== undefined && c.rowsOut !== undefined ? `${n(c.rowsIn - c.rowsOut)} of ${n(c.rowsIn)} removed; ${n(c.rowsOut)} kept.` : "Rows that fail the condition are removed.";
    case "group": return c.rowsIn !== undefined && c.rowsOut !== undefined ? `${rows(c.rowsIn)} gather into ${n(c.rowsOut)} ${c.rowsOut === 1 ? "group" : "groups"}.` : "Rows gather into groups.";
    case "aggregate": return c.rowsIn !== undefined && c.rowsOut !== undefined ? `${n(c.rowsIn)} ${c.rowsIn === 1 ? "group becomes" : "groups become"} ${rows(c.rowsOut)}: one output row per group.` : "Each group becomes one output row.";
    case "project": return `The same ${rows(c.rowsOut)} stay; each is reduced to the output columns.`;
    case "distinct": return c.rowsIn !== undefined && c.rowsOut !== undefined ? `${n(c.rowsIn - c.rowsOut)} duplicate ${c.rowsIn - c.rowsOut === 1 ? "row" : "rows"} merged: ${n(c.rowsIn)} → ${n(c.rowsOut)}.` : "Duplicates merge.";
    case "sort": return `${x?.moves.filter((m) => m.from !== m.to).length ?? 0} of the drawn rows moved to a new position. No row is added or removed.`;
    case "limit": return c.rowsIn !== undefined && c.rowsOut !== undefined ? `${n(c.rowsOut)} kept, ${n(c.rowsIn - c.rowsOut)} cut off.` : "Rows past the limit are cut off.";
    default: return f?.summary ?? "";
  }
}

/* ---------- the script ---------- */

const RAIL: Record<string, string> = { from: "FROM", where: "WHERE", "group by": "GROUP BY", having: "HAVING", window: "WINDOW", select: "SELECT", distinct: "DISTINCT", "order by": "ORDER BY", limit: "LIMIT", union: "UNION", intersect: "INTERSECT", except: "EXCEPT" };

export function clauseRange(v: Visualization, stage: Stage): [number, number] | undefined {
  if (stage.range) return stage.range;
  const key = stage.clause === "distinct" || stage.clause === "window" ? "select" : stage.clause === "limit" ? (v.parsed.ranges.limit ? "limit" : "offset") : stage.clause;
  return v.parsed.ranges[key as keyof typeof v.parsed.ranges];
}

/** The first table's rows as their own FROM step, taken from the left lane of the first join board. */
function scanBoardFromJoin(first: Board, label: string): Board {
  const left = first.cards.filter((c) => c.id.startsWith("L:") && c.from.lane === 0);
  // The colours that pair join partners mean nothing before any matching has happened, so they are dropped here.
  const cards = left.map((c, i) => ({ ...c, id: c.id, from: { lane: -0.7, row: i }, to: { lane: 0, row: i }, appear: true, tone: "new" as const, toneBefore: "normal" as const, badge: undefined, group: undefined }));
  return { lanes: [{ label, count: first.lanes[0]?.count }], cards, rows: Math.max(1, cards.length) };
}

export function buildCinema(viz: Visualization, trace: RowTrace | undefined, sql: string): CinemaStep[] {
  const steps: CinemaStep[] = [];
  viz.stages.forEach((st, i) => {
    const frame = trace?.frames[i] ?? baseFrame(st, viz.stages[i - 1], i);
    const rangeOf = clauseRange(viz, st);
    const fragment = rangeOf ? sql.slice(rangeOf[0], rangeOf[1]).trim() : undefined;
    // Rows drawn from row-level queries were really executed, even when the stage's own explanation is parsed (LIMIT, ORDER BY).
    const base = { clause: st.clause, stageIndex: i, identity: frame.identity, source: frame.source === "trace" ? ("executed" as const) : st.source };
    if (st.clause === "from" && (st.joins?.length ?? 0) > 0) {
      // The split depends on the parsed joins, not on the trace, so the number of steps never changes when row data arrives.
      const first = viz.parsed.joins[0]?.source ?? "the first table";
      const v0 = frame.variants?.find((x) => x.index === 0) ?? frame.variants?.[0];
      const scan = v0 ? scanBoardFromJoin(v0.board, first) : undefined;
      const cFrom: Counts = { rowsOut: st.joins![0].leftRows ?? scan?.cards.length };
      const scanSummary = `FROM: ${rows(cFrom.rowsOut)} ${cFrom.rowsOut === 1 ? "is" : "are"} read from ${first}.`;
      const scanLimited = scan && scan.cards.length < (cFrom.rowsOut ?? 0) ? `showing ${scan.cards.length} of ${n(cFrom.rowsOut)} rows` : undefined;
      steps.push({
        ...base, id: "from", label: "FROM", kind: "scan", title: `FROM — read ${first}`, board: scan, summary: scanSummary,
        frame: scan ? { stageIndex: i, clause: "from", kind: "scan", identity: frame.identity, board: scan, summary: scanSummary, limited: scanLimited, facts: { ...emptyFacts(), entered: scan.cards.map((c) => c.id) }, source: frame.source } : undefined,
        limited: scanLimited, rowsOut: cFrom.rowsOut, fragment: fragment?.split("\n")[0], tableOnly: !scan,
        note: scan ? undefined : `FROM: ${rows(cFrom.rowsOut)} are read from ${first}.`,
        text: { ...GENERIC.from, changed: changedText({ kind: "scan", clause: "from" }, frame, cFrom), ifRemoved: ifRemoved("from", cFrom) },
      });
      st.joins!.forEach((js, k) => {
        const variant = frame.variants?.find((x) => x.index === k);
        const cJoin: Counts = { rowsIn: js.leftRows, rowsOut: js.resultRows, leftRows: js.leftRows, rightRows: js.rightRows, matchedPairs: js.matchedPairs, unmatchedLeft: js.unmatchedLeft, unmatchedRight: js.unmatchedRight };
        const part = viz.parsed.joins[k + 1];
        const joinKind = variant?.kind ?? js.kind;
        const summary = variant?.summary ?? `${js.kind} ${js.right}: ${rows(js.resultRows)} result from ${n(js.leftRows)} left and ${n(js.rightRows)} right rows.`;
        steps.push({
          ...base, id: `join:${k}`, label: st.joins!.length > 1 ? `JOIN ${k + 1}` : "JOIN", joinIndex: k, kind: "join", title: `${joinKind} ${part?.source ?? js.right} — match rows on the join key`.replace(/\s+/g, " "),
          board: variant?.board, summary, limited: variant?.limited, rowsIn: js.leftRows, rowsOut: js.resultRows,
          frame: variant ? { stageIndex: i, clause: "from", kind: "join", identity: frame.identity, board: variant.board, summary, limited: variant.limited, facts: variant.facts, source: frame.source, expr: variant.on } : undefined,
          fragment: part ? `${part.kind} ${part.source}${part.on ? ` ON ${part.on}` : ""}` : undefined, on: variant?.on ?? js.on, joinKind, expr: variant?.on ?? js.on, tableOnly: !variant, note: variant ? undefined : summary,
          text: { ...GENERIC.join, changed: changedText({ kind: "join", clause: "from" }, frame, cJoin), ifRemoved: ifRemoved("join", cJoin, joinKind) },
        });
      });
      return;
    }
    const kind = frame.kind;
    const tableOnly = kind === "none" || !frame.board;
    const c: Counts = { rowsIn: st.rowsIn ?? viz.stages[i - 1]?.rowsOut, rowsOut: st.rowsOut };
    const generic = GENERIC[st.clause] ?? { does: st.explanation, why: "" };
    steps.push({
      ...base, id: `${st.clause}:${i}`, label: RAIL[st.clause] ?? st.clause.toUpperCase(), kind, title: st.title, board: frame.board, frame, summary: frame.summary, limited: frame.limited,
      rowsIn: c.rowsIn, rowsOut: c.rowsOut, fragment, expr: frame.expr, tableOnly, note: tableOnly ? frame.summary : undefined,
      text: { does: generic.does, why: generic.why, changed: changedText({ kind, clause: st.clause }, frame, c), ifRemoved: ifRemoved(st.clause, c) },
    });
  });
  return fillCounts(steps, viz);
}

/**
 * Stages that do not change how many rows there are (ORDER BY, window functions) carry the previous count through, and every
 * stage's "rows in" is the previous stage's "rows out", so the rail always shows a complete, exact funnel. LIMIT's count comes
 * from the clause when it is a plain number, otherwise it stays unknown rather than guessed.
 */
function fillCounts(steps: CinemaStep[], viz: Visualization): CinemaStep[] {
  const limit = /^\d+$/.test((viz.parsed.clauses.limit ?? "").trim()) ? Number(viz.parsed.clauses.limit!.trim()) : undefined;
  const offset = /^\d+$/.test((viz.parsed.clauses.offset ?? "").trim()) ? Number(viz.parsed.clauses.offset!.trim()) : 0;
  let prev: number | undefined;
  for (const st of steps) {
    if (st.rowsIn === undefined && st.kind !== "scan") st.rowsIn = prev;
    if (st.rowsOut === undefined) {
      if (st.clause === "order by" || st.clause === "window") st.rowsOut = st.rowsIn;
      else if (st.clause === "limit" && st.rowsIn !== undefined && limit !== undefined) st.rowsOut = Math.max(0, Math.min(limit, st.rowsIn - offset));
    }
    if (st.rowsOut !== undefined) prev = st.rowsOut;
  }
  return steps;
}

/** The step index whose stage is `stageIndex` (the first one, for a FROM split into FROM and JOIN steps). */
export const stepOfStage = (steps: CinemaStep[], stageIndex: number) => Math.max(0, steps.findIndex((s) => s.stageIndex === stageIndex));
