import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";

/**
 * The Query Cinema in the DOM, with a real PostgreSQL (PGlite) behind it: the pipeline rail, the stage's rows and verdicts,
 * the counts, the keyboard, and the guarantee that moving through the stages runs no query.
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

const SQL = `SELECT c.country, COUNT(*) AS orders
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
WHERE o.freight > 10
GROUP BY c.country
HAVING COUNT(*) >= 3
ORDER BY orders DESC, c.country
LIMIT 5`;

async function mount(reduce = true, sql = SQL) {
  localStorage.setItem("sqlp.visual.reduceMotion", reduce ? "reduce" : "full");
  const { VizView } = await import("../site/components/VizView");
  const view = render(<MemoryRouter><VizView sql={sql} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("cinema")).toBeTruthy(), { timeout: 15_000 });
  await waitFor(() => expect(screen.getByTestId("rowflow-identity").textContent).toMatch(/real \(ctid\)/), { timeout: 15_000 });
  return view;
}
const rail = () => within(screen.getByTestId("cinema-rail"));
const go = async (name: RegExp | string) => { fireEvent.click(rail().getByRole("button", { name: new RegExp(`^${name}`, "i") })); await waitFor(() => expect(screen.getByTestId("cinema-title").textContent).toMatch(new RegExp(String(name), "i"))); };
const n = async (q: string) => { const r = await pg.query<{ c: string | number }>(q); return Number(r.rows[0].c); };

describe("the pipeline", () => {
  it("lists every stage in logical order with the rows each receives and passes on, and marks the current one", async () => {
    await mount();
    const buttons = rail().getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("data-step"))).toEqual(["from", "join:0", "where:1", "group by:2", "having:3", "select:4", "order by:5", "limit:6"]);
    expect(buttons[0].getAttribute("aria-current")).toBe("step");
    expect(buttons[0].getAttribute("data-state")).toBe("active");
    expect(buttons[1].getAttribute("data-state")).toBe("next");
    const where = await n("SELECT COUNT(*) AS c FROM orders WHERE freight > 10");
    expect(buttons[2].textContent).toContain(`100 → ${where}`);
    expect(buttons[7].textContent).toContain("12 → 5");
  });
  it("clicking a stage moves there; earlier stages become done, later ones stay upcoming", async () => {
    await mount();
    await go("WHERE");
    const states = rail().getAllByRole("button").map((b) => b.getAttribute("data-state"));
    expect(states).toEqual(["done", "done", "active", "next", "next", "next", "next", "next"]);
    expect(screen.getByTestId("cinema").getAttribute("data-step")).toMatch(/^where/);
  });
  it("says the order is logical, not PostgreSQL's physical plan", async () => {
    await mount();
    expect(screen.getByText(/Logical order: how SQL defines the result/).textContent).toMatch(/PostgreSQL may run the query differently/);
  });
});

describe("the stage canvas", () => {
  it("FROM draws the real rows of the first table as table rows with column headers and an exact count", async () => {
    await mount();
    expect(screen.getByTestId("cinema-title").textContent).toMatch(/FROM — read customers c/);
    expect(screen.getByTestId("cinema-counts").textContent).toContain("91");
    const rows = [...screen.getByTestId("rowflow").querySelectorAll<HTMLElement>("[data-card]")];
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => r.dataset.card!.startsWith("L:"))).toBe(true);
    expect(rows[0].textContent).toMatch(/ALFKI/);
  });
  it("JOIN shows the left table, the right table and the result, with matched rows coloured alike", async () => {
    await mount();
    await go("JOIN");
    const board = within(screen.getByTestId("rowflow"));
    expect(board.getAllByRole("list").length).toBeGreaterThan(0);
    const cards = [...screen.getByTestId("rowflow").querySelectorAll<HTMLElement>("[data-card]")];
    const left = cards.filter((c) => c.dataset.card!.startsWith("L:")), right = cards.filter((c) => c.dataset.card!.startsWith("R:"));
    expect(left.length).toBeGreaterThan(3);
    expect(right.length).toBeGreaterThan(3);
    expect(cards.some((c) => c.dataset.tone === "matched")).toBe(true);
    expect(cards.some((c) => c.dataset.tone === "removed")).toBe(true); // FISSA and PARIS have no orders
    expect(left.filter((c) => c.dataset.group !== undefined).length).toBeGreaterThan(0);
    expect(screen.getByTestId("cinema-counts").textContent).toContain("91");
    expect(screen.getByTestId("cinema-counts").textContent).toContain("100");
  });
  it("WHERE shows each row's verdict: true rows go to Kept, false rows to Removed", async () => {
    await mount();
    await go("WHERE");
    const chips = screen.getAllByTestId("rowflow-verdict").map((c) => c.textContent!.trim());
    expect(chips.some((t) => /true$/.test(t))).toBe(true);
    expect(chips.some((t) => /false$/.test(t))).toBe(true);
    const cards = [...screen.getByTestId("rowflow").querySelectorAll<HTMLElement>("[data-card][data-verdict]")];
    for (const c of cards) expect(c.dataset.tone).toBe(c.dataset.verdict === "true" ? "kept" : "removed");
    expect(screen.getByTestId("cinema-counts").textContent).toMatch(/100.*in.*→/);
  });
  it("HAVING shows each group's aggregate and the comparison", async () => {
    await mount();
    await go("HAVING");
    const cards = [...screen.getByTestId("rowflow").querySelectorAll<HTMLElement>("[data-card][data-verdict]")];
    expect(cards.length).toBeGreaterThan(5);
    for (const c of cards) {
      const count = Number(c.textContent!.match(/\s(\d+)\s*[✓✕∅]/)?.[1] ?? c.textContent!.match(/(\d+)/)?.[1]);
      expect(c.dataset.verdict).toBe(count >= 3 ? "true" : "false");
    }
    expect(within(screen.getByTestId("rowflow")).getByLabelText("Legend").textContent).toMatch(/unknown counts as not true/);
  });
  it("answers what SQL does, why, which rows changed and what happens without the clause, with the real numbers", async () => {
    await mount();
    await go("WHERE");
    const box = within(screen.getByTestId("cinema-insights"));
    expect(box.getByText("What SQL does here")).toBeTruthy();
    expect(box.getByText("Why this stage")).toBeTruthy();
    const where = await n("SELECT COUNT(*) AS c FROM orders WHERE freight > 10");
    expect(screen.getByTestId("cinema-insights").textContent).toContain(`All 100 rows would continue instead of ${where}`);
    expect(screen.getByTestId("cinema-insights").textContent).toContain(`${100 - where} of 100 removed; ${where} kept.`);
  });
  it("a stage with no row-level picture shows its table and says why instead of an empty canvas", async () => {
    await mount(true, "SELECT category_id, product_name, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS r FROM products");
    await go("WINDOW");
    expect(screen.getByTestId("cinema-table-only")).toBeTruthy();
    expect(screen.getByTestId("cinema-table-only").textContent).toMatch(/Window functions/);
  });
  it("shows the final result, and it is the query's real result", async () => {
    await mount();
    const final = screen.getByText(/Final result/).parentElement!.querySelector("table")!;
    const real = await pg.query(SQL);
    expect(final.querySelectorAll("tbody tr")).toHaveLength(real.rows.length);
    expect(final.textContent).toContain("France");
  });
});

describe("controls", () => {
  it("the keyboard works on the cinema: arrows step, Home restarts, End goes to the last stage, Space plays and pauses", async () => {
    await mount();
    const cinema = screen.getByTestId("cinema");
    const idx = () => Number(cinema.getAttribute("data-index"));
    fireEvent.keyDown(cinema, { key: "ArrowRight" });
    fireEvent.keyDown(cinema, { key: "ArrowRight" });
    expect(idx()).toBe(2);
    fireEvent.keyDown(cinema, { key: "ArrowLeft" });
    expect(idx()).toBe(1);
    fireEvent.keyDown(cinema, { key: "End" });
    expect(idx()).toBe(7);
    fireEvent.keyDown(cinema, { key: "Home" });
    expect(idx()).toBe(0);
    fireEvent.keyDown(cinema, { key: " " });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.keyDown(cinema, { key: " " });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });
  it("one key press is one step, even though the playback bar also listens", async () => {
    await mount();
    const bar = screen.getByRole("group", { name: "Playback controls" });
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(screen.getByTestId("cinema").getAttribute("data-index")).toBe("1");
  });
  it("the timeline scrubs to any stage and the speed can be changed", async () => {
    await mount();
    fireEvent.change(screen.getByRole("slider", { name: "Timeline" }), { target: { value: "4" } });
    expect(screen.getByTestId("cinema-title").textContent).toMatch(/HAVING/);
    fireEvent.change(screen.getByRole("combobox", { name: "Playback speed" }), { target: { value: "2" } });
    expect((screen.getByRole("combobox", { name: "Playback speed" }) as HTMLSelectElement).value).toBe("2");
  });
  it("moving through every stage, backwards and forwards, and restarting runs no query", async () => {
    await mount();
    const before = calls.length;
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await go("LIMIT");
    expect(calls.length).toBe(before);
    expect(calls.filter((q) => q.trim() === SQL).length).toBe(1);
  });
});

describe("motion", () => {
  it("reduced motion shows static Before and After boards with the same verdicts and no transitions", async () => {
    await mount(true);
    await go("WHERE");
    const flow = screen.getByTestId("rowflow");
    expect(flow.getAttribute("data-reduced")).toBe("true");
    expect(within(flow).getByLabelText("Before this stage")).toBeTruthy();
    expect(within(flow).getByLabelText("After this stage")).toBeTruthy();
    const all = [flow, ...flow.querySelectorAll<HTMLElement>("*")];
    expect(all.some((el) => el.style.transition !== "" || /\b(transition|animate)/.test(el.getAttribute("class") ?? ""))).toBe(false);
  });
  it("with motion on, a stage plays in three beats and the rows really move: evaluate first, then travel", async () => {
    await mount(false);
    await go("WHERE");
    const flow = screen.getByTestId("rowflow");
    const first = () => flow.querySelector<HTMLElement>('[data-card][data-verdict="true"]')?.style.transform;
    await waitFor(() => expect(flow.getAttribute("data-phase")).toBe("1"), { timeout: 4000 });
    const evaluating = first();
    expect(flow.querySelector('[data-testid="rowflow-verdict"]')).toBeTruthy(); // verdicts show before anything moves
    await waitFor(() => expect(flow.getAttribute("data-phase")).toBe("2"), { timeout: 4000 });
    const moved = first();
    expect(evaluating).toMatch(/^translate\(0%/);
    expect(moved).not.toBe(evaluating);
    expect(moved).toMatch(/^translate\(100%/); // into the Kept lane
  });
  it("Before and After pause the animation on either end of the move", async () => {
    await mount(false);
    await go("WHERE");
    fireEvent.click(screen.getByRole("button", { name: "Before" }));
    expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "After" }));
    expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("2");
  });
});
