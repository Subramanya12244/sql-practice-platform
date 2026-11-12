/**
 * Split a single SELECT statement into its top-level clauses. This is not a full SQL parser:
 * it tracks parentheses, strings, quoted identifiers and comments so that keywords inside
 * subqueries or literals are ignored. Anything it can't handle is reported, never guessed.
 */

export type ClauseName = "with" | "select" | "from" | "where" | "group by" | "having" | "window" | "order by" | "limit" | "offset";

export interface ParsedQuery {
  /** Leading `WITH …` (CTEs), kept verbatim so derived queries can reuse it. */
  with: string;
  clauses: Partial<Record<Exclude<ClauseName, "with">, string>>;
  /** Character ranges of each clause in the original text, for highlighting. Set-operation queries also fill the operator names. */
  ranges: Partial<Record<ClauseName | "union" | "intersect" | "except", [number, number]>>;
  distinct: boolean;
  joins: JoinPart[];
  windows: string[];
  unsupported?: string;
}

export interface JoinPart {
  kind: string;          // "FROM", "INNER JOIN", "LEFT JOIN", …
  source: string;        // table or subquery with alias
  on?: string;           // ON condition (absent for CROSS/USING/NATURAL)
}

const CLAUSE_RE = /^(select|from|where|group\s+by|having|window|order\s+by|limit|offset|fetch|union|intersect|except|for)\b/i;
const JOIN_RE = /^((?:natural\s+)?(?:(?:left|right|full)(?:\s+outer)?|inner|cross)?\s*join)\b/i;

/** Positions (at parenthesis depth 0, outside strings/comments) where `test` matches. */
function scanTopLevel(sql: string, test: (rest: string) => RegExpMatchArray | null): { index: number; match: string }[] {
  const out: { index: number; match: string }[] = [];
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1;
      i = j;
      continue;
    }
    if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end < 0 ? sql.length : end + tag[0].length - 1;
        continue;
      }
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /[A-Za-z]/.test(c) && (i === 0 || !/[A-Za-z0-9_$.]/.test(sql[i - 1]))) {
      const m = test(sql.slice(i));
      if (m) {
        out.push({ index: i, match: m[0] });
        i += m[0].length - 1;
      }
    }
  }
  return out;
}

function stripTrailing(sql: string): string {
  return sql.replace(/;\s*$/, "").trimEnd();
}

/** Split the WITH prefix off a statement: returns [withPrefix, mainSelect, offset of main]. */
function splitWith(sql: string): [string, string, number] {
  if (!/^\s*with\b/i.test(sql)) return ["", sql, 0];
  const selects = scanTopLevel(sql, (r) => r.match(/^select\b/i));
  if (!selects.length) return ["", sql, 0];
  const at = selects[0].index;
  return [sql.slice(0, at).trimEnd(), sql.slice(at), at];
}

