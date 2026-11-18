import { Suspense, lazy, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Circle, Eye, Lightbulb, Loader2, Play, RotateCcw, Sparkles } from "lucide-react";
import { Badge, Button, Card, ProgressBar, Skeleton } from "../ui";
import { Markdown, InlineMarkdown } from "../Markdown";
import { SampleTable } from "../SampleTable";
import type { Block, Check as CheckQ, Exercise } from "../../lib/daily";
import { firstDifference, renderResultText, sameOutput } from "../../lib/daily";
import { checkScore, completionOf, masteryOf, withCheckResult, withId, type DayRecord } from "../../lib/dailyProgress";
import type { DayExtras } from "../../lib/daily";
import { completeExercise, scheduleDayReview, updateDay } from "../../lib/progress";
import { classifyPyMistake } from "../../lib/mistakes";
import { SOLUTION_LOCKED_NOTE, canRevealSolution, recordDailyCheck, trackDailyRun } from "../../lib/dailyExercise";
import { dailyEmbedDecision } from "../../workspace/dailyPort";
import { EmbeddedDailyExercise } from "./EmbeddedDailyExercise";
import { useDraftSaver } from "./useDraftSaver";
import { explainError } from "../../lib/errorHelp";
import { friendlyPyError } from "../../lib/pyErrors";
import { track } from "../../lib/activity";
import { LessonVisual } from "../visual/LessonVisual";
import { runPython, PY_TIMEOUT_MS } from "../../lib/pyRunner";
import { runQuery, submitQuery } from "../../lib/browserDb";

const CodeEditor = lazy(() => import("../CodeEditor"));
const fence = (lang: string, code: string) => `\`\`\`${lang}\n${code}\n\`\`\``;

interface RunOutput {
  ok: boolean;
  /** Plain text (Python stdout, error message, or the SQL result rendered as text). */
  text: string;
  columns?: string[];
  rows?: unknown[][];
  ms?: number;
}

async function execute(lang: "python" | "sql", code: string, stdin?: string): Promise<RunOutput> {
  if (lang === "python") {
    const r = await runPython(code, undefined, PY_TIMEOUT_MS, stdin ? `${stdin}\n` : "");
    return { ok: r.ok, text: r.ok ? r.stdout : [r.stdout, r.error].filter(Boolean).join("\n"), ms: r.ms };
  }
  const r = await runQuery(code);
  return r.success
    ? { ok: true, text: renderResultText(r.columns, r.rows), columns: r.columns, rows: r.rows, ms: r.execution_time_ms ?? undefined }
    : { ok: false, text: r.message ?? "The query failed." };
}

function Editor({ value, onChange, onRun, lang, height = 200, label }: { value: string; onChange: (v: string) => void; onRun: () => void; lang: "python" | "sql"; height?: number; label: string }) {
  return (
    <Suspense fallback={<Skeleton className="w-full" shimmer />}>
      <CodeEditor value={value} onChange={onChange} onRun={onRun} height={height} language={lang} label={label} />
    </Suspense>
  );
}

function OutputPane({ out, busy, lang }: { out: RunOutput | null; busy: boolean; lang: "python" | "sql" }) {
  if (busy) return <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Running{lang === "python" ? " (the first Python run downloads the interpreter, about 10 MB)" : ""}…</p>;
  if (!out) return null;
  if (!out.ok) {
    const sql = lang === "sql" ? explainError(out.text) : null;
    return (
      <div className="space-y-2">
        <pre role="alert" className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-danger/40 bg-danger-dim p-3 text-xs text-danger">{lang === "python" ? friendlyPyError(out.text) : out.text}</pre>
        {sql && <p className="rounded-lg border border-warn/40 bg-warn-dim px-3 py-2 text-sm text-ink" data-testid="error-help"><span className="font-semibold">{sql.title}.</span> <span className="text-ink-muted"><InlineMarkdown source={sql.fix} /></span></p>}
      </div>
    );
  }
  if (out.columns) return out.rows?.length ? <SampleTable columns={out.columns} rows={out.rows} max={30} /> : <p className="text-sm text-ink-muted">The query ran and returned no rows.</p>;
  return <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-surface-border bg-surface-soft p-3 font-mono text-xs text-ink">{out.text || "(no output)"}</pre>;
}

