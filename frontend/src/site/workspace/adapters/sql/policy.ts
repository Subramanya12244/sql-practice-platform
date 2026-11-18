/**
 * SQL capability policy for graded exercises (docs/WORKSPACE_SQL_SAFETY.md). It decides, before anything reaches the database,
 * whether a script may run under a `SqlPolicy`:
 *
 *   read-only   queries only (SELECT, WITH ... SELECT, VALUES, TABLE, SHOW, EXPLAIN of those)
 *   own-tables  queries, plus CREATE TABLE / VIEW / MATERIALIZED VIEW / INDEX and INSERT into tables the SAME script created
 *   own-data    own-tables, plus UPDATE / DELETE on tables the same script created
 *
 * Two tiers read the script, both of them over the tokens of lexer.ts:
 *   1. parsed (the boundary): every statement is parsed with pgsql-ast-parser and classified from its AST; statement counts and
 *      verbs are cross-checked against the token reader, and any disagreement refuses the script. A script that cannot be parsed
 *      is refused (fail closed) ...
 *   2. lexical (documented fallback) ... except where a second, independent layer exists or the exercise's own reference could
 *      not be parsed: read-only exercises (PostgreSQL's own READ ONLY transaction is the second layer, so a typo still gets
 *      PostgreSQL's error message) and exercises with `spec.lexical`. The token tier applies the same rules, and refuses every
 *      keyword that could change data anywhere in a query.
 * Both tiers produce the same `Facts` and share one rule engine (`evaluate`), so a rule is written once.
 *
 * `allow` entries are exact (verb, target) grants derived from the exercise's own reference query: a lesson whose answer deletes
 * from a base table or drops its own scratch table may do that exact thing, and nothing else of the kind.
 */
import type { SqlPolicy } from "../../types";
import { cleanText, identName, lex, splitStatements, type Tok } from "./lexer";

export interface PolicySpec {
  level: SqlPolicy;
  /** Exact grants the reference itself uses: `write:update:products`, `ddl:drop:scratch`, `index:orders`, `set:enable_seqscan`, `function:f`, `refresh:mv`. */
  allow?: readonly string[];
  /** The reference could not be parsed: statements that cannot be parsed are read by the lexical tier instead of being refused. */
  lexical?: boolean;
  /** Table names of the dataset: they are never treated as "created by the script" through `CREATE TABLE IF NOT EXISTS`. */
  protectedTables?: readonly string[];
}
export type PolicyOption = SqlPolicy | PolicySpec;
export const asSpec = (p: PolicyOption): PolicySpec => (typeof p === "string" ? { level: p } : p);
export const levelOf = (p: PolicyOption): SqlPolicy => asSpec(p).level;
const RANK: Record<SqlPolicy, number> = { "read-only": 0, "own-tables": 1, "own-data": 2 };
const LEVELS: SqlPolicy[] = ["read-only", "own-tables", "own-data"];

export interface PolicyVerdict {
  allowed: boolean;
  /** One plain sentence per problem. */
  reasons: string[];
  statements: number;
  tier: "parsed" | "lexical" | "none";
  /** Tables, views and materialized views the script creates, in order (normalised names). */
  created: string[];
  /** What each statement is: query, insert, update, delete, create-table, ... */
  verbs: string[];
}

/** The default set of Northwind tables. The adapter adds the dataset's own table names. */
export const NORTHWIND_TABLES = ["categories", "suppliers", "products", "customers", "employees", "shippers", "orders", "order_details"] as const;

/* ------------------------------------------------------------------ side-effect functions ------------------------------- */

const DENIED_EXACT = new Set([
  "nextval", "setval", "set_config", "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile", "pg_notify",
  "pg_sleep", "pg_sleep_for", "pg_sleep_until", "pg_stat_file", "pg_logdir_ls", "pg_switch_wal", "pg_create_restore_point", "pg_promote",
  "pg_import_system_collations", "pg_export_snapshot", "pg_drop_replication_slot", "pg_wal_replay_pause", "pg_wal_replay_resume",
  "lowrite", "loread", "lo_open", "lo_close", "lo_creat", "lo_create", "lo_put", "lo_get", "lo_import", "lo_export", "lo_unlink", "lo_from_bytea",
  "query_to_xml", "query_to_xmlschema", "query_to_xml_and_xmlschema", "cursor_to_xml", "cursor_to_xmlschema",
]);
/** Families: advisory locks outlive ROLLBACK; dblink, file readers and writers and replication reach outside the query. */
const DENIED_PREFIX = ["lo_", "dblink", "pg_advisory_", "pg_read_", "pg_ls_", "pg_file_", "pg_stat_reset", "pg_replication_", "pg_logical_", "pg_create_", "pg_backup_", "pg_start_backup", "pg_stop_backup"];

/** True for a function that changes state outside the query (sequences, files, connections, session settings, dynamic SQL, sleeping). */
export function isDeniedFunction(name: string): boolean {
  const n = name.toLowerCase();
  return DENIED_EXACT.has(n) || DENIED_PREFIX.some((p) => n.startsWith(p));
}

