/**
 * Deterministic practice-data generator. The same spec + seed always produces the same SQL,
 * so a dataset can be shared as its settings. Output is plain DDL + INSERTs for PostgreSQL.
 */
import type { SchemaTable } from "../types";

export type ColumnKind = "id" | "int" | "decimal" | "text" | "first_name" | "last_name" | "email" | "city" | "country" | "date" | "boolean" | "category" | "fk";

export interface ColumnSpec {
  name: string;
  kind: ColumnKind;
  /** int/decimal range */
  min?: number;
  max?: number;
  /** date range, YYYY-MM-DD */
  from?: string;
  to?: string;
  /** category values */
  values?: string[];
  /** fk target table (its id column) */
  ref?: string;
  /** Share of rows that get NULL (0–1). Ignored for id. */
  nullRate?: number;
  /** Share of rows with a deliberately invalid value (bad email, negative number, date out of range). */
  invalidRate?: number;
  /** fk only: share of rows pointing at a parent that doesn't exist. Turns the FK constraint off. */
  orphanRate?: number;
  unique?: boolean;
}

export interface TableSpec {
  name: string;
  rows: number;
  columns: ColumnSpec[];
  /** Share of extra rows that duplicate an existing row's values (new id). */
  duplicateRate?: number;
}

export interface DatasetSpec {
  title: string;
  seed: number;
  tables: TableSpec[];
}

export type Difficulty = "clean" | "realistic" | "messy";
export const DIFFICULTY: Record<Difficulty, { nullRate: number; duplicateRate: number; orphanRate: number; invalidRate: number; label: string }> = {
  clean: { nullRate: 0, duplicateRate: 0, orphanRate: 0, invalidRate: 0, label: "Clean — no quirks" },
  realistic: { nullRate: 0.05, duplicateRate: 0.02, orphanRate: 0, invalidRate: 0.01, label: "Realistic — a few NULLs and duplicates" },
  messy: { nullRate: 0.15, duplicateRate: 0.06, orphanRate: 0.05, invalidRate: 0.04, label: "Messy — NULLs, duplicates, orphans, invalid values" },
};

export const MAX_ROWS_PER_TABLE = 5000;

const FIRST = ["Aarav", "Ana", "Ben", "Chen", "Diya", "Elena", "Femi", "Grace", "Hiro", "Isla", "Jon", "Kavya", "Liam", "Maya", "Noah", "Olga", "Priya", "Quinn", "Ravi", "Sara", "Tom", "Uma", "Vik", "Wei", "Yara", "Zoe"];
const LAST = ["Acharya", "Brown", "Costa", "Dubois", "Evans", "Fischer", "Garcia", "Hansen", "Iyer", "Jones", "Kim", "Lopez", "Muller", "Nair", "Okafor", "Patel", "Rossi", "Silva", "Tanaka", "Wright"];
const CITIES = ["Bengaluru", "Berlin", "Chicago", "Lisbon", "London", "Madrid", "Mumbai", "Osaka", "Paris", "Pune", "São Paulo", "Sydney", "Toronto", "Warsaw"];
const COUNTRIES = ["Brazil", "Canada", "France", "Germany", "India", "Japan", "Poland", "Portugal", "Spain", "UK", "USA"];
const WORDS = ["alpha", "beta", "delta", "lumen", "nova", "orbit", "pixel", "quartz", "sierra", "terra", "vector", "zen"];

/** mulberry32: small, fast, deterministic. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ident = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^([0-9])/, "_$1").slice(0, 40) || "col";
const lit = (v: unknown) =>
  v === null ? "NULL" : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : `'${String(v).replace(/'/g, "''")}'`;

function sqlType(c: ColumnSpec): string {
  switch (c.kind) {
    case "id":
    case "int":
    case "fk":
      return "integer";
    case "decimal":
      return "numeric(12,2)";
    case "date":
      return "date";
    case "boolean":
      return "boolean";
    default:
      return "text";
  }
}

/** Validate a spec; returns human-readable problems (empty = OK). */
export function validateSpec(spec: DatasetSpec): string[] {
  const errs: string[] = [];
  const names = new Set<string>();
  if (!spec.tables.length) errs.push("Add at least one table.");
  for (const t of spec.tables) {
    const tn = ident(t.name);
    if (names.has(tn)) errs.push(`Duplicate table name "${tn}".`);
    names.add(tn);
    if (t.rows < 1 || t.rows > MAX_ROWS_PER_TABLE) errs.push(`${tn}: rows must be between 1 and ${MAX_ROWS_PER_TABLE}.`);
    const cols = new Set<string>();
    if (t.columns.filter((c) => c.kind === "id").length !== 1) errs.push(`${tn}: needs exactly one id (primary key) column.`);
    for (const c of t.columns) {
      const cn = ident(c.name);
      if (cols.has(cn)) errs.push(`${tn}: duplicate column "${cn}".`);
      cols.add(cn);
      if (c.kind === "fk") {
        const target = spec.tables.find((x) => ident(x.name) === ident(c.ref ?? ""));
        if (!target) errs.push(`${tn}.${cn}: references unknown table "${c.ref ?? ""}".`);
        else if (spec.tables.indexOf(target) >= spec.tables.indexOf(t)) errs.push(`${tn}.${cn}: "${ident(c.ref!)}" must be defined before "${tn}".`);
      }
      if (c.kind === "category" && !(c.values ?? []).filter(Boolean).length) errs.push(`${tn}.${cn}: list at least one category value.`);
    }
  }
  return errs;
}

