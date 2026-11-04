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
  /** Character ranges of each clause in the original text, for highlighting. */
  ranges: Partial<Record<ClauseName, [number, number]>>;
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
