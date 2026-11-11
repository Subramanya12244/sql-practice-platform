import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../contexts/ThemeContext";

// The labs run SQL in a browser worker; the page itself is what is under test here.
vi.mock("../site/lib/browserDb", () => ({
  registerDataset: () => undefined,
  runQuery: async () => ({ success: true, columns: [], rows: [] }),
  getDb: async () => ({ db: { exec: async () => [] }, terminate: () => undefined }),
}));
import { DqExercisesPage } from "../site/pages/GuidedLabPages";
import { DQ_EXERCISES } from "../site/lib/lab/dqContent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;

const page = (url: string) => <ThemeProvider><MemoryRouter initialEntries={[url]}><DqExercisesPage /></MemoryRouter></ThemeProvider>;
const dedupe = DQ_EXERCISES.find((e) => e.id === "dq-dedupe")!;
const first = DQ_EXERCISES[0];

/**
 * The site is prerendered without a query string, then hydrated at whatever URL the visitor opened.
 * Hydrating `/dq-exercises?e=dq-dedupe` over the markup of `/dq-exercises` must not report a mismatch.
 */
async function hydrate(visited: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = renderToString(page("/dq-exercises")); // what the static HTML contains
  const recoverable: unknown[] = [];
  const consoleErrors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a) => { consoleErrors.push(a.map(String).join(" ")); });
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, page(visited), { onRecoverableError: (e) => recoverable.push(e) }); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  spy.mockRestore();
  return { container, root, recoverable, consoleErrors: consoleErrors.filter((m) => /hydrat|did not match|425|418|423/i.test(m)) };
}

let mounted: Awaited<ReturnType<typeof hydrate>> | null = null;
afterEach(() => { mounted?.root.unmount(); mounted?.container.remove(); mounted = null; });

describe("guided lab pages hydrate cleanly over the prerendered HTML", () => {
  it("/dq-exercises hydrates without a mismatch and shows the first exercise", async () => {
    mounted = await hydrate("/dq-exercises");
    expect(mounted.recoverable).toEqual([]);
    expect(mounted.consoleErrors).toEqual([]);
    expect(mounted.container.textContent).toContain(first.title);
  });

  it("/dq-exercises?e=dq-dedupe hydrates without a mismatch, then shows the linked exercise", async () => {
    mounted = await hydrate("/dq-exercises?e=dq-dedupe");
    expect(mounted.recoverable).toEqual([]);
    expect(mounted.consoleErrors).toEqual([]);
    expect(mounted.container.textContent).toContain(dedupe.title);
    expect(mounted.container.querySelector('[aria-current="true"]')?.textContent).toContain(dedupe.title);
  });

  it("an unknown ?e= falls back to the first exercise instead of failing", async () => {
    mounted = await hydrate("/dq-exercises?e=does-not-exist");
    expect(mounted.recoverable).toEqual([]);
    expect(mounted.container.querySelector('[aria-current="true"]')?.textContent).toContain(first.title);
  });
});
