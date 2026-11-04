import { useState, useRef } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileJson,
  Loader2,
  MessageSquare,
  SkipForward,
  Upload,
} from "lucide-react";
import { api } from "../services/api";
import type {
  ConversationSummary,
  ImportSummary,
  PreviewQuestion,
  PreviewResult,
  QuestionImportAction,
  ScanResult,
} from "../types";
import { useToast } from "../components/Toast";

type Step = "upload" | "select" | "preview" | "done";

const DIFFICULTY_COLORS: Record<string, string> = {
  Beginner: "text-green-400 bg-green-900/30",
  Intermediate: "text-sky-400 bg-sky-900/30",
  Advanced: "text-amber-400 bg-amber-900/30",
  Senior: "text-orange-400 bg-orange-900/30",
  Expert: "text-rose-400 bg-rose-900/30",
};

function diffClass(d?: string | null) {
  return d ? (DIFFICULTY_COLORS[d] ?? "text-ink-muted bg-surface-overlay") : "text-ink-muted bg-surface-overlay";
}

export function ImportPage() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [startQ, setStartQ] = useState(59);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [actions, setActions] = useState<Record<number, "import" | "skip" | "update">>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  // -------------------------------------------------------------------------
  // Step 1: Upload + scan
  // -------------------------------------------------------------------------

  async function handleScan() {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const result = await api.scanChatGPT(file);
      setScanResult(result);
      if (result.conversations.length === 0) {
        setError("No conversations found in the file.");
        setLoading(false);
        return;
      }
      setStep("select");
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Select conversation + preview
  // -------------------------------------------------------------------------

  async function handlePreview(convId: string) {
    setSelectedConvId(convId);
    setError(null);
    setLoading(true);
    try {
      const result = await api.previewChatGPT(convId, startQ, file ?? undefined);
      setPreview(result);
      // Default all to "import"; existing ones default to "skip"
      const defaultActions: Record<number, "import" | "skip" | "update"> = {};
      for (const q of result.questions) {
        defaultActions[q.question_number] = q.exists_in_db ? "skip" : "import";
      }
      setActions(defaultActions);
      setStep("preview");
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Confirm import
  // -------------------------------------------------------------------------

  async function handleConfirm() {
    if (!preview || !selectedConvId) return;
    setError(null);
    setLoading(true);
    const questionActions: QuestionImportAction[] = preview.questions.map((q) => ({
      question_number: q.question_number,
      action: actions[q.question_number] ?? "import",
    }));
    try {
      const summary = await api.confirmChatGPT(selectedConvId, startQ, questionActions);
      setImportSummary(summary);
      setStep("done");
      toast.push(
        `Import complete: ${summary.questions_new} new, ${summary.questions_updated} updated`,
        "success",
      );
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function toggleAction(qNum: number, current: "import" | "skip" | "update") {
    const cycle: Array<"import" | "skip" | "update"> = ["import", "skip", "update"];
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    setActions((prev) => ({ ...prev, [qNum]: next }));
  }

  function setAllActions(action: "import" | "skip" | "update") {
    if (!preview) return;
    const all: Record<number, typeof action> = {};
    for (const q of preview.questions) all[q.question_number] = action;
    setActions(all);
  }

  function toggleExpand(qNum: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(qNum)) next.delete(qNum);
      else next.add(qNum);
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Import ChatGPT SQL Practice</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Upload your <code className="text-accent">conversations.json</code> export from
          ChatGPT to import questions, attempts, feedback, mistakes and scores.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        {(["upload", "select", "preview", "done"] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                step === s
                  ? "bg-accent text-white"
                  : "bg-surface-overlay text-ink-muted"
              }`}
            >
              {i + 1}
            </span>
            <span className={step === s ? "text-accent font-medium" : ""}>
              {s === "upload" ? "Upload" : s === "select" ? "Select" : s === "preview" ? "Preview" : "Done"}
            </span>
            {i < 3 && <ChevronRight className="h-3 w-3" />}
          </span>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step: Upload */}
      {/* ------------------------------------------------------------------ */}
      {step === "upload" && (
        <div className="rounded-xl border border-surface-border bg-surface-raised p-6 space-y-5">
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-surface-border p-10 transition hover:border-accent hover:bg-accent-dim/10"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files[0];
              if (dropped) setFile(dropped);
            }}
          >
            <FileJson className="h-10 w-10 text-accent" />
            <div className="text-center">
              <p className="font-medium text-ink">
                {file ? file.name : "Drop conversations.json here"}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MB — click to change`
                  : "or click to browse"}
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFile(f);
              }}
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              Start Question #
              <input
                type="number"
                min={1}
                max={999}
                value={startQ}
                onChange={(e) => setStartQ(Number(e.target.value))}
                className="w-20 rounded-md border border-surface-border bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              />
            </label>
            <span className="text-xs text-ink-faint">
              (Default: 59 — import Q59 and above)
            </span>
          </div>

          <button
            className="btn-primary w-full"
            disabled={!file || loading}
            onClick={handleScan}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Scan Conversations
          </button>

          <div className="rounded-lg bg-surface-overlay p-4 text-xs text-ink-muted space-y-1">
            <p className="font-medium text-ink-faint">How to export from ChatGPT:</p>
            <ol className="ml-3 list-decimal space-y-0.5">
              <li>Open ChatGPT → Settings → Data Controls</li>
              <li>Click "Export data"</li>
              <li>Wait for email with download link</li>
              <li>Extract ZIP and upload <code>conversations.json</code></li>
            </ol>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step: Select conversation */}
      {/* ------------------------------------------------------------------ */}
      {step === "select" && scanResult && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">
              {scanResult.total_found} conversations found
            </h2>
            <span className="text-xs text-ink-muted">
              Select the SQL practice conversation
            </span>
          </div>
          <div className="space-y-2">
            {scanResult.conversations.map((conv) => (
              <ConversationCard
                key={conv.conversation_id}
                conv={conv}
                onSelect={() => handlePreview(conv.conversation_id)}
                loading={loading && selectedConvId === conv.conversation_id}
              />
            ))}
          </div>
          <button className="btn-secondary" onClick={() => setStep("upload")}>
            ← Back
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step: Preview */}
      {/* ------------------------------------------------------------------ */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="rounded-xl border border-surface-border bg-surface-raised p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  {preview.conversation_title}
                </h2>
                <p className="text-sm text-ink-muted">
                  Q{preview.start_question}
                  {preview.end_question ? ` → Q${preview.end_question}` : ""} &bull;{" "}
                  {preview.questions.length} questions detected
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
              {[
                ["Questions", preview.questions.length],
                ["Attempts", preview.total_attempts],
                ["Feedback", preview.total_feedback],
                ["Mistakes", preview.total_mistakes],
                ["Scores", preview.total_scores],
                ["Concepts", preview.total_concepts],
              ].map(([label, val]) => (
                <div key={label as string} className="rounded-lg bg-surface-overlay p-3 text-center">
                  <div className="text-xl font-bold text-accent">{val}</div>
                  <div className="text-[11px] text-ink-faint">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Bulk actions */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">Select all:</span>
            {(["import", "skip", "update"] as const).map((a) => (
              <button
                key={a}
                className="btn-secondary py-0.5 px-2 text-xs"
                onClick={() => setAllActions(a)}
              >
                {a}
              </button>
            ))}
          </div>

          {/* Question list */}
          <div className="space-y-2">
            {preview.questions.map((q) => (
              <PreviewRow
                key={q.question_number}
                q={q}
                action={actions[q.question_number] ?? "import"}
                onToggleAction={() =>
                  toggleAction(q.question_number, actions[q.question_number] ?? "import")
                }
                expanded={expanded.has(q.question_number)}
                onToggleExpand={() => toggleExpand(q.question_number)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button className="btn-secondary" onClick={() => setStep("select")}>
              ← Back
            </button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-muted">
                {Object.values(actions).filter((a) => a === "import").length} to import,{" "}
                {Object.values(actions).filter((a) => a === "update").length} to update,{" "}
                {Object.values(actions).filter((a) => a === "skip").length} to skip
              </span>
              <button
                className="btn-primary"
                disabled={loading}
                onClick={handleConfirm}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step: Done */}
      {/* ------------------------------------------------------------------ */}
      {step === "done" && importSummary && (
        <div className="rounded-xl border border-green-800 bg-green-900/10 p-8 text-center space-y-4">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-400" />
          <h2 className="text-2xl font-bold text-ink">Import Complete</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 max-w-lg mx-auto">
            {[
              ["New questions", importSummary.questions_new],
              ["Updated", importSummary.questions_updated],
              ["Skipped", importSummary.questions_skipped],
              ["Attempts", importSummary.attempts_imported],
              ["Feedback", importSummary.feedback_imported],
              ["Mistakes", importSummary.mistakes_imported],
              ["Concepts", importSummary.concepts_imported],
            ].map(([label, val]) => (
              <div key={label as string} className="rounded-lg bg-surface-overlay p-3">
                <div className="text-2xl font-bold text-accent">{val}</div>
                <div className="text-xs text-ink-muted">{label}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <a href="/questions" className="btn-primary">
              Browse Questions
            </a>
            <button
              className="btn-secondary"
              onClick={() => {
                setStep("upload");
                setFile(null);
                setScanResult(null);
                setPreview(null);
                setImportSummary(null);
              }}
            >
              Import Another
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConversationCard({
  conv,
  onSelect,
  loading,
}: {
  conv: ConversationSummary;
  onSelect: () => void;
  loading: boolean;
}) {
  const pct = Math.round(conv.relevance_score);
  const barColor =
    pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-sky-500";
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-surface-border bg-surface-raised p-4 hover:border-accent/50 transition">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-accent" />
          <span className="font-medium text-ink truncate">{conv.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-muted">
          <span>{conv.message_count} messages</span>
          {conv.q_range_min && (
            <span>
              Q{conv.q_range_min}–Q{conv.q_range_max}
            </span>
          )}
          <span>{conv.sql_block_count} SQL blocks</span>
        </div>
        {conv.match_reasons.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {conv.match_reasons.slice(0, 4).map((r) => (
              <span key={r} className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] text-ink-faint">
                {r}
              </span>
            ))}
          </div>
        )}
        {/* relevance bar */}
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-surface-overlay">
            <div
              className={`h-1.5 rounded-full ${barColor} transition-all`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-ink-muted">{pct}% match</span>
        </div>
      </div>
      <button className="btn-primary shrink-0" onClick={onSelect} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Select"}
      </button>
    </div>
  );
}

function PreviewRow({
  q,
  action,
  onToggleAction,
  expanded,
  onToggleExpand,
}: {
  q: PreviewQuestion;
  action: "import" | "skip" | "update";
  onToggleAction: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const actionColor =
    action === "import"
      ? "text-green-400 bg-green-900/30"
      : action === "update"
        ? "text-amber-400 bg-amber-900/30"
        : "text-ink-faint bg-surface-overlay line-through";

  return (
    <div
      className={`rounded-lg border bg-surface-raised transition ${
        action === "skip" ? "border-surface-border opacity-50" : "border-surface-border"
      }`}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Q number */}
        <span className="shrink-0 font-mono text-sm font-bold text-accent w-10">
          Q{q.question_number}
        </span>

        {/* Title + tags */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-ink truncate">
              {q.title ?? "Untitled"}
            </span>
            {q.exists_in_db && (
              <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
                exists
              </span>
            )}
            {(q.difficulty ?? q.suggested_difficulty) && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${diffClass(q.difficulty ?? q.suggested_difficulty)}`}>
                {q.difficulty ?? `${q.suggested_difficulty} (suggested)`}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex gap-3 text-xs text-ink-faint">
            <span>{q.attempts.length} attempt{q.attempts.length !== 1 ? "s" : ""}</span>
            {q.score_text && <span>Score: {q.score_text}</span>}
            {q.mistake_count > 0 && <span>{q.mistake_count} mistake{q.mistake_count !== 1 ? "s" : ""}</span>}
            {q.concept_count > 0 && <span>{q.concept_count} concept{q.concept_count !== 1 ? "s" : ""}</span>}
          </div>
        </div>

        {/* Action toggle */}
        <button
          className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium ${actionColor} transition`}
          onClick={onToggleAction}
          title="Click to cycle: import → skip → update"
        >
          {action === "skip" ? (
            <span className="flex items-center gap-1">
              <SkipForward className="h-3 w-3" /> skip
            </span>
          ) : action === "update" ? (
            "update"
          ) : (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> import
            </span>
          )}
        </button>

        {/* Expand */}
        <button
          className="shrink-0 text-ink-faint hover:text-ink"
          onClick={onToggleExpand}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-surface-border px-4 py-3 space-y-3 text-xs">
          {q.business_problem && (
            <div>
              <span className="text-ink-faint font-medium">Business Problem:</span>
              <p className="mt-1 text-ink-muted whitespace-pre-line">{q.business_problem.slice(0, 400)}</p>
            </div>
          )}
          {q.attempts.length > 0 && (
            <div>
              <span className="text-ink-faint font-medium">Attempts:</span>
              <div className="mt-1 space-y-1.5">
                {q.attempts.map((a) => (
                  <div key={a.attempt_number} className="rounded bg-surface px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[11px] text-ink-faint">
                        #{a.attempt_number}
                      </span>
                      {a.is_correct === true && (
                        <span className="text-green-400">✓ correct</span>
                      )}
                      {a.is_correct === false && (
                        <span className="text-red-400">✗ incorrect</span>
                      )}
                      {a.score_text && (
                        <span className="text-amber-400">{a.score_text}</span>
                      )}
                    </div>
                    <pre className="text-[11px] text-ink-muted whitespace-pre-wrap overflow-x-auto">
                      {a.sql.slice(0, 200)}
                      {a.sql.length > 200 ? "…" : ""}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
