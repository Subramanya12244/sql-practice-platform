// Daily Learning inside the unified workspace: one source of truth. The embedded workspace and the in-page runner must leave the SAME
// records (Progress.daily, Mistake Notebook, completion event, activity events) for the same learner actions, a draft must survive a
// remount, two exercises of one lesson must not share state, and nothing may be marked passed by opening, running or asking for help.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { getProgress, replaceProgress } from "../site/lib/progress";
import { loadDay, type DayExtras, type Exercise } from "../site/lib/daily";
import { useDaily } from "../site/lib/useDaily";
import { ExerciseRunner } from "../site/components/daily/LessonUi";
import { registerAdapter, resetRegistry } from "../site/workspace/registry";
import { dailyEmbedDecision } from "../site/workspace/dailyPort";
import { DRAFT_SAVE_MS } from "../site/lib/dailyExercise";

const py = vi.hoisted(() => ({ result: { ok: true, stdout: "", error: "", ms: 1 } as { ok: boolean; stdout: string; error: string; ms: number; phase?: string } }));
const events = vi.hoisted(() => ({ list: [] as unknown[][] }));
const sqlGate = vi.hoisted(() => ({ ok: true }));
vi.mock("../site/workspace/dailyPort", async (importOriginal) => {
  const real = await importOriginal<typeof import("../site/workspace/dailyPort")>();
  return { ...real, sqlWorkspaceRunnable: async () => (sqlGate.ok ? { ok: true } : { ok: false, reason: "refused for the test" }) };
});
vi.mock("../site/lib/pyRunner", async (importOriginal) => {
  const real = await importOriginal<typeof import("../site/lib/pyRunner")>();
  return { ...real, PY_TIMEOUT_MS: 1000, runPython: async () => py.result, stopPython: () => undefined };
});
vi.mock("../site/lib/activity", async (importOriginal) => {
  const real = await importOriginal<typeof import("../site/lib/activity")>();
  return { ...real, track: (...a: unknown[]) => { events.list.push(a); } };
});
vi.mock("../site/components/CodeEditor", () => ({ default: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} /> }));

