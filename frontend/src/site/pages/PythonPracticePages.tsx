import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FlaskConical, Loader2, Play, RotateCcw } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { Container, Difficulty, PageHeader, Skeleton } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { completeExercise, useProgress } from "../lib/progress";
import { runPython, resetPython, PY_TIMEOUT_MS } from "../lib/pyRunner";
import { runPythonTask, type TaskResult } from "../lib/tasks";

const CodeEditor = lazy(() => import("../components/CodeEditor"));
const key = (slug: string) => `py:${slug}`;
const DRAFT = (slug: string) => `sqlp.py.draft.${slug}`;
const HIST = (slug: string) => `sqlp.py.history.${slug}`;

interface Run { at: string; kind: "run" | "check"; ok: boolean; message: string }
const readHist = (slug: string): Run[] => { try { return JSON.parse(localStorage.getItem(HIST(slug)) ?? "[]"); } catch { return []; } };
const writeHist = (slug: string, h: Run[]) => { try { localStorage.setItem(HIST(slug), JSON.stringify(h.slice(0, 20))); } catch { /* ignore */ } };

export function PythonPracticeIndexPage() {
  const { data } = usePage();
  const progress = useProgress();
  const all = data.exercises ?? [];
  const done = all.filter((e) => progress.lessons?.[key(e.slug)]).length;
  return (
    <Container>
      <Seo
        title="Python Practice for Data Engineers — Exercises Graded in Your Browser"
        description="Python exercises for data work: parsing CSV and JSON, regex, dedupe, pandas cleaning and joins, NumPy, retries and incremental loads. Runs and grades in your browser."
        path="/practice/python"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Python practice", path: "/practice/python" }])]}
      />
      <PageHeader
        eyebrow="Practice"
        title="Python practice"
        intro={`Real Python (Pyodide) runs in a sandbox in your browser: no install, no server. Each exercise is checked by tests. You've completed ${done} of ${all.length}.`}
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((e) => (
          <li key={e.slug}>
            <Link to={`/practice/python/${e.slug}`} className="flex h-full flex-col rounded-card border border-surface-border bg-surface-raised p-4 hover:border-accent/40">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{e.title}</span>
                {progress.lessons?.[key(e.slug)] ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Completed" /> : <Difficulty level={e.difficulty} />}
              </span>
              <span className="mt-1 text-sm text-ink-muted">{e.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}

export function PythonExercisePage() {
  const { data } = usePage();
  const ex = data.exercise!;
  const task = ex.task;
  const progress = useProgress();
  const path = `/practice/python/${ex.slug}`;
  const [code, setCode] = useState(task?.starter ?? "");
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState<"run" | "check" | null>(null);
  const [out, setOut] = useState<{ kind: "run" | "check"; text: string; result?: TaskResult } | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [showSolution, setShowSolution] = useState(false);
  const done = Boolean(progress.lessons?.[key(ex.slug)]);
  const topic = data.notes?.find((n) => n.slug === ex.topic);

  useEffect(() => {
    setMounted(true);
    try { setCode(localStorage.getItem(DRAFT(ex.slug)) ?? task?.starter ?? ""); } catch { setCode(task?.starter ?? ""); }
    setHistory(readHist(ex.slug));
    setOut(null);
    setShowSolution(false);
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
    const r = await runPython(code);
    setOut({ kind: "run", text: [r.stdout, r.error].filter(Boolean).join("\n") || "(no output)" });
    log({ at: new Date().toISOString(), kind: "run", ok: r.ok, message: r.ok ? "ran" : r.error?.split("\n").pop() ?? "error" });
    setBusy(null);
  }
  async function check() {
    if (!task) return;
    setBusy("check");
    const res = await runPythonTask(task, code, runPython);
    setOut({ kind: "check", text: res.output ?? "", result: res });
    log({ at: new Date().toISOString(), kind: "check", ok: res.ok, message: res.message });
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
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{ex.title}</h1>
        <Difficulty level={ex.difficulty} />
        {done && <span className="inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> Completed</span>}
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <article className="min-w-0 space-y-4">
          <Markdown source={ex.body} className="text-sm" />
          {topic && <p className="text-sm">Theory: <Link to={`/notes/${topic.slug}`} className="text-accent hover:underline">{topic.title}</Link></p>}
          {task && (
            <details className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
              <summary className="cursor-pointer font-medium text-ink">Show the tests</summary>
              <Markdown source={"```python-syntax\n" + task.tests + "\n```"} className="mt-2" />
            </details>
          )}
          {task && (
            <div className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
              {showSolution ? <Markdown source={"```python-syntax\n" + task.solution + "\n```"} /> : (
                <button type="button" className="text-ink-muted underline" onClick={() => { if (confirm("Show the solution? Try the hints first.")) setShowSolution(true); }}>Show a solution</button>
              )}
            </div>
          )}
          {history.length > 0 && (
            <div className="text-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Execution history</p>
              <ul className="mt-1 space-y-0.5">
                {history.slice(0, 8).map((h, i) => (
                  <li key={i} className="text-xs text-ink-muted"><span className={h.ok ? "text-success" : "text-danger"}>{h.kind === "check" ? (h.ok ? "✓ passed" : "✗ failed") : h.ok ? "ran" : "error"}</span> · {new Date(h.at).toLocaleTimeString()} · {h.message.slice(0, 80)}</li>
                ))}
              </ul>
            </div>
          )}
        </article>

        <div className="min-w-0 space-y-3">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-[360px]" />}>
              <CodeEditor value={code} onChange={change} onRun={check} height={360} label="Python editor" language="python" />
            </Suspense>
          ) : <Skeleton className="h-[360px]" />}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={run} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-2 text-sm text-ink disabled:opacity-60">
              {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Run
            </button>
            <button type="button" onClick={check} disabled={!!busy || !task} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />} Check
            </button>
            <button type="button" onClick={() => { if (confirm("Replace your code with the starter?")) change(task?.starter ?? ""); }} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-ink-muted hover:text-ink">
              <RotateCcw className="h-4 w-4" aria-hidden /> Reset
            </button>
            <button type="button" onClick={() => { resetPython(); setOut({ kind: "run", text: "Python restarted." }); }} className="text-xs text-ink-faint underline">Restart Python</button>
          </div>
          <p className="text-xs text-ink-faint">Sandboxed in your browser · {PY_TIMEOUT_MS / 1000}s limit · no network or file access · the first run downloads Python (~10 MB, then cached).</p>
          {out && (
            <div role="status" className={`rounded-card border p-3 text-sm ${out.result ? (out.result.ok ? "border-success/30 bg-success-dim" : "border-danger/30 bg-danger-dim") : "border-surface-border bg-surface-raised"}`}>
              {out.result && <p className="font-semibold text-ink">{out.result.ok ? "✅ " : "❌ "}{out.result.message}</p>}
              {out.text && <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink">{out.text}</pre>}
            </div>
          )}
        </div>
      </div>
    </Container>
  );
}
