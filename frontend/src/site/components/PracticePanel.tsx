import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { SqlEditor, type RunRequest } from "../../components/SqlEditor";
import { ResultsPanel } from "../../components/ResultsPanel";
import type { ResultTab, ResultTarget, SubmitResult, TableSchema } from "../../types";
import type { Question } from "../types";
import { getDb, getSchemas, runQuery, submitQuery } from "../lib/browserDb";
import { recordAttempt, saveDraft, useProgress } from "../lib/progress";

/** Editor + results for one question. Browser only — loaded lazily. */
export default function PracticePanel({ question, onSolved }: { question: Question; onSolved?: (r: SubmitResult) => void }) {
  const progress = useProgress();
  const saved = progress.questions[question.number];
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

  // Restore the visitor's last draft for this question once storage is readable.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    setSql(saved?.lastSql ?? starter(question));
  }, [saved, question]);

  useEffect(() => {
    if (!wantDb) return;
    let alive = true;
    setReady("loading");
    getDb()
      .then(() => getSchemas())
      .then((s) => {
        if (!alive) return;
        setSchemas(s);
        setReady("ready");
      })
      .catch(() => alive && setReady("error"));
    return () => {
      alive = false;
    };
  }, [wantDb]);

  const onChange = useCallback(
    (next: string) => {
      setSql(next);
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => saveDraft(question.number, next), 600);
    },
    [question.number],
  );

  const onRun = useCallback(
    async ({ sql: text, scope }: RunRequest) => {
      setRunning(true);
      setSubmitResult(null);
      const result = await runQuery(text);
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
    [tabs, target, activeTab],
  );

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    const result = await submitQuery(sql, question.referenceQuery, question.sortRequired, question.orderBy ?? null);
    recordAttempt(question.number, sql, result.correct);
    setSubmitResult(result);
    setSubmitting(false);
    onSolved?.(result);
  }, [sql, question, onSolved]);

  return (
    <div
      className="flex flex-col overflow-hidden rounded-card border border-surface-border bg-surface-raised shadow-panel"
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
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> PostgreSQL ready · Northwind loaded
          </>
        )}
        {ready === "error" && <span className="text-danger">Could not start the database. Reload the page to try again.</span>}
        {saved?.solvedAt && (
          <span className="ml-auto inline-flex items-center gap-1 font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Solved
          </span>
        )}
      </div>
      <div className="h-[320px] sm:h-[360px]">
        <SqlEditor
          value={sql}
          onChange={onChange}
          onRun={onRun}
          onSubmit={onSubmit}
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
    </div>
  );
}

function starter(q: Question): string {
  return `-- Q${q.number}: ${q.title}\n-- Tables: ${q.tables.join(", ")}\n\nSELECT\n  \nFROM ${q.tables[0] ?? ""};\n`;
}