// A desktop-width screen, so the compact workspace stacks its panes (on a phone it shows tabs).
window.matchMedia = ((q: string) => ({ matches: !/prefers-reduced-motion|hover:\s*none|pointer:\s*coarse/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class { observe() {} disconnect() {} unobserve() {} };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

let day: DayExtras;
beforeEach(async () => {
  localStorage.clear();
  events.list = [];
  resetRegistry();
  replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
  day = (await loadDay("d001"))!;
});
afterEach(() => { cleanup(); vi.useRealTimers(); resetRegistry(); });

/** Renders the exercises the lesson page renders, with the live record from the store (as DailyLessonPage does). */
function Harness({ dayId, items, legacy }: { dayId: string; items: { ex: Exercise; guided: boolean }[]; legacy?: boolean }) {
  const view = useDaily();
  return <>{items.map(({ ex, guided }, i) => <ExerciseRunner key={ex.id} dayId={dayId} ex={ex} guided={guided} rec={view.state.days[dayId]} index={i} legacy={legacy} />)}</>;
}
const pageCtx = vi.hoisted(() => ({ value: { data: {} as Record<string, unknown>, params: {} as Record<string, string> } }));
vi.mock("../site/SiteApp", () => ({ usePage: () => pageCtx.value }));
function Lesson({ Page, day: d }: { Page: () => React.ReactElement | null; day: DayExtras }) {
  pageCtx.value = { data: { index: [], topics: [], dailyContent: d, dailyLinks: [] }, params: { n: "1" } };
  return <Page />;
}
const mount = (items: { ex: Exercise; guided: boolean }[], legacy = false, dayId = "d001") => render(<MemoryRouter><Harness dayId={dayId} items={items} legacy={legacy} /></MemoryRouter>);
const g = (i: number) => ({ ex: day.guided[i], guided: true });

/** Progress with every timestamp replaced, so two sessions can be compared. */
const stable = () => JSON.parse(JSON.stringify(getProgress()), (_k, v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? "<time>" : v));
const WRONG = { ok: true, stdout: "definitely wrong output\n", error: "", ms: 1 };
const right = () => ({ ok: true, stdout: `${day.guided[0].expected}\n`, error: "", ms: 1 });

/** One learner session on d001/g1 in the given screen. */
async function checkOnce(legacy: boolean, result: typeof py.result) {
  py.result = result;
  const card = screen.getByLabelText(/^Exercise 1:/);
  fireEvent.click(within(card).getByRole("button", { name: legacy ? "Check answer" : /^Submit/ }));
}
async function sessionOn(legacy: boolean, steps: (typeof py.result)[], opts: { run?: boolean } = {}) {
  cleanup();
  localStorage.clear();
  events.list = [];
  replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
  mount([g(0)], legacy);
  const card = () => screen.getByLabelText(/^Exercise 1:/);
  if (!legacy) fireEvent.click(within(card()).getByRole("button", { name: "Open the exercise" }));
  if (!legacy) await within(card()).findByRole("button", { name: /^Submit/ });
  if (opts.run) {
    py.result = steps[0];
    fireEvent.click(within(card()).getByRole("button", { name: legacy ? "Run" : /^Run/ }));
    await waitFor(() => expect(events.list.some((e) => e[0] === "python_executed")).toBe(true));
  }
  let n = 0;
  for (const r of steps) {
    n++;
    // A real program gives the same output for the same code, and the workspace reuses the last run of unchanged code, so each try edits the code.
    fireEvent.change(await within(card()).findByRole("textbox"), { target: { value: `print("try ${n}")` } });
    await checkOnce(legacy, r);
    await waitFor(() => expect(events.list.filter((e) => e[0] === "python_submitted").length).toBe(n));
  }
  await act(async () => { await Promise.resolve(); });
  return { progress: stable(), events: JSON.parse(JSON.stringify(events.list.map((e) => [e[0], e[1], e[2]]))) };
}

describe("one store, two screens: the embedded workspace writes what the in-page runner wrote", () => {
  it("wrong, wrong, right: same Progress.daily, same Mistake Notebook, same completion event, same activity events", async () => {
    const a = await sessionOn(true, [WRONG, WRONG, right()]);
    cleanup();
    const b = await sessionOn(false, [WRONG, WRONG, right()]);
    expect(b.progress).toEqual(a.progress);
    expect(b.events).toEqual(a.events);
    const p = getProgress();
    expect(p.daily!.days.d001.passed).toEqual(["g1"]);
    expect(p.lessons?.["daily:d001#g1"]).toBeTruthy(); // completeExercise ran
    expect(p.mistakes!["daily:d001#g1"].count).toBe(2);
    expect(p.mistakes!["daily:d001#g1"].categories["wrong-output"]).toBe(2);
    expect(p.mistakes!["daily:d001#g1"].solved).toBeTruthy();
    expect(a.events.map((e: unknown[]) => e[0])).toEqual(["python_submitted", "python_submitted", "python_submitted"]);
    expect(a.events[2][2]).toEqual({ passed: true });
  });

  it("a Run is an activity event only; both screens emit python_executed and write nothing else", async () => {
    const a = await sessionOn(true, [WRONG], { run: true });
    cleanup();
    const b = await sessionOn(false, [WRONG], { run: true });
    expect(b.events).toEqual(a.events);
    expect(a.events.map((e: unknown[]) => e[0])).toEqual(["python_executed", "python_submitted"]);
    expect(b.progress).toEqual(a.progress);
  });

  it("a crash is filed under the exception's category in both screens (NameError is names, not wrong-output)", async () => {
    const crash = { ok: false, stdout: "", error: "Traceback (most recent call last):\n  File \"<exec>\", line 1, in <module>\nNameError: name 'x' is not defined", ms: 1, phase: "code" };
    const a = await sessionOn(true, [crash]);
    cleanup();
    const b = await sessionOn(false, [crash]);
    expect(a.progress.mistakes["daily:d001#g1"].categories).toEqual({ names: 1 });
    expect(b.progress.mistakes["daily:d001#g1"].categories).toEqual({ names: 1 });
    expect(b.progress).toEqual(a.progress);
  });

  it("no code is stored in the Mistake Notebook, and a first-try pass records no mistake", async () => {
    const { progress } = await sessionOn(false, [right()]);
    expect(progress.mistakes ?? {}).toEqual({});
    expect(progress.daily.days.d001.passed).toEqual(["g1"]);
    const c = await sessionOn(false, [WRONG]);
    expect(JSON.stringify(c.progress.mistakes)).not.toContain("definitely wrong");
  });
});

describe("opening, running, hints and the solution never mark anything passed", () => {
  it("open + run + every hint + visualize leaves no pass, no mistake, no completion event", async () => {
    py.result = WRONG;
    mount([g(0)]);
    const card = () => screen.getByLabelText(/^Exercise 1:/);
    const before = stable();
    fireEvent.click(within(card()).getByRole("button", { name: "Open the exercise" }));
    await within(card()).findByRole("button", { name: /^Run/ });
    fireEvent.click(within(card()).getByRole("button", { name: /^Run/ }));
    await within(card()).findByText(/Ran without errors/);
    fireEvent.click(within(card()).getByRole("button", { name: "Expand Explanation" }));
    for (let i = 0; i < 6; i++) {
      const b = within(card()).queryByRole("button", { name: /^Show level/ });
      if (!b) break;
      fireEvent.click(b);
    }
    const viz = within(card()).queryByRole("button", { name: /^Visualize/ });
    if (viz) { fireEvent.click(viz); await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); }
    const p = getProgress();
    expect(p.daily?.days.d001?.passed).toBeUndefined();
    expect(p.daily?.days.d001?.completedAt).toBeUndefined();
    expect(p.lessons?.["daily:d001#g1"]).toBeUndefined();
    expect(p.mistakes ?? {}).toEqual({}); // ungraded run errors are not recorded for Daily, as before
    expect(events.list.map((e) => e[0]).filter((t) => t === "python_submitted")).toEqual([]);
    expect(events.list.some((e) => e[0] === "python_executed")).toBe(true);
    // only the "visited" bookkeeping may differ from the untouched store
    expect(stable().daily?.days?.d001?.attempted).toBeUndefined();
    void before;
  });

  it("the solution stays locked until every hint was opened or two checks failed; showing it passes nothing", async () => {
    py.result = WRONG;
    mount([g(0)]);
    const card = () => screen.getByLabelText(/^Exercise 1:/);
    fireEvent.click(within(card()).getByRole("button", { name: "Open the exercise" }));
    await within(card()).findByRole("button", { name: /^Submit/ });
    expect(within(card()).getByText(/A solution unlocks after you have used all the hints or tried twice/)).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: /a solution/i })).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: /^Submit/ }));
    await waitFor(() => expect(getProgress().mistakes?.["daily:d001#g1"]?.count).toBe(1));
    expect(within(card()).queryByRole("button", { name: /a solution/i })).toBeNull();
    await within(card()).findByText(/Not yet/);
    fireEvent.click(within(card()).getByRole("button", { name: /^Submit/ }));
    await waitFor(() => expect(getProgress().mistakes?.["daily:d001#g1"]?.count).toBe(2));
    const show = await within(card()).findByRole("button", { name: /Show a solution/ });
    fireEvent.click(show);
    expect(within(card()).getByText(/does not pass the exercise/)).toBeInTheDocument();
    expect(getProgress().daily!.days.d001.passed).toBeUndefined();
  });

  it("hints do not unlock the solution until the last level is opened", async () => {
    mount([g(0)]);
    const card = () => screen.getByLabelText(/^Exercise 1:/);
    fireEvent.click(within(card()).getByRole("button", { name: "Open the exercise" }));
    await within(card()).findByRole("button", { name: /^Submit/ });
    fireEvent.click(within(card()).getByRole("button", { name: "Expand Explanation" }));
    fireEvent.click(within(card()).getByRole("button", { name: /^Show level/ }));
    expect(within(card()).queryByRole("button", { name: /Show a solution/ })).toBeNull();
    for (let i = 0; i < 6; i++) { const b = within(card()).queryByRole("button", { name: /^Show level/ }); if (!b) break; fireEvent.click(b); }
    expect(await within(card()).findByRole("button", { name: /Show a solution/ })).toBeInTheDocument();
    expect(getProgress().daily?.days.d001?.passed).toBeUndefined();
  });
});

