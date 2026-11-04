import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, GitBranch, Loader2, Stethoscope } from "lucide-react";
import { Link } from "react-router-dom";
import { SqlEditor, type RunRequest } from "../../components/SqlEditor";
import { ResultsPanel } from "../../components/ResultsPanel";
import type { ResultTab, ResultTarget, SubmitResult, TableSchema } from "../../types";
import type { Question } from "../types";
import { getDb, getSchemas, runQuery, submitQuery } from "../lib/browserDb";
import { completeExercise, recordAttempt, saveDraft, useProgress } from "../lib/progress";
import { explainError } from "../lib/errorHelp";
import { PlanTree, parsePlan, type PlanNode } from "./PlanTree";

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
  onSolved?: (r: SubmitResult) => void;
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
  const [plan, setPlan] = useState<{ node: PlanNode | null; error?: string } | null>(null);

  // Restore the visitor's last draft for this question once storage is readable.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    setSql((!fresh && saved?.lastSql) || starter(question));
  }, [saved, question, fresh]);

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
      onRan?.(text, result);
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
    const body = sql.replace(/--.*$/gm, "").trim().replace(/;\s*$/, "");
    if (!body) return;
    if (body.includes(";")) return setPlan({ node: null, error: "EXPLAIN works on a single statement." });
    const res = await runQuery(`EXPLAIN (FORMAT JSON) ${body}`, dataset);
    setPlan(res.success ? { node: parsePlan(res.rows[0]?.[0]) } : { node: null, error: res.message ?? "Could not explain this query." });
  }, [sql, dataset]);

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
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
    onSolved?.(result);
  }, [sql, question, onSolved, lessonKey, dataset]);

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-card border border-surface-border bg-surface-raised shadow-panel ${fill ? "lg:min-h-full lg:shrink-0" : ""}`}
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
        {ready === "ready" && (
          <button type="button" onClick={onExplain} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover/5 hover:text-ink" title="Show how PostgreSQL will run this query">
            <GitBranch className="h-3.5 w-3.5" aria-hidden /> Explain plan
          </button>
        )}
        {(saved?.solvedAt || exerciseDone) && (
          <span className={`${ready === "ready" ? "" : "ml-auto "}inline-flex items-center gap-1 font-medium text-success`}>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Solved
          </span>
        )}
      </div>
      <div className={fill ? "h-[320px] sm:h-[360px] lg:h-[46vh] lg:min-h-[260px]" : "h-[320px] sm:h-[360px]"}>
        <SqlEditor
          value={sql}
          onChange={onChange}
          onRun={onRun}
          onSubmit={playground ? undefined : onSubmit}
          running={running || ready === "loading"}
          submitting={submitting || ready === "loading"}
          starterSql={starter(question)}
          schemas={schemas}
          resultTarget={target}
          onResultTargetChange={setTarget}
          submitLabel="Submit"
        />
      </div>
      <div className="min-h-[220px] border-t border-surface-border">
        <ResultsPanel
          tabs={tabs}
          activeTabId={activeTab}
          onSelectTab={setActiveTab}
          onCloseTab={(id) => setTabs((prev) => prev.filter((t) => t.id !== id))}
          submitResult={submitResult}
          loading={running || submitting}
        />
      </div>
      <Coach
        runError={(tabs.find((t) => t.id === activeTab) ?? tabs[tabs.length - 1])?.result}
        submit={submitResult}
      />
      {plan && (
        <div className="border-t border-surface-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Query plan
            <button type="button" onClick={() => setPlan(null)} className="normal-case tracking-normal hover:text-ink">Close</button>
          </div>
          {plan.node ? <PlanTree plan={plan.node} /> : <p className="text-sm text-danger">{plan.error}</p>}
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
