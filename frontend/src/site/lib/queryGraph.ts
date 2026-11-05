/**
 * Diagrams from a user's SQL, built from a real PostgreSQL AST (pgsql-ast-parser).
 *
 * - Flow: the LOGICAL order SQL is defined to evaluate (FROM/JOIN → WHERE → GROUP BY → HAVING →
 *   window → SELECT → DISTINCT → ORDER BY → LIMIT). It is not the physical plan; the Plan view
 *   (EXPLAIN) shows what PostgreSQL actually runs.
 * - Relationships: the tables the statement reads, their aliases, and each join's type and column
 *   pairs.
 * Labels are sliced from the user's own text (parser locations), not regenerated SQL.
 * If the parser can't read the statement, the result is { ok: false } and no diagram is drawn.
 */

type Ast = Record<string, unknown> & { type?: string; _location?: { start: number; end: number } };

export type FlowKind = "cte" | "source" | "subquery" | "join" | "where" | "group" | "having" | "window" | "select" | "distinct" | "order" | "limit" | "setop" | "branch" | "result";
export interface FlowNode { id: string; kind: FlowKind; title: string; detail: string[] }
export interface FlowEdge { from: string; to: string; label?: string }
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[] }

export interface RelTable { name: string; aliases: string[]; cte: boolean }
export interface RelJoin { left: string; right: string; type: string; on: string; pairs: { left: string; right: string }[] }
export interface RelGraph { tables: RelTable[]; joins: RelJoin[] }

export type GraphResult =
  | { ok: true; flow: FlowGraph; rel: RelGraph; statement: string; notes: string[] }
  | { ok: false; reason: string };

const AGG = new Set(["count", "sum", "avg", "min", "max", "string_agg", "array_agg", "json_agg", "jsonb_agg", "bool_and", "bool_or", "every", "stddev", "stddev_pop", "stddev_samp", "variance", "var_pop", "var_samp", "percentile_cont", "percentile_disc", "mode"]);
const SETOP = /^(union|union all|intersect|intersect all|except|except all)$/;

