/**
 * SQL set operations (UNION, INTERSECT, EXCEPT, with or without ALL) as visual stages. Owner: the set-operation agent.
 * Types here are the contract between lib/visualize.ts (which fills `Stage.setOp`), SetOpView (which draws it) and RowFlow.
 * Everything in this file is pure (no React, no I/O): query text builders, the row-fate rules and the wording.
 */

export type SetOpKind = "union" | "intersect" | "except";

/**
 * What happens to one input row (per PostgreSQL's rules):
 * - kept: its value reaches the result because of this row
 * - duplicate: an identical row already supplied that value, so this extra copy is dropped
 * - cancelled: EXCEPT: the right input has the same row, so the left row is removed
 * - unmatched: INTERSECT: the other input has no (further) identical row, so it is dropped
 * - not output: the right input of EXCEPT never reaches the result; it only removes left rows
 */
export type RowFate = "kept" | "duplicate" | "cancelled" | "unmatched" | "not output";
export interface RowMark {
  /** An identical row (NULL equal to NULL) exists on the other input, or for the ALL variants this copy has a partner there. */
  matched: boolean;
  fate: RowFate;
}

export interface SetSample {
  columns: string[];
  rows: unknown[][];
  /** One mark per row when the per-row check could run; see SetOpData.unavailable otherwise. */
  marks?: RowMark[];
}

export interface ColumnPair {
  position: number;
  /** Output names always come from the left input. */
  name: string;
  left?: string;
  right?: string;
  /** Type PostgreSQL gives the output column; absent when the operation is invalid. */
  result?: string;
  same: boolean;
}

export interface SetOpData {
  op: SetOpKind;
  all: boolean;
  left: SetSample;
  right: SetSample;
  leftCount?: number;
  rightCount?: number;
  /** Column pairing and type compatibility, from the real result columns and PostgreSQL's own errors. */
  compat: { ok: boolean; notes: string[] };
  /** Rows that appear in both inputs (INTERSECT) or were dropped as duplicates or because the right side had them. */
  matched?: SetSample;
  removed?: SetSample;
  result: SetSample;
  resultCount?: number;

  // --- additive fields (set-operation agent) ---
  /** What each input is, e.g. the SELECT text or "result of the earlier UNION". */
  leftLabel?: string;
  rightLabel?: string;
  pairs?: ColumnPair[];
  /** PostgreSQL's own error text when the combination is invalid. */
  error?: string;
  /** Distinct rows per input (NULLs equal), used for the arithmetic of the distinct variants. */
  leftDistinct?: number;
  rightDistinct?: number;
  matchedCount?: number;
  removedCount?: number;
  matchedLabel?: string;
  removedLabel?: string;
  /** Plain-language duplicate rule of this operator. */
  rule: string;
  /** The count arithmetic of this operator with the real numbers, and whether it equals the executed result. */
  arithmetic?: { text: string; ok: boolean };
  /** Figures that could not be obtained, with the reason. Keys: types, marks, matched, removed, counts. */
  unavailable?: Partial<Record<"types" | "marks" | "matched" | "removed" | "counts", string>>;
}

export const opName = (op: SetOpKind, all: boolean) => `${op.toUpperCase()}${all ? " ALL" : ""}`;

const NULL_NOTE = "For set operators two NULLs count as equal (unlike = in WHERE, where NULL = NULL is not true).";

export function ruleText(op: SetOpKind, all: boolean): string {
  if (op === "union") {
    return all
      ? `UNION ALL keeps every row of both inputs, duplicates included: the result has left rows + right rows. ${NULL_NOTE}`
      : `UNION removes duplicate rows from the combined result, including duplicates that were already inside one input. Two rows are duplicates when every column is equal. ${NULL_NOTE}`;
  }
  if (op === "intersect") {
    return all
      ? `INTERSECT ALL keeps as many copies of a row as both inputs share: min(copies on the left, copies on the right). ${NULL_NOTE}`
      : `INTERSECT keeps one copy of each row that appears in both inputs; duplicates collapse. ${NULL_NOTE}`;
  }
  return all
    ? `EXCEPT ALL subtracts counts: a row with a copies on the left and b copies on the right appears max(a - b, 0) times. ${NULL_NOTE}`
    : `EXCEPT keeps each distinct left row that does not appear anywhere in the right input; duplicates collapse. Order matters: A EXCEPT B differs from B EXCEPT A. ${NULL_NOTE}`;
}

