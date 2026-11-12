// Execution equivalence in the UI: grading a Daily Learning exercise must give the same verdict, the same stored progress, the same
// Mistake Notebook entries and the same study time whether the "Explain visually" block was never opened (A) or was opened and a
// real trace was run before and between the checks (B). The Python runner is replaced by a stand-in that grades from `py.result`
// and, for the tracer program only, runs it in REAL CPython, so B shows the real trace panel.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getProgress, replaceProgress } from "../site/lib/progress";
import { getActive, saveActive, settle } from "../site/lib/solveSessions";
import { loadDay } from "../site/lib/daily";
import { studySec } from "../site/lib/dailyStudy";

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;

const page = vi.hoisted(() => ({ value: { data: {} as Record<string, unknown>, params: {} as Record<string, string> } }));
const py = vi.hoisted(() => ({
  result: { ok: true, stdout: "", error: "", ms: 1 } as { ok: boolean; stdout: string; error: string; ms: number },
  calls: [] as { traced: boolean; code: string; tests?: string }[],
  python: "python3",
}));
vi.mock("../site/SiteApp", () => ({ usePage: () => page.value }));
vi.mock("../site/lib/pyRunner", async (importOriginal) => {
  const real = await importOriginal<typeof import("../site/lib/pyRunner")>();
  const { spawnSync: sp } = await import("node:child_process");
  return {
    ...real,
    PY_TIMEOUT_MS: 1000,
    runPython: async (code: string, tests?: string) => {
      const traced = code.includes("DFTRACE");
      py.calls.push({ traced, code, tests });
      if (traced) {
        const r = sp(py.python, ["-s", "-"], { input: code, encoding: "utf8", timeout: 60_000 });
        return { ok: r.status === 0, stdout: r.stdout, error: r.stderr, ms: 1 };
      }
      return py.result;
    },
  };
});
vi.mock("../site/components/CodeEditor", () => ({ default: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} /> }));
import { DailyLessonPage } from "../site/pages/DailyPages";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class { observe() {} disconnect() {} unobserve() {} };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

