/**
 * The extra, real data that `traceRows` (rowTrace.ts) fetches so the teaching cards (teach.ts) can show inputs, outputs and counts.
 * Types only. Every field is optional: a part that could not be fetched is absent and the card says so in its notes instead of
 * inventing anything. Values are exactly what the database returned (NULL stays null); counts are exact, rows are samples.
 *
 * Attached to `RowTrace.teach` (additive: the frames and every earlier field of RowTrace are unchanged).
 */
import type { TraceRow } from "./rowFlow";
import type { AggTrace } from "./aggregate";
import type { SortKey } from "./order";
import type { SubqueryRef } from "./relations";
import type { WindowData } from "./windows";

/** A relation sample: rows are the first ones, `total` the exact row count when known. */
export interface RelSample { columns: string[]; rows: unknown[][]; total?: number; error?: string }

/** One FROM source (a table, a CTE, a derived table) with its first rows. */
export interface SourceData extends RelSample {
  /** As written in the FROM, e.g. `orders o` or `(SELECT ...) t`. */
  source: string;
}

/** One join step of the FROM, with the real matched pairs and the rows that found no partner. */
export interface JoinData {
  /** 0 = the first JOIN. */
  index: number;
  kind: string;
  source: string;
  on?: string;
  label: string;
  leftColumns: string[];
  rightColumns: string[];
  matched: { left: unknown[]; right: unknown[] }[];
  unmatchedLeft: unknown[][];
  unmatchedRight: unknown[][];
  counts: { leftRows?: number; rightRows?: number; matchedPairs?: number; unmatchedLeft?: number; unmatchedRight?: number; resultRows?: number };
  /** The most matches any drawn left row has (a fan-out when above 1), from the drawn pairs. */
  maxMatches?: number;
}

/** WHERE or HAVING: rows (or groups) with what the predicate evaluated to, and the exact counts of each outcome. */
export interface FilterData {
  expr: string;
  columns: string[];
  kept: TraceRow[];
  removed: TraceRow[];
  /** Exact number of rows (groups) for which the predicate is true, false and NULL. */
  counts?: { true: number; false: number; null: number };
}

export interface GroupData {
  keyNames: string[];
  columns: string[];
  /** Rows entering GROUP BY, each with its group key (`key`). */
  rows: TraceRow[];
}

export interface OrderData {
  columns: string[];
  /** The first rows in sorted order; `pos` is the place each had before sorting. */
  rows: TraceRow[];
  keys: SortKey[];
  /** The sort-key values of each sorted row (aligned with `rows`); absent when they could not be fetched. */
  keyValues?: unknown[][];
  /** Rows whose sort key is NULL, per key, and the rows sorted, both exact; absent when they could not be fetched. */
  nullCounts?: number[];
  total?: number;
  hasPositions: boolean;
}

export interface CteData extends RelSample {
  /** As written. */
  name: string;
  /** The clauses of the main query (or the CTEs) that read it. */
  usedBy: string[];
  /** The clause where it is first read: from, where, having, select. */
  firstClause: string;
}

export interface SubqueryData extends RelSample {
  ref: SubqueryRef;
  /** The subquery depends on the outer row, so it could not be run on its own. */
  correlated?: boolean;
}

export interface TeachData {
  sources?: SourceData[];
  joins?: JoinData[];
  where?: FilterData;
  group?: GroupData;
  agg?: AggTrace;
  having?: FilterData;
  window?: WindowData;
  order?: OrderData;
  ctes?: CteData[];
  /** CTEs defined but never read: PostgreSQL does not evaluate them. */
  unusedCtes?: string[];
  subqueries?: SubqueryData[];
  /** What could not be fetched and why, in plain words. */
  notes: string[];
}
