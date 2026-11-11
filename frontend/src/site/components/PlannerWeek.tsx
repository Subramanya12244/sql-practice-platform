import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff, Target } from "lucide-react";
import { usePage } from "../SiteApp";
import { today, useProgress } from "../lib/progress";
import { readStats, type PyStat } from "../lib/pyPractice";
import { topicRows } from "../lib/solveAnalytics";
import { revisionQueue, splitQueue } from "../lib/revision";
import { getProjectProgress, loadAllProjects, type Project } from "../lib/projects";
import { DEFAULT_REMINDERS, focusSchedule, projectMilestones, readReminders, reminderDue, reminderText, saveReminders, weekProgress, type ReminderSettings } from "../lib/plannerWeek";
import type { PlanSettings } from "../lib/career";
import type { ProjectState } from "../lib/learningInsights";
import { Card, ProgressBar, SectionHeader } from "./ui";

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayName = (iso: string) => WEEKDAY[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];

/** This week against the plan, a focus schedule, project milestones and opt-in reminders. */
export function PlannerWeek({ plan }: { plan: PlanSettings | undefined }) {
  const { data } = usePage();
  const progress = useProgress();
  const [pyStats, setPyStats] = useState<Record<string, PyStat>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [rem, setRem] = useState<ReminderSettings>(DEFAULT_REMINDERS);
  const [dismissed, setDismissed] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const day = today();

  useEffect(() => {
    setPyStats(readStats());
    setRem(readReminders());
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    void loadAllProjects().then(setProjects).catch(() => setProjects([]));
    try { setDismissed(sessionStorage.getItem(`sqlp.reminder.dismissed.${today()}`) === "1"); } catch { /* shown again next load */ }
  }, []);

  const sessions = progress.sessions ?? [];
  const week = useMemo(() => weekProgress(sessions, plan, day), [sessions, plan, day]);
  const rows = useMemo(() => topicRows({ index: data.index ?? [], exercises: data.exercises ?? [], progress, pyStats, sessions }), [data.index, data.exercises, progress, pyStats, sessions]);
  const focus = useMemo(() => focusSchedule(rows, day), [rows, day]);
  const states = useMemo(() => {
    const m: Record<string, ProjectState> = {};
    for (const p of projects) {
      const pr = getProjectProgress(p.slug);
      const auto = p.tasks.filter((t) => t.type !== "checklist");
      const passed = auto.filter((t) => pr.tasks[t.id]?.passed).length;
      m[p.slug] = auto.length && passed === auto.length ? "Completed" : passed > 0 || Object.keys(pr.checklist).length ? "In progress" : "Not started";
    }
    return m;
  }, [projects]);
  const milestones = useMemo(() => projectMilestones(projects, states, getProjectProgress), [projects, states]);
  const dueReviews = useMemo(() => splitQueue(revisionQueue(data.index ?? [], data.exercises ?? [], progress, day), day), [data.index, data.exercises, progress, day]);
  const dueCount = dueReviews.overdue.length + dueReviews.today.length;
  const practicedToday = week.days.find((d) => d.day === day)?.min ?? 0;

  const change = (next: ReminderSettings) => { setRem(next); saveReminders(next); };
  const showBanner = reminderDue(rem, new Date().getHours(), practicedToday > 0, dismissed);
  const dismiss = () => { setDismissed(true); try { sessionStorage.setItem(`sqlp.reminder.dismissed.${day}`, "1"); } catch { /* ignore */ } };
  const askNotifications = async () => { if (typeof Notification !== "undefined") setPerm(await Notification.requestPermission()); };
  // Browser notification only after an explicit opt-in and a granted permission, once per day, while this tab is open.
  useEffect(() => {
    if (!showBanner || perm !== "granted") return;
    try {
      if (localStorage.getItem("sqlp.reminder.notified") === day) return;
      new Notification("DataForge", { body: reminderText(dueCount) });
      localStorage.setItem("sqlp.reminder.notified", day);
    } catch { /* notifications blocked: the banner still shows */ }
  }, [showBanner, perm, day, dueCount]);

  const maxMin = Math.max(30, ...week.days.map((d) => d.min));
  return (
    <section aria-labelledby="week-heading" className="mt-6 space-y-4">
      <SectionHeader id="week-heading" title="This week" description={plan ? `Target from your plan: ${plan.hoursPerWeek} hours a week. Rest days are normal.` : "No plan saved yet, so the target is 3 hours. Save a plan above to set your own."} />

      {showBanner && (
        <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent-dim px-3 py-2 text-sm text-ink">
          <span><Bell className="mr-1.5 inline h-4 w-4 text-accent" aria-hidden />{reminderText(dueCount)} <Link to={dueCount ? "/review" : "/questions"} className="font-medium text-accent hover:underline">{dueCount ? "Open the review queue" : "Practise now"}</Link></span>
          <button type="button" onClick={dismiss} className="text-xs text-ink-muted hover:text-ink">Dismiss for today</button>
        </p>
      )}

      <Card pad="md">
        <p className="flex items-center gap-2 text-sm font-medium text-ink"><Target className="h-4 w-4 text-accent" aria-hidden /> {week.message}</p>
        <ProgressBar className="mt-2" value={Math.min(week.doneMin, week.targetMin)} max={week.targetMin} label={`${week.doneMin} of ${week.targetMin} minutes this week`} tone={week.status === "done" ? "success" : "accent"} />
        <ol className="mt-3 grid grid-cols-7 gap-1.5" aria-label="Practice minutes per day">
          {week.days.map((d) => (
            <li key={d.day} className="flex flex-col items-center gap-1 text-[11px] text-ink-faint" title={`${d.day}: ${d.min} min`}>
              <div className="flex h-14 w-full items-end"><div className={`w-full rounded-t ${d.future ? "bg-surface-soft" : "bg-accent"}`} style={{ height: `${Math.max(4, (d.min / maxMin) * 100)}%`, opacity: d.min ? 0.85 : 0.25 }} /></div>
              <span className={d.day === day ? "font-semibold text-ink" : ""}>{dayName(d.day)}</span>
              <span className="tabular-nums">{d.future ? "" : d.min}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-faint">Previous weeks: {week.history.map((h) => `${h.week} ${h.min} min`).join(" · ")}</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card pad="md" as="section" aria-label="Focus this week">
          <h3 className="text-sm font-semibold text-ink">Focus this week</h3>
          {focus.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {focus.map((f) => <li key={f.label}><span className="text-ink-faint">{dayName(f.day)}{f.day === day ? " (today)" : ""} · {f.minutes} min</span> <Link to={f.path} className="font-medium text-accent hover:underline">{f.label}</Link><span className="block text-xs text-ink-muted">{f.why}</span></li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-ink-muted">No topic needs extra practice right now. Follow your plan.</p>}
        </Card>
        <Card pad="md" as="section" aria-label="Project milestones">
          <h3 className="text-sm font-semibold text-ink">Project milestones</h3>
          {milestones.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {milestones.map((m) => <li key={m.slug}><Link to={m.path} className="font-medium text-accent hover:underline">{m.title}</Link><span className="block text-xs text-ink-muted">{m.passed} of {m.total} checks passed{m.next ? `. Next: ${m.next}` : ""}</span></li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-ink-muted">No project in progress. <Link to="/projects-lab" className="text-accent hover:underline">Start one</Link> when you are ready.</p>}
        </Card>
      </div>

      <Card pad="md" as="section" aria-label="Reminders">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">{rem.enabled ? <Bell className="h-4 w-4 text-accent" aria-hidden /> : <BellOff className="h-4 w-4 text-ink-faint" aria-hidden />} Reminders <span className="text-xs font-normal text-ink-faint">· off unless you turn them on</span></h3>
        <label className="mt-2 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={rem.enabled} onChange={(e) => change({ ...rem, enabled: e.target.checked })} /> Remind me to practise if I have not yet today
        </label>
        {rem.enabled && (
          <div className="mt-2 space-y-2 text-sm text-ink-muted">
            <label className="flex items-center gap-2">After
              <select value={rem.hour} onChange={(e) => change({ ...rem, hour: Number(e.target.value) })} className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-ink">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
              <span className="text-xs">your local time</span>
            </label>
            <p className="text-xs">The reminder appears on this page while it is open. It works only when a DataForge tab is open; nothing is sent from a server.</p>
            {perm === "default" && <button type="button" onClick={() => void askNotifications()} className="rounded-lg border border-surface-border px-2.5 py-1 text-xs font-medium text-ink hover:border-accent">Also show a browser notification</button>}
            {perm === "granted" && <p className="text-xs text-success">Browser notifications are allowed.</p>}
            {perm === "denied" && <p className="text-xs text-ink-faint">Browser notifications are blocked in your browser settings; the on-page reminder still works.</p>}
          </div>
        )}
      </Card>
    </section>
  );
}
