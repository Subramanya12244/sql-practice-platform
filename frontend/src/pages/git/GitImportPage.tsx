import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileUp, History, Upload } from "lucide-react";
import { api } from "../../services/api";
import { useToast } from "../../components/Toast";
import type { GitImportPreview } from "../../types/git";

export function GitImportPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<GitImportPreview | null>(null);
  const [skipDupes, setSkipDupes] = useState(true);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  const history = useQuery({
    queryKey: ["git-import-history"],
    queryFn: api.getGitImportHistory,
  });

  const previewMut = useMutation({
    mutationFn: (file: File) => api.gitImportPreview(file),
    onSuccess: (data) => {
      setPreview(data);
      toast.push(`Parsed ${data.counts.total} exercises`, "success");
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const confirmMut = useMutation({
    mutationFn: () =>
      api.gitImportConfirm({
        preview_id: preview!.preview_id,
        skip_duplicates: skipDupes,
        import_valid_only: true,
      }),
    onSuccess: (data) => {
      toast.push(`Imported ${data.imported} questions`, "success");
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ["git-questions"] });
      void qc.invalidateQueries({ queryKey: ["git-topics"] });
      void qc.invalidateQueries({ queryKey: ["git-progress"] });
      void qc.invalidateQueries({ queryKey: ["git-import-history"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const visibleExercises = useMemo(() => {
    if (!preview) return [];
    if (!showErrorsOnly) return preview.exercises;
    return preview.exercises.filter(
      (e) =>
        e.is_duplicate ||
        (e.errors?.length ?? 0) > 0 ||
        (e.issues || []).some((i) => i.level === "error" || i.level === "duplicate"),
    );
  }, [preview, showErrorsOnly]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl animate-fade-in px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Import Git Questions</h1>
            <p className="page-subtitle">
              Upload Markdown content files. Valid exercises are added to the database question bank —
              no code changes required.
            </p>
          </div>
          <Link to="/git" className="btn-secondary">
            Back to Git Lab
          </Link>
        </div>

        <div className="panel mb-6 p-6">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-card border border-dashed border-surface-border bg-surface-overlay/40 px-6 py-10 transition hover:border-accent/40 hover:bg-accent-dim/30">
            <FileUp className="h-8 w-8 text-accent" />
            <div className="text-center">
              <p className="text-sm font-medium text-ink">Drop a .md file or click to browse</p>
              <p className="mt-1 text-xs text-ink-faint">
                Supports Module / Exercise structure with Title, Type, Difficulty, Task, Expected Answer…
              </p>
            </div>
            <input
              type="file"
              accept=".md,.markdown,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) previewMut.mutate(f);
                e.target.value = "";
              }}
            />
          </label>
          {previewMut.isPending && (
            <p className="mt-3 text-center text-sm text-ink-muted">Parsing Markdown…</p>
          )}
        </div>

        {preview && (
          <div className="mb-8 animate-fade-in space-y-4">
            <div className="panel p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Import Preview</h2>
                  <p className="mt-1 text-xs text-ink-faint">{preview.filename}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={confirmMut.isPending || preview.counts.valid === 0}
                    onClick={() => confirmMut.mutate()}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {confirmMut.isPending ? "Importing…" : "Import valid questions"}
                  </button>
                </div>
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ["Total", preview.counts.total],
                  ["Valid", preview.counts.valid],
                  ["Warnings", preview.counts.warnings],
                  ["Errors", preview.counts.errors],
                  ["Duplicates", preview.counts.duplicates],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-surface-border bg-surface-overlay/50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
                    <p className="mt-1 font-display text-xl font-semibold text-ink">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mb-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="section-label">By difficulty</p>
                  <ul className="space-y-1 text-sm text-ink-muted">
                    {Object.entries(preview.by_difficulty).map(([k, v]) => (
                      <li key={k} className="flex justify-between">
                        <span>{k}</span>
                        <span className="font-mono text-ink">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="section-label">By type</p>
                  <ul className="space-y-1 text-sm text-ink-muted">
                    {Object.entries(preview.by_type).map(([k, v]) => (
                      <li key={k} className="flex justify-between">
                        <span>{k}</span>
                        <span className="font-mono text-ink">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-ink-muted">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={skipDupes}
                    onChange={(e) => setSkipDupes(e.target.checked)}
                  />
                  Skip duplicates
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showErrorsOnly}
                    onChange={(e) => setShowErrorsOnly(e.target.checked)}
                  />
                  Review errors / duplicates only
                </label>
                <span className="text-xs text-ink-faint">
                  {preview.counts.modules} modules detected
                </span>
              </div>
            </div>

            <div className="panel overflow-hidden">
              <div className="table-shell border-0">
                <table className="w-full text-left text-sm">
                  <thead className="table-header">
                    <tr>
                      <th className="px-4 py-2.5">ID</th>
                      <th className="px-4 py-2.5">Title</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Difficulty</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleExercises.map((ex) => {
                      const hasErr =
                        (ex.errors?.length ?? 0) > 0 ||
                        (ex.issues || []).some((i) => i.level === "error");
                      return (
                        <tr key={ex.stable_id} className="border-t border-surface-border">
                          <td className="px-4 py-2.5 font-mono text-[11px] text-ink-faint">
                            {ex.stable_id}
                          </td>
                          <td className="px-4 py-2.5 text-ink">{ex.title || "—"}</td>
                          <td className="px-4 py-2.5 text-ink-muted">{ex.exercise_type}</td>
                          <td className="px-4 py-2.5 text-ink-muted">{ex.difficulty}</td>
                          <td className="px-4 py-2.5">
                            {ex.is_duplicate ? (
                              <span className="inline-flex items-center gap-1 text-xs text-warn">
                                <AlertTriangle className="h-3 w-3" /> Duplicate
                              </span>
                            ) : hasErr ? (
                              <span className="inline-flex items-center gap-1 text-xs text-danger">
                                <AlertTriangle className="h-3 w-3" /> Error
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-success">
                                <CheckCircle2 className="h-3 w-3" /> Valid
                              </span>
                            )}
                            {(ex.issues || [])
                              .filter((i) => i.level !== "duplicate")
                              .slice(0, 2)
                              .map((i, idx) => (
                                <p key={idx} className="mt-0.5 text-[11px] text-ink-faint">
                                  {i.message}
                                </p>
                              ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <div className="panel p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <History className="h-4 w-4 text-accent" />
            Import history
          </h2>
          {!history.data?.length ? (
            <p className="text-sm text-ink-faint">No imports yet.</p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {history.data.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-medium text-ink">{h.filename}</p>
                    <p className="text-xs text-ink-faint">
                      {h.imported_at ? new Date(h.imported_at).toLocaleString() : "—"}
                    </p>
                  </div>
                  <p className="text-xs text-ink-muted">
                    imported {h.imported_count}/{h.total_questions} · skipped {h.skipped_count} ·
                    failed {h.failed_count} · dupes {h.duplicate_count}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
