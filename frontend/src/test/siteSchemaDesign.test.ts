// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { EXERCISES, INDEX_DEMO, checkDecompose, checkDesign, checkPick, parseParts, planNodeTypes } from "../site/lib/lab/designExercises";
import { candidateKeys, checkDecomposition, closure, isLossless, newColumn, normalForm, parseFds, preservesDependencies, relationships, tableOrder, toDdl, validateSchema, type Schema } from "../site/lib/lab/schemaDesign";

const fd = (t: string) => parseFds(t).fds;
const col = (name: string, type = "integer", o: Record<string, unknown> = {}) => ({ ...newColumn(name, type), ...o });
const tbl = (name: string, columns: ReturnType<typeof col>[]) => ({ name, columns, indexes: [] as { columns: string[]; unique?: boolean }[] });

describe("functional dependency algorithms", () => {
  const fds = fd("a -> b\nb -> c\nc, d -> e");
  it("parses FDs and reports lines it cannot read", () => {
    expect(parseFds("a, b -> c").fds).toEqual([{ lhs: ["a", "b"], rhs: ["c"] }]);
    expect(parseFds("a → b").fds).toHaveLength(1);
    expect(parseFds("nonsense\na -> b").errors[0]).toMatch(/Could not read "nonsense"/);
  });
  it("closure follows chains of dependencies", () => {
    expect(closure(["a"], fds)).toEqual(["a", "b", "c"]);
    expect(closure(["a", "d"], fds)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("finds minimal candidate keys, including several", () => {
    expect(candidateKeys(["a", "b", "c", "d", "e"], fds)).toEqual([["a", "d"]]);
    expect(candidateKeys(["a", "b"], fd("a -> b\nb -> a"))).toEqual([["a"], ["b"]]);
  });
  it("classifies normal forms", () => {
    // key (order_id, product_id); product_name depends on part of the key
    expect(normalForm(["order_id", "product_id", "product_name", "qty"], fd("order_id, product_id -> qty\nproduct_id -> product_name"))).toBe("1NF");
    // key emp_id; dept_name depends on dept_id (transitive)
    expect(normalForm(["emp_id", "dept_id", "dept_name"], fd("emp_id -> dept_id\ndept_id -> dept_name"))).toBe("2NF");
    expect(normalForm(["emp_id", "dept_id"], fd("emp_id -> dept_id"))).toBe("BCNF");
    // classic 3NF but not BCNF: street, city, zip
    expect(normalForm(["street", "city", "zip"], fd("street, city -> zip\nzip -> city"))).toBe("3NF");
  });
  it("lossless-join chase: a shared key keeps it lossless, no shared key does not", () => {
    const f = fd("emp_id -> dept_id\ndept_id -> dept_name");
    expect(isLossless(["emp_id", "dept_id", "dept_name"], [["emp_id", "dept_id"], ["dept_id", "dept_name"]], f)).toBe(true);
    expect(isLossless(["emp_id", "dept_id", "dept_name"], [["emp_id", "dept_name"], ["dept_id", "dept_name"]], f)).toBe(false);
  });
  it("dependency preservation", () => {
    const f = fd("street, city -> zip\nzip -> city");
    expect(preservesDependencies([["street", "zip"], ["zip", "city"]], f)).toBe(false); // street,city -> zip is lost
    expect(preservesDependencies([["street", "city", "zip"]], f)).toBe(true);
  });
  it("checkDecomposition says exactly what is wrong", () => {
    const attrs = ["emp_id", "emp_name", "dept_id", "dept_name"];
    const f = fd("emp_id -> emp_name, dept_id\ndept_id -> dept_name");
    expect(checkDecomposition(attrs, [["emp_id", "emp_name", "dept_id"], ["dept_id", "dept_name"]], f, "3NF").ok).toBe(true);
    expect(checkDecomposition(attrs, [["emp_id", "emp_name", "dept_id", "dept_name"]], f, "3NF").messages.join()).toMatch(/only in 2NF.*needs to be in 3NF|at least two tables/);
    expect(checkDecomposition(attrs, [["emp_id", "emp_name", "dept_id"], ["dept_id"]], f, "3NF").messages.join()).toMatch(/lost.*dept_name/);
    expect(checkDecomposition(attrs, [["emp_id", "emp_name", "dept_id"], ["dept_id", "dept_name", "bogus"]], f, "3NF").messages.join()).toMatch(/not in the original table: bogus/);
    expect(checkDecomposition(attrs, [["emp_id", "emp_name"], ["dept_id", "dept_name"]], f, "3NF").messages.join()).toMatch(/lossy/);
  });
});

describe("schema validation, DDL and relationships", () => {
  const shop: Schema = { tables: [
    tbl("orders", [col("order_id", "integer", { pk: true }), col("customer_id", "integer", { fk: { table: "customers", column: "customer_id" } })]),
    tbl("customers", [col("customer_id", "integer", { pk: true }), col("name", "text", { notNull: true })]),
  ] };
  it("accepts a sound schema and creates referenced tables first", () => {
    expect(validateSchema(shop).filter((i) => i.level === "error")).toEqual([]);
    expect(tableOrder(shop)).toEqual(["customers", "orders"]);
    expect(toDdl(shop)).toMatch(/CREATE TABLE customers[\s\S]*CREATE TABLE orders[\s\S]*FOREIGN KEY \(customer_id\) REFERENCES customers \(customer_id\)/);
  });
  it("explains each class of mistake", () => {
    const text = (s: Schema) => validateSchema(s).map((i) => i.text).join(" | ");
    expect(text({ tables: [tbl("User", [col("id", "integer", { pk: true })])] })).toMatch(/not a valid table name/);
    expect(text({ tables: [tbl("order", [col("id", "integer", { pk: true })])] })).toMatch(/reserved word/);
    expect(text({ tables: [tbl("t", [col("a")])] })).toMatch(/no primary key/);
    expect(text({ tables: [tbl("t", [col("a", "integer", { pk: true }), col("a")])] })).toMatch(/two columns called "a"/);
    expect(text({ tables: [tbl("t", [col("a", "integer", { pk: true, fk: { table: "nope", column: "x" } })])] })).toMatch(/table "nope", which does not exist/);
    const mismatch = { tables: [tbl("p", [col("id", "integer", { pk: true })]), tbl("c", [col("id", "integer", { pk: true }), col("p_id", "text", { fk: { table: "p", column: "id" } })])] };
    expect(text(mismatch)).toMatch(/is text but "p.id" is integer/);
    const nonKey = { tables: [tbl("p", [col("id", "integer", { pk: true }), col("x")]), tbl("c", [col("id", "integer", { pk: true }), col("p_x", "integer", { fk: { table: "p", column: "x" } })])] };
    expect(text(nonKey)).toMatch(/must reference a primary key or unique/);
    const loop = { tables: [tbl("a", [col("id", "integer", { pk: true }), col("b_id", "integer", { fk: { table: "b", column: "id" } })]), tbl("b", [col("id", "integer", { pk: true }), col("a_id", "integer", { fk: { table: "a", column: "id" } })])] };
    expect(text(loop)).toMatch(/circle/);
    expect(validateSchema({ tables: [tbl("t", [col("code", "text", { pk: true }), col("n")])] }).some((i) => i.level === "warn" || i.level === "error")).toBe(false); // "code" text key is allowed
    expect(validateSchema({ tables: [tbl("t", [col("name", "text", { pk: true })])] }).some((i) => i.level === "warn")).toBe(true);
  });
  it("detects 1:N, 1:1 and N:M", () => {
    expect(relationships(shop)).toEqual([expect.objectContaining({ from: "customers", to: "orders", cardinality: "1:N" })]);
    const one: Schema = { tables: [tbl("users", [col("id", "integer", { pk: true })]), tbl("profiles", [col("pid", "integer", { pk: true }), col("user_id", "integer", { unique: true, fk: { table: "users", column: "id" } })])] };
    expect(relationships(one)[0].cardinality).toBe("1:1");
    const sharedPk: Schema = { tables: [tbl("users", [col("id", "integer", { pk: true })]), tbl("profiles", [col("id", "integer", { pk: true, fk: { table: "users", column: "id" } })])] };
    expect(relationships(sharedPk)[0].cardinality).toBe("1:1");
    const nm = EXERCISES.find((e) => e.id === "rel-nm")!;
    expect(nm.kind === "design" && relationships(nm.solution)[0]).toMatchObject({ cardinality: "N:M", via: "enrollments" });
  });
});

describe("exercises: every worked solution passes the checker, every starting point fails it", () => {
  for (const e of EXERCISES) {
    it(`${e.id} (${e.concept})`, () => {
      if (e.kind === "pick-columns") {
        expect(checkPick(e, e.answer).ok).toBe(true);
        expect(checkPick(e, []).ok).toBe(false);
        expect(checkPick(e, [e.columns[0]]).ok).toBe(false);
        expect(checkPick(e, [...e.answer, e.columns[0]]).messages.join()).toMatch(/holds one value/);
      } else if (e.kind === "decompose") {
        expect(checkDecompose(e, e.solution.map((p) => p.join(", ")).join("\n"))).toEqual({ ok: true, messages: [] });
        expect(checkDecompose(e, e.attrs.join(", ")).ok).toBe(false); // the original, unsplit
        expect(checkDecompose(e, "").ok).toBe(false);
        expect(parseParts("a, b\n\n c ")).toEqual([["a", "b"], ["c"]]);
      } else {
        expect(checkDesign(e, e.solution)).toEqual({ ok: true, messages: [] });
        const start = checkDesign(e, e.starter);
        expect(start.ok).toBe(false);
        expect(start.messages[0]).toMatch(/foreign key/i);
      }
      expect(e.explain.length).toBeGreaterThan(40);
    });
  }
  it("a 1:N design is not accepted for a 1:1 exercise, with a helpful hint", () => {
    const e = EXERCISES.find((x) => x.id === "rel-11")!;
    if (e.kind !== "design") throw new Error("shape");
    const manyProfiles: Schema = { tables: e.starter.tables.map((t) => (t.name === "user_profiles" ? { ...t, columns: [...t.columns, col("user_id", "integer", { fk: { table: "users", column: "user_id" } })] } : t)) };
    expect(checkDesign(e, manyProfiles).messages[0]).toMatch(/relationship is 1:N, not 1:1.*UNIQUE/);
  });
  it("covers the concepts requested: 1NF, 2NF, 3NF, keys, 1:1, 1:N, N:M", () => {
    expect([...new Set(EXERCISES.map((e) => e.concept))].sort()).toEqual(["1NF", "2NF", "3NF", "Many-to-many", "One-to-many", "One-to-one"]);
  });
});

describe("on real PostgreSQL (PGlite)", () => {
  it("every exercise solution's generated DDL actually creates the tables", async () => {
    for (const e of EXERCISES) {
      if (e.kind !== "design") continue;
      const pg = new PGlite();
      await pg.exec(toDdl(e.solution));
      const r = await pg.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
      expect(r.rows.map((x) => x.table_name).sort()).toEqual(e.solution.tables.map((t) => t.name).sort());
    }
  }, 120_000);

  it("referential integrity: an order for a missing customer is rejected, and 1:1 UNIQUE blocks a second profile", async () => {
    const one = EXERCISES.find((x) => x.id === "rel-11")!, many = EXERCISES.find((x) => x.id === "rel-1n")!;
    if (one.kind !== "design" || many.kind !== "design") throw new Error("shape");
    const pg = new PGlite();
    await pg.exec(toDdl(many.solution));
    await pg.exec("INSERT INTO customers VALUES (1, 'Asha')");
    await pg.exec("INSERT INTO orders VALUES (1, 1, '2026-01-01')");
    await expect(pg.exec("INSERT INTO orders VALUES (2, 99, '2026-01-02')")).rejects.toThrow(/foreign key constraint/);
    const pg2 = new PGlite();
    await pg2.exec(toDdl(one.solution));
    await pg2.exec("INSERT INTO users VALUES (1, 'a@x.org'); INSERT INTO user_profiles VALUES (1, 1, 'hi')");
    await expect(pg2.exec("INSERT INTO user_profiles VALUES (2, 1, 'again')")).rejects.toThrow(/unique/);
  }, 120_000);

  it("an index changes the plan from a sequential scan to an index scan (EXPLAIN on this data)", async () => {
    const pg = new PGlite();
    await pg.exec(INDEX_DEMO.setup);
    const plan = async () => planNodeTypes((await pg.query<{ "QUERY PLAN": unknown }>(INDEX_DEMO.explain(INDEX_DEMO.query))).rows[0]["QUERY PLAN"]);
    expect(await plan()).toContain("Seq Scan");
    await pg.exec(INDEX_DEMO.createIndex);
    await pg.exec("ANALYZE events");
    const after = await plan();
    expect(after.some((t) => /Index|Bitmap/.test(t))).toBe(true);
    expect(after).not.toContain("Seq Scan");
  }, 120_000);

  it("planNodeTypes reads nested plans", () => {
    expect(planNodeTypes([{ Plan: { "Node Type": "Hash Join", Plans: [{ "Node Type": "Seq Scan" }, { "Node Type": "Hash", Plans: [{ "Node Type": "Index Scan" }] }] } }])).toEqual(["Hash Join", "Seq Scan", "Hash", "Index Scan"]);
    expect(planNodeTypes(null)).toEqual([]);
  });
});
