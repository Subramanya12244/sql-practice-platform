import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_REMINDERS, focusSchedule, projectMilestones, readReminders, reminderDue, reminderText, saveReminders, weekProgress, weekStart } from "../site/lib/plannerWeek";
import type { SolveSession } from "../site/lib/solveSessions";
import type { TopicRow } from "../site/lib/solveAnalytics";
import type { Project, ProjectProgress } from "../site/lib/projects";
import { replaceProgress } from "../site/lib/progress";

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../site/SiteApp", () => ({ usePage: () => ({ data: page.data }) }));
import { PlannerWeek } from "../site/components/PlannerWeek";

let n = 0;
const sess = (day: string, activeSec: number): SolveSession => ({ id: `s${++n}`, kind: "sql", ref: "sql:1", startedAt: `${day}T10:00:00Z`, endedAt: `${day}T10:30:00Z`, activeSec, attempts: 1, executions: 1, hints: 0, status: "solved", difficulty: "Easy", topic: "joins" });
const TODAY = "2026-11-11"; // a Wednesday; the week starts Monday 2026-11-09

describe("week progress", () => {
  it("the week starts on Monday", () => {
    expect(weekStart("2026-11-11")).toBe("2026-11-09");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday belongs to the same week
  });
  it("counts this week's minutes by day against the plan's hours, and marks future days", () => {
    const w = weekProgress([sess("2026-11-09", 1800), sess("2026-11-11", 900), sess("2026-11-05", 3600)], { hoursPerWeek: 3 }, TODAY);
    expect(w.targetMin).toBe(180);
    expect(w.doneMin).toBe(45); // last week's hour is not counted
    expect(w.days.map((d) => d.min)).toEqual([30, 0, 15, 0, 0, 0, 0]);
    expect(w.days.map((d) => d.future)).toEqual([false, false, false, true, true, true, true]);
    expect(w.history.at(-1)).toEqual({ week: "11-02", min: 60 });
  });
  it("default target is 3 hours without a plan", () => {
    expect(weekProgress([], undefined, TODAY).targetMin).toBe(180);
  });
  it("status: behind, on pace, ahead, done, with calm wording", () => {
    const at = (min: number) => weekProgress([sess("2026-11-09", min * 60)], { hoursPerWeek: 7 }, TODAY); // target 420, 3 of 7 days gone => expected 180
    expect(at(30).status).toBe("behind");
    expect(at(30).message).toMatch(/390 minutes left/);
    expect(at(30).message).not.toMatch(/failed|lazy|should have|missed/i);
    expect(at(180).status).toBe("on-track");
    expect(at(260).status).toBe("ahead");
    expect(at(420).status).toBe("done");
    expect(at(420).message).toMatch(/Target reached/);
  });
});

describe("focus schedule and milestones", () => {
  const row = (label: string, score: number, level: TopicRow["level"] = "needs-practice", kind: TopicRow["kind"] = "sql"): TopicRow => ({ kind, topic: label.toLowerCase(), label, total: 10, solved: 2, sessions: 3, activeSec: 100, avgSolveSec: null, score, level, reasons: [`${label} reason.`] });
  it("weakest topics first, two days apart, never past Sunday, nothing when nothing is weak", () => {
    const f = focusSchedule([row("A", 50), row("B", 20), row("C", 35), row("D", 10), row("Strong", 90, "strong")], TODAY);
    expect(f.map((x) => [x.label, x.day])).toEqual([["D", "2026-11-11"], ["B", "2026-11-13"], ["C", "2026-11-15"]]);
    expect(focusSchedule([row("S", 90, "strong")], TODAY)).toEqual([]);
    expect(focusSchedule([row("A", 10), row("B", 20)], "2026-11-15").map((x) => x.label)).toEqual(["A"]); // Sunday: only today is left
  });
  it("lists only started projects, with the next unpassed automated check", () => {
    const t = (id: string, type: "sql" | "python" | "checklist") => ({ id, title: `Task ${id}`, type, instructions: "", starter: "", solution: "", check: "", tests: "", items: [] }) as never;
    const p = (slug: string): Project => ({ slug, title: slug, level: "Beginner", description: "", technologies: [], dataset: "northwind", prerequisites: [], minutes: 1, body: "", tasks: [t("a", "sql"), t("b", "python"), t("m", "checklist")] });
    const prog = (passed: string[]): ProjectProgress => ({ tasks: Object.fromEntries(passed.map((id) => [id, { passed: true, at: "x" }])), checklist: {} });
    const ms = projectMilestones([p("one"), p("two"), p("three")], { one: "In progress", two: "Completed", three: "Not started" }, (slug) => prog(slug === "one" ? ["a"] : []));
    expect(ms).toEqual([{ slug: "one", title: "one", passed: 1, total: 2, next: "Task b", path: "/projects-lab/one" }]);
  });
});