export function stageTitle(op: SetOpKind, all: boolean): string {
  if (op === "union") return all ? "UNION ALL: stack both inputs, keep every row" : "UNION: combine both inputs, remove duplicates";
  if (op === "intersect") return all ? "INTERSECT ALL: keep the copies both inputs share" : "INTERSECT: keep rows found in both inputs";
  return all ? "EXCEPT ALL: subtract the right copies from the left" : "EXCEPT: keep left rows the right input lacks";
}

export function matchedLabel(op: SetOpKind, all: boolean): string {
  if (op === "intersect") return all ? "Result rows (copies both inputs share)" : "Result rows (distinct rows found in both inputs)";
  return "Distinct rows present in both inputs";
}

export function removedLabel(op: SetOpKind, all: boolean): string {
  if (op === "union") return all ? "Nothing is removed" : "Duplicates collapsed (extra copies removed per value)";
  if (op === "intersect") return all ? "Copies with no partner in the other input (rows)" : "Distinct rows found in only one input";
  return all ? "Left copies cancelled by right copies (rows)" : "Distinct left rows removed because the right input has them";
}

/**
 * Fate of one input row. `copy` is its 1-based position among identical rows of the same input, `other` the number of
 * identical rows on the other input (NULL equal to NULL). Rules are PostgreSQL's multiset semantics.
 */
export function rowMark(op: SetOpKind, all: boolean, side: "left" | "right", copy: number, other: number): RowMark {
  const first = copy === 1;
  if (op === "union") {
    if (all) return { matched: other > 0, fate: "kept" };
    // The left copy supplies a value both inputs have; right copies of it are the duplicates.
    const kept = side === "left" ? first : first && other === 0;
    return { matched: other > 0, fate: kept ? "kept" : "duplicate" };
  }
  if (op === "intersect") {
    if (all) {
      const paired = copy <= other;
      return { matched: paired, fate: paired ? "kept" : "unmatched" };
    }
    if (other === 0) return { matched: false, fate: "unmatched" };
    return { matched: true, fate: first ? "kept" : "duplicate" };
  }
  // except
  if (side === "right") return { matched: all ? copy <= other : other > 0, fate: "not output" };
  if (all) return copy <= other ? { matched: true, fate: "cancelled" } : { matched: false, fate: "kept" };
  if (other > 0) return { matched: true, fate: "cancelled" };
  return { matched: false, fate: first ? "kept" : "duplicate" };
}

export const FATE_TEXT: Record<RowFate, string> = {
  kept: "kept",
  duplicate: "duplicate, dropped",
  cancelled: "removed by right input",
  unmatched: "no match, dropped",
  "not output": "not in output",
};

/** The count identity of an operator with real figures; ok says whether it equals the executed result. */
export function arithmetic(d: Pick<SetOpData, "op" | "all" | "leftCount" | "rightCount" | "leftDistinct" | "rightDistinct" | "matchedCount" | "removedCount" | "resultCount">): { text: string; ok: boolean } | undefined {
  const { op, all, leftCount: lc, rightCount: rc, leftDistinct: ld, rightDistinct: rd, matchedCount: m, removedCount: rem, resultCount: res } = d;
  if (res === undefined) return undefined;
  let expect: number | undefined;
  let text = "";
  if (op === "union" && all && lc !== undefined && rc !== undefined) {
    expect = lc + rc;
    text = `${lc} left + ${rc} right = ${expect}`;
  } else if (op === "union" && ld !== undefined && rd !== undefined && m !== undefined) {
    expect = ld + rd - m;
    text = `${ld} distinct left + ${rd} distinct right - ${m} in both = ${expect}`;
  } else if (op === "except" && all && lc !== undefined && rem !== undefined) {
    expect = lc - rem;
    text = `${lc} left - ${rem} cancelled by the right = ${expect}`;
  } else if (op === "except" && ld !== undefined && m !== undefined) {
    expect = ld - m;
    text = `${ld} distinct left - ${m} also in the right = ${expect}`;
  }
  return expect === undefined ? undefined : { text: `${text}${expect === res ? "" : ` (executed result has ${res})`}`, ok: expect === res };
}

