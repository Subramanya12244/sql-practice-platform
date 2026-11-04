import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, FileText, Table2, Trash2 } from "lucide-react";
import type { Question, TableSchema } from "../types";
import { DifficultyBadge, StatusBadge } from "./Badges";
import { DocumentDocsModal } from "./DocumentDocsModal";
import { HistoricalAttempts } from "./HistoricalAttempts";
import { api } from "../services/api";
import { useToast } from "./Toast";

interface Props {
  question: Question;
  schemas: TableSchema[];
  attemptsOpen?: boolean;
  attemptPanel?: React.ReactNode;
}

type Tab = "problem" | "schema" | "history";

export function QuestionPanel({ question, schemas, attemptPanel }: Props) {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("problem");
  const [docsOpen, setDocsOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.deleteQuestion(question.id),
    onSuccess: (res) => {
      toast.push(res.message, "success");
      void qc.invalidateQueries({ queryKey: ["questions"] });
      void qc.invalidateQueries({ queryKey: ["progress"] });
      void qc.invalidateQueries({ queryKey: ["topics"] });
      void qc.invalidateQueries({ queryKey: ["next-question-number"] });
      navigate("/questions");
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "problem", label: "Problem" },
    { id: "schema", label: "Schema", count: schemas.length || question.tables_used.length },
    { id: "history", label: "History" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-surface-border px-4 pb-3 pt-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-faint">Q{question.question_number}</span>
          <DifficultyBadge level={question.difficulty} />
          <StatusBadge status={question.status} />
          <span className="badge bg-surface-overlay text-ink-muted">{question.topic}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="btn-secondary"
              title="Preview .md + .sql, then approve before writing or pushing"
              onClick={() => setDocsOpen(true)}
            >
              <FileText className="h-3.5 w-3.5" />
              Document
            </button>
            <button
              type="button"
              className="btn-ghost text-ink-muted hover:text-danger"
              title="Delete this question"
              disabled={remove.isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    `Delete Q${question.question_number} — ${question.title}?\n\nThis removes it from the app (attempts included). Repo .md/.sql files are not deleted.`,
                  )
                ) {
                  return;
                }
                remove.mutate();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {remove.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>

        <h1 className="font-display text-lg font-semibold leading-snug text-ink sm:text-xl">
          {question.title}
        </h1>

        <div className="mt-3 flex gap-1 rounded-lg bg-surface-overlay/60 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition sm:text-sm ${
                tab === t.id
                  ? "bg-surface-raised text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className="ml-1 text-ink-faint">{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <DocumentDocsModal
        questionNumber={question.question_number}
        title={question.title}
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "problem" && (
          <div className="space-y-5">
            <section>
              <h2 className="section-label">Problem</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {question.business_problem}
              </p>
            </section>

            {question.objective && (
              <section>
                <h2 className="section-label">Objective</h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                  {question.objective}
                </p>
              </section>
            )}

            {question.requirements.length > 0 && (
              <section>
                <h2 className="section-label">Requirements</h2>
                <ul className="space-y-2 text-sm text-ink-muted">
                  {question.requirements.map((r) => (
                    <li key={r} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {question.tables_used.length > 0 && (
              <section>
                <h2 className="section-label">Tables</h2>
                <div className="flex flex-wrap gap-1.5">
                  {question.tables_used.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1 font-mono text-xs text-ink transition hover:border-accent/40 hover:text-accent"
                      onClick={() => setTab("schema")}
                      title="View schema"
                    >
                      <Table2 className="h-3 w-3 text-accent" />
                      {t}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {(question.expected_output || question.expected_columns.length > 0) && (
              <section>
                <h2 className="section-label">Expected output</h2>
                {question.expected_columns.length > 0 && (
                  <p className="mb-2 font-mono text-xs text-ink-muted">
                    {question.expected_columns.join(" · ")}
                  </p>
                )}
                {question.expected_output && (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-surface-border bg-surface p-3 text-[11px] leading-relaxed text-ink-muted">
                    {question.expected_output.slice(0, 1200)}
                  </pre>
                )}
                {question.sort_required && (
                  <p className="mt-2 text-xs text-warn">Row order matters for grading.</p>
                )}
              </section>
            )}

            {(question.concepts_used ?? []).length > 0 && (
              <section>
                <h2 className="section-label">Concepts</h2>
                <div className="flex flex-wrap gap-1.5">
                  {(question.concepts_used ?? []).map((c) => (
                    <span key={c} className="chip">
                      {c}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === "schema" && (
          <div className="space-y-4">
            {schemas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-surface-border px-4 py-10 text-center text-sm text-ink-faint">
                No schema for the listed tables. Check table names, or open Schema for the full
                database.
              </div>
            ) : (
              schemas.map((t) => (
                <div key={t.table_name} className="panel overflow-hidden rounded-xl">
                  <div className="flex items-center gap-2 border-b border-surface-border bg-surface-overlay/50 px-3 py-2">
                    <Table2 className="h-3.5 w-3.5 text-accent" />
                    <span className="font-mono text-sm font-semibold text-ink">
                      {t.table_name}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {t.columns.length} columns
                    </span>
                  </div>
                  <ul className="divide-y divide-surface-border font-mono text-xs">
                    {t.columns.map((c) => (
                      <li
                        key={c.name}
                        className="flex items-center justify-between gap-3 px-3 py-1.5 text-ink-muted"
                      >
                        <span className="text-ink">{c.name}</span>
                        <span className="text-ink-faint">
                          {c.data_type}
                          {c.is_nullable ? "" : " · NOT NULL"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="space-y-4">
            <section>
              <h2 className="section-label">Your attempts</h2>
              {attemptPanel ?? (
                <p className="text-sm text-ink-faint">No attempts yet — run or submit a query.</p>
              )}
            </section>

            <section className="rounded-xl border border-surface-border">
              <div className="flex items-center gap-2 border-b border-surface-border px-3 py-2 text-xs text-ink-faint">
                <Bot className="h-3.5 w-3.5" />
                ChatGPT history
              </div>
              <div className="p-3">
                <HistoricalAttempts questionId={question.id} />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