export function parseSelect(input: string): ParsedQuery {
  const sql = stripTrailing(input);
  const empty: ParsedQuery = { with: "", clauses: {}, ranges: {}, distinct: false, joins: [], windows: [] };
  const bare = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''");
  if (bare.includes(";")) {
    return { ...empty, unsupported: "Visualize one statement at a time." };
  }
  const [withPrefix, main, offset] = splitWith(sql);
  if (!/^\s*select\b/i.test(main)) return { ...empty, unsupported: "Only SELECT queries can be visualized." };

  const marks = scanTopLevel(main, (r) => r.match(CLAUSE_RE));
  const setOp = marks.find((m) => /^(union|intersect|except)/i.test(m.match));
  if (setOp) return { ...empty, with: withPrefix, unsupported: `${setOp.match.toUpperCase()} queries combine several SELECTs; visualize each part separately.` };
  if (marks.some((m) => /^(fetch|for)\b/i.test(m.match))) return { ...empty, with: withPrefix, unsupported: "FETCH / FOR UPDATE clauses are not supported by the visualizer." };

  const clauses: ParsedQuery["clauses"] = {};
  const ranges: ParsedQuery["ranges"] = {};
  if (withPrefix) ranges.with = [0, withPrefix.length];
  marks.forEach((m, k) => {
    const name = m.match.toLowerCase().replace(/\s+/g, " ") as Exclude<ClauseName, "with">;
    const end = k + 1 < marks.length ? marks[k + 1].index : main.length;
    clauses[name] = main.slice(m.index + m.match.length, end).trim();
    ranges[name] = [offset + m.index, offset + end];
  });

  let select = clauses.select ?? "";
  let distinct = false;
  const d = /^distinct\b(\s+on\s*\([^)]*\))?/i.exec(select);
  if (d) {
    distinct = true;
    if (!d[1]) select = select.slice(d[0].length).trim();
  }
  clauses.select = select;

  const joins: JoinPart[] = [];
  if (clauses.from) {
    const from = clauses.from;
    const js = scanTopLevel(from, (r) => r.match(JOIN_RE));
    const pieces = [{ kind: "FROM", text: from.slice(0, js[0]?.index ?? from.length) }];
    js.forEach((j, k) => pieces.push({ kind: j.match.replace(/\s+/g, " ").toUpperCase(), text: from.slice(j.index + j.match.length, js[k + 1]?.index ?? from.length) }));
    for (const p of pieces) {
      const on = scanTopLevel(p.text, (r) => r.match(/^on\b/i))[0];
      joins.push(on ? { kind: p.kind, source: p.text.slice(0, on.index).trim(), on: p.text.slice(on.index + 2).trim() } : { kind: p.kind, source: p.text.trim() });
    }
    // "FROM a, b" is an implicit cross join; flag it rather than mis-splitting it.
    if (joins[0] && /,/.test(joins[0].source.replace(/\([^()]*\)/g, ""))) joins[0].kind = "FROM (comma join)";
  }

  const windows = [...select.matchAll(/\b(\w+)\s*\([^()]*\)\s+over\s*\(([^()]*)\)/gi)].map((m) => `${m[1].toUpperCase()}() OVER (${m[2].trim()})`);
  return { with: withPrefix, clauses, ranges, distinct, joins, windows };
}

/** Rebuild a query from parsed parts, overriding some clauses. Undefined drops a clause. */
export function buildQuery(p: ParsedQuery, parts: { select: string; from?: string; where?: string; groupBy?: string; having?: string; orderBy?: string; limit?: string }): string {
  const lines = [p.with, `SELECT ${parts.select}`];
  if (parts.from) lines.push(`FROM ${parts.from}`);
  if (parts.where) lines.push(`WHERE ${parts.where}`);
  if (parts.groupBy) lines.push(`GROUP BY ${parts.groupBy}`);
  if (parts.having) lines.push(`HAVING ${parts.having}`);
  if (parts.orderBy) lines.push(`ORDER BY ${parts.orderBy}`);
  if (parts.limit) lines.push(`LIMIT ${parts.limit}`);
  return lines.filter(Boolean).join("\n");
}

/** Approaches a query uses, for the comparison engine and tutor. Detected from structure, not guessed. */
export function detectApproaches(sql: string): string[] {
  const s = sql.replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
  const out: string[] = [];
  if (/^\s*with\b/i.test(s)) out.push(/^\s*with\s+recursive\b/i.test(s) ? "Recursive CTE" : "CTE");
  if (/\bjoin\b/i.test(s)) out.push("JOIN");
  if (/\bover\s*\(/i.test(s)) out.push("Window function");
  if (/\bnot\s+exists\s*\(/i.test(s)) out.push("NOT EXISTS");
  else if (/\bexists\s*\(/i.test(s)) out.push("EXISTS");
  if (/\bunion\s+all\b/i.test(s)) out.push("UNION ALL");
  else if (/\bunion\b/i.test(s)) out.push("UNION");
  if (/\b(intersect|except)\b/i.test(s)) out.push("Set operation");
  // A CTE body "name AS (SELECT …)" is not a subquery.
  if (/(?<!\bas\s*)\(\s*select\b/i.test(s)) out.push(isCorrelated(s) ? "Correlated subquery" : "Subquery");
  if (/\bgroup\s+by\b/i.test(s)) out.push("GROUP BY");
  return out;
}

/** A subquery that references an alias defined outside it. Heuristic, and labelled as such in the UI. */
function isCorrelated(s: string): boolean {
  const outerAliases = new Set<string>();
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_][\w.]*)(?:\s+(?:as\s+)?([a-z_]\w*))?/gi)) {
    const alias = m[2] && !/^(on|where|join|left|right|inner|full|cross|group|order|limit|using)$/i.test(m[2]) ? m[2] : m[1];
    outerAliases.add(alias.toLowerCase());
  }
  for (const sub of s.matchAll(/\(\s*select\b([\s\S]*?)\)/gi)) {
    const inner = sub[1];
    const innerAliases = new Set([...inner.matchAll(/\b(?:from|join)\s+([a-z_][\w.]*)(?:\s+(?:as\s+)?([a-z_]\w*))?/gi)].map((m) => (m[2] ?? m[1]).toLowerCase()));
    for (const ref of inner.matchAll(/\b([a-z_]\w*)\.[a-z_]\w*/gi)) {
      const a = ref[1].toLowerCase();
      if (!innerAliases.has(a) && outerAliases.has(a)) return true;
    }
  }
  return false;
}

