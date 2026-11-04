import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Shuffle } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, PageHeader, QuestionCard } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { useProgress } from "../lib/progress";

const LEVELS = ["All", "Easy", "Medium", "Hard"] as const;

export function QuestionsPage() {
  const { data } = usePage();
  const progress = useProgress();
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("All");
  const [trapsOnly, setTrapsOnly] = useState(false);
  const [unsolvedOnly, setUnsolvedOnly] = useState(false);
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.index.filter((item) => {
      if (level !== "All") {
        const hard = ["Hard", "Advanced", "Expert"].includes(item.difficulty);
        if (level === "Hard" ? !hard : item.difficulty !== level) return false;
      }
      if (trapsOnly && !item.hadMistakes) return false;
      if (unsolvedOnly && progress.questions[item.number]?.solvedAt) return false;
      if (!q) return true;
      return [item.title, item.topicLabel, ...item.concepts].join(" ").toLowerCase().includes(q) || `q${item.number}` === q;
    });
  }, [data.index, query, level, trapsOnly, unsolvedOnly, progress.questions]);

  const filtering = query || level !== "All" || trapsOnly || unsolvedOnly;

  /** Jump to a random question from the current filter (or all, if nothing matches). */
  const random = () => {
    const pool = filtered.length ? filtered : data.index;
    navigate(`/questions/${pool[Math.floor(Math.random() * pool.length)].slug}`);
  };

  return (
    <Container>
      <Seo
        title={`${data.index.length} SQL Interview Practice Questions (with Solutions)`}
        description="Every SQL practice question in one place: aggregations, GROUP BY, subqueries, CTEs, all join types and set operators on the Northwind database. Free and graded instantly."
        path="/questions"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Questions", path: "/questions" }])]}
      />
      <PageHeader
        eyebrow="Practice"
        title="SQL interview questions"
        intro={`${data.index.length} questions grouped by topic. Pick any one — your query runs on a real PostgreSQL copy of Northwind in your browser.`}
      />

      <div className="sticky top-14 z-30 -mx-4 mb-6 flex flex-wrap items-center gap-2 border-b border-surface-border bg-surface/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border sm:px-3">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search questions</span>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, topic or concept…"
            className="w-full rounded-lg border border-surface-border bg-surface-raised py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-accent"
          />
        </label>
        <div className="flex gap-1" role="group" aria-label="Difficulty">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              aria-pressed={level === l}
              className={`rounded-lg px-3 py-2 text-sm ${level === l ? "bg-accent-dim font-semibold text-accent" : "text-ink-muted hover:bg-hover/5"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 px-2 text-sm text-ink-muted">
          <input type="checkbox" checked={trapsOnly} onChange={(e) => setTrapsOnly(e.target.checked)} className="accent-[rgb(var(--color-accent))]" />
          Common traps only
        </label>
        <label className="flex items-center gap-2 px-2 text-sm text-ink-muted">
          <input type="checkbox" checked={unsolvedOnly} onChange={(e) => setUnsolvedOnly(e.target.checked)} className="accent-[rgb(var(--color-accent))]" />
          Unsolved only
        </label>
        <button type="button" onClick={random} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm font-medium text-ink hover:border-accent/40">
          <Shuffle className="h-4 w-4" aria-hidden /> Random
        </button>
      </div>

      {filtering ? (
        <>
          <p className="mb-3 text-sm text-ink-muted" aria-live="polite">{filtered.length} matching questions</p>
          {filtered.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((q) => <QuestionCard key={q.slug} q={q} solved={!!progress.questions[q.number]?.solvedAt} />)}
            </div>
          ) : (
            <p className="rounded-card border border-dashed border-surface-border p-8 text-center text-ink-muted">No questions match. Try a different word or clear the filters.</p>
          )}
        </>
      ) : (
        data.topics.map((t) => (
          <section key={t.slug} className="mb-10" aria-labelledby={`t-${t.slug}`}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id={`t-${t.slug}`} className="font-display text-xl font-bold text-ink">{t.label}</h2>
              <Link to={`/topics/${t.slug}`} className="text-sm text-accent hover:underline">Topic page</Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.index
                .filter((q) => q.topic === t.slug)
                .map((q) => <QuestionCard key={q.slug} q={q} solved={!!progress.questions[q.number]?.solvedAt} />)}
            </div>
          </section>
        ))
      )}
    </Container>
  );
}