describe("drafts", () => {
  it("typing saves a draft under the same key after the delay, and a remount restores it and opens the exercise", async () => {
    mount([g(0)]);
    const card = () => screen.getByLabelText(/^Exercise 1:/);
    fireEvent.click(within(card()).getByRole("button", { name: "Open the exercise" }));
    const box = (await within(card()).findByLabelText(/code for/i)) as HTMLTextAreaElement;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.change(box, { target: { value: "print('my own draft')" } });
    expect(getProgress().daily?.days.d001?.drafts?.g1).toBeUndefined(); // not before the delay
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_MS + 10); });
    vi.useRealTimers();
    expect(getProgress().daily!.days.d001.drafts!.g1).toBe("print('my own draft')");
    cleanup();
    mount([g(0)]);
    const again = (await screen.findByLabelText(/code for/i)) as HTMLTextAreaElement; // opened without a click
    expect(again.value).toBe("print('my own draft')");
    expect(screen.getByText("Your saved work was restored.")).toBeInTheDocument();
  });

  it("Reset goes back to the starter, and that is what is saved", async () => {
    mount([g(0)]);
    const card = () => screen.getByLabelText(/^Exercise 1:/);
    fireEvent.click(within(card()).getByRole("button", { name: "Open the exercise" }));
    const box = (await within(card()).findByLabelText(/code for/i)) as HTMLTextAreaElement;
    const starter = box.value;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.change(box, { target: { value: "x = 1" } });
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_MS + 10); });
    fireEvent.click(within(card()).getByRole("button", { name: /Reset/ }));
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_MS + 10); });
    vi.useRealTimers();
    expect((within(card()).getByLabelText(/code for/i) as HTMLTextAreaElement).value).toBe(starter);
    expect(getProgress().daily!.days.d001.drafts!.g1).toBe(starter);
  });
});

