import { useMemo, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Circle, CircleDot, PanelsTopLeft } from "lucide-react";
import { useProgress } from "../../lib/progress";
import { readStats, subscribeStats, type PyStat } from "../../lib/pyPractice";
import { useMounted } from "../../lib/useDaily";
import { DOMAIN_LABEL, STATE_LABEL, domainOfId, nextWorkspaceStep, practiceState, sqlId, type LinkedExercise, type PracticeItem, type PracticeState } from "../../lib/workspaceLinks";
import type { DailyState } from "../../lib/dailyProgress";
import type { DayMeta } from "../../lib/daily";
import { Card } from "../ui";
import { workspaceUrl } from "../WorkspaceLink";

const EMPTY_STATS = "{}";
const statsSnapshot = () => JSON.stringify(readStats());

/**
 * What the learner has done with an exercise, from the stores the other pages write (SQL progress, Python stats, Daily record).
 * Read only. Server render and the first client render see an empty record (the same pattern as `useProgress`), so the block
 * hydrates without a mismatch and the real states follow.
 */
export function usePracticeState(): (id: string) => PracticeState {
  const progress = useProgress();
  const raw = useSyncExternalStore(subscribeStats, statsSnapshot, () => EMPTY_STATS);
  const stats = useMemo<Record<string, PyStat>>(() => { try { return JSON.parse(raw) as Record<string, PyStat>; } catch { return {}; } }, [raw]);
  return useMemo(() => (id: string) => practiceState(id, progress, stats), [progress, stats]);
}

const row = "group flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2 text-sm transition-colors duration-fast hover:border-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

function StateIcon({ state }: { state: PracticeState }) {
  const cls = "h-4 w-4 shrink-0";
  return (
    <>
      {state === "solved" ? <CheckCircle2 className={`${cls} text-success`} aria-hidden /> : state === "attempted" ? <CircleDot className={`${cls} text-warn`} aria-hidden /> : <Circle className={`${cls} text-ink-faint`} aria-hidden />}
      <span className="sr-only">{STATE_LABEL[state]}: </span>
    </>
  );
}

function DomainChip({ domain }: { domain: PracticeItem["domain"] }) {
  return <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-medium text-ink-muted">{DOMAIN_LABEL[domain]}</span>;
}

const intro = "Write and run your own code, see what it does step by step, and check the answer. Opening an exercise never marks it done.";

/** "Practise in the workspace" on a Learn hub topic page: a few real exercises, easiest first, each with its real progress. */
export function WorkspacePracticeBlock({ items, headingId = "workspace-heading" }: { items: PracticeItem[]; headingId?: string }) {
  const stateOf = usePracticeState();
  const mounted = useMounted();
  if (items.length === 0) return null;
  const solved = items.filter((i) => stateOf(i.id) === "solved").length;
  return (
    <div data-testid="workspace-practice"><Card as="section" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={headingId} className="flex items-center gap-2 font-display text-h3 text-ink"><PanelsTopLeft className="h-5 w-5 text-accent" aria-hidden /> Practise in the workspace</h2>
        {mounted && <span className="text-xs tabular-nums text-ink-muted" data-testid="workspace-practice-count">{solved} of {items.length} solved</span>}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{intro}</p>
      <ul className="mt-3 space-y-1.5">
        {items.map((i) => (
          <li key={i.id}>
            <Link to={workspaceUrl(i.id)} className={row} data-testid="workspace-exercise-link" data-exercise-id={i.id}>
              <span className="flex min-w-0 items-center gap-2"><StateIcon state={stateOf(i.id)} /><span className="truncate font-medium text-ink group-hover:text-accent">{i.title}</span></span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-ink-faint"><DomainChip domain={i.domain} />{i.difficulty}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card></div>
  );
}

/** A linked exercise's workspace domain label. Daily ids resolve through the generated lesson table. */
function domainLabelOf(id: string): string {
  const d = domainOfId(id);
  return d ? DOMAIN_LABEL[d] : "";
}

/**
 * The reviewed list used by a Projects Lab task and a business scenario: exercises that practise the same concept, each with the one line
 * that says why and its real progress. It only links; completing the task or the scenario is decided where it always was.
 */
export function LinkedExerciseList({ items, label = "Open a practice exercise", testId = "task-practice" }: { items: LinkedExercise[]; label?: string; testId?: string }) {
  const stateOf = usePracticeState();
  if (items.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-surface-border bg-surface-soft/50 px-3 py-2 text-sm" data-testid={testId}>
      <summary className="flex cursor-pointer items-center gap-2 py-1 font-medium text-ink"><PanelsTopLeft className="h-4 w-4 text-accent" aria-hidden /> {label} <span className="text-xs font-normal text-ink-faint">({items.length})</span></summary>
      <p className="mt-1 text-xs text-ink-muted">These exercises practise the same idea. They open in the exercise workspace and do not change this task or its status.</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((e) => (
          <li key={e.id}>
            <Link to={workspaceUrl(e.id)} className={row} data-testid="workspace-exercise-link" data-exercise-id={e.id}>
              <span className="flex min-w-0 items-start gap-2"><span className="mt-0.5 flex items-center gap-2"><StateIcon state={stateOf(e.id)} /></span><span className="min-w-0"><span className="block truncate font-medium text-ink group-hover:text-accent">{e.title}</span><span className="block text-xs text-ink-muted">{e.why}</span></span></span>
              <span className="shrink-0 text-xs text-ink-faint">{domainLabelOf(e.id)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** On a path page: the first exercise, in lesson order, of the first lesson not completed that the learner has not passed. */
export function PathWorkspaceStep({ days, daily }: { days: DayMeta[]; daily: DailyState }) {
  const step = useMemo(() => nextWorkspaceStep(days, daily), [days, daily]);
  if (!step) return null;
  return (
    <Link to={workspaceUrl(step.id)} className={`${row} mb-3`} data-testid="path-workspace-step" data-exercise-id={step.id}>
      <span className="min-w-0">
        <span className="block text-xs font-semibold uppercase tracking-wider text-accent">Next exercise to solve in the workspace</span>
        <span className="block truncate font-medium text-ink group-hover:text-accent">Day {step.day}: {step.lessonTitle}</span>
        <span className="block text-xs text-ink-muted">{step.label} · {DOMAIN_LABEL[step.domain]}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
    </Link>
  );
}

/** On a question topic page or the questions list: the first unsolved question (or the first one) in the workspace. */
export function NextQuestionLink({ questions, className = "" }: { questions: { slug: string; title: string; number: number }[]; className?: string }) {
  const progress = useProgress();
  const next = questions.find((q) => !progress.questions[q.number]?.solvedAt) ?? questions[0];
  const allSolved = questions.length > 0 && questions.every((q) => progress.questions[q.number]?.solvedAt);
  if (!next) return null;
  return (
    <p className={`text-sm text-ink-muted ${className}`} data-testid="next-question-workspace">
      <Link to={workspaceUrl(sqlId(next.slug))} className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline" data-testid="workspace-exercise-link" data-exercise-id={sqlId(next.slug)}>
        <PanelsTopLeft className="h-4 w-4" aria-hidden /> {allSolved ? "Practise again in the workspace" : "Practise the next unsolved question in the workspace"}
      </Link>{" "}
      <span className="text-ink-faint">{next.title}</span>
    </p>
  );
}
