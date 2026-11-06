import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, CheckCircle2, Circle, CircleDot, Copy, Download, Eraser, FileCode2, FlaskConical, Lightbulb, Loader2, Maximize2, Minimize2, Play, RotateCcw, Save, Search, Timer, Wand2, XCircle } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { Badge, Button, ButtonLink, Card, Container, Difficulty, EmptyState, PageHeader, ProgressBar, Skeleton, Tabs } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { completeExercise, toggleBookmark, useProgress } from "../lib/progress";
import { runPython, resetPython, stopPython, PY_TIMEOUT_MS } from "../lib/pyRunner";
import { runPythonTask, type TaskResult, type TestCounts } from "../lib/tasks";
import { PY_CATEGORIES, PY_SKILLS, accuracy, categoryLabel, feedbackFor, filterExercises, overview, readStats, recordPyAttempt, splitHints, statusOf, subscribeStats, type PyFilter, type PyStat } from "../lib/pyPractice";
import { track } from "../lib/activity";
import { downloadText, formatPython } from "../lib/workspace";
import { applyOverride, overrideKey, useContent } from "../lib/contentOverrides";
import { SnippetsTab } from "../components/WorkspaceSide";

const CodeEditor = lazy(() => import("../components/CodeEditor"));
const key = (slug: string) => `py:${slug}`;
const DRAFT = (slug: string) => `sqlp.py.draft.${slug}`;
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

const SELECT = "rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";