describe("several exercises in one lesson", () => {
  it("each has its own id, code, status and results", async () => {
    mount([g(0), g(1)]);
    const c1 = screen.getByLabelText(/^Exercise 1:/);
    const c2 = screen.getByLabelText(/^Exercise 2:/);
    fireEvent.click(within(c1).getByRole("button", { name: "Open the exercise" }));
    fireEvent.click(within(c2).getByRole("button", { name: "Open the exercise" }));
    const ids = screen.getAllByTestId("daily-embedded-exercise").map((n) => n.getAttribute("data-exercise-id"));
    expect(ids).toEqual(["daily:d001#g1", "daily:d001#g2"]);
    const b1 = (await within(c1).findByLabelText(/code for/i)) as HTMLTextAreaElement;
    const b2 = (await within(c2).findByLabelText(/code for/i)) as HTMLTextAreaElement;
    fireEvent.change(b1, { target: { value: "print('one')" } });
    expect(b2.value).not.toBe("print('one')");
    py.result = right(); // g1's expected output
    fireEvent.click(within(c1).getByRole("button", { name: /^Submit/ }));
    await waitFor(() => expect(getProgress().daily!.days.d001.passed).toEqual(["g1"]));
    await within(c1).findByText(/Correct\. All checks passed/);
    expect(within(c2).queryByText(/Correct\. All checks passed/)).toBeNull();
    expect(within(c1).getByText("Passed")).toBeInTheDocument();
    expect(within(c2).getByText("Not started")).toBeInTheDocument();
  });
});

