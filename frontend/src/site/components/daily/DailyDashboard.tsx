import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, Circle, Clock, Flame, Layers, PlayCircle, RotateCcw, Sparkles, Target } from "lucide-react";
import { Badge, Button, ButtonLink, Card, ProgressRing, SectionHeader, StatCard } from "../ui";
import { CountUp } from "../Motion";
import { InlineMarkdown } from "../Markdown";
import {
  BRANCH_DAYS, CURRICULUM, PATHS, PHASE_BY_ID, dayHref, isAuthored, loadDay, phasesFor, prerequisitesOf, sequenceFor,
  type BranchId, type DayMeta, type PhaseMeta,
} from "../../lib/daily";
import {
  STATUS_LABEL, activityDates, buildCalendar, currentDay, dayStatus, dueRevisions, hasActivity, isDone, learningStreak, programmeStats,
  type CalendarKind, type DayStatus,
} from "../../lib/dailyProgress";
import { setDailyPath } from "../../lib/progress";
import { useToday, type DailyView } from "../../lib/useDaily";
import { HelpTooltip } from "../../help/HelpTooltip";

const hours = (min: number) => (min >= 60 ? `${Math.round(min / 6) / 10} h` : `${min} min`);

const STATUS_TONE: Record<DayStatus, "neutral" | "accent" | "success" | "warn"> = {
  available: "neutral", "in-progress": "accent", completed: "success", revision: "warn",
};

export function StatusIcon({ status, current }: { status: DayStatus; current?: boolean }) {
  const base = "h-5 w-5 shrink-0";
  if (status === "completed") return <CheckCircle2 className={`${base} text-success`} aria-hidden />;
  if (status === "revision") return <RotateCcw className={`${base} text-warn`} aria-hidden />;
  if (status === "in-progress") return <PlayCircle className={`${base} text-accent`} aria-hidden />;
  return <Circle className={`${base} ${current ? "text-accent" : "text-ink-faint"}`} aria-hidden />;
}

