import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import northwind from "../../public/data/northwind.sql?raw";
import type { SqlDb } from "../site/lib/sqlRunner";
import { SqlBackendContext, createDbBackend, type SqlBackend } from "../site/workspace/adapters/sql/backend";
import { createSqlAdapter } from "../site/workspace/adapters/sql/adapter";
import { SqlVisualizer } from "../site/workspace/visualizers/sql/SqlVisualizer";
import { Visualizer } from "../site/workspace/visualizers/sql/LazySqlVisualizer";
import type { ExerciseDef, VisualModel } from "../site/workspace/types";

/** The SQL visualizer in the DOM with a real PostgreSQL (PGlite) behind the adapter. Nothing about rows or plans is faked. */
let pg: PGlite;
let backend: SqlBackend;
const issued: string[] = [];
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
  const b = createDbBackend(pg as unknown as SqlDb);
  backend = { ...b, run: (sql, ds) => { issued.push(sql); return b.run(sql, ds); } };
}, 90_000);
beforeEach(() => {
  issued.length = 0;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const ex: ExerciseDef = {
  id: "sql:ui", domain: "sql", source: { kind: "authored", id: "ui" }, title: "t", difficulty: "Easy", topic: "t", statement: "", objectives: [], concepts: [], starterCode: "", hints: [],
  validation: { kind: "none" },
};
async function modelFor(sql: string): Promise<VisualModel> {
  const adapter = createSqlAdapter({ backend });
  const outcome = await adapter.run(sql, { exercise: ex });
  const m = await adapter.visualize!(sql, outcome, { exercise: ex });
  expect(m).not.toBeNull();
  return m!;
}
function mount(model: VisualModel, p: { step?: number; onStepChange?: (s: number) => void; reducedMotion?: boolean; hostPlayer?: boolean } = {}) {
  return render(
    <SqlBackendContext.Provider value={backend}>
      <SqlVisualizer model={model} step={p.step ?? 0} onStepChange={p.onStepChange ?? (() => undefined)} reducedMotion={p.reducedMotion ?? true} hostPlayer={p.hostPlayer} />
    </SqlBackendContext.Provider>,
  );
}
const tab = (name: RegExp) => fireEvent.click(screen.getByRole("tab", { name }));

const JOIN = "SELECT c.country, COUNT(*) AS orders FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10 GROUP BY c.country HAVING COUNT(*) >= 3 ORDER BY orders DESC, c.country LIMIT 5";

describe("stages and the player", () => {
  it("draws the cinema at the step the host says, and reports a click on the rail", async () => {
    const m = await modelFor(JOIN);
    const seen: number[] = [];
    mount(m, { step: 2, onStepChange: (s) => seen.push(s) });
    expect(screen.getByTestId("cinema").getAttribute("data-index")).toBe("2");
    expect(screen.getByTestId("cinema").getAttribute("data-step")).toMatch(/^where/);
    fireEvent.click(within(screen.getByTestId("cinema-rail")).getAllByRole("button")[4]);
    await waitFor(() => expect(screen.getByTestId("cinema").getAttribute("data-index")).toBe("4"));
    expect(seen).toContain(4);
  });
  it("follows the host: a new step prop moves the cinema without any SQL", async () => {
    const m = await modelFor(JOIN);
    const view = mount(m, { step: 0 });
    issued.length = 0;
    view.rerender(<SqlBackendContext.Provider value={backend}><SqlVisualizer model={m} step={5} onStepChange={() => undefined} reducedMotion /></SqlBackendContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("cinema").getAttribute("data-index")).toBe("5"));
    expect(issued).toEqual([]);
  });
  it("has its own play, back, restart and speed controls, unless the host shows the player", async () => {
    const m = await modelFor(JOIN);
    mount(m);
    const bar = within(screen.getByRole("group", { name: /Playback controls/ }));
    for (const name of ["Restart", "Previous step", "Play", "Next step", "Playback speed"]) expect(bar.getByLabelText(name)).toBeTruthy();
    cleanup();
    mount(m, { hostPlayer: true });
    expect(screen.queryByRole("group", { name: /Playback controls/ })).toBeNull();
    expect(screen.getByTestId("cinema-rail")).toBeTruthy();
  });
  it("Next and Previous move one stage and tell the host", async () => {
    const m = await modelFor(JOIN);
    const seen: number[] = [];
    // A host that follows the visualizer, as the workspace does.
    function Host() {
      const [step, setStep] = useState(0);
      return <SqlBackendContext.Provider value={backend}><SqlVisualizer model={m} step={step} onStepChange={(s) => { seen.push(s); setStep(s); }} reducedMotion /></SqlBackendContext.Provider>;
    }
    render(<Host />);
    fireEvent.click(screen.getByLabelText("Next step"));
    await waitFor(() => expect(screen.getByTestId("cinema").getAttribute("data-index")).toBe("1"));
    fireEvent.click(screen.getByLabelText("Previous step"));
    await waitFor(() => expect(screen.getByTestId("cinema").getAttribute("data-index")).toBe("0"));
    expect(seen).toEqual([1, 0]);
  });
  it("reduced motion draws static boards (no transitions), and says so on the root", async () => {
    const m = await modelFor(JOIN);
    mount(m, { reducedMotion: true, step: 2 });
    expect(screen.getByTestId("sql-visualizer").getAttribute("data-reduced-motion")).toBe("true");
    expect(screen.getByTestId("rowflow").getAttribute("data-reduced")).toBe("true");
    const all = [...screen.getByTestId("rowflow").querySelectorAll<HTMLElement>("*")];
    expect(all.some((el) => el.style.transition !== "" || /\b(transition|animate)/.test(el.getAttribute("class") ?? ""))).toBe(false);
  });
  it("shows the badge for where the data comes from, and the exact final result", async () => {
    const m = await modelFor(JOIN);
    mount(m);
    expect(screen.getAllByText("Executed").length).toBeGreaterThan(0);
    expect(screen.getByText(/Final result \(5 rows\)/)).toBeTruthy();
  });
  it("a model that is not a SQL model gets an honest message, not a crash", () => {
    render(<SqlVisualizer model={{ provenance: "executed", data: { nope: 1 } }} step={0} onStepChange={() => undefined} reducedMotion />);
    expect(screen.getByRole("status").textContent).toMatch(/no SQL data/);
  });
  it("the lazy component the adapter module exports renders the same visualizer", async () => {
    const m = await modelFor(JOIN);
    render(<SqlBackendContext.Provider value={backend}><Visualizer model={m} step={0} onStepChange={() => undefined} reducedMotion /></SqlBackendContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("sql-visualizer")).toBeTruthy(), { timeout: 15_000 });
  });
});

