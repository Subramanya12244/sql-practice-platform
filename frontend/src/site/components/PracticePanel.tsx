import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, GitBranch, Loader2, Maximize2, Minimize2, PanelRight, Plus, Stethoscope, X } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { WorkspaceSide, type SideTab } from "./WorkspaceSide";
import { downloadText, safeName } from "../lib/workspace";
import { addExec } from "../lib/vizHistory";
import { Link } from "react-router-dom";
import { SqlEditor, type RunRequest } from "../../components/SqlEditor";
import { ResultsPanel } from "../../components/ResultsPanel";
import type { ResultTab, ResultTarget, SubmitResult, TableSchema } from "../../types";
import type { Question } from "../types";
import { getDb, getSchemas, runQuery, submitQuery } from "../lib/browserDb";
import { completeExercise, getProgress, recordAttempt, saveDraft, useProgress } from "../lib/progress";
import { explainError } from "../lib/errorHelp";
import { PlanTree, parsePlan, type PlanNode } from "./PlanTree";
import { FORGE_THEMES, defineForgeThemes } from "../lib/monacoTheme";
import { track } from "../lib/activity";

/** Editor + results for one question. Browser only — loaded lazily. */
export default function PracticePanel({
  question,
  onSolved,
  fresh = false,
  playground = false,
  lessonKey,
  fill = false,
  dataset = "northwind",
  datasetLabel = "Northwind",
  onRan,
}: {
  question: Question;
  /** After every submit, with the exact SQL that was submitted. */
  onSolved?: (r: SubmitResult, sql: string) => void;
  /** Start from the starter query instead of the visitor's saved draft (mock interviews). */
  fresh?: boolean;
  /** Free-form querying: no Submit, nothing graded. */
  playground?: boolean;
  /** Learning-path exercise: graded, but tracked under this key instead of a question number. */
  lessonKey?: string;
  /** Stretch to the parent's height (question workspace) instead of fixed heights. */
  fill?: boolean;
  /** Which isolated database to run against (default Northwind). */
  dataset?: string;
  datasetLabel?: string;
  /** Called after every Run with the SQL and its result (playground history/export). */
  onRan?: (sql: string, result: import("../../types").ExecuteResult) => void;
}) {
  const progress = useProgress();
  const saved = lessonKey ? undefined : progress.questions[question.number];
  const exerciseDone = lessonKey ? Boolean(progress.lessons?.[lessonKey]) : false;
  const [sql, setSql] = useState("");
  // The database (~5 MB compressed, cached after the first visit) starts on first interaction,
  // so reading a question page doesn't download it.
  const [wantDb, setWantDb] = useState(false);
  const [ready, setReady] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [schemas, setSchemas] = useState<TableSchema[]>([]);
  const [tabs, setTabs] = useState<ResultTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [target, setTarget] = useState<ResultTarget>("same");
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>();
  const [plan, setPlan] = useState<{ node: PlanNode | null; error?: string; busy?: boolean } | null>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [side, setSide] = useState<SideTab | null>(null);
  // History of this problem's runs and submits (kept in this browser).
  const historyKey = lessonKey ? `lesson:${lessonKey}` : playground ? `pg:${dataset}` : `q${question.number}`;
  const [historyVersion, setHistoryVersion] = useState(0);
  /** One writer for the execution history (sqlp.exec.<key>), shown here and on the question's History tab. */
  const logRun = (kind: "run" | "submit", code: string, ok: boolean, rows?: number, correct?: boolean) => {
    addExec(historyKey, { at: new Date().toISOString(), kind, sql: code, ok, rows, correct, attempt: lessonKey || playground ? 0 : getProgress().questions[question.number]?.attempts ?? 0 });
    setHistoryVersion((v) => v + 1);
  };

  // Extra query tabs (scratch queries) per question/exercise. Tab "main" is the saved draft that
  // Submit grades by default; any tab can be run or submitted.
  const tabsKey = lessonKey ? `sqlp.qtabs.${lessonKey}` : playground ? `sqlp.qtabs.pg.${dataset}` : `sqlp.qtabs.q${question.number}`;
  const [qtabs, setQtabs] = useState<{ id: string; name: string; sql: string }[]>([]);
  const [activeQ, setActiveQ] = useState("main");
  useEffect(() => {
    try { setQtabs(JSON.parse(localStorage.getItem(tabsKey) ?? "[]")); } catch { setQtabs([]); }
    setActiveQ("main");
  }, [tabsKey]);
  const saveTabs = (next: { id: string; name: string; sql: string }[]) => {
    setQtabs(next);
    try { localStorage.setItem(tabsKey, JSON.stringify(next.slice(0, 5))); } catch { /* ignore */ }
  };
  const current = activeQ === "main" ? sql : qtabs.find((t) => t.id === activeQ)?.sql ?? "";

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [full]);

  // Restore the visitor's last draft for this question. Effects run only in the browser, after
  // hydration, so read storage directly: during hydration `saved` still comes from the
  // prerendered (empty) snapshot, and restoring from it would show the starter query.
  const restored = useRef<number | null>(null);
  useEffect(() => {
    if (restored.current === question.number) return;
    restored.current = question.number;
    const draft = lessonKey ? undefined : getProgress().questions[question.number]?.lastSql;
    setSql((!fresh && draft) || starter(question));
  }, [question, fresh, lessonKey]);

  useEffect(() => {
    if (!wantDb) return;
    let alive = true;
    setReady("loading");
    getDb(dataset)
      .then(() => getSchemas(dataset))
      .then((s) => {
        if (!alive) return;
        setSchemas(s);
        setReady("ready");
      })
      .catch(() => alive && setReady("error"));
    return () => {
      alive = false;
    };
  }, [wantDb, dataset]);

  const onChange = useCallback(
    (next: string) => {
      setSql(next);
      clearTimeout(draftTimer.current);
      if (!lessonKey) draftTimer.current = setTimeout(() => saveDraft(question.number, next), 600);
    },
    [question.number, lessonKey],
  );

  const onRun = useCallback(
    async ({ sql: text, scope }: RunRequest) => {
      setRunning(true);
      setSubmitResult(null);
      const result = await runQuery(text, dataset);
      logRun("run", text, result.success, result.success ? result.row_count ?? result.rows.length : undefined);
      onRan?.(text, result);
      track("sql_executed", lessonKey ? `lesson:${lessonKey}` : playground ? `playground:${dataset}` : `q${question.number}`, { ok: result.success });
      const reuseId = target === "same" ? (tabs.find((t) => t.id === activeTab) ?? tabs[tabs.length - 1])?.id : undefined;
      if (reuseId) {
        setTabs(tabs.map((t) => (t.id === reuseId ? { ...t, sql: text, scope, result } : t)));
        setActiveTab(reuseId);
      } else {
        const tab: ResultTab = { id: crypto.randomUUID(), title: `Result ${tabs.length + 1}`, sql: text, scope, result };
        setTabs([...tabs, tab]);
        setActiveTab(tab.id);
      }
      setRunning(false);
    },
    [tabs, target, activeTab, dataset, onRan],
  );

  const onExplain = useCallback(async () => {
    const body = current.replace(/--.*$/gm, "").trim().replace(/;\s*$/, "");
    setWantDb(true); // the plan needs the database; runQuery waits for it to start
    if (!body) return setPlan({ node: null, error: "Write a query first, then explain it." });
    if (body.includes(";")) return setPlan({ node: null, error: "EXPLAIN works on a single statement." });
    setPlan({ node: null, busy: true });
    const res = await runQuery(`EXPLAIN (FORMAT JSON) ${body}`, dataset);
    setPlan(res.success ? { node: parsePlan(res.rows[0]?.[0]) } : { node: null, error: res.message ?? "Could not explain this query." });
  }, [current, dataset]);

  // The plan renders under the editor panel, usually below the fold: bring it into view.
  useEffect(() => { if (plan) planRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [plan]);

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    const sql = current;
    const result = await submitQuery(sql, question.referenceQuery, question.sortRequired, question.orderBy ?? null, dataset);
    if (lessonKey) {
      if (result.correct) completeExercise(lessonKey);
    } else {
      // Classify the failure deterministically for the mistake log.
      const kind = result.correct ? undefined : explainError(result.feedback[0])?.title ?? (result.diff ? "Wrong result" : "SQL error");
      recordAttempt(question.number, sql, result.correct, kind);
    }
    setSubmitResult(result);
    setSubmitting(false);
    logRun("submit", sql, true, result.your_row_count ?? undefined, result.correct);
    track("sql_submitted", lessonKey ? `lesson:${lessonKey}` : `q${question.number}`, { passed: result.correct, hidden_failed: Boolean(result.hidden_failed) });
    if (lessonKey && result.correct) track("lesson_completed", `lesson:${lessonKey}`);
    onSolved?.(result, sql);
  }, [current, question, onSolved, lessonKey, dataset]);

  const onEditorChange = (next: string) => {
    if (activeQ === "main") onChange(next);
    else saveTabs(qtabs.map((t) => (t.id === activeQ ? { ...t, sql: next } : t)));
  };
  const activeResult = (tabs.find((t) => t.id === activeTab) ?? tabs[tabs.length - 1]);
  const errorMarker = activeResult?.result && !activeResult.result.success && activeResult.result.error_position
    ? { sql: activeResult.sql, position: activeResult.result.error_position, message: activeResult.result.message ?? "SQL error" }
    : null;
  const tabBtn = (on: boolean) => `inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${on ? "bg-surface-raised text-ink shadow-panel" : "text-ink-muted hover:text-ink"}`;

  return (
    <div
      className={full
        ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-surface-raised"
        : `flex flex-col overflow-hidden rounded-card border border-surface-border bg-surface-raised shadow-panel ${fill ? "lg:min-h-full lg:shrink-0" : ""}`}
      onPointerDownCapture={() => setWantDb(true)}
      onFocusCapture={() => setWantDb(true)}
    >
      <div className="flex items-center gap-2 border-b border-surface-border px-3 py-2 text-xs text-ink-muted">
        {ready === "idle" && (
          <>
            <span className="h-2 w-2 rounded-full bg-ink-faint" aria-hidden /> PostgreSQL starts when you click into the editor
          </>
        )}
        {ready === "loading" && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Starting PostgreSQL in your browser…
          </>
        )}
        {ready === "ready" && (
          <>
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> PostgreSQL ready · {datasetLabel} loaded
          </>
        )}
        {ready === "error" && <span className="text-danger">Could not start the database. Reload the page to try again.</span>}
        <span className="ml-auto flex items-center gap-0.5">
          {ready !== "error" && (
            <button type="button" onClick={() => void onExplain()} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover/5 hover:text-ink" title="Show how PostgreSQL will run this query">
              <GitBranch className="h-3.5 w-3.5" aria-hidden /> Explain plan
            </button>
          )}
          <button type="button" onClick={() => setSide((v) => (v ? null : "schema"))} aria-pressed={!!side} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover/5 hover:text-ink" title="Schema, history, snippets and reference">
            <PanelRight className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Tools</span>
          </button>
          <button type="button" onClick={() => downloadText(`${playground ? `playground-${dataset}` : safeName(question.slug || `q${question.number}`)}.sql`, current, "application/sql")} disabled={!current.trim()} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover/5 hover:text-ink disabled:opacity-40" title="Download this query as a .sql file" aria-label="Download query">
            <Download className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button type="button" onClick={() => setFull((v) => !v)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover/5 hover:text-ink" title={full ? "Exit full screen (Esc)" : "Full screen"} aria-label={full ? "Exit full screen" : "Full screen"}>
            {full ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </span>
        {(saved?.solvedAt || exerciseDone) && (
          <span className={`${ready === "ready" ? "" : "ml-auto "}inline-flex items-center gap-1 font-medium text-success`}>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Solved
          </span>
        )}
      </div>
      <div className={`relative flex min-h-0 ${full ? "flex-1" : fill ? "h-[680px] lg:h-[80vh] lg:min-h-[560px]" : "h-[620px]"}`}>
        <div className="flex min-w-0 flex-1 flex-col">
          <div role="group" aria-label="Query tabs" className="scroll-fade-x flex shrink-0 items-center gap-1 overflow-x-auto border-b border-surface-border bg-surface-overlay px-2 py-1">
            <button type="button" aria-pressed={activeQ === "main"} onClick={() => setActiveQ("main")} className={tabBtn(activeQ === "main")}>Query 1</button>
            {qtabs.map((t) => (
              <span key={t.id} className={tabBtn(activeQ === t.id)}>
                <button type="button" aria-pressed={activeQ === t.id} onClick={() => setActiveQ(t.id)}>{t.name}</button>
                <button type="button" aria-label={`Close ${t.name}`} className="rounded text-ink-faint hover:text-danger" onClick={() => { saveTabs(qtabs.filter((x) => x.id !== t.id)); if (activeQ === t.id) setActiveQ("main"); }}><X className="h-3 w-3" /></button>
              </span>
            ))}
            {qtabs.length < 4 && (
              <button type="button" aria-label="New query tab" title="New query tab" className="rounded p-1 text-ink-muted hover:bg-hover/5 hover:text-ink"
                onClick={() => { const t = { id: crypto.randomUUID(), name: `Query ${qtabs.length + 2}`, sql: "-- Scratch query\n" }; saveTabs([...qtabs, t]); setActiveQ(t.id); }}>
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <PanelGroup direction="vertical" autoSaveId="df-practice-split" className="min-h-0 flex-1">
            <Panel defaultSize={58} minSize={25}>
              <SqlEditor
                key={activeQ}
                value={current}
                onChange={onEditorChange}
                onRun={onRun}
                onSubmit={playground ? undefined : onSubmit}
                running={running || ready === "loading"}
                submitting={submitting || ready === "loading"}
                starterSql={activeQ === "main" ? starter(question) : ""}
                schemas={schemas}
                resultTarget={target}
                onResultTargetChange={setTarget}
                submitLabel="Submit"
                themes={{ ...FORGE_THEMES, define: defineForgeThemes }}
                errorMarker={errorMarker}
              />
            </Panel>
            <PanelResizeHandle className="group relative h-2 shrink-0 border-y border-surface-border bg-surface-overlay hover:bg-accent/20" aria-label="Resize editor and results">
              <span className="absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-faint/50 group-hover:bg-accent" aria-hidden />
            </PanelResizeHandle>
            <Panel defaultSize={42} minSize={15} className="min-h-0 overflow-auto">
              <ResultsPanel
                tabs={tabs}
                activeTabId={activeTab}
                onSelectTab={setActiveTab}
                onCloseTab={(id) => setTabs((prev) => prev.filter((t) => t.id !== id))}
                submitResult={submitResult}
                loading={running || submitting}
              />
            </Panel>
          </PanelGroup>
        </div>
        {side && (
          <div className="absolute inset-0 z-10 sm:static sm:w-80 sm:shrink-0">
            <WorkspaceSide tab={side} onTab={setSide} onClose={() => setSide(null)} schemas={schemas} dataset={dataset} datasetLabel={datasetLabel}
              historyKey={historyKey} historyVersion={historyVersion} current={current}
              onInsert={(text) => onEditorChange(/^[\w.]+$/.test(text) ? `${current.replace(/\s*$/, "")} ${text}` : `${current.replace(/\s*$/, "")}\n\n${text}\n`)}
              onReplace={onEditorChange} />
          </div>
        )}
      </div>
      <Coach
        runError={activeResult?.result}
        submit={submitResult}
      />
      {plan && (
        <div ref={planRef} className="max-h-[45vh] shrink-0 scroll-mt-20 overflow-auto border-t border-surface-border px-4 py-3" aria-live="polite">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Query plan
            <button type="button" onClick={() => setPlan(null)} className="normal-case tracking-normal hover:text-ink">Close</button>
          </div>
          {plan.busy ? <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Asking PostgreSQL for the plan…</p>
            : plan.node ? <PlanTree plan={plan.node} /> : <p className="text-sm text-danger">{plan.error}</p>}
        </div>
      )}
    </div>
  );
}

const cell = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v));

