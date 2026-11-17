import { Link } from "react-router-dom";
import {
  ArrowRight, Award, BarChart3, Code2, Database, GitBranch, Hammer, PlayCircle, Rocket, ShieldCheck, Table2, TrendingUp, Workflow,
  BookOpen, Target, type LucideIcon,
} from "lucide-react";
import { Badge, ButtonLink, Card, ProgressBar } from "../ui";
import { CURRICULUM, PATHS, dayHref, isAuthored } from "../../lib/daily";
import { dailyResume } from "../../lib/dailyResume";
import type { DailyView } from "../../lib/useDaily";

/** The four areas DataForge teaches. Each tile links only to pages that exist. */
const DOMAINS: { icon: LucideIcon; title: string; body: string; to: string; tracks: { label: string; to: string }[] }[] = [
  {
    icon: Database, title: "SQL and Databases", to: "/questions",
    body: "Write queries on a real PostgreSQL copy of Northwind, then watch each clause run on real rows.",
    tracks: [{ label: "SQL practice", to: "/questions" }, { label: "Query visualizer", to: "/query-visualizer" }, { label: "SQL notes", to: "/notes" }, { label: "Database design", to: "/schema-designer" }],
  },
  {
    icon: Code2, title: "Python and Analytics", to: "/practice/python",
    body: "Python, NumPy, pandas and statistics, with code that runs in your browser and shows what changed.",
    tracks: [{ label: "Python practice", to: "/practice/python" }, { label: "pandas and NumPy", to: "/visual/data" }, { label: "Statistics lab", to: "/visual/stats" }, { label: "Code time machine", to: "/visual/python" }],
  },
  {
    icon: Workflow, title: "Data Engineering", to: "/data-engineering",
    body: "Pipelines, orchestration, data quality and warehousing, built and run on sample data.",
    tracks: [{ label: "Learning tracks", to: "/data-engineering" }, { label: "ETL builder", to: "/etl-builder" }, { label: "DAG simulator", to: "/dag-simulator" }, { label: "Data quality", to: "/dq-exercises" }],
  },
  {
    icon: BarChart3, title: "Business Intelligence", to: "/scenarios",
    body: "Turn data into answers: business scenarios, charts, spreadsheets and the analyst path of the programme.",
    tracks: [{ label: "Business scenarios", to: "/scenarios" }, { label: "Chart explorer", to: "/visual/charts" }, { label: "Business lab", to: "/visual/business" }, { label: "Excel lab", to: "/visual/excel" }],
  },
];

