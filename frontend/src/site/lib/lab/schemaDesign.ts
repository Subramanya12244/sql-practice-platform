/**
 * Relational design toolkit: a schema model, validation, PostgreSQL DDL, relationship detection,
 * and the classic normalization algorithms (attribute closure, candidate keys, normal forms,
 * lossless-join chase, dependency preservation). All pure and exact, so exercises are checked
 * deterministically rather than by pattern matching.
 */
import type { SchemaTable } from "../../types";

export interface Col { name: string; type: string; pk: boolean; notNull: boolean; unique: boolean; fk: { table: string; column: string } | null }
export interface Tbl { name: string; columns: Col[]; indexes: { columns: string[]; unique?: boolean }[] }
export interface Schema { tables: Tbl[] }

export const TYPES = ["integer", "bigint", "text", "varchar(100)", "numeric(10,2)", "boolean", "date", "timestamp"] as const;
const RESERVED = new Set(["user", "order", "group", "table", "select", "from", "where", "index", "column", "primary", "key", "check", "default", "limit", "offset", "end", "all", "and", "or", "not", "null", "references", "constraint", "grant", "desc", "asc"]);
const IDENT = /^[a-z_][a-z0-9_]*$/;
const baseType = (t: string) => t.replace(/\(.*\)/, "").toLowerCase();
const familyOf = (t: string) => (["integer", "bigint", "smallint"].includes(baseType(t)) ? "int" : ["text", "varchar", "char"].includes(baseType(t)) ? "text" : baseType(t));

export const newColumn = (name = "", type = "integer"): Col => ({ name, type, pk: false, notNull: false, unique: false, fk: null });
export const emptySchema = (): Schema => ({ tables: [] });

export interface Issue { level: "error" | "warn"; text: string }

export function validateSchema(s: Schema): Issue[] {
  const out: Issue[] = [];
  const err = (text: string) => out.push({ level: "error", text });
  const warn = (text: string) => out.push({ level: "warn", text });
  const names = s.tables.map((t) => t.name);
  for (const t of s.tables) {
    if (!IDENT.test(t.name)) err(`"${t.name}" is not a valid table name. Use lowercase letters, digits and underscores, starting with a letter.`);
    else if (RESERVED.has(t.name)) err(`"${t.name}" is a reserved word in SQL. Pick another table name, for example "${t.name}s" or "app_${t.name}".`);
    if (names.filter((n) => n === t.name).length > 1) err(`Two tables are called "${t.name}".`);
    if (!t.columns.length) err(`Table "${t.name}" has no columns.`);
    const cn = t.columns.map((c) => c.name);
    for (const c of t.columns) {
      if (!IDENT.test(c.name)) err(`"${t.name}.${c.name}" is not a valid column name.`);
      else if (RESERVED.has(c.name)) err(`"${t.name}.${c.name}" is a reserved word.`);
      if (cn.filter((n) => n === c.name).length > 1) err(`Table "${t.name}" has two columns called "${c.name}".`);
      if (c.fk) {
        const target = s.tables.find((x) => x.name === c.fk!.table);
        const tc = target?.columns.find((x) => x.name === c.fk!.column);
        if (!target) err(`${t.name}.${c.name} references table "${c.fk.table}", which does not exist.`);
        else if (!tc) err(`${t.name}.${c.name} references "${c.fk.table}.${c.fk.column}", which does not exist.`);
        else {
          const single = target.columns.filter((x) => x.pk).length === 1 && tc.pk;
          if (!(single || tc.unique)) err(`${t.name}.${c.name} must reference a primary key or unique column; "${c.fk.table}.${c.fk.column}" is neither.`);
          if (familyOf(tc.type) !== familyOf(c.type)) err(`${t.name}.${c.name} is ${c.type} but "${c.fk.table}.${c.fk.column}" is ${tc.type}. Foreign keys must use the same type as the key they point to.`);
        }
      }
    }
    if (t.columns.length && !t.columns.some((c) => c.pk)) err(`Table "${t.name}" has no primary key. Every row needs a way to be identified.`);
    for (const c of t.columns) if (c.pk && c.fk === null && /^(text|varchar)/.test(c.type) && c.name !== "code") warn(`${t.name}.${c.name} is a text primary key. A short integer key is usually faster and simpler to reference.`);
  }
  if (!out.some((i) => i.level === "error") && tableOrder(s) === null) err("Tables reference each other in a circle. Break the loop (for example make one of the foreign keys nullable and add it later).");
  return out;
}

/** Tables in creation order (referenced tables first), or null on a cycle. Self-references are allowed. */
export function tableOrder(s: Schema): string[] | null {
  const deps = new Map(s.tables.map((t) => [t.name, new Set(t.columns.flatMap((c) => (c.fk && c.fk.table !== t.name && s.tables.some((x) => x.name === c.fk!.table) ? [c.fk.table] : [])))]));
  const out: string[] = [];
  const rest = new Set(s.tables.map((t) => t.name));
  while (rest.size) {
    const ready = [...rest].filter((n) => [...deps.get(n)!].every((d) => !rest.has(d)));
    if (!ready.length) return null;
    ready.sort().forEach((n) => { out.push(n); rest.delete(n); });
  }
  return out;
}