/* ------------------------------------------------------------------ facts ---------------------------------------------- */

interface Name { schema?: string; name: string }
type Verb = "query" | "insert" | "update" | "delete" | "create-table" | "create-view" | "create-index" | "create-function" | "drop" | "truncate" | "alter" | "set" | "show" | "refresh" | "txn" | "other";

interface Facts {
  verb: Verb;
  /** Statement keyword(s) for messages, upper case. */
  keyword: string;
  names: Name[];
  ifNotExists?: boolean;
  temporary?: boolean;
  functions: string[];
  /** Data-changing statements inside this one (WITH x AS (DELETE ... RETURNING ...)); each is judged like a statement of its own. */
  nested: { verb: string; name: Name | null }[];
  into: boolean;
  locking: boolean;
  variable?: string;
  setTxReadOnly?: boolean;
  fnName?: string;
  language?: string;
  body?: string;
}

const emptyFacts = (verb: Verb, keyword: string): Facts => ({ verb, keyword, names: [], functions: [], nested: [], into: false, locking: false });

const keyOf = (n: Name): string => (!n.schema || n.schema === "public" || n.schema === "pg_temp" ? n.name : `${n.schema}.${n.name}`);
const COARSE = new Set<Verb>(["query", "insert", "update", "delete", "create-table", "create-view", "create-index", "drop", "truncate", "alter"]);

/* ------------------------------------------------------------------ lexical facts -------------------------------------- */

const isW = (t: Tok | undefined, ...words: string[]) => t?.kind === "word" && words.includes(t.text);
const isP = (t: Tok | undefined, p: string) => t?.kind === "punct" && t.text === p;

/** `a`, `a.b` or `a.b.c` starting at k: the name (last two parts) and the index after it. */
function readName(t: Tok[], k: number): { name: Name; next: number } | null {
  const parts: string[] = [];
  let j = k;
  for (;;) {
    const id = identName(t[j]);
    if (id === null) return null;
    parts.push(id);
    j++;
    if (isP(t[j], ".") && identName(t[j + 1]) !== null) { j++; continue; }
    break;
  }
  const name = parts[parts.length - 1];
  const schema = parts.length > 1 ? parts[parts.length - 2] : undefined;
  return { name: { name, schema }, next: j };
}

function readNameList(t: Tok[], k: number): Name[] {
  const out: Name[] = [];
  let j = k;
  for (;;) {
    const r = readName(t, j);
    if (!r) break;
    out.push(r.name);
    j = r.next;
    if (isP(t[j], ",")) { j++; continue; }
    break;
  }
  return out;
}

function functionCalls(t: Tok[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) {
    if ((t[i].kind === "word" || t[i].kind === "qident") && isP(t[i + 1], "(")) out.push(t[i].text.toLowerCase());
  }
  return out;
}

/** Words INSERT / UPDATE / DELETE / MERGE inside a statement, outside the statement's own leading verb and the legal contexts. */
function dmlScan(t: Tok[], verbIdx: number): { nested: Facts["nested"]; locking: boolean } {
  const nested: Facts["nested"] = [];
  let locking = false;
  for (let i = 0; i < t.length; i++) {
    if (i === verbIdx || t[i].kind !== "word") continue;
    const w = t[i].text;
    if (!["insert", "update", "delete", "merge"].includes(w)) continue;
    if (isP(t[i - 1], ".")) continue; // t.update
    const prev = t[i - 1];
    if (w === "update" && isW(prev, "for", "key")) { locking = true; continue; }
    if (w === "update" && isW(prev, "do")) continue; // ON CONFLICT DO UPDATE
    let k = i + 1, name: Name | null = null;
    if (w === "insert" && isW(t[k], "into")) name = readName(t, k + 1)?.name ?? null;
    else if (w === "update") { if (isW(t[k], "only")) k++; name = readName(t, k)?.name ?? null; }
    else if (w === "delete" && isW(t[k], "from")) { k++; if (isW(t[k], "only")) k++; name = readName(t, k)?.name ?? null; }
    nested.push({ verb: w, name });
  }
  for (let i = 0; i < t.length - 1; i++) if (isW(t[i], "for") && isW(t[i + 1], "share", "no", "key")) locking = true;
  return { nested, locking };
}

const MAIN_VERBS = ["select", "insert", "update", "delete", "merge", "values", "table"];

