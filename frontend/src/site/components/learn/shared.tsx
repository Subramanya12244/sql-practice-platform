import { useMemo } from "react";
import { BarChart3, Clock, Code2, Database, Workflow, type LucideIcon } from "lucide-react";
import { usePage } from "../../SiteApp";
import { useDaily, useMasteredIds, useMounted } from "../../lib/useDaily";
import { getProjectProgress } from "../../lib/projects";
import type { LearnHubData } from "../../lib/learnLoad";
import type { PathContext } from "../../lib/learnPaths";
import { durationLabel, type Subject, type TopicStatus } from "../../lib/learnTopics";

export const SUBJECT_STYLE: Record<Subject, { icon: LucideIcon; chip: string; text: string }> = {
  sql: { icon: Database, chip: "bg-accent-dim text-accent", text: "text-accent" },
  python: { icon: Code2, chip: "bg-info-dim text-info", text: "text-info" },
  analytics: { icon: BarChart3, chip: "bg-warn-dim text-warn", text: "text-warn" },
  engineering: { icon: Workflow, chip: "bg-secondary-dim text-secondary", text: "text-secondary" },
};

export function SubjectIcon({ subject, size = "md" }: { subject: Subject; size?: "sm" | "md" }) {
  const { icon: Icon, chip } = SUBJECT_STYLE[subject];
  return <span className={`inline-flex shrink-0 rounded-xl ${size === "sm" ? "p-1.5" : "p-2.5"} ${chip}`}><Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} aria-hidden /></span>;
}

export const STATUS_TONE: Record<TopicStatus, string> = {
  new: "bg-surface-soft text-ink-muted",
  started: "bg-info-dim text-info",
  learned: "bg-success-dim text-success",
};

export function StatusPill({ status, label }: { status: TopicStatus; label: string }) {
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}>{label}</span>;
}

export function TopicDuration({ minutes }: { minutes: number }) {
  return <span className="inline-flex items-center gap-1 text-xs text-ink-faint"><Clock className="h-3.5 w-3.5" aria-hidden /> {durationLabel(minutes)}</span>;
}

/** "2 days ago". Only called after mount, so the prerendered HTML never contains a time that depends on when it was built. */
export function ago(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "recently";
  const min = Math.floor(ms / 60000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 31) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const NO_PROJECT_PROGRESS = () => ({ tasks: {}, checklist: {} });

/**
 * Everything the hub pages derive progress from, in one place: the page's compact hub data plus the learner's existing
 * progress. Server render and first client render see an empty record, so hydration matches; the real values follow.
 */
export function useLearnModel(): { hub: LearnHubData | undefined; ctx: PathContext | null; view: ReturnType<typeof useDaily>; mounted: boolean } {
  const { data } = usePage();
  const hub = data.learnHub;
  const view = useDaily();
  const masteredIds = useMasteredIds(view.state);
  const mounted = useMounted();
  const ctx = useMemo<PathContext | null>(() => hub ? {
    daily: view.state, masteredIds, progress: view.progress, topics: hub.topics, lessons: hub.lessons, projects: hub.projects, projectTasks: hub.projectTasks,
    projectProgress: mounted ? getProjectProgress : NO_PROJECT_PROGRESS,
  } : null, [hub, view.state, view.progress, masteredIds, mounted]);
  return { hub, ctx, view, mounted };
}
