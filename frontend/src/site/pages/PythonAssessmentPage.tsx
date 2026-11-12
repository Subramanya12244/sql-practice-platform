import { type CheckLog, type CheckKind, LIMITS, assessmentStats, describeCheck, problemStats } from "../lib/pyAssessment";
import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, FlaskConical, Loader2, Timer, Trophy, XCircle } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { Badge, Button, Card, Container, Difficulty, PageHeader, SegmentedProgress, Skeleton, StatCard } from "../components/ui";
import { Seo } from "../lib/seo";
import { completeExercise, useProgress } from "../lib/progress";
import { loadExercise, type PyExercise } from "../lib/pyExercises";
import { runPython } from "../lib/pyRunner";
import { runPythonTask } from "../lib/tasks";
import { pickAssessment } from "../lib/extras";
import { recordPyAttempt, splitHints } from "../lib/pyPractice";
import { track } from "../lib/activity";
import { HelpTooltip } from "../help/HelpTooltip";

const CodeEditor = lazy(() => import("../components/CodeEditor"));
const ACTIVE = "sqlp.pyassess.active";
const DONE = "sqlp.pyassess.history";
const CODE = (slug: string) => `sqlp.pyassess.code.${slug}`;

interface Active { slugs: string[]; startedAt: number; durationMin: number; passed: Record<string, boolean>; checks: Record<string, number>; log?: Record<string, CheckLog[]> }
export interface AssessmentResult { at: string; durationMin: number; usedSec: number; solved: number; total: number; problems: { slug: string; passed: boolean; checks: number; log?: CheckLog[] }[] }

const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };


