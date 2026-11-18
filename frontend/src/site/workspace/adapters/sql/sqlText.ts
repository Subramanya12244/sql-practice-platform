/**
 * Text scanning for the SQL adapter. Everything here reads the learner's SQL; nothing runs it. `maskSql` keeps every offset
 * of the original, so a range found in the masked text is a range in the real text.
 */

/** Same length as the input; comments, string contents and dollar-quoted bodies become spaces and quoted identifiers become `_`. */
export function maskSql(sql: string): string {
  const out = sql.split("");
  const n = sql.length;
  let i = 0;
  const blank = (from: number, to: number, ch = " ") => { for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = ch; };
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      let j = i; while (j < n && sql[j] !== "\n") j++;
      blank(i, j); i = j;
    } else if (c === "/" && d === "*") {
      let depth = 1, j = i + 2;
      while (j < n && depth > 0) { if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; } else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; } else j++; }
      blank(i, j); i = j;
    } else if (c === "'") {
      const escaped = /[eE]/.test(sql[i - 1] ?? "") && !/[\w]/.test(sql[i - 2] ?? " ");
      let j = i + 1;
      while (j < n) {
        if (escaped && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      blank(i + 1, j); i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n) { if (sql[j] === '"') { if (sql[j + 1] === '"') { j += 2; continue; } break; } j++; }
      blank(i + 1, j, "_"); i = j + 1;
    } else if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m && !/[\w]/.test(sql[i - 1] ?? " ")) {
        const end = sql.indexOf(m[0], i + m[0].length);
        const stop = end === -1 ? n : end + m[0].length;
        blank(i + m[0].length, end === -1 ? n : end); i = stop;
      } else i++;
    } else i++;
  }
  return out.join("");
}

