import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Bookmark, Briefcase, Brain, ClipboardList, Code2, Database, FileText, FlaskConical, FolderGit2, Layers, Network, Puzzle, Zap, type LucideIcon } from "lucide-react";
import { Badge, Card, ProgressBar, SectionHeader } from "../ui";
import { LevelBadge } from "../LearnUi";
import { projectStatus, type ProjectMeta, type ProjectProgress, type ProjectStatus } from "../../lib/projects";
import type { LearnHubData } from "../../lib/learnLoad";
import type { Progress } from "../../lib/progress";
import type { QuestionSummary } from "../../types";

const STATUS_TONE: Record<ProjectStatus, "neutral" | "info" | "success" | "warn" | "danger"> = {
  "Not started": "neutral", "In progress": "info", Submitted: "info", "Under evaluation": "info", Completed: "success", "Changes requested": "warn", Rejected: "danger",
};
const LEVEL_RANK: Record<string, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };

function Tile({ to, icon: Icon, title, meta, children }: { to: string; icon: LucideIcon; title: string; meta: string; children?: React.ReactNode }) {
  return (
    <Link to={to} className="group flex h-full flex-col rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition-all duration-base ease-out hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow active:scale-[0.995]">
      <span className="flex items-center gap-2.5">
        <span className="rounded-lg bg-accent-dim p-2 text-accent"><Icon className="h-4 w-4" aria-hidden /></span>
        <span className="font-semibold text-ink group-hover:text-accent">{title}</span>
      </span>
      <span className="mt-2 text-sm text-ink-muted">{meta}</span>
      {children}
    </Link>
  );
}

