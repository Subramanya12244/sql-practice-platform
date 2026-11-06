import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bug, CheckCircle2, Circle, FlaskConical, Lightbulb, Loader2, Play, RotateCcw, Search, XCircle } from "lucide-react";
import { Badge, Button, Card, Container, PageHeader, Skeleton } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { Seo } from "../lib/seo";
import { completeExercise, useProgress } from "../lib/progress";
import { runPython } from "../lib/pyRunner";
import { runPythonTask, type TestCounts } from "../lib/tasks";
import { track } from "../lib/activity";
import scenarios from "../content/debug/scenarios.json";

const CodeEditor = lazy(() => import("../components/CodeEditor"));
interface Scenario {
  id: string; level: "Beginner" | "Intermediate" | "Advanced"; title: string; scenario: string; symptom: string;
  pipeline: string; fixed: string; tests: string; hints: string[]; explanation: string;
  diagnosis: { question: string; options: string[]; answer: number; why: string[] };
}
const ALL = scenarios as Scenario[];
const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
const key = (id: string) => `debug:${id}`;
const DRAFT = (id: string) => `sqlp.debug.draft.${id}`;
const DIAG = (id: string) => `sqlp.debug.diag.${id}`;

/** Pipeline debugging simulator: inspect, diagnose, fix, validate. Everything runs in the browser's Python sandbox. */
export function DebugLabPage() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const progress = useProgress();
  const [id, setId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); setId(new URLSearchParams(search).get("s")); }, [search]);
  const s = ALL.find((x) => x.id === id);
  const done = (x: Scenario) => mounted && Boolean(progress.lessons?.[key(x.id)]);

  return (
    <Container wide className="pt-6">
      <Seo title="Pipeline Debugging Lab" description="Broken data pipelines to inspect, diagnose and fix: duplicates, missing values, schema drift, pagination, incremental loads, aggregation and reconciliation bugs." path="/debug-lab" />
      {!s ? (
        <>
          <PageHeader eyebrow="Practice" title="Pipeline debugging lab" intro="Each scenario is a small, real pipeline with one bug that has reached production. Inspect the code and data, run it, diagnose the cause, fix it and pass the validation checks." />
          <div className="grid gap-6 lg:grid-cols-3">
            {LEVELS.map((lvl) => (
              <section key={lvl} aria-label={lvl}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-faint">{lvl}</h2>
                <ul className="space-y-2">
                  {ALL.filter((x) => x.level === lvl).map((x) => (
                    <li key={x.id}>
                      <Link to={`/debug-lab?s=${x.id}`} className="flex items-start gap-3 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel hover:border-accent/40">
                        {done(x) ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Fixed" /> : <Bug className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />}
                        <span><span className="block font-semibold text-ink">{x.title}</span><span className="mt-0.5 block text-sm text-ink-muted">{x.scenario}</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : <ScenarioView key={s.id} s={s} solved={done(s)} onBack={() => navigate("/debug-lab")} />}
    </Container>
  );
}

function ScenarioView({ s, solved, onBack }: { s: Scenario; solved: boolean; onBack: () => void }) {
  const [code, setCode] = useState(s.pipeline);
  const [ranOutput, setRanOutput] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [hints, setHints] = useState(0);
  const [busy, setBusy] = useState<"run" | "check" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string; counts?: Record<string, TestCounts> } | null>(null);
  const [showFix, setShowFix] = useState(false);
  useEffect(() => {
    try { setCode(localStorage.getItem(DRAFT(s.id)) ?? s.pipeline); const d = localStorage.getItem(DIAG(s.id)); setPick(d === null ? null : Number(d)); } catch { /* storage blocked */ }
    track("python_opened", key(s.id));
  }, [s]);
  const change = (v: string) => { setCode(v); try { localStorage.setItem(DRAFT(s.id), v); } catch { /* ignore */ } };
  const diagnose = (i: number) => { setPick(i); try { localStorage.setItem(DIAG(s.id), String(i)); } catch { /* ignore */ } };

  async function run(src: string) {
    setBusy("run");
    const r = await runPython(src);
    setRanOutput([r.stdout, r.error].filter(Boolean).join("\n") || "(no output)");
    setBusy(null);
  }
  async function validate() {
    setBusy("check");
    const r = await runPythonTask({ id: s.id, title: s.title, type: "python", instructions: "", starter: s.pipeline, solution: s.fixed, tests: s.tests }, code, (c, t) => runPython(c, t), { count: true });
    setResult(r);
    track("python_submitted", key(s.id), { passed: r.ok, debug: true });
    if (r.ok) completeExercise(key(s.id));
    setBusy(null);
  }
  const v = result?.counts?.visible;

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="text-sm text-ink-faint hover:text-ink">← All scenarios</button>
      <div className="flex flex-wrap items-center gap-2"><h1 className="font-display text-2xl font-bold text-ink">{s.title}</h1><Badge tone="accent">{s.level}</Badge>{solved && <span className="inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> Fixed</span>}</div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-4">
          <Card pad="md" as="section" aria-label="Incident">
            <p className="text-sm text-ink">{s.scenario}</p>
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger-dim px-3 py-2 font-mono text-xs text-ink"><strong className="font-sans">Symptom:</strong> {s.symptom}</p>
          </Card>
          <Card pad="md" as="section" aria-label="Step 1: inspect">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Search className="h-4 w-4 text-accent" aria-hidden /> 1. Inspect the pipeline and its data</h2>
            <Markdown source={"```python-syntax\n" + s.pipeline + "\n```"} className="mt-2 text-xs" />
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => void run(s.pipeline)} disabled={!!busy}>{busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Run the broken pipeline</Button>
          </Card>
          <Card pad="md" as="section" aria-label="Step 2: diagnose">
            <h2 className="text-sm font-semibold text-ink">2. {s.diagnosis.question}</h2>
            <fieldset className="mt-2 space-y-1.5" disabled={pick !== null}>
              <legend className="sr-only">{s.diagnosis.question}</legend>
              {s.diagnosis.options.map((o, i) => {
                const right = i === s.diagnosis.answer;
                const tone = pick === null ? "border-surface-border hover:border-accent/40" : right ? "border-success/50 bg-success-dim" : i === pick ? "border-danger/50 bg-danger-dim" : "border-surface-border opacity-80";
                return (
                  <label key={i} className={`block rounded-lg border p-2 text-sm ${tone}`}>
                    <span className="flex items-start gap-2"><input type="radio" name={`dx-${s.id}`} className="mt-1" checked={pick === i} onChange={() => diagnose(i)} /><span className="text-ink">{o}</span></span>
                    {pick !== null && <span className={`mt-1 block pl-6 text-xs ${right ? "text-success" : "text-ink-muted"}`}>{s.diagnosis.why[i]}</span>}
                  </label>
                );
              })}
            </fieldset>
            {pick !== null && <button type="button" className="mt-1 text-xs text-ink-muted underline hover:text-ink" onClick={() => { setPick(null); try { localStorage.removeItem(DIAG(s.id)); } catch { /* ignore */ } }}>Try again</button>}
          </Card>
          {s.hints.length > 0 && (
            <Card pad="sm" as="section" aria-label="Hints">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint"><Lightbulb className="h-3.5 w-3.5" aria-hidden /> Hints</p>
              {hints > 0 && <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-ink">{s.hints.slice(0, hints).map((h, i) => <li key={i}>{h}</li>)}</ol>}
              {hints < s.hints.length && <button type="button" className="mt-1 text-sm text-accent hover:underline" onClick={() => setHints((n) => n + 1)}>Show hint {hints + 1} of {s.hints.length}</button>}
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <Card pad="none" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border bg-surface-overlay px-4 py-2">
              <span className="text-sm font-semibold text-ink">3. Fix it</span>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm("Reset the editor to the broken pipeline?")) change(s.pipeline); }}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset</Button>
            </div>
            <Suspense fallback={<Skeleton className="h-[420px] rounded-none" />}>
              <CodeEditor value={code} onChange={change} onRun={validate} height={420} label="Pipeline editor" language="python" />
            </Suspense>
            <div className="flex flex-wrap items-center gap-2 border-t border-surface-border px-4 py-3">
              <Button variant="secondary" onClick={() => void run(code)} disabled={!!busy}><Play className="h-4 w-4" aria-hidden /> Run my version</Button>
              <Button onClick={() => void validate()} disabled={!!busy}>{busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />} 4. Run validation</Button>
            </div>
          </Card>
          {ranOutput !== null && <Card pad="sm" as="section" aria-label="Output"><p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Output</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink">{ranOutput}</pre></Card>}
          {result && (
            <Card pad="md" as="section" aria-label="Validation result">
              <p className={`flex items-center gap-2 font-semibold ${result.ok ? "text-success" : "text-danger"}`}>{result.ok ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />} {result.ok ? "Pipeline fixed: every validation check passes." : result.message}</p>
              {v && <p className="mt-1 text-xs text-ink-muted">{v.passed} of {v.total} validation checks passed.</p>}
              {v?.failures.slice(0, 2).map((f, i) => <pre key={i} className="mt-2 overflow-x-auto rounded bg-surface-overlay p-2 font-mono text-xs"><span className="text-ink">{f.test}</span>{"\n"}<span className="text-danger">{f.error}</span></pre>)}
              {result.ok && <p className="mt-2 text-sm text-ink">{s.explanation}</p>}
            </Card>
          )}
          {(result || solved) && (
            <div className="text-sm">
              {showFix ? <Markdown source={"```python-syntax\n" + s.fixed + "\n```"} className="text-xs" /> : <button type="button" className="text-ink-muted underline hover:text-ink" onClick={() => setShowFix(true)}>Show a fixed version</button>}
            </div>
          )}
          <p className="flex items-center gap-1.5 text-xs text-ink-faint"><Circle className="h-3 w-3" aria-hidden /> Runs in Python in your browser. Validation checks the pipeline's output, not the code text.</p>
        </div>
      </div>
    </div>
  );
}
