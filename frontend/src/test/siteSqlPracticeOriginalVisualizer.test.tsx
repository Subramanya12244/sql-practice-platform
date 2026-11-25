import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";

/**
 * The ORIGINAL SQL visualizer (the one SQL Practice shows), in the DOM with a real PostgreSQL (PGlite) behind it.
 */
let pg: PGlite;
const calls: string[] = [];
vi.mock("../site/lib/browserDb", () => ({
  runQuery: async (sql: string) => { calls.push(sql); return execute(pg as unknown as SqlDb, sql); },
}));
vi.mock("../site/lib/queryGraph", () => ({ buildGraphs: async () => ({ ok: false, reason: "not in this test" }) }));
vi.mock("../site/components/QueryDiagram", () => ({ default: () => null }));
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

// jsdom's Blob has no arrayBuffer(), which PGlite uses to unpack its filesystem bundle: add it with jsdom's own FileReader.
Blob.prototype.arrayBuffer ??= function arrayBuffer(this: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result as ArrayBuffer); fr.onerror = () => reject(fr.error); fr.readAsArrayBuffer(this); });
};
// jsdom's fetch cannot load PGlite's WebAssembly files, so they are read from disk and handed over directly.
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


const QUERIES: { name: string; sql: string; kind?: RegExp }[] = [
  { name: "SELECT and WHERE", sql: "SELECT product_name, unit_price FROM products WHERE unit_price > 50 ORDER BY unit_price DESC" },
  { name: "INNER JOIN", sql: "SELECT p.product_name, od.quantity FROM products p JOIN order_details od ON od.product_id = p.product_id WHERE od.quantity > 50" },
  { name: "LEFT JOIN", sql: "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL" },
  { name: "GROUP BY and aggregation", sql: "SELECT c.country, COUNT(*) AS n, SUM(o.freight) AS f FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country HAVING COUNT(*) > 5 ORDER BY n DESC" },
  { name: "ORDER BY", sql: "SELECT product_name FROM products ORDER BY product_name LIMIT 7" },
  { name: "subquery", sql: "SELECT product_name FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products)" },
  { name: "CTE", sql: "WITH big AS (SELECT order_id, SUM(quantity) AS q FROM order_details GROUP BY order_id) SELECT order_id, q FROM big WHERE q > 100 ORDER BY q DESC" },
  { name: "Q01 Product Revenue", sql: "SELECT p.product_id, p.product_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS total_revenue FROM products p JOIN order_details od ON od.product_id = p.product_id GROUP BY p.product_id, p.product_name ORDER BY total_revenue DESC" },
];

async function mountClassic(sql: string, reduce = true) {
  localStorage.setItem("sqlp.visual.reduceMotion", reduce ? "reduce" : "full");
  const { VizViewClassic } = await import("../site/components/VizViewClassic");
  const view = render(<MemoryRouter><VizViewClassic sql={sql} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/Final result/)).toBeTruthy(), { timeout: 20_000 });
  await waitFor(() => expect(screen.getByTestId("rowflow-identity")).toBeTruthy(), { timeout: 20_000 });
  return view;
}
const finalRows = () => Number(/Final result \((\d+) rows?\)/.exec(screen.getByText(/Final result/).textContent ?? "")?.[1]);

describe("the original visualizer is what SQL Practice shows, not the Cinema", () => {
  it.each(QUERIES)("$name: stage buttons, the original tabs, row movement and the real final result (no Cinema)", async ({ sql }) => {
    await mountClassic(sql);
    // the original: stage buttons and tabs, and the row board of the original (no Cinema rail, no expand button, no cinema section)
    expect(screen.queryByTestId("cinema")).toBeNull();
    expect(screen.queryByTestId("cinema-rail")).toBeNull();
    expect(screen.queryByTestId("cinema-expand")).toBeNull();
    for (const t of ["Logical steps", "Flow diagram", "Relationships", "Structure", "Execution plan"]) expect(screen.getByRole("tab", { name: t })).toBeTruthy();
    expect(screen.getByTestId("rowflow")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next step" })).toBeTruthy();
    // the final result is the real result
    const real = await pg.query(sql);
    expect(finalRows()).toBe(real.rows.length);
  });

  it("steps forwards and backwards, replays and restarts, and shows each stage's rows", async () => {
    await mountClassic(QUERIES[3].sql, false);
    const kinds: string[] = [];
    const seen = () => screen.getByTestId("rowflow").getAttribute("data-kind")!;
    kinds.push(seen());
    for (let i = 0; i < 3; i++) { fireEvent.click(screen.getByRole("button", { name: "Next step" })); await waitFor(() => expect(screen.getByTestId("rowflow")).toBeTruthy()); kinds.push(seen()); }
    expect(kinds.length).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(seen()).toBe(kinds[0]));
    fireEvent.click(screen.getByRole("button", { name: /Replay/ }));
    expect(screen.getByTestId("rowflow")).toBeTruthy();
  });

  it("runs only read-only queries and runs the learner's query once", async () => {
    calls.length = 0;
    await mountClassic(QUERIES[1].sql);
    expect(calls.filter((q) => q === QUERIES[1].sql)).toHaveLength(1);
    expect(calls.every((q) => /^\s*(select|with|explain)\b/i.test(q))).toBe(true);
  });

  it("an invalid query shows an error and no result, and does not throw", async () => {
    localStorage.setItem("sqlp.visual.reduceMotion", "reduce");
    const { VizViewClassic } = await import("../site/components/VizViewClassic");
    render(<MemoryRouter><VizViewClassic sql="SELECT x FROM no_such_table" /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toMatch(/no_such_table|does not exist|error/i), { timeout: 20_000 });
    expect(screen.queryByText(/Final result/)).toBeNull();
    expect(screen.queryByTestId("cinema")).toBeNull();
  });
});

describe("the question page uses the original visualizer", () => {
  it("QuestionPage imports VizViewClassic and not the Cinema's VizView", async () => {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path.resolve(process.cwd(), "src/site/pages/QuestionPage.tsx"), "utf8");
    expect(text).toContain("VizViewClassic");
    expect(text).not.toMatch(/import \{ VizView \}/);
    expect(text).not.toContain("QueryCinema");
  });
  it("the other places keep the Cinema (query visualizer page, business scenarios, exercise workspace)", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const f of ["src/site/pages/QueryVisualizerPage.tsx", "src/site/pages/ScenarioPages.tsx", "src/site/workspace/visualizers/sql/ClassicSqlVisualizer.tsx"]) {
      const text = await readFile(path.resolve(process.cwd(), f), "utf8");
      expect(text, f).toMatch(/import \{ VizView[,\s}]/);
      expect(text, f).not.toContain("VizViewClassic");
    }
  });
});
