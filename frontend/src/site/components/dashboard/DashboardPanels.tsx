import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, BookOpenCheck, CheckCircle2, FolderKanban, ListChecks, PlayCircle, RotateCcw, Sparkles, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import { Badge, Card, EmptyState, ProgressBar, SectionHeader } from "../ui";
import { SKILL_STATUS_LABEL, type SkillRow, type SkillStatus } from "../../lib/skills";
import type { NextAction, ProjectActivity, RevisionSummary } from "../../lib/dashboardModel";

const KIND_ICON: Record<NextAction["kind"], ComponentType<{ className?: string }>> = {
  daily: PlayCircle, revision: RotateCcw, mistakes: Wrench, project: FolderKanban, practice: ListChecks,
};

/** Recommended next actions, each one from a stated fact in the learner's own progress. */
export function NextActionsCard({ actions }: { actions: NextAction[] }) {
  return (
    <Card as="section" aria-labelledby="next-actions" data-help="learn-next">
      <SectionHeader id="next-actions" title="What to do next" description="From your lessons, revision, mistakes and projects" />
      <ol className="space-y-2">
        {actions.map((a) => {
          const Icon = KIND_ICON[a.kind];
          return (
            <li key={a.id}>
              <Link to={a.to} className="group flex items-start gap-3 rounded-lg border border-surface-border px-3 py-2.5 transition-colors duration-fast hover:border-accent/40">
                <span className="mt-0.5 rounded-lg bg-accent-dim p-1.5 text-accent"><Icon className="h-4 w-4" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink group-hover:text-accent">{a.title}</span>
                  <span className="block text-xs text-ink-muted">{a.detail}</span>
                </span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

const STATUS_TONE: Record<SkillStatus, "neutral" | "info" | "accent" | "success" | "secondary"> = {
  "not-assessed": "neutral", started: "info", practicing: "accent", completed: "success", mastered: "secondary",
};
const STATUS_ORDER: SkillStatus[] = ["not-assessed", "started", "practicing", "completed", "mastered"];

/** Skill mastery. The bar is lessons completed; the badge is what the evidence supports. */
export function SkillMasteryCard({ rows }: { rows: SkillRow[] }) {
  return (
    <Card as="section" aria-labelledby="skill-mastery" data-help="learn-skills">
      <SectionHeader id="skill-mastery" title="Skill mastery" description="From completed lessons and graded practice. Nothing is shown that you have not done." />
      <ul className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Link to={r.to} className="text-sm font-semibold text-ink hover:text-accent">{r.label}</Link>
              <Badge tone={STATUS_TONE[r.status]}>{SKILL_STATUS_LABEL[r.status]}</Badge>
            </div>
            <ProgressBar value={r.done} max={r.total || 1} label={`${r.label}: lessons completed`} tone={r.status === "mastered" ? "success" : "accent"} />
            <p className="mt-1 text-xs text-ink-muted">
              {r.total > 0 ? `${r.done} of ${r.total} lessons completed${r.done ? ` · ${r.mastered} mastered` : ""}` : "No lessons yet"}
              {r.practice ? ` · ${r.practice.value} of ${r.practice.max} ${r.practice.label}` : ""}
              {r.onlyOnPath ? ` · part of the ${r.onlyOnPath} path` : ""}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
        {STATUS_ORDER.map((s) => SKILL_STATUS_LABEL[s]).join(" → ")}. Completed means every lesson of the skill is done. Mastered also needs a knowledge check of 80% or more, the independent exercises passed and the revision task done.
      </p>
    </Card>
  );
}

/** Revision and mistakes: what is due, what keeps going wrong, where the weak topics are, what you have corrected. */
export function RevisionCard({ summary }: { summary: RevisionSummary }) {
  const { pending, repeated, weakTopics, corrected } = summary;
  const nothing = pending.total === 0 && repeated.length === 0 && weakTopics.length === 0 && corrected.length === 0;
  return (
    <Card as="section" aria-labelledby="revision-mistakes" data-help="learn-revision" className="lg:col-span-2">
      <SectionHeader id="revision-mistakes" title="Revision and mistakes" action={<Link to="/mistakes" className="text-sm font-medium text-accent hover:underline">Mistake notebook</Link>} />
      {nothing ? (
        <EmptyState icon={BookOpenCheck} title="Nothing to revise yet">Solved questions, lessons and flashcards come back here on a spaced schedule, and mistakes you make are collected for you.</EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-label uppercase text-ink-faint">Pending revision</p>
            {pending.total === 0 ? <p className="mt-2 text-sm text-ink-muted">Nothing due.</p> : (
              <ul className="mt-2 grid grid-cols-3 gap-2 text-center">
                {([["questions", pending.questions, "/review"], ["flashcards", pending.cards, "/flashcards"], ["lessons", pending.lessons, "/daily"]] as const).map(([label, n, to]) => (
                  <li key={label}><Link to={to} className="block rounded-lg bg-surface-overlay p-2 hover:ring-1 hover:ring-accent/40"><span className="block font-display text-xl font-bold tabular-nums text-ink">{n}</span><span className="text-[11px] text-ink-muted">{label}</span></Link></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="flex items-center gap-1 text-label uppercase text-ink-faint"><AlertTriangle className="h-3 w-3 text-warn" aria-hidden /> Repeated mistakes</p>
            {repeated.length === 0 ? <p className="mt-2 text-sm text-ink-muted">No pattern yet.</p> : (
              <ul className="mt-2 space-y-1.5 text-sm">{repeated.map((m) => <li key={`${m.kind}-${m.category}`} className="flex justify-between gap-2"><span className="text-ink">{m.label}</span><span className="text-xs tabular-nums text-ink-muted">{m.count}× on {m.questions} challenges</span></li>)}</ul>
            )}
          </div>
          <div>
            <p className="text-label uppercase text-ink-faint">Weak topics</p>
            {weakTopics.length === 0 ? <p className="mt-2 text-sm text-ink-muted">None open.</p> : (
              <ul className="mt-2 space-y-1.5 text-sm">{weakTopics.map((t) => <li key={t.topic} className="flex justify-between gap-2"><span className="text-ink">{t.label}</span><span className="text-xs text-ink-muted">{t.open} open</span></li>)}</ul>
            )}
          </div>
          <div>
            <p className="flex items-center gap-1 text-label uppercase text-ink-faint"><CheckCircle2 className="h-3 w-3 text-success" aria-hidden /> Recently corrected</p>
            {corrected.length === 0 ? <p className="mt-2 text-sm text-ink-muted">Nothing corrected yet.</p> : (
              <ul className="mt-2 space-y-1.5 text-sm">{corrected.map((r) => <li key={r.ref}><Link to={r.path} className="block truncate text-ink hover:text-accent">{r.title}</Link></li>)}</ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Projects: what is in progress, what is complete, and one to start next. */
export function ProjectActivityCard({ activity }: { activity: ProjectActivity }) {
  return (
    <Card as="section" aria-labelledby="project-activity" data-help="learn-projects">
      <SectionHeader id="project-activity" title="Projects" description={`${activity.completed.length} of ${activity.total} completed`} action={<Link to="/projects-lab" className="text-sm font-medium text-accent hover:underline">All</Link>} />
      {activity.current.length === 0 && !activity.next && activity.completed.length === 0 ? (
        <p className="text-sm text-ink-muted">Guided projects appear here as you start them.</p>
      ) : (
        <ul className="space-y-3">
          {activity.current.slice(0, 2).map((r) => (
            <li key={r.meta.slug}>
              <Link to={`/projects-lab/${r.meta.slug}`} className="block rounded-lg border border-surface-border p-3 hover:border-accent/40">
                <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-ink">{r.meta.title}</span><Badge tone="info">{r.status}</Badge></span>
                {r.total > 0 && <ProgressBar className="mt-2" value={r.passed} max={r.total} label={`${r.meta.title}: checks passed`} />}
                {r.total > 0 && <span className="mt-1 block text-xs text-ink-muted">{r.passed} of {r.total} automated checks passed</span>}
              </Link>
            </li>
          ))}
          {activity.current.length === 0 && activity.next && (
            <li>
              <Link to={`/projects-lab/${activity.next.slug}`} className="block rounded-lg border border-dashed border-accent/40 p-3 hover:bg-accent-dim">
                <span className="flex items-center gap-1 text-label uppercase text-accent"><Sparkles className="h-3 w-3" aria-hidden /> Suggested next</span>
                <span className="mt-1 block text-sm font-semibold text-ink">{activity.next.title}</span>
                <span className="block text-xs text-ink-muted">{activity.next.level} · checked automatically</span>
              </Link>
            </li>
          )}
          {activity.completed.slice(0, 2).map((r) => (
            <li key={r.meta.slug} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden /><Link to={`/projects-lab/${r.meta.slug}`} className="truncate text-ink hover:text-accent">{r.meta.title}</Link></li>
          ))}
        </ul>
      )}
    </Card>
  );
}