describe("prerendering", () => {
  it("the server render of a lesson has no workspace or editor: exercises mount only on the client, so the prerendered HTML is unchanged", async () => {
    const mod = await import("../site/pages/DailyPages");
    const html = renderToString(<MemoryRouter><Lesson Page={mod.DailyLessonPage} day={day} /></MemoryRouter>);
    expect(html).toContain("Today&#x27;s plan");
    expect(html).not.toContain("Open the exercise");
    expect(html).not.toContain("exercise-workspace");
  });
});

describe("what is not embedded", () => {
  it("a written exercise keeps its self-assessed card", async () => {
    const d022 = (await loadDay("d022"))!;
    const written = d022.independent.find((e) => e.kind === "written")!;
    render(<MemoryRouter><Harness dayId="d022" items={[{ ex: written, guided: false }]} /></MemoryRouter>);
    expect(screen.getByText("Self-assessed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open the exercise" })).toBeNull();
    expect(dailyEmbedDecision("d022", written).embed).toBe(false);
  });

  it("an SQL exercise whose own reference the workspace's safety checker refuses keeps the in-page runner (Check answer), with no workspace link", async () => {
    sqlGate.ok = false;
    const d031 = (await loadDay("d031"))!;
    const ex = d031.guided[0];
    expect(dailyEmbedDecision("d031", ex).embed).toBe(true); // decided at runtime, when the learner opens it
    render(<MemoryRouter><Harness dayId="d031" items={[{ ex, guided: true }]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Open the exercise" }));
    expect(await screen.findByRole("button", { name: "Check answer" })).toBeInTheDocument();
    expect(screen.queryByTestId("open-in-workspace")).toBeNull();
    sqlGate.ok = true;
  });

  it("an SQL exercise the checker accepts opens the workspace (Submit)", async () => {
    sqlGate.ok = true;
    const d031 = (await loadDay("d031"))!;
    render(<MemoryRouter><Harness dayId="d031" items={[{ ex: d031.guided[0], guided: true }]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Open the exercise" }));
    expect(await screen.findByRole("button", { name: /^Submit/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
  });

  it("when the engine cannot load, the card falls back to the in-page runner instead of a dead workspace", async () => {
    registerAdapter("python", async () => { throw new Error("chunk failed"); });
    mount([g(0)]);
    fireEvent.click(within(screen.getByLabelText(/^Exercise 1:/)).getByRole("button", { name: "Open the exercise" }));
    expect(await screen.findByRole("button", { name: "Check answer" })).toBeInTheDocument();
  });

  it("the embed rule: every written exercise stays, and every graded one is embedded (engine gates apply when it is opened)", async () => {
    const files = import.meta.glob("../site/content/daily/days/*.json", { eager: true, import: "default" }) as Record<string, DayExtras>;
    const loadDays = () => Object.entries(files).map(([p, extras]) => ({ id: p.split("/").pop()!.replace(".json", ""), extras }));
    const tally = { embed: 0, written: 0, kept: [] as string[], byDomain: {} as Record<string, number> };
    for (const d of loadDays()) for (const sec of ["guided", "independent"] as const) for (const ex of d.extras[sec]) {
      const r = dailyEmbedDecision(d.id, ex, sec);
      if (r.embed) { tally.embed++; tally.byDomain[r.domain!] = (tally.byDomain[r.domain!] ?? 0) + 1; }
      else if (ex.kind === "written") tally.written++;
      else tally.kept.push(`${d.id}/${ex.id}: ${r.reason}`);
    }
    expect(tally.kept).toEqual([]);
    expect(tally.written).toBe(223);
    expect(tally.embed).toBe(1646);
    expect(tally.byDomain).toEqual({ python: 674, sql: 387, pandas: 522, numpy: 63 });
  });
});
