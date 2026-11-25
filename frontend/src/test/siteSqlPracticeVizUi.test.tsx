import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { visualize, type Run } from "../site/lib/visualize";

/**
 * QA for the SQL Practice visualizer in the DOM, with a real PostgreSQL (PGlite) behind it. It is written against the shared
 * contract (docs/SQL_VISUALIZER_UPGRADE_CONTRACT.md): the stable test ids and the `data-step-index` marker on every region that
 * shows the current step. Expectations come from independent queries, never from what the UI says about itself.
 */
let pg: PGlite;
const calls: string[] = [];
vi.mock("../site/lib/browserDb", () => ({
  runQuery: async (sql: string) => { calls.push(sql); return execute(pg as unknown as SqlDb, sql); },
}));
vi.mock("../site/lib/queryGraph", () => ({ buildGraphs: async () => ({ ok: false, reason: "not in this test" }) }));
vi.mock("../site/components/QueryDiagram", () => ({ default: () => null }));
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
(Element.prototype as { scrollIntoView?: unknown }).scrollIntoView ??= () => {};

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
  calls.length = 0; localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);
vi.setConfig({ testTimeout: 90_000 });

const run: Run = (sql) => execute(pg as unknown as SqlDb, sql);

const MATRIX: { name: string; sql: string; reference: string }[] = [
  { name: "SELECT / WHERE", sql: "SELECT product_name, unit_price FROM products WHERE unit_price > 50 ORDER BY unit_price DESC", reference: "SELECT product_name, unit_price FROM products WHERE NOT (unit_price <= 50) ORDER BY unit_price DESC" },
  { name: "INNER JOIN", sql: "SELECT p.product_name, od.quantity FROM products p JOIN order_details od ON od.product_id = p.product_id WHERE od.quantity > 30", reference: "SELECT p.product_name, od.quantity FROM order_details od, products p WHERE p.product_id = od.product_id AND od.quantity > 30" },
  { name: "LEFT JOIN (unmatched rows)", sql: "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL", reference: "SELECT c.customer_id, NULL FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)" },
  { name: "3-table JOIN", sql: "SELECT c.company_name, o.order_id, e.last_name FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN employees e ON e.employee_id = o.employee_id WHERE c.country = 'Germany'", reference: "SELECT c.company_name, o.order_id, e.last_name FROM orders o, customers c, employees e WHERE o.customer_id = c.customer_id AND e.employee_id = o.employee_id AND c.country = 'Germany'" },
  { name: "GROUP BY + SUM/COUNT/AVG", sql: "SELECT category_id, COUNT(*) AS n, SUM(units_in_stock) AS stock, AVG(unit_price) AS a FROM products GROUP BY category_id ORDER BY category_id", reference: "SELECT c.category_id, (SELECT count(*) FROM products p WHERE p.category_id = c.category_id), (SELECT sum(units_in_stock) FROM products p WHERE p.category_id = c.category_id), (SELECT avg(unit_price) FROM products p WHERE p.category_id = c.category_id) FROM (SELECT DISTINCT category_id FROM products) c ORDER BY 1" },
  { name: "HAVING", sql: "SELECT category_id, COUNT(*) AS n FROM products GROUP BY category_id HAVING COUNT(*) > 8 ORDER BY n DESC, category_id", reference: "SELECT category_id, count(*) FROM products GROUP BY category_id HAVING count(*) > 8 ORDER BY 2 DESC, 1" },
  { name: "ORDER BY with NULLs", sql: "SELECT order_id, shipped_date FROM orders ORDER BY shipped_date DESC, order_id", reference: "SELECT order_id, shipped_date FROM orders ORDER BY shipped_date DESC NULLS FIRST, order_id" },
  { name: "LIMIT / OFFSET", sql: "SELECT product_name, unit_price FROM products ORDER BY unit_price DESC, product_id LIMIT 5 OFFSET 2", reference: "SELECT product_name, unit_price FROM products ORDER BY unit_price DESC, product_id OFFSET 2 FETCH FIRST 5 ROWS ONLY" },
  { name: "subquery", sql: "SELECT product_name FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products)", reference: "SELECT p.product_name FROM products p WHERE p.unit_price > (SELECT sum(unit_price) / count(*) FROM products)" },
  { name: "CTE", sql: "WITH big AS (SELECT order_id, SUM(quantity) AS q FROM order_details GROUP BY order_id) SELECT order_id, q FROM big WHERE q > 100 ORDER BY q DESC, order_id", reference: "SELECT order_id, sum(quantity) FROM order_details GROUP BY order_id HAVING sum(quantity) > 100 ORDER BY 2 DESC, 1" },
  { name: "window function", sql: "SELECT product_name, category_id, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS rk FROM products WHERE category_id IN (5, 6, 7)", reference: "SELECT p.product_name, p.category_id, 1 + (SELECT count(*) FROM products q WHERE q.category_id = p.category_id AND q.unit_price > p.unit_price) FROM products p WHERE p.category_id IN (5, 6, 7)" },
  { name: "Q01 Product Revenue", sql: "SELECT p.product_id, p.product_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS total_revenue FROM products p JOIN order_details od ON od.product_id = p.product_id GROUP BY p.product_id, p.product_name ORDER BY total_revenue DESC", reference: "SELECT p.product_id, p.product_name, round((SELECT sum(od.unit_price * od.quantity * (1 - od.discount)) FROM order_details od WHERE od.product_id = p.product_id)::numeric, 2) AS t FROM products p WHERE EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id) ORDER BY t DESC" },
];

