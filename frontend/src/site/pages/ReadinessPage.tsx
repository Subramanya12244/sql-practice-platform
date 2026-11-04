import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gauge } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, PageHeader, QuestionCard } from "../components/ui";
import { Seo } from "../lib/seo";
import { today, useProgress } from "../lib/progress";
import { assessReadiness, type Dimension, type Level, type TopicReadiness } from "../lib/readiness";
import { dueQuestions } from "../lib/insights";

const LEVEL_TONE: Record<Level, string> = {
  Strong: "bg-success-dim text-success",
  Developing: "bg-accent-dim text-accent",
  "Needs improvement": "bg-warn-dim text-warn",
  "Not assessed": "bg-surface-soft text-ink-muted",
};

function Bar({ d, label }: { d: Dimension; label: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-ink-muted">{label}</span><span className="font-mono text-ink">{d.score === null ? "—" : d.score}</span></div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-soft" aria-hidden>
        <div className="h-full bg-accent" style={{ width: `${d.score ?? 0}%` }} />
      </div>
      <p className="mt-0.5 text-[11px] text-ink-faint">{d.detail}</p>
    </div>
  );
}

function TopicCard({ t }: { t: TopicReadiness }) {
  return (
    <li className="rounded-card border border-surface-border bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/topics/${t.topic}`} className="font-semibold text-ink hover:underline">{t.label}</Link>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEVEL_TONE[t.level]}`}>{t.level}{t.score !== null ? ` · ${t.score}` : ""}</span>
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        {t.practiced}/{t.total} practiced · {t.solvedIndependent} independent · {t.solvedAssisted} assisted
        {t.importedSolved ? ` · ${t.importedSolved} solved in repo (not scored)` : ""}
      </p>
      <div className="mt-3 space-y-2">
        <Bar label="Practical application" d={t.dims.application} />
        <Bar label="Independent problem-solving" d={t.dims.independence} />
        <Bar label="Efficiency" d={t.dims.efficiency} />
        <Bar label="Knowledge" d={t.dims.knowledge} />
        <Bar label="Retention" d={t.dims.retention} />
      </div>
      {t.topErrors.length > 0 && <p className="mt-2 text-xs text-ink-muted">Frequent errors: {t.topErrors.map(([k, n]) => `${k} ×${n}`).join(", ")}</p>}
    </li>
  );
}

export function ReadinessPage() {
  const { data } = usePage();
  const progress = useProgress();
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => setDay(today()), []);
  const r = assessReadiness(data.index, data.topics, data.notes ?? [], progress, day ?? "2000-01-01");

  const focus = [...r.topics]
    .filter((t) => t.solvedPractice < t.total)
    .sort((a, b) => (a.score ?? 40) - (b.score ?? 40) || b.total - a.total)
    .slice(0, 3);
  const recQuestions = focus.flatMap((t) =>
    data.index.filter((q) => q.topic === t.topic && !progress.questions[q.number]?.solvedAt).slice(0, 2),
  );
  const recNotes = (data.notes ?? [])
    .filter((n) => !progress.read?.[n.slug] && n.questions.some((num) => focus.some((t) => data.index.find((q) => q.number === num)?.topic === t.topic)))
    .slice(0, 5);
  const due = day ? dueQuestions(data.index, progress, day).length : 0;

  return (
    <Container>
      <Seo title="Interview readiness" description="An evidence-based estimate of your SQL interview readiness by topic." path="/readiness" noindex />
      <PageHeader
        eyebrow="Assessment"
        title="Interview readiness"
        intro="An estimate built only from what you've actually done here: submits, hints used, time, reviews and mock interviews. It is not a prediction of any interview outcome."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border border-surface-border bg-surface-raised p-4">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-faint"><Gauge className="h-3.5 w-3.5" aria-hidden /> Estimated readiness</p>
          <p className="mt-1 font-display text-3xl font-bold text-ink">{r.overall === null ? "—" : `${r.overall}/100`}</p>
          <p className="mt-1 text-xs text-ink-muted">{r.evidenceNote}</p>
        </div>
        {[
          ["Topics assessed", `${r.assessedTopics}/${r.topics.length}`],
          ["Questions practiced", `${r.coverage}%`],
          ["Mock interviews", r.mocks ? `${r.mocks} · avg ${r.mockAverage}%` : "none yet"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-card border border-surface-border bg-surface-raised p-4">
            <p className="text-xs uppercase tracking-wider text-ink-faint">{k}</p>
            <p className="mt-1 font-display text-2xl font-bold text-ink">{v}</p>
          </div>
        ))}
      </div>

      <section className="mt-8 grid gap-4 lg:grid-cols-3" aria-label="Recommendations">
        <div className="rounded-card border border-surface-border bg-surface-raised p-4 lg:col-span-2">
          <h2 className="font-semibold text-ink">Focus next</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {focus.map((t) => t.label).join(", ") || "Practice a few questions to get started"}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{recQuestions.slice(0, 4).map((q) => <QuestionCard key={q.slug} q={q} />)}</div>
        </div>
        <div className="space-y-4">
          <div className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
            <h2 className="font-semibold text-ink">Notes to read</h2>
            <ul className="mt-2 space-y-1">{recNotes.map((n) => <li key={n.slug}><Link to={`/notes/${n.slug}`} className="text-accent hover:underline">{n.title}</Link></li>)}</ul>
            {!recNotes.length && <p className="mt-2 text-ink-muted">Nothing outstanding for these topics.</p>}
          </div>
          <div className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
            <h2 className="font-semibold text-ink">Revision &amp; reassessment</h2>
            <p className="mt-1 text-ink-muted">{due} question(s) due in the <Link to="/review" className="text-accent underline">review queue</Link>. Active on {r.consistency} of the last 14 days.</p>
            <p className="mt-1 text-ink-muted">Suggested next check: <strong className="text-ink">{r.nextAssessment}</strong>, after a <Link to="/mock-interview" className="text-accent underline">mock interview</Link>.</p>
            {r.repeatedMistakes.length > 0 && <p className="mt-1 text-ink-muted">Repeated mistakes: {r.repeatedMistakes.map(([k, n]) => `${k} ×${n}`).join(", ")}</p>}
          </div>
        </div>
      </section>

      <h2 className="mt-10 font-display text-xl font-bold text-ink">By topic</h2>
      <p className="mt-1 text-sm text-ink-muted">A topic is scored once you've submitted at least 3 of its questions here. Solves imported from your repo are shown but don't count as evidence, and assisted solves never count as independent.</p>
      <ul className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{r.topics.map((t) => <TopicCard key={t.topic} t={t} />)}</ul>
    </Container>
  );
}