export function PythonAssessmentPage() {
  const { data } = usePage();
  const progress = useProgress();
  const all = data.exercises ?? [];
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const [past, setPast] = useState<AssessmentResult[]>([]);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [duration, setDuration] = useState(45);
  const [includeSolved, setIncludeSolved] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { setMounted(true); setActive(read<Active | null>(ACTIVE, null)); setPast(read<AssessmentResult[]>(DONE, [])); }, []);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const left = active ? Math.max(0, Math.round((active.startedAt + active.durationMin * 60_000 - now) / 1000)) : 0;
  useEffect(() => { if (active && left === 0) finish(active); }, [active, left]); // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    const slugs = pickAssessment(all, progress.lessons, `${Date.now()}`, includeSolved);
    for (const s of slugs) { try { localStorage.removeItem(CODE(s)); } catch { /* ignore */ } }
    const a: Active = { slugs, startedAt: Date.now(), durationMin: duration, passed: {}, checks: {} };
    write(ACTIVE, a);
    setResult(null);
    setNow(Date.now());
    setActive(a);
  }
  function update(a: Active) { write(ACTIVE, a); setActive(a); }
  function finish(a: Active) {
    const r: AssessmentResult = {
      at: new Date().toISOString(), durationMin: a.durationMin, usedSec: Math.min(a.durationMin * 60, Math.round((Date.now() - a.startedAt) / 1000)),
      solved: a.slugs.filter((s) => a.passed[s]).length, total: a.slugs.length, problems: a.slugs.map((s) => ({ slug: s, passed: Boolean(a.passed[s]), checks: a.checks[s] ?? 0, log: a.log?.[s] })),
    };
    const list = [r, ...read<AssessmentResult[]>(DONE, [])].slice(0, 50);
    write(DONE, list);
    try { localStorage.removeItem(ACTIVE); } catch { /* ignore */ }
    track("assessment_completed", "python", { solved: r.solved, total: r.total, usedSec: r.usedSec });
    setPast(list);
    setActive(null);
    setResult(r);
  }

  const title = (slug: string) => all.find((e) => e.slug === slug);

  return (
    <Container wide className="pt-6">
      <Seo title="Timed Python Assessment for Data Engineers" description="Three Python data engineering problems (Easy, Medium, Hard) against the clock, graded by visible and hidden tests in your browser." path="/practice/python/assessment" />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint"><Link to="/practice/python" className="hover:text-ink">Python practice</Link></nav>
      {!active && (
        <PageHeader eyebrow="Assessment" title="Timed Python assessment" intro="One Easy, one Medium and one Hard problem against the clock. Hints and solutions are hidden until you finish; each problem is graded by its visible and hidden tests." />
      )}

      {!mounted ? <Skeleton className="h-64" /> : active ? (
        <Running active={active} left={left} onUpdate={update} onFinish={() => finish(active)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card pad="md" as="section" aria-label="Start an assessment">
            <label className="flex items-center gap-2 text-sm text-ink">Time limit
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-ink">
                {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={includeSolved} onChange={(e) => setIncludeSolved(e.target.checked)} /> Include problems I've already solved
            </label>
            <Button className="mt-4" onClick={start} disabled={!all.length} data-help="py-assess-start"><Timer className="h-4 w-4" aria-hidden /> Start assessment</Button>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-muted">
              <li>One Easy, one Medium and one Hard problem.</li>
              <li>Hints and solutions stay hidden until you finish.</li>
            </ul>
            <p className="mt-2 text-xs text-ink-faint">The timer keeps running if you reload or leave the page. Passing a problem here also marks it completed.</p>
          </Card>
          <Card pad="md" as="section" aria-label="Past assessments">
            {result && (
              <div className="mb-4 space-y-3">
                <p className="flex items-center gap-2 font-semibold text-ink"><Trophy className="h-4 w-4 animate-pop text-accent" aria-hidden /> {result.solved} of {result.total} solved in {Math.round(result.usedSec / 60)} min</p>
                <div className="stagger grid grid-cols-3 gap-2">
                  <StatCard label="Score" value={`${Math.round((result.solved / Math.max(1, result.total)) * 100)}%`} />
                  <StatCard label="Time" value={`${Math.round(result.usedSec / 60)} min`} hint={`of ${result.durationMin}`} />
                  <StatCard label="Correct" value={`${result.solved}/${result.total}`} />
                </div>
                <ul className="space-y-1 text-sm">
                  {result.problems.map((p) => { const e = title(p.slug); return (
                    <li key={p.slug} className="flex items-center gap-2">{p.passed ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Passed" /> : <XCircle className="h-4 w-4 text-danger" aria-label="Not passed" />}
                      <Link to={`/practice/python/${p.slug}`} className="truncate text-ink hover:text-accent">{e ? `${e.code} ${e.title}` : p.slug}</Link>
                      <Badge tone={p.passed ? "success" : "danger"} className="ml-auto shrink-0">{p.passed ? "Passed" : "Not passed"}</Badge><span className="shrink-0 text-xs text-ink-faint">{p.checks} check{p.checks === 1 ? "" : "s"}</span>
                      {p.log && p.log.length > 0 && <ProblemLog log={p.log} />}</li>
                  ); })}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">Open a problem to see its hints, solution and explanation.</p>
              </div>
            )}
            <h2 className="text-sm font-semibold text-ink">Past assessments</h2>
            {past.length > 0 && <AssessmentStatsRow history={past} />}
            {past.length ? (
              <ul className="mt-2 divide-y divide-surface-border text-sm">
                {past.slice(0, 10).map((p) => <li key={p.at} className="flex justify-between py-1.5"><span className="text-ink-muted">{new Date(p.at).toLocaleDateString()}</span><span className="font-semibold text-ink">{p.solved}/{p.total}</span><span className="text-ink-faint">{Math.round(p.usedSec / 60)} of {p.durationMin} min</span></li>)}
              </ul>
            ) : <p className="mt-2 text-sm text-ink-muted">None yet.</p>}
          </Card>
        </div>
      )}
    </Container>
  );
}

function Running({ active, left, onUpdate, onFinish }: { active: Active; left: number; onUpdate: (a: Active) => void; onFinish: () => void }) {
  const [i, setI] = useState(0);
  const [ex, setEx] = useState<PyExercise | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; kind: CheckKind; visible?: [number, number]; hidden?: [number, number] } | null>(null);
  const slug = active.slugs[i];

  useEffect(() => {
    setEx(null); setMsg(null);
    void loadExercise(slug).then((e) => {
      setEx(e ?? null);
      setCode(read<string | null>(CODE(slug), null) ?? e?.task?.starter ?? "");
    });
  }, [slug]);

  async function check() {
    if (!ex?.task) return;
    setBusy(true);
    const r = await runPythonTask(ex.task, code, (c, t) => runPython(c, t), { count: true });
    const v = r.counts?.visible, h = r.counts?.hidden;
    const outcome = describeCheck(r.message, r.ok);
    const entry: CheckLog = { at: Math.round((Date.now() - active.startedAt) / 1000), ok: r.ok, kind: outcome.kind, ...(v ? { visible: [v.passed, v.total] as [number, number] } : {}), ...(h ? { hidden: [h.passed, h.total] as [number, number] } : {}) };
    // Hidden test sources and solutions stay hidden; only the verdict and counts are shown.
    setMsg({ ok: r.ok, text: outcome.text, kind: outcome.kind, visible: entry.visible, hidden: entry.hidden });
    recordPyAttempt(slug, r.ok);
    track("python_submitted", `py:${slug}`, { passed: r.ok, assessment: true });
    if (r.ok) completeExercise(`py:${slug}`);
    onUpdate({ ...active, passed: { ...active.passed, [slug]: active.passed[slug] || r.ok }, checks: { ...active.checks, [slug]: (active.checks[slug] ?? 0) + 1 }, log: { ...active.log, [slug]: [...(active.log?.[slug] ?? []), entry].slice(-30) } });
    setBusy(false);
  }

  const body = ex ? splitHints(ex.body).body.replace(/\n## Why it matters[\s\S]*$/, "") : "";
  return (
    <div className="space-y-4">
      <div className="sticky top-16 z-10 space-y-3 rounded-card border border-surface-border bg-surface-raised p-3 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-ink">Python assessment · <span className="font-normal text-ink-muted">Problem {i + 1} of {active.slugs.length}</span></span>
          <span className="text-xs text-ink-muted">{active.slugs.filter((s) => active.passed[s]).length} of {active.slugs.length} passed</span>
        </div>
        <SegmentedProgress done={active.slugs.filter((s) => active.passed[s]).length} total={active.slugs.length} label="Problems passed" />
        <div className="flex flex-wrap items-center gap-2">
        {active.slugs.map((s, n) => (
          <Button key={s} size="sm" variant={n === i ? "primary" : "secondary"} onClick={() => setI(n)} aria-current={n === i}>
            {active.passed[s] ? <CheckCircle2 className="h-3.5 w-3.5" aria-label="Passed" /> : <Circle className="h-3.5 w-3.5" aria-hidden />} Problem {n + 1}
          </Button>
        ))}
        <span className="ml-auto" data-help="py-assess-timer" role="timer" aria-label={`${Math.floor(left / 60)} minutes left`}>
          <Badge tone={left < 300 ? "warn" : "neutral"} className="px-3 py-1 font-mono text-base font-bold"><Timer className="h-4 w-4" aria-hidden /> {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</Badge>
        </span>
        <Button size="sm" variant="danger" onClick={() => { if (confirm("Finish the assessment now?")) onFinish(); }}>Finish</Button>
        </div>
      </div>
      {!ex ? <Skeleton className="h-96" /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <article key={slug} className="min-w-0 animate-fade-in">
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-surface-soft px-2 py-0.5 font-mono text-xs text-ink-muted">{ex.code}</span><h2 className="font-display text-xl font-bold text-ink">{ex.title}</h2><Difficulty level={ex.difficulty} /></div>
            <Markdown source={body} className="mt-3 text-sm" />
          </article>
          <div className="min-w-0 space-y-3">
            <Card pad="none" className="overflow-hidden">
              <Suspense fallback={<Skeleton className="h-[380px] rounded-none" />}>
                <CodeEditor value={code} onChange={(v) => { setCode(v); write(CODE(slug), v); }} onRun={check} height={380} label="Python editor" language="python" />
              </Suspense>
              <div className="flex items-center gap-2 border-t border-surface-border px-4 py-3">
                <Button onClick={check} disabled={busy} data-help="py-assess-check">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />} Check</Button>
                <span className="text-xs text-ink-faint">{active.checks[slug] ?? 0} check{(active.checks[slug] ?? 0) === 1 ? "" : "s"} · ⌘/Ctrl+Enter · stops after {LIMITS.seconds} s</span>
                <HelpTooltip id="visible-vs-hidden-tests" label="What are visible and hidden tests?" />
              </div>
            </Card>
            {msg && (
              <div role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-success-dim text-success" : msg.kind === "limit" ? "bg-warn-dim text-warn" : "bg-danger-dim text-danger"}`}>
                <p className="font-medium">{msg.kind === "limit" ? "Resource limit: " : ""}{msg.text}</p>
                {(msg.visible || msg.hidden) && (
                  <ul className="mt-1 space-y-0.5 text-xs" aria-label="Test results">
                    {msg.visible && <li>Visible examples: {msg.visible[0]} of {msg.visible[1]} passed</li>}
                    {msg.hidden && <li>Hidden edge cases: {msg.hidden[0]} of {msg.hidden[1]} passed (their inputs stay hidden until you finish)</li>}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProblemLog({ log }: { log: CheckLog[] }) {
  const st = problemStats(log);
  return (
    <details className="basis-full pl-6 text-xs text-ink-muted">
      <summary className="cursor-pointer">Submission history{st.checksToPass ? ` · passed on check ${st.checksToPass}` : " · never passed"}{st.limitHits ? ` · ${st.limitHits} limit hit${st.limitHits === 1 ? "" : "s"}` : ""}</summary>
      <ol className="mt-1 space-y-0.5">
        {log.map((c, n) => (
          <li key={n} className="tabular-nums">Check {n + 1} at {Math.floor(c.at / 60)}:{String(c.at % 60).padStart(2, "0")}: {c.ok ? "passed" : c.kind === "limit" ? "stopped by a limit" : c.kind === "error" ? "error" : "failed"}
            {c.visible ? ` · visible ${c.visible[0]}/${c.visible[1]}` : ""}{c.hidden ? ` · hidden ${c.hidden[0]}/${c.hidden[1]}` : ""}</li>
        ))}
      </ol>
    </details>
  );
}

function AssessmentStatsRow({ history }: { history: AssessmentResult[] }) {
  const st = assessmentStats(history);
  return (
    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" aria-label="Assessment statistics">
      {[["Taken", String(st.taken)], ["Average score", `${st.averageScore}%`], ["Best score", `${st.bestScore}%`], ["Checks per solve", st.checksPerSolve != null ? String(st.checksPerSolve) : "—"]].map(([k, v]) => (
        <div key={k} className="rounded-lg bg-surface-overlay px-2 py-1.5"><dt className="text-ink-faint">{k}</dt><dd className="font-semibold tabular-nums text-ink">{v}</dd></div>
      ))}
    </dl>
  );
}
