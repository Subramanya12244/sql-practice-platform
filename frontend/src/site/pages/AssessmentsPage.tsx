import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, ClipboardCheck, Loader2, Play, Save, Timer, Trophy, XCircle } from "lucide-react";
import { Button, Card, Container, Difficulty, EmptyState, PageHeader, Skeleton } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { Seo } from "../lib/seo";
import { useAuth } from "../lib/auth";
import { accountsEnabled, getSupabase } from "../lib/supabase";
import { runQuery } from "../lib/browserDb";
import { runPython } from "../lib/pyRunner";
import { pyCasesProgram, pyFingerprints, readCases, sqlFingerprint, type AttemptResult, type PublicItem } from "../lib/assessment";
import { track } from "../lib/activity";

const CodeEditor = lazy(() => import("../components/CodeEditor"));
const ACTIVE = "sqlp.assess.active";
const CODE = (attempt: string, item: string) => `sqlp.assess.${attempt}.${item}`;
const INPUT = "max-w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink";
const read = <T,>(k: string, f: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : f; } catch { return f; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

interface Started { id: string; started_at: string; deadline: string; items: PublicItem[] }
interface AttemptRow { id: string; config: { kind: string; difficulty?: string; topic?: string; minutes: number }; started_at: string; submitted_at: string | null; score: number | null; total: number; deadline: string }

export function AssessmentsPage() {
  const { session, ready } = useAuth();
  const [catalog, setCatalog] = useState<{ id: string; kind: string; topic: string; difficulty: string }[]>([]);
  const [active, setActive] = useState<Started | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [history, setHistory] = useState<AttemptRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState({ kind: "sql", difficulty: "", topic: "", count: 5, minutes: 30 });

  const loadHistory = useCallback(async () => {
    const sb = await getSupabase();
    const { data } = await sb.from("assessment_attempts").select("id, config, started_at, submitted_at, score, total, deadline").order("started_at", { ascending: false }).limit(20);
    setHistory((data ?? []) as AttemptRow[]);
  }, []);
  useEffect(() => {
    if (!accountsEnabled || !session) return;
    void getSupabase().then(async (sb) => {
      const c = await sb.rpc("assessment_catalog");
      if (c.error) return setErr(/assessment_catalog/.test(c.error.message) ? "Assessments need migration 011_assessments.sql." : c.error.message);
      setCatalog((c.data ?? []) as typeof catalog);
      const saved = read<Started | null>(ACTIVE, null);
      if (saved) {
        const { data } = await sb.from("assessment_attempts").select("submitted_at").eq("id", saved.id).maybeSingle();
        if (data && !(data as { submitted_at: string | null }).submitted_at) setActive(saved); else localStorage.removeItem(ACTIVE);
      }
      void loadHistory();
    });
  }, [session, loadHistory]);

  async function start() {
    setErr(null); setBusy(true); setResult(null);
    const sb = await getSupabase();
    const { data, error } = await sb.rpc("start_assessment", { p_kind: cfg.kind, p_difficulty: cfg.difficulty || null, p_topic: cfg.topic || null, p_count: cfg.count, p_minutes: cfg.minutes });
    setBusy(false);
    if (error) return setErr(error.message);
    write(ACTIVE, data);
    setActive(data as Started);
  }
  const submit = useCallback(async (a: Started) => {
    setBusy(true);
    const sb = await getSupabase();
    const { data, error } = await sb.rpc("submit_assessment", { p_attempt: a.id });
    setBusy(false);
    if (error) return setErr(error.message);
    localStorage.removeItem(ACTIVE);
    const r = data as AttemptResult;
    track("assessment_completed", "assessment", { score: r.score, total: r.total, kind: a.items[0]?.kind });
    setActive(null);
    setResult(r);
    void loadHistory();
  }, [loadHistory]);

  const topics = [...new Set(catalog.filter((c) => cfg.kind === "mixed" || c.kind === cfg.kind).map((c) => c.topic))].sort();
  const available = catalog.filter((c) => (cfg.kind === "mixed" || c.kind === cfg.kind) && (!cfg.difficulty || c.difficulty === cfg.difficulty) && (!cfg.topic || c.topic === cfg.topic)).length;
  const done = history.filter((h) => h.submitted_at && h.score !== null);
  const avg = done.length ? Math.round((done.reduce((s, h) => s + h.score! / h.total, 0) / done.length) * 100) : null;

  return (
    <Container wide className="pt-6">
      <Seo title="Assessments" description="Timed SQL and Python assessments graded by the server: no hints, hidden checks, results after submission." path="/assessments" noindex />
      {!active && <PageHeader eyebrow="Assessment mode" title="Assessments" intro="Timed, no hints and no answers until you submit. Your code runs in your browser; the server checks a fingerprint of the result against the expected one, so the expected output and reference solutions are never sent to your browser before you submit." />}
      {err && <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger-dim px-3 py-2 text-sm text-danger">{err}</p>}
      {!accountsEnabled ? <EmptyState icon={ClipboardCheck} title="Accounts are not enabled on this deployment">Assessments record attempts on the server.</EmptyState>
        : !ready ? <Skeleton className="h-64" />
          : !session ? <EmptyState icon={ClipboardCheck} title="Sign in to take an assessment">Attempts and scores are recorded in your account. <Link to="/login?next=/assessments" className="text-accent hover:underline">Sign in</Link>, or practise without one in the <Link to="/mock-interview" className="text-accent hover:underline">mock interview</Link>.</EmptyState>
            : active ? <Running a={active} onSubmit={submit} busy={busy} />
              : (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Card pad="md" as="section" aria-label="Start an assessment" className="min-w-0">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm text-ink-muted">Type<select value={cfg.kind} onChange={(e) => setCfg({ ...cfg, kind: e.target.value, topic: "" })} className={`${INPUT} mt-1 w-full`}><option value="sql">SQL</option><option value="python">Python</option><option value="mixed">Mixed</option></select></label>
                      <label className="text-sm text-ink-muted">Difficulty<select value={cfg.difficulty} onChange={(e) => setCfg({ ...cfg, difficulty: e.target.value })} className={`${INPUT} mt-1 w-full`}><option value="">Any</option>{["Easy", "Medium", "Hard"].map((d) => <option key={d}>{d}</option>)}</select></label>
                      <label className="text-sm text-ink-muted">Topic<select value={cfg.topic} onChange={(e) => setCfg({ ...cfg, topic: e.target.value })} className={`${INPUT} mt-1 w-full`}><option value="">Any topic</option>{topics.map((t) => <option key={t}>{t}</option>)}</select></label>
                      <label className="text-sm text-ink-muted">Questions<select value={cfg.count} onChange={(e) => setCfg({ ...cfg, count: Number(e.target.value) })} className={`${INPUT} mt-1 w-full`}>{[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                      <label className="text-sm text-ink-muted">Time limit<select value={cfg.minutes} onChange={(e) => setCfg({ ...cfg, minutes: Number(e.target.value) })} className={`${INPUT} mt-1 w-full`}>{[15, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></label>
                    </div>
                    <p className="mt-3 text-xs text-ink-muted">{available} question{available === 1 ? "" : "s"} match these settings{available < cfg.count ? `; the assessment will have ${available}` : ""}.</p>
                    <Button className="mt-3" onClick={() => void start()} disabled={busy || !available}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Timer className="h-4 w-4" aria-hidden />} Start assessment</Button>
                    <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                      <li>The timer is the server's: reloading doesn't pause it, and answers saved after the deadline are refused.</li>
                      <li>Run your code as often as you like; only <strong>Save answer</strong> counts, and you get no right/wrong feedback until you submit.</li>
                      <li>When time runs out the attempt is submitted automatically.</li>
                    </ul>
                  </Card>
                  <Card pad="md" as="section" aria-label="Results and history" className="min-w-0">
                    {result && <ResultView r={result} />}
                    <h2 className="text-sm font-semibold text-ink">Your assessments</h2>
                    {done.length > 0 && <p className="mt-1 text-xs text-ink-muted">{done.length} completed · average score {avg}% · best {Math.max(...done.map((h) => Math.round((h.score! / h.total) * 100)))}%</p>}
                    {history.length ? (
                      <ul className="mt-2 divide-y divide-surface-border text-sm">
                        {history.map((h) => <li key={h.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="text-ink">{h.config.kind.toUpperCase()}{h.config.topic ? ` · ${h.config.topic}` : ""}{h.config.difficulty ? ` · ${h.config.difficulty}` : ""}</span><span className="text-ink-muted">{new Date(h.started_at).toLocaleDateString()} · {h.submitted_at ? `${h.score}/${h.total}` : new Date(h.deadline) > new Date() ? "in progress" : "not submitted"}</span></li>)}
                      </ul>
                    ) : <p className="mt-2 text-sm text-ink-muted">None yet.</p>}
                  </Card>
                </div>
              )}
    </Container>
  );
}

function Running({ a, onSubmit, busy }: { a: Started; onSubmit: (a: Started) => Promise<void>; busy: boolean }) {
  const [i, setI] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [saved, setSaved] = useState<Record<string, string>>(() => read(`sqlp.assess.${a.id}.saved`, {}));
  const item = a.items[i];
  const [code, setCode] = useState("");
  const [out, setOut] = useState<{ text?: string; columns?: string[]; rows?: unknown[][]; error?: string } | null>(null);
  const [working, setWorking] = useState<"run" | "save" | null>(null);
  const left = Math.max(0, Math.round((Date.parse(a.deadline) - now) / 1000));
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (left === 0 && !busy) void onSubmit(a); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCode(read<string | null>(CODE(a.id, item.id), null) ?? (item.kind === "sql" ? "SELECT\n  \nFROM " : item.starter ?? "")); setOut(null); }, [a.id, item]);

  const change = (v: string) => { setCode(v); write(CODE(a.id, item.id), v); };
  async function run() {
    setWorking("run");
    if (item.kind === "sql") {
      const r = await runQuery(code);
      setOut(r.success ? { columns: r.columns, rows: r.rows.slice(0, 50) } : { error: r.message ?? "Query failed." });
    } else {
      const r = await runPython(code);
      setOut({ text: [r.stdout, r.error].filter(Boolean).join("\n") || (r.ok ? "Ran without output." : "Error") });
    }
    setWorking(null);
  }
  async function save() {
    setWorking("save");
    let answer: Record<string, unknown> | null = null;
    if (item.kind === "sql") {
      const r = await runQuery(code);
      if (!r.success) { setOut({ error: `Not saved: the query fails. ${r.message ?? ""}` }); setWorking(null); return; }
      answer = { sql: await sqlFingerprint(r.columns, r.rows, !!item.ordered) };
      setOut({ columns: r.columns, rows: r.rows.slice(0, 50) });
    } else {
      const r = await runPython(`${code}\n${pyCasesProgram(item.cases ?? [])}`);
      const outs = readCases(r.stdout);
      if (outs.length !== (item.cases ?? []).length) { setOut({ text: `Not saved: your code didn't run to the end.\n${r.error ?? ""}` }); setWorking(null); return; }
      answer = { cases: await pyFingerprints(outs) };
      setOut({ text: "Saved. Your function ran on every hidden case; results are shown after you submit." });
    }
    const sb = await getSupabase();
    const { error } = await sb.rpc("save_assessment_answer", { p_attempt: a.id, p_item: item.id, p_answer: answer });
    if (error) setOut({ error: `Not saved: ${error.message}` });
    else { const next = { ...saved, [item.id]: new Date().toISOString() }; setSaved(next); write(`sqlp.assess.${a.id}.saved`, next); }
    setWorking(null);
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-card border border-surface-border bg-surface-raised p-3 shadow-panel">
        {a.items.map((it, n) => (
          <Button key={it.id} size="sm" variant={n === i ? "primary" : "secondary"} onClick={() => setI(n)} aria-current={n === i}>
            {saved[it.id] ? <CheckCircle2 className="h-3.5 w-3.5" aria-label="Answer saved" /> : <Circle className="h-3.5 w-3.5" aria-hidden />} {n + 1}
          </Button>
        ))}
        <span className={`ml-auto inline-flex items-center gap-1.5 font-mono text-lg font-bold ${left < 300 ? "text-danger" : "text-ink"}`} role="timer" aria-label={`${Math.floor(left / 60)} minutes left`}>
          <Timer className="h-4 w-4" aria-hidden /> {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
        </span>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (confirm(`Submit now? ${a.items.length - Object.keys(saved).length} question(s) have no saved answer.`)) void onSubmit(a); }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Submit</Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <article className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-surface-soft px-2 py-0.5 text-xs uppercase text-ink-muted">{item.kind}</span><h2 className="font-display text-xl font-bold text-ink">{item.title}</h2><Difficulty level={item.difficulty} /></div>
          <Markdown source={item.problem} className="text-sm" />
          {item.objective && <p className="rounded-lg border-l-2 border-accent bg-surface-raised px-3 py-2 text-sm text-ink"><strong>Return:</strong> <Markdown source={item.objective} className="inline" /></p>}
          {item.kind === "sql" && <p className="text-xs text-ink-muted">Runs on Northwind. {item.ordered ? "Row order is graded." : "Row order doesn't matter."} Column names must match the ones asked for.</p>}
          {item.example && <pre className="overflow-x-auto rounded-lg bg-surface-overlay p-2 font-mono text-xs text-ink">{item.example}</pre>}
          {item.kind === "python" && <p className="text-xs text-ink-muted">Your function is called on {item.cases?.length ?? 0} hidden cases when you save.</p>}
        </article>
        <div className="min-w-0 space-y-3">
          <Card pad="none" className="overflow-hidden">
            <Suspense fallback={<Skeleton className="h-[340px] rounded-none" />}>
              <CodeEditor value={code} onChange={change} onRun={run} height={340} label={`${item.kind === "sql" ? "SQL" : "Python"} editor`} language={item.kind === "sql" ? "sql" : "python"} />
            </Suspense>
            <div className="flex flex-wrap items-center gap-2 border-t border-surface-border px-4 py-3">
              <Button variant="secondary" onClick={() => void run()} disabled={!!working}>{working === "run" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Run</Button>
              <Button onClick={() => void save()} disabled={!!working}>{working === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save answer</Button>
              {saved[item.id] && <span className="text-xs text-success">saved {new Date(saved[item.id]).toLocaleTimeString()}</span>}
            </div>
          </Card>
          {out && (
            <Card pad="sm" as="section" aria-label="Your output" className="min-w-0">
              {out.error ? <p className="text-sm text-danger">{out.error}</p> : out.text !== undefined ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink">{out.text}</pre> : (
                <div className="max-h-64 overflow-auto">
                  <table className="text-xs"><thead><tr>{out.columns!.map((c) => <th key={c} className="px-2 py-1 text-left font-medium text-ink-faint">{c}</th>)}</tr></thead>
                    <tbody>{out.rows!.map((r, k) => <tr key={k}>{r.map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-0.5 font-mono text-ink">{v === null ? "NULL" : String(v)}</td>)}</tr>)}</tbody></table>
                  <p className="mt-1 text-[11px] text-ink-faint">Your query's rows (first 50). Whether they are right is shown after you submit.</p>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultView({ r }: { r: AttemptResult }) {
  return (
    <div className="mb-5 rounded-lg border border-accent/30 bg-accent-dim/40 p-3">
      <p className="flex items-center gap-2 font-semibold text-ink"><Trophy className="h-4 w-4 text-accent" aria-hidden /> {r.score} of {r.total} correct · {Math.round((r.score / Math.max(1, r.total)) * 100)}%</p>
      <ul className="mt-2 space-y-2 text-sm">
        {r.items.map((it) => (
          <li key={it.id}>
            <details>
              <summary className="flex cursor-pointer items-center gap-2">{it.passed ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Correct" /> : <XCircle className="h-4 w-4 text-danger" aria-label="Incorrect" />}
                <span className="text-ink">{it.id}</span><span className="text-xs text-ink-muted">{!it.answered ? "no answer saved" : it.cases_total ? `${it.cases_passed}/${it.cases_total} hidden cases` : it.passed ? "result matches" : "result differs"}</span></summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-overlay p-2 font-mono text-xs text-ink">{it.reference}</pre>
              <p className="mt-1 text-xs text-ink-muted">{it.explanation}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
