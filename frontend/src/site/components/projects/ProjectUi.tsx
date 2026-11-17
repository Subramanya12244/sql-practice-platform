import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Building2, Check, CheckCircle2, CircleDashed, CircleDot, Eraser, FileSpreadsheet, FolderGit2, Globe, Hourglass, Layers, RefreshCw, Rocket,
  Search, Send, ShieldCheck, Star, TrendingUp, Workflow, X, XCircle, Zap, type LucideIcon,
} from "lucide-react";
import { Badge, Button, ProgressBar } from "../ui";
import { useSettled } from "../Motion";
import { Icon, IconTile } from "../Icon";
import type { ProjectMeta, ProjectStatus } from "../../lib/projects";
import {
  LEVELS, STATUS_GROUP_LABEL, isProjectFiltered, NO_PROJECT_FILTER, taskState,
  type Level, type ProjectFilter, type ProjectProgressSummary, type StatusGroup, type TaskRef, type TaskState,
} from "../../lib/projectsLab";
import type { ProjectProgress } from "../../lib/projects";

// ── Visuals ──────────────────────────────────────────────────────────────
/** One icon per project, so a card is recognisable at a glance. Every project has an entry; a test checks that. */
export const PROJECT_ICON: Record<string, LucideIcon> = {
  "csv-to-postgres-etl": FileSpreadsheet,
  "python-data-cleaning": Eraser,
  "hr-analytics-warehouse": Building2,
  "sales-analytics-pipeline": TrendingUp,
  "incremental-loading": RefreshCw,
  "star-schema-warehouse": Star,
  "rest-api-to-postgres": Globe,
  "data-validation-pipeline": ShieldCheck,
  "airflow-etl-pipeline": Workflow,
  "pyspark-transformation": Zap,
  "dbt-analytics-project": Layers,
  "end-to-end-pipeline": Rocket,
};
export const projectIcon = (slug: string): LucideIcon => PROJECT_ICON[slug] ?? FolderGit2;

/** Beginner, intermediate and advanced each have their own colour, on the icon tile and the level badge. */
export const LEVEL_TONE: Record<Level, "success" | "info" | "secondary"> = { Beginner: "success", Intermediate: "info", Advanced: "secondary" };
const levelTone = (level: string) => LEVEL_TONE[level as Level] ?? "info";

const STATUS_UI: Record<ProjectStatus, { cls: string; icon: LucideIcon }> = {
  "Not started": { cls: "bg-surface-soft text-ink-muted", icon: CircleDashed },
  "In progress": { cls: "bg-accent-dim text-accent", icon: CircleDot },
  Submitted: { cls: "bg-info-dim text-info", icon: Send },
  "Under evaluation": { cls: "bg-warn-dim text-warn", icon: Hourglass },
  Completed: { cls: "bg-success-dim text-success", icon: CheckCircle2 },
  "Changes requested": { cls: "bg-warn-dim text-warn", icon: AlertTriangle },
  Rejected: { cls: "bg-danger-dim text-danger", icon: XCircle },
};

