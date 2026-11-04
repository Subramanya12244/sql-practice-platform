import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Bot, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { api } from "../services/api";
import type { ImportedAttempt } from "../types";

const FEEDBACK_COLORS: Record<string, string> = {
  correct: "text-green-400",
  incorrect: "text-red-400",
  partial: "text-amber-400",
  hint: "text-sky-400",
  concept_explanation: "text-violet-400",
  mistake: "text-rose-400",
  optimization: "text-teal-400",
  encouragement: "text-lime-400",
  general: "text-ink-muted",
};

export function HistoricalAttempts({ questionId }: { questionId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["imported-attempts", questionId],
    queryFn: () => api.getImportedAttempts(questionId),
    enabled: questionId > 0,
  });

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-ink-muted">
        <div className="h-3 w-3 animate-spin rounded-full border border-accent border-t-transparent" />
        Loading historical attempts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-red-400">
        <AlertCircle className="h-3 w-3" />
        {(error as Error).message}
      </div>
    );
  }

  const attempts = data?.attempts ?? [];

  if (attempts.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-ink-faint">
        No ChatGPT history for this question.{" "}
        <a href="/import/chatgpt" className="text-accent hover:underline">
          Import your history
        </a>
      </div>
    );
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {attempts.map((att) => (
        <HistoricalAttemptRow
          key={att.id}
          attempt={att}
          expanded={expanded.has(att.id)}
          onToggle={() => toggle(att.id)}
        />
      ))}
    </div>
  );
}

function HistoricalAttemptRow({
  attempt,
  expanded,
  onToggle,
}: {
  attempt: ImportedAttempt;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isCorrect = attempt.is_correct;
  const borderColor =
    isCorrect === true
      ? "border-green-800"
      : isCorrect === false
        ? "border-red-800"
        : "border-surface-border";

  return (
    <div className={`rounded-lg border bg-surface-raised ${borderColor}`}>
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={onToggle}
      >
        <Bot className="h-4 w-4 shrink-0 text-accent" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-ink-muted">
              Attempt #{attempt.attempt_number}
            </span>
            {isCorrect === true && (
              <span className="rounded bg-green-900/30 px-1.5 py-0.5 text-[10px] text-green-400">
                ✓ Correct
              </span>
            )}
            {isCorrect === false && (
              <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-[10px] text-red-400">
                ✗ Incorrect
              </span>
            )}
            {attempt.score_text && (
              <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
                {attempt.score_text}
              </span>
            )}
            <span className="ml-auto rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] text-ink-faint">
              from ChatGPT
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-surface-border px-4 py-3 space-y-3 text-xs">
          {/* Approach notes */}
          {attempt.approach_notes && (
            <div className="rounded-lg bg-surface-overlay/50 px-3 py-2">
              <span className="font-medium text-ink-faint">Approach: </span>
              <span className="italic text-ink-muted">{attempt.approach_notes}</span>
            </div>
          )}

          {/* SQL */}
          <div>
            <span className="font-medium text-ink-faint">SQL:</span>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-ink-muted whitespace-pre-wrap">
              {attempt.sql}
            </pre>
          </div>

          {/* Feedback */}
          {attempt.feedbacks.length > 0 && (
            <div>
              <span className="font-medium text-ink-faint">Feedback:</span>
              <div className="mt-1 space-y-1">
                {attempt.feedbacks.map((fb, i) => (
                  <div key={i} className="rounded-lg bg-surface-overlay px-3 py-2">
                    <span
                      className={`text-[10px] font-medium uppercase ${
                        FEEDBACK_COLORS[fb.feedback_type] ?? "text-ink-muted"
                      }`}
                    >
                      {fb.feedback_type}
                    </span>
                    <p className="mt-0.5 text-ink-muted">{fb.feedback_text.slice(0, 600)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mistakes */}
          {attempt.mistakes.length > 0 && (
            <div>
              <span className="font-medium text-ink-faint">Mistakes:</span>
              <div className="mt-1 space-y-1">
                {attempt.mistakes.map((m, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-red-900/50 bg-red-900/10 px-3 py-2"
                  >
                    <span className="text-[10px] font-medium text-red-400 uppercase">
                      {m.category.replace(/_/g, " ")}
                    </span>
                    <p className="mt-0.5 text-red-300/80">{m.description}</p>
                    {m.correction && (
                      <p className="mt-1 text-green-400">
                        <span className="font-medium">Fix: </span>
                        {m.correction}
                      </p>
                    )}
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
