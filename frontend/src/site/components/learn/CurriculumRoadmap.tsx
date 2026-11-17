import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Badge, ProgressBar, SectionHeader, Tabs } from "../ui";
import { hoursLabel, roadmapPhases, type RoadmapPath, type RoadmapPhase } from "../../lib/learnPaths";
import type { DailyState } from "../../lib/dailyProgress";

const TABS: { id: RoadmapPath; label: string; blurb: string }[] = [
  { id: "common", label: "Common core", blurb: "Days 1 to 90. Everyone starts here: Python, SQL, NumPy, pandas and statistics foundations." },
  { id: "analyst", label: "Data Analyst", blurb: "Days 91 to 180. Excel, statistics, EDA, visualisation, Power BI, business analytics and a capstone." },
  { id: "engineer", label: "Data Engineer", blurb: "Days 91 to 180. Ingestion, APIs, ETL, data quality, warehousing, Airflow, Spark and a capstone." },
];

const STATUS: Record<RoadmapPhase["status"], { label: string; tone: "neutral" | "info" | "success" }> = {
  "not-started": { label: "Not started", tone: "neutral" },
  "in-progress": { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
};

function PhaseRow({ p, index }: { p: RoadmapPhase; index: number }) {
  const st = STATUS[p.status];
  return (
    <li className="relative pl-9">
      <span aria-hidden className={`absolute left-0 top-3 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums ${p.status === "completed" ? "border-success/40 bg-success-dim text-success" : p.status === "in-progress" ? "border-info/40 bg-info-dim text-info" : "border-surface-border bg-surface-raised text-ink-faint"}`}>
        {p.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
      </span>
      <Link to={p.href} className="group block rounded-xl border border-surface-border bg-surface-raised p-3.5 transition-all duration-fast ease-out hover:-translate-y-px hover:border-accent/40">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-ink group-hover:text-accent">{p.title}</span>
          <Badge tone={st.tone}>{st.label}</Badge>
        </span>
        <span className="mt-0.5 block text-xs text-ink-faint">Days {p.firstDay} to {p.lastDay} · {p.lessons} lessons · {hoursLabel(p.minutes)} planned</span>
        <span className="mt-1 block text-sm text-ink-muted">{p.summary}</span>
        <span className="mt-2.5 flex items-center gap-3">
          <ProgressBar className="flex-1" value={p.done} max={p.lessons} label={`${p.title}: ${p.done} of ${p.lessons} lessons completed`} tone={p.status === "completed" ? "success" : "accent"} />
          <span className="text-xs tabular-nums text-ink-muted">{p.done}/{p.lessons}</span>
        </span>
      </Link>
    </li>
  );
}

/** The 270 Daily Learning lessons as one plan: the common core, then the analyst or engineer track. Counts are the authored lessons. */
export function CurriculumRoadmap({ daily }: { daily: DailyState }) {
  const [tab, setTab] = useState<RoadmapPath>("common");
  // Open on the learner's own track once their choice is known (after mount, so the prerendered page is neutral).
  useEffect(() => { if (daily.path) setTab(daily.path); }, [daily.path]);
  const phases = useMemo(() => roadmapPhases(tab, daily), [tab, daily]);
  const total = phases.reduce((s, p) => s + p.lessons, 0);
  const done = phases.reduce((s, p) => s + p.done, 0);
  const minutes = phases.reduce((s, p) => s + p.minutes, 0);
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <section id="roadmap" aria-labelledby="roadmap-heading" data-help="hub-roadmap" className="scroll-mt-20">
      <SectionHeader id="roadmap-heading" title="Curriculum roadmap" description="One lesson a day for 180 days: a 90-day common core, then 90 days as an analyst or an engineer."
        action={<Link to="/daily" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">Open Daily Learning <ArrowRight className="h-4 w-4" aria-hidden /></Link>} />
      <Tabs label="Curriculum track" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} />
      <div role="tabpanel" aria-label={`${current.label} phases`} className="mt-4">
        <p className="text-sm text-ink-muted">{current.blurb}</p>
        <p className="mt-1 text-xs text-ink-faint tabular-nums">{done} of {total} lessons completed · {hoursLabel(minutes)} planned in {phases.length} phases</p>
        <ol className="relative mt-4 grid grid-cols-1 gap-2.5 before:absolute before:bottom-3 before:left-3 before:top-3 before:w-px before:bg-surface-border lg:grid-cols-2 lg:gap-x-5 lg:before:hidden">
          {phases.map((p, i) => <PhaseRow key={p.id} p={p} index={i} />)}
        </ol>
      </div>
    </section>
  );
}