/** Facts of one statement read from its tokens alone. EXPLAIN is already removed. */
function lexFacts(t: Tok[]): Facts {
  let i = 0;
  while (isP(t[i], "(")) i++;
  const first = t[i]?.kind === "word" ? t[i].text : "";

  // Queries and data-changing statements, possibly behind WITH [RECURSIVE] ... (the main verb is the first one outside every parenthesis).
  let verbIdx = -1;
  if (first === "with") {
    let depth = 0;
    for (let k = i + 1; k < t.length; k++) {
      if (isP(t[k], "(")) depth++;
      else if (isP(t[k], ")")) depth--;
      else if (depth === 0 && t[k].kind === "word" && MAIN_VERBS.includes(t[k].text)) { verbIdx = k; break; }
    }
    if (verbIdx < 0) return emptyFacts("other", "WITH");
  } else if (MAIN_VERBS.includes(first)) verbIdx = i;
  if (verbIdx >= 0) {
    const mainVerb = t[verbIdx].text;
    const scan = dmlScan(t, verbIdx);
    const base = (v: Verb, k: string): Facts => ({ ...emptyFacts(v, k), functions: functionCalls(t), nested: scan.nested, locking: scan.locking });
    if (mainVerb === "select" || mainVerb === "values" || mainVerb === "table") {
      const f = base("query", mainVerb.toUpperCase());
      f.into = t.some((x, k) => isW(x, "into") && !isP(t[k - 1], "."));
      return f;
    }
    if (mainVerb === "insert") {
      const f = base("insert", "INSERT");
      if (isW(t[verbIdx + 1], "into")) { const r = readName(t, verbIdx + 2); if (r) f.names = [r.name]; }
      return f;
    }
    if (mainVerb === "update") {
      const f = base("update", "UPDATE");
      let k = verbIdx + 1; if (isW(t[k], "only")) k++;
      const r = readName(t, k); if (r) f.names = [r.name];
      return f;
    }
    if (mainVerb === "delete") {
      const f = base("delete", "DELETE");
      let k = verbIdx + 1; if (isW(t[k], "from")) k++; if (isW(t[k], "only")) k++;
      const r = readName(t, k); if (r) f.names = [r.name];
      return f;
    }
    return emptyFacts("other", "MERGE");
  }

  const f0 = first;
  const calls = functionCalls(t);
  const mk = (v: Verb, k: string): Facts => ({ ...emptyFacts(v, k), functions: calls });
  switch (f0) {
    case "create": {
      let j = i + 1;
      let temporary = false;
      if (isW(t[j], "or") && isW(t[j + 1], "replace")) j += 2;
      while (isW(t[j], "global", "local", "temp", "temporary", "unlogged", "recursive")) { if (isW(t[j], "temp", "temporary")) temporary = true; j++; }
      const kind = t[j]?.kind === "word" ? t[j].text : "";
      if (kind === "table" || kind === "view" || (kind === "materialized" && isW(t[j + 1], "view"))) {
        j += kind === "materialized" ? 2 : 1;
        let ifNotExists = false;
        if (isW(t[j], "if") && isW(t[j + 1], "not") && isW(t[j + 2], "exists")) { ifNotExists = true; j += 3; }
        const r = readName(t, j);
        const f = mk(kind === "table" ? "create-table" : "create-view", `CREATE ${kind === "materialized" ? "MATERIALIZED VIEW" : kind.toUpperCase()}`);
        if (r) f.names = [r.name];
        f.ifNotExists = ifNotExists; f.temporary = temporary;
        f.nested = dmlScan(t, -1).nested;
        return f;
      }
      if (kind === "unique" || kind === "index") {
        const onAt = t.findIndex((x, k) => k > j && isW(x, "on"));
        const f = mk("create-index", "CREATE INDEX");
        if (onAt >= 0) { let k = onAt + 1; if (isW(t[k], "only")) k++; const r = readName(t, k); if (r) f.names = [r.name]; }
        return f;
      }
      if (kind === "function" || kind === "procedure") {
        const f = mk("create-function", `CREATE ${kind.toUpperCase()}`);
        const r = readName(t, j + 1);
        if (r) { f.names = [r.name]; f.fnName = r.name.name; }
        const lang = t.findIndex((x) => isW(x, "language"));
        f.language = lang >= 0 ? (t[lang + 1]?.kind === "string" ? t[lang + 1].body : t[lang + 1]?.text)?.toLowerCase() : undefined;
        const asAt = t.findIndex((x) => isW(x, "as"));
        const bodyTok = asAt >= 0 ? t[asAt + 1] : undefined;
        f.body = bodyTok?.kind === "string" ? bodyTok.body : undefined;
        f.functions = []; // its body is checked on its own
        return f;
      }
      return mk("other", `CREATE ${kind.toUpperCase()}`.trim());
    }
    case "drop": {
      let j = i + 1;
      const kind = t[j]?.kind === "word" ? t[j].text : "";
      j++;
      if (kind === "materialized") j++; // VIEW
      if (isW(t[j], "concurrently")) j++;
      if (isW(t[j], "if") && isW(t[j + 1], "exists")) j += 2;
      const f = mk("drop", `DROP ${kind.toUpperCase()}`.trim());
      f.names = readNameList(t, j);
      return f;
    }
    case "truncate": {
      let j = i + 1; if (isW(t[j], "table")) j++; if (isW(t[j], "only")) j++;
      const f = mk("truncate", "TRUNCATE"); f.names = readNameList(t, j); return f;
    }
    case "alter": {
      const kind = t[i + 1]?.kind === "word" ? t[i + 1].text : "";
      if (kind !== "table") return mk("other", `ALTER ${kind.toUpperCase()}`.trim());
      let j = i + 2; if (isW(t[j], "if") && isW(t[j + 1], "exists")) j += 2; if (isW(t[j], "only")) j += 1;
      const f = mk("alter", "ALTER TABLE"); const r = readName(t, j); if (r) f.names = [r.name]; return f;
    }
    case "refresh": {
      let j = i + 3; if (isW(t[j], "concurrently")) j++;
      const f = mk("refresh", "REFRESH MATERIALIZED VIEW"); const r = isW(t[i + 1], "materialized") ? readName(t, j) : null; if (r) f.names = [r.name]; else f.verb = "other";
      return f;
    }
    case "set": {
      let j = i + 1;
      if (isW(t[j], "session", "local")) j++;
      if (isW(t[j], "transaction")) {
        const f = mk("set", "SET TRANSACTION");
        f.setTxReadOnly = isW(t[j + 1], "read") && isW(t[j + 2], "only") && j + 3 >= t.length;
        return f;
      }
      if (isW(t[j], "role", "session")) return mk("other", "SET ROLE");
      const f = mk("set", "SET");
      f.variable = isW(t[j], "time") && isW(t[j + 1], "zone") ? "timezone" : readName(t, j)?.name.name;
      return f;
    }
    case "show": return mk("show", "SHOW");
    case "begin": case "commit": case "end": case "rollback": case "abort": case "start": case "savepoint": case "release":
      return mk("txn", f0.toUpperCase());
    case "prepare": return isW(t[i + 1], "transaction") ? mk("txn", "PREPARE TRANSACTION") : mk("other", "PREPARE");
    default: return mk("other", f0 ? f0.toUpperCase() : "THIS");
  }
}