async function mount(sql: string, reduce = true) {
  localStorage.setItem("sqlp.visual.reduceMotion", reduce ? "reduce" : "full");
  const { VizViewClassic } = await import("../site/components/VizViewClassic");
  const view = render(<MemoryRouter><VizViewClassic sql={sql} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("classic-viz")).toBeTruthy(), { timeout: 30_000 });
  await waitFor(() => expect(screen.getByTestId("rowflow-identity")).toBeTruthy(), { timeout: 30_000 });
  // First render only: the player takes its step count from the playback reducer, which can lag the stages by one render (F5 in the QA report).
  await waitFor(() => expect(Number(screen.getByTestId("classic-progress").getAttribute("aria-valuemax"))).toBe(Number(screen.getByTestId("classic-viz").getAttribute("data-step-count"))), { timeout: 5_000 });
  return view;
}

const REGIONS = ["classic-sql", "classic-step-rail", "classic-explain", "classic-tables", "rowflow", "classic-progress"] as const;
/** What every region of the visualizer says the current step is. */
function snapshot() {
  const idx: Record<string, string | null> = {};
  for (const id of REGIONS) idx[id] = screen.getByTestId(id).getAttribute("data-step-index");
  const bar = screen.getByTestId("classic-progress");
  return {
    idx, root: screen.getByTestId("classic-viz").getAttribute("data-step-index"), count: Number(screen.getByTestId("classic-viz").getAttribute("data-step-count")),
    now: Number(bar.getAttribute("aria-valuenow")), max: Number(bar.getAttribute("aria-valuemax")),
    railCurrent: within(screen.getByTestId("classic-step-rail")).getAllByRole("button").findIndex((b) => b.getAttribute("aria-current") === "step"),
  };
}
/** All six regions, the root, the progress bar and the rail report the same step. */
function expectInSync(n: number, count?: number) {
  const s = snapshot();
  for (const id of REGIONS) expect(s.idx[id], `${id} data-step-index`).toBe(String(n));
  expect(s.root, "classic-viz data-step-index").toBe(String(n));
  expect(s.now, "aria-valuenow is the step number").toBe(n + 1);
  expect(s.max, "aria-valuemax is the number of steps").toBe(s.count);
  expect(s.railCurrent, "the rail marks exactly this step with aria-current").toBe(n);
  expect(within(screen.getByTestId("classic-step-rail")).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "step")).toHaveLength(1);
  if (count !== undefined) expect(s.count).toBe(count);
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next step" }));
const prev = () => fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
const finalCount = () => { const m = /Final result \(([\d,]+) rows?\)/.exec(document.body.textContent ?? ""); return m ? Number(m[1].replace(/,/g, "")) : NaN; };
const text = (id: string) => (screen.getByTestId(id).textContent ?? "").replace(/\s+/g, " ");

