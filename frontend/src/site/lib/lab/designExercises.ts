/**
 * Design exercises, each checked by an exact algorithm (see schemaDesign.ts), never by matching
 * the learner's text against an answer. Every exercise has a worked solution that the tests run
 * through the checker, and a starting point the checker must reject.
 */
import { atLeast, checkDecomposition, emptySchema, newColumn, parseFds, relationships, validateSchema, type Cardinality, type Col, type NormalForm, type Schema } from "./schemaDesign";

export type Concept = "1NF" | "2NF" | "3NF" | "Primary and foreign keys" | "One-to-one" | "One-to-many" | "Many-to-many";

export interface PickExercise {
  kind: "pick-columns"; id: string; concept: Concept; title: string; prompt: string;
  columns: string[]; rows: Record<string, string>[]; answer: string[]; explain: string;
}
export interface DecomposeExercise {
  kind: "decompose"; id: string; concept: Concept; title: string; prompt: string;
  attrs: string[]; fdText: string; target: NormalForm; solution: string[][]; explain: string;
}
export interface DesignExercise {
  kind: "design"; id: string; concept: Concept; title: string; prompt: string;
  starter: Schema; expect: { from: string; to: string; cardinality: Cardinality }; solution: Schema; explain: string;
}
export type Exercise = PickExercise | DecomposeExercise | DesignExercise;

const c = (name: string, type = "integer", o: Partial<Col> = {}): Col => ({ ...newColumn(name, type), ...o });
const table = (name: string, columns: Col[]) => ({ name, columns, indexes: [] });

export const EXERCISES: Exercise[] = [
  {
    kind: "pick-columns", id: "1nf-phones", concept: "1NF", title: "Spot the repeating group",
    prompt: "First normal form means every cell holds one value. Which column(s) break that rule?",
    columns: ["student_id", "name", "phones", "email"],
    rows: [{ student_id: "1", name: "Asha", phones: "555-0101, 555-0102", email: "asha@x.org" }, { student_id: "2", name: "Ben", phones: "555-0199", email: "ben@x.org" }],
    answer: ["phones"],
    explain: "phones stores a list in one cell, so you cannot search or constrain a single number. Move phones to their own table with one row per number and a foreign key back to the student.",
  },
  {
    kind: "pick-columns", id: "1nf-items", concept: "1NF", title: "An order with its items in one cell",
    prompt: "Which column(s) break first normal form?",
    columns: ["order_id", "customer", "items", "total"],
    rows: [{ order_id: "9", customer: "Chen", items: "pen x2; ink x1; paper x5", total: "31.50" }],
    answer: ["items"],
    explain: "items packs several products and quantities into one text value. An order_items table with one row per product fixes it and lets you total, filter and join.",
  },
  {
    kind: "decompose", id: "2nf-lines", concept: "2NF", title: "Remove a partial dependency",
    prompt: "order_lines has the key (order_id, product_id). Some columns depend on only part of it. Split the table so every table is in 2NF without losing information. Write one table per line, as comma separated columns.",
    attrs: ["order_id", "product_id", "product_name", "qty", "customer_name"],
    fdText: "order_id, product_id -> qty\nproduct_id -> product_name\norder_id -> customer_name", target: "2NF",
    solution: [["order_id", "product_id", "qty"], ["product_id", "product_name"], ["order_id", "customer_name"]],
    explain: "product_name depends only on product_id and customer_name only on order_id: partial dependencies. Each moves to a table keyed by what it really depends on. The original three-part key remains in order_lines.",
  },
  {
    kind: "decompose", id: "3nf-dept", concept: "3NF", title: "Remove a transitive dependency",
    prompt: "employees repeats the department name and location on every row. Split it into tables in 3NF that keep every dependency. One table per line.",
    attrs: ["emp_id", "emp_name", "dept_id", "dept_name", "dept_location"],
    fdText: "emp_id -> emp_name, dept_id\ndept_id -> dept_name, dept_location", target: "3NF",
    solution: [["emp_id", "emp_name", "dept_id"], ["dept_id", "dept_name", "dept_location"]],
    explain: "dept_name and dept_location depend on dept_id, which depends on emp_id: a transitive dependency. Moving the department facts to a departments table stores each once, and dept_id stays as the foreign key.",
  },
  {
    kind: "design", id: "rel-1n", concept: "One-to-many", title: "A customer has many orders",
    prompt: "Design customers and orders so an order always belongs to exactly one customer, and the database refuses an order for a customer that does not exist.",
    starter: { tables: [table("customers", [c("customer_id", "integer", { pk: true }), c("name", "text")]), table("orders", [c("order_id", "integer", { pk: true }), c("order_date", "date")])] },
    expect: { from: "customers", to: "orders", cardinality: "1:N" },
    solution: { tables: [table("customers", [c("customer_id", "integer", { pk: true }), c("name", "text")]), table("orders", [c("order_id", "integer", { pk: true }), c("customer_id", "integer", { notNull: true, fk: { table: "customers", column: "customer_id" } }), c("order_date", "date")])] },
    explain: "The foreign key goes on the many side (orders). Declaring it as a real FOREIGN KEY is what lets PostgreSQL reject an orphan order, which is referential integrity.",
  },
  {
    kind: "design", id: "rel-11", concept: "One-to-one", title: "A user has one profile",
    prompt: "Add a user_profiles table so each user has at most one profile row. Make the database enforce the 'at most one'.",
    starter: { tables: [table("users", [c("user_id", "integer", { pk: true }), c("email", "text")]), table("user_profiles", [c("profile_id", "integer", { pk: true }), c("bio", "text")])] },
    expect: { from: "users", to: "user_profiles", cardinality: "1:1" },
    solution: { tables: [table("users", [c("user_id", "integer", { pk: true }), c("email", "text")]), table("user_profiles", [c("profile_id", "integer", { pk: true }), c("user_id", "integer", { notNull: true, unique: true, fk: { table: "users", column: "user_id" } }), c("bio", "text")])] },
    explain: "A foreign key alone allows many profiles per user. Adding UNIQUE on the foreign key column (or making it the primary key) limits it to one.",
  },
  {
    kind: "design", id: "rel-nm", concept: "Many-to-many", title: "Students and courses",
    prompt: "A student can take many courses and a course has many students. Add the table that links them, with a primary key that stops the same student enrolling twice in the same course.",
    starter: { tables: [table("students", [c("student_id", "integer", { pk: true }), c("name", "text")]), table("courses", [c("course_id", "integer", { pk: true }), c("title", "text")])] },
    expect: { from: "students", to: "courses", cardinality: "N:M" },
    solution: { tables: [table("students", [c("student_id", "integer", { pk: true }), c("name", "text")]), table("courses", [c("course_id", "integer", { pk: true }), c("title", "text")]), table("enrollments", [c("student_id", "integer", { pk: true, fk: { table: "students", column: "student_id" } }), c("course_id", "integer", { pk: true, fk: { table: "courses", column: "course_id" } })])] },
    explain: "Many-to-many needs a junction table. Its primary key combines both foreign keys, so each pair can appear only once.",
  },
];