function walk(node: unknown, fn: (n: Ast) => boolean | void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((x) => walk(x, fn));
  const n = node as Ast;
  if (typeof n.type === "string" && fn(n) === false) return;
  for (const [k, v] of Object.entries(n)) if (k !== "_location" && v && typeof v === "object") walk(v, fn);
}

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function buildGraphs(sql: string): Promise<GraphResult> {
  const text = sql.replace(/;\s*$/, "").trim();
  if (!text) return { ok: false, reason: "Write a query to see its diagram." };
  let stmts: Ast[];
  try {
    const { parse } = await import("pgsql-ast-parser");
    stmts = parse(text, { locationTracking: true }) as unknown as Ast[];
  } catch (e) {
    return { ok: false, reason: `The SQL parser couldn't read this statement, so no diagram is drawn (${(e as Error).message.split("\n")[0].slice(0, 120)}).` };
  }
  if (stmts.length !== 1) return { ok: false, reason: "Diagrams work on one statement at a time." };
  const src = (n: unknown) => {
    const loc = (n as Ast | undefined)?._location;
    return loc ? text.slice(loc.start, loc.end).replace(/\s+/g, " ").trim() : "";
  };

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const notes: string[] = [];
  const tables = new Map<string, RelTable>();
  const joins: RelJoin[] = [];
  let seq = 0;
  const add = (kind: FlowKind, title: string, detail: string[] = []) => {
    const id = `${kind}-${seq++}`;
    nodes.push({ id, kind, title, detail });
    return id;
  };
  const link = (from: string, to: string, label?: string) => edges.push({ from, to, label });
  const noteTable = (name: string, alias: string | undefined, cte: boolean) => {
    const t = tables.get(name) ?? { name, aliases: [], cte };
    if (alias && alias !== name && !t.aliases.includes(alias)) t.aliases.push(alias);
    tables.set(name, t);
  };

  let root = stmts[0];
  const cteNames = new Set<string>();
  const cteNodes = new Map<string, string>();
  if (root.type === "with" || root.type === "with recursive") {
    for (const b of (root.bind as Ast[]) ?? []) {
      const name = String((b.alias as Ast).name).toLowerCase();
      cteNames.add(name);
    }
    for (const b of (root.bind as Ast[]) ?? []) {
      const name = String((b.alias as Ast).name).toLowerCase();
      const reads: string[] = [];
      walk(b.statement, (n) => { if (n.type === "table") reads.push(String((n.name as Ast).name).toLowerCase()); });
      const id = add("cte", `CTE ${name}`, [root.type === "with recursive" && reads.includes(name) ? "recursive" : "", `reads: ${[...new Set(reads)].join(", ") || "—"}`, clip(src(b.statement), 120)].filter(Boolean));
      cteNodes.set(name, id);
      noteTable(name, undefined, true);
      for (const r of new Set(reads)) {
        if (cteNodes.has(r) && r !== name) link(cteNodes.get(r)!, id, "feeds");
        else if (!cteNames.has(r)) noteTable(r, undefined, false);
      }
      // Joins inside the CTE still matter for the relationship view.
      walk(b.statement, (n) => { if (n.type === "select") { collectJoins(n); return false; } });
    }
    root = root.in as Ast;
  }

  /** Relationship view: joins and their column pairs, resolving aliases to table names. */
  function collectJoins(sel: Ast) {
    const alias = new Map<string, string>();
    const from = (sel.from as Ast[] | undefined) ?? [];
    for (const f of from) {
      if (f.type === "table") {
        const nm = String((f.name as Ast).name).toLowerCase();
        const al = (f.name as Ast).alias ? String((f.name as Ast).alias).toLowerCase() : undefined;
        alias.set(al ?? nm, nm);
        alias.set(nm, nm);
        noteTable(nm, al, cteNames.has(nm));
      } else if (f.alias) alias.set(String(f.alias).toLowerCase(), `(subquery ${String(f.alias)})`);
    }
    let prev = from[0] ? (from[0].type === "table" ? String((from[0].name as Ast).name).toLowerCase() : `(subquery ${String(from[0].alias ?? "")})`) : "";
    for (const f of from.slice(1)) {
      const right = f.type === "table" ? String((f.name as Ast).name).toLowerCase() : `(subquery ${String(f.alias ?? "")})`;
      const j = f.join as Ast | undefined;
      const pairs: { left: string; right: string }[] = [];
      walk(j?.on, (n) => {
        if (n.type === "binary" && n.op === "=" && (n.left as Ast).type === "ref" && (n.right as Ast).type === "ref") {
          const side = (r: Ast) => `${alias.get(String((r.table as Ast | undefined)?.name ?? "").toLowerCase()) ?? String((r.table as Ast | undefined)?.name ?? "?")}.${String(r.name)}`;
          pairs.push({ left: side(n.left as Ast), right: side(n.right as Ast) });
        }
      });
      const on = j?.on ? src(j.on) : j?.using ? `USING (${((j.using as Ast[]) ?? []).map((u) => String(u.name)).join(", ")})` : "";
      // The edge joins the newly joined table to the table its condition compares it with
      // (the first pair side that isn't the joined table), else to the previous table.
      const other = pairs.flatMap((p) => [p.left, p.right]).map((c) => c.split(".")[0]).find((t) => t !== right) ?? prev;
      joins.push({ left: other, right, type: j ? String(j.type) : "CROSS JOIN (comma)", on, pairs });
      prev = right;
    }
  }

  /** Flow for one SELECT; returns the id of its last node. */
  function selectFlow(sel: Ast, label = ""): string {
    collectJoins(sel);
    const from = (sel.from as Ast[] | undefined) ?? [];
    let last = "";
    from.forEach((f, i) => {
      let sid: string;
      if (f.type === "table") {
        const nm = String((f.name as Ast).name);
        const al = (f.name as Ast).alias ? String((f.name as Ast).alias) : undefined;
        sid = add("source", nm, [al ? `alias ${al}` : "", cteNames.has(nm.toLowerCase()) ? "from CTE" : "table"].filter(Boolean));
        const c = cteNodes.get(nm.toLowerCase());
        if (c) link(c, sid, "reads");
      } else {
        sid = add("subquery", `Subquery ${f.alias ? String(f.alias) : ""}`.trim(), [clip(src(f.statement ?? f), 120)]);
      }
      const j = f.join as Ast | undefined;
      if (i === 0) last = sid;
      else {
        const jid = add("join", j ? String(j.type) : "CROSS JOIN", [j?.on ? `ON ${clip(src(j.on), 110)}` : j?.using ? `USING (${((j.using as Ast[]) ?? []).map((u) => String(u.name)).join(", ")})` : "no condition (Cartesian product)"]);
        link(last, jid);
        link(sid, jid);
        last = jid;
      }
    });
    if (!from.length) last = add("source", "No FROM", ["constant expressions only"]);

    const subqueriesIn = (n: unknown) => {
      let k = 0;
      walk(n, (x) => { if (x.type === "select" || SETOP.test(String(x.type))) { k++; return false; } });
      return k;
    };
    if (sel.where) {
      const sq = subqueriesIn(sel.where);
      const w = add("where", "WHERE", [clip(src(sel.where), 120), sq ? `${sq} subquery${sq > 1 ? "ies" : ""} inside` : ""].filter(Boolean));
      link(last, w, "rows");
      last = w;
    }
    const cols = (sel.columns as Ast[] | undefined) ?? [];
    const aggs: string[] = [];
    const wins: string[] = [];
    walk([cols, sel.having, sel.orderBy], (n) => {
      if (n.type === "call") {
        const fn = String((n.function as Ast).name).toLowerCase();
        if (n.over) wins.push(clip(src(n), 90));
        else if (AGG.has(fn)) aggs.push(clip(src(n), 60));
      }
      if (n.type === "select") return false;
    });
    if ((sel.groupBy as Ast[] | undefined)?.length || (aggs.length && !wins.length)) {
      const g = add("group", (sel.groupBy as Ast[] | undefined)?.length ? "GROUP BY" : "Aggregate (one group)", [
        (sel.groupBy as Ast[] | undefined)?.length ? `by ${(sel.groupBy as Ast[]).map(src).join(", ")}` : "",
        aggs.length ? `aggregates: ${[...new Set(aggs)].join(", ")}` : "",
      ].filter(Boolean));
      link(last, g, "rows");
      last = g;
    }
    if (sel.having) {
      const h = add("having", "HAVING", [clip(src(sel.having), 120)]);
      link(last, h, "groups");
      last = h;
    }
    if (wins.length) {
      const w = add("window", "Window functions", [...new Set(wins)]);
      link(last, w);
      last = w;
    }
    const sq = subqueriesIn(cols);
    const s = add("select", label ? `SELECT ${label}` : "SELECT", [clip(cols.map((c) => src(c)).join(", "), 140), sq ? `${sq} scalar subquer${sq > 1 ? "ies" : "y"}` : ""].filter(Boolean));
    link(last, s);
    last = s;
    if (sel.distinct) {
      const d = add("distinct", sel.distinct === "distinct" ? "DISTINCT" : "DISTINCT ON", [Array.isArray(sel.distinct) ? (sel.distinct as Ast[]).map(src).join(", ") : "remove duplicate rows"]);
      link(last, d);
      last = d;
    }
    last = tail(sel, last);
    return last;
  }

  function tail(n: Ast, last: string): string {
    if ((n.orderBy as Ast[] | undefined)?.length) {
      const o = add("order", "ORDER BY", [(n.orderBy as Ast[]).map((x) => `${src(x.by)}${x.order ? ` ${String(x.order)}` : ""}`).join(", ")]);
      link(last, o);
      last = o;
    }
    const lim = n.limit as Ast | undefined;
    if (lim && (lim.limit || lim.offset)) {
      const l = add("limit", "LIMIT / OFFSET", [lim.limit ? `limit ${src(lim.limit)}` : "", lim.offset ? `offset ${src(lim.offset)}` : ""].filter(Boolean));
      link(last, l);
      last = l;
    }
    return last;
  }

  let end: string;
  let statement: string;
  if (root.type === "select") {
    end = selectFlow(root);
    statement = "SELECT";
  } else if (SETOP.test(String(root.type))) {
    const branches: { op: string; n: Ast }[] = [];
    const flatten = (n: Ast, op: string) => {
      if (SETOP.test(String(n.type))) { flatten(n.left as Ast, op); flatten(n.right as Ast, String(n.type).toUpperCase()); }
      else branches.push({ op, n });
    };
    flatten(root, "");
    const ends = branches.map((b, i) => (b.n.type === "select" ? selectFlow(b.n, `branch ${i + 1}`) : add("branch", `Branch ${i + 1}`, [clip(src(b.n), 100)])));
    const ops = [...new Set(branches.slice(1).map((b) => b.op))];
    const s = add("setop", ops.join(" / "), [`${branches.length} branches combined`, ops.some((o) => !o.endsWith("ALL")) ? "duplicates removed" : "duplicates kept"]);
    ends.forEach((e) => link(e, s));
    end = tail(root, s);
    statement = "Set operation";
  } else {
    return { ok: false, reason: `Diagrams cover SELECT queries (with CTEs, joins, subqueries and set operations). This is a ${String(root.type).toUpperCase()} statement.` };
  }
  const r = add("result", "Result", []);
  link(end, r);
  if (cteNodes.size) statement = `WITH ${cteNodes.size} CTE${cteNodes.size > 1 ? "s" : ""} + ${statement}`;
  notes.push("Logical order: how SQL is defined to evaluate the clauses. PostgreSQL may run it differently; see the Plan view for the physical plan.");
  return { ok: true, flow: { nodes, edges }, rel: { tables: [...tables.values()], joins }, statement, notes };
}