describe("every matrix query: contract regions, step count, final result and no Cinema", () => {
  it.each(MATRIX)("$name", async ({ sql, reference }) => {
    await mount(sql);
    // the original visualizer: no Cinema anywhere
    for (const id of ["cinema", "cinema-rail", "cinema-expand", "cinema-empty"]) expect(screen.queryByTestId(id), id).toBeNull();
    // tabs and playback group (existing ids and roles stay)
    for (const t of ["Logical steps", "Flow diagram", "Relationships", "Structure", "Execution plan"]) expect(screen.getByRole("tab", { name: t })).toBeTruthy();
    const group = screen.getByRole("group", { name: "Playback controls" });
    for (const b of ["Restart", "Previous step", "Play", "Next step"]) expect(within(group).getByRole("button", { name: b })).toBeTruthy();
    // the contract's regions exist, the step count is the number of stages the engine found, the rail has one button per step
    const viz = await visualize(sql, run);
    const s = snapshot();
    expect(s.count).toBe(viz.stages.length);
    expectInSync(0, viz.stages.length);
    expect(within(screen.getByTestId("classic-step-rail")).getAllByRole("button")).toHaveLength(viz.stages.length);
    expect(screen.getByTestId("classic-reset")).toBeTruthy();
    // the SQL region marks the active clause with <mark>, and the offsets point at the marked text
    const sqlEl = screen.getByTestId("classic-sql");
    const range = sqlEl.getAttribute("data-range");
    expect(range, "classic-sql data-range on the first step").toMatch(/^\d+,\d+$/);
    const mark = sqlEl.querySelector("mark");
    expect(mark, "a <mark> on the active clause").toBeTruthy();
    const [a, z] = range!.split(",").map(Number);
    expect(sql.slice(a, z).replace(/\s+/g, " ").trim()).toBe((mark!.textContent ?? "").replace(/\s+/g, " ").trim());
    // the final result is the independent result: the count, and the first rows' text cells
    const want = (await pg.query(reference, [], { rowMode: "array" })).rows as unknown as unknown[][];
    expect(finalCount()).toBe(want.length);
    const body = document.body.textContent ?? "";
    for (const r of want.slice(0, 3)) for (const c of r) if (typeof c === "string" && !/^-?[\d.]+$/.test(c)) expect(body, `final result shows "${c}"`).toContain(c);
  });
});

