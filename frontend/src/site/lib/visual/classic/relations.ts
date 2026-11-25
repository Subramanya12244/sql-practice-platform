/**
 * CTEs and subqueries, read from the learner's own text so the trace can ask the database for each one's real relation.
 *
 * Pure parsing only (no SQL runs here). It tracks strings, quoted identifiers, comments and parentheses, and reports what it cannot
 * read instead of guessing. `rowTrace.ts` runs `SELECT * FROM (<the subquery>)` and `SELECT * FROM <cte>` (read-only, after the
 * learner's own WITH prefix) and stores the rows in `RowTrace.teach`.
 */

/** End (exclusive) of a string, quoted identifier, dollar quote or comment starting at i, or -1. */
function opaqueEnd(s: string, i: number): number {
  const c = s[i], two = s.slice(i, i + 2);
  if (two === "--") { const nl = s.indexOf("\n", i); return nl < 0 ? s.length : nl; }
  if (two === "/*") { const e = s.indexOf("*/", i + 2); return e < 0 ? s.length : e + 2; }
  if (c === "'" || c === '"') {
    let j = i + 1;
    while (j < s.length) { if (s[j] === c) { if (s[j + 1] === c) j += 2; else return j + 1; } else j++; }
    return s.length;
  }
  if (c === "$") {
    const tag = /^\$[A-Za-z_]*\$/.exec(s.slice(i));
    if (tag) { const e = s.indexOf(tag[0], i + tag[0].length); return e < 0 ? s.length : e + tag[0].length; }
  }
  return -1;
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
export function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const o = opaqueEnd(s, i);
    if (o >= 0) { i = o - 1; continue; }
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/* ---------- CTEs ---------- */

export interface CteDef {
  /** As written (quotes kept), usable in `SELECT * FROM <name>`. */
  name: string;
  /** Column list written after the name, e.g. `t(a, b)`. */
  columnList?: string[];
  /** The text inside the parentheses. */
  body: string;
  /** Position in the definition order (0 = first). */
  index: number;
}

const IDENT = /^(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)/;

/** The CTEs of a `WITH ...` prefix, in definition order. Returns [] when the text is not a readable WITH clause. */
export function parseCtes(withText: string): CteDef[] {
  const out: CteDef[] = [];
  let i = 0;
  const skipWs = () => { while (i < withText.length) { const o = /\s/.test(withText[i]) ? i + 1 : (withText.startsWith("--", i) || withText.startsWith("/*", i)) ? opaqueEnd(withText, i) : -1; if (o < 0) break; i = o; } };
  skipWs();
  if (!/^with\b/i.test(withText.slice(i))) return [];
  i += 4;
  skipWs();
  if (/^recursive\b/i.test(withText.slice(i))) { i += 9; skipWs(); }
  while (i < withText.length) {
    const id = IDENT.exec(withText.slice(i));
    if (!id) return out;
    const name = id[0];
    i += name.length;
    skipWs();
    let columnList: string[] | undefined;
    if (withText[i] === "(") {
      const e = matchParen(withText, i);
      if (e < 0) return out;
      columnList = withText.slice(i + 1, e).split(",").map((x) => x.trim()).filter(Boolean);
      i = e + 1;
      skipWs();
    }
    const as = /^as\b/i.exec(withText.slice(i));
    if (!as) return out;
    i += 2;
    skipWs();
    const mat = /^(?:not\s+)?materialized\b/i.exec(withText.slice(i));
    if (mat) { i += mat[0].length; skipWs(); }
    if (withText[i] !== "(") return out;
    const e = matchParen(withText, i);
    if (e < 0) return out;
    out.push({ name, columnList, body: withText.slice(i + 1, e).trim(), index: out.length });
    i = e + 1;
    skipWs();
    if (withText[i] === ",") { i++; skipWs(); } else break;
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bareName = (n: string) => n.replace(/^"|"$/g, "").replace(/""/g, '"');

/** Text with strings, quoted identifiers and comments blanked out, same length, so a name search never hits a literal. */
export function blankOpaque(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const o = opaqueEnd(s, i);
    if (o >= 0 && s[i] !== '"') { out += " ".repeat(o - i); i = o - 1; } else out += s[i];
  }
  return out;
}

/** Where `name` is used as a relation in `text` (first index), or -1. Quoted names match exactly; bare names match case-insensitively. */
export function firstUse(text: string, name: string): number {
  const quoted = name.startsWith('"');
  const hay = quoted ? text : blankOpaque(text);
  const re = quoted ? new RegExp(`${esc(name)}(?![\\w$"])`) : new RegExp(`(?<![\\w$."])${esc(bareName(name))}(?![\\w$"(])`, "i");
  const m = re.exec(hay);
  return m ? m.index : -1;
}

export interface CteUse {
  def: CteDef;
  /** What reads it: the main query's clauses (FROM, WHERE ...) or other CTEs. */
  usedBy: string[];
}

/**
 * The CTEs the query really uses, in the order they are needed: a CTE comes after the CTEs it reads, and the main query's
 * references are taken in the order they appear in its text. A CTE nothing reads is left out (PostgreSQL never evaluates it).
 */
export function cteUseOrder(defs: CteDef[], mainClauses: Record<string, string | undefined>): { used: CteUse[]; unused: CteDef[] } {
  const mainText = Object.entries(mainClauses).map(([k, v]) => ({ k, v: v ?? "" }));
  const joined = mainText.map((x) => x.v).join("\n");
  const uses = new Map<CteDef, Set<string>>();
  const order: CteDef[] = [];
  const visit = (d: CteDef, by: string) => {
    if (!uses.has(d)) uses.set(d, new Set());
    uses.get(d)!.add(by);
    if (order.includes(d)) return;
    // Only earlier CTEs can be read (a recursive CTE reads itself, which is not a dependency).
    for (const e of defs.slice(0, d.index)) if (firstUse(d.body, e.name) >= 0) visit(e, `CTE ${bareName(d.name)}`);
    if (!order.includes(d)) order.push(d);
  };
  const hits = defs.map((d) => ({ d, at: firstUse(joined, d.name) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  for (const h of hits) {
    const clauses = mainText.filter((x) => firstUse(x.v, h.d.name) >= 0).map((x) => x.k.toUpperCase());
    for (const cl of clauses.length ? clauses : ["the query"]) visit(h.d, cl);
  }
  return { used: order.map((def) => ({ def, usedBy: [...(uses.get(def) ?? [])] })), unused: defs.filter((d) => !order.includes(d)) };
}

/* ---------- subqueries ---------- */

export type SubqueryKind = "scalar" | "in" | "exists" | "any" | "derived";

export interface SubqueryRef {
  /** The SELECT inside the parentheses. */
  sql: string;
  kind: SubqueryKind;
  negated: boolean;
  /** The clause it sits in: select, from, where, having, order by. */
  clause: string;
  /** The text just before it, e.g. `o.freight >` or `customer_id NOT IN`. */
  before: string;
  /** The derived table's alias. */
  alias?: string;
  /** The whole thing as written, parentheses included. */
  text: string;
}

const startsQuery = (s: string) => /^\s*(select|with)\b/i.test(s);

/** The subqueries written in the given clauses (outermost only; a subquery inside a subquery belongs to its parent). */
export function findSubqueries(clauses: Record<string, string | undefined>): SubqueryRef[] {
  const out: SubqueryRef[] = [];
  for (const [clause, text] of Object.entries(clauses)) {
    if (!text) continue;
    const scan = (s: string, base: number) => {
      for (let i = 0; i < s.length; i++) {
        const o = opaqueEnd(s, i);
        if (o >= 0) { i = o - 1; continue; }
        if (s[i] !== "(") continue;
        const e = matchParen(s, i);
        if (e < 0) return;
        const inner = s.slice(i + 1, e);
        if (startsQuery(inner)) {
          const before = text.slice(0, base + i).trimEnd();
          const tail = before.slice(-40);
          let kind: SubqueryKind = "scalar", negated = false;
          const word = /\b(not\s+exists|exists|not\s+in|in|any|some|all)\s*$/i.exec(tail);
          if (word) {
            const w = word[1].toLowerCase().replace(/\s+/g, " ");
            negated = w.startsWith("not ");
            kind = w.endsWith("exists") ? "exists" : w.endsWith("in") ? "in" : "any";
          } else if (clause === "from" && (before === "" || /(\bjoin|\blateral|,)\s*$/i.test(tail) || /\bfrom\s*$/i.test(tail))) kind = "derived";
          const after = /^\s*(?:as\s+)?("[^"]+"|[A-Za-z_]\w*)/i.exec(text.slice(base + e + 1));
          const alias = kind === "derived" && after && !/^(on|using|join|left|right|inner|full|cross|natural|where|group|order|limit)$/i.test(after[1]) ? after[1] : undefined;
          out.push({ sql: inner.trim(), kind, negated, clause, before: before.slice(-48).trim(), alias, text: text.slice(base + i, base + e + 1) });
        } else scan(inner, base + i + 1);
        i = e;
      }
    };
    scan(text, 0);
  }
  return out;
}

export const kindWord = (r: SubqueryRef) =>
  r.kind === "scalar" ? "scalar subquery" : r.kind === "in" ? `${r.negated ? "NOT IN" : "IN"} subquery` : r.kind === "exists" ? `${r.negated ? "NOT EXISTS" : "EXISTS"} subquery` : r.kind === "any" ? "ANY/ALL subquery" : "derived table";