export const oneLine = (s: string, max = 90) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** Positions of the top-level (depth 0) commas of an expression list in the masked text, as pieces of the original text. */
export function splitList(text: string): string[] {
  const m = maskSql(text);
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** Index of the matching `)` for the `(` at `open` in masked text, or -1. */
export function matchParen(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "(") depth++;
    else if (masked[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* ------------------------------------------------------------------ subqueries ------------------------------------------ */

export type SubqueryKind = "scalar" | "in-list" | "exists" | "derived-table" | "lateral";
export interface SubqueryRef { kind: SubqueryKind; /** Offsets of the text between the parentheses. */ range: [number, number]; text: string; depth: number }

const prevWord = (masked: string, at: number): string => {
  let i = at - 1;
  while (i >= 0 && /\s/.test(masked[i])) i--;
  const end = i + 1;
  while (i >= 0 && /[A-Za-z_]/.test(masked[i])) i--;
  const w = masked.slice(i + 1, end).toLowerCase();
  if (w) return w;
  return i >= 0 ? masked[i] : "";
};

/**
 * Parenthesised SELECT / WITH texts inside a query, innermost listed before the query that contains them. CTE bodies
 * (`name AS ( ... )`) and set-operation operands are skipped: they have their own views.
 */
export function findSubqueries(sql: string): { subqueries: SubqueryRef[]; skippedCteBodies: number } {
  const m = maskSql(sql);
  const stack: { open: number; sub: boolean }[] = [];
  const found: SubqueryRef[] = [];
  let skipped = 0;
  for (let i = 0; i < m.length; i++) {
    if (m[i] === "(") {
      const after = /^\s*(select|with|values)\b/i.exec(m.slice(i + 1));
      stack.push({ open: i, sub: Boolean(after && after[1].toLowerCase() !== "values") });
    } else if (m[i] === ")") {
      const top = stack.pop();
      if (!top?.sub) continue;
      const before = prevWord(m, top.open);
      const depth = stack.filter((s) => s.sub).length;
      const text = sql.slice(top.open + 1, i).trim();
      if (before === "as" || before === "materialized") { skipped++; continue; }
      // A set-operation operand (`UNION (SELECT ...)`, `UNION ALL (SELECT ...)`) or a bare parenthesised SELECT that starts the statement.
      const beforeThat = (() => { const at = m.lastIndexOf(before, top.open); return at > 0 ? prevWord(m, at) : ""; })();
      const operand = /^(union|intersect|except)$/.test(before) || (/^(all|distinct)$/.test(before) && /^(union|intersect|except)$/.test(beforeThat)) || before === "";
      if (operand) continue;
      const kind: SubqueryKind = /^(in|any|all|some)$/.test(before) ? "in-list" : before === "exists" ? "exists" : before === "lateral" ? "lateral" : /^(from|join|,)$/.test(before) ? "derived-table" : "scalar";
      found.push({ kind, range: [top.open + 1, i], text, depth });
    }
  }
  // Inner first: deeper subqueries run before the ones around them.
  found.sort((a, b) => b.depth - a.depth || a.range[0] - b.range[0]);
  return { subqueries: found, skippedCteBodies: skipped };
}

/* ------------------------------------------------------------------ window functions ----------------------------------- */

export interface WindowSpec { partitionBy: string[]; orderBy?: string; frame?: string; /** Spec text as written, without parentheses. */ text: string }
export interface WindowCall { call: string; spec: WindowSpec; named?: string; range: [number, number] }

/** Offsets where a keyword pattern starts at parenthesis depth 0 of masked text. */
function topLevel(masked: string, pattern: string): number[] {
  const re = new RegExp(`^(?:${pattern})\\b`, "i");
  const hits: number[] = [];
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /[A-Za-z]/.test(c) && !/\w/.test(masked[i - 1] ?? " ") && re.test(masked.slice(i, i + 40))) hits.push(i);
  }
  return hits;
}

/** Split `PARTITION BY ... ORDER BY ... ROWS ...` at top level. A base-window name (`OVER (w ORDER BY x)`) is not resolved. */
export function parseWindowSpec(text: string): WindowSpec & { baseName?: string } {
  const m = maskSql(text);
  const pPart = topLevel(m, "partition\\s+by")[0];
  const pOrder = topLevel(m, "order\\s+by")[0];
  const frameHits = topLevel(m, "rows|range|groups").sort((a, b) => a - b);
  const pFrame = frameHits.find((h) => pOrder === undefined || h > pOrder) ?? frameHits[0];
  const cuts = [pPart, pOrder, pFrame].filter((x): x is number => x !== undefined).sort((a, b) => a - b);
  const slice = (from: number | undefined, kw: RegExp) => {
    if (from === undefined) return undefined;
    const next = cuts.find((c) => c > from) ?? text.length;
    return text.slice(from, next).replace(kw, "").trim();
  };
  const part = slice(pPart, /^partition\s+by/i);
  const order = slice(pOrder, /^order\s+by/i);
  const frame = slice(pFrame, /^$/);
  const lead = text.slice(0, cuts[0] ?? text.length).trim();
  return { partitionBy: part ? splitList(part) : [], orderBy: order || undefined, frame: frame || undefined, text: text.trim(), baseName: lead && /^[A-Za-z_]\w*$/.test(lead) ? lead : undefined };
}

/** Parse `WINDOW w AS (...), w2 AS (...)`. */
export function parseWindowClause(clause: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!clause) return out;
  for (const item of splitList(clause)) {
    const mm = /^([A-Za-z_]\w*)\s+as\s*\(([\s\S]*)\)\s*$/i.exec(item);
    if (mm) out.set(mm[1].toLowerCase(), mm[2]);
  }
  return out;
}

