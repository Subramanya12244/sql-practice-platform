import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
import { HintLadder } from "../components/HintLadder";
import { Comments, CommunitySolutions } from "../components/Community";
import { usePage } from "../SiteApp";
import { InlineMarkdown, Markdown } from "../components/Markdown";
import { Chip, Container, Difficulty, Skeleton } from "../components/ui";
import { ShareButton } from "../components/ShareButton";
import { SchemaPanel } from "../components/SchemaPanel";
import { SITE_NAME, Seo, breadcrumbs, canonical, clip, faqPage } from "../lib/seo";
import { markRevealed, useProgress } from "../lib/progress";

const PracticePanel = lazy(() => import("../components/PracticePanel"));

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="mb-3 font-display text-xl font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function QuestionPage() {
  const { data } = usePage();
  const q = data.question!;
  const progress = useProgress();
  const [mounted, setMounted] = useState(false);
  const [justSolved, setJustSolved] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load the editor bundle only once its slot is near the viewport, so reading
  // the question (and Google's render of it) doesn't pay for Monaco.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !("IntersectionObserver" in window)) {
      setMounted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
          idle(() => setMounted(true));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => setJustSolved(false), [q.number]);

  const pos = data.index.findIndex((x) => x.number === q.number);
  const prev = data.index[pos - 1];
  const next = data.index[pos + 1];
  const related = q.related.map((n) => data.index.find((x) => x.number === n)).filter(Boolean);
  const topic = data.topics.find((t) => t.slug === q.topic);
  const path = `/questions/${q.slug}`;
  const solved = !!progress.questions[q.number]?.solvedAt;

  const jsonLd: object[] = [
    breadcrumbs([
      { name: "Home", path: "/" },
      { name: q.topicLabel, path: `/topics/${q.topic}` },
      { name: `Q${q.number} ${q.title}`, path },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "LearningResource",
      name: `${q.title} — SQL practice question`,
      description: clip(q.objective || q.problem, 300),
      url: canonical(path),
      learningResourceType: "Practice problem",
      educationalLevel: q.difficulty,
      teaches: q.concepts,
      inLanguage: "en",
      isAccessibleForFree: true,
      provider: { "@type": "Organization", name: SITE_NAME },
    },
  ];
  if (q.followups.length) jsonLd.push(faqPage(q.followups));

  return (
    <Container className="pt-6">
      <Seo
        title={`Q${q.number}: ${q.title} — ${q.topicLabel} SQL Practice`}
        description={clip(`${q.objective || q.problem} Practice this ${q.topicLabel} SQL question free with solution and explanation.`)}
        path={path}
        type="article"
        jsonLd={jsonLd}
        image={`/og/${q.slug}.png`}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint">
        <Link to="/questions" className="hover:text-ink">Questions</Link>
        <span className="mx-1.5">/</span>
        <Link to={`/topics/${q.topic}`} className="hover:text-ink">{q.topicLabel}</Link>
      </nav>

      <header className="mt-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          <span className="mr-2 font-mono text-ink-faint">Q{String(q.number).padStart(2, "0")}</span>{" "}
          {q.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Difficulty level={q.difficulty} />
          {q.concepts.slice(0, 6).map((c) => <Chip key={c}>{c}</Chip>)}
        </div>
      </header>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <article className="min-w-0">
          <Markdown source={q.problem} className="text-ink" />
          {q.objective && (
            <p className="mt-4 rounded-lg border-l-4 border-accent bg-accent-dim px-4 py-3 text-sm text-ink">
              <strong>Task:</strong> <InlineMarkdown source={q.objective} />
            </p>
          )}
          <p className="mt-4 text-sm text-ink-muted">
            <strong className="text-ink">Tables:</strong>{" "}
            {q.tables.map((t, i) => (
              <span key={t}>
                <code className="font-mono text-accent">{t}</code>
                {i < q.tables.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
          {q.expectedOutput && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-faint">Expected output</h2>
              <Markdown source={q.expectedOutput} className="text-sm" />
            </div>
          )}

          <div className="mt-6">
            <HintLadder q={q} />
          </div>

          {data.schema && (
            <div className="mt-6">
              <SchemaPanel schema={data.schema} highlight={q.tables} />
            </div>
          )}
        </article>

        <div ref={panelRef} className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel question={q} onSolved={(r) => r.correct && setJustSolved(true)} />
            </Suspense>
          ) : (
            <Skeleton className="h-[580px]" />
          )}
          {(justSolved || solved) && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-card border border-success/30 bg-success-dim px-4 py-3 text-sm text-ink">
              <span className="font-semibold text-success">{justSolved ? "Nice — solved!" : "You solved this one."}</span>
              <ShareButton kind="question" title={q.title} number={q.number} />
              {next && (
                <Link to={`/questions/${next.slug}`} className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline">
                  Next question <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl">
        <Section id="approach" title="Approach">
          <details className="rounded-card border border-surface-border bg-surface-raised p-4">
            <summary className="cursor-pointer font-medium text-ink">Show the approach</summary>
            <Markdown source={q.approach} className="mt-3 text-sm" />
          </details>
        </Section>

        <Section id="solution" title="Solution">
          <details
            className="rounded-card border border-surface-border bg-surface-raised p-4"
            onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && markRevealed(q.number)}
          >
            <summary className="cursor-pointer font-medium text-ink">Reveal the solution</summary>
            <Markdown source={"```sql\n" + q.solution + "\n```"} className="mt-3 text-sm" />
            {q.why && <Markdown source={q.why} className="mt-4 text-sm" />}
          </details>
        </Section>

        {q.hadMistakes && q.myMistakes.length > 0 && (
          <Section id="real-mistakes" title="Mistakes made while solving this">
            <div className="rounded-card border border-warn/30 bg-warn-dim p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn">
                <AlertTriangle className="h-4 w-4" aria-hidden /> Real first-attempt errors — learn from them
              </p>
              <ul className="list-disc space-y-2 pl-5 text-sm text-ink">
                {q.myMistakes.map((m, i) => <li key={i}><Markdown source={m} /></li>)}
              </ul>
            </div>
          </Section>
        )}

        <CommunitySolutions number={q.number} />
        <Comments number={q.number} />

        {q.pitfalls.length > 0 && (
          <Section id="pitfalls" title="Common pitfalls">
            <ul className="list-disc space-y-2 pl-5 text-sm text-ink-muted">
              {q.pitfalls.map((p, i) => <li key={i}><Markdown source={p} /></li>)}
            </ul>
          </Section>
        )}

        {q.followups.length > 0 && (
          <Section id="interview" title="Interview follow-up questions">
            <div className="space-y-5">
              {q.followups.map((f, i) => (
                <div key={i}>
                  <h3 className="font-semibold text-ink">{f.question.replace(/^\d+\.\s*/, "")}</h3>
                  <Markdown source={f.answer} className="mt-1.5 text-sm text-ink-muted" />
                </div>
              ))}
            </div>
          </Section>
        )}

        {q.takeaway && (
          <Section id="takeaway" title="Key takeaway">
            <p className="rounded-card border border-accent/30 bg-accent-dim p-4 text-ink"><InlineMarkdown source={q.takeaway} /></p>
          </Section>
        )}

        {related.length > 0 && (
          <Section id="related" title="Related questions">
            <ul className="grid gap-2 sm:grid-cols-2">
              {related.map((r) => r && (
                <li key={r.slug}>
                  <Link to={`/questions/${r.slug}`} className="text-accent hover:underline">Q{r.number} · {r.title}</Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <nav className="mt-12 flex items-center justify-between gap-4 border-t border-surface-border pt-6 text-sm" aria-label="Question navigation">
          {prev ? (
            <Link to={`/questions/${prev.slug}`} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Q{prev.number} {prev.title}
            </Link>
          ) : <span />}
          {topic && <Link to={`/topics/${topic.slug}`} className="hidden text-ink-faint hover:text-ink sm:inline">All {topic.label}</Link>}
          {next ? (
            <Link to={`/questions/${next.slug}`} className="inline-flex items-center gap-1 text-right text-ink-muted hover:text-ink">
              Q{next.number} {next.title} <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : <span />}
        </nav>
      </div>
    </Container>
  );
}
