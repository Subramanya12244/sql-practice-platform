/**
 * A PostgreSQL-faithful tokenizer for the SQL policy (see policy.ts and docs/WORKSPACE_SQL_SAFETY.md). It reads text and never runs it.
 *
 * It follows PostgreSQL's lexical rules where they matter for safety: nested block comments, `--` comments, standard strings
 * (`''`), E'' strings (backslash escapes), U&'' / B'' / X'' / N'' strings, dollar quoting ($$ and $tag$), quoted identifiers
 * (`""`), and the six whitespace characters PostgreSQL knows. Anything it cannot read with certainty (an unterminated string
 * or comment, a NUL character, an invisible or look-alike Unicode character outside quotes) is a lexical error and the policy
 * refuses the script. Failing closed is the point: a disagreement between this reader and PostgreSQL must never let a
 * statement through.
 */

export type TokKind = "word" | "qident" | "string" | "number" | "param" | "op" | "punct";

export interface Tok {
  kind: TokKind;
  /** word: lower-cased. qident: the identifier with `""` unescaped (case kept). string: the whole literal as written. Others: as written. */
  text: string;
  start: number;
  end: number;
  /** What a parser should see instead: strings become `'x'` and keep their newlines; everything else is the token itself. */
  clean: string;
  /** Dollar-quoted or E / U& string body (the raw content between the delimiters). Only for strings. */
  body?: string;
  /** Text of the whitespace and comments before this token, reduced to its newlines (or one space). */
  gap: string;
}

export interface LexResult {
  tokens: Tok[];
  error?: string;
}

/** Whitespace PostgreSQL recognises: space, tab, newline, carriage return, form feed, vertical tab. */
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
const isIdentStart = (c: string) => /[A-Za-z_]/.test(c) || c > "\u007f";
const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c) || c > "\u007f";
const OP_CHARS = "+-*/<>=~!@#%^&|`?:";
/** Unicode characters that look like whitespace or are invisible. PostgreSQL treats them as identifier characters; other readers do not. */
const LOOKALIKE = new RegExp("[\\u0080-\\u00a0\\u00ad\\u061c\\u1680\\u180e\\u2000-\\u200f\\u2028-\\u202f\\u205f-\\u206f\\u3000\\ufeff\\ufff9-\\ufffb]");

export const MAX_SQL_CHARS = 100_000;

