/**
 * Structural analysis of a query from a real PostgreSQL AST (pgsql-ast-parser), with the
 * clause splitter as a fallback. Everything here is *parsed* — nothing is executed.
 */
import { parseSelect, parseSetOperation, setOpBranches, splitSetOps } from "./sqlClauses";

export interface CteInfo {
  name: string;
  dependsOn: string[];
  recursive: boolean;
}
export interface BranchInfo {
  /** Operator that joins this branch to the previous one ("" for the first). */
  op: string;
  sql: string;
}
export interface Structure {
  source: "ast" | "clauses";
  statement: string;
  tables: { name: string; alias?: string }[];
  joins: { type: string; table: string; on?: string }[];
  ctes: CteInfo[];
  branches: BranchInfo[];
  subqueries: number;
  windows: number;
  /** Functions whose value changes between runs; derived stage queries would not reproduce the query. */
  volatile: string[];
  parseError?: string;
}

const VOLATILE = /\b(random|now|clock_timestamp|statement_timestamp|timeofday|nextval|setval|setseed|gen_random_uuid|uuid_generate_v4|txid_current|pg_sleep)\s*\(/gi;

export function volatileFunctions(sql: string): string[] {
  const s = sql.replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
  return [...new Set([...s.matchAll(VOLATILE)].map((m) => m[1].toLowerCase() + "()"))];
}

type Ast = Record<string, unknown> & { type?: string };

/** Walk any AST object, calling fn on every node that has a `type`. */
function walk(node: unknown, fn: (n: Ast) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((x) => walk(x, fn));
    return;
  }
  const n = node as Ast;
  if (typeof n.type === "string") fn(n);
  for (const v of Object.values(n)) if (v && typeof v === "object") walk(v, fn);
}

function tableRefs(node: unknown): string[] {
  const out: string[] = [];
  walk(node, (n) => {
    if (n.type === "table" && n.name && typeof (n.name as Ast).name === "string") out.push(((n.name as Ast).name as string).toLowerCase());
  });
  return out;
}

export async function analyze(sql: string): Promise<Structure> {
  const text = sql.trim().replace(/;\s*$/, "");
  const volatile = volatileFunctions(text);
  try {
    const { parse, toSql } = await import("pgsql-ast-parser");
    const stmts = parse(text) as unknown as Ast[];
    if (stmts.length !== 1) throw new Error("Visualize one statement at a time.");
    const root = stmts[0];
    let body: Ast = root;
    const ctes: CteInfo[] = [];
    if (root.type === "with" || root.type === "with recursive") {
      const binds = (root.bind as Ast[]) ?? [];
      const names = binds.map((b) => ((b.alias as Ast).name as string).toLowerCase());
      for (const b of binds) {
        const name = ((b.alias as Ast).name as string).toLowerCase();
        const refs = new Set(tableRefs(b.statement));
        ctes.push({ name, dependsOn: names.filter((x) => x !== name && refs.has(x)), recursive: refs.has(name) });
      }
      body = root.in as Ast;
    }
    // Branches come from the set-operation reader (sqlClauses.parseSetOperation), not from the syntax tree: the tree
    // package only knows UNION, rejects INTERSECT/EXCEPT, and attaches a trailing ORDER BY / LIMIT to the last branch
    // although PostgreSQL applies it to the whole operation.
    const setOp = parseSetOperation(text);
    const branches: BranchInfo[] = setOp.kind === "setop" ? setOpBranches(setOp.query) : [{ op: "", sql: toSql.statement(body as never) }];
    const tables: Structure["tables"] = [];
    const joins: Structure["joins"] = [];
    let subqueries = 0;
    let windows = 0;
    walk(body, (n) => {
      if (n.type === "select" && n !== body) subqueries++;
      if (n.type === "call" && n.over) windows++;
    });
    for (const f of ((body.type === "select" ? body.from : (branches.length === 1 ? (body.from as Ast[]) : [])) as Ast[] | undefined) ?? []) {
      const name = f.type === "table" ? ((f.name as Ast).name as string) : "(subquery)";
      const alias = f.type === "table" ? ((f.name as Ast).alias as string | undefined) : ((f.alias as string | undefined));
      tables.push({ name, alias });
      const j = f.join as Ast | undefined;
      if (j) joins.push({ type: j.type as string, table: alias ?? name, on: j.on ? toSql.expr(j.on as never) : undefined });
    }
    // Branches of a set operation are each a SELECT; don't count them as subqueries.
    subqueries = Math.max(0, subqueries - (branches.length > 1 ? branches.length : 0));
    return {
      source: "ast",
      statement: ctes.length ? `WITH (${ctes.length} CTE${ctes.length > 1 ? "s" : ""}) + ${branches.length > 1 ? "set operation" : "SELECT"}` : branches.length > 1 ? "set operation" : String(body.type ?? "statement").toUpperCase(),
      tables, joins, ctes, branches, subqueries, windows, volatile,
    };
  } catch (e) {
    // Fallback: the clause splitter still gives a useful outline.
    const p = parseSelect(text);
    const fb = fallbackBranches(text);
    return {
      source: "clauses",
      statement: fb.length > 1 ? "set operation" : p.unsupported ? "unsupported" : p.with ? "WITH + SELECT" : "SELECT",
      tables: p.joins.map((j) => ({ name: j.source })),
      joins: p.joins.slice(1).map((j) => ({ type: j.kind, table: j.source, on: j.on })),
      ctes: [],
      branches: fb,
      subqueries: (text.match(/\(\s*select\b/gi) ?? []).length,
      windows: p.windows.length,
      volatile,
      parseError: (e as Error).message.split("\n")[0],
    };
  }
}

/** Branches for the clause-splitter fallback: the set-operation reader when it understands the query, else the flat splitter. */
function fallbackBranches(text: string): BranchInfo[] {
  const so = parseSetOperation(text);
  if (so.kind === "setop") {
    const b = setOpBranches(so.query);
    // CTEs apply to every branch, so each one carries the WITH prefix and still runs on its own.
    return so.query.with ? b.map((x) => ({ ...x, sql: `${so.query.with}\n${x.sql}` })) : b;
  }
  return splitSetOps(text).length > 1 ? splitSetOps(text) : [];
}

/** Mermaid flowchart of CTE dependencies feeding the main query. */
export function cteFlow(s: Structure): string {
  if (!s.ctes.length) return "";
  const id = (n: string) => `c_${n.replace(/[^a-z0-9_]/g, "_")}`;
  const lines = ["flowchart LR"];
  for (const c of s.ctes) {
    lines.push(`  ${id(c.name)}["${c.name}${c.recursive ? " (recursive)" : ""}"]`);
    for (const d of c.dependsOn) lines.push(`  ${id(d)} --> ${id(c.name)}`);
  }
  lines.push(`  main["main query"]`);
  const used = new Set(s.ctes.flatMap((c) => c.dependsOn));
  for (const c of s.ctes) if (!used.has(c.name)) lines.push(`  ${id(c.name)} --> main`);
  return lines.join("\n");
}