// ---------------------------------------------------------------------------------------------
// Derived queries. `L` and `R` are parenthesised operands ("(SELECT ...)"). Columns are re-aliased c0..cN-1 so
// duplicate or unnamed output columns never get in the way, and every comparison uses IS NOT DISTINCT FROM so
// NULLs match, like the set operators themselves.
// ---------------------------------------------------------------------------------------------

export const colAliases = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

const KW: Record<SetOpKind, string> = { union: "UNION", intersect: "INTERSECT", except: "EXCEPT" };
export const setExpr = (L: string, kind: SetOpKind, all: boolean, R: string) => `${L}\n${KW[kind]}${all ? " ALL" : ""}\n${R}`;

/** First `limit` rows of an input, each with its copy number among identical rows and how many identical rows the other input has. */
export function markedSampleSql(self: string, other: string, n: number, limit: number): string {
  const c = colAliases(n);
  const list = c.join(", ");
  const same = c.map((x) => `r.${x} IS NOT DISTINCT FROM o.${x}`).join(" AND ");
  return `SELECT ${c.map((x) => `x.${x}`).join(", ")}, x.rn, x.other_count
FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY ${c.map((x) => `o.${x}`).join(", ")}) AS rn,
         (SELECT COUNT(*) FROM ${other} AS r(${list}) WHERE ${same}) AS other_count
  FROM (SELECT s.*, ROW_NUMBER() OVER () AS ord FROM ${self} AS s(${list})) AS o
) AS x
ORDER BY x.ord
LIMIT ${limit}`;
}

export const distinctCountSql = (X: string, n: number) => `SELECT COUNT(*) FROM (SELECT DISTINCT * FROM ${X} AS d(${colAliases(n).join(", ")})) AS _c`;
export const countSql = (X: string) => `SELECT COUNT(*) FROM ${X} AS _c`;

/** Duplicate groups of `L UNION ALL R`: the value and how many extra copies UNION removes. */
export function collapsedSql(L: string, R: string, n: number, limit?: number): string {
  const c = colAliases(n).join(", ");
  return `SELECT ${c}, COUNT(*) - 1 AS copies_removed
FROM (${setExpr(L, "union", true, R)}) AS u(${c})
GROUP BY ${c}
HAVING COUNT(*) > 1${limit ? `\nORDER BY copies_removed DESC\nLIMIT ${limit}` : ""}`;
}

/** Rows that exist in only one input, tagged with the side (distinct, or per copy for the ALL variant). */
export function onlyOneSideSql(L: string, R: string, n: number, all: boolean): string {
  const c = colAliases(n).join(", ");
  return `SELECT t.*, 'left only' AS only_in FROM (${setExpr(L, "except", all, R)}) AS t(${c})
UNION ALL
SELECT t.*, 'right only' AS only_in FROM (${setExpr(R, "except", all, L)}) AS t(${c})`;
}

/** Prepared-statement probe: real column types without running the query. Cleaned up in the same batch. */
export function typeProbeSql(name: string, query: string): string {
  return `PREPARE ${name} AS ${query};
SELECT u.t::text AS type FROM pg_prepared_statements p, unnest(p.result_types) WITH ORDINALITY AS u(t, n) WHERE p.name = '${name}' ORDER BY u.n;
DEALLOCATE ${name}`;
}