export function StatusChip({ s }: { s: ProjectStatus }) {
  const { cls, icon } = STATUS_UI[s];
  return <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors duration-base ${cls}`}><Icon icon={icon} size="inline" className="!h-3 !w-3" />{s}</span>;
}

// ── Card ─────────────────────────────────────────────────────────────────
/**
 * One project in the library. The whole card is the link (the title carries it, stretched over the card) so it works with a
 * keyboard and a screen reader; it lifts on hover, presses in on click and shows a focus ring. `summary` is the learner's real
 * progress and is only known in the browser, so before that the card shows the project's own counts.
 */
export function ProjectCard({ p, summary }: { p: ProjectMeta; summary?: ProjectProgressSummary }) {
  const status = summary?.status ?? "Not started";
  const passed = summary?.passed ?? 0;
  const techs = p.technologies.slice(0, 3);
  const more = p.technologies.length - techs.length;
  const next = summary?.next;
  const started = !!summary && (summary.passed > 0 || summary.failed > 0 || status !== "Not started");
  return (
    <article data-project={p.slug} className="group relative flex h-full flex-col rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition-[transform,border-color,box-shadow] duration-base ease-out focus-within:border-accent/50 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow active:translate-y-0 active:duration-instant">
      <div className="flex items-start gap-3">
        <IconTile icon={projectIcon(p.slug)} tone={levelTone(p.level)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-base font-semibold leading-snug text-ink">
              <Link to={`/projects-lab/${p.slug}`} className="transition-colors duration-fast after:absolute after:inset-0 after:rounded-card group-hover:text-accent focus-visible:outline-offset-4">{p.title}</Link>
            </h3>
            <StatusChip s={status} />
          </div>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint"><Badge tone={levelTone(p.level)}>{p.level}</Badge><span>{p.minutes >= 60 ? `${Math.round((p.minutes / 60) * 10) / 10} h` : `${p.minutes} min`}</span></p>
        </div>
      </div>
      <p className="mt-2.5 line-clamp-2 text-sm text-ink-muted">{p.description}</p>
      <ul className="mt-2.5 flex flex-wrap gap-1" aria-label="Technologies">
        {techs.map((t) => <li key={t}><Badge>{t}</Badge></li>)}
        {more > 0 && <li><Badge>+{more}</Badge></li>}
      </ul>
      <div className="mt-auto pt-3">
        <div className="mb-1 flex justify-between text-[11px] text-ink-faint">
          <span>{p.automated} auto-checked · {p.manual} manual</span>
          <span className="tabular-nums">{passed}/{p.automated} passed</span>
        </div>
        <ProgressBar value={passed} max={p.automated || 1} label={`${p.title}: ${passed} of ${p.automated} checks passed`} tone={status === "Completed" ? "success" : "accent"} />
        <p className="mt-2 flex min-h-[1.25rem] items-center gap-1 text-xs text-ink-muted">
          {summary && status === "Completed" ? <><Icon icon={Check} size="inline" className="text-success" />All checks passed</>
            : summary && next ? <><span className="shrink-0 text-ink-faint">{started ? "Next:" : "Start with:"}</span><span className="min-w-0 truncate font-medium text-ink">{next.title}</span><Icon icon={ArrowRight} size="inline" className="ml-auto text-ink-faint transition-transform duration-fast group-hover:translate-x-0.5" /></>
            : null}
        </p>
      </div>
    </article>
  );
}

// ── Filters ──────────────────────────────────────────────────────────────
const control = "min-h-[40px] w-full rounded-lg border bg-surface px-2.5 py-1.5 text-sm text-ink transition-colors duration-fast";

export function ProjectFilters({ filter, setFilter, techs, levelCounts, statusCounts, shown, total }: {
  filter: ProjectFilter; setFilter: (f: ProjectFilter) => void;
  techs: { tech: string; count: number }[]; levelCounts: Record<Level, number>; statusCounts: Record<StatusGroup, number>;
  shown: number; total: number;
}) {
  const set = (patch: Partial<ProjectFilter>) => setFilter({ ...filter, ...patch });
  const active = isProjectFiltered(filter);
  const on = (isActive: boolean) => (isActive ? "border-accent/60" : "border-surface-border");
  return (
    <div data-help="projects-filters" className="mb-5 space-y-3 rounded-card border border-surface-border bg-surface-raised p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_11rem]">
        <label className="relative block">
          <span className="sr-only">Search projects</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-faint" aria-hidden />
          <input type="search" value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search by name, technology or topic" className={`${control} pl-9 ${on(filter.q.trim() !== "")} placeholder:text-ink-faint`} />
        </label>
        <label className="block">
          <span className="sr-only">Technology</span>
          <select value={filter.tech} onChange={(e) => set({ tech: e.target.value })} className={`${control} ${on(filter.tech !== "all")}`}>
            <option value="all">Any technology</option>
            {techs.map((t) => <option key={t.tech} value={t.tech}>{t.tech} ({t.count})</option>)}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Status</span>
          <select value={filter.status} onChange={(e) => set({ status: e.target.value as ProjectFilter["status"] })} className={`${control} ${on(filter.status !== "all")}`}>
            <option value="all">Any status</option>
            {(Object.keys(STATUS_GROUP_LABEL) as StatusGroup[]).map((g) => <option key={g} value={g}>{STATUS_GROUP_LABEL[g]} ({statusCounts[g]})</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Difficulty" className="flex flex-wrap gap-1.5">
          {([["all", "All levels", total] as const, ...LEVELS.map((l) => [l, l, levelCounts[l]] as const)]).map(([id, label, count]) => (
            <button key={id} type="button" aria-pressed={filter.level === id} onClick={() => set({ level: id as ProjectFilter["level"] })}
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-[color,background-color,border-color,transform] duration-fast ease-out active:scale-[0.97] active:duration-instant ${filter.level === id ? "border-accent/50 bg-accent-dim text-accent" : "border-surface-border text-ink-muted hover:border-accent/40 hover:text-ink"}`}>
              {label}<span className="text-xs tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <p role="status" aria-live="polite" className="text-sm text-ink-muted tabular-nums">{shown === 0 ? "No projects found" : `${shown} of ${total} project${total === 1 ? "" : "s"}`}</p>
          {active && <Button variant="ghost" size="sm" onClick={() => setFilter(NO_PROJECT_FILTER)}><Icon icon={X} size="button" /> Clear filters</Button>}
        </div>
      </div>
    </div>
  );
}

