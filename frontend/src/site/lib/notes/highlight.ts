/** Small lexers for syntax-highlighted code in the PDF: each line becomes coloured text runs. */
export type TokenKind = "kw" | "fn" | "str" | "num" | "com" | "op" | "plain";
export interface Run { text: string; kind: TokenKind }

const SQL_KW = new Set(("select from where group by having order limit offset join left right full inner outer cross natural on using as and or not in is null " +
  "distinct case when then else end with recursive union all intersect except insert into values update set delete create table view index drop alter " +
  "add primary key foreign references unique check default over partition rows range between unbounded preceding following current row asc desc nulls first last " +
  "exists any some lateral filter within interval true false like ilike similar escape cast returning begin commit rollback").split(" "));
const SQL_FN = new Set(("count sum avg min max round coalesce nullif extract date_trunc to_char string_agg array_agg row_number rank dense_rank ntile lag lead " +
  "first_value last_value nth_value percent_rank cume_dist upper lower length substring trim concat now abs ceil floor greatest least age generate_series").split(" "));
const PY_KW = new Set(("def class return if elif else for while in not and or is None True False try except finally raise with as import from yield lambda pass break continue " +
  "global nonlocal assert del async await").split(" "));
const PY_FN = new Set("print len range enumerate zip map filter sorted sum min max any all isinstance int float str bool list dict set tuple open iter next super getattr setattr hasattr round abs".split(" "));

const LEX: Record<"sql" | "python", RegExp> = {
  sql: /(--[^\n]*)|('(?:[^']|'')*')|("(?:[^"]|"")*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w$]*)|(::|<=|>=|<>|!=|\|\||[-+*/%=<>(),.;])|(\s+)|(.)/g,
  python: /(#[^\n]*)|([rbfuRBFU]{0,2}(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"))|(\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\b)|([A-Za-z_]\w*)|(==|!=|<=|>=|\*\*|\/\/|->|[-+*/%=<>()[\]{},.:@])|(\s+)|(.)/g,
};

/** Tokenise, then split into lines (multi-line strings and comments are split too). */
export function highlight(code: string, lang: "sql" | "python"): Run[][] {
  const runs: Run[] = [];
  const kw = lang === "sql" ? SQL_KW : PY_KW, fn = lang === "sql" ? SQL_FN : PY_FN;
  for (const m of code.replace(/\t/g, "    ").matchAll(LEX[lang])) {
    const tok = m[0];
    // SQL groups: 1 comment, 2 string, 3 quoted identifier, 4 number, 5 word, 6 operator.
    // Python groups: 1 comment, 2 string, 3 number, 4 word, 5 operator.
    const [com, str, num, word, op] = lang === "sql" ? [m[1], m[2], m[4], m[5] ?? m[3], m[6]] : [m[1], m[2], m[3], m[4], m[5]];
    let kind: TokenKind = "plain";
    if (com) kind = "com";
    else if (str) kind = "str";
    else if (num) kind = "num";
    else if (word && !(lang === "sql" && m[3])) {
      const w = lang === "sql" ? word.toLowerCase() : word;
      kind = kw.has(w) ? "kw" : fn.has(w) ? "fn" : "plain";
    } else if (op) kind = "op";
    runs.push({ text: tok, kind });
  }
  const lines: Run[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ text: p, kind: r.kind });
    });
  }
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  return lines;
}
