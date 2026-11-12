import { useEffect, useState } from "react";
import { PyExplainBox } from "../components/visual/PyExplainBox";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, CheckCircle2, Circle, CircleDot, Lightbulb, Search } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { Badge, Button, ButtonLink, Card, Container, Difficulty, EmptyState, PageHeader, ProgressBar, SectionHeader } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { completeExercise, recordMistake, recordSession, toggleBookmark, useProgress } from "../lib/progress";
import { classifyPyMistake } from "../lib/mistakes";
import { PY_CATEGORIES, PY_SKILLS, accuracy, categoryLabel, filterExercises, overview, readStats, recordPyAttempt, splitHints, statusOf, subscribeStats, type PyFilter, type PyStat } from "../lib/pyPractice";
import { getExerciseStage, PY_STAGES } from "../lib/pyExercises";
import { track } from "../lib/activity";
import { applyOverride, overrideKey, useContent } from "../lib/contentOverrides";
import { PythonWorkspace } from "../components/PythonWorkspace";
import { SolveTimer } from "../components/SolveTimer";
import { SessionHistory } from "../components/SessionHistory";
import { noteAttempt, noteExecution, noteHint } from "../lib/solveSessions";

const key = (slug: string) => `py:${slug}`;
const HIST = (slug: string) => `sqlp.py.history.${slug}`;

interface Run { at: string; kind: "run" | "check"; ok: boolean; message: string; code?: string }
const readHist = (slug: string): Run[] => { try { return JSON.parse(localStorage.getItem(HIST(slug)) ?? "[]"); } catch { return []; } };
const writeHist = (slug: string, h: Run[]) => { try { localStorage.setItem(HIST(slug), JSON.stringify(h.slice(0, 20))); } catch { /* ignore */ } };

function useStats() {
  const [stats, setStats] = useState<Record<string, PyStat>>({});
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); setStats(readStats()); return subscribeStats(() => setStats(readStats())); }, []);
  return { stats, mounted };
}

const SELECT = "max-w-full min-w-0 rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";