export function lex(sql: string): LexResult {
  const tokens: Tok[] = [];
  const n = sql.length;
  if (n > MAX_SQL_CHARS) return { tokens, error: `The SQL is longer than ${MAX_SQL_CHARS.toLocaleString("en-US")} characters.` };
  let i = 0;
  let gap = "";
  let pending = "";
  const note = (text: string) => { for (const ch of text) if (ch === "\n") pending += "\n"; };
  const push = (t: Omit<Tok, "gap">) => {
    tokens.push({ ...t, gap: gap + pending || " " });
    gap = "";
    pending = "";
  };
  const fail = (message: string): LexResult => ({ tokens, error: message });

  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "\0") return fail("The SQL contains a NUL character.");
    if (isSpace(c)) { if (c === "\n") pending += "\n"; i++; continue; }
    if (c === "-" && d === "-") {
      let j = i; while (j < n && sql[j] !== "\n" && sql[j] !== "\r") j++;
      i = j; continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1, j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; }
        else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; }
        else j++;
      }
      if (depth > 0) return fail("A /* comment is never closed.");
      note(sql.slice(i, j)); i = j; continue;
    }
    if (c === "'") {
      const r = readQuoted(sql, i, false);
      if (!r) return fail("A string literal is never closed.");
      push({ kind: "string", text: sql.slice(i, r.end), start: i, end: r.end, clean: cleanString(sql.slice(i, r.end)), body: r.body });
      i = r.end; continue;
    }
    if (c === '"') {
      const r = readQuoted(sql, i, false);
      if (!r) return fail("A quoted identifier is never closed.");
      push({ kind: "qident", text: r.body.replace(/""/g, '"'), start: i, end: r.end, clean: sql.slice(i, r.end) });
      i = r.end; continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/.exec(sql.slice(i, i + 200));
      if (m) {
        const close = sql.indexOf(m[0], i + m[0].length);
        if (close === -1) return fail("A dollar-quoted string is never closed.");
        const end = close + m[0].length;
        push({ kind: "string", text: sql.slice(i, end), start: i, end, clean: cleanString(sql.slice(i, end)), body: sql.slice(i + m[0].length, close) });
        i = end; continue;
      }
      const p = /^\$\d+/.exec(sql.slice(i, i + 20));
      if (p) { push({ kind: "param", text: p[0], start: i, end: i + p[0].length, clean: p[0] }); i += p[0].length; continue; }
      return fail("A stray $ was found. Use a plain string or a $tag$ ... $tag$ quote.");
    }
    if (/[0-9]/.test(c) || (c === "." && d !== undefined && /[0-9]/.test(d))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(sql.slice(i, i + 80))!;
      push({ kind: "number", text: m[0], start: i, end: i + m[0].length, clean: m[0] });
      i += m[0].length; continue;
    }
    if (isIdentStart(c)) {
      if (c > "\u007f" && LOOKALIKE.test(c)) return fail("An invisible or look-alike Unicode character was found outside a string. Remove it.");
      let j = i + 1;
      while (j < n && isIdentPart(sql[j])) {
        if (sql[j] > "\u007f" && LOOKALIKE.test(sql[j])) return fail("An invisible or look-alike Unicode character was found outside a string. Remove it.");
        j++;
      }
      const word = sql.slice(i, j);
      const lower = word.toLowerCase();
      // String prefixes: E'..' (backslash escapes), B, X, N, and U&'..' / U&"..".
      if (sql[j] === "'" && /^[ebxn]$/.test(lower)) {
        const r = readQuoted(sql, j, lower === "e");
        if (!r) return fail("A string literal is never closed.");
        push({ kind: "string", text: sql.slice(i, r.end), start: i, end: r.end, clean: cleanString(sql.slice(i, r.end)), body: r.body });
        i = r.end; continue;
      }
      if (lower === "u" && sql[j] === "&" && (sql[j + 1] === "'" || sql[j + 1] === '"')) {
        const r = readQuoted(sql, j + 1, false);
        if (!r) return fail("A quoted literal is never closed.");
        if (sql[j + 1] === "'") push({ kind: "string", text: sql.slice(i, r.end), start: i, end: r.end, clean: cleanString(sql.slice(i, r.end)), body: r.body });
        else push({ kind: "qident", text: r.body.replace(/""/g, '"'), start: i, end: r.end, clean: sql.slice(j + 1, r.end) });
        i = r.end; continue;
      }
      push({ kind: "word", text: lower, start: i, end: j, clean: word });
      i = j; continue;
    }
    if (c === "(" || c === ")" || c === "[" || c === "]" || c === "," || c === ";" || c === ".") {
      push({ kind: "punct", text: c, start: i, end: i + 1, clean: c });
      i++; continue;
    }
    if (OP_CHARS.includes(c)) {
      let j = i;
      while (j < n && OP_CHARS.includes(sql[j])) {
        if ((sql[j] === "-" && sql[j + 1] === "-") || (sql[j] === "/" && sql[j + 1] === "*")) break;
        j++;
      }
      if (j === i) j = i + 1;
      // PostgreSQL: a multi-character operator may not end in + or - unless it also contains one of ~ ! @ # % ^ & | ` ?
      while (j - i > 1 && /[+-]/.test(sql[j - 1]) && !/[~!@#%^&|`?]/.test(sql.slice(i, j))) j--;
      push({ kind: "op", text: sql.slice(i, j), start: i, end: j, clean: sql.slice(i, j) });
      i = j; continue;
    }
    if (c === "{" || c === "}" || c === "\\" ) {
      push({ kind: "op", text: c, start: i, end: i + 1, clean: c });
      i++; continue;
    }
    if (c > "\u007f") return fail("An invisible or look-alike Unicode character was found outside a string. Remove it.");
    return fail(`The character ${JSON.stringify(c)} is not valid in SQL here.`);
  }
  return { tokens };
}

/** Read a quoted run starting at the opening quote. `backslash`: E'' rules. Returns the body (between the quotes) and the end offset. */
function readQuoted(sql: string, at: number, backslash: boolean): { body: string; end: number } | null {
  const q = sql[at];
  let j = at + 1;
  while (j < sql.length) {
    const ch = sql[j];
    if (backslash && ch === "\\") { j += 2; continue; }
    if (ch === q) {
      if (sql[j + 1] === q) { j += 2; continue; }
      return { body: sql.slice(at + 1, j), end: j + 1 };
    }
    j++;
  }
  return null;
}

/** A string literal a parser can read whatever its quoting: `'x'`, with the original's newlines kept so line numbers stay right. */
function cleanString(raw: string): string {
  return `'x'${raw.replace(/[^\n]/g, "")}`;
}

/** Split tokens into statements at top-level `;`. Empty statements (`;;`) are dropped. */
export function splitStatements(tokens: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  for (const t of tokens) {
    if (t.kind === "punct" && t.text === ";") { if (cur.length) out.push(cur); cur = []; }
    else cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The statement's text as a parser should read it: comments gone, string contents replaced. */
export function cleanText(tokens: Tok[]): string {
  return tokens.map((t, i) => (i === 0 ? t.clean : `${t.gap}${t.clean}`)).join("");
}

/** The name of an identifier token: unquoted words fold to lower case, quoted ones keep their case, as PostgreSQL does. */
export const identName = (t: Tok | undefined): string | null => (t && (t.kind === "word" || t.kind === "qident") ? t.text : null);
