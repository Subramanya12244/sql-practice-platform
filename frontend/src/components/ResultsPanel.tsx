import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  X,
  XCircle,
} from "lucide-react";
import type { ExecuteResult, ResultTab, SubmitResult } from "../types";
import { useToast } from "./Toast";

interface Props {
  tabs: ResultTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  submitResult?: SubmitResult | null;
  loading?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function cellDisplay(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ResultBody({
  result,
  submitResult,
  loading,
}: {
  result: ExecuteResult | null;
  submitResult?: SubmitResult | null;
  loading?: boolean;
}) {
  const toast = useToast();
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const csv = useMemo(() => {
    if (!result?.success || !result.columns.length) return "";
    const header = result.columns.join(",");
    const body = result.rows
      .map((row) =>
        row
          .map((c) => {
            const s = cellDisplay(c);
            if (s.includes(",") || s.includes('"') || s.includes("\n")) {
              return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
          })
          .join(","),
      )
      .join("\n");
    return `${header}\n${body}`;
  }, [result]);

  const copyAll = async () => {
    if (!csv) return;
    await navigator.clipboard.writeText(csv);
    toast.push("Results copied", "info");
  };

  const exportCsv = () => {
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyCell = async (value: unknown, key: string) => {
    await navigator.clipboard.writeText(cellDisplay(value));
    setCopiedCell(key);
    setTimeout(() => setCopiedCell(null), 800);
  };

  return (
    <>
      {result?.success && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-xs text-ink-muted">
            <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
            {`${result.execution_time_ms ?? "—"} ms`}
              <span className="text-ink-faint">|</span>
            {`${result.row_count ?? 0} rows`}
            {result.truncated && <span className="text-warn">(truncated)</span>}
          </span>
          <div className="ml-auto flex gap-1.5">
            <button type="button" className="btn-secondary" onClick={copyAll}>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
            <button type="button" className="btn-secondary" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          <div className="h-4 w-48 animate-pulse rounded bg-surface-overlay" />
          <div className="h-40 animate-pulse rounded bg-surface-overlay" />
        </div>
      )}

      {submitResult && (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-sm ${
            submitResult.correct
              ? "border-accent/40 bg-accent-dim text-accent"
              : "border-danger/40 bg-danger-dim text-danger"
          }`}
        >
          <p className="font-medium">
            {submitResult.correct ? "✅ " : "❌ "}
            {submitResult.message}
          </p>
          {submitResult.feedback?.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-ink">
              {submitResult.feedback.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {submitResult.level_changed && submitResult.suggested_difficulty && (
            <p className="mt-2 text-warn">
              Difficulty updated → {submitResult.suggested_difficulty}
            </p>
          )}
        </div>
      )}

      {!loading && !result && !submitResult && (
        <div className="flex h-full items-center justify-center text-sm text-ink-faint">
          Run a query to see results here.
        </div>
      )}

      {result && !result.success && (
        <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-3 text-sm text-danger">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <XCircle className="h-4 w-4" />
            {result.error_type === "TIMEOUT"
              ? "Timeout"
              : result.error_type === "FORBIDDEN"
                ? "Not permitted"
                : "SQL Error"}
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs text-ink">
            {result.message}
          </pre>
        </div>
      )}

      {result?.success && (
        <>
          <p className="mb-2 text-xs text-accent">{result.message}</p>
          <div className="overflow-auto rounded-md border border-surface-border">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-surface-overlay">
                <tr>
                  <th className="border-b border-surface-border px-2 py-1.5 font-mono text-[11px] text-ink-faint">
                    #
                  </th>
                  {result.columns.map((col) => (
                    <th
                      key={col}
                      className="border-b border-surface-border px-3 py-1.5 font-mono text-xs font-semibold text-ink"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className="odd:bg-surface even:bg-surface-raised/40 hover:bg-surface-overlay/50"
                  >
                    <td className="border-b border-surface-border px-2 py-1 font-mono text-[11px] text-ink-faint">
                      {ri + 1}
                    </td>
                    {row.map((cell, ci) => {
                      const key = `${ri}-${ci}`;
                      const isNull = cell === null || cell === undefined;
                      return (
                        <td
                          key={key}
                          className={`cursor-pointer border-b border-surface-border px-3 py-1 font-mono text-xs ${
                            isNull ? "italic text-ink-faint" : "text-ink"
                          } ${copiedCell === key ? "bg-accent-dim" : ""}`}
                          title="Click to copy"
                          onClick={() => void copyCell(cell, key)}
                        >
                          {cellDisplay(cell)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={result.columns.length + 1}
                      className="px-3 py-6 text-center text-ink-faint"
                    >
                      Query returned 0 rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export function ResultsPanel({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  submitResult = null,
  loading,
  collapsed = false,
  onToggleCollapse,
}: Props) {
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;
  const activeResult = active?.result ?? null;
  const activeSubmit = active?.submitResult ?? submitResult;

  const summary =
    activeResult?.success
      ? `${activeResult.row_count ?? 0} rows`
      : activeSubmit
        ? activeSubmit.correct
          ? "Correct"
          : "Incorrect"
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border bg-surface-overlay/30 px-2 py-1.5 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Results
          </h3>
          {tabs.length > 0 && (
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {tabs.map((tab) => {
                const isActive = tab.id === (active?.id ?? "");
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelectTab(tab.id)}
                    className={`group flex max-w-[160px] items-center gap-1 rounded-md px-2 py-1 text-xs transition ${
                      isActive
                        ? "bg-accent-dim text-accent"
                        : "text-ink-muted hover:bg-surface-overlay hover:text-ink"
                    }`}
                    title={tab.sql.slice(0, 120)}
                  >
                    <span className="truncate">{tab.title}</span>
                    {tabs.length > 1 && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="rounded p-0.5 text-ink-faint hover:bg-surface-border hover:text-ink"
                        title="Close tab"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseTab(tab.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onCloseTab(tab.id);
                          }
                        }}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {collapsed && summary && (
            <span
              className={`truncate text-xs ${
                activeSubmit && !activeSubmit.correct ? "text-danger" : "text-ink-muted"
              }`}
            >
              {summary}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onToggleCollapse && (
            <button
              type="button"
              className="btn-ghost px-2"
              onClick={onToggleCollapse}
              title={collapsed ? "Expand results" : "Minimize results"}
              aria-label={collapsed ? "Expand results" : "Minimize results"}
            >
              {collapsed ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {collapsed ? "Expand" : "Minimize"}
              </span>
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {active && (active.sql || active.scope === "selection") && !loading && (
            <p className="mb-2 truncate font-mono text-[11px] text-ink-faint" title={active.sql}>
              {active.scope === "selection" ? "Selection · " : "Full · "}
              {active.sql.replace(/\s+/g, " ").slice(0, 140) || "(empty)"}
            </p>
          )}
          <ResultBody
            result={activeResult}
            submitResult={activeSubmit}
            loading={loading}
          />
        </div>
      )}
    </div>
  );
}