export function LearningDomains() {
  return (
    <section aria-labelledby="domains" className="border-b border-surface-border py-14">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <p className="text-label uppercase text-accent">What you can learn</p>
        <h2 id="domains" className="mt-2 font-display text-h2 text-ink">Four areas, one connected path</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {DOMAINS.map(({ icon: Icon, title, body, to, tracks }) => (
            <Card key={title} pad="md" interactive className="flex flex-col">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-accent-dim p-2.5 text-accent"><Icon className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0">
                  <h3 className="font-display text-h3 text-ink"><Link to={to} className="hover:text-accent">{title}</Link></h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</p>
                </div>
              </div>
              <ul className="mt-4 flex flex-wrap gap-2" aria-label={`${title} tracks`}>
                {tracks.map((t) => (
                  <li key={t.to}>
                    <Link to={t.to} className="inline-flex items-center rounded-full border border-surface-border px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors duration-fast hover:border-accent/40 hover:text-accent">{t.label}</Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

const JOURNEY: { icon: LucideIcon; step: string; body: string; links: { label: string; to: string }[] }[] = [
  { icon: BookOpen, step: "Learn", body: "One guided lesson a day, plus notes, mind maps and cheat sheets.", links: [{ label: "Daily Learning", to: "/daily" }, { label: "Notes", to: "/notes" }] },
  { icon: Code2, step: "Practice", body: "Graded SQL and Python on real data, with hints that do not give the answer away.", links: [{ label: "SQL", to: "/questions" }, { label: "Python", to: "/practice/python" }] },
  { icon: Hammer, step: "Build", body: "Guided projects and labs: pipelines, schemas and data quality checks.", links: [{ label: "Projects", to: "/projects-lab" }, { label: "ETL builder", to: "/etl-builder" }] },
  { icon: Award, step: "Prove", body: "Timed assessments and mock interviews, with an evidence-based readiness view.", links: [{ label: "Assessments", to: "/assessments" }, { label: "Readiness", to: "/readiness" }] },
  { icon: TrendingUp, step: "Grow", body: "A study plan by role, answer practice and a portfolio of verified work.", links: [{ label: "Study planner", to: "/career/planner" }, { label: "Portfolio", to: "/portfolio" }] },
];

export function LearningJourney() {
  return (
    <section aria-labelledby="journey" className="border-b border-surface-border bg-surface-raised/40 py-14">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <p className="text-label uppercase text-accent">The learning journey</p>
        <h2 id="journey" className="mt-2 font-display text-h2 text-ink">Learn, practise, build, prove, grow</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-5" aria-label="Learning journey">
          {JOURNEY.map(({ icon: Icon, step, body, links }, i) => (
            <li key={step} className="relative rounded-card border border-surface-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-dim text-accent"><Icon className="h-4 w-4" aria-hidden /></span>
                <span className="font-mono text-[11px] text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="mt-3 font-display text-h3 uppercase tracking-wide text-ink">{step}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</p>
              <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium">
                {links.map((l) => <li key={l.to}><Link to={l.to} className="text-accent hover:underline">{l.label}</Link></li>)}
              </ul>
              {i < JOURNEY.length - 1 && <ArrowRight className="absolute -right-3.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-ink-faint md:block" aria-hidden />}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const TOOLS: { icon: LucideIcon; title: string; body: string; to: string }[] = [
  { icon: PlayCircle, title: "SQL Query Visualizer", body: "Watch a query run clause by clause on real rows: joins match, filters drop rows, groups form.", to: "/query-visualizer" },
  { icon: Code2, title: "Python workspace", body: "Write Python in an editor with tests, hints and output, all running in your browser.", to: "/practice/python" },
  { icon: Workflow, title: "ETL Pipeline Builder", body: "Wire a source, transformations, validation and a destination, then run it and read the log.", to: "/etl-builder" },
  { icon: GitBranch, title: "DAG Simulator", body: "See task dependencies, retries and failures play out, the way an orchestrator runs them.", to: "/dag-simulator" },
  { icon: ShieldCheck, title: "Data Quality Exercises", body: "Find nulls, duplicates and bad types, fix them and see the quality score change.", to: "/dq-exercises" },
  { icon: Table2, title: "Schema Designer", body: "Design tables, keys and relationships and generate the DDL.", to: "/schema-designer" },
];

export function FeaturedTools() {
  return (
    <section aria-labelledby="tools" className="border-b border-surface-border py-14">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-label uppercase text-accent">Interactive tools</p>
            <h2 id="tools" className="mt-2 font-display text-h2 text-ink">Learn by doing, not just reading</h2>
          </div>
          <Link to="/visual" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">All visual tools <ArrowRight className="h-4 w-4" aria-hidden /></Link>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map(({ icon: Icon, title, body, to }) => (
            <li key={to}>
              <Link to={to} className="group flex h-full flex-col rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition-[background-color,border-color,color,box-shadow,transform,filter,opacity] duration-base ease-out hover:-translate-y-0.5 hover:border-accent/40">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-dim text-accent"><Icon className="h-5 w-5" aria-hidden /></span>
                <span className="mt-3 flex items-center gap-1 font-display text-h3 text-ink group-hover:text-accent">{title} <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition duration-base ease-out group-hover:translate-x-0 group-hover:opacity-100" aria-hidden /></span>
                <span className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function DailyResume({ view }: { view: DailyView }) {
  const r = dailyResume(view);
  const pathTitle = view.path ? PATHS.find((p) => p.id === view.path)?.title : undefined;
  const href = r.target && isAuthored(r.target.id) ? dayHref(r.target) : "/daily";
  if (!r.started) {
    return (
      <Card pad="md" className="border-accent/30">
        <p className="flex items-center gap-1.5 text-label uppercase text-accent"><Rocket className="h-3.5 w-3.5" aria-hidden /> Start here</p>
        <h3 className="mt-2 font-display text-h3 text-ink">Day 1 of {CURRICULUM.programme.totalDays}: {r.next?.title ?? "Install Python and write your first script"}</h3>
        <p className="mt-1 text-sm text-ink-muted">A guided lesson a day, about two hours: understand, learn by example, practise, check, review. No sign-up needed; your progress stays in this browser.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ButtonLink to={href}>Start Day 1 <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>
          <Link to="/daily" className="text-sm font-semibold text-accent hover:underline">See the whole programme</Link>
        </div>
      </Card>
    );
  }
  return (
    <Card pad="md" className="border-accent/30" aria-label="Continue Daily Learning" as="section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-label uppercase text-accent"><Target className="h-3.5 w-3.5" aria-hidden /> Daily Learning</p>
        <Badge tone="accent">{pathTitle ? `${pathTitle} path` : "Common core"}</Badge>
      </div>
      {r.last && (
        <p className="mt-2 text-sm text-ink-muted">Last opened: <span className="font-medium text-ink">Day {r.last.day}: {r.last.title}</span>{r.lastDone ? " (completed)" : ""}</p>
      )}
      <h3 className="mt-1 font-display text-h3 text-ink">{r.target ? `${r.last && !r.lastDone ? "Resume" : "Next"}: Day ${r.target.day}, ${r.target.title}` : "You have completed the programme"}</h3>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-ink-muted"><span>Programme progress</span><span className="font-medium text-ink">{r.stats.completed} of {r.stats.total} days · {r.stats.percent}%</span></div>
        <ProgressBar className="mt-1.5" value={r.stats.completed} max={r.stats.total || 1} label="Daily Learning progress" tone="accent" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {r.target && <ButtonLink to={href}><PlayCircle className="h-4 w-4" aria-hidden /> {r.last && !r.lastDone ? "Resume lesson" : "Start next lesson"}</ButtonLink>}
        <Link to="/daily" className="text-sm font-semibold text-accent hover:underline">Programme dashboard</Link>
      </div>
    </Card>
  );
}