// ── Task roadmap and results (project page) ──────────────────────────────
const TASK_STATE_UI: Record<TaskState, { icon: LucideIcon; cls: string; label: string }> = {
  passed: { icon: CheckCircle2, cls: "text-success", label: "Passed" },
  done: { icon: CheckCircle2, cls: "text-success", label: "Done" },
  failed: { icon: XCircle, cls: "text-danger", label: "Not passing yet" },
  partial: { icon: CircleDot, cls: "text-accent", label: "Some steps ticked" },
  pending: { icon: CircleDashed, cls: "text-ink-faint", label: "Not run yet" },
  todo: { icon: CircleDashed, cls: "text-ink-faint", label: "Not started" },
};
const TASK_TYPE_LABEL: Record<TaskRef["type"], string> = { sql: "SQL", python: "Python", decision: "Decision", checklist: "Manual" };

/** Every task of the project in order, each with its real state. The next task is marked, and every row jumps to its panel. */
export function TaskRoadmap({ tasks, progress, nextId }: { tasks: TaskRef[]; progress: ProjectProgress; nextId?: string }) {
  // A tick pops only when a task changes state while you are on the page, never when the page first fills in from storage.
  const settled = useSettled();
  return (
    <ol aria-label="Task roadmap" className="divide-y divide-surface-border">
      {tasks.map((t, i) => {
        const st = taskState(t, progress);
        const ui = TASK_STATE_UI[st];
        const isNext = t.id === nextId;
        return (
          <li key={t.id}>
            <a href={`#task-${t.id}`} aria-current={isNext ? "step" : undefined}
              className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-fast hover:bg-hover/5 ${isNext ? "bg-accent/10 shadow-[inset_2px_0_0_0_rgb(var(--color-accent))]" : ""}`}>
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-ink-faint">{i + 1}</span>
              <span key={st} className={`inline-flex shrink-0 ${settled && (st === "passed" || st === "done") ? "animate-pop" : ""}`}><Icon icon={ui.icon} size="button" className={ui.cls} label={ui.label} /></span>
              <span className={`min-w-0 flex-1 truncate ${st === "passed" || st === "done" ? "text-ink-muted" : "text-ink"} ${isNext ? "font-semibold" : ""}`}>{t.title}</span>
              {isNext && <Badge tone="accent">Next</Badge>}
              <span className="hidden shrink-0 text-[11px] uppercase tracking-wider text-ink-faint sm:inline">{TASK_TYPE_LABEL[t.type]}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The outcome of a check, in words and an icon (never colour alone). It is announced to screen readers, fades in when a new
 * result arrives, and on a pass the icon pops once. The message is exactly what the check returned.
 */
export function ResultBanner({ ok, message, fresh = false, nextTitle, nextHref }: { ok: boolean; message: string; /** The result just arrived (not read back from storage): animate it. */ fresh?: boolean; nextTitle?: string; nextHref?: string }) {
  return (
    <div role="status" className={`mt-3 rounded-lg border px-3 py-2.5 text-sm transition-colors duration-base ${fresh ? "animate-fade-in" : ""} ${ok ? "border-success/40 bg-success-dim" : "border-danger/40 bg-danger-dim"}`}>
      <p className={`flex items-center gap-2 font-semibold ${ok ? "text-success" : "text-danger"}`}>
        <span className={fresh && ok ? "inline-flex animate-pop" : "inline-flex"}><Icon icon={ok ? CheckCircle2 : XCircle} size="button" /></span>
        {ok ? "Check passed" : "Check did not pass"}
      </p>
      {message && <p className="mt-1 whitespace-pre-wrap break-words text-ink">{message}</p>}
      {ok && nextTitle && nextHref && (
        <a href={nextHref} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">Next task: {nextTitle} <Icon icon={ArrowRight} size="inline" /></a>
      )}
    </div>
  );
}