// ── Path ─────────────────────────────────────────────────────────────────
export function PathPanel({ view, preview, onPreview }: { view: DailyView; preview: BranchId | undefined; onPreview: (p: BranchId | undefined) => void }) {
  const { path, state } = view;
  const commonDone = sequenceFor(undefined).filter((d) => isDone(state, d.id)).length;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Your path</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Days 1–90 are the same for everyone: Python, SQL, NumPy, pandas and statistics ({commonDone} of 90 done).
            From day 91 you follow one of two paths. Choose now or later; you can switch, and work you have done is kept.
          </p>
        </div>
        {path && <Badge tone="accent">Following: {PATHS.find((p) => p.id === path)?.title}</Badge>}
      </div>
      <div data-help="daily-path" className="mt-4 grid gap-3 sm:grid-cols-2">
        {PATHS.map((p) => {
          const days = BRANCH_DAYS[p.id];
          const done = days.filter((d) => isDone(state, d.id)).length;
          const chosen = path === p.id;
          return (
            <div key={p.id} className={`rounded-xl border p-4 transition-all duration-base ease-out ${chosen ? "border-accent bg-accent-dim" : preview === p.id ? "border-accent/50 bg-surface-soft" : "border-surface-border bg-surface-soft/50 hover:border-accent/40"}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-ink">{p.title} path</h3>
                <span className="text-xs text-ink-faint">Days 91–180 · {done}/90 done</span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{p.summary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant={chosen ? "secondary" : "primary"} disabled={chosen} onClick={() => setDailyPath(p.id)}>{chosen ? "Your path" : path ? "Switch to this path" : "Choose this path"}</Button>
                <Button size="sm" variant="ghost" onClick={() => onPreview(preview === p.id ? undefined : p.id)}>{preview === p.id ? "Hide preview" : "Preview roadmap"}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────
export function ProgrammeOverview({ view }: { view: DailyView }) {
  const { state, seq, progress } = view;
  const stats = useMemo(() => programmeStats(seq, state), [seq, state]);
  const today = useToday();
  const streak = today ? learningStreak(activityDates(state), today) : 0;
  const totalMin = seq.reduce((s, d) => s + d.minutes, 0);
  const authored = seq.filter((d) => isAuthored(d.id)).length;
  void progress;
  return (
    <section data-help="daily-overview" aria-labelledby="overview" className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_1fr]">
      <Card className="flex items-center gap-5">
        <ProgressRing value={stats.percent} size={112} label="Programme completion">
          <span className="block font-display text-2xl font-bold text-ink"><CountUp value={stats.percent} format={(n) => `${Math.round(n)}%`} /></span>
          <span className="block text-[11px] text-ink-faint">complete</span>
        </ProgressRing>
        <div>
          <h2 id="overview" className="font-display text-lg font-bold text-ink">{CURRICULUM.programme.title}</h2>
          <p className="text-sm text-ink-muted">{state.path ? `${seq.length} days · ${PATHS.find((p) => p.id === state.path)?.title} path` : "90 common days, then choose a path (180 days in all)"}</p>
          <p className="mt-1 text-sm text-ink-muted">About {hours(totalMin)} of study in total, around 2 hours a day.</p>
          <p className="mt-1 text-xs text-ink-faint">{authored} of {seq.length} lessons are written so far; the rest show their topics and prerequisites.</p>
        </div>
      </Card>
      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard icon={Target} label="Current day" value={stats.current ? `Day ${stats.current.day}` : "Done"} hint={stats.phase?.title ?? "Programme finished"} />
        <StatCard icon={CheckCircle2} label="Completed" value={<CountUp value={stats.completed} />} hint={`${stats.remaining} remaining`} />
        <StatCard icon={Flame} label="Learning streak" value={<>{streak} {streak === 1 ? "day" : "days"}</>} hint={<>One day off never breaks it <HelpTooltip id="streak" label="What is the learning streak?" /></>} />
        <StatCard icon={Clock} label="Study time left" value={hours(stats.remainingMinutes)} hint="At the planned pace" />
        <StatCard icon={Layers} label="Phase" value={<span className="text-base">{stats.phase?.title ?? "Finished"}</span>} hint={stats.phase ? `Days ${stats.phase.firstDay}–${stats.phase.lastDay}` : undefined} />
        <StatCard icon={Sparkles} label="Mastered" value={<CountUp value={stats.mastered} />} hint="Completion and mastery are tracked separately" />
      </div>
    </section>
  );
}

// ── Today ────────────────────────────────────────────────────────────────
export function TodayCard({ view }: { view: DailyView }) {
  const { state, seq } = view;
  const day = currentDay(seq, state);
  const [objectives, setObjectives] = useState<string[]>([]);
  useEffect(() => {
    setObjectives([]);
    if (!day || !isAuthored(day.id)) return;
    let live = true;
    void loadDay(day.id).then((c) => {
      if (live && c) setObjectives(c.sections["Objectives"].split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)));
    });
    return () => { live = false; };
  }, [day?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!day) {
    return (
      <Card className="border-success/40 bg-success-dim">
        <h2 className="font-display text-xl font-bold text-ink">Programme complete</h2>
        <p className="mt-1 text-sm text-ink-muted">You have completed every day on your path. Use the revision schedule to keep the material fresh.</p>
      </Card>
    );
  }
  const authored = isAuthored(day.id);
  const rec = state.days[day.id];
  const continuing = hasActivity(rec);
  const nextReady = authored ? undefined : seq.find((d) => !isDone(state, d.id) && isAuthored(d.id));
  const unmet = prerequisitesOf(day).filter((p) => !isDone(state, p.id));
  const phase = PHASE_BY_ID.get(day.phase);
  return (
    <section data-help="daily-today" aria-labelledby="today" className="relative overflow-hidden rounded-card border border-accent/40 bg-surface-raised p-6 shadow-glow">
      <div className="hero-gradient pointer-events-none absolute inset-0 animate-[gradient-pan_14s_ease-in-out_infinite] opacity-60" aria-hidden />
      <div className="relative">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          <span className="df-pulse h-2 w-2 rounded-full bg-accent" aria-hidden /> Today's learning
        </p>
        <h2 id="today" className="mt-2 font-display text-2xl font-bold text-ink sm:text-3xl">Day {day.day}: {day.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <Badge tone="accent">{phase?.title}</Badge>
          <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden /> about {hours(day.minutes)}</span>
          {day.kind !== "lesson" && <Badge tone="secondary">{day.kind}</Badge>}
          <Badge tone={authored ? "success" : "neutral"}>{authored ? "Lesson ready" : "Lesson in preparation"}</Badge>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">{objectives.length ? "By the end of today you can" : "Topics"}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
              {(objectives.length ? objectives : day.topics).map((t) => <li key={t}><InlineMarkdown source={t} /></li>)}
            </ul>
          </div>
          {unmet.length > 0 && (
            <div className="rounded-xl border border-warn/40 bg-warn-dim p-3 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-warn"><AlertCircle className="h-4 w-4" aria-hidden /> Not finished yet</p>
              <p className="mt-1 text-ink-muted">This day builds on: {unmet.map((p, i) => <span key={p.id}>{i ? ", " : ""}<Link className="text-accent underline-offset-2 hover:underline" to={dayHref(p)}>Day {p.day}</Link></span>)}. You can still start.</p>
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <ButtonLink to={dayHref(day)} size="lg">{continuing ? "Continue learning" : authored ? "Start learning" : "View day"} <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>
          {nextReady && <ButtonLink to={dayHref(nextReady)} variant="secondary" size="lg">Next ready lesson: Day {nextReady.day}</ButtonLink>}
        </div>
        {!authored && <p className="mt-3 text-xs text-ink-faint">This lesson is not written yet. Its topics and prerequisites are shown so you can plan and revise.{nextReady ? " Jump to the next lesson that is ready, or revisit finished days." : ""}</p>}
      </div>
    </section>
  );
}

// ── Revision ─────────────────────────────────────────────────────────────
export function RevisionPanel({ view }: { view: DailyView }) {
  const today = useToday();
  const { state, revisions } = view;
  if (!today) return null;
  const due = dueRevisions(state, revisions, today);
  const weak = Object.entries(state.days).filter(([, r]) => r.completedAt && r.check && r.check.last < 0.6).map(([id]) => id);
  const ids = [...new Set([...due, ...weak])];
  const upcoming = Object.entries(revisions).filter(([k, r]) => k.startsWith("day:") && state.days[k.slice(4)]?.completedAt && r.due > today).sort((a, b) => a[1].due.localeCompare(b[1].due)).slice(0, 3);
  return (
    <section id="revision" data-help="daily-revision" aria-labelledby="rev-h">
      <SectionHeader id="rev-h" title="Revision schedule" description="Completed days come back at growing gaps (1, 3, 7, 14, 30 days). A clean knowledge check moves a day up a step." />
      <Card>
        {ids.length === 0 ? (
          <p className="text-sm text-ink-muted">{Object.values(state.days).some((r) => r.completedAt) ? "Nothing is due for revision today." : "Finish a day to start its revision schedule."}</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {ids.map((id) => {
              const d = sequenceFor(state.path).concat(BRANCH_DAYS.analyst, BRANCH_DAYS.engineer).find((x) => x.id === id);
              if (!d) return null;
              return (
                <li key={id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span><span className="text-ink-faint">Day {d.day}</span> <span className="font-medium text-ink">{d.title}</span></span>
                  <Link to={dayHref(d)} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Revise <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
                </li>
              );
            })}
          </ul>
        )}
        {upcoming.length > 0 && <p className="mt-3 text-xs text-ink-faint">Next reviews: {upcoming.map(([k, r]) => `Day ${sequenceFor(state.path).concat(BRANCH_DAYS.analyst, BRANCH_DAYS.engineer).find((d) => d.id === k.slice(4))?.day} on ${r.due}`).join(" · ")}</p>}
        <p className="mt-3 text-xs text-ink-faint">Questions and exercises you solved have their own schedule in the <Link className="text-accent hover:underline" to="/review">revision queue</Link>.</p>
      </Card>
    </section>
  );
}

// ── Roadmap ──────────────────────────────────────────────────────────────
function DayRow({ day, view, today, isCurrent }: { day: DayMeta; view: DailyView; today: string; isCurrent: boolean }) {
  const { state, revisions } = view;
  const status = dayStatus(state.days[day.id], revisions[`day:${day.id}`], today);
  const ready = isAuthored(day.id);
  const unmet = prerequisitesOf(day).filter((p) => !isDone(state, p.id));
  const first = unmet[0];
  return (
    <li className="relative">
      <Link to={dayHref(day)} aria-current={isCurrent ? "step" : undefined}
        className={`group flex items-center gap-3 rounded-xl px-2 py-2 transition-all duration-fast ease-out hover:bg-hover/5 hover:translate-x-0.5 ${isCurrent ? "bg-accent-dim" : ""}`}>
        <span className={`relative z-10 rounded-full bg-surface-raised ${isCurrent ? "df-pulse" : ""}`}><StatusIcon status={status} current={isCurrent} /></span>
        <span className="w-14 shrink-0 text-xs font-semibold text-ink-faint">Day {day.day}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${status === "completed" ? "text-ink-muted" : "text-ink"} group-hover:text-accent`}>{day.title}</span>
          {first && status !== "completed" && !(unmet.length === 1 && first.day === day.day - 1) && <span className="block truncate text-[11px] text-warn">Needs Day {first.day}{unmet.length > 1 ? ` and ${unmet.length - 1} more` : ""} first</span>}
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 sm:inline-flex">
          {day.kind !== "lesson" && <Badge tone="secondary">{day.kind}</Badge>}
          {!ready && <Badge>Lesson in preparation</Badge>}
          {(status !== "available" || ready) && <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>}
        </span>
      </Link>
    </li>
  );
}

function PhaseCard({ phase, view, today, defaultOpen, currentId }: { phase: PhaseMeta; view: DailyView; today: string; defaultOpen: boolean; currentId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const days = CURRICULUM.days.filter((d) => d.phase === phase.id);
  const done = days.filter((d) => isDone(view.state, d.id)).length;
  const ready = days.filter((d) => isAuthored(d.id)).length;
  return (
    <Card pad="none" className="overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-4 p-4 text-left transition-colors duration-fast hover:bg-hover/5">
        <ProgressRing value={done} max={days.length} size={48} label={`${phase.title} progress`}>
          <span className="text-[10px] font-bold text-ink">{done}/{days.length}</span>
        </ProgressRing>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{phase.title}</span>
          <span className="block text-xs text-ink-faint">Days {phase.firstDay}–{phase.lastDay} · {ready === days.length ? "all lessons ready" : `${ready} of ${days.length} lessons ready`}</span>
          <span className="mt-1 block text-sm text-ink-muted">{phase.summary}</span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-ink-faint transition-transform duration-base ease-out ${open ? "rotate-180 text-accent" : ""}`} aria-hidden />
      </button>
      <div className="collapse-grid" data-open={open ? "true" : "false"}>
        <div>
          {open && (
            <ol className="df-timeline stagger border-t border-surface-border px-3 py-3">
              {days.map((d) => <DayRow key={d.id} day={d} view={view} today={today} isCurrent={d.id === currentId} />)}
            </ol>
          )}
        </div>
      </div>
    </Card>
  );
}

const LEGEND: { status: DayStatus; text: string }[] = [
  { status: "available", text: "Available" }, { status: "in-progress", text: "In progress" },
  { status: "completed", text: "Completed" }, { status: "revision", text: "Revision required" },
];

export function Roadmap({ view, previewPath }: { view: DailyView; previewPath?: BranchId }) {
  const today = useToday() ?? "";
  const shown = previewPath ?? view.path;
  const phases = phasesFor(shown);
  const cur = currentDay(view.seq, view.state);
  return (
    <section data-help="daily-roadmap" aria-labelledby="roadmap-h">
      <SectionHeader id="roadmap-h" title={previewPath ? `Preview: ${PATHS.find((p) => p.id === previewPath)?.title} roadmap` : "Day-by-day roadmap"}
        description="Open any day at any time. Days whose earlier topics are unfinished say so, and nothing is locked." />
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="Status legend">
        {LEGEND.map((l) => <li key={l.status} className="inline-flex items-center gap-1.5"><StatusIcon status={l.status} /> {l.text}</li>)}
      </ul>
      {!shown && <p className="mb-3 rounded-xl border border-surface-border bg-surface-soft p-3 text-sm text-ink-muted">The roadmap shows the 90 common days. Choose a path above (or preview one) to see days 91–180.</p>}
      <div className="space-y-3">
        {phases.map((p) => (
          <PhaseCard key={`${p.id}-${previewPath ?? ""}`} phase={p} view={view} today={today} currentId={previewPath ? undefined : cur?.id}
            defaultOpen={previewPath ? p.firstDay === 91 : cur?.phase === p.id} />
        ))}
      </div>
    </section>
  );
}

// ── Calendar ─────────────────────────────────────────────────────────────
const CELL: Record<CalendarKind, string> = {
  completed: "bg-success text-on-accent",
  active: "bg-success/40 text-ink",
  revision: "bg-warn/70 text-ink",
  today: "bg-accent text-on-accent ring-2 ring-accent/50 df-pulse",
  upcoming: "border border-dashed border-surface-border text-ink-faint",
  future: "border border-surface-border text-ink-faint",
  missed: "bg-surface-soft text-ink-faint",
};
const CAL_LEGEND: { kind: CalendarKind; text: string }[] = [
  { kind: "completed", text: "Day completed" }, { kind: "active", text: "Studied" }, { kind: "today", text: "Today" },
  { kind: "revision", text: "Revision" }, { kind: "upcoming", text: "Upcoming" }, { kind: "missed", text: "No activity (no penalty)" },
];

export function LearningCalendar({ view }: { view: DailyView }) {
  const today = useToday();
  const cells = useMemo(() => (today ? buildCalendar(view.seq, view.state, view.revisions, today) : []), [today, view.seq, view.state, view.revisions]);
  if (!today) return null;
  const lead = new Date(`${cells[0].date}T00:00:00Z`).getUTCDay();
  const offset = (lead + 6) % 7; // weeks start on Monday
  return (
    <section data-help="daily-calendar" aria-labelledby="cal-h">
      <SectionHeader id="cal-h" title="Learning calendar" description="Your last four weeks and the next two. Missing a day changes nothing: your place and progress are kept, and upcoming lessons simply wait." />
      <Card>
        <div className="mx-auto max-w-md"><div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-faint" aria-hidden>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5" role="list" aria-label="Calendar">
          {Array.from({ length: offset }, (_, i) => <span key={`b${i}`} />)}
          {cells.map((c, i) => {
            const label = [c.date, c.kind === "missed" ? "no activity" : c.kind, c.completed.length ? `completed ${c.completed.length}` : "", c.planned ? `planned: Day ${c.planned.day} ${c.planned.title}` : "", c.revisions.length ? `${c.revisions.length} revision due` : ""].filter(Boolean).join(", ");
            return (
              <span key={c.date} role="listitem" title={label} aria-label={label} style={{ ["--i" as string]: i }}
                className={`df-cell flex aspect-square items-center justify-center rounded-lg text-xs font-semibold ${CELL[c.kind]}`}>
                {Number(c.date.slice(8))}
              </span>
            );
          })}
        </div>
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {CAL_LEGEND.map((l) => <li key={l.kind} className="inline-flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded ${CELL[l.kind].split(" ").filter((c) => c.startsWith("bg-") || c.startsWith("border")).join(" ")}`} /> {l.text}</li>)}
        </ul>
      </Card>
    </section>
  );
}