beforeEach(() => {
  py.python = PYTHON;
  py.calls = [];
  localStorage.clear();
  replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Study-session ids are random per session; everything else must match. */
const noIds = (d: unknown) => JSON.parse(JSON.stringify(d), (k, v) => (k === "id" ? undefined : v));
const NOW = Date.parse("2026-11-11T10:00:00Z");

/** One learner session on d001's first guided exercise; `visual` opens the block and traces before and between the checks. */
async function session(visual: boolean) {
  vi.useRealTimers(); // a previous session left the fake clock at its last instant
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  const day = await loadDay("d001");
  const wrong = { ok: true, stdout: "definitely wrong output\n", error: "", ms: 1 };
  const right = { ok: true, stdout: `${day!.guided[0].expected}\n`, error: "", ms: 1 };
  page.value = { data: { index: [], topics: [], dailyContent: day, dailyLinks: [] }, params: { n: "1" } };
  const { unmount } = render(<MemoryRouter><DailyLessonPage /></MemoryRouter>);
  const steps = await screen.findByRole("list", { name: "Lesson steps" });
  fireEvent.click(within(steps).getByRole("button", { name: /Guided/ }));
  const card = screen.getByLabelText(/^Exercise 1:/);
  const check = within(card).getByRole("button", { name: "Check answer" });
  const verdicts: string[] = [];
  const readVerdict = () => within(card).queryAllByRole("status").map((n) => n.textContent ?? "").filter((t) => /pass|not|match|expected|output|wrong|correct/i.test(t)).pop() ?? "";

  let traced = false;
  const openAndTrace = async () => {
    const summary = within(card).getByText("Explain visually", { selector: "summary" });
    const details = summary.closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const machine = await within(card).findByRole("region", { name: "Python code time machine" });
    fireEvent.click(within(machine).getByRole("button", { name: "Explain visually" }));
    await within(card).findByRole("list", { name: "Source code" }, { timeout: 30_000 });
    traced = true;
  };

  if (visual) await openAndTrace();
  py.result = wrong; fireEvent.click(check);
  await waitFor(() => expect(getProgress().mistakes?.["daily:d001#g1"]?.count).toBe(1));
  verdicts.push(readVerdict());
  if (visual) { fireEvent.click(await within(card).findByRole("button", { name: "Trace again" })); await waitFor(() => expect(py.calls.filter((c) => c.traced).length).toBe(2), { timeout: 30_000 }); }
  fireEvent.click(check);
  await waitFor(() => expect(getProgress().mistakes?.["daily:d001#g1"]?.count).toBe(2));
  verdicts.push(readVerdict());
  py.result = right; fireEvent.click(check);
  await waitFor(() => expect(getProgress().mistakes!["daily:d001#g1"].solved).toBeTruthy());
  verdicts.push(readVerdict());

  // study time: the same two heartbeats in both runs, then leave the lesson (which stores the session)
  vi.setSystemTime(NOW + 20_000); act(() => saveActive(settle(getActive("day:d001")!, Date.now())));
  vi.setSystemTime(NOW + 40_000); act(() => saveActive(settle(getActive("day:d001")!, Date.now())));
  unmount();
  const p = getProgress();
  const study = (p.daily?.days.d001?.study ?? []).map(({ id: _id, ...s }) => s); // ids are random per session
  return { p, study, studySec: studySec(p.daily!.days.d001), verdicts, traced, graded: py.calls.filter((c) => !c.traced).map((c) => ({ code: c.code, tests: c.tests })), traceCalls: py.calls.filter((c) => c.traced).length };
}

describe.skipIf(!hasPython)("equivalence (UI): grading a Daily Learning exercise with and without the visual block", () => {
  it("verdicts, progress, mistake notebook and study time are identical", async () => {
    const a = await session(false);
    cleanup();
    localStorage.clear();
    replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
    py.calls = [];
    const b = await session(true);

    // B really traced (twice, in real CPython), A never did: the comparison is not vacuous.
    expect(a.traceCalls).toBe(0);
    expect(b.traceCalls).toBe(2);
    expect(b.traced).toBe(true);

    expect(b.verdicts, "verdict text after each check").toEqual(a.verdicts);
    expect(b.verdicts[2]).toMatch(/pass|correct|match/i);
    expect(b.graded, "the code and tests sent for grading are the same").toEqual(a.graded);
    expect(noIds(b.p.daily), "Progress.daily (passed, attempted, drafts, check, study ...)").toEqual(noIds(a.p.daily));
    expect(b.p.mistakes, "mistake notebook entries").toEqual(a.p.mistakes);
    expect(b.p.activeDays).toEqual(a.p.activeDays);
    expect(b.p.dayCounts).toEqual(a.p.dayCounts);
    expect(b.p.revision).toEqual(a.p.revision);
    expect(b.p.sessions ?? []).toEqual(a.p.sessions ?? []);
    expect(b.studySec).toBe(a.studySec);
    expect(b.study).toEqual(a.study);
    expect(a.studySec).toBe(40); // the timer really recorded time, so equal zeros would not pass
    // Nothing the visual block does leaks into storage: no trace, no source text in what is persisted besides the normal draft.
    const stored = JSON.stringify(getProgress());
    expect(stored).not.toContain("DFTRACE");
    expect(stored).not.toContain("frames");
  }, 120_000);

  it("opening the visual block alone (no trace run) changes nothing", async () => {
    const day = await loadDay("d001");
    page.value = { data: { index: [], topics: [], dailyContent: day, dailyLinks: [] }, params: { n: "1" } };
    render(<MemoryRouter><DailyLessonPage /></MemoryRouter>);
    const steps = await screen.findByRole("list", { name: "Lesson steps" });
    fireEvent.click(within(steps).getByRole("button", { name: /Guided/ }));
    const card = screen.getByLabelText(/^Exercise 1:/);
    const details = within(card).getByText("Explain visually", { selector: "summary" }).closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await within(card).findByRole("region", { name: "Python code time machine" });
    expect(py.calls).toEqual([]);
    expect(getProgress().mistakes ?? {}).toEqual({});
    expect(JSON.stringify(getProgress().daily?.days.d001?.passed ?? [])).toBe("[]");
    expect(getProgress().daily?.days.d001?.attempted ?? []).toEqual([]);
  });
});
