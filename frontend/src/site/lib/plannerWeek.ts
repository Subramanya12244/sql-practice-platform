/**
 * Planner v2: this week's target against real practice, a short focus schedule for weak topics,
 * project milestones, and optional reminders. Everything is derived from the learner's records:
 * practice time comes from timed sessions, weak topics from the shared mastery scorer, project
 * progress from passed checks. Wording never shames a quiet week; rest days are normal.
 */
import { addDays } from "./revision";
import { secondsPerDay, type TopicRow } from "./solveAnalytics";
import type { ProjectState } from "./learningInsights";
import type { PlanSettings } from "./career";
import type { SolveSession } from "./solveSessions";
import type { Project, ProjectProgress } from "./projects";


export const DEFAULT_WEEK_MINUTES = 180;

/** Monday of the week containing `day` (UTC, the same day basis as the streaks). */
export const weekStart = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

export interface WeekProgress {
  /** Minutes planned for the week, from the plan's hours per week (or the default). */
  targetMin: number;
  doneMin: number;
  /** Minutes per day, Monday first. */
  days: { day: string; min: number; future: boolean }[];
  /** Share of the week that has passed, counting today. */
  elapsedShare: number;
  status: "ahead" | "on-track" | "behind" | "done";
  /** Plain sentence for the learner. */
  message: string;
  /** Previous weeks, oldest first, for context. */
  history: { week: string; min: number }[];
}

export function weekProgress(sessions: SolveSession[], plan: Pick<PlanSettings, "hoursPerWeek"> | undefined, today: string): WeekProgress {
  const targetMin = Math.round((plan?.hoursPerWeek ?? DEFAULT_WEEK_MINUTES / 60) * 60);
  const start = weekStart(today);
  const per = secondsPerDay(sessions);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i);
    return { day, min: Math.round((per.get(day) ?? 0) / 60), future: day > today };
  });
  const doneMin = days.reduce((a, d) => a + d.min, 0);
  const elapsedDays = days.filter((d) => !d.future).length;
  const elapsedShare = elapsedDays / 7;
  const expected = targetMin * elapsedShare;
  const left = Math.max(0, targetMin - doneMin);
  const status: WeekProgress["status"] = doneMin >= targetMin ? "done" : doneMin >= expected * 1.15 ? "ahead" : doneMin >= expected * 0.85 ? "on-track" : "behind";
  const message = status === "done" ? `Target reached: ${doneMin} of ${targetMin} minutes this week.`
    : status === "ahead" ? `Ahead of pace: ${doneMin} of ${targetMin} minutes, ${left} to go.`
      : status === "on-track" ? `On pace: ${doneMin} of ${targetMin} minutes, ${left} to go.`
        : `${doneMin} of ${targetMin} minutes so far. ${left} minutes left, which is about ${Math.ceil(left / Math.max(1, 7 - elapsedDays + 1))} a day for the rest of the week.`;
  const history = Array.from({ length: 4 }, (_, i) => {
    const ws = addDays(start, -7 * (4 - i));
    let sec = 0;
    for (let d = 0; d < 7; d++) sec += per.get(addDays(ws, d)) ?? 0;
    return { week: ws.slice(5), min: Math.round(sec / 60) };
  });
  return { targetMin, doneMin, days, elapsedShare, status, message, history };
}

export interface FocusSlot { day: string; label: string; path: string; minutes: number; why: string }

/**
 * Up to `max` short sessions on the weakest topics, on the remaining days of this week (today first),
 * spread two days apart so they do not pile up. Nothing is scheduled when no topic needs practice.
 */
export function focusSchedule(rows: TopicRow[], today: string, max = 3, minutes = 25): FocusSlot[] {
  const weak = rows.filter((r) => r.level === "needs-practice").sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, max);
  const end = addDays(weekStart(today), 6);
  const out: FocusSlot[] = [];
  let day = today;
  for (const r of weak) {
    if (day > end) break;
    out.push({ day, label: r.label, path: r.kind === "sql" ? `/topics/${r.topic}` : "/practice/python", minutes, why: r.reasons[0] ?? "Needs practice." });
    day = addDays(day, 2);
  }
  return out;
}

export interface Milestone { slug: string; title: string; passed: number; total: number; next: string | null; path: string }

/** Started projects with the next automated check still to pass. Completed or untouched projects are not listed. */
export function projectMilestones(projects: Project[], state: Record<string, ProjectState>, progress: (slug: string) => ProjectProgress): Milestone[] {
  return projects.flatMap((p) => {
    if (state[p.slug] !== "In progress") return [];
    const auto = p.tasks.filter((t) => t.type !== "checklist");
    const pr = progress(p.slug);
    const passed = auto.filter((t) => pr.tasks[t.id]?.passed).length;
    const next = auto.find((t) => !pr.tasks[t.id]?.passed)?.title ?? null;
    return [{ slug: p.slug, title: p.title, passed, total: auto.length, next, path: `/projects-lab/${p.slug}` }];
  });
}

// ── Reminders (opt-in) ────────────────────────────────────────────────────
export interface ReminderSettings { enabled: boolean; hour: number }
const KEY = "sqlp.reminders";
export const DEFAULT_REMINDERS: ReminderSettings = { enabled: false, hour: 18 };
export function readReminders(): ReminderSettings {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ReminderSettings> | null; return { enabled: v?.enabled === true, hour: Number.isInteger(v?.hour) && v!.hour! >= 0 && v!.hour! <= 23 ? v!.hour! : 18 }; } catch { return DEFAULT_REMINDERS; }
}
export function saveReminders(s: ReminderSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked: stays off after reload */ } }

/** A reminder is due only when enabled, after the chosen hour (local time), and nothing was practised today. */
export function reminderDue(s: ReminderSettings, localHour: number, practicedToday: boolean, dismissedToday: boolean): boolean {
  return s.enabled && !practicedToday && !dismissedToday && localHour >= s.hour;
}

/** What to say, from the revision queue size. */
export const reminderText = (dueReviews: number) => (dueReviews > 0 ? `You have ${dueReviews} review${dueReviews === 1 ? "" : "s"} due. A few minutes keeps them fresh.` : "A short practice session today keeps your week on track.");