/* ------------------------------------------------------------------ AST facts ------------------------------------------ */

type Ast = Record<string, unknown> & { type?: string };

function walkAst(node: unknown, fn: (n: Ast) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const x of node) walkAst(x, fn); return; }
  const n = node as Ast;
  if (typeof n.type === "string") fn(n);
  for (const [k, v] of Object.entries(n)) if (k !== "_location" && v && typeof v === "object") walkAst(v, fn);
}

const nameOf = (x: unknown): Name | null => {
  const o = x as { name?: string; schema?: string } | undefined;
  return o && typeof o.name === "string" ? { name: o.name, schema: o.schema } : null;
};

const DML_TYPES = new Set(["insert", "update", "delete"]);

function astFacts(node: Ast): Facts {
  let root: Ast = node;
  if ((node.type === "with" || node.type === "with recursive") && node.in && typeof node.in === "object") root = node.in as Ast;
  const type = root.type ?? "";
  let locking = false;
  const nested: Facts["nested"] = [];
  const functions: string[] = [];
  walkAst(node, (n) => {
    if (n !== root && DML_TYPES.has(n.type!)) nested.push({ verb: n.type!, name: nameOf(n.type === "insert" ? n.into : n.type === "update" ? n.table : n.from) });
    if (n.type === "select" && n.for) locking = true;
    if (n.type === "call") { const fname = (n.function as { name?: string } | undefined)?.name; if (typeof fname === "string") functions.push(fname.toLowerCase()); }
  });
  const base = (verb: Verb, keyword: string): Facts => ({ ...emptyFacts(verb, keyword), functions, nested, locking });
  const one = (n: Name | null) => (n ? [n] : []);
  if (["select", "union", "union all", "values", "with", "with recursive"].includes(type)) return base("query", "SELECT");
  switch (type) {
    case "insert": return { ...base("insert", "INSERT"), names: one(nameOf(root.into)) };
    case "update": return { ...base("update", "UPDATE"), names: one(nameOf(root.table)) };
    case "delete": return { ...base("delete", "DELETE"), names: one(nameOf(root.from)) };
    case "create table": return { ...base("create-table", "CREATE TABLE"), names: one(nameOf(root.name)), ifNotExists: root.ifNotExists === true, temporary: root.temporary === true };
    case "create view": return { ...base("create-view", "CREATE VIEW"), names: one(nameOf(root.name)), temporary: root.temporary === true };
    case "create materialized view": return { ...base("create-view", "CREATE MATERIALIZED VIEW"), names: one(nameOf(root.name)) };
    case "create index": return { ...base("create-index", "CREATE INDEX"), names: one(nameOf(root.table)) };
    case "drop table": case "drop index": return { ...base("drop", type.toUpperCase()), names: ((root.names as unknown[]) ?? []).map(nameOf).filter((x): x is Name => x !== null) };
    case "truncate table": return { ...base("truncate", "TRUNCATE"), names: ((root.tables as unknown[]) ?? []).map(nameOf).filter((x): x is Name => x !== null) };
    case "alter table": return { ...base("alter", "ALTER TABLE"), names: one(nameOf(root.table)) };
    case "refresh materialized view": return { ...base("refresh", "REFRESH MATERIALIZED VIEW"), names: one(nameOf(root.name)) };
    case "set": return { ...base("set", "SET"), variable: (root.variable as { name?: string } | undefined)?.name };
    case "show": return base("show", "SHOW");
    case "begin": case "commit": case "rollback": case "start transaction": return base("txn", type.toUpperCase());
    default: return base("other", type.toUpperCase() || "THIS");
  }
}