describe("reminders are opt-in", () => {
  beforeEach(() => localStorage.clear());
  it("off by default; survives a reload; garbage in storage falls back to off", () => {
    expect(readReminders()).toEqual({ enabled: false, hour: 18 });
    saveReminders({ enabled: true, hour: 9 });
    expect(readReminders()).toEqual({ enabled: true, hour: 9 });
    localStorage.setItem("sqlp.reminders", "{oops");
    expect(readReminders()).toEqual(DEFAULT_REMINDERS);
    localStorage.setItem("sqlp.reminders", JSON.stringify({ enabled: "yes", hour: 99 }));
    expect(readReminders()).toEqual({ enabled: false, hour: 18 });
  });
  it("due only when enabled, after the hour, with no practice today and not dismissed", () => {
    const on = { enabled: true, hour: 18 };
    expect(reminderDue(on, 19, false, false)).toBe(true);
    expect(reminderDue(on, 17, false, false)).toBe(false);
    expect(reminderDue(on, 19, true, false)).toBe(false);
    expect(reminderDue(on, 19, false, true)).toBe(false);
    expect(reminderDue({ enabled: false, hour: 0 }, 23, false, false)).toBe(false);
  });
  it("text depends on the review queue", () => {
    expect(reminderText(3)).toBe("You have 3 reviews due. A few minutes keeps them fresh.");
    expect(reminderText(1)).toMatch(/1 review due/);
    expect(reminderText(0)).toMatch(/short practice session/);
  });
});

describe("PlannerWeek (module)", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] }); page.data = { index: [], exercises: [] }; });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const view = () => render(<MemoryRouter><PlannerWeek plan={{ role: "data-analyst", start: "2026-11-01", weeks: 8, hoursPerWeek: 6 }} /></MemoryRouter>);

  it("shows the week, an empty focus state and an empty milestone state; reminders are off and silent", async () => {
    const notify = vi.fn();
    vi.stubGlobal("Notification", Object.assign(notify, { permission: "default", requestPermission: vi.fn() }));
    view();
    expect(await screen.findByText(/Target from your plan: 6 hours a week/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Practice minutes per day" }).children).toHaveLength(7);
    expect(screen.getByText(/No topic needs extra practice/)).toBeInTheDocument();
    expect(await screen.findByText(/No project in progress/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Remind me to practise/)).not.toBeChecked();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(notify).not.toHaveBeenCalled();
  });

  it("turning reminders on is remembered and asks nothing of the browser until the learner clicks", async () => {
    const request = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "default", requestPermission: request }));
    view();
    fireEvent.click(await screen.findByLabelText(/Remind me to practise/));
    expect(JSON.parse(localStorage.getItem("sqlp.reminders")!)).toEqual({ enabled: true, hour: 18 });
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /show a browser notification/ }));
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } });
    expect(JSON.parse(localStorage.getItem("sqlp.reminders")!).hour).toBe(7);
  });

  it("an enabled reminder shows an on-page banner when due, and can be dismissed for the day", async () => {
    localStorage.setItem("sqlp.reminders", JSON.stringify({ enabled: true, hour: 0 }));
    view();
    expect(await screen.findByText(/short practice session today/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss for today" }));
    expect(screen.queryByText(/short practice session today/)).not.toBeInTheDocument();
  });
});