/** Window function calls in a SELECT list (or any expression): the call, its OVER spec, and where it sits. */
export function findWindowCalls(text: string, windowClause?: string): { calls: WindowCall[]; unsupported: string[] } {
  const m = maskSql(text);
  const named = parseWindowClause(windowClause);
  const calls: WindowCall[] = [];
  const unsupported: string[] = [];
  const re = /\bover\b\s*/gi;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(m))) {
    let p = hit.index + hit[0].length;
    let specText: string | undefined, nameUsed: string | undefined, end = p;
    if (m[p] === "(") {
      const close = matchParen(m, p);
      if (close < 0) continue;
      specText = text.slice(p + 1, close); end = close + 1;
    } else {
      const w = /^[A-Za-z_]\w*/.exec(m.slice(p))?.[0];
      if (!w) continue;
      nameUsed = w.toLowerCase(); end = p + w.length;
      specText = named.get(nameUsed);
      if (specText === undefined) { unsupported.push(`window "${w}" is not defined in a WINDOW clause this reader understands`); continue; }
    }
    // Walk back over an optional FILTER (...) and the argument list to the function name.
    let b = hit.index - 1;
    while (b >= 0 && /\s/.test(m[b])) b--;
    const skipGroup = (): boolean => {
      if (m[b] !== ")") return false;
      let depth = 0;
      for (; b >= 0; b--) { if (m[b] === ")") depth++; else if (m[b] === "(") { depth--; if (depth === 0) { b--; return true; } } }
      return false;
    };
    const wordBack = () => { while (b >= 0 && /\s/.test(m[b])) b--; const e = b; while (b >= 0 && /[\w.]/.test(m[b])) b--; return m.slice(b + 1, e + 1).toLowerCase(); };
    if (!skipGroup()) continue;
    let w = wordBack();
    if (w === "filter") { while (b >= 0 && /\s/.test(m[b])) b--; if (!skipGroup()) continue; w = wordBack(); }
    if (!w) continue;
    const start = b + 1;
    const spec = parseWindowSpec(specText);
    if (spec.baseName) { unsupported.push(`window "${spec.baseName}" extended by another definition`); continue; }
    calls.push({ call: text.slice(start, hit.index).trim(), spec, named: nameUsed, range: [start, end] });
  }
  return { calls, unsupported };
}

/* ------------------------------------------------------------------ CASE --------------------------------------------- */

export interface CaseExpr { text: string; operand?: string; whens: { when: string; then: string }[]; elseExpr?: string; range: [number, number] }

/** Outermost CASE ... END expressions of an expression list (nested CASEs stay inside their parent). */
export function findCaseExprs(text: string): CaseExpr[] {
  const m = maskSql(text);
  const out: CaseExpr[] = [];
  const word = /\b(case|end)\b/gi;
  let depth = 0, start = -1, hit: RegExpExecArray | null;
  while ((hit = word.exec(m))) {
    if (hit[1].toLowerCase() === "case") { if (depth === 0) start = hit.index; depth++; }
    else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const endAt = hit.index + 3;
        const body = text.slice(start + 4, hit.index);
        const parsed = parseCaseBody(body);
        if (parsed) out.push({ ...parsed, text: text.slice(start, endAt), range: [start, endAt] });
      }
    }
  }
  return out;
}

function parseCaseBody(body: string): Omit<CaseExpr, "text" | "range"> | null {
  const m = maskSql(body);
  const keyAt: { kw: string; at: number }[] = [];
  let depth = 0, caseDepth = 0;
  for (let i = 0; i < m.length; i++) {
    if (m[i] === "(") depth++; else if (m[i] === ")") depth--;
    if (depth === 0 && /[A-Za-z]/.test(m[i]) && !/\w/.test(m[i - 1] ?? " ")) {
      const w = /^[A-Za-z]+/.exec(m.slice(i))![0].toLowerCase();
      if (w === "case") caseDepth++;
      else if (w === "end") caseDepth--;
      else if (caseDepth === 0 && (w === "when" || w === "then" || w === "else")) keyAt.push({ kw: w, at: i });
    }
  }
  if (!keyAt.length || keyAt[0].kw !== "when") return null;
  const operandText = body.slice(0, keyAt[0].at).trim();
  const whens: { when: string; then: string }[] = [];
  let elseExpr: string | undefined;
  for (let k = 0; k < keyAt.length; k++) {
    const seg = body.slice(keyAt[k].at + keyAt[k].kw.length, keyAt[k + 1]?.at ?? body.length).trim();
    const { kw } = keyAt[k];
    if (kw === "when") whens.push({ when: seg, then: "" });
    else if (kw === "then" && whens.length) whens[whens.length - 1].then = seg;
    else if (kw === "else") elseExpr = seg;
  }
  return whens.every((w) => w.when && w.then) ? { operand: operandText || undefined, whens, elseExpr } : null;
}

/** An ORDER BY item without its direction and NULLS clause: the expression whose values order the rows. */
export const orderExpr = (item: string) => item.replace(/\s+nulls\s+(first|last)\s*$/i, "").replace(/\s+(asc|desc)\s*$/i, "").replace(/\s+using\s+\S+\s*$/i, "").trim();