/* ------------------------------------------------------------------ the rule engine ------------------------------------ */

interface Collector { allow: Set<string>; needed: number }

function levelMessage(spec: PolicySpec): string {
  return spec.level === "read-only"
    ? "This exercise is graded and read-only: write a SELECT."
    : spec.level === "own-tables"
      ? "This exercise only allows queries, plus CREATE TABLE / VIEW / INDEX and INSERT into tables your own script creates."
      : "This exercise only allows queries and changes to tables your own script creates.";
}

function evaluate(facts: Facts[], spec: PolicySpec, collect?: Collector): { reasons: string[]; created: string[]; bodies: string[] } {
  const reasons: string[] = [];
  const bodies: string[] = [];
  const created = new Set<string>();
  const allowed = new Set(spec.allow ?? []);
  const protectedT = new Set(spec.protectedTables ?? NORTHWIND_TABLES);
  const rank = collect ? 2 : RANK[spec.level];
  const msg = levelMessage(spec);
  const need = (r: number) => { if (collect) collect.needed = Math.max(collect.needed, r); };
  const grant = (key: string, why: string): boolean => {
    if (!collect && rank < 1) { reasons.push(why); return false; }
    if (allowed.has(key)) return true;
    if (collect) { collect.allow.add(key); need(1); return true; }
    reasons.push(why);
    return false;
  };
  const refuse = (f: Facts, extra = "") => reasons.push(`${f.keyword} statements change data, the schema or the session. ${msg}${extra ? ` ${extra}` : ""}`);

  for (const f of facts) {
    // Rules that hold for every statement that can contain an expression.
    const denied = [...new Set(f.functions.filter(isDeniedFunction))];
    if (denied.length) reasons.push(`${denied.map((d) => `${d}()`).join(", ")} changes state outside the query (a sequence, a file, a connection, a setting, or it runs SQL or sleeps). It is not allowed in a graded exercise.`);
    for (const nd of f.nested) {
      const nk = nd.name ? keyOf(nd.name) : "";
      if (nd.verb === "merge" || !nk) { reasons.push(`A data-changing ${nd.verb.toUpperCase()} inside another statement (WITH x AS (DELETE ... RETURNING ...)) is not allowed in a graded exercise.`); continue; }
      if (rank < 1) { reasons.push(`A data-changing ${nd.verb.toUpperCase()} inside another statement (WITH x AS (DELETE ... RETURNING ...)) is not allowed. ${msg}`); continue; }
      if (created.has(nk) && (nd.verb === "insert" || rank >= 2)) { need(nd.verb === "insert" ? 1 : 2); continue; }
      grant(`write:${nd.verb}:${nk}`, `A ${nd.verb.toUpperCase()} on ${nk} inside another statement is not allowed: only tables your own script created in this run can be changed. ${msg}`);
    }
    if (f.into) reasons.push("SELECT ... INTO creates a table. This exercise is graded: write a plain SELECT.");
    if (f.locking) reasons.push("SELECT ... FOR UPDATE / SHARE takes row locks. It is not allowed in a graded exercise.");

    const target = f.names[0];
    const key = target ? keyOf(target) : "";
    switch (f.verb) {
      case "query": case "show": break;
      case "set":
        if (f.setTxReadOnly) break; // only narrows the transaction
        if (f.variable && grant(`set:${f.variable.toLowerCase()}`, `SET changes the session. ${msg}`)) break;
        if (!f.variable) reasons.push(`SET changes the session. ${msg}`);
        break;
      case "insert":
        if (rank < 1) { refuse(f); break; }
        if (!target) { reasons.push("INSERT needs a table name this checker can read."); break; }
        if (created.has(key)) { need(1); break; }
        grant(`write:insert:${key}`, `INSERT INTO ${key}: only tables your own script created in this run can be changed. ${msg}`);
        break;
      case "update": case "delete": {
        if (rank < 1) { refuse(f); break; }
        if (!target) { reasons.push(`${f.keyword} needs a table name this checker can read.`); break; }
        if (created.has(key)) {
          if (rank >= 2) { need(2); break; }
          reasons.push(`${f.keyword} ${key}: ${msg}`);
          break;
        }
        grant(`write:${f.verb}:${key}`, `${f.keyword} ${key}: only tables your own script created in this run can be changed, never the practice database's tables. ${msg}`);
        break;
      }
      case "create-table": case "create-view": {
        if (rank < 1) { refuse(f); break; }
        if (!target) { reasons.push(`${f.keyword} needs a name this checker can read.`); break; }
        if (target.schema && !["public", "pg_temp"].includes(target.schema)) { reasons.push(`${f.keyword} ${target.schema}.${target.name}: objects may only be created in the public or temporary schema.`); break; }
        if (f.ifNotExists && !f.temporary && protectedT.has(target.name)) { reasons.push(`${f.keyword} IF NOT EXISTS ${target.name}: that name belongs to the practice database.`); break; }
        created.add(key); need(1);
        break;
      }
      case "create-index":
        if (rank < 1) { refuse(f); break; }
        if (!target) { reasons.push("CREATE INDEX needs a table name this checker can read."); break; }
        if (created.has(key)) { need(1); break; }
        grant(`index:${key}`, `CREATE INDEX ON ${key}: indexes may only be created on tables your own script created. ${msg}`);
        break;
      case "refresh":
        if (rank < 1) { refuse(f); break; }
        if (target && created.has(key)) { need(1); break; }
        grant(`refresh:${key}`, `REFRESH MATERIALIZED VIEW ${key || ""}: only a materialized view your own script created. ${msg}`);
        break;
      case "create-function": {
        if (rank < 1) { refuse(f); break; }
        if (!f.fnName || !grant(`function:${f.fnName}`, `CREATE FUNCTION is not allowed in this exercise.`)) break;
        if (f.language !== "sql" || !f.body) { reasons.push("A function may only be written in LANGUAGE sql with a plain body."); break; }
        bodies.push(f.body);
        break;
      }
      case "drop": case "truncate": case "alter": {
        if (rank < 1) { refuse(f); break; }
        if (!f.names.length) { reasons.push(`${f.keyword} needs a name this checker can read.`); break; }
        for (const n of f.names) {
          const k = keyOf(n);
          grant(`ddl:${f.verb}:${k}`, `${f.keyword} ${k}: not allowed. Graded exercises never drop, truncate or alter anything except what their own reference does. ${msg}`);
        }
        break;
      }
      case "txn": reasons.push(`Transaction control (${f.keyword}) is not allowed here: every run is already wrapped and rolled back for you.`); break;
      default: refuse(f);
    }
  }
  // Every refusal of a read-only exercise says so, in the same words.
  const tail = spec.level === "read-only" ? " This exercise is graded and read-only." : "";
  return { reasons: [...new Set(reasons.map((r) => (tail && !/read-only/i.test(r) ? `${r}${tail}` : r)))], created: [...created], bodies };
}