export function toDdl(s: Schema): string {
  const order = tableOrder(s) ?? s.tables.map((t) => t.name);
  const parts: string[] = [];
  for (const name of order) {
    const t = s.tables.find((x) => x.name === name)!;
    const pks = t.columns.filter((c) => c.pk).map((c) => c.name);
    const lines = t.columns.map((c) => `  ${c.name} ${c.type}${c.notNull || c.pk ? " NOT NULL" : ""}${c.unique && !c.pk ? " UNIQUE" : ""}`);
    if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(", ")})`);
    for (const c of t.columns) if (c.fk) lines.push(`  FOREIGN KEY (${c.name}) REFERENCES ${c.fk.table} (${c.fk.column})`);
    parts.push(`CREATE TABLE ${t.name} (\n${lines.join(",\n")}\n);`);
    for (const ix of t.indexes) parts.push(`CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${t.name}_${ix.columns.join("_")}_idx ON ${t.name} (${ix.columns.join(", ")});`);
  }
  return parts.join("\n\n");
}

export type Cardinality = "1:1" | "1:N" | "N:M";
export interface Relationship { from: string; to: string; via: string; cardinality: Cardinality; text: string }

/** Relationships implied by the foreign keys. A table whose primary key is two foreign keys is a junction (N:M). */
export function relationships(s: Schema): Relationship[] {
  const out: Relationship[] = [];
  for (const t of s.tables) {
    const fks = t.columns.filter((c) => c.fk && s.tables.some((x) => x.name === c.fk!.table));
    const pkCols = t.columns.filter((c) => c.pk);
    if (fks.length === 2 && pkCols.length === 2 && pkCols.every((c) => c.fk) && t.columns.length === fks.length + t.columns.filter((c) => !c.fk).length) {
      out.push({ from: fks[0].fk!.table, to: fks[1].fk!.table, via: t.name, cardinality: "N:M", text: `${fks[0].fk!.table} and ${fks[1].fk!.table} are many-to-many through ${t.name}.` });
      continue;
    }
    for (const c of fks) {
      const oneToOne = c.unique || (pkCols.length === 1 && c.pk);
      out.push({ from: c.fk!.table, to: t.name, via: `${t.name}.${c.name}`, cardinality: oneToOne ? "1:1" : "1:N", text: oneToOne ? `Each ${c.fk!.table} row has at most one ${t.name} row.` : `One ${c.fk!.table} row can have many ${t.name} rows.` });
    }
  }
  return out;
}

export const toSchemaTables = (s: Schema): SchemaTable[] => s.tables.map((t) => ({ name: t.name, columns: t.columns.map((c) => ({ name: c.name, type: c.type, pk: c.pk, notNull: c.notNull || c.pk, fk: c.fk })) }));

// ── Functional dependencies and normal forms ─────────────────────────────
export interface FD { lhs: string[]; rhs: string[] }
const uniq = (xs: string[]) => [...new Set(xs)].sort();
const subset = (a: string[], b: string[]) => a.every((x) => b.includes(x));

/** Parse "a, b -> c, d" lines. Returns the FDs and any lines that could not be read. */
export function parseFds(text: string): { fds: FD[]; errors: string[] } {
  const fds: FD[] = [], errors: string[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(.+?)\s*(?:->|→)\s*(.+)$/);
    if (!m) { errors.push(`Could not read "${line}". Write it like: order_id -> customer_id, order_date`); continue; }
    const split = (x: string) => uniq(x.split(",").map((s) => s.trim()).filter(Boolean));
    fds.push({ lhs: split(m[1]), rhs: split(m[2]) });
  }
  return { fds, errors };
}

/** Everything that attrs determine, directly or through other dependencies. */
export function closure(attrs: string[], fds: FD[]): string[] {
  const out = new Set(attrs);
  for (let changed = true; changed;) {
    changed = false;
    for (const f of fds) if (f.lhs.every((a) => out.has(a)) && f.rhs.some((a) => !out.has(a))) { f.rhs.forEach((a) => out.add(a)); changed = true; }
  }
  return uniq([...out]);
}

/** Minimal candidate keys (smallest attribute sets whose closure is every attribute). */
export function candidateKeys(attrs: string[], fds: FD[]): string[][] {
  const all = uniq(attrs);
  const must = all.filter((a) => !fds.some((f) => f.rhs.includes(a) && !f.lhs.includes(a)));
  const may = all.filter((a) => !must.includes(a));
  const keys: string[][] = [];
  const n = may.length;
  const sizes = Array.from({ length: n + 1 }, (_, k) => k);
  for (const k of sizes) {
    for (let mask = 0; mask < 1 << n; mask++) {
      if (mask.toString(2).replace(/0/g, "").length !== k) continue;
      const cand = uniq([...must, ...may.filter((_, i) => mask & (1 << i))]);
      if (keys.some((key) => subset(key, cand))) continue;
      if (subset(all, closure(cand, fds))) keys.push(cand);
    }
  }
  return keys;
}

/** FDs restricted to a sub-relation: X -> A for every X within attrs whose closure contains A. */
function projectFds(attrs: string[], fds: FD[]): FD[] {
  const out: FD[] = [];
  const n = attrs.length;
  if (n > 10) return fds.filter((f) => subset(f.lhs, attrs)).map((f) => ({ lhs: f.lhs, rhs: f.rhs.filter((a) => attrs.includes(a)) })).filter((f) => f.rhs.length);
  for (let mask = 1; mask < 1 << n; mask++) {
    const x = attrs.filter((_, i) => mask & (1 << i));
    const rhs = closure(x, fds).filter((a) => attrs.includes(a) && !x.includes(a));
    if (rhs.length) out.push({ lhs: x, rhs });
  }
  return out;
}

export type NormalForm = "1NF" | "2NF" | "3NF" | "BCNF";
const RANK: Record<NormalForm, number> = { "1NF": 1, "2NF": 2, "3NF": 3, BCNF: 4 };
export const atLeast = (have: NormalForm, want: NormalForm) => RANK[have] >= RANK[want];

/** Highest normal form of a relation (atomic values assumed, so at least 1NF) under the given FDs. */
export function normalForm(attrs: string[], fds: FD[]): NormalForm {
  const local = projectFds(uniq(attrs), fds);
  const keys = candidateKeys(attrs, local);
  const prime = new Set(keys.flat());
  const isSuper = (x: string[]) => subset(uniq(attrs), closure(x, local));
  const nontrivial = local.flatMap((f) => f.rhs.filter((a) => !f.lhs.includes(a)).map((a) => ({ lhs: f.lhs, a })));
  if (nontrivial.every((f) => isSuper(f.lhs))) return "BCNF";
  if (nontrivial.every((f) => isSuper(f.lhs) || prime.has(f.a))) return "3NF";
  const partial = nontrivial.some((f) => !prime.has(f.a) && keys.some((k) => k.length > 1 && subset(f.lhs, k) && f.lhs.length < k.length));
  return partial ? "1NF" : "2NF";
}

/** Chase test: does joining the parts always give back the original rows? */
export function isLossless(attrs: string[], parts: string[][], fds: FD[]): boolean {
  const all = uniq(attrs);
  const table = parts.map((p) => Object.fromEntries(all.map((a) => [a, p.includes(a) ? "a" : `b${parts.indexOf(p)}`])));
  for (let changed = true; changed;) {
    changed = false;
    for (const f of fds) for (let i = 0; i < table.length; i++) for (let j = i + 1; j < table.length; j++) {
      if (!f.lhs.every((a) => table[i][a] === table[j][a])) continue;
      for (const a of f.rhs) {
        if (table[i][a] === table[j][a]) continue;
        const keep = table[i][a] === "a" ? "a" : table[j][a] === "a" ? "a" : table[i][a];
        const from = [table[i][a], table[j][a]];
        for (const row of table) if (from.includes(row[a])) row[a] = keep;
        changed = true;
      }
    }
  }
  return table.some((row) => all.every((a) => row[a] === "a"));
}

/** Does every original dependency still hold inside some part (or follow from those that do)? */
export function preservesDependencies(parts: string[][], fds: FD[]): boolean {
  const local = parts.flatMap((p) => projectFds(uniq(p), fds));
  return fds.every((f) => subset(f.rhs, closure(f.lhs, local)));
}

export interface DecompositionCheck { ok: boolean; messages: string[]; forms: { part: string[]; form: NormalForm }[] }

export function checkDecomposition(attrs: string[], parts: string[][], fds: FD[], target: NormalForm): DecompositionCheck {
  const messages: string[] = [];
  const all = uniq(attrs);
  const used = uniq(parts.flat());
  const unknown = used.filter((a) => !all.includes(a));
  if (unknown.length) messages.push(`These columns are not in the original table: ${unknown.join(", ")}.`);
  const missing = all.filter((a) => !used.includes(a));
  if (missing.length) messages.push(`These columns are lost in your design: ${missing.join(", ")}. Every column must appear in at least one table.`);
  const forms = parts.map((p) => ({ part: uniq(p), form: normalForm(p, fds) }));
  for (const f of forms) if (!atLeast(f.form, target)) messages.push(`Table (${f.part.join(", ")}) is only in ${f.form}; it needs to be in ${target}.`);
  if (!unknown.length && !missing.length) {
    if (!isLossless(all, parts, fds)) messages.push("Joining your tables back together can create rows that were never in the original (the split is lossy). Keep a shared key in both tables.");
    if (target !== "2NF" && !preservesDependencies(parts, fds)) messages.push("Some dependency is no longer enforced inside a single table. Keep the columns of each dependency together.");
  }
  if (parts.length < 2 && !messages.length) messages.push("Split the data into at least two tables.");
  return { ok: messages.length === 0, messages, forms };
}