describe("details", () => {
  it("CTEs: each set in dependency order with real counts", async () => {
    const m = await modelFor("WITH a AS (SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id), b AS (SELECT customer_id FROM a WHERE n > 20) SELECT c.company_name FROM customers c JOIN b ON b.customer_id = c.customer_id");
    mount(m);
    tab(/Details/);
    expect(screen.getByTestId("cte-order").textContent).toBe("a → b → main query");
    const direct = (await pg.query<{ c: number }>("SELECT COUNT(DISTINCT customer_id)::int AS c FROM orders")).rows[0].c;
    expect(screen.getByTestId("cte-a").querySelector("p")!.textContent).toMatch(new RegExp(`· ${direct} rows`));
    expect(within(screen.getByTestId("cte-b")).getByText(/reads a/)).toBeTruthy();
  });
  it("correlated subquery: said plainly, no rows drawn", async () => {
    const m = await modelFor("SELECT o.order_id FROM orders o WHERE o.freight > (SELECT AVG(o2.freight) FROM orders o2 WHERE o2.customer_id = o.customer_id)");
    mount(m);
    tab(/Details/);
    const sq = screen.getByTestId("subquery-sq1");
    expect(sq.getAttribute("data-status")).toBe("outer-dependent");
    expect(sq.textContent).toMatch(/Correlated/);
    expect(sq.querySelector("table")).toBeNull();
  });
  it("window functions: partition bands, row numbers and the window value", async () => {
    const m = await modelFor("SELECT product_name, category_id, unit_price, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS r FROM products");
    mount(m);
    tab(/Details/);
    const w = within(screen.getByTestId("window-0"));
    expect(w.getAllByTestId("window-partition").length).toBeGreaterThanOrEqual(3);
    expect(w.getByText(/Partition 1: 1 · 12 row\(s\)/)).toBeTruthy();
    expect(screen.getByTestId("window-0").textContent).toMatch(/OVER \(PARTITION BY category_id ORDER BY unit_price DESC\)/);
  });
  it("groups: member rows, the aggregate and HAVING keeping or removing each group", async () => {
    const m = await modelFor("SELECT c.country, COUNT(*) AS orders, SUM(o.freight) AS freight FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country HAVING COUNT(*) >= 8");
    mount(m);
    tab(/Details/);
    const cards = screen.getAllByTestId("group-card");
    expect(cards.length).toBe(6);
    expect(cards.some((c) => c.getAttribute("data-having") === "true")).toBe(true);
    expect(cards.some((c) => c.getAttribute("data-having") === "false")).toBe(true);
    expect(screen.getByTestId("group-totals").textContent).toMatch(/removed by HAVING/);
    expect(within(cards[0]).getByText(/Member rows/)).toBeTruthy();
  });
  it("NULL: true, false and NULL counts for WHERE, and a CASE table with verdict chips", async () => {
    const m = await modelFor("SELECT customer_id, CASE WHEN region IS NULL THEN 'no region' ELSE region END AS label FROM customers WHERE region <> 'SP'");
    mount(m);
    tab(/Details/);
    expect(screen.getByTestId("null-where").textContent).toMatch(/NULL/);
    expect(screen.getByTestId("case-view").textContent).toMatch(/WHEN 1/);
    expect(screen.getByTestId("sql-detail-nulls").textContent).toMatch(/UNKNOWN/);
  });
  it("a query with nothing to break down says so", async () => {
    const m = await modelFor("SELECT customer_id FROM customers ORDER BY 1 LIMIT 3");
    mount(m);
    tab(/Details/);
    expect(screen.getByRole("status").textContent).toMatch(/no CTE, subquery, window function/);
  });
});