/* ------------------------------------------------------------------ reading a script ------------------------------------ */

interface Read { statements: Tok[][]; error?: string }

function readScript(sql: string): Read {
  const lx = lex(sql);
  if (lx.error) return { statements: [], error: lx.error };
  return { statements: splitStatements(lx.tokens) };
}

/** Remove EXPLAIN [ANALYZE] [VERBOSE] [( options )] from the front. EXPLAIN runs its statement with ANALYZE, so the inner statement is judged as written. */
function unwrapExplain(t: Tok[]): { inner: Tok[]; explained: boolean } | { error: string } {
  if (!isW(t[0], "explain")) return { inner: t, explained: false };
  let j = 1;
  if (isP(t[j], "(")) {
    let depth = 0;
    for (; j < t.length; j++) { if (isP(t[j], "(")) depth++; else if (isP(t[j], ")")) { depth--; if (depth === 0) { j++; break; } } }
    if (depth !== 0) return { error: "EXPLAIN options are not closed." };
  } else {
    while (isW(t[j], "analyze", "analyse", "verbose")) j++;
  }
  const inner = t.slice(j);
  if (!inner.length) return { error: "EXPLAIN has no statement after it." };
  return { inner, explained: true };
}

type AstParse = (sql: string) => unknown[];
let parserPromise: Promise<AstParse> | null = null;
const loadParser = (): Promise<AstParse> => (parserPromise ??= import("pgsql-ast-parser").then((m) => (sql: string) => m.parse(sql) as unknown[]));

const shortError = (e: unknown): string => {
  const first = String((e as Error)?.message ?? e).split("\n")[0].replace(/\s+/g, " ").trim();
  return first.length > 120 ? `${first.slice(0, 119)}…` : first;
};

/** The query of `CREATE TABLE name [(columns)] AS query [WITH [NO] DATA]` (tokens), or null when the statement is not a CTAS. */
function ctasQuery(t: Tok[]): Tok[] | null {
  let depth = 0;
  for (let k = 2; k < t.length; k++) {
    if (isP(t[k], "(")) depth++;
    else if (isP(t[k], ")")) depth--;
    else if (depth === 0 && isW(t[k], "as")) {
      let end = t.length;
      if (isW(t[end - 1], "data") && isW(t[end - 2], "no") && isW(t[end - 3], "with")) end -= 3;
      else if (isW(t[end - 1], "data") && isW(t[end - 2], "with")) end -= 2;
      return t.slice(k + 1, end);
    }
  }
  return null;
}

/** Facts for every statement from the lexical tier. */
function lexicalFacts(statements: Tok[][]): { facts: Facts[]; error?: string } {
  const facts: Facts[] = [];
  for (const st of statements) {
    const u = unwrapExplain(st);
    if ("error" in u) return { facts, error: u.error };
    facts.push(lexFacts(u.inner));
  }
  return { facts };
}

