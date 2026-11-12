import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, SearchX, Shuffle } from "lucide-react";
import { usePage } from "../SiteApp";
import { Card, Container, Difficulty, EmptyState, PageHeader, ProgressBar, QuestionCard } from "../components/ui";
import { applyOverride, overrideKey, useContent } from "../lib/contentOverrides";
import { Seo, breadcrumbs } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { HelpTooltip } from "../help/HelpTooltip";

const LEVELS = ["All", "Easy", "Medium", "Hard"] as const;

export function QuestionsPage() {
  const { data } = usePage();
  const progress = useProgress();
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("All");
  const [trapsOnly, setTrapsOnly] = useState(false);
  const [unsolvedOnly, setUnsolvedOnly] = useState(false);
  const navigate = useNavigate();
  const content = useContent();
  // Admin overrides (migration 010): disabled questions leave the lists; title/difficulty edits apply.
  const index = useMemo(() => data.index.flatMap((q) => applyOverride(q, content.overrides.get(overrideKey("sql", q.number))) ?? []), [data.index, content.overrides]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return index.filter((item) => {
      if (level !== "All") {
        const hard = ["Hard", "Advanced", "Expert"].includes(item.difficulty);
        if (level === "Hard" ? !hard : item.difficulty !== level) return false;
      }
      if (trapsOnly && !item.hadMistakes) return false;
      if (unsolvedOnly && progress.questions[item.number]?.solvedAt) return false;
      if (!q) return true;
      return [item.title, item.topicLabel, ...item.concepts].join(" ").toLowerCase().includes(q) || `q${item.number}` === q;
    });
  }, [index, query, level, trapsOnly, unsolvedOnly, progress.questions]);

  const filtering = query || level !== "All" || trapsOnly || unsolvedOnly;
  const isSolved = (n: number) => Boolean(progress.questions[n]?.solvedAt);
  const solvedTotal = data.index.filter((q) => isSolved(q.number)).length;
  const byLevel = (["Easy", "Medium", "Hard"] as const).map((l) => {
    const qs = data.index.filter((q) => (l === "Hard" ? ["Hard", "Advanced", "Expert"].includes(q.difficulty) : q.difficulty === l));
    return { level: l, solved: qs.filter((q) => isSolved(q.number)).length, total: qs.length };
  });

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
      <p className="-mt-4 mb-4 text-sm"><Link to="/study-notes" className="font-semibold text-accent hover:underline">Download study notes</Link> <span className="text-ink-muted">· PDFs of the questions you've solved, with schema and query-flow diagrams</span></p>

      <Card className="mb-4 grid gap-5 sm:grid-cols-[1.2fr_2fr] sm:items-center">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">Your progress</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ink">{solvedTotal}<span className="text-lg text-ink-faint">/{data.index.length}</span></p>
          <ProgressBar className="mt-2" value={solvedTotal} max={data.index.length} label="Questions solved" />
        </div>
        <ul className="grid grid-cols-3 gap-3">
          {byLevel.map((l) => (
            <li key={l.level} className="rounded-lg bg-surface-overlay p-3">
              <p className={`text-xs font-semibold ${l.level === "Easy" ? "text-success" : l.level === "Medium" ? "text-warn" : "text-danger"}`}>{l.level}</p>
              <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{l.solved}<span className="text-sm text-ink-faint">/{l.total}</span></p>
            </li>
          ))}
        </ul>
      </Card>

      <nav aria-label="Topics" className="scroll-fade-x -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {data.topics.map((t) => {
          const qs = data.index.filter((q) => q.topic === t.slug);
          const done = qs.filter((q) => isSolved(q.number)).length;
          return (
            <a key={t.slug} href={`#t-${t.slug}`} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-fast hover:border-accent/40 hover:text-ink ${done === qs.length && qs.length ? "border-success/30 bg-success-dim text-success" : "border-surface-border bg-surface-raised text-ink-muted"}`}>
              {t.label} <span className="tabular-nums text-ink-faint">{done}/{qs.length}</span>
            </a>
          );
        })}
      </nav>

      <div data-help="questions-filters" className="sticky top-16 z-30 -mx-4 mb-6 flex flex-wrap items-center gap-2 border-b border-surface-border bg-surface/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border sm:px-3">
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
          <HelpTooltip id="difficulty-levels" label="What do the difficulty levels mean?" />
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
            <EmptyState icon={SearchX} title="No questions match" action={<button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => { setQuery(""); setLevel("All"); setTrapsOnly(false); setUnsolvedOnly(false); }}>Clear all filters</button>}>Try a different word, or loosen the filters.</EmptyState>
          )}
        </>
      ) : (
        data.topics.map((t) => (
          <section key={t.slug} className="mb-10 scroll-mt-36" aria-labelledby={`t-${t.slug}`}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id={`t-${t.slug}`} className="font-display text-xl font-bold text-ink">{t.label}</h2>
              <Link to={`/topics/${t.slug}`} className="text-sm text-accent hover:underline">Topic page</Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {index
                .filter((q) => q.topic === t.slug)
                .map((q) => <QuestionCard key={q.slug} q={q} solved={!!progress.questions[q.number]?.solvedAt} />)}
            </div>
          </section>
        ))
      )}
      {content.custom.length > 0 && (
        <section className="mb-10" aria-labelledby="more-questions">
          <h2 id="more-questions" className="mb-3 font-display text-xl font-bold text-ink">More questions</h2>
          <p className="mb-3 text-sm text-ink-muted">Added by the DataForge team; graded on the same Northwind database.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {content.custom.map((c) => (
              <Link key={c.slug} to={`/questions/custom?q=${c.slug}`} className="flex items-center justify-between gap-3 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel hover:border-accent/40">
                <span className="min-w-0"><span className="block truncate font-semibold text-ink">{c.title}</span><span className="text-xs text-ink-muted">{c.topic}</span></span>
                <Difficulty level={c.difficulty} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}