describe("plan: estimates and measured actuals are kept apart", () => {
  it("shows the planner's estimate first, with Plan and Estimated badges and no actuals", async () => {
    const m = await modelFor(JOIN);
    mount(m);
    tab(/Plan/);
    const plan = within(screen.getByTestId("sql-plan"));
    expect(plan.getByText("Plan · EXPLAIN")).toBeTruthy();
    expect(plan.getByText("Estimated")).toBeTruthy();
    expect(screen.getByLabelText("Query plan").textContent).toMatch(/~\d+ rows/);
    expect(screen.queryByTestId("plan-actual")).toBeNull();
    expect(screen.queryByTestId("sql-plan-analyzed")).toBeNull();
  });
  it("EXPLAIN ANALYZE asks first, then shows actual rows and timings next to the estimates", async () => {
    const m = await modelFor(JOIN);
    mount(m);
    tab(/Plan/);
    issued.length = 0;
    fireEvent.click(screen.getByRole("button", { name: /Run EXPLAIN ANALYZE/ }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(/runs your query once more/);
    expect(issued).toEqual([]); // nothing ran before the confirmation
    fireEvent.click(screen.getByRole("button", { name: "Run it" }));
    await waitFor(() => expect(screen.getByTestId("sql-plan-analyzed")).toBeTruthy(), { timeout: 15_000 });
    expect(issued.some((s) => /^EXPLAIN \(ANALYZE, FORMAT JSON\)/.test(s))).toBe(true);
    const actual = screen.getAllByTestId("plan-actual");
    expect(actual.length).toBeGreaterThan(1);
    expect(actual[0].textContent).toMatch(/^actual \d+ rows/);
    expect(screen.getByTestId("sql-plan-analyzed").textContent).toMatch(/execution [\d.]+ ms/);
    expect(screen.getByTestId("plan-estimate-vs-actual").textContent).toMatch(/planner estimated about \d+ row\(s\); the run produced 5/);
  });
  it("Cancel runs nothing", async () => {
    const m = await modelFor(JOIN);
    mount(m);
    tab(/Plan/);
    issued.length = 0;
    fireEvent.click(screen.getByRole("button", { name: /Run EXPLAIN ANALYZE/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(issued).toEqual([]);
    expect(screen.getByRole("button", { name: /Run EXPLAIN ANALYZE/ })).toBeTruthy();
  });
});

describe("compare", () => {
  it("compares the learner's query with an alternative on the exercise's own database", async () => {
    const sql = "SELECT c.customer_id FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)";
    const m = await modelFor(sql);
    mount(m);
    tab(/Compare/);
    const boxes = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(boxes[0].value).toBe(sql);
    fireEvent.change(boxes[1], { target: { value: "SELECT DISTINCT c.customer_id FROM customers c JOIN orders o ON o.customer_id = c.customer_id" } });
    fireEvent.click(screen.getByRole("button", { name: /^Compare$/ }));
    await waitFor(() => expect(screen.getByText(/Output:/)).toBeTruthy(), { timeout: 30_000 });
    expect(screen.getByText(/Output:/).textContent).toMatch(/same|match|identical|equivalent/i);
    expect(screen.getByText(/Logical steps and rows after each/)).toBeTruthy();
    expect(vi.isMockFunction(backend.run)).toBe(false);
  }, 40_000);
});