/** Facts for every statement from the parser, cross-checked against the lexical reading. `error` means: refuse (or fall back). */
async function parsedFacts(statements: Tok[][]): Promise<{ facts: Facts[]; error?: string }> {
  const parse = await loadParser();
  const facts: Facts[] = [];
  let usedExplain = false, usedLexicalOnly = false; // statements the parser cannot read as written (EXPLAIN, CTAS, CREATE FUNCTION): no whole-script re-parse
  for (const st of statements) {
    const u = unwrapExplain(st);
    if ("error" in u) return { facts, error: u.error };
    if (u.explained) usedExplain = true;
    const lexical = lexFacts(u.inner);
    // CREATE FUNCTION is read by tokens (its body is a string the parser would not look into); it only passes through an exact grant.
    if (lexical.verb === "create-function") { usedLexicalOnly = true; facts.push(lexical); continue; }
    let nodes: unknown[];
    // CREATE TABLE x AS <query>: the parser does not read CTAS, so the head comes from the tokens and the query is parsed on its own.
    const ctas = lexical.verb === "create-table" ? ctasQuery(u.inner) : null;
    if (ctas) usedLexicalOnly = true;
    try { nodes = parse(cleanText(ctas ?? u.inner)); } catch (e) { return { facts, error: shortError(e) }; }
    if (nodes.length !== 1) return { facts, error: "The statement boundaries are ambiguous." };
    const f = ctas ? { ...astFacts(nodes[0] as Ast), verb: "create-table" as Verb, keyword: lexical.keyword, names: lexical.names, ifNotExists: lexical.ifNotExists, temporary: lexical.temporary } : astFacts(nodes[0] as Ast);
    if ((COARSE.has(f.verb) || COARSE.has(lexical.verb)) && f.verb !== lexical.verb) {
      return { facts, error: `The statement was read as ${f.verb} by the parser and ${lexical.verb} by the token reader.` };
    }
    facts.push(f);
  }
  // The whole script must read the same way as the statements one by one (a splitter that disagrees with the parser fails closed).
  if (!usedExplain && !usedLexicalOnly) {
    try {
      const all = parse(cleanText(statements.flatMap((s, i) => (i === 0 ? s : [{ kind: "punct", text: ";", start: 0, end: 0, clean: ";", gap: "" } as Tok, ...s]))));
      if (all.length !== statements.length) return { facts, error: "The statement boundaries are ambiguous." };
    } catch (e) { return { facts, error: shortError(e) }; }
  }
  return { facts };
}

const refused = (reasons: string[], statements = 0, tier: PolicyVerdict["tier"] = "none"): PolicyVerdict => ({ allowed: false, reasons, statements, tier, created: [], verbs: [] });

const PARSE_HINT = "Graded exercises only run SQL the safety checker can read completely. Rewrite it with standard syntax (for a recursive CTE, list its columns: WITH RECURSIVE r(n) AS (...)).";

function verdictOf(facts: Facts[], spec: PolicySpec, tier: PolicyVerdict["tier"]): { v: PolicyVerdict; bodies: string[] } {
  const r = evaluate(facts, spec);
  return { v: { allowed: r.reasons.length === 0, reasons: r.reasons, statements: facts.length, tier, created: r.created, verbs: facts.map((f) => f.verb) }, bodies: r.bodies };
}

async function checkBodies(bodies: string[], v: PolicyVerdict, spec: PolicySpec): Promise<PolicyVerdict> {
  if (!v.allowed) return v;
  for (const b of bodies) {
    const inner = await checkSqlPolicy(b, { level: "read-only", lexical: spec.lexical });
    if (!inner.allowed) return { ...v, allowed: false, reasons: [`The function body is not a plain query: ${inner.reasons[0]}`] };
  }
  return v;
}

/**
 * The security boundary. Asynchronous because the parser is loaded on first use (it stays out of the main bundle).
 * Nothing here runs SQL.
 */
export async function checkSqlPolicy(sql: string, policy: PolicyOption): Promise<PolicyVerdict> {
  const spec = asSpec(policy);
  const rd = readScript(sql);
  if (rd.error) return refused([`${rd.error} ${spec.level === "read-only" ? "This exercise is graded and read-only." : "This exercise is graded."}`]);
  if (!rd.statements.length) return refused(["There is no SQL statement to run."]);
  const parsed = await parsedFacts(rd.statements);
  if (!parsed.error) {
    const { v, bodies } = verdictOf(parsed.facts, spec, "parsed");
    return checkBodies(bodies, v, spec);
  }
  // Unparseable SQL: refused, except where a second, independent layer exists or the reference itself is unparseable.
  //  - read-only: the token tier below, and PostgreSQL's own READ ONLY transaction (the runner always opens it). A typo therefore
  //    still gets PostgreSQL's own error message, and nothing that could write can pass both layers.
  //  - own-tables / own-data: no database layer exists, so only exercises whose reference is itself unparseable (`spec.lexical`).
  if (spec.lexical || spec.level === "read-only") {
    const lexical = lexicalFacts(rd.statements);
    if (lexical.error) return refused([lexical.error], rd.statements.length);
    const lexicalRefusal = lexicalGate(rd.statements, lexical.facts);
    if (lexicalRefusal) return refused([lexicalRefusal], rd.statements.length, "lexical");
    const { v, bodies } = verdictOf(lexical.facts, spec, "lexical");
    return checkBodies(bodies, v, spec);
  }
  return refused([`This statement could not be checked for safety (${parsed.error}). ${PARSE_HINT}`], rd.statements.length);
}

