import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, Layers } from "lucide-react";
import { Badge, Card, ProgressBar, SectionHeader } from "../ui";
import { LEARN_PATHS, hoursLabel, pathModel, type PathModel } from "../../lib/learnPaths";
import type { PathContext } from "../../lib/learnPaths";
import { SubjectIcon } from "./shared";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The progress sentence for a path: the lessons completed, or that nothing is started. Never a blended estimate. */
export function pathProgressLabel(m: PathModel): string {
  return m.done > 0 ? `${m.done} of ${plural(m.lessons, "lesson")} completed` : m.started ? "Started, no lesson completed yet" : "Not started";
}

export function PathCard({ m }: { m: PathModel }) {
  const { def } = m;
  return (
    <Card as="article" interactive pad="md" className="relative flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <SubjectIcon subject={def.subject} />
        {m.levelLabel && <Badge tone="neutral">{m.levelLabel}</Badge>}
      </div>
      <h3 className="mt-3 font-display text-h3 text-ink">
        <Link to={`/learn/path/${def.id}`} className="after:absolute after:inset-0 after:rounded-card hover:text-accent focus-visible:outline-offset-4">{def.title}</Link>
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{def.tagline}</p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label={`${def.title} size`}>
        <li className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5" aria-hidden />{plural(m.lessons, "lesson")}</li>
        <li className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{hoursLabel(m.minutes)} planned</li>
      </ul>
      {def.branch && <p className="mt-1 text-xs text-ink-faint">Builds on the {m.core?.total}-day common core.</p>}
      <div className="mt-auto pt-4">
        <ProgressBar value={m.done} max={m.lessons || 1} label={`${def.title}: ${pathProgressLabel(m)}`} />
        <p className="mt-1.5 text-xs text-ink-muted">{pathProgressLabel(m)}</p>
        {m.next && <p className="mt-1 truncate text-xs text-ink-faint">Next: <span className="text-ink">{m.next.title}</span></p>}
        <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent">View path <ArrowRight className="h-4 w-4" aria-hidden /></span>
      </div>
    </Card>
  );
}

export function PathCards({ ctx }: { ctx: PathContext }) {
  const models = useMemo(() => LEARN_PATHS.map((def) => pathModel(def, ctx)), [ctx]);
  return (
    <section id="paths" aria-labelledby="paths-heading" data-help="hub-paths" className="scroll-mt-20">
      <SectionHeader id="paths-heading" title="Learning paths" description="Each path is a fixed order of real lessons with its own notes, practice and a final project." />
      <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {models.map((m) => <li key={m.def.id} data-path={m.def.id}><PathCard m={m} /></li>)}
      </ul>
    </section>
  );
}