/** Expected output beside the learner's own, with the first line that differs marked. Shown only after a check that ran but did not match. */
function OutputDiff({ expected, actual }: { expected: string; actual: string }) {
  const d = firstDifference(expected, actual);
  if (!d) return null;
  const show = (v: string | null) => (v === null ? "(no line)" : v === "" ? "(empty line)" : v);
  return (
    <div className="mt-2 space-y-2 text-xs" data-testid="output-diff">
      <p className="text-ink-muted">First difference on line {d.line}: expected <code className="rounded bg-surface-soft px-1 font-mono text-ink">{show(d.expected)}</code>, got <code className="rounded bg-surface-soft px-1 font-mono text-ink">{show(d.actual)}</code>.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {([["Expected", expected], ["Yours", actual]] as const).map(([label, text]) => (
          <div key={label}>
            <p className="mb-1 font-semibold text-ink">{label}</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-surface-border bg-surface-soft p-2 font-mono text-ink">{text || "(no output)"}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Worked example ───────────────────────────────────────────────────────
type ExampleBlock = Extract<Block, { kind: "example" }>;

/** Runs in the browser when it can (Python and SQL); otherwise shows the code and its verified output with a note to run it on your computer. */
export function ExampleRunner({ dayId, ex, done }: { dayId: string; ex: ExampleBlock; done: boolean }) {
  return ex.browser ? <BrowserExample dayId={dayId} ex={ex} done={done} /> : <LocalExample ex={ex} />;
}

function LocalExample({ ex }: { ex: ExampleBlock }) {
  return (
    <Card className="space-y-3" aria-label={`Example: ${ex.title}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-ink">{ex.title}</h4>
        <Badge tone="secondary">Run on your computer</Badge>
      </div>
      <Markdown source={fence(ex.lang, ex.code)} />
      <p className="text-xs text-ink-muted">
        {ex.lang === "bash" ? "Run these commands in a terminal." : "This example uses packages the browser cannot run."} The output below was produced by running exactly this code.
        See the environment note at the top of the day for what to install.
      </p>
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Output</p><Markdown source={fence("text", ex.output)} /></div>
    </Card>
  );
}

function BrowserExample({ dayId, ex, done }: { dayId: string; ex: ExampleBlock; done: boolean }) {
  const lang = ex.lang as "python" | "sql";
  const [code, setCode] = useState(ex.code);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<RunOutput | null>(null);
  const [showExpected, setShowExpected] = useState(false);
  const match = out?.ok ? sameOutput(out.text, ex.output) : null;

  async function run() {
    setBusy(true);
    const r = await execute(lang, code, ex.stdin);
    setBusy(false);
    setOut(r);
    track(lang === "python" ? "python_executed" : "sql_executed", `daily:${dayId}:${ex.id}`);
    if (r.ok && code === ex.code && sameOutput(r.text, ex.output)) updateDay(dayId, (rec) => ({ ...rec, examples: withId(rec.examples, ex.id) }));
  }

  return (
    <Card className="space-y-3" aria-label={`Example: ${ex.title}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-ink">{ex.title}</h4>
        {done && <Badge tone="success"><Check className="h-3 w-3" aria-hidden /> Run and matched</Badge>}
      </div>
      <Editor value={code} onChange={setCode} onRun={run} lang={lang} height={Math.min(320, 48 + code.split("\n").length * 20)} label={`Code for ${ex.title}`} />
      {ex.stdin !== undefined && <p className="text-xs text-ink-faint">Input given to the program: <code className="rounded bg-surface-soft px-1">{ex.stdin}</code></p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={run} disabled={busy}><Play className="h-4 w-4" aria-hidden /> Run</Button>
        <Button size="sm" variant="ghost" onClick={() => { setCode(ex.code); setOut(null); }} disabled={code === ex.code && !out}><RotateCcw className="h-4 w-4" aria-hidden /> Reset</Button>
        <Button size="sm" variant="ghost" onClick={() => setShowExpected((v) => !v)} aria-expanded={showExpected}><Eye className="h-4 w-4" aria-hidden /> {showExpected ? "Hide" : "Show"} expected output</Button>
      </div>
      <OutputPane out={out} busy={busy} lang={lang} />
      <LessonVisual lang={lang} code={code} stdin={ex.stdin} />
      {match !== null && !busy && (
        <p className={`text-sm font-medium ${match ? "text-success" : "text-ink-muted"}`}>{match ? "Matches the expected output." : code === ex.code ? "The output differs from the expected output shown below. Your environment may differ; check the expected output." : "Output differs from the lesson's version, which is fine when you have changed the code."}</p>
      )}
      <div className="collapse-grid" data-open={showExpected ? "true" : "false"}><div><Markdown source={fence("text", ex.output)} /></div></div>
    </Card>
  );
}

// ── Exercise ─────────────────────────────────────────────────────────────
/**
 * One exercise of a lesson. Written exercises keep their self-assessed card. A graded exercise the unified workspace can really run
 * (see `dailyEmbedDecision`) is shown as the embedded workspace; one it cannot run keeps the in-page runner. Both write the same
 * store records through lib/dailyExercise.ts.
 */
export function ExerciseRunner(props: { dayId: string; ex: Exercise; guided: boolean; rec: DayRecord | undefined; index: number; /** Force the in-page runner (parity tests). */ legacy?: boolean }) {
  const { legacy, ...p } = props;
  if (p.ex.kind === "written") return <WrittenExercise {...p} />;
  const decision = legacy ? null : dailyEmbedDecision(p.dayId, p.ex, p.guided ? "guided" : "independent");
  if (!decision?.embed) return <GradedExercise {...p} />;
  return <EmbeddedDailyExercise {...p} decision={decision} fallback={<GradedExercise {...p} />} />;
}

/** Self-assessed exercise for work the browser cannot run (a chart, a spreadsheet, a dashboard). The learner compares their work with the model answer and ticks the rubric. */
function WrittenExercise({ dayId, ex, guided, rec, index }: { dayId: string; ex: Exercise; guided: boolean; rec: DayRecord | undefined; index: number }) {
  const saved = rec?.drafts?.[ex.id] ?? "";
  const [text, setText] = useState(saved);
  const [ticked, setTicked] = useState<boolean[]>(() => (ex.rubric ?? []).map(() => false));
  const [model, setModel] = useState(false);
  const done = !!rec?.passed?.includes(ex.id);
  useDraftSaver(dayId, ex.id, text, saved);
  const allTicked = ticked.every(Boolean);
  function finish() {
    updateDay(dayId, (r) => ({ ...r, attempted: withId(r.attempted, ex.id), passed: withId(r.passed, ex.id) }), true);
    completeExercise(`daily:${dayId}#${ex.id}`);
  }
  return (
    <Card className="space-y-3" aria-label={`Exercise ${index + 1}: ${ex.title}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-ink"><span className="text-ink-faint">{guided ? "Guided" : "Independent"} {index + 1}.</span> {ex.title}</h4>
        <span className="flex items-center gap-1.5"><Badge tone="secondary">Self-assessed</Badge>{ex.required === false && <Badge>Optional stretch</Badge>}{done ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden /> Done</Badge> : <Badge>Not started</Badge>}</span>
      </div>
      <Markdown source={ex.prompt} />
      <label className="block text-sm font-medium text-ink">Your answer or notes
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className="mt-1 w-full rounded-lg border border-surface-border bg-surface-soft p-2 font-mono text-sm text-ink" placeholder={ex.starter} />
      </label>
      <Button size="sm" variant="ghost" onClick={() => setModel((v) => !v)} aria-expanded={model}><Eye className="h-4 w-4" aria-hidden /> {model ? "Hide" : "Show"} the model answer</Button>
      {model && <div className="rounded-xl border border-surface-border bg-surface-soft p-3"><Markdown source={ex.solution} /></div>}
      {ex.rubric && (
        <fieldset className="space-y-1.5"><legend className="text-sm font-semibold text-ink">Check your work against the model answer</legend>
          {ex.rubric.map((r, i) => (
            <label key={i} className="flex cursor-pointer items-start gap-2 text-sm text-ink-muted"><input type="checkbox" className="mt-1" checked={ticked[i]} onChange={(e) => setTicked((t) => t.map((v, j) => (j === i ? e.target.checked : v)))} /> <span>{r}</span></label>
          ))}
        </fieldset>
      )}
      <Button size="sm" onClick={finish} disabled={!allTicked || done}><Check className="h-4 w-4" aria-hidden /> {done ? "Marked done" : "Mark as done"}</Button>
      {!allTicked && !done && <p className="text-xs text-ink-faint">Tick every item once your work meets it. This exercise is not graded automatically.</p>}
    </Card>
  );
}

function GradedExercise({ dayId, ex, guided, rec, index }: { dayId: string; ex: Exercise; guided: boolean; rec: DayRecord | undefined; index: number }) {
  const kind = ex.kind as "python" | "sql";
  const saved = rec?.drafts?.[ex.id];
  const [code, setCode] = useState(saved ?? ex.starter);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<RunOutput | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; message: string; details: string[] } | null>(null);
  const [hints, setHints] = useState(0);
  const [fails, setFails] = useState(0);
  const [solution, setSolution] = useState(false);
  const passed = !!rec?.passed?.includes(ex.id);
  const attempted = passed || !!rec?.attempted?.includes(ex.id);
  const optional = ex.required === false;
  const canReveal = canRevealSolution({ passed, fails, guided, hintsOpened: hints, hintsTotal: ex.hints?.length ?? 0 });

  // Save the learner's code a moment after they stop typing, so they can continue later.
  useDraftSaver(dayId, ex.id, code, saved ?? ex.starter);

  async function run() {
    setBusy(true);
    setVerdict(null);
    const r = await execute(kind, code, ex.stdin);
    setBusy(false);
    setOut(r);
    trackDailyRun(kind, dayId, ex.id);
  }

  async function check() {
    setBusy(true);
    let ok = false;
    let message = "";
    let details: string[] = [];
    let errorText = ""; // runtime error text, used only to pick a SQL mistake category (never stored)
    let pyCategory = "wrong-output"; // the program ran but printed the wrong thing, unless it crashed (see below)
    if (kind === "python") {
      const r = await execute("python", code, ex.stdin);
      setOut(r);
      ok = r.ok && sameOutput(r.text, ex.expected ?? "");
      message = ok ? "Correct. The output matches exactly." : r.ok ? "The program ran, but the output is not what the task asks for." : "The program stopped with an error.";
      if (!r.ok) pyCategory = classifyPyMistake(r.text);
      if (r.ok && !ok) details = ["Compare your output with the expected output line by line (spaces and capital letters count)."];
    } else {
      const r = await submitQuery(code, ex.solution, !!ex.ordered, null);
      ok = r.correct;
      message = r.message || (ok ? "Correct. Your result matches." : "The result does not match yet.");
      details = r.feedback ?? [];
      const shown = await runQuery(code);
      if (!shown.success) errorText = shown.message ?? "";
      setOut(shown.success ? { ok: true, text: renderResultText(shown.columns, shown.rows), columns: shown.columns, rows: shown.rows } : { ok: false, text: shown.message ?? "" });
    }
    setBusy(false);
    setVerdict({ ok, message, details });
    recordDailyCheck({ dayId, exId: ex.id, kind, ok, code, pyCategory, sqlErrorText: errorText });
    if (!ok) setFails((n) => n + 1);
  }

  return (
    <Card className="space-y-3" aria-label={`Exercise ${index + 1}: ${ex.title}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-ink"><span className="text-ink-faint">{guided ? "Guided" : "Independent"} {index + 1}.</span> {ex.title}</h4>
        <span className="flex items-center gap-1.5">
          {optional && <Badge>Optional stretch</Badge>}
          {passed ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden /> Passed</Badge> : attempted ? <Badge tone="accent">Attempted</Badge> : <Badge>Not started</Badge>}
        </span>
      </div>
      <Markdown source={ex.prompt} />
      <Editor value={code} onChange={setCode} onRun={run} lang={kind} height={Math.min(360, 60 + code.split("\n").length * 20)} label={`${ex.title} code`} />
      {saved !== undefined && code === saved && saved !== ex.starter && <p className="text-xs text-ink-faint">Your saved work was restored.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={run} disabled={busy}><Play className="h-4 w-4" aria-hidden /> Run</Button>
        <Button size="sm" onClick={check} disabled={busy}><Check className="h-4 w-4" aria-hidden /> Check answer</Button>
        {guided && ex.hints && (
          <Button size="sm" variant="ghost" onClick={() => setHints((h) => Math.min(ex.hints!.length, h + 1))} disabled={hints >= ex.hints.length}><Lightbulb className="h-4 w-4" aria-hidden /> {hints === 0 ? "Show a hint" : hints < ex.hints.length ? "Next hint" : "No more hints"}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setCode(ex.starter)} disabled={code === ex.starter}><RotateCcw className="h-4 w-4" aria-hidden /> Start over</Button>
      </div>
      {ex.hints && hints > 0 && (
        <ol className="space-y-1.5 rounded-xl border border-accent/30 bg-accent-dim p-3 text-sm text-ink" aria-label="Hints">
          {ex.hints.slice(0, hints).map((h, i) => <li key={i}><span className="font-semibold text-accent">Hint {i + 1}.</span> <span className="text-ink-muted">{h}</span></li>)}
        </ol>
      )}
      <OutputPane out={out} busy={busy} lang={kind} />
      <LessonVisual lang={kind} code={code} stdin={ex.stdin} label="Explain visually"
        ctx={{ topic: ex.title, prompt: ex.prompt, hints: ex.hints?.slice(0, hints), expected: ex.expected,
          run: out ? { ok: out.ok, text: out.text, error: out.ok ? undefined : out.text, columns: out.columns, rowCount: out.rows?.length, rows: out.rows } : undefined,
          verdict: verdict ?? undefined, solution: canReveal && solution ? ex.solution : undefined }} />
      {verdict && (
        <div role="status" className={`rounded-xl border p-3 text-sm ${verdict.ok ? "border-success/40 bg-success-dim text-success" : "border-warn/40 bg-warn-dim text-ink"}`}>
          <p className="flex items-center gap-1.5 font-semibold">{verdict.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <AlertCircle className="h-4 w-4 text-warn" aria-hidden />} {verdict.message}</p>
          {verdict.details.length > 0 && <ul className="mt-1 list-disc pl-5 text-ink-muted">{verdict.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
          {!verdict.ok && kind === "python" && out?.ok && ex.expected !== undefined && <OutputDiff expected={ex.expected} actual={out.text} />}
        </div>
      )}
      {kind === "python" && ex.expected !== undefined && guided && (
        <details className="text-sm"><summary className="cursor-pointer text-ink-muted hover:text-ink">Expected output</summary><div className="mt-2"><Markdown source={fence("text", ex.expected)} /></div></details>
      )}
      {!guided && kind === "python" && ex.expected !== undefined && (
        <details className="text-sm"><summary className="cursor-pointer text-ink-muted hover:text-ink">Expected output</summary><div className="mt-2"><Markdown source={fence("text", ex.expected)} /></div></details>
      )}
      <div className="text-sm">
        {canReveal ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setSolution((v) => !v)} aria-expanded={solution}><Eye className="h-4 w-4" aria-hidden /> {solution ? "Hide" : "Show"} a solution</Button>
            {solution && <div className="mt-2"><Markdown source={fence(kind, ex.solution)} /><p className="text-xs text-ink-faint">Looking at the solution does not pass the exercise. Type your own version and check it.</p></div>}
          </>
        ) : <p className="text-xs text-ink-faint">{SOLUTION_LOCKED_NOTE(guided)}</p>}
      </div>
    </Card>
  );
}

// ── Knowledge check ──────────────────────────────────────────────────────
export function KnowledgeCheck({ dayId, checks, rec }: { dayId: string; checks: CheckQ[]; rec: DayRecord | undefined }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const answered = checks.every((c) => answers[c.id] !== undefined);
  const score = checkScore(answers, checks);
  function submit() {
    setSubmitted(true);
    const now = new Date().toISOString();
    updateDay(dayId, (r) => withCheckResult(r, score, now), true);
    if (rec?.completedAt) scheduleDayReview(dayId, score);
  }
  return (
    <div className="space-y-4">
      {rec?.check && <p className="text-sm text-ink-muted">Best score so far: <strong className="text-ink">{Math.round(rec.check.best * 100)}%</strong>. Latest: {Math.round(rec.check.last * 100)}%. You can retake the check at any time; your best score is kept.</p>}
      {checks.map((c, qi) => {
        const picked = answers[c.id];
        return (
          <Card key={c.id} className="space-y-2">
            <p className="font-medium text-ink"><span className="text-ink-faint">{qi + 1}.</span> <Markdown source={c.question} className="inline" /></p>
            <div role="radiogroup" aria-label={`Question ${qi + 1}`} className="space-y-1.5">
              {c.options.map((o, oi) => {
                const right = submitted && oi === c.answer;
                const wrong = submitted && picked === oi && oi !== c.answer;
                return (
                  <label key={oi} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors duration-fast ${right ? "border-success bg-success-dim" : wrong ? "border-danger bg-danger-dim" : picked === oi ? "border-accent bg-accent-dim" : "border-surface-border hover:border-accent/40"}`}>
                    <input type="radio" name={`${dayId}-${c.id}`} className="mt-1" checked={picked === oi} disabled={submitted} onChange={() => setAnswers((a) => ({ ...a, [c.id]: oi }))} />
                    <span className="text-ink">{o}</span>
                  </label>
                );
              })}
            </div>
            {submitted && <div className="rounded-lg bg-surface-soft p-2 text-sm text-ink-muted"><strong className={picked === c.answer ? "text-success" : "text-danger"}>{picked === c.answer ? "Correct. " : "Not quite. "}</strong>{c.explanation}</div>}
          </Card>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        {!submitted ? <Button onClick={submit} disabled={!answered}>Submit answers</Button> : <Button variant="secondary" onClick={() => { setAnswers({}); setSubmitted(false); }}><RotateCcw className="h-4 w-4" aria-hidden /> Retake</Button>}
        {!submitted && !answered && <span className="text-xs text-ink-faint">Answer every question to submit.</span>}
        {submitted && <span className="text-sm font-semibold text-ink" role="status">Score: {Math.round(score * 100)}% ({checks.filter((c) => answers[c.id] === c.answer).length} of {checks.length})</span>}
      </div>
    </div>
  );
}

// ── Complete the day ─────────────────────────────────────────────────────
function Burst() {
  const colors = ["bg-accent", "bg-success", "bg-secondary", "bg-warn"];
  return (
    <span className="df-burst pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        const r = 56 + (i % 3) * 14;
        return <span key={i} className={colors[i % 4]} style={{ ["--dx" as string]: `${Math.cos(a) * r}px`, ["--dy" as string]: `${Math.sin(a) * r}px`, animationDelay: `${(i % 4) * 30}ms` }} />;
      })}
    </span>
  );
}

export function CompletePanel({ dayId, extras, rec, nextHref, nextLabel }: { dayId: string; extras: DayExtras; rec: DayRecord | undefined; nextHref?: string; nextLabel?: string }) {
  const c = completionOf(rec, extras);
  const m = masteryOf(rec, extras);
  const [burst, setBurst] = useState(false);
  const done = !!rec?.completedAt;
  function complete() {
    if (!c.complete) return;
    updateDay(dayId, (r) => ({ ...r, completedAt: r.completedAt ?? new Date().toISOString() }), true);
    scheduleDayReview(dayId, rec?.check?.best ?? 0);
    track("lesson_completed", `daily:${dayId}`);
    setBurst(true);
  }
  const item = (ok: boolean, text: string) => (
    <li className="flex items-start gap-2 text-sm">{ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />}<span className={ok ? "text-ink-muted" : "text-ink"}>{text}</span></li>
  );
  return (
    <div className="space-y-4">
      <Card className="relative">
        {burst && <Burst />}
        <h3 className="font-display text-lg font-bold text-ink">{done ? "This day is complete" : "Complete this day"}</h3>
        <p className="mt-1 text-sm text-ink-muted">A day is complete when the required work is done. Opening it is not enough.</p>
        <ul className="mt-3 space-y-1.5" aria-label="Completion requirements">
          {item(c.theory, "Theory read to the end")}
          {item(c.guided.done === c.guided.total, `Guided exercises passed: ${c.guided.done} of ${c.guided.total}`)}
          {item(c.independent.attempted === c.independent.total, `Independent exercises attempted: ${c.independent.attempted} of ${c.independent.total}`)}
          {item(c.check.ok, c.check.score === null ? "Knowledge check taken (60% to pass)" : `Knowledge check: best ${Math.round(c.check.score * 100)}% (60% to pass)`)}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {done ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden /> Completed {rec!.completedAt!.slice(0, 10)}</Badge> : <Button size="lg" disabled={!c.complete} onClick={complete}><CheckCircle2 className="h-5 w-5" aria-hidden /> Complete day</Button>}
          {!done && !c.complete && <span className="text-xs text-ink-faint">Still to do: {c.missing.join("; ")}.</span>}
          {nextHref && done && <a href={nextHref} className="font-semibold text-accent hover:underline">{nextLabel} →</a>}
        </div>
      </Card>
      <Card>
        <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink"><Sparkles className="h-4 w-4 text-secondary" aria-hidden /> Mastery <Badge tone={m.mastered ? "success" : "neutral"}>{m.mastered ? "Mastered" : "Not yet"}</Badge></h3>
        <p className="mt-1 text-sm text-ink-muted">Mastery is separate from completion. It shows how securely you know the day, and you can earn it later.</p>
        <ul className="mt-3 space-y-1.5">
          {item(m.checkOk, "Knowledge check 80% or higher")}
          {item(m.independentPassed.done === m.independentPassed.total, `Every independent exercise passed: ${m.independentPassed.done} of ${m.independentPassed.total} (including optional ones)`)}
          {item(m.revised, "Revision task done (mark it in the Daily review step)")}
        </ul>
        <ProgressBar className="mt-3" value={[m.checkOk, m.independentPassed.done === m.independentPassed.total, m.revised].filter(Boolean).length} max={3} label="Mastery" tone="secondary" />
      </Card>
    </div>
  );
}