/** Rough structural complexity: joins, subqueries, nesting depth, CTEs, windows, length. */
export function complexity(sql: string) {
  const s = sql.replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
  let depth = 0;
  let maxDepth = 0;
  for (const c of s) {
    if (c === "(") maxDepth = Math.max(maxDepth, ++depth);
    else if (c === ")") depth--;
  }
  const count = (re: RegExp) => (s.match(re) ?? []).length;
  return {
    joins: count(/\bjoin\b/gi),
    subqueries: count(/(?<!\bas\s*)\(\s*select\b/gi),
    ctes: /^\s*with\b/i.test(s) ? count(/\bas\s*\(\s*select\b/gi) : 0,
    windows: count(/\bover\s*\(/gi),
    nesting: maxDepth,
    lines: sql.trim().split("\n").length,
  };
}

// ---------------------------------------------------------------------------------------------
// Set operations (UNION / INTERSECT / EXCEPT, each with optional ALL or DISTINCT).
//
// Why a dedicated reader: the PostgreSQL syntax-tree package used in sqlAst.ts (pgsql-ast-parser) only
// understands UNION and UNION ALL, rejects INTERSECT/EXCEPT and mixed operators, rejects a parenthesised
// branch followed by ORDER BY, and attaches a trailing ORDER BY / LIMIT to the last branch although PostgreSQL
// applies it to the whole operation. This reader follows PostgreSQL's own grammar instead: INTERSECT binds
// tighter than UNION and EXCEPT, equal precedence is left-associative, parentheses group, and a trailing
// ORDER BY / LIMIT / OFFSET / FETCH belongs to the whole (sub)expression. It is a tokenizer plus a small
// recursive-descent parser: strings, quoted identifiers, comments and dollar quotes are skipped, so keywords
// inside literals or subqueries never split anything. Whatever it cannot read is reported, never guessed.
// ---------------------------------------------------------------------------------------------

export type SetKind = "union" | "intersect" | "except";

export interface SetTail {
  /** Verbatim trailing clauses ("" when there are none). */
  text: string;
  orderBy?: string;
  limit?: string;
  offset?: string;
  fetch?: string;
  /** Source positions of each part, for highlighting. */
  ranges: { orderBy?: [number, number]; limit?: [number, number]; offset?: [number, number] };
}

export interface SetLeaf {
  kind: "leaf";
  /** Executable text of this input (a SELECT, VALUES or TABLE, plus its own ORDER BY / LIMIT when parenthesised). */
  sql: string;
  /** Position in the original text, including the parentheses when there are any. */
  range: [number, number];
  paren: boolean;
}
export interface SetOpNode {
  kind: "op";
  op: SetKind;
  all: boolean;
  /** As written: "UNION ALL", "EXCEPT", … */
  keyword: string;
  left: SetTree;
  right: SetTree;
  /** Text of the operation without any trailing ORDER BY / LIMIT. */
  core: string;
  /** ORDER BY / LIMIT written inside the parentheses around this node; applies to this node only. */
  tail: SetTail;
  range: [number, number];
  paren: boolean;
}
export type SetTree = SetLeaf | SetOpNode;

export interface SetOpQuery {
  /** Leading WITH clause, verbatim ("" when none). Applies to every input. */
  with: string;
  withRange?: [number, number];
  root: SetTree;
  /** ORDER BY / LIMIT / OFFSET after the last input: applies to the whole operation. */
  tail: SetTail;
}
export type SetParse = { kind: "none" } | { kind: "setop"; query: SetOpQuery } | { kind: "unsupported"; reason: string };

type Tok = { t: "word" | "group" | "sym"; v: string; s: number; e: number; dotted?: boolean };

/** End (exclusive) of a comment, string, quoted identifier or dollar quote starting at i, or -1. */
function opaqueEnd(sql: string, i: number): number {
  const c = sql[i];
  const two = sql.slice(i, i + 2);
  if (two === "--") {
    const nl = sql.indexOf("\n", i);
    return nl < 0 ? sql.length : nl;
  }
  if (two === "/*") {
    const end = sql.indexOf("*/", i + 2);
    return end < 0 ? sql.length : end + 2;
  }
  if (c === "'" || c === '"') {
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === c) {
        if (sql[j + 1] === c) j += 2;
        else return j + 1;
      } else j++;
    }
    return sql.length;
  }
  if (c === "$") {
    const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (tag) {
      const end = sql.indexOf(tag[0], i + tag[0].length);
      return end < 0 ? sql.length : end + tag[0].length;
    }
  }
  return -1;
}

/** Tokens at parenthesis depth 0 in [s, e). Each parenthesised group is one token. null when parentheses are unbalanced. */
function tokenize(sql: string, s: number, e: number): Tok[] | null {
  const out: Tok[] = [];
  let i = s;
  while (i < e) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    const o = opaqueEnd(sql, i);
    if (o >= 0) {
      const end = Math.min(o, e);
      if (!sql.startsWith("--", i) && !sql.startsWith("/*", i)) out.push({ t: "sym", v: sql.slice(i, end), s: i, e: end });
      i = end;
      continue;
    }
    if (c === "(") {
      let depth = 0;
      let j = i;
      while (j < e) {
        const oo = opaqueEnd(sql, j);
        if (oo >= 0) { j = oo; continue; }
        if (sql[j] === "(") depth++;
        else if (sql[j] === ")" && --depth === 0) break;
        j++;
      }
      if (j >= e) return null;
      out.push({ t: "group", v: "", s: i, e: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === ")") return null;
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < e && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      const prev = out[out.length - 1];
      out.push({ t: "word", v: sql.slice(i, j).toLowerCase(), s: i, e: j, dotted: Boolean(prev && prev.t === "sym" && prev.v === "." && prev.e === i) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < e && /[A-Za-z0-9_.]/.test(sql[j])) j++;
      out.push({ t: "sym", v: sql.slice(i, j), s: i, e: j });
      i = j;
      continue;
    }
    out.push({ t: "sym", v: c, s: i, e: i + 1 });
    i++;
  }
  return out;
}

const isWord = (t: Tok | undefined, ...v: string[]) => Boolean(t && t.t === "word" && !t.dotted && v.includes(t.v));
const isSetWord = (t: Tok | undefined) => isWord(t, "union", "intersect", "except");

/** True when a trailing clause (ORDER BY, LIMIT, OFFSET, FETCH, FOR UPDATE/SHARE) starts at toks[k]. */
function tailStartsAt(toks: Tok[], k: number): boolean {
  const t = toks[k];
  const n = toks[k + 1];
  return isWord(t, "order") ? isWord(n, "by") : isWord(t, "limit", "offset") || (isWord(t, "fetch") && isWord(n, "first", "next")) || (isWord(t, "for") && isWord(n, "update", "share", "no", "key"));
}

const NO_TAIL: SetTail = { text: "", ranges: {} };

function readTail(sql: string, toks: Tok[]): SetTail {
  if (!toks.length) return NO_TAIL;
  const starts = toks.map((_, k) => k).filter((k) => tailStartsAt(toks, k));
  const tail: SetTail = { text: sql.slice(toks[0].s, toks[toks.length - 1].e), ranges: {} };
  starts.forEach((k, idx) => {
    const end = idx + 1 < starts.length ? toks[starts[idx + 1]].s : toks[toks.length - 1].e;
    const word = toks[k].v;
    const range: [number, number] = [toks[k].s, end];
    const body = (skip: number) => sql.slice(toks[k + skip].s, end).trim();
    if (word === "order") { tail.orderBy = body(2); tail.ranges.orderBy = range; }
    else if (word === "limit") { tail.limit = body(1); tail.ranges.limit = range; }
    else if (word === "offset") { tail.offset = body(1); tail.ranges.offset = range; }
    else if (word === "fetch") { tail.fetch = body(1); tail.ranges.limit = range; }
  });
  return tail;
}

type Read = { ok: true; tree: SetTree; with: string; withRange?: [number, number]; tail: SetTail } | { ok: false; reason: string };
const fail = (reason: string): Read => ({ ok: false, reason });

/** Read one statement (or the inside of one parenthesised group) in [s, e). */
function readStatement(sql: string, s: number, e: number, nested: boolean): Read {
  const toks = tokenize(sql, s, e);
  if (!toks) return fail("The parentheses are not balanced.");
  if (!toks.length) return fail("Empty query.");
  let from = 0;
  let withText = "";
  let withRange: [number, number] | undefined;
  if (isWord(toks[0], "with")) {
    // Inside parentheses a WITH is its own scope: keep that whole input opaque.
    if (nested) {
      const range: [number, number] = [toks[0].s, toks[toks.length - 1].e];
      return { ok: true, tree: { kind: "leaf", sql: sql.slice(range[0], range[1]), range, paren: false }, with: "", tail: NO_TAIL };
    }
    // The main query starts at the first top-level SELECT/VALUES/TABLE, or at a group that directly follows a CTE body group.
    let j = 1;
    for (; j < toks.length; j++) {
      if (isWord(toks[j], "select", "values", "table") || (toks[j].t === "group" && toks[j - 1].t === "group")) break;
    }
    if (j >= toks.length) return fail("Could not find the main query after WITH.");
    withRange = [toks[0].s, toks[j - 1].e];
    withText = sql.slice(withRange[0], withRange[1]);
    from = j;
  }
  const body = toks.slice(from);
  let p = 0;

  const readLeafSegment = (): SetTree | string => {
    const start = p;
    while (p < body.length && !isSetWord(body[p]) && !tailStartsAt(body, p)) p++;
    if (p === start) return "Expected a SELECT.";
    const range: [number, number] = [body[start].s, body[p - 1].e];
    return { kind: "leaf", sql: sql.slice(range[0], range[1]), range, paren: false };
  };
  const readFactor = (): SetTree | string => {
    const t = body[p];
    if (!t) return "A set operator needs a query on both sides.";
    if (t.t === "group") {
      const inner = readStatement(sql, t.s + 1, t.e - 1, true);
      if (!inner.ok) return inner.reason;
      p++;
      const range: [number, number] = [t.s, t.e];
      if (inner.tree.kind === "leaf") {
        // A parenthesised SELECT keeps its own ORDER BY / LIMIT (already part of leaf.sql).
        return { kind: "leaf", sql: inner.tree.sql, range, paren: true };
      }
      return { ...inner.tree, tail: inner.tail, range, paren: true };
    }
    if (isWord(t, "select", "values", "table")) return readLeafSegment();
    return `Unexpected "${sql.slice(t.s, t.e)}" where a SELECT was expected.`;
  };
  const readOp = (parse: () => SetTree | string, accepts: SetKind[]): SetTree | string => {
    let left = parse();
    if (typeof left === "string") return left;
    while (p < body.length && isSetWord(body[p]) && accepts.includes(body[p].v as SetKind)) {
      const t = body[p++];
      let all = false;
      let kw = t.v.toUpperCase();
      if (isWord(body[p], "all", "distinct")) { all = body[p].v === "all"; kw += ` ${body[p].v.toUpperCase()}`; p++; }
      const right = parse();
      if (typeof right === "string") return right;
      left = { kind: "op", op: t.v as SetKind, all, keyword: kw, left, right, core: sql.slice(left.range[0], right.range[1]), tail: NO_TAIL, range: [left.range[0], right.range[1]], paren: false };
    }
    return left;
  };
  // INTERSECT binds tighter than UNION and EXCEPT.
  const readTerm = () => readOp(readFactor, ["intersect"]);
  const tree = readOp(readTerm, ["union", "except"]);
  if (typeof tree === "string") return fail(tree);
  const rest = body.slice(p);
  if (rest.length && !tailStartsAt(body, p)) return fail(`Could not read "${sql.slice(rest[0].s, rest[0].e)}" after the last SELECT.`);
  if (rest.some(isSetWord)) return fail("ORDER BY / LIMIT must come after the last SELECT of a set operation; put earlier SELECTs that need them in parentheses.");
  const tail = readTail(sql, rest);
  let out = tree;
  if (tree.kind === "leaf" && tail.text) {
    const range: [number, number] = [tree.range[0], rest[rest.length - 1].e];
    out = { ...tree, sql: sql.slice(range[0], range[1]), range };
  }
  return { ok: true, tree: out, with: withText, withRange, tail: tree.kind === "leaf" ? NO_TAIL : tail };
}

/**
 * Read a statement whose top level is a set operation. "none" when it is not one (a plain SELECT, even one with
 * set operations inside a subquery), "unsupported" with the reason when it is one but could not be read.
 */
export function parseSetOperation(input: string): SetParse {
  const sql = stripTrailing(input);
  const bare = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  if (bare.includes(";")) return { kind: "none" };
  // Cheap pre-check so ordinary queries never reach the parser.
  if (!/\b(union|intersect|except)\b/i.test(bare)) return { kind: "none" };
  const r = readStatement(sql, 0, sql.length, false);
  if (!r.ok) {
    // Only claim "unsupported" when a top-level set keyword is really there; otherwise leave it to the single-SELECT path.
    const toks = tokenize(sql, 0, sql.length);
    return !toks || toks.some(isSetWord) ? { kind: "unsupported", reason: `This set operation could not be read: ${r.reason}` } : { kind: "none" };
  }
  if (r.tree.kind !== "op") return { kind: "none" };
  return { kind: "setop", query: { with: r.with, withRange: r.withRange, root: r.tree, tail: r.tail } };
}

/** Inputs of a set operation in source order, each with the operator written just before it. */
export function setOpBranches(q: SetOpQuery): { op: string; sql: string }[] {
  const out: { op: string; sql: string }[] = [];
  const walkTree = (n: SetTree, pending: string) => {
    if (n.kind === "leaf") out.push({ op: pending, sql: n.sql });
    else {
      walkTree(n.left, pending);
      walkTree(n.right, n.keyword);
    }
  };
  walkTree(q.root, "");
  return out;
}

/** Split a statement at top-level UNION / INTERSECT / EXCEPT into its branches. */
export function splitSetOps(input: string): { op: string; sql: string }[] {
  const sql = stripTrailing(input);
  const [withPrefix, main, offset] = splitWith(sql);
  void offset;
  const ops = scanTopLevel(main, (r) => r.match(/^(union\s+all|union|intersect\s+all|intersect|except\s+all|except)\b/i));
  if (!ops.length) return [{ op: "", sql: main.trim() }];
  const out: { op: string; sql: string }[] = [];
  let last = 0;
  let op = "";
  for (const m of ops) {
    out.push({ op, sql: main.slice(last, m.index).trim() });
    op = m.match.toUpperCase().replace(/\s+/g, " ");
    last = m.index + m.match.length;
  }
  out.push({ op, sql: main.slice(last).trim() });
  // CTEs apply to every branch.
  return withPrefix ? out.map((b) => ({ ...b, sql: `${withPrefix}\n${b.sql}` })) : out;
}
