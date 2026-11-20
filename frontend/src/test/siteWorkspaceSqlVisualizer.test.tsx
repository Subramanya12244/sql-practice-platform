import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import northwind from "../../public/data/northwind.sql?raw";
import type { SqlDb } from "../site/lib/sqlRunner";
import { createDbBackend, type SqlBackend } from "../site/workspace/adapters/sql/backend";
import { createSqlAdapter } from "../site/workspace/adapters/sql/adapter";
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

const JOIN = "SELECT c.country, COUNT(*) AS orders FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10 GROUP BY c.country HAVING COUNT(*) >= 3 ORDER BY orders DESC, c.country LIMIT 5";


describe("the workspace SQL visualizer", () => {
  it("is the original query visualizer, marked standalone (own player and layout)", async () => {
    expect((Visualizer as { standalone?: boolean }).standalone).toBe(true);
    const m = await modelFor(JOIN);
    const { unmount } = render(<Visualizer model={m} step={0} onStepChange={() => undefined} reducedMotion />);
    expect(screen.getByRole("status").textContent).toMatch(/Loading the query visualizer/); // the lazy original view (VizView) loads next
    unmount();
  });
  it("a model that is not a SQL model gets an honest message, not a crash", async () => {
    const { findByRole } = render(<Visualizer model={{ provenance: "executed", data: { nope: 1 } }} step={0} onStepChange={() => undefined} reducedMotion />);
    expect((await findByRole("status")).textContent).toMatch(/no SQL data|Loading the query visualizer/);
  });
});