/** Practice you can do now, with real counts; projects in progress first, then the easiest ones to start. */
export function PracticeProjects({ hub, progress, index, mounted, projectProgress }: {
  hub: LearnHubData; progress: Pick<Progress, "questions" | "lessons">; index: QuestionSummary[]; mounted: boolean; projectProgress: (slug: string) => ProjectProgress;
}) {
  const sqlSolved = index.filter((q) => progress.questions[q.number]?.solvedAt).length;
  const pyPassed = Object.keys(progress.lessons ?? {}).filter((k) => k.startsWith("py:")).length;
  const rows = useMemo(() => hub.projects.map((p) => {
    const tasks = hub.projectTasks.find((t) => t.slug === p.slug)?.tasks ?? [];
    const status = mounted ? projectStatus({ tasks }, projectProgress(p.slug)) : "Not started";
    return { p, status };
  }), [hub.projects, hub.projectTasks, mounted, projectProgress]);
  const active = rows.filter((r) => r.status === "In progress" || r.status === "Submitted" || r.status === "Under evaluation");
  const suggested = rows.filter((r) => r.status === "Not started").sort((a, b) => (LEVEL_RANK[a.p.level] ?? 1) - (LEVEL_RANK[b.p.level] ?? 1) || a.p.minutes - b.p.minutes);
  const featured = [...active, ...suggested].slice(0, 3);
  const completed = rows.filter((r) => r.status === "Completed").length;

  return (
    <section id="practice" aria-labelledby="practice-heading" data-help="hub-practice" className="scroll-mt-20">
      <SectionHeader id="practice-heading" title="Hands-on practice and projects" description="Everything here runs in your browser and is checked automatically."
        action={<Link to="/projects-lab" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">All {hub.counts.projects} projects <ArrowRight className="h-4 w-4" aria-hidden /></Link>} />
      <div className="grid gap-4 lg:grid-cols-5">
        <ul className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
          <li><Tile to="/questions" icon={Database} title="SQL practice" meta={`${index.length} graded questions on a real PostgreSQL database`}>
            <span className="mt-3 block"><ProgressBar value={mounted ? sqlSolved : 0} max={index.length || 1} label={`SQL questions solved: ${sqlSolved} of ${index.length}`} /><span className="mt-1 block text-xs text-ink-muted">{mounted ? `${sqlSolved} of ${index.length} solved` : "Your solved count appears here"}</span></span>
          </Tile></li>
          <li><Tile to="/practice/python" icon={Code2} title="Python practice" meta={`${hub.counts.exercises} problems checked in your browser`}>
            <span className="mt-3 block"><ProgressBar value={mounted ? pyPassed : 0} max={hub.counts.exercises || 1} label={`Python problems passed: ${pyPassed} of ${hub.counts.exercises}`} /><span className="mt-1 block text-xs text-ink-muted">{mounted ? `${pyPassed} of ${hub.counts.exercises} passed` : "Your passed count appears here"}</span></span>
          </Tile></li>
          <li><Tile to="/scenarios" icon={Briefcase} title="Business scenarios" meta={`${hub.counts.scenarios} realistic problems: write the query, read the answer like an analyst`} /></li>
          <li><Tile to="/etl-builder" icon={FlaskConical} title="Data engineering labs" meta="ETL builder, DAG simulator, schema designer and data quality exercises" /></li>
        </ul>
        <Card as="section" pad="md" className="lg:col-span-2" aria-labelledby="featured-projects">
          <h3 id="featured-projects" className="flex items-center gap-2 font-display text-h3 text-ink"><FolderGit2 className="h-4 w-4 text-accent" aria-hidden /> Guided projects</h3>
          <p className="mt-0.5 text-xs text-ink-muted">{mounted ? `${active.length} in progress · ${completed} completed · ${hub.counts.projects} in total` : `${hub.counts.projects} projects, from beginner to advanced`}</p>
          <ul className="mt-3 space-y-2">
            {featured.map(({ p, status }) => (
              <li key={p.slug}>
                <Link to={`/projects-lab/${p.slug}`} className="group block rounded-lg border border-surface-border px-3 py-2 transition-colors duration-fast hover:border-accent/40">
                  <span className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm font-medium text-ink group-hover:text-accent">{p.title}</span>{mounted && status !== "Not started" && <Badge tone={STATUS_TONE[status]}>{status}</Badge>}</span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-ink-faint"><LevelBadge level={p.level} /><span>{p.minutes} min</span><span className="truncate">{(p as ProjectMeta).technologies.slice(0, 3).join(", ")}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

const SHELF: { to: string; label: string; icon: LucideIcon; desc: string; count?: (h: LearnHubData) => number }[] = [
  { to: "/notes", label: "Theory notes", icon: BookOpen, desc: "Definitions, examples, common mistakes and interview questions", count: (h) => h.counts.notes },
  { to: "/patterns", label: "Patterns", icon: Puzzle, desc: "Reusable shapes for recurring SQL problems", count: (h) => h.counts.patterns },
  { to: "/mindmaps", label: "Mind maps", icon: Network, desc: "See how concepts connect", count: (h) => h.counts.maps },
  { to: "/concepts", label: "Concept guides", icon: Brain, desc: "Short, example-first explanations", count: (h) => h.counts.guides },
  { to: "/cheatsheet", label: "Cheat sheet", icon: FileText, desc: "One printable page of SQL syntax" },
  { to: "/shortcuts", label: "Syntax reference", icon: Zap, desc: "Searchable, with runnable examples" },
  { to: "/flashcards", label: "Flashcards", icon: Layers, desc: "Spaced repetition on what you solved" },
  { to: "/study-notes", label: "Study notes", icon: ClipboardList, desc: "Turn solved problems into a PDF guide" },
];

export function ResourceShelf({ hub, progress, mounted }: { hub: LearnHubData; progress: Pick<Progress, "read" | "bookmarks">; mounted: boolean }) {
  const read = Object.keys(progress.read ?? {}).length;
  const saved = progress.bookmarks?.length ?? 0;
  return (
    <section id="resources" aria-labelledby="resources-heading" data-help="hub-resources" className="scroll-mt-20">
      <SectionHeader id="resources-heading" title="Learning resources" description="Reference material to read, revise and look things up."
        action={mounted && (read > 0 || saved > 0) ? <p className="flex items-center gap-1.5 text-sm text-ink-muted"><Bookmark className="h-4 w-4" aria-hidden /> {read} notes read · {saved} saved</p> : undefined} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SHELF.map(({ to, label, icon: Icon, desc, count }) => (
          <li key={to}>
            <Link to={to} className="group flex h-full gap-3 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition-all duration-base ease-out hover:-translate-y-0.5 hover:border-accent/40">
              <span className="h-fit rounded-lg bg-accent-dim p-2 text-accent"><Icon className="h-4 w-4" aria-hidden /></span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-2 font-semibold text-ink group-hover:text-accent">{label}{count && <span className="text-xs font-medium tabular-nums text-ink-faint">{count(hub)}</span>}</span>
                <span className="mt-0.5 block text-sm text-ink-muted">{desc}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