describe("step synchronisation: after every change all regions report the same step", () => {
  const sql = MATRIX[5].sql; // GROUP BY + HAVING + ORDER BY: five or more steps

  it("Next, Previous, rail, Restart, keyboard, End and the timeline keep all six regions in sync from the first step to the last and back", async () => {
    await mount(sql, false);
    const count = snapshot().count;
    expect(count).toBeGreaterThanOrEqual(4);
    expectInSync(0, count);
    for (let i = 1; i < count; i++) { next(); await waitFor(() => expectInSync(i, count)); }
    expect((screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement).disabled).toBe(true);
    for (let i = count - 2; i >= 0; i--) { prev(); await waitFor(() => expectInSync(i, count)); }
    expect((screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement).disabled).toBe(true);
    // the rail: clicking a step seeks to it
    const rail = () => within(screen.getByTestId("classic-step-rail")).getAllByRole("button");
    fireEvent.click(rail()[count - 1]); await waitFor(() => expectInSync(count - 1, count));
    fireEvent.click(rail()[2]); await waitFor(() => expectInSync(2, count));
    // Restart and the Reset button
    fireEvent.click(screen.getByRole("button", { name: "Restart" })); await waitFor(() => expectInSync(0, count));
    next(); next(); await waitFor(() => expectInSync(2, count));
    fireEvent.click(screen.getByTestId("classic-reset")); await waitFor(() => expectInSync(0, count));
    // keyboard on the playback group: ArrowRight, ArrowLeft, End, Home
    const group = screen.getByRole("group", { name: "Playback controls" });
    fireEvent.keyDown(group, { key: "ArrowRight" }); await waitFor(() => expectInSync(1, count));
    fireEvent.keyDown(group, { key: "ArrowRight" }); await waitFor(() => expectInSync(2, count));
    fireEvent.keyDown(group, { key: "ArrowLeft" }); await waitFor(() => expectInSync(1, count));
    fireEvent.keyDown(group, { key: "End" }); await waitFor(() => expectInSync(count - 1, count));
    fireEvent.keyDown(group, { key: "ArrowRight" }); expectInSync(count - 1, count); // no step past the end
    fireEvent.keyDown(group, { key: "Home" }); await waitFor(() => expectInSync(0, count));
    fireEvent.keyDown(group, { key: "ArrowLeft" }); expectInSync(0, count); // no step before the start
    // the timeline slider seeks too
    fireEvent.change(screen.getByLabelText("Timeline"), { target: { value: String(count - 2) } }); await waitFor(() => expectInSync(count - 2, count));
  });

  it("the explanation, the tables and the SQL highlight follow the step: the text changes and the marked clause is the step's clause", async () => {
    await mount(sql, false);
    const count = snapshot().count;
    const seen = new Set<string>();
    const marks: string[] = [];
    for (let i = 0; i < count; i++) {
      await waitFor(() => expectInSync(i, count));
      seen.add(text("classic-explain"));
      marks.push((screen.getByTestId("classic-sql").querySelector("mark")?.textContent ?? "").replace(/\s+/g, " ").trim().toUpperCase());
      if (i < count - 1) next();
    }
    expect(seen.size, "every step has its own explanation").toBe(count);
    // GROUP BY / HAVING / ORDER BY queries: the clause text marked at each step starts with (or contains) that step's keyword
    const labels = within(screen.getByTestId("classic-step-rail")).getAllByRole("button").map((b) => (b.textContent ?? "").trim().toUpperCase());
    labels.forEach((label, i) => {
      if (label === "FROM") expect(marks[i]).toMatch(/FROM|JOIN|PRODUCTS/);
      if (label === "GROUP BY") expect(marks[i]).toMatch(/GROUP BY|CATEGORY_ID/);
      if (label === "HAVING") expect(marks[i]).toMatch(/HAVING|COUNT/);
      if (label === "ORDER BY") expect(marks[i]).toMatch(/ORDER BY|N DESC|CATEGORY_ID/);
      if (label === "SELECT") expect(marks[i]).toMatch(/SELECT|CATEGORY_ID|COUNT/);
    });
  });

  it("playing runs through the steps in order with every region in sync, and pausing stops it", async () => {
    await mount(sql, false);
    const count = snapshot().count;
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.change(screen.getByLabelText("Playback speed"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    const visited: number[] = [];
    await waitFor(() => { const n = Number(screen.getByTestId("classic-progress").getAttribute("data-step-index")); if (visited.at(-1) !== n) visited.push(n); expectInSync(n, count); expect(n).toBe(count - 1); }, { timeout: 30_000, interval: 25 });
    expect(visited[0]).toBe(0);
    expect(visited).toEqual([...visited].sort((a, b) => a - b)); // never goes backwards while playing
    // at the end it stops by itself: the button offers Play again
    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(), { timeout: 10_000 });
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    const at = snapshot().root;
    await new Promise((r) => setTimeout(r, 400));
    expect(snapshot().root).toBe(at);
  });

  it("the row board's Replay keeps the step and the regions in sync", async () => {
    await mount(sql, false);
    next(); next();
    await waitFor(() => expectInSync(2));
    const replay = screen.queryByRole("button", { name: /Replay/ });
    if (replay) fireEvent.click(replay);
    await waitFor(() => expectInSync(2));
  });

  it("stepping, seeking and replaying run no query: the learner's query ran once, every other query is read-only", async () => {
    await mount(sql);
    const before = calls.length;
    const count = snapshot().count;
    for (let i = 1; i < count; i++) next();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(calls.length).toBe(before);
    expect(calls.filter((q) => q === sql)).toHaveLength(1);
    expect(calls.every((q) => /^\s*(select|with|explain)\b/i.test(q))).toBe(true);
  });
});

describe("tables of the step are real: the counts the tables region shows equal independent counts", () => {
  it("the WHERE step shows the number of rows the database keeps; the FROM step shows the table size", async () => {
    await mount(MATRIX[0].sql);
    const rail = () => within(screen.getByTestId("classic-step-rail")).getAllByRole("button");
    const kept = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM products WHERE unit_price > 50")).rows[0].n;
    const all = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM products")).rows[0].n;
    expect(text("classic-tables")).toContain(String(all));
    const where = rail().findIndex((b) => /WHERE/i.test(b.textContent ?? ""));
    expect(where, "the rail has a WHERE step").toBeGreaterThan(-1);
    fireEvent.click(rail()[where]);
    await waitFor(() => expectInSync(where));
    expect(text("classic-tables")).toContain(String(kept));
    expect(text("classic-explain")).toContain(String(kept));
  });

  it("the HAVING step shows both the surviving and the removed group counts", async () => {
    await mount(MATRIX[5].sql);
    const rail = () => within(screen.getByTestId("classic-step-rail")).getAllByRole("button");
    const having = rail().findIndex((b) => /HAVING/i.test(b.textContent ?? ""));
    expect(having).toBeGreaterThan(-1);
    fireEvent.click(rail()[having]);
    await waitFor(() => expectInSync(having));
    const before = (await pg.query<{ n: number }>("SELECT count(DISTINCT category_id)::int AS n FROM products")).rows[0].n;
    const after = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM (SELECT 1 FROM products GROUP BY category_id HAVING count(*) > 8) x")).rows[0].n;
    const t = text("classic-tables") + " " + text("classic-explain");
    expect(t).toContain(String(before));
    expect(t).toContain(String(after));
  });

  it("the LEFT JOIN step mentions NULL padding for the unmatched rows", async () => {
    await mount("SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id");
    expect(text("classic-explain") + " " + text("classic-tables") + " " + text("rowflow")).toMatch(/NULL/);
  });
});

describe("edge cases", () => {
  it("empty result: the visualizer renders, says there are no rows and does not crash; all regions stay in sync to the end", async () => {
    await mount("SELECT * FROM products WHERE unit_price > 1000000");
    expect(finalCount()).toBe(0);
    expect(document.body.textContent).toMatch(/no rows|0 rows|empty|nothing/i);
    const count = snapshot().count;
    for (let i = 1; i < count; i++) { next(); await waitFor(() => expectInSync(i, count)); }
  });

  it("invalid SQL: the error is shown, no result and no stepping controls for a result, nothing throws", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a); });
    localStorage.setItem("sqlp.visual.reduceMotion", "reduce");
    const { VizViewClassic } = await import("../site/components/VizViewClassic");
    render(<MemoryRouter><VizViewClassic sql="SELECT x FROM no_such_table" /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toMatch(/no_such_table|does not exist/i), { timeout: 20_000 });
    expect(screen.queryByText(/Final result/)).toBeNull();
    expect(screen.queryByTestId("cinema")).toBeNull();
    spy.mockRestore();
    expect(errors.filter((e) => /Uncaught|Error:|React will try/i.test(String((e as unknown[])[0])))).toHaveLength(0);
  });

  it("a statement that is not a SELECT is not visualized and never run (the Structure tab opens instead)", async () => {
    localStorage.setItem("sqlp.visual.reduceMotion", "reduce");
    const { VizViewClassic } = await import("../site/components/VizViewClassic");
    render(<MemoryRouter><VizViewClassic sql="DROP TABLE products" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Structure" }).getAttribute("aria-selected")).toBe("true"), { timeout: 20_000 });
    expect(screen.queryByTestId("classic-sql")).toBeNull();
    expect(screen.queryByText(/Final result/)).toBeNull();
    expect(calls.filter((q) => /drop table/i.test(q) && !/^\s*explain\b/i.test(q))).toEqual([]);
    expect((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM products")).rows[0].n).toBe(77);
  });

  it("changing the query resets to step 0 and shows the new query's data", async () => {
    const { VizViewClassic } = await import("../site/components/VizViewClassic");
    localStorage.setItem("sqlp.visual.reduceMotion", "reduce");
    const view = render(<MemoryRouter><VizViewClassic sql={MATRIX[5].sql} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("rowflow-identity")).toBeTruthy(), { timeout: 30_000 });
    next(); next();
    await waitFor(() => expectInSync(2));
    view.rerender(<MemoryRouter><VizViewClassic sql={MATRIX[0].sql} /></MemoryRouter>);
    await waitFor(() => expect(finalCount()).toBe(7), { timeout: 30_000 });
    await waitFor(() => expect(screen.getByTestId("classic-viz").getAttribute("data-step-index")).toBe("0"));
    await waitFor(() => expectInSync(0));
  });
});

