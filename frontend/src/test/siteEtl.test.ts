import { beforeEach, describe, expect, it } from "vitest";
import { PRESET_CLEAN_ORDERS, SAMPLES, parseCsv, parseJson, runNode, runPipeline, toIsoDate, toNumber, topoOrder, validatePipeline, type EtlNode, type Pipeline, type Row } from "../site/lib/lab/etl";
import { deleteDoc, listDocs, loadDoc, saveDoc } from "../site/lib/lab/store";

const node = (kind: EtlNode["kind"], config: Record<string, unknown> = {}, inputs: string[] = ["a"], id = "n"): EtlNode => ({ id, kind, inputs, config });
const rows: Row[] = [{ id: 1, name: " Ann ", amt: "10", d: "2026-01-02" }, { id: 2, name: "Bob", amt: "", d: "01/03/2026" }, { id: 2, name: "Bob", amt: "", d: "01/03/2026" }, { id: 3, name: "Cy", amt: "x", d: "2026-02-30" }];
const run = (n: EtlNode, input: Row[] = rows, second?: Row[]) => runNode(n, second ? [input, second] : [input]);

describe("parsing", () => {
  it("reads CSV with quotes, escaped quotes, commas inside quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n1,"x, y"\r\n2,"say ""hi"""\r\n')).toEqual([{ a: "1", b: "x, y" }, { a: "2", b: 'say "hi"' }]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,b\n1\n")).toEqual([{ a: "1", b: "" }]); // short row
  });
  it("reads a JSON array or JSON lines and explains bad input", () => {
    expect(parseJson('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(parseJson('{"a":1}\n{"a":2}')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(() => parseJson("{oops")).toThrow(/could not be read/);
    expect(() => parseJson("[1,2]")).toThrow(/must be an object/);
  });
  it("converts numbers and dates strictly", () => {
    expect(toNumber(" 1,200.50 ")).toBe(1200.5);
    expect(toNumber("abc")).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toIsoDate("01/07/2026")).toBe("2026-01-07");
    expect(toIsoDate(" 2026-1-5 ")).toBe("2026-01-05");
    expect(toIsoDate("2026-02-30")).toBeNull(); // not a real day
    expect(toIsoDate("garbage")).toBeNull();
  });
});

describe("transform nodes", () => {
  it("select keeps and orders columns; a typo names the available columns", () => {
    expect(run(node("select", { columns: ["name", "id"] })).rows[0]).toEqual({ name: " Ann ", id: 1 });
    expect(() => run(node("select", { columns: ["nope"] }))).toThrow(/no column "nope".*id, name, amt, d/);
    expect(() => run(node("select", { columns: [] }))).toThrow(/at least one column/);
  });
  it("filter compares numbers as numbers and supports null checks", () => {
    expect(run(node("filter", { column: "id", op: ">", value: "1" })).rows).toHaveLength(3);
    expect(run(node("filter", { column: "amt", op: "is null" })).rows).toHaveLength(2);
    expect(run(node("filter", { column: "name", op: "contains", value: "an" })).rows).toHaveLength(1); // " Ann "
  });
  it("convert reports what it could not convert, or fails when asked", () => {
    const r = run(node("convert", { column: "amt", to: "number" }));
    expect(r.rows.map((x) => x.amt)).toEqual([10, null, null, null]);
    expect(r.notes[0]).toMatch(/1 value could not be converted to number/);
    expect(() => run(node("convert", { column: "amt", to: "number", onError: "fail" }))).toThrow(/"x" in column "amt" is not a valid number/);
    expect(run(node("convert", { column: "d", to: "date" })).rows.map((x) => x.d)).toEqual(["2026-01-02", "2026-01-03", "2026-01-03", null]);
    expect(run(node("convert", { column: "name", to: "string" })).rows[0].name).toBe("Ann");
  });
  it("nulls: drop, fill with a value, fill with the mean", () => {
    expect(run(node("nulls", { column: "amt", strategy: "drop" })).rows).toHaveLength(2);
    expect(run(node("nulls", { column: "amt", strategy: "fill", value: "0" })).rows[1].amt).toBe("0");
    expect(() => run(node("nulls", { column: "amt", strategy: "fill" }))).toThrow(/value to fill/);
    const mean = run(node("nulls", { column: "x", strategy: "mean" }), [{ x: 2 }, { x: null }, { x: 4 }]);
    expect(mean.rows[1].x).toBe(3);
    expect(() => run(node("nulls", { column: "x", strategy: "mean" }), [{ x: null }])).toThrow(/No numbers/);
  });
  it("dedupe by key keeps the first; no key compares whole rows", () => {
    expect(run(node("dedupe", { keys: ["id"] })).rows.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(run(node("dedupe", {})).rows).toHaveLength(3);
    expect(run(node("dedupe", { keys: ["id"] })).notes[0]).toMatch(/Removed 1 duplicate/);
  });
  it("aggregate: count, sum, avg, min, max, with and without grouping", () => {
    const data: Row[] = [{ g: "a", v: 1 }, { g: "a", v: 3 }, { g: "b", v: 5 }];
    expect(run(node("aggregate", { groupBy: ["g"], fn: "count" }), data).rows).toEqual([{ g: "a", count: 2 }, { g: "b", count: 1 }]);
    expect(run(node("aggregate", { groupBy: ["g"], fn: "sum", column: "v", as: "total" }), data).rows).toEqual([{ g: "a", total: 4 }, { g: "b", total: 5 }]);
    expect(run(node("aggregate", { fn: "avg", column: "v" }), data).rows).toEqual([{ avg_v: 3 }]);
    expect(run(node("aggregate", { fn: "max", column: "v" }), data).rows[0].max_v).toBe(5);
    expect(() => run(node("aggregate", { fn: "sum" }), data)).toThrow(/Choose the column to sum/);
  });
  it("join: inner drops unmatched (and says so), left keeps them with nulls, name clashes get a suffix", () => {
    const o: Row[] = [{ id: 1, name: "o1" }, { id: 9, name: "o9" }];
    const c: Row[] = [{ id: 1, name: "Asha" }];
    const inner = run(node("join", { leftKey: "id", rightKey: "id", kind: "inner" }, ["a", "b"]), o, c);
    expect(inner.rows).toEqual([{ id: 1, name: "o1", id_right: 1, name_right: "Asha" }]);
    expect(inner.notes[0]).toMatch(/1 left row\(s\) had no match/);
    const left = run(node("join", { leftKey: "id", rightKey: "id", kind: "left" }, ["a", "b"]), o, c);
    expect(left.rows).toHaveLength(2);
    expect(left.rows[1].name_right).toBeNull();
  });
});

describe("validate and load", () => {
  const data: Row[] = [{ id: 1, amt: 5 }, { id: 2, amt: -1 }, { id: 2, amt: 7 }, { id: null, amt: 3 }];
  it("fail mode stops the run and says why", () => {
    expect(() => run(node("validate", { onFail: "fail", rules: [{ column: "amt", rule: "min", arg: "0" }] }), data)).toThrow(/1 of 4 rows failed validation \(amt min 0\).*stopped/);
  });
  it("drop mode removes failing rows and counts them; every rule type works", () => {
    const r = run(node("validate", { onFail: "drop", rules: [{ column: "amt", rule: "min", arg: "0" }, { column: "id", rule: "not-null" }, { column: "id", rule: "unique" }, { column: "amt", rule: "max", arg: "6" }] }), data);
    expect(r.rows).toEqual([{ id: 1, amt: 5 }]);
    expect(r.notes[0]).toMatch(/Dropped 3 row/);
    expect(run(node("validate", { rules: [{ column: "amt", rule: "regex", arg: "^\\d+$" }], onFail: "drop" }), [{ amt: "12" }, { amt: "a" }]).rows).toHaveLength(1);
    expect(() => run(node("validate", { rules: [{ column: "amt", rule: "regex", arg: "(" }] }), data)).toThrow(/not a valid pattern/);
    expect(() => run(node("validate", { rules: [] }), data)).toThrow(/at least one rule/);
  });
  it("a clean dataset passes and says so; output reports the load", () => {
    expect(run(node("validate", { rules: [{ column: "id", rule: "not-null" }] }), [{ id: 1 }]).notes[0]).toMatch(/All 1 rows passed 1 rule/);
    expect(run(node("output", { name: "t" }), [{ a: 1 }]).notes[0]).toBe('Loaded 1 row(s) into "t".');
  });
});

describe("pipeline graph", () => {
  it("accepts the preset, orders it, and runs it end to end on the messy sample", () => {
    expect(validatePipeline(PRESET_CLEAN_ORDERS)).toEqual([]);
    expect(topoOrder(PRESET_CLEAN_ORDERS)![0]).toBe("src");
    const r = runPipeline(PRESET_CLEAN_ORDERS);
    expect(r.ok).toBe(true);
    // 7 raw rows: blank amount dropped, duplicate 1003 removed, bad date row dropped, negative amount dropped.
    expect(r.outputs.out.map((x) => x.order_id)).toEqual(["1001", "1003", "1005"]);
    expect(r.outputs.out[1]).toMatchObject({ amount: 1200, order_date: "2026-01-07" });
    expect(r.logs.some((l) => /Dropped 1 row\(s\) with an empty amount/.test(l.message))).toBe(true);
    expect(r.logs.filter((l) => l.level === "error")).toEqual([]);
    expect(Object.values(r.status).every((s) => s === "ok")).toBe(true);
  });
  it("wiring errors are caught before running: missing/extra destinations, wrong inputs, dangling and cyclic links", () => {
    const src = (id: string): EtlNode => ({ id, kind: "source-json", inputs: [], config: { text: "[]" } });
    expect(validatePipeline({ nodes: [src("a")] })[0]).toMatch(/Add one destination/);
    expect(validatePipeline({ nodes: [src("a"), { id: "o1", kind: "output", inputs: ["a"], config: {} }, { id: "o2", kind: "output", inputs: ["a"], config: {} }] })).toContain("Use exactly one destination node.");
    expect(validatePipeline({ nodes: [src("a"), { id: "j", kind: "join", inputs: ["a"], config: {} }, { id: "o", kind: "output", inputs: ["j"], config: {} }] }).join()).toMatch(/needs 2 inputs but has 1/);
    expect(validatePipeline({ nodes: [{ id: "o", kind: "output", inputs: ["gone"], config: {} }] }).join()).toMatch(/no longer exists/);
    const cyc: Pipeline = { nodes: [{ id: "x", kind: "select", inputs: ["y"], config: {} }, { id: "y", kind: "select", inputs: ["x"], config: {} }, { id: "o", kind: "output", inputs: ["y"], config: {} }] };
    expect(validatePipeline(cyc).join()).toMatch(/loops back/);
    expect(runPipeline(cyc).ok).toBe(false);
  });
  it("an error stops that step, marks downstream steps skipped and names the problem", () => {
    const p: Pipeline = { nodes: [
      { id: "s", kind: "source-csv", inputs: [], config: { text: "a\n1\n" } },
      { id: "f", kind: "select", inputs: ["s"], config: { columns: ["missing"] } },
      { id: "o", kind: "output", inputs: ["f"], config: { name: "t" } },
    ] };
    const r = runPipeline(p);
    expect(r.status).toEqual({ s: "ok", f: "error", o: "skipped" });
    expect(r.ok).toBe(false);
    expect(r.logs.find((l) => l.level === "error")!.message).toMatch(/no column "missing"/);
    expect(r.outputs.o).toBeUndefined(); // nothing reached the destination
  });
  it("branches and joins run: orders joined to customers, then counted per country", () => {
    const p: Pipeline = { nodes: [
      { id: "o", kind: "source-csv", inputs: [], config: { text: "order_id,customer_id\n1,C1\n2,C2\n3,C1\n" } },
      { id: "c", kind: "source-json", inputs: [], config: { text: SAMPLES.customers_json } },
      { id: "j", kind: "join", inputs: ["o", "c"], config: { leftKey: "customer_id", rightKey: "customer_id", kind: "inner" } },
      { id: "a", kind: "aggregate", inputs: ["j"], config: { groupBy: ["country"], fn: "count", as: "orders" } },
      { id: "out", kind: "output", inputs: ["a"], config: { name: "orders_by_country" } },
    ] };
    const r = runPipeline(p);
    expect(r.ok).toBe(true);
    expect(r.outputs.out).toEqual([{ country: "IN", orders: 2 }, { country: "US", orders: 1 }]);
  });
  it("the database source is a simulation with built-in rows; unknown tables are explained", () => {
    expect(runNode({ id: "d", kind: "source-db", inputs: [], config: { table: "products" } }, []).rows).toHaveLength(3);
    expect(() => runNode({ id: "d", kind: "source-db", inputs: [], config: { table: "nope" } }, [])).toThrow(/Unknown table "nope"/);
  });
  it("a source over the row cap is refused with a clear message", () => {
    expect(() => parseCsv("a\n" + "1\n".repeat(50_001))).toThrow(/more than 50,000 rows/);
  });
});

describe("lab document store", () => {
  beforeEach(() => localStorage.clear());
  it("saves, lists newest first, loads, overwrites by id and deletes", () => {
    const a = saveDoc("etl", { name: "First", data: { n: 1 } })!;
    const b = saveDoc("etl", { name: "Second", data: { n: 2 } })!;
    expect(listDocs("etl").map((d) => d.name)).toEqual(["Second", "First"]);
    expect(loadDoc<{ n: number }>("etl", a)!.n).toBe(1);
    saveDoc("etl", { id: a, name: "First v2", data: { n: 10 } });
    expect(listDocs("etl")).toHaveLength(2);
    expect(loadDoc<{ n: number }>("etl", a)!.n).toBe(10);
    deleteDoc("etl", b);
    expect(listDocs("etl").map((d) => d.id)).toEqual([a]);
    expect(loadDoc("etl", b)).toBeNull();
  });
  it("is capped at 20 documents, keeps kinds separate, and survives corrupt storage", () => {
    for (let i = 0; i < 25; i++) saveDoc("etl", { name: `d${i}`, data: i });
    expect(listDocs("etl")).toHaveLength(20);
    saveDoc("dag", { name: "other", data: 1 });
    expect(listDocs("dag")).toHaveLength(1);
    localStorage.setItem("sqlp.lab.etl.index", "{bad");
    expect(listDocs("etl")).toEqual([]);
    expect(loadDoc("etl", "nope")).toBeNull();
  });
});
