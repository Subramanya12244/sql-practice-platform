import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle, Lightbulb, Loader2, Play, Table2 } from "lucide-react";
import { registerDataset, runQuery } from "../../lib/browserDb";
import { runPython } from "../../lib/pyRunner";
import { runPythonTask, runSqlTask, type PythonTask, type SqlTask } from "../../lib/tasks";
import { profileSql, qualityScore, readProfile, type GuidedExercise, type ProfileResult } from "../../lib/lab/guided";
import { Badge, Button, Skeleton } from "../ui";

const CodeEditor = lazy(() => import("../CodeEditor"));
type Done = Record<string, { at: string; checks: number }>;
const read = (k: string): Done => { try { return JSON.parse(localStorage.getItem(k) ?? "{}") as Done; } catch { return {}; } };
const write = (k: string, v: Done) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: progress is kept for this visit only */ } };
const tablesOf = (e: GuidedExercise) => e.inputs.map((i) => i.match(/^(\w+)\(/)?.[1]).filter((x): x is string => Boolean(x));

function Result({ r }: { r: { columns: string[]; rows: unknown[][] } }) {
  return (
    <div className="max-h-56 overflow-auto rounded-lg border border-surface-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-overlay text-ink-faint"><tr>{r.columns.map((c) => <th key={c} scope="col" className="px-2 py-1 font-medium">{c}</th>)}</tr></thead>
        <tbody>{r.rows.slice(0, 50).map((row, i) => <tr key={i} className="border-t border-surface-border">{row.map((v, j) => <td key={j} className="px-2 py-1 font-mono text-ink">{v === null ? <span className="text-ink-faint">null</span> : String(v)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Brief, editor, run/check, hints, explanation and (for the quality lab) a before/after quality score. */
export function GuidedWorkspace({ items, storageKey, groupBy }: { items: GuidedExercise[]; storageKey: string; groupBy: "dimension" | "level" }) {
  const [params, setParams] = useSearchParams();
  const [done, setDone] = useState<Done>({});
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setDone(read(storageKey)); setMounted(true); }, [storageKey]);
  // ?e= selects an exercise. It is read after hydration (like the other query-driven pages): the prerendered HTML has no
  // query string, so choosing from the URL during the first render would not match it and React would report a mismatch.
  // Links, back and forward still work: every change to the query updates `wanted` through the effect.
  const [wanted, setWanted] = useState<string | null>(null);
  useEffect(() => { setWanted(params.get("e")); }, [params]);
  const current = items.find((i) => i.id === wanted) ?? items[0];
  const groups = useMemo(() => {
    const m = new Map<string, GuidedExercise[]>();
    for (const i of items) m.set((groupBy === "dimension" ? i.dimension : i.level) ?? "Other", [...(m.get((groupBy === "dimension" ? i.dimension : i.level) ?? "Other") ?? []), i]);
    return [...m.entries()];
  }, [items, groupBy]);
  const doneCount = items.filter((i) => done[i.id]).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Exercises" className="space-y-3">
        <p className="text-xs text-ink-muted" aria-live="polite">{mounted ? `${doneCount} of ${items.length} completed` : ""}</p>
        {groups.map(([g, list]) => (
          <div key={g}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{g}</p>
            <ul className="mt-1 space-y-1">
              {list.map((i) => (
                <li key={i.id}><button type="button" onClick={() => setParams({ e: i.id })} aria-current={i.id === current.id} className={`flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left text-sm ${i.id === current.id ? "border-accent bg-accent-dim text-ink" : "border-surface-border text-ink-muted hover:border-accent"}`}>
                  {mounted && done[i.id] ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Completed" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />}<span>{i.title}</span>
                </button></li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <ExerciseView key={current.id} e={current} passed={Boolean(done[current.id])} onPass={(checks) => { const next = { ...done, [current.id]: { at: new Date().toISOString(), checks } }; setDone(next); write(storageKey, next); }} />
    </div>
  );
}

function ExerciseView({ e, passed, onPass }: { e: GuidedExercise; passed: boolean; onPass: (checks: number) => void }) {
  const isSql = e.task.type === "sql";
  const dataset = `guided-${e.id}`;
  const [code, setCode] = useState(e.task.starter);
  const [hints, setHints] = useState(0);
  const [busy, setBusy] = useState<null | "run" | "check">(null);
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [stdout, setStdout] = useState<string | null>(null);
  const [score, setScore] = useState<{ before: ProfileResult; after?: ProfileResult } | null>(null);
  const [checks, setChecks] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isSql) return;
    registerDataset({ id: dataset, sql: e.setup });
    if (e.profile) void runQuery(profileSql(e.profile.before), dataset).then((r) => { if (r.success && r.rows[0]) setScore({ before: readProfile(r.rows[0]) }); });
  }, [e, dataset, isSql]);

  const q = (sql: string) => runQuery(sql, dataset);
  async function look(table: string) {
    setBusy("run"); setOut(null); setStdout(null);
    const r = await q(`SELECT * FROM ${table} LIMIT 20`);
    setPreview(r.success ? { columns: r.columns, rows: r.rows } : null);
    if (!r.success) setOut({ ok: false, text: r.message ?? "Could not read that table." });
    setBusy(null);
  }
  async function run() {
    setBusy("run"); setOut(null); setPreview(null); setStdout(null);
    if (isSql) {
      const r = await q(code);
      if (r.success) setPreview({ columns: r.columns, rows: r.rows });
      else setOut({ ok: false, text: friendly(r.message) });
    } else {
      const r = await runPython(code);
      setStdout(r.ok ? (r.stdout || "(no output)") : `${r.stdout ? r.stdout + "\n" : ""}${(r.error ?? "").split("\n").slice(-3).join("\n")}`);
    }
    setBusy(null);
  }
  async function check() {
    setBusy("check"); setOut(null);
    const n = checks + 1; setChecks(n);
    const r = isSql ? await runSqlTask(e.task as SqlTask, code, q) : await runPythonTask(e.task as PythonTask, code, runPython);
    setOut({ ok: r.ok, text: r.ok ? "All checks passed." : friendly(r.message) });
    if (r.ok) {
      onPass(n);
      if (isSql && e.profile) {
        const a = await q(`${code.trim().replace(/;?\s*$/, ";")}\n${profileSql(e.profile.after)}`);
        if (a.success && a.rows[0]) setScore((s) => (s ? { ...s, after: readProfile(a.rows[0]) } : s));
      }
    }
    setBusy(null);
  }

  const before = score ? qualityScore(score.before) : null, after = score?.after ? qualityScore(score.after) : null;
  return (
    <article className="min-w-0 space-y-4" aria-label={e.title}>
      <header>
        <p className="flex flex-wrap items-center gap-2 text-xs"><Badge tone="accent">{e.level}</Badge>{e.dimension && <Badge>{e.dimension}</Badge>}<Badge>{isSql ? "SQL" : "Python"}</Badge>{passed && <span className="inline-flex items-center gap-1 font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Completed</span>}</p>
        <h2 className="mt-1 font-display text-xl font-bold text-ink">{e.title}</h2>
        <p className="mt-1 text-sm text-ink-muted"><span className="font-medium text-ink">Context. </span>{e.context}</p>
      </header>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <section aria-label="Requirements"><h3 className="font-semibold text-ink">Requirements</h3><ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{e.requirements.map((r) => <li key={r}>{r}</li>)}</ul></section>
        <section aria-label="Input data"><h3 className="font-semibold text-ink">Input</h3><ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{e.inputs.map((r) => <li key={r}>{r}</li>)}</ul>
          {isSql && <p className="mt-1 flex flex-wrap gap-1.5">{tablesOf(e).map((t) => <button key={t} type="button" onClick={() => void look(t)} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2 py-0.5 font-mono text-xs text-ink hover:border-accent"><Table2 className="h-3 w-3" aria-hidden />{t}</button>)}</p>}</section>
        <section aria-label="Expected output"><h3 className="font-semibold text-ink">Expected</h3><p className="mt-1 text-ink-muted">{e.expected}</p></section>
        <section aria-label="Constraints and evaluation"><h3 className="font-semibold text-ink">Constraints</h3><ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{e.constraints.map((r) => <li key={r}>{r}</li>)}</ul><h3 className="mt-2 font-semibold text-ink">How it is judged</h3><ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{e.criteria.map((r) => <li key={r}>{r}</li>)}</ul></section>
      </div>

      <div>
        {!mounted ? <Skeleton className="h-[260px]" /> : <Suspense fallback={<Skeleton className="h-[260px]" />}><CodeEditor value={code} onChange={setCode} onRun={run} height={260} label={`${e.title} editor`} language={isSql ? "sql" : "python"} /></Suspense>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void run()} disabled={busy !== null}>{busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Run</Button>
          <Button onClick={() => void check()} disabled={busy !== null}>{busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Check my answer</Button>
          <button type="button" onClick={() => setCode(e.task.starter)} className="text-xs text-ink-muted hover:text-ink">Reset code</button>
        </div>
        {isSql && <p className="mt-1 text-xs text-ink-faint">Run shows the result of your last statement and rolls everything back, so the data resets each time.</p>}
      </div>

      {out && <p role="status" className={`rounded-lg px-3 py-2 text-sm font-medium ${out.ok ? "bg-success-dim text-success" : "bg-danger-dim text-danger"}`}>{out.text}</p>}
      {preview && <Result r={preview} />}
      {stdout !== null && <pre tabIndex={0} className="max-h-48 overflow-auto rounded-lg bg-surface-soft p-2 font-mono text-xs text-ink">{stdout}</pre>}

      {before && (
        <section aria-label="Data quality score" className="rounded-card border border-surface-border bg-surface-raised p-3">
          <h3 className="text-sm font-semibold text-ink">Data quality score</h3>
          <p className="text-xs text-ink-muted">Half completeness (filled-in cells), half uniqueness (rows that are not repeats), measured on the columns this exercise changes.</p>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-ink-faint">Before (raw data)</dt><dd className="text-2xl font-bold tabular-nums text-ink">{before.score}<span className="text-sm font-normal text-ink-faint"> / 100</span></dd><dd className="text-xs text-ink-muted">{before.completeness}% complete · {before.uniqueness}% unique</dd></div>
            <div><dt className="text-xs text-ink-faint">After (your result)</dt><dd className="text-2xl font-bold tabular-nums text-ink">{after ? after.score : "—"}<span className="text-sm font-normal text-ink-faint"> / 100</span></dd><dd className="text-xs text-ink-muted">{after ? `${after.completeness}% complete · ${after.uniqueness}% unique` : "Pass the check to see it."}</dd></div>
          </dl>
        </section>
      )}

      <section aria-label="Hints">
        {e.hints.slice(0, hints).map((h, i) => <p key={i} className="mb-1 rounded-lg bg-surface-overlay px-3 py-2 text-sm text-ink"><Lightbulb className="mr-1.5 inline h-3.5 w-3.5 text-warn" aria-hidden />{h}</p>)}
        {hints < e.hints.length && <button type="button" onClick={() => setHints(hints + 1)} className="text-sm font-medium text-accent hover:underline">Show hint {hints + 1} of {e.hints.length}</button>}
      </section>

      {passed && <section aria-label="Explanation" className="rounded-card border border-success/30 bg-success-dim p-3 text-sm text-ink"><h3 className="font-semibold">Why this works</h3><p className="mt-1">{e.explanation}</p></section>}
      {!passed && <p className="text-xs text-ink-faint">{checks >= 3 ? <button type="button" onClick={() => setShowSolution((v) => !v)} className="text-accent hover:underline">{showSolution ? "Hide" : "Show"} a worked solution</button> : "A worked solution unlocks after three checks."}</p>}
      {!passed && showSolution && <pre tabIndex={0} className="max-h-60 overflow-auto rounded-lg bg-surface-soft p-2 font-mono text-xs text-ink">{e.task.solution}</pre>}
      <p className="text-xs text-ink-faint">Your progress is saved on this device. <Link to="/data-engineering" className="text-accent hover:underline">More data engineering</Link></p>
    </article>
  );
}

/** Turn a database error into one calm sentence plus the original detail. */
function friendly(msg: string | null | undefined): string {
  const m = msg ?? "Something went wrong.";
  if (/relation "([^"]+)" does not exist/.test(m)) return `The table ${m.match(/relation "([^"]+)"/)![1]} does not exist yet. ${/^Expected/.test(m) ? "" : "Create it with CREATE TABLE ... AS SELECT first."}`;
  if (/syntax error/.test(m)) return `SQL syntax error: ${m.replace(/^ERROR:\s*/, "")}`;
  return m;
}