/**
 * The lexical tier is looser about structure than a parse, so it is stricter about words: a query may not contain INSERT, UPDATE,
 * DELETE, MERGE, INTO, COPY, CALL, DO, GRANT ... as bare words at all (a quoted identifier or a string is fine).
 */
const LEXICAL_BARE_DENY = new Set(["copy", "call", "grant", "revoke", "vacuum", "lock", "reindex", "cluster", "listen", "notify", "discard", "checkpoint", "drop", "alter", "create", "truncate", "reset", "do", "begin", "commit", "rollback", "savepoint"]);
function lexicalGate(statements: Tok[][], facts: Facts[]): string | null {
  for (let s = 0; s < statements.length; s++) {
    if (facts[s].verb !== "query") continue;
    for (let i = 0; i < statements[s].length; i++) {
      const t = statements[s][i];
      if (t.kind === "word" && LEXICAL_BARE_DENY.has(t.text) && !isP(statements[s][i - 1], ".")) return `The word ${t.text.toUpperCase()} cannot appear in a query this checker reads by tokens. Quote it if it is a name.`;
    }
  }
  return null;
}

/** Same rules, token tier only and synchronous. Used by the visualizer's "is this one query" test and by tests; NOT the boundary. */
export function checkSqlPolicyLexical(sql: string, policy: PolicyOption): PolicyVerdict {
  const spec = asSpec(policy);
  const rd = readScript(sql);
  if (rd.error) return refused([rd.error]);
  if (!rd.statements.length) return refused(["There is no SQL statement to run."]);
  const lexical = lexicalFacts(rd.statements);
  if (lexical.error) return refused([lexical.error], rd.statements.length);
  const gate = lexicalGate(rd.statements, lexical.facts);
  if (gate) return refused([gate], rd.statements.length, "lexical");
  return verdictOf(lexical.facts, spec, "lexical").v;
}

/* ------------------------------------------------------------------ deriving a policy ---------------------------------- */

export interface DerivedPolicy {
  spec: PolicySpec;
  /** How the reference was read. `unreadable`: it could not be lexed either, so the strictest policy applies. */
  tier: "parsed" | "lexical" | "unreadable";
  /** Statement verbs of the reference. */
  verbs: string[];
  /** Reasons the reference itself would be refused even with every grant (should be empty). */
  problems: string[];
}

const derived = new Map<string, Promise<DerivedPolicy>>();

/**
 * The policy an exercise gets when it does not declare one: what its own reference query needs, and nothing more.
 * read-only when the reference only queries; own-tables when it creates or inserts into its own tables; own-data only when it
 * updates or deletes rows of tables it created. Statements of the reference that the strict rules would refuse (a DELETE on a
 * base table, DROP of its scratch table, SET LOCAL enable_seqscan, a CREATE INDEX on a base table) become exact grants.
 */
export function derivePolicy(referenceSql: string, protectedTables?: readonly string[]): Promise<DerivedPolicy> {
  const cacheKey = `${protectedTables?.join(",") ?? ""}\u0000${referenceSql}`;
  let p = derived.get(cacheKey);
  if (!p) { p = computeDerived(referenceSql, protectedTables); derived.set(cacheKey, p); }
  return p;
}

async function computeDerived(referenceSql: string, protectedTables?: readonly string[]): Promise<DerivedPolicy> {
  const rd = readScript(referenceSql);
  const strictest: DerivedPolicy = { spec: { level: "read-only", lexical: true, protectedTables }, tier: "unreadable", verbs: [], problems: [] };
  if (rd.error || !rd.statements.length) return { ...strictest, problems: [rd.error ?? "empty reference"] };
  let tier: DerivedPolicy["tier"] = "parsed";
  let read = await parsedFacts(rd.statements);
  if (read.error) {
    tier = "lexical";
    read = lexicalFacts(rd.statements);
    if (read.error) return { ...strictest, problems: [read.error] };
  }
  const collect: Collector = { allow: new Set(), needed: 0 };
  const r = evaluate(read.facts, { level: "own-data", protectedTables }, collect);
  const bodyProblems: string[] = [];
  for (const b of r.bodies) { const inner = await checkSqlPolicy(b, { level: "read-only", lexical: true }); if (!inner.allowed) bodyProblems.push(inner.reasons[0]); }
  const level = LEVELS[collect.needed];
  return {
    spec: { level, allow: [...collect.allow].sort(), lexical: tier === "lexical", protectedTables },
    tier,
    verbs: read.facts.map((f) => f.verb),
    problems: [...r.reasons, ...bodyProblems],
  };
}
