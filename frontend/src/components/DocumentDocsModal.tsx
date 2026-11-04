import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FileText, Files, Github, Loader2, X } from "lucide-react";
import { api } from "../services/api";
import { useToast } from "./Toast";

type Preview = {
  question_number: number;
  md_path: string;
  sql_path: string;
  markdown: string;
  sql: string;
  message: string;
};

interface Props {
  questionNumber: number;
  title: string;
  open: boolean;
  onClose: () => void;
}

export function DocumentDocsModal({ questionNumber, title, open, onClose }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [sql, setSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"md" | "sql">("md");
  const [pushToGithub, setPushToGithub] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setPreview(null);
    setMarkdown("");
    setSql("");
    setDirty(false);
    setTab("md");
    setPushToGithub(true);

    api
      .previewGithubDocs(questionNumber)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setMarkdown(data.markdown);
        setSql(data.sql);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, questionNumber]);

  const approve = useMutation({
    mutationFn: () =>
      api.confirmGithubDocs(questionNumber, pushToGithub, { markdown, sql }),
    onSuccess: (data) => {
      toast.push(data.message, "success");
      void qc.invalidateQueries({ queryKey: ["question"] });
      void qc.invalidateQueries({ queryKey: ["questions"] });
      void qc.invalidateQueries({ queryKey: ["progress"] });
      onClose();
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const copyText = async (label: string, text: string) => {
    if (!text.trim()) {
      toast.push(`Nothing to copy for ${label}`, "info");
      return;
    }
    await navigator.clipboard.writeText(text);
    toast.push(`${label} copied`, "info");
  };

  const copyBoth = async () => {
    if (!preview) return;
    const bundle = [
      `# ${preview.md_path}`,
      "",
      markdown,
      "",
      "---",
      "",
      `# ${preview.sql_path}`,
      "",
      sql,
      "",
    ].join("\n");
    await navigator.clipboard.writeText(bundle);
    toast.push("Markdown + SQL copied", "info");
  };

  if (!open) return null;

  const activeValue = tab === "md" ? markdown : sql;
  const setActiveValue = (value: string) => {
    setDirty(true);
    if (tab === "md") setMarkdown(value);
    else setSql(value);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close preview"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-surface-border bg-surface-raised shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-surface-border px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Review docs before writing
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              Q{questionNumber} — {title}
              {dirty && (
                <span className="ml-2 text-warn">· edited</span>
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-ink-faint hover:bg-surface-overlay hover:text-ink"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex items-center gap-2 py-12 text-sm text-ink-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating .md and .sql preview…
            </div>
          )}

          {loadError && (
            <p className="rounded border border-rose-900/50 bg-rose-900/20 p-3 text-sm text-rose-400">
              {loadError}
            </p>
          )}

          {preview && (
            <>
              <div className="mb-3 space-y-1 rounded border border-surface-border bg-surface-overlay/60 p-3 text-xs text-ink-muted">
                <p className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-accent" />
                  <span className="text-ink-faint">Markdown:</span>
                  <span className="font-mono text-ink">{preview.md_path}</span>
                </p>
                <p className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-sky-400" />
                  <span className="text-ink-faint">SQL:</span>
                  <span className="font-mono text-ink">{preview.sql_path}</span>
                </p>
                <p className="text-[11px] text-ink-faint">
                  Edit either file below before approving. Edited SQL also updates the
                  graded reference solution.
                </p>
              </div>

              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={`rounded px-3 py-1 text-xs ${
                      tab === "md"
                        ? "bg-accent/20 text-accent"
                        : "text-ink-muted hover:bg-surface-overlay"
                    }`}
                    onClick={() => setTab("md")}
                  >
                    Markdown
                  </button>
                  <button
                    type="button"
                    className={`rounded px-3 py-1 text-xs ${
                      tab === "sql"
                        ? "bg-accent/20 text-accent"
                        : "text-ink-muted hover:bg-surface-overlay"
                    }`}
                    onClick={() => setTab("sql")}
                  >
                    SQL
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void copyText(".md", markdown)}
                    title="Copy markdown"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy .md
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void copyText(".sql", sql)}
                    title="Copy SQL"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy .sql
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void copyBoth()}
                    title="Copy both files"
                  >
                    <Files className="h-3.5 w-3.5" />
                    Copy both
                  </button>
                </div>
              </div>

              <textarea
                className="field-input max-h-[45vh] min-h-[280px] resize-y font-mono text-xs leading-relaxed"
                value={activeValue}
                onChange={(e) => setActiveValue(e.target.value)}
                spellCheck={false}
                aria-label={tab === "md" ? "Edit markdown" : "Edit SQL"}
              />
            </>
          )}
        </div>

        <div className="border-t border-surface-border px-4 py-3">
          <label className="mb-3 flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={pushToGithub}
              onChange={(e) => setPushToGithub(e.target.checked)}
              disabled={!preview || approve.isPending}
            />
            Push to GitHub on approve
            <Github className="h-3.5 w-3.5" />
          </label>
          <p className="mb-3 text-[11px] text-ink-faint">
            Approve writes your edited .md and .sql locally and pushes them to{" "}
            <code className="text-ink-muted">GITHUB_REPOSITORY</code> automatically
            (needs <code className="text-ink-muted">GITHUB_TOKEN</code>). Uncheck to
            write locally only.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!preview || approve.isPending || !markdown.trim() || !sql.trim()}
              onClick={() => approve.mutate()}
            >
              {approve.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {pushToGithub ? "Approve & Push" : "Approve locally"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