export function PythonPracticeIndexPage() {
  const { data } = usePage();
  const progress = useProgress();
  const content = useContent();
  // Admin overrides (migration 010) hide disabled problems and apply title/difficulty edits.
  const all = (data.exercises ?? []).flatMap((e) => applyOverride(e, content.overrides.get(overrideKey("python", e.slug))) ?? []);
  const { stats, mounted } = useStats();
  const done = mounted ? progress.lessons : undefined;
  const [f, setF] = useState<PyFilter>({ q: "", difficulty: "", category: "", stage: "", skill: "", status: "" });
  const [viewMode, setViewMode] = useState<"stages" | "categories">("stages");
  const set = (k: keyof PyFilter) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const o = overview(all, done, stats);
  const shown = filterExercises(all, f, done, stats);
  const bookmarked = (progress.bookmarks ?? []).filter((k) => k.startsWith("py:")).map((k) => all.find((e) => key(e.slug) === k)).filter((e) => e !== undefined);
  const skills = [...new Set(all.map((e) => e.skill).filter(Boolean))].sort();
  return (
    <Container>
      <Seo
        title="Python Practice for Data Engineers — 150 Problems Graded in Your Browser"
        description="150 Python problems for data engineering: parsing CSV, JSON and logs, cleaning and validating records, deduplication, incremental loads, retries, checkpoints, generators and pipeline design. Runs and grades in your browser."
        path="/practice/python"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Python practice", path: "/practice/python" }])]}
      />
      <PageHeader
        eyebrow="Practice"
        title="Python for data engineering"
        intro={`${all.length} problems built on real data work: records, files, logs, APIs and pipelines. Real Python (Pyodide) runs in a sandbox in your browser, and each problem is graded by visible and hidden tests.`}
      />
      <p className="-mt-4 mb-6 text-sm"><Link to="/practice/python/assessment" className="font-semibold text-accent hover:underline">Take a timed assessment</Link> <span className="text-ink-muted">· three problems against the clock ·</span> <Link to="/study-notes" className="font-semibold text-accent hover:underline">Download study notes</Link></p>

      <section aria-label="Your Python progress" className="grid gap-4 lg:grid-cols-3">
        <Card pad="md" className="min-w-0 lg:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">Completed</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ink">{mounted ? o.solved : "—"}<span className="text-lg text-ink-faint">/{o.total}</span></p>
          <p className="text-xs text-ink-muted">{mounted ? `${o.remaining} remaining` : "Your progress loads in the browser"}</p>
          <ul className="mt-4 space-y-2">
            {o.difficulty.map((d) => (
              <li key={d.key}>
                <div className="flex justify-between text-xs"><span className="text-ink">{d.label}</span><span className="tabular-nums text-ink-muted">{mounted ? d.solved : 0}/{d.total}</span></div>
                <ProgressBar className="mt-1" value={mounted ? d.solved : 0} max={d.total} label={`${d.label} completed`} tone={d.key === "Hard" ? "secondary" : d.key === "Medium" ? "accent" : "success"} />
              </li>
            ))}
          </ul>
        </Card>
        <Card pad="md" className="min-w-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border pb-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Curriculum Progress</span>
            <div role="group" aria-label="Curriculum view" className="flex max-w-full rounded-lg border border-surface-border bg-surface p-0.5 text-xs font-medium">
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 transition ${viewMode === "stages" ? "bg-accent text-on-accent shadow-sm" : "text-ink-muted hover:text-ink"}`}
                aria-pressed={viewMode === "stages"}
                onClick={() => setViewMode("stages")}
              >
                14-Stage Progression
              </button>
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 transition ${viewMode === "categories" ? "bg-accent text-on-accent shadow-sm" : "text-ink-muted hover:text-ink"}`}
                aria-pressed={viewMode === "categories"}
                onClick={() => setViewMode("categories")}
              >
                Category Breakdown
              </button>
            </div>
          </div>

          {viewMode === "stages" ? (
            <div className="mt-3 max-h-64 overflow-y-auto pr-1 space-y-2">
              {PY_STAGES.map((s) => {
                const stageExercises = all.filter((e) => getExerciseStage(e) === s.stage);
                const stageSolved = stageExercises.filter((e) => done?.[key(e.slug)]).length;
                const isSelected = f.stage === String(s.stage);
                return (
                  <button
                    key={s.stage}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => set("stage")(isSelected ? "" : String(s.stage))}
                    className={`w-full text-left rounded-lg border p-2 text-xs transition duration-fast hover:border-accent/40 ${
                      isSelected ? "border-accent bg-accent/10" : "border-surface-border bg-surface-raised"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 truncate">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-dim font-mono text-[10px] font-bold text-accent">
                          {s.stage}
                        </span>
                        <span className="font-semibold text-ink truncate">{s.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {mounted ? stageSolved : 0}/{stageExercises.length}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <ProgressBar
                        className="flex-1"
                        value={mounted ? stageSolved : 0}
                        max={stageExercises.length || 1}
                        label={`Stage ${s.stage} progress`}
                        tone={stageSolved === stageExercises.length && stageExercises.length > 0 ? "success" : "accent"}
                      />
                      <span className="hidden max-w-[120px] truncate text-[10px] text-ink-faint sm:inline">{s.description}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-faint"><th className="py-1 font-medium">Category</th><th className="w-1/3 py-1 font-medium">Completed</th><th className="py-1 text-right font-medium" title="Passing checks out of all checks">Accuracy</th></tr></thead>
              <tbody>
                {o.categories.map((c) => {
                  const acc = accuracy(c);
                  return (
                    <tr key={c.key} className="border-t border-surface-border">
                      <td className="py-1.5"><button type="button" className="text-left text-ink hover:text-accent" onClick={() => set("category")(c.key)}>{c.label}</button></td>
                      <td className="py-1.5"><div className="flex items-center gap-2"><ProgressBar className="flex-1" value={mounted ? c.solved : 0} max={c.total} label={`${c.label} completed`} /><span className="w-12 text-right text-xs tabular-nums text-ink-muted">{mounted ? c.solved : 0}/{c.total}</span></div></td>
                      <td className={`py-1.5 text-right tabular-nums ${acc === null ? "text-ink-faint" : acc < 50 ? "text-danger" : "text-ink"}`}>{mounted && acc !== null ? `${acc}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </Card>
      </section>

      {mounted && (o.recent.length > 0 || o.revise.length > 0 || bookmarked.length > 0) && (
        <section aria-label="Continue" className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            { title: "Recent submissions", items: o.recent.map((r) => ({ ex: r.ex, note: `${r.stat.lastOk ? "passed" : "failed"} · ${r.stat.attempts} check${r.stat.attempts === 1 ? "" : "s"}`, ok: r.stat.lastOk })) },
            { title: "Revise", items: o.revise.map((e) => ({ ex: e, note: `${stats[e.slug].attempts - stats[e.slug].passes} failed check${stats[e.slug].attempts - stats[e.slug].passes === 1 ? "" : "s"}`, ok: false })) },
            { title: "Bookmarked", items: bookmarked.slice(0, 6).map((e) => ({ ex: e, note: e.difficulty, ok: Boolean(progress.lessons?.[key(e.slug)]) })) },
          ].map((col) => (
            <Card key={col.title} pad="sm">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{col.title}</p>
              {col.items.length ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {col.items.map(({ ex, note, ok }) => (
                    <li key={ex.slug} className="flex items-baseline justify-between gap-2">
                      <Link to={`/practice/python/${ex.slug}`} className="truncate text-ink hover:text-accent">{ex.title}</Link>
                      <span className={`shrink-0 text-xs ${ok ? "text-success" : "text-ink-faint"}`}>{note}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-xs text-ink-muted">Nothing here yet.</p>}
            </Card>
          ))}
        </section>
      )}

      <section aria-label="Problems" className="mt-6">
        <SectionHeader title="Problems" description="Filter by level, category, skill or status." />
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <span className="sr-only">Search problems</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input value={f.q} onChange={(e) => set("q")(e.target.value)} placeholder="Search by title, ID or concept" className={`${SELECT} w-full pl-8`} />
          </label>
          <select aria-label="Difficulty" value={f.difficulty} onChange={(e) => set("difficulty")(e.target.value)} className={SELECT}>
            <option value="">All levels</option>{["Easy", "Medium", "Hard"].map((d) => <option key={d}>{d}</option>)}
          </select>
          <select aria-label="Curriculum stage" value={f.stage ?? ""} onChange={(e) => set("stage")(e.target.value)} className={SELECT}>
            <option value="">All 14 stages</option>
            {PY_STAGES.map((s) => (
              <option key={s.stage} value={String(s.stage)}>Stage {s.stage}: {s.name}</option>
            ))}
          </select>
          <select aria-label="Category" value={f.category} onChange={(e) => set("category")(e.target.value)} className={SELECT}>
            <option value="">All categories</option>{PY_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.short}</option>)}
          </select>
          <select aria-label="Data engineering skill" value={f.skill} onChange={(e) => set("skill")(e.target.value)} className={SELECT}>
            <option value="">All skills</option>{skills.map((s) => <option key={s} value={s}>{PY_SKILLS[s] ?? s}</option>)}
          </select>
          <select aria-label="Status" value={f.status} onChange={(e) => set("status")(e.target.value)} className={SELECT}>
            <option value="">Any status</option><option value="new">Not started</option><option value="attempted">Attempted</option><option value="solved">Solved</option>
          </select>
          {(f.q || f.difficulty || f.category || f.stage || f.skill || f.status) && <Button variant="ghost" size="sm" onClick={() => setF({ q: "", difficulty: "", category: "", stage: "", skill: "", status: "" })}>Clear filters</Button>}
        </div>
        <p className="mt-2 text-xs text-ink-muted" aria-live="polite">{shown.length} of {all.length} problems</p>
        {shown.length === 0 ? (
          <div className="mt-3"><EmptyState icon={Search} title="No problems match">Try another search or clear the filters.</EmptyState></div>
        ) : (
          <ul className="mt-3 divide-y divide-surface-border overflow-hidden rounded-card border border-surface-border bg-surface-raised">
            {shown.map((e) => {
              const st = statusOf(e.slug, done, stats);
              return (
                <li key={e.slug}>
                  <Link to={`/practice/python/${e.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-overlay">
                    {st === "solved" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Solved" /> : st === "attempted" ? <CircleDot className="h-4 w-4 shrink-0 text-warn" aria-label="Attempted" /> : <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-label="Not started" />}
                    <span className="w-14 shrink-0 font-mono text-xs text-ink-faint">{e.code}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{e.title}</span>
                      <span className="block truncate text-xs text-ink-muted">{e.description}</span>
                    </span>
                    <span className="hidden shrink-0 rounded-full bg-accent-dim px-2 py-0.5 text-[11px] font-medium text-accent sm:inline">
                      Stage {getExerciseStage(e)}
                    </span>
                    <span className="hidden shrink-0 text-xs text-ink-faint md:block">{PY_CATEGORIES.find((c) => c.slug === e.category)?.short}</span>
                    <Difficulty level={e.difficulty} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Container>
  );
}

export function PythonExercisePage() {
  const { data } = usePage();
  const ex = data.exercise!;
  const task = ex.task;
  const pyOverride = useContent().overrides.get(overrideKey("python", ex.slug));
  const progress = useProgress();
  const path = `/practice/python/${ex.slug}`;
  const [mounted, setMounted] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [history, setHistory] = useState<Run[]>([]);
  const [showSolution, setShowSolution] = useState(false);
  const [lastCode, setLastCode] = useState("");
  const [restoreCode, setRestoreCode] = useState<{ name: string; content: string; ts: number } | null>(null);

  const all = data.exercises ?? [];
  const at = all.findIndex((e) => e.slug === ex.slug);
  const prev = at > 0 ? all[at - 1] : undefined;
  const next = all[at + 1];
  const { body, hints } = splitHints(ex.body);
  const bookmarked = Boolean(progress.bookmarks?.includes(key(ex.slug)));
  const { stats } = useStats();
  const stat = stats[ex.slug];
  const done = Boolean(progress.lessons?.[key(ex.slug)]);
  const topic = data.notes?.find((n) => n.slug === ex.topic);
  const stageNum = getExerciseStage(ex);
  const stageMeta = PY_STAGES.find((s) => s.stage === stageNum);

  useEffect(() => {
    setMounted(true);
    setHistory(readHist(ex.slug));
    setShowSolution(false);
    setHintsShown(0);
    track("python_opened", key(ex.slug));
  }, [ex.slug]);

  const log = (r: Run) => {
    const h = [r, ...history];
    setHistory(h);
    writeHist(ex.slug, h);
  };

  return (
    <Container wide className="pt-6">
      <Seo
        title={`${ex.title} — Python Exercise`}
        description={ex.description}
        path={path}
        type="article"
        jsonLd={[
          breadcrumbs([{ name: "Home", path: "/" }, { name: "Python practice", path: "/practice/python" }, { name: ex.title, path }]),
          { "@context": "https://schema.org", "@type": "LearningResource", name: ex.title, description: ex.description, url: canonical(path), learningResourceType: "Practice problem", educationalLevel: ex.difficulty, programmingLanguage: "Python" },
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint">
        <Link to="/practice/python" className="hover:text-ink">Python practice</Link>
        <span className="mx-1.5 text-ink-faint">/</span>
        <span className="text-ink">Stage {stageNum}: {stageMeta?.name ?? `Stage ${stageNum}`}</span>
      </nav>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {ex.code && <span className="rounded-md bg-surface-soft px-2 py-0.5 font-mono text-xs text-ink-muted">{ex.code}</span>}
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{ex.title}</h1>
        {pyOverride?.disabled && <p role="status" className="w-full rounded-lg border border-warn/40 bg-warn-dim px-3 py-2 text-sm text-ink">This problem is temporarily unavailable while it is being reviewed; checks are turned off.</p>}
        <Difficulty level={ex.difficulty} />
        {done && <span className="inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 className="h-4 w-4 animate-pop" aria-hidden /> Completed</span>}
        {mounted && !pyOverride?.disabled && <SolveTimer meta={{ kind: "python", ref: `py:${ex.slug}`, difficulty: ex.difficulty, topic: ex.category || "other" }} />}
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => toggleBookmark(key(ex.slug))} aria-pressed={bookmarked} aria-label={bookmarked ? "Remove bookmark" : "Bookmark this problem"}>
            {bookmarked ? <BookmarkCheck className="h-4 w-4 text-accent" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
          </Button>
          {prev ? <ButtonLink to={`/practice/python/${prev.slug}`} variant="ghost" size="sm" aria-label={`Previous: ${prev.title}`}><ArrowLeft className="h-4 w-4" aria-hidden /> Prev</ButtonLink> : null}
          {next ? <ButtonLink to={`/practice/python/${next.slug}`} variant="ghost" size="sm" aria-label={`Next: ${next.title}`}>Next <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink> : null}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <Badge tone="accent">Stage {stageNum}: {stageMeta?.name ?? `Stage ${stageNum}`}</Badge>
        {ex.category && <Badge tone="accent">{categoryLabel(ex.category)}</Badge>}
        {ex.skill && <Badge>{PY_SKILLS[ex.skill] ?? ex.skill}</Badge>}
        {mounted && stat && <span className="text-ink-faint">{stat.attempts} check{stat.attempts === 1 ? "" : "s"} · {stat.passes} passed</span>}
      </div>
      {ex.concepts.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Concepts tested">
          {ex.concepts.map((c) => <li key={c} className="rounded-full border border-surface-border px-2 py-0.5 text-[11px] text-ink-muted">{c}</li>)}
        </ul>
      )}
      <a href="#workspace" className="mt-3 inline-flex rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white lg:hidden">Jump to the workspace</a>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <article className="min-w-0 space-y-4">
          <Markdown source={body} className="prose-compact text-sm" />
          {hints.length > 0 && (
            <section aria-label="Hints" className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint"><Lightbulb className="h-3.5 w-3.5" aria-hidden /> Hints</h2>
              {hintsShown > 0 && <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink">{hints.slice(0, hintsShown).map((h, i) => <li key={i}><Markdown source={h} className="inline" /></li>)}</ol>}
              {hintsShown < hints.length
                ? <Button variant="ghost" size="sm" className="mt-2" onClick={() => { noteHint(`py:${ex.slug}`, hintsShown + 1); setHintsShown((n) => n + 1); }}>Show hint {hintsShown + 1} of {hints.length}</Button>
                : <p className="mt-2 text-xs text-ink-faint">That's every hint.</p>}
            </section>
          )}
          {topic && <p className="text-sm">Theory: <Link to={`/notes/${topic.slug}`} className="text-accent hover:underline">{topic.title}</Link></p>}
          {task && (
            <details className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
              <summary className="cursor-pointer font-medium text-ink">Show the tests</summary>
              <Markdown source={"```python-syntax\n" + task.tests + "\n```"} className="mt-2" />
              {task.hidden && <p className="mt-2 text-xs text-ink-faint">Checking also runs hidden tests with extra edge cases. They aren't shown, so write a general solution rather than one fitted to these asserts.</p>}
            </details>
          )}
          {task && (
            <div className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
              {showSolution ? <Markdown source={"```python-syntax\n" + task.solution + "\n```"} /> : (
                <button type="button" className="text-ink-muted underline" onClick={() => { if (confirm("Show the solution? Try the hints first.")) setShowSolution(true); }}>Show a solution</button>
              )}
            </div>
          )}
          {task?.explanation && (done || showSolution) && (
            <section aria-label="Solution explanation" className="rounded-card border border-accent/30 bg-accent-dim/40 p-4 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-accent">Solution explanation</h2>
              <p className="mt-1 text-ink">{task.explanation}</p>
              {(ex.time || ex.space) && <p className="mt-2 text-xs text-ink-muted">Expected complexity: {ex.time && <>time <code>{ex.time}</code></>}{ex.time && ex.space && ", "}{ex.space && <>space <code>{ex.space}</code></>}</p>}
            </section>
          )}
          {history.length > 0 && (
            <div className="text-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Execution history</p>
              <ul className="mt-1 space-y-0.5">
                {history.slice(0, 8).map((h, i) => (
                  <li key={i} className="text-xs text-ink-muted">
                    {h.code && (
                      <button
                        type="button"
                        className="mr-1.5 text-accent hover:underline"
                        onClick={() => {
                          if (confirm("Replace solution.py with this version?")) {
                            setRestoreCode({ name: "solution.py", content: h.code!, ts: Date.now() });
                          }
                        }}
                      >
                        Restore
                      </button>
                    )}
                    <span className={h.ok ? "text-success" : "text-danger"}>
                      {h.kind === "check" ? (h.ok ? "✓ passed" : "✗ failed") : h.ok ? "ran" : "error"}
                    </span>{" "}
                    · {new Date(h.at).toLocaleTimeString()} · {h.message.slice(0, 80)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>

        <div id="workspace" className="min-w-0 scroll-mt-20 space-y-4 lg:sticky lg:top-20 lg:self-start">
          <PythonWorkspace
            slug={ex.slug}
            title={ex.title}
            task={task}
            defaultFiles={[
              { name: "solution.py", content: task?.starter ?? "# Write your Python solution here\n" },
              { name: "main.py", content: `# Interactive testing for ${ex.title}\nfrom solution import *\n\nprint("Testing ${ex.title}...")\n` },
              { name: "helper.py", content: `# Helper utilities or sample data for ${ex.title}\n` },
            ]}
            onSolved={() => {
              completeExercise(key(ex.slug));
              recordPyAttempt(ex.slug, true);
            }}
            onCheckResult={(res, c) => {
              setLastCode(c);
              track("python_submitted", key(ex.slug), { passed: res.ok, hidden_failed: /fails a hidden test/.test(res.message) });
              log({ at: new Date().toISOString(), kind: "check", ok: res.ok, message: res.message, code: c.slice(0, 4000) });
              recordPyAttempt(ex.slug, res.ok);
              noteAttempt(`py:${ex.slug}`, res.ok, Date.now(), recordSession); // same grader verdict
              if (!res.ok) recordMistake({ ref: `py:${ex.slug}`, kind: "python", topic: ex.category || "other", category: classifyPyMistake(`${res.message}\n${res.output ?? ""}`), graded: true });
              if (res.ok) completeExercise(key(ex.slug));
            }}
            onRunResult={(r, c) => {
              setLastCode(c);
              track("python_executed", key(ex.slug), { ok: r.ok, ms: r.ms });
              noteExecution(`py:${ex.slug}`);
              if (!r.ok) recordMistake({ ref: `py:${ex.slug}`, kind: "python", topic: ex.category || "other", category: classifyPyMistake(r.error ?? ""), graded: false });
              log({ at: new Date().toISOString(), kind: "run", ok: r.ok, message: r.ok ? `ran in ${r.ms} ms` : r.error?.split("\n").pop() ?? "error", code: c.slice(0, 4000) });
            }}
            externalCode={restoreCode}
            height={600}
          />

          {mounted && lastCode && (
            <PyExplainBox code={lastCode} topic={ex.category || ex.title} prompt={ex.title} />
          )}

          {mounted && (
            <details className="rounded-card border border-surface-border bg-surface-raised p-3 text-sm">
              <summary className="cursor-pointer font-medium text-ink">Solve sessions</summary>
              <SessionHistory sessionRef={`py:${ex.slug}`} className="mt-2" />
            </details>
          )}

          {done && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-success/30 bg-success-dim p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="h-5 w-5 animate-pop" aria-hidden /> Exercise complete <Link to={`/study-notes?add=py:${ex.slug}`} className="ml-2 text-xs font-medium text-accent hover:underline">Study notes (PDF)</Link></p>
              {next ? <ButtonLink to={`/practice/python/${next.slug}`} size="sm">Next: {next.title} <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>
                : <ButtonLink to="/practice/python" size="sm" variant="secondary">All exercises</ButtonLink>}
            </div>
          )}
          <p className="flex items-start gap-1.5 text-xs text-ink-faint"><Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Sandboxed in your browser: no network or file access. Multi-file virtual filesystem supported with Pyodide WebAssembly.</p>
        </div>
      </div>
    </Container>
  );
}
