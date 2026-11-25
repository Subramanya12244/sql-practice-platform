import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { visualize, type Visualization } from "../site/lib/visualize";
import { traceRows, type RowTrace } from "../site/lib/visual/classic/rowTrace";
import type { FlowFrame } from "../site/lib/visual/classic/rowFlow";
import { RowFlow } from "../site/components/visual/RowFlowClassic";

/**
 * The aggregation step (SELECT of a grouped query) with a real PostgreSQL (PGlite): once the board has settled no lane is empty, in
 * every variant of the step (CALC, SUM per group, ROUND, Output rows), in the reduced-motion static "After" board and in the animated
 * settled phase. The contributing values and the final aggregates on screen equal independent database queries.
 */
let pg: PGlite;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Blob.prototype.arrayBuffer ??= function arrayBuffer(this: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result as ArrayBuffer); fr.onerror = () => reject(fr.error); fr.readAsArrayBuffer(this); });
};
beforeAll(async () => {
  const dir = path.resolve(process.cwd(), "node_modules/@electric-sql/pglite/dist");
  const [pgliteWasmModule, initdbWasmModule, data] = await Promise.all([
    readFile(path.join(dir, "pglite.wasm")).then((b) => WebAssembly.compile(b)),
    readFile(path.join(dir, "initdb.wasm")).then((b) => WebAssembly.compile(b)),
    readFile(path.join(dir, "pglite.data")),
  ]);
  pg = await PGlite.create({ pgliteWasmModule, initdbWasmModule, fsBundle: new Blob([data]) });
  await pg.exec(northwind);
}, 90_000);
beforeEach(() => {
  localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const run = (sql: string) => execute(pg as unknown as SqlDb, sql);
const text = async (sql: string) => { const r = await run(sql); if (!r.success) throw new Error(r.message ?? "query failed"); return r.rows.map((row) => row.map((v) => (v === null ? "NULL" : String(v)))); };
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const Q01 = "SELECT p.product_id, p.product_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS total_revenue FROM products p JOIN order_details od ON od.product_id = p.product_id GROUP BY p.product_id, p.product_name ORDER BY total_revenue DESC";
const COUNT_AVG = "SELECT c.country, COUNT(*) AS n, ROUND(AVG(o.freight)::numeric, 2) AS avg_freight FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country ORDER BY n DESC";
const AVG_ONLY = "SELECT c.country, ROUND(AVG(o.freight)::numeric, 2) AS avg_freight FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country";
const COUNT_ONLY = "SELECT country, COUNT(*) AS customers FROM customers GROUP BY country";

const cache = new Map<string, { viz: Visualization; trace: RowTrace; frame: FlowFrame; index: number }>();
async function load(sql: string) {
  if (!cache.has(sql)) {
    const viz = await visualize(sql, run);
    const trace = await traceRows(sql, run, viz);
    const index = trace.frames.findIndex((f) => f?.kind === "aggregate");
    expect(index).toBeGreaterThanOrEqual(0);
    cache.set(sql, { viz, trace, frame: trace.frames[index]!, index });
  }
  return cache.get(sql)!;
}
function mount(d: Awaited<ReturnType<typeof load>>, reduced: boolean) {
  return render(<RowFlow stage={d.viz.stages[d.index]} prev={d.viz.stages[d.index - 1]} reduced={reduced} frame={d.frame} stageIndex={d.index} />);
}

/** The lane (0, 1, ...) a card is drawn in, from its transform; and the number of lanes the board has (its header row). */
const laneOf = (el: HTMLElement) => Number(/translate\(([-\d.]+)%/.exec(el.style.transform)![1]) / 100;
const laneCount = (board: HTMLElement) => board.parentElement!.querySelectorAll(":scope > div.grid > p").length;
/** Visible cards per lane of a board (stale cards, hidden for the animation, do not count). */
function lanes(board: HTMLElement) {
  const n = laneCount(board);
  const out = Array.from({ length: n }, () => [] as HTMLElement[]);
  for (const c of board.querySelectorAll<HTMLElement>("[data-card]")) if (c.getAttribute("aria-hidden") !== "true") out[Math.round(laneOf(c))]?.push(c);
  return out;
}
const titleRows = (c: HTMLElement) => Object.fromEntries((c.title ?? "").split("\n").map((l) => { const m = /^(.+?) = ([\s\S]*)$/.exec(l); return m ? [m[1], m[2]] : [l, ""]; }));

async function variantCount() {
  const sel = screen.queryByRole("combobox", { name: "Part of this stage" });
  return sel ? sel.querySelectorAll("option").length : 0;
}
async function choose(i: number) {
  const sel = screen.getByRole("combobox", { name: "Part of this stage" });
  fireEvent.change(sel, { target: { value: String(i) } });
}

const QUERIES = [{ name: "Q01 SUM", sql: Q01 }, { name: "COUNT + AVG", sql: COUNT_AVG }, { name: "AVG only", sql: AVG_ONLY }, { name: "COUNT(*) only", sql: COUNT_ONLY }];

describe.each(QUERIES)("$name: no empty lane once the step has settled", ({ sql }) => {
  it("reduced motion: every lane of the static After board holds rows, in every variant", async () => {
    const d = await load(sql);
    mount(d, true);
    const n = await variantCount();
    expect(n).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < n; i++) {
      await choose(i);
      const after = within(screen.getByRole("region", { name: "After this stage" })).getByTestId("rowflow-board");
      const per = lanes(after);
      expect(per.length).toBeGreaterThanOrEqual(1);
      per.forEach((cards, lane) => expect(cards.length, `variant ${i + 1}, lane ${lane}`).toBeGreaterThan(0));
    }
  });

  it("animated: once settled, every lane holds visible rows, in every variant", async () => {
    const d = await load(sql);
    mount(d, false);
    const n = await variantCount();
    for (let i = 0; i < n; i++) {
      await choose(i);
      await waitFor(() => expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("after"));
      const per = lanes(screen.getByTestId("rowflow-board"));
      per.forEach((cards, lane) => expect(cards.length, `variant ${i + 1}, lane ${lane}`).toBeGreaterThan(0));
    }
  });
});

describe("Q01: contributing values and final aggregate equal the database", () => {
  const where = (id: string) => `FROM products p JOIN order_details od ON od.product_id = p.product_id WHERE p.product_id = ${id}`;

  it("SUM per group: the drawn line values, the group's SUM and row count", async () => {
    const d = await load(Q01);
    mount(d, true);
    const n = await variantCount();
    await choose(1); // "SUM per group" (variant 0 is CALC)
    expect(screen.getByRole("combobox", { name: "Part of this stage" }).querySelectorAll("option")[1].textContent).toMatch(/SUM per group/);
    expect(n).toBe(4); // CALC, SUM per group, ROUND, Output rows
    const after = within(screen.getByRole("region", { name: "After this stage" })).getByTestId("rowflow-board");
    const [values, totals] = lanes(after);
    expect(values.length).toBeGreaterThan(0);
    expect(totals.length).toBe(3); // one result per drawn group
    const byGroup = new Map<string, string[]>();
    for (const c of values) { const t = titleRows(c); (byGroup.get(t.group) ?? byGroup.set(t.group, []).get(t.group)!).push(t["line value"]); }
    expect(byGroup.size).toBe(3);
    for (const tot of totals) {
      const [label, calc, over] = tot.title.split("\n"); // "<group>\nSUM = <raw>\nover N rows"
      const id = label.split(",")[0].trim();
      expect(calc).toMatch(/^SUM = /);
      const [[raw, count]] = await text(`SELECT SUM(od.unit_price * od.quantity * (1 - od.discount))::text, COUNT(*)::text ${where(id)}`);
      expect(calc).toBe(`SUM = ${raw}`);
      expect(over).toBe(`over ${count} ${count === "1" ? "row" : "rows"}`);
      // the on-screen result chip carries the same text
      expect(tot.textContent).toContain(`SUM = ${raw}`);
      // every line value drawn for the group is one the database computed for that group (all of them when the group has <= 5 rows)
      const real = (await text(`SELECT (od.unit_price * od.quantity * (1 - od.discount))::text ${where(id)}`)).map((r) => r[0]);
      const drawn = byGroup.get(label)!;
      expect(drawn.length).toBe(Math.min(5, real.length));
      const pool = [...real];
      for (const v of drawn) { const at = pool.indexOf(v); expect(at, `value ${v} of group ${label}`).toBeGreaterThanOrEqual(0); pool.splice(at, 1); }
      if (real.length <= 5) expect(pool).toEqual([]);
    }
  });

  it("ROUND: the full result stays on the left, the rounded value the query returns appears on the right", async () => {
    const d = await load(Q01);
    mount(d, true);
    await choose(2);
    const after = within(screen.getByRole("region", { name: "After this stage" })).getByTestId("rowflow-board");
    const [raw, rounded] = lanes(after);
    expect(raw.length).toBe(3);
    expect(rounded.length).toBe(3);
    for (const c of rounded) {
      const t = titleRows(c);
      const id = Object.values(t)[0].split(",")[0].trim();
      const [[full, final]] = await text(`SELECT SUM(od.unit_price * od.quantity * (1 - od.discount))::text, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2)::text FROM products p JOIN order_details od ON od.product_id = p.product_id WHERE p.product_id = ${id}`);
      expect(t.total_revenue).toBe(final);
      const left = raw.find((r) => titleRows(r).group === t.group)!;
      expect(left, `raw result of group ${t.group}`).toBeTruthy();
      expect(titleRows(left)["SUM result"]).toBe(full);
    }
  });

  it("Output rows (the default): the groups stay on the left with their row counts, the output rows on the right equal the database", async () => {
    const d = await load(Q01);
    mount(d, true);
    expect(screen.getByRole("combobox", { name: "Part of this stage" })).toHaveProperty("value", "3");
    const after = within(screen.getByRole("region", { name: "After this stage" })).getByTestId("rowflow-board");
    const [groups, outputs] = lanes(after);
    expect(groups.length).toBe(outputs.length);
    expect(outputs.length).toBeGreaterThan(5);
    for (const g of groups) expect(g.textContent).toMatch(/· [\d,]+ rows/);
    for (const o of outputs.slice(0, 6)) {
      const t = titleRows(o);
      const [[total, rows]] = await text(`SELECT ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2)::text, COUNT(*)::text ${where(t.product_id)}`);
      expect(t.total_revenue).toBe(total);
      expect(o.title).toContain(`from ${rows} rows`);
      const left = groups.find((g) => g.title.split("\n")[0].endsWith(`= ${t.product_id}, ${t.product_name}`));
      expect(left, `group of ${t.product_name}`).toBeTruthy();
      expect(left!.textContent).toContain(`${Number(rows).toLocaleString()} rows`);
    }
  });
});

describe("COUNT and AVG: values and aggregates equal the database", () => {
  it("per group: COUNT(*) and AVG(freight) in the SUM-per-group variant, the output rows in the last", async () => {
    const d = await load(COUNT_AVG);
    mount(d, true);
    const n = await variantCount();
    const labels = [...screen.getByRole("combobox", { name: "Part of this stage" }).querySelectorAll("option")].map((o) => o.textContent);
    const sumAt = labels.findIndex((l) => /COUNT \+ AVG per group/.test(l ?? ""));
    expect(sumAt, labels.join(" | ")).toBeGreaterThanOrEqual(0);
    await choose(sumAt);
    let after = within(screen.getByRole("region", { name: "After this stage" })).getByTestId("rowflow-board");
    let [values, totals] = lanes(after);
    expect(values.length).toBeGreaterThan(0);
    expect(totals.length).toBeGreaterThan(0);
    for (const tot of totals) {
      const [label, calc] = tot.title.split("\n");
      const [[count, avg]] = await text(`SELECT COUNT(*)::text, AVG(o.freight)::text FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE c.country = ${lit(label)}`);
      expect(calc).toBe(`COUNT(*) = ${count}, AVG(DISTINCT) = ${avg}`.replace("AVG(DISTINCT)", "AVG"));
    }
    // COUNT(*) is the first aggregate: every row contributes 1, and the group's result is the number of those rows
    for (const v of values) expect(titleRows(v)["line value"]).toBe("1");
    for (const tot of totals) {
      const label = tot.title.split("\n")[0];
      const drawn = values.filter((v) => titleRows(v).group === label).length;
      const [[count]] = await text(`SELECT COUNT(*)::text FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE c.country = ${lit(label)}`);
      expect(drawn).toBe(Math.min(5, Number(count)));
    }
    // last variant: output rows equal the query
    await choose(n - 1);
    after = within(screen.getByRole("region", { name: "After this stage" })).getByTestId("rowflow-board");
    [values, totals] = lanes(after);
    expect(values.length).toBe(totals.length);
    for (const o of totals.slice(0, 5)) {
      const t = titleRows(o);
      const [[count, avg]] = await text(`SELECT COUNT(*)::text, ROUND(AVG(o.freight)::numeric, 2)::text FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE c.country = ${lit(t.country)}`);
      expect(t.n).toBe(count);
      expect(t.avg_freight).toBe(avg);
    }
  });

  it("AVG: the freights drawn as line values are the group's real freights, the AVG chip equals the database", async () => {
    const d = await load(AVG_ONLY);
    mount(d, true);
    const labels = [...screen.getByRole("combobox", { name: "Part of this stage" }).querySelectorAll("option")].map((o) => o.textContent);
    await choose(labels.findIndex((l) => /AVG per group/.test(l ?? "")));
    const after = within(screen.getByRole("region", { name: "After this stage" })).getByTestId("rowflow-board");
    const [values, totals] = lanes(after);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      const t = titleRows(v);
      const real = (await text(`SELECT o.freight::text FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE c.country = ${lit(t.group)}`)).map((r) => r[0]);
      expect(real).toContain(t["line value"]);
    }
    for (const tot of totals) {
      const [label, calc] = tot.title.split("\n");
      const [[avg]] = await text(`SELECT AVG(o.freight)::text FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE c.country = ${lit(label)}`);
      expect(calc).toBe(`AVG = ${avg}`);
    }
  });
});
