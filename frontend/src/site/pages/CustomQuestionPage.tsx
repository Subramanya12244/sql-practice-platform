import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Container, Difficulty, EmptyState, Skeleton } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { Seo } from "../lib/seo";
import { customToQuestion, loadContent, type CustomQuestion } from "../lib/contentOverrides";

const PracticePanel = lazy(() => import("../components/PracticePanel"));

/** A question an admin added (migration 010): read after hydration, graded on Northwind like the rest. */
export function CustomQuestionPage() {
  const { search } = useLocation();
  const [c, setC] = useState<CustomQuestion | null | undefined>(undefined);
  const [showHints, setShowHints] = useState(0);
  useEffect(() => {
    const slug = new URLSearchParams(search).get("q") ?? "";
    void loadContent().then((r) => setC(r.custom.find((x) => x.slug === slug) ?? null));
  }, [search]);

  return (
    <Container wide className="pt-6">
      <Seo title={c ? `${c.title} — SQL question` : "SQL question"} description={c?.objective ?? "A DataForge SQL practice question."} path="/questions/custom" noindex />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint"><Link to="/questions" className="hover:text-ink">Questions</Link></nav>
      {c === undefined ? <Skeleton className="mt-4 h-96" /> : c === null ? (
        <div className="mt-6"><EmptyState title="Question not found">It may have been unpublished. <Link to="/questions" className="text-accent hover:underline">See all questions</Link>.</EmptyState></div>
      ) : (
        <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <article className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{c.title}</h1>
              <Difficulty level={c.difficulty} />
              <span className="text-xs text-ink-faint">{c.topic}</span>
            </div>
            {c.scenario && <Markdown source={c.scenario} className="text-sm" />}
            <Markdown source={c.problem} className="text-sm" />
            <p className="rounded-lg border-l-2 border-accent bg-surface-raised px-3 py-2 text-sm text-ink"><strong>Objective:</strong> {c.objective}</p>
            {c.expected_output && <><h2 className="text-sm font-semibold text-ink">Expected output</h2><Markdown source={c.expected_output} className="text-sm" /></>}
            {c.hints.length > 0 && (
              <section className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm" aria-label="Hints">
                {showHints > 0 && <ol className="list-decimal space-y-1 pl-5">{c.hints.slice(0, showHints).map((h, i) => <li key={i}>{h}</li>)}</ol>}
                {showHints < c.hints.length && <button type="button" className="mt-1 text-accent hover:underline" onClick={() => setShowHints((n) => n + 1)}>Show hint {showHints + 1} of {c.hints.length}</button>}
              </section>
            )}
          </article>
          <div className="min-w-0">
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel question={customToQuestion(c)} fill />
            </Suspense>
          </div>
        </div>
      )}
    </Container>
  );
}