export function PythonPracticeIndexPage() {
  const { data } = usePage();
  const progress = useProgress();
  const content = useContent();
  // Admin overrides (migration 010) hide disabled problems and apply title/difficulty edits.
  const all = (data.exercises ?? []).flatMap((e) => applyOverride(e, content.overrides.get(overrideKey("python", e.slug))) ?? []);
  const { stats, mounted } = useStats();
  const done = mounted ? progress.lessons : undefined;
  const [f, setF] = useState<PyFilter>({ q: "", difficulty: "", category: "", skill: "", status: "" });
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
        <Card pad="md" className="lg:col-span-1">
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
        <Card pad="md" className="lg:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">By category</p>
          <table className="mt-2 w-full text-sm">
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
          </table>
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
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <span className="sr-only">Search problems</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input value={f.q} onChange={(e) => set("q")(e.target.value)} placeholder="Search by title, ID or concept" className={`${SELECT} w-full pl-8`} />
          </label>
          <select aria-label="Difficulty" value={f.difficulty} onChange={(e) => set("difficulty")(e.target.value)} className={SELECT}>
            <option value="">All levels</option>{["Easy", "Medium", "Hard"].map((d) => <option key={d}>{d}</option>)}
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
          {(f.q || f.difficulty || f.category || f.skill || f.status) && <Button variant="ghost" size="sm" onClick={() => setF({ q: "", difficulty: "", category: "", skill: "", status: "" })}>Clear filters</Button>}
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
  const [code, setCode] = useState(task?.starter ?? "");
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState<"run" | "check" | null>(null);
  const [out, setOut] = useState<{ kind: "run" | "check"; text: string; result?: TaskResult & { counts?: Record<string, TestCounts> } } | null>(null);
  const [hintsShown, setHintsShown] = useState(0);
  const [snippets, setSnippets] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const flash = (s: string) => { setNote(s); setTimeout(() => setNote(null), 2500); };
  const [history, setHistory] = useState<Run[]>([]);
  const [showSolution, setShowSolution] = useState(false);
  const [view, setView] = useState<"tests" | "output">("tests");
  const [stdin, setStdin] = useState("");
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
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

  useEffect(() => {
    setMounted(true);
    try { setCode(localStorage.getItem(DRAFT(ex.slug)) ?? task?.starter ?? ""); } catch { setCode(task?.starter ?? ""); }
    setHistory(readHist(ex.slug));
    setOut(null);
    setShowSolution(false);
    setHintsShown(0);
    track("python_opened", key(ex.slug));
  }, [ex.slug, task?.starter]);

  const change = (v: string) => {
    setCode(v);
    try { localStorage.setItem(DRAFT(ex.slug), v); } catch { /* ignore */ }
  };
  const log = (r: Run) => {
    const h = [r, ...history];
    setHistory(h);
    writeHist(ex.slug, h);
  };

  async function run() {
    setBusy("run");
    const r = await runPython(code, undefined, PY_TIMEOUT_MS, stdin);
    setOut({ kind: "run", text: [r.stdout, r.error].filter(Boolean).join("\n") || "(no output)" });
    setErrorLine(r.errorLine ?? null);
    setView("output");
    track("python_executed", key(ex.slug), { ok: r.ok, ms: r.ms });
    log({ at: new Date().toISOString(), kind: "run", ok: r.ok, message: r.ok ? `ran in ${r.ms} ms` : r.error?.split("\n").pop() ?? "error", code: code.slice(0, 4000) });
    setBusy(null);
  }
  async function check() {
    if (!task) return;
    setBusy("check");
    let line: number | undefined;
    const res = await runPythonTask(task, code, (c, t) => runPython(c, t).then((r) => { line = r.errorLine; return r; }), { count: true });
    setOut({ kind: "check", text: res.output ?? "", result: res });
    setErrorLine(line ?? null);
    setView("tests");
    track("python_submitted", key(ex.slug), { passed: res.ok, hidden_failed: /fails a hidden test/.test(res.message) });
    log({ at: new Date().toISOString(), kind: "check", ok: res.ok, message: res.message, code: code.slice(0, 4000) });
    recordPyAttempt(ex.slug, res.ok);
    if (res.ok) completeExercise(key(ex.slug));
    setBusy(null);
  }

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
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint"><Link to="/practice/python" className="hover:text-ink">Python practice</Link></nav>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {ex.code && <span className="rounded-md bg-surface-soft px-2 py-0.5 font-mono text-xs text-ink-muted">{ex.code}</span>}
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{ex.title}</h1>
        {pyOverride?.disabled && <p role="status" className="w-full rounded-lg border border-warn/40 bg-warn-dim px-3 py-2 text-sm text-ink">This problem is temporarily unavailable while it is being reviewed; checks are turned off.</p>}
        <Difficulty level={ex.difficulty} />
        {done && <span className="inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> Completed</span>}
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => toggleBookmark(key(ex.slug))} aria-pressed={bookmarked} aria-label={bookmarked ? "Remove bookmark" : "Bookmark this problem"}>
            {bookmarked ? <BookmarkCheck className="h-4 w-4 text-accent" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
          </Button>
          {prev ? <ButtonLink to={`/practice/python/${prev.slug}`} variant="ghost" size="sm" aria-label={`Previous: ${prev.title}`}><ArrowLeft className="h-4 w-4" aria-hidden /> Prev</ButtonLink> : null}
          {next ? <ButtonLink to={`/practice/python/${next.slug}`} variant="ghost" size="sm" aria-label={`Next: ${next.title}`}>Next <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink> : null}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {ex.category && <Badge tone="accent">{categoryLabel(ex.category)}</Badge>}
        {ex.skill && <Badge>{PY_SKILLS[ex.skill] ?? ex.skill}</Badge>}
        {mounted && stat && <span className="text-ink-faint">{stat.attempts} check{stat.attempts === 1 ? "" : "s"} · {stat.passes} passed</span>}
      </div>
      {ex.concepts.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Concepts tested">
          {ex.concepts.map((c) => <li key={c} className="rounded-full border border-surface-border px-2 py-0.5 text-[11px] text-ink-muted">{c}</li>)}
        </ul>
      )}
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <article className="min-w-0 space-y-4">
          <Markdown source={body} className="text-sm" />
          {hints.length > 0 && (
            <section aria-label="Hints" className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint"><Lightbulb className="h-3.5 w-3.5" aria-hidden /> Hints</h2>
              {hintsShown > 0 && <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink">{hints.slice(0, hintsShown).map((h, i) => <li key={i}><Markdown source={h} className="inline" /></li>)}</ol>}
              {hintsShown < hints.length
                ? <Button variant="ghost" size="sm" className="mt-2" onClick={() => setHintsShown((n) => n + 1)}>Show hint {hintsShown + 1} of {hints.length}</Button>
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
                  <li key={i} className="text-xs text-ink-muted">{h.code && <button type="button" className="mr-1.5 text-accent hover:underline" onClick={() => { if (confirm("Replace the editor with this version?")) change(h.code!); }}>Restore</button>}<span className={h.ok ? "text-success" : "text-danger"}>{h.kind === "check" ? (h.ok ? "✓ passed" : "✗ failed") : h.ok ? "ran" : "error"}</span> · {new Date(h.at).toLocaleTimeString()} · {h.message.slice(0, 80)}</li>
                ))}
              </ul>
            </div>
          )}
        </article>

        <div className={full ? "fixed inset-0 z-50 space-y-4 overflow-y-auto bg-surface p-4" : "min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start"}>
          <Card pad="none" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border bg-surface-overlay px-4 py-2">
              <span className="inline-flex items-center gap-2 font-mono text-xs text-ink-muted"><FileCode2 className="h-4 w-4 text-accent" aria-hidden /> solution.py</span>
              <span className="flex flex-wrap items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => { const f = formatPython(code); if (f === null) flash("Mixed indentation: fix it by hand first."); else if (f === code) flash("Already formatted."); else { change(f); flash("Formatted."); } }} title="Tidy indentation, blank lines and trailing spaces"><Wand2 className="h-3.5 w-3.5" aria-hidden /> Format</Button>
                <Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard?.writeText(code); flash("Copied."); }} aria-label="Copy code"><Copy className="h-3.5 w-3.5" aria-hidden /></Button>
                <Button variant="ghost" size="sm" onClick={() => downloadText(`${ex.slug.replace(/-/g, "_")}.py`, code, "text/x-python")} aria-label="Download as .py"><Download className="h-3.5 w-3.5" aria-hidden /></Button>
                <Button variant="ghost" size="sm" onClick={() => setSnippets((v) => !v)} aria-pressed={snippets} aria-label="Snippets"><Save className="h-3.5 w-3.5" aria-hidden /></Button>
                <Button variant="ghost" size="sm" onClick={() => { if (confirm("Replace your code with the starter?")) change(task?.starter ?? ""); }}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset</Button>
                <Button variant="ghost" size="sm" onClick={() => { resetPython(); setOut({ kind: "run", text: "Python restarted." }); setView("output"); }}>Restart Python</Button>
                <Button variant="ghost" size="sm" onClick={() => setFull((v) => !v)} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}</Button>
              </span>
            </div>
            {mounted ? (
              <Suspense fallback={<Skeleton className="h-[360px] rounded-none" />}>
                <CodeEditor value={code} onChange={(v) => { change(v); setErrorLine(null); }} onRun={check} height={full ? 520 : 360} label="Python editor" language="python" errorLine={errorLine} errorMessage={out?.result?.message ?? out?.text.split("\n").filter(Boolean).pop()} />
              </Suspense>
            ) : <Skeleton className="h-[360px] rounded-none" />}
            {note && <p role="status" className="border-t border-surface-border px-4 py-1.5 text-xs text-ink-muted">{note}</p>}
            {snippets && <div className="h-64 border-t border-surface-border"><SnippetsTab lang="python" current={code} onInsert={(t) => change(`${code.replace(/\s*$/, "")}\n\n${t}\n`)} /></div>}
            <details className="border-t border-surface-border px-4 py-2 text-sm">
              <summary className="cursor-pointer select-none text-xs font-medium text-ink-muted">Standard input {stdin ? `(${stdin.split("\n").length} line${stdin.split("\n").length === 1 ? "" : "s"})` : "(for input())"}</summary>
              <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} rows={3} aria-label="Standard input" placeholder="Lines your program reads with input() when you press Run"
                className="mt-2 w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent" />
            </details>
            <div className="flex flex-wrap items-center gap-2 border-t border-surface-border px-4 py-3">
              <Button variant="secondary" onClick={run} disabled={!!busy}>
                {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Run
              </Button>
              {busy && <Button variant="danger" onClick={() => { stopPython(); setBusy(null); setOut({ kind: "run", text: "Stopped." }); }}>Stop</Button>}
              <Button onClick={check} disabled={!!busy || !task || !!pyOverride?.disabled}>
                {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />} Check against tests
              </Button>
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-faint"><Timer className="h-3.5 w-3.5" aria-hidden /> {PY_TIMEOUT_MS / 1000}s limit · ⌘/Ctrl+Enter checks</span>
            </div>
          </Card>

          <Card pad="none" as="section">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-2">
              <h2 className="text-sm font-semibold text-ink">Results</h2>
              <span className="flex items-center gap-1">
                {out && <Button variant="ghost" size="sm" onClick={() => { setOut(null); setErrorLine(null); }}><Eraser className="h-3.5 w-3.5" aria-hidden /> Clear</Button>}
                <Tabs label="Result view" value={view} onChange={setView} tabs={[{ id: "tests", label: "Tests" }, { id: "output", label: "Output" }]} />
              </span>
            </div>
            <div className="p-4" role="status" aria-live="polite">
              {view === "tests" ? (
                out?.result ? (
                  <>
                    <ul className="space-y-2 text-sm">
                      {[
                        { label: "Your code runs", state: /raised an error|could not start/.test(out.result.message) ? "fail" : /Timed out|Stopped after/.test(out.result.message) ? "fail" : "pass" },
                        { label: `${task?.hidden ? "Visible tests pass" : "All tests pass"}${countText(out.result.counts?.visible)}`, state: out.result.ok || /fails a hidden test/.test(out.result.message) ? "pass" : /raised an error|could not start|Timed out|Stopped after/.test(out.result.message) ? "skip" : "fail" },
                        ...(task?.hidden ? [{ label: `Hidden tests pass${countText(out.result.counts?.hidden)}`, state: out.result.ok ? "pass" : /fails a hidden test/.test(out.result.message) ? "fail" : "skip" }] : []),
                      ].map((s) => (
                        <li key={s.label} className="flex items-center gap-2">
                          {s.state === "pass" ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : s.state === "fail" ? <XCircle className="h-4 w-4 text-danger" aria-hidden /> : <Circle className="h-4 w-4 text-ink-faint" aria-hidden />}
                          <span className={s.state === "skip" ? "text-ink-faint" : "text-ink"}>{s.label}{s.state === "skip" ? " (not reached)" : ""}</span>
                        </li>
                      ))}
                    </ul>
                    <p className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${out.result.ok ? "bg-success-dim text-success" : "bg-danger-dim text-danger"}`}>
                      {out.result.message}{out.result.ms !== undefined ? <span className="font-normal text-ink-muted"> · {Math.round(out.result.ms)} ms</span> : null}
                    </p>
                    {!out.result.ok && <Feedback result={out.result} topic={topic ? { slug: topic.slug, title: topic.title } : undefined} concepts={ex.concepts} />}
                  </>
                ) : <p className="text-sm text-ink-muted">Press <strong className="text-ink">Check against tests</strong> to grade your code. The tests run together in a sandbox; the solution passes when every one of them does.</p>
              ) : out?.text ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-overlay p-3 font-mono text-xs text-ink">{out.text}</pre>
              ) : <p className="text-sm text-ink-muted">Press <strong className="text-ink">Run</strong> to see what your code prints.</p>}
            </div>
          </Card>

          {(done || out?.result?.ok) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-success/30 bg-success-dim p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="h-5 w-5" aria-hidden /> Exercise complete <Link to={`/study-notes?add=py:${ex.slug}`} className="ml-2 text-xs font-medium text-accent hover:underline">Study notes (PDF)</Link></p>
              {next ? <ButtonLink to={`/practice/python/${next.slug}`} size="sm">Next: {next.title} <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>
                : <ButtonLink to="/practice/python" size="sm" variant="secondary">All exercises</ButtonLink>}
            </div>
          )}
          <p className="flex items-start gap-1.5 text-xs text-ink-faint"><Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Sandboxed in your browser: no network or file access. The first run downloads Python (about 10 MB, then cached).</p>
        </div>
      </div>
    </Container>
  );
}

const countText = (c?: TestCounts) => (c && c.total ? ` (${c.passed}/${c.total})` : "");

/** What failed, why that usually happens, and where to read up. Hidden test sources stay hidden. */
function Feedback({ result, topic, concepts }: { result: TaskResult & { counts?: Record<string, TestCounts> }; topic?: { slug: string; title: string }; concepts: string[] }) {
  const failed = result.counts?.visible?.failures ?? [];
  const tip = feedbackFor(result.message, failed.map((f) => f.error).join("\n") + "\n" + (result.output ?? ""));
  return (
    <div className="mt-3 space-y-2 text-sm">
      {failed.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Failed visible tests</p>
          <ul className="mt-1 space-y-1">
            {failed.slice(0, 3).map((f, i) => (
              <li key={i} className="rounded-lg bg-surface-overlay p-2 font-mono text-xs">
                <span className="block whitespace-pre-wrap text-ink">{f.test}</span>
                <span className="block text-danger">{f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tip && <p className="rounded-lg border border-surface-border p-2 text-ink"><strong>Suggestion:</strong> {tip}</p>}
      {(topic || concepts.length > 0) && (
        <p className="text-xs text-ink-muted">Concepts: {concepts.join(", ")}{topic && <> · read <Link to={`/notes/${topic.slug}`} className="text-accent hover:underline">{topic.title}</Link></>}</p>
      )}
    </div>
  );
}