export interface CheckResult { ok: boolean; messages: string[] }

export function checkPick(e: PickExercise, chosen: string[]): CheckResult {
  const missing = e.answer.filter((a) => !chosen.includes(a)), extra = chosen.filter((a) => !e.answer.includes(a));
  if (!missing.length && !extra.length) return { ok: true, messages: [] };
  return { ok: false, messages: [...(extra.length ? [`${extra.join(", ")} ${extra.length === 1 ? "holds" : "hold"} one value per cell already.`] : []), ...(missing.length ? ["A column that stores several values in one cell is still missing."] : [])] };
}

/** Parse the learner's "one table per line" answer. */
export const parseParts = (text: string): string[][] => text.split("\n").map((l) => l.split(",").map((x) => x.trim()).filter(Boolean)).filter((p) => p.length);

export function checkDecompose(e: DecomposeExercise, text: string): CheckResult {
  const parts = parseParts(text);
  if (!parts.length) return { ok: false, messages: ["Write at least two tables, one per line."] };
  const { fds } = parseFds(e.fdText);
  const r = checkDecomposition(e.attrs, parts, fds, e.target);
  return { ok: r.ok, messages: r.messages };
}

export function checkDesign(e: DesignExercise, schema: Schema): CheckResult {
  const problems = validateSchema(schema).filter((i) => i.level === "error").map((i) => i.text);
  if (problems.length) return { ok: false, messages: problems };
  const rel = relationships(schema).find((r) => r.cardinality === e.expect.cardinality && ((r.from === e.expect.from && r.to === e.expect.to) || (e.expect.cardinality === "N:M" && r.from === e.expect.to && r.to === e.expect.from)));
  if (rel) return { ok: true, messages: [] };
  const found = relationships(schema).filter((r) => (r.from === e.expect.from && r.to === e.expect.to) || (r.from === e.expect.to && r.to === e.expect.from));
  const hint: Record<Cardinality, string> = {
    "1:N": `Add a foreign key from ${e.expect.to} to ${e.expect.from}.`,
    "1:1": `Add a foreign key from ${e.expect.to} to ${e.expect.from} and mark it UNIQUE.`,
    "N:M": `Add a table with a foreign key to each of ${e.expect.from} and ${e.expect.to}, and make the two columns its primary key.`,
  };
  return { ok: false, messages: [found.length ? `Right tables, but the relationship is ${found[0].cardinality}, not ${e.expect.cardinality}. ${hint[e.expect.cardinality]}` : hint[e.expect.cardinality]] };
}

export const concepts = (): Concept[] => [...new Set(EXERCISES.map((e) => e.concept))];
export { atLeast, emptySchema };

// ── Index demonstration (runs on PostgreSQL in the browser) ───────────────
export const INDEX_DEMO = {
  setup: `CREATE TABLE events (id integer PRIMARY KEY, user_id integer NOT NULL, kind text NOT NULL);
INSERT INTO events SELECT g, (g * 7919) % 20000, CASE WHEN g % 10 = 0 THEN 'purchase' ELSE 'view' END FROM generate_series(1, 40000) g;
ANALYZE events;`,
  query: "SELECT * FROM events WHERE user_id = 4242",
  createIndex: "CREATE INDEX events_user_id_idx ON events (user_id)",
  explain: (q: string) => `EXPLAIN (FORMAT JSON) ${q}`,
};

/** The top plan node type from EXPLAIN (FORMAT JSON) output, e.g. "Seq Scan" or "Bitmap Heap Scan". */
export function planNodeTypes(json: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => { if (n && typeof n === "object") { const o = n as { ["Node Type"]?: string; Plans?: unknown[] }; if (o["Node Type"]) out.push(o["Node Type"]); o.Plans?.forEach(walk); } };
  const root = Array.isArray(json) ? (json[0] as { Plan?: unknown })?.Plan : (json as { Plan?: unknown })?.Plan;
  walk(root);
  return out;
}
