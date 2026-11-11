// Phase 2 UI: the lesson page shows the study timer and stores its time on leave; a failed graded check lands in the Mistake Notebook.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getProgress, replaceProgress } from "../site/lib/progress";
import { getActive, saveActive, settle } from "../site/lib/solveSessions";
import { loadDay } from "../site/lib/daily";
import { studySec } from "../site/lib/dailyStudy";

const page = vi.hoisted(() => ({ value: { data: {} as Record<string, unknown>, params: {} as Record<string, string> } }));
const py = vi.hoisted(() => ({ result: { ok: true, stdout: "", error: "", ms: 1 } as { ok: boolean; stdout: string; error: string; ms: number } }));
vi.mock("../site/SiteApp", () => ({ usePage: () => page.value }));
vi.mock("../site/lib/pyRunner", () => ({ PY_TIMEOUT_MS: 1000, runPython: async () => py.result }));
vi.mock("../site/components/CodeEditor", () => ({ default: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} /> }));
import { DailyLessonPage } from "../site/pages/DailyPages";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class { observe() {} disconnect() {} unobserve() {} };

beforeEach(() => {
  localStorage.clear();
  replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function lesson() {
  const content = await loadDay("d001");
  page.value = { data: { index: [], topics: [], dailyContent: content, dailyLinks: [] }, params: { n: "1" } };
  return render(<MemoryRouter><DailyLessonPage /></MemoryRouter>);
}

describe("Daily lesson study timer", () => {
  it("shows a timer, can be paused, and stores active time when the learner leaves the lesson", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-11T10:00:00Z") });
    const { unmount } = await lesson();
    const timer = await screen.findByRole("group", { name: "Lesson study timer" });
    expect(within(timer).getByRole("timer")).toBeInTheDocument();
    vi.setSystemTime(Date.parse("2026-11-11T10:00:20Z")); act(() => saveActive(settle(getActive("day:d001")!, Date.now())));
    vi.setSystemTime(Date.parse("2026-11-11T10:00:40Z")); act(() => saveActive(settle(getActive("day:d001")!, Date.now())));
    fireEvent.click(within(timer).getByRole("button", { name: "Pause study timer" }));
    expect(within(timer).getByRole("button", { name: "Resume study timer" })).toBeInTheDocument();
    unmount();
    expect(getActive("day:d001")).toBeUndefined();
    expect(studySec(getProgress().daily!.days.d001)).toBe(40);
    expect(getProgress().sessions ?? []).toEqual([]);
    expect(getProgress().daily!.days.d001.completedAt).toBeUndefined(); // time is never progress
  });

  it("a lesson visit shorter than the minimum stores nothing", async () => {
    const { unmount } = await lesson();
    await screen.findByRole("group", { name: "Lesson study timer" });
    unmount();
    expect(getProgress().daily?.days.d001?.study).toBeUndefined();
  });
});

describe("Daily lesson failed checks reach the Mistake Notebook", () => {
  const goGuided = async () => {
    await lesson();
    const steps = screen.getByRole("list", { name: "Lesson steps" });
    fireEvent.click(within(steps).getByRole("button", { name: /Guided/ }));
  };

  it("records a wrong answer as one counted entry, then marks it solved on a pass; no code is stored", async () => {
    py.result = { ok: true, stdout: "definitely wrong output\n", error: "", ms: 1 };
    await goGuided();
    const check = screen.getAllByRole("button", { name: "Check answer" })[0];
    fireEvent.click(check);
    await waitFor(() => expect(getProgress().mistakes?.["daily:d001#g1"]?.count).toBe(1));
    fireEvent.click(check);
    await waitFor(() => expect(getProgress().mistakes?.["daily:d001#g1"]?.count).toBe(2));
    expect(Object.keys(getProgress().mistakes!)).toEqual(["daily:d001#g1"]);
    const stored = JSON.stringify(getProgress().mistakes);
    expect(stored).not.toContain("definitely wrong");
    expect(getProgress().mistakes!["daily:d001#g1"].categories["wrong-output"]).toBe(2);

    const day = await loadDay("d001");
    py.result = { ok: true, stdout: `${day!.guided[0].expected}\n`, error: "", ms: 1 };
    fireEvent.click(check);
    await waitFor(() => expect(getProgress().mistakes!["daily:d001#g1"].solved).toBeTruthy());
    expect(getProgress().mistakes!["daily:d001#g1"].count).toBe(2); // history kept
    expect(getProgress().daily!.days.d001.passed).toContain("g1");
  });

  it("a passing first try records no mistake", async () => {
    const day = await loadDay("d001");
    py.result = { ok: true, stdout: `${day!.guided[0].expected}\n`, error: "", ms: 1 };
    await goGuided();
    fireEvent.click(screen.getAllByRole("button", { name: "Check answer" })[0]);
    await waitFor(() => expect(getProgress().daily!.days.d001.passed).toContain("g1"));
    expect(getProgress().mistakes ?? {}).toEqual({});
  });
});