export interface Generated {
  sql: string;
  tables: { name: string; columns: string[]; rows: unknown[][] }[];
  schema: SchemaTable[];
  notes: string[];
}

export function generate(spec: DatasetSpec): Generated {
  const r = rng(spec.seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const int = (min: number, max: number) => Math.floor(min + r() * (max - min + 1));
  const out: Generated = { sql: "", tables: [], schema: [], notes: [] };
  const ids = new Map<string, number>(); // table → row count (ids are 1..n)
  const ddl: string[] = [];
  const inserts: string[] = [];

  for (const t of spec.tables) {
    const tn = ident(t.name);
    const cols = t.columns.map((c) => ({ ...c, name: ident(c.name) }));
    const defs = cols.map((c) => {
      let d = `  ${c.name} ${sqlType(c)}`;
      if (c.kind === "id") d += " PRIMARY KEY";
      else if (!c.nullRate) d += " NOT NULL";
      if (c.unique && c.kind !== "id") d += " UNIQUE";
      if (c.kind === "fk" && !c.orphanRate) d += ` REFERENCES ${ident(c.ref!)}(${ident(spec.tables.find((x) => ident(x.name) === ident(c.ref!))!.columns.find((k) => k.kind === "id")!.name)})`;
      return d;
    });
    ddl.push(`CREATE TABLE ${tn} (\n${defs.join(",\n")}\n);`);
    for (const c of cols) {
      if (c.kind === "fk" && c.orphanRate) out.notes.push(`${tn}.${c.name}: ~${Math.round(c.orphanRate * 100)}% of rows point to a missing ${ident(c.ref!)} row, so it has no FOREIGN KEY constraint.`);
      if (c.nullRate) out.notes.push(`${tn}.${c.name}: ~${Math.round(c.nullRate * 100)}% NULL.`);
      if (c.invalidRate) out.notes.push(`${tn}.${c.name}: ~${Math.round(c.invalidRate * 100)}% deliberately invalid values.`);
    }

    const base = Math.max(1, Math.round(t.rows));
    const dupes = Math.round(base * (t.duplicateRate ?? 0));
    const rows: unknown[][] = [];
    const seen = new Map<string, Set<string>>();
    for (let i = 1; i <= base; i++) {
      rows.push(
        cols.map((c) => {
          if (c.kind === "id") return i;
          if (c.nullRate && r() < c.nullRate) return null;
          const invalid = c.invalidRate ? r() < c.invalidRate : false;
          let v: unknown;
          switch (c.kind) {
            case "int":
              v = invalid ? -int(1, 100) : int(c.min ?? 0, c.max ?? 1000);
              break;
            case "decimal":
              v = invalid ? -Math.round(r() * 10000) / 100 : Math.round((c.min ?? 0) * 100 + r() * ((c.max ?? 1000) - (c.min ?? 0)) * 100) / 100;
              break;
            case "first_name":
              v = pick(FIRST);
              break;
            case "last_name":
              v = pick(LAST);
              break;
            case "email":
              v = invalid ? `${pick(FIRST).toLowerCase()}.example.com` : `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${i}@example.com`;
              break;
            case "city":
              v = pick(CITIES);
              break;
            case "country":
              v = pick(COUNTRIES);
              break;
            case "date": {
              const a = Date.parse(`${c.from ?? "2024-01-01"}T00:00:00Z`);
              const b = Date.parse(`${c.to ?? "2025-12-31"}T00:00:00Z`);
              const d = invalid ? new Date(b + int(30, 400) * 86_400_000) : new Date(a + Math.floor(r() * (b - a + 86_400_000) / 86_400_000) * 86_400_000);
              v = d.toISOString().slice(0, 10);
              break;
            }
            case "boolean":
              v = r() < 0.5;
              break;
            case "category":
              v = pick((c.values ?? ["a"]).filter(Boolean));
              break;
            case "fk": {
              const n = ids.get(ident(c.ref!)) ?? 1;
              v = c.orphanRate && r() < c.orphanRate ? n + int(1, 50) : int(1, n);
              break;
            }
            default:
              v = `${pick(WORDS)} ${pick(WORDS)}`;
          }
          if (c.unique) {
            const set = seen.get(c.name) ?? new Set<string>();
            while (set.has(String(v))) v = `${v}-${int(1, 9999)}`;
            set.add(String(v));
            seen.set(c.name, set);
          }
          return v;
        }),
      );
    }
    // Duplicates: copy every non-id value of an existing row (unique columns get a suffix).
    for (let k = 0; k < dupes; k++) {
      const src = rows[int(0, base - 1)];
      rows.push(cols.map((c, j) => (c.kind === "id" ? rows.length + 1 : c.unique ? `${src[j]}-dup${k}` : src[j])));
    }
    if (dupes) out.notes.push(`${tn}: ${dupes} duplicate row(s) — same values, different ${cols.find((c) => c.kind === "id")!.name}.`);
    ids.set(tn, rows.length);

    for (let i = 0; i < rows.length; i += 500) {
      inserts.push(`INSERT INTO ${tn} (${cols.map((c) => c.name).join(", ")}) VALUES\n${rows.slice(i, i + 500).map((row) => `(${row.map(lit).join(", ")})`).join(",\n")};`);
    }
    out.tables.push({ name: tn, columns: cols.map((c) => c.name), rows });
    out.schema.push({
      name: tn,
      columns: cols.map((c) => ({
        name: c.name,
        type: sqlType(c),
        pk: c.kind === "id",
        notNull: c.kind === "id" || !c.nullRate,
        fk: c.kind === "fk" ? { table: ident(c.ref!), column: ident(spec.tables.find((x) => ident(x.name) === ident(c.ref!))!.columns.find((k) => k.kind === "id")!.name) } : null,
      })),
    });
  }

  out.sql = [`-- ${spec.title} (generated, seed ${spec.seed})`, ...ddl, ...inserts].join("\n\n") + "\n";
  return out;
}

/** Ready-made starting points. Difficulty settings are applied on top. */
export const TEMPLATES: { id: string; label: string; spec: (d: Difficulty) => DatasetSpec }[] = [
  {
    id: "shop",
    label: "Customers & orders",
    spec: (d) => {
      const q = DIFFICULTY[d];
      return {
        title: "Customers & orders",
        seed: 42,
        tables: [
          { name: "customers", rows: 200, duplicateRate: q.duplicateRate, columns: [
            { name: "customer_id", kind: "id" }, { name: "first_name", kind: "first_name" }, { name: "last_name", kind: "last_name" },
            { name: "email", kind: "email", nullRate: q.nullRate, invalidRate: q.invalidRate }, { name: "city", kind: "city", nullRate: q.nullRate },
            { name: "signup_date", kind: "date", from: "2024-01-01", to: "2025-06-30" },
          ] },
          { name: "orders", rows: 800, duplicateRate: q.duplicateRate, columns: [
            { name: "order_id", kind: "id" }, { name: "customer_id", kind: "fk", ref: "customers", orphanRate: q.orphanRate },
            { name: "order_date", kind: "date", from: "2024-02-01", to: "2025-12-31", invalidRate: q.invalidRate },
            { name: "status", kind: "category", values: ["placed", "shipped", "delivered", "cancelled", "returned"] },
            { name: "amount", kind: "decimal", min: 5, max: 900, invalidRate: q.invalidRate },
          ] },
        ],
      };
    },
  },
  {
    id: "hr",
    label: "Departments & employees",
    spec: (d) => {
      const q = DIFFICULTY[d];
      return {
        title: "Departments & employees",
        seed: 7,
        tables: [
          { name: "departments", rows: 8, columns: [{ name: "department_id", kind: "id" }, { name: "name", kind: "category", values: ["Sales", "Engineering", "Finance", "HR", "Support", "Marketing", "Legal", "Ops"] }, { name: "city", kind: "city" }] },
          { name: "employees", rows: 300, duplicateRate: q.duplicateRate, columns: [
            { name: "employee_id", kind: "id" }, { name: "first_name", kind: "first_name" }, { name: "last_name", kind: "last_name" },
            { name: "department_id", kind: "fk", ref: "departments", nullRate: q.nullRate, orphanRate: q.orphanRate },
            { name: "salary", kind: "decimal", min: 30000, max: 180000, invalidRate: q.invalidRate }, { name: "hire_date", kind: "date", from: "2015-01-01", to: "2025-12-31" },
            { name: "is_active", kind: "boolean" },
          ] },
        ],
      };
    },
  },
  {
    id: "school",
    label: "Students, courses & enrolments",
    spec: (d) => {
      const q = DIFFICULTY[d];
      return {
        title: "Students & courses",
        seed: 2025,
        tables: [
          { name: "students", rows: 150, columns: [{ name: "student_id", kind: "id" }, { name: "first_name", kind: "first_name" }, { name: "last_name", kind: "last_name" }, { name: "country", kind: "country", nullRate: q.nullRate }] },
          { name: "courses", rows: 12, columns: [{ name: "course_id", kind: "id" }, { name: "title", kind: "text", unique: true }, { name: "credits", kind: "int", min: 1, max: 6 }] },
          { name: "enrolments", rows: 500, duplicateRate: q.duplicateRate, columns: [
            { name: "enrolment_id", kind: "id" }, { name: "student_id", kind: "fk", ref: "students", orphanRate: q.orphanRate }, { name: "course_id", kind: "fk", ref: "courses" },
            { name: "grade", kind: "int", min: 40, max: 100, nullRate: q.nullRate }, { name: "enrolled_on", kind: "date", from: "2024-09-01", to: "2025-09-30" },
          ] },
        ],
      };
    },
  },
];