describe("reduced motion", () => {
  it("with reduced motion the board is static (data-reduced), the player says so, and nothing in the visualizer carries a transition or an animation class", async () => {
    await mount(MATRIX[5].sql, true);
    expect(screen.getByTestId("rowflow").getAttribute("data-reduced")).toBe("true");
    expect(screen.getByTestId("classic-player").getAttribute("data-reduced")).toBe("true");
    const root = screen.getByTestId("classic-viz");
    const offenders = [...root.querySelectorAll<HTMLElement>("*")].filter((el) => {
      const st = el.getAttribute("style") ?? "";
      const transitioned = /transition(?!:\s*none)/i.test(st) && !/transition(-property)?:\s*(none|0s)/i.test(st);
      const animated = /\banimate-(?!none)\w+/.test(el.getAttribute("class") ?? "") || /animation(?!:\s*none)/i.test(st);
      return transitioned || animated;
    });
    expect(offenders.map((e) => e.outerHTML.slice(0, 120))).toEqual([]);
    next(); next();
    await waitFor(() => expectInSync(2));
  });

  it("with motion on, the board is animated (data-reduced=false)", async () => {
    await mount(MATRIX[5].sql, false);
    expect(screen.getByTestId("rowflow").getAttribute("data-reduced")).toBe("false");
  });
});