function RowSample({ title, columns, rows, count }: { title: string; columns: string[]; rows: unknown[][]; count: number }) {
  if (!count) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-ink">{title} ({count}{count > rows.length ? `, showing ${rows.length}` : ""})</p>
      <div className="mt-1 overflow-x-auto">
        <table className="text-xs">
          <thead><tr>{columns.map((c) => <th key={c} className="px-2 py-1 text-left font-medium text-ink-faint">{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="px-2 py-0.5 font-mono text-ink">{cell(v)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/** Plain-language help under the results: what an error means, or which rows differ. */
function Coach({ runError, submit }: { runError?: { success: boolean; message?: string | null } | null; submit: SubmitResult | null }) {
  const message = submit && !submit.correct && submit.feedback[0] && !submit.diff ? submit.feedback[0] : runError && !runError.success ? runError.message : null;
  const help = explainError(message);
  const diff = submit && !submit.correct ? submit.diff : null;
  if (!help && !diff) return null;
  return (
    <div className="border-t border-surface-border bg-surface px-4 py-3 text-sm" role="status">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
        <Stethoscope className="h-3.5 w-3.5" aria-hidden /> Coach
      </p>
      {help && (
        <p className="mt-1 text-ink">
          <strong>{help.title}.</strong> {help.fix.replace(/`/g, "")}
          {help.guide && (
            <> <Link to={`/concepts/${help.guide.slug}`} className="text-accent underline">Read: {help.guide.label}</Link></>
          )}
        </p>
      )}
      {diff && (diff.missingCount || diff.extraCount ? (
        <>
          <RowSample title="Expected but missing from yours" columns={diff.columns} rows={diff.missing} count={diff.missingCount} />
          <RowSample title="In yours but not expected" columns={diff.columns} rows={diff.extra} count={diff.extraCount} />
        </>
      ) : (
        <p className="mt-1 text-ink">Same rows as expected — check the row order or the column order/names.</p>
      ))}
    </div>
  );
}

function starter(q: Question): string {
  if (q.starter) return q.starter;
  if (!q.tables.length) return "-- Query any Northwind table. Ctrl/⌘+Enter runs everything.\n\nSELECT *\nFROM customers\nLIMIT 10;\n";
  return `-- Q${q.number}: ${q.title}\n-- Tables: ${q.tables.join(", ")}\n\nSELECT\n  \nFROM ${q.tables[0] ?? ""};\n`;
}