describe("the rest of the site is unchanged and has no Cinema (main removed it)", () => {
  it("the shared VizView renders the plain original visualizer: its tabs, no Cinema, none of the classic regions", async () => {
    localStorage.setItem("sqlp.visual.reduceMotion", "reduce");
    const { VizView } = await import("../site/components/VizView");
    render(<MemoryRouter><VizView sql={MATRIX[0].sql} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Final result/)).toBeTruthy(), { timeout: 30_000 });
    expect(screen.queryByTestId("cinema")).toBeNull();
    for (const id of ["classic-viz", "classic-step-rail", "classic-explain", "classic-tables", "classic-sql", "classic-progress"]) expect(screen.queryByTestId(id), id).toBeNull();
  });

  it("source: QuestionPage uses the classic view; the query-visualizer page, the scenarios and the workspace keep the Cinema's VizView", async () => {
    const read = (f: string) => readFile(path.resolve(process.cwd(), f), "utf8");
    const q = await read("src/site/pages/QuestionPage.tsx");
    expect(q).toContain("VizViewClassic");
    expect(q).not.toMatch(/import \{ VizView[,\s}]/);
    expect(q).not.toContain("QueryCinema");
    for (const f of ["src/site/pages/QueryVisualizerPage.tsx", "src/site/pages/ScenarioPages.tsx", "src/site/workspace/visualizers/sql/ClassicSqlVisualizer.tsx"]) {
      const t = await read(f);
      expect(t, f).toMatch(/import \{ VizView[,\s}]/);
      expect(t, f).not.toContain("VizViewClassic");
    }
  });

  it("the classic visualizer does not import the Cinema, its data builder or a second SQL engine", async () => {
    const { readdir } = await import("node:fs/promises");
    const root = path.resolve(process.cwd(), "src/site");
    const files = [
      path.join(root, "components/VizViewClassic.tsx"), path.join(root, "components/visual/RowFlowClassic.tsx"),
      ...(await readdir(path.join(root, "components/visual/classic"))).map((f) => path.join(root, "components/visual/classic", f)),
      ...(await readdir(path.join(root, "lib/visual/classic"))).map((f) => path.join(root, "lib/visual/classic", f)),
    ];
    for (const f of files) {
      const t = await readFile(f, "utf8");
      const imports = t.split("\n").filter((l) => /^\s*(import|export)\b.*from\s+["']/.test(l)).join("\n");
      expect(imports, f).not.toMatch(/QueryCinema|lib\/visual\/cinema|visual\/rowTrace"|visual\/rowFlow"|aggDetail|pyodide|alasql|sql\.js|duckdb/i);
    }
  });
});
