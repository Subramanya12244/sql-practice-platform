import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { Markdown } from "../../components/Markdown";
import { HINT_LEVELS, levelInfo, visibleHints } from "../hints";
import type { ExerciseSession } from "../useExerciseSession";
import type { ExerciseDef, HintLevel } from "../types";
import { btnSecondary, btnPrimary } from "./chrome";

/**
 * Five-level help. Nothing opens by itself. Levels 1 to 4 come from the exercise's hints, one at a time. The solution (level 5) is
 * not in the page until the learner asks for it, and asks twice (a confirm step) while the exercise is unsolved, because it
 * records the exercise as solved with help.
 */
export function ExplanationPanel({ exercise: ex, session: s }: { exercise: ExerciseDef; session: ExerciseSession }) {
  const [confirming, setConfirming] = useState(false);
  const shown = visibleHints(ex, s.hintLevel);
  const next = s.nextHintLevel;
  const lang = ex.domain === "sql" ? "sql" : "python";
  const solution = s.solutionVisible ? ex.solution : undefined;

  const open = (level: HintLevel) => {
    if (level === 5 && !s.solved && !confirming) { setConfirming(true); return; }
    setConfirming(false);
    s.openHint(level);
  };

  return (
    <div className="space-y-4 text-sm" data-testid="workspace-explanation">
      <div>
        <p className="flex items-center gap-1.5 font-semibold text-ink"><Lightbulb className="h-4 w-4 text-warn" aria-hidden /> Help, one level at a time <span className="text-xs font-normal text-ink-faint">(highest opened: {s.hintLevel}/5)</span></p>
        <p className="mt-1 text-xs text-ink-muted">Nothing opens until you ask. Opening level 2 or more before you solve this counts the solve as assisted.</p>
      </div>

      {shown.length > 0 || solution ? (
        <ol aria-label="Opened hints" className="space-y-3">
          {shown.map((h) => (
            <li key={h.level}>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{h.level} · {h.title || levelInfo(h.level)?.label}</p>
              <Markdown source={h.body} className="mt-1 text-ink-muted" />
            </li>
          ))}
          {solution && (
            <li>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">5 · {HINT_LEVELS[4].label}</p>
              <Markdown source={"```" + lang + "\n" + solution.code.replace(/\n+$/, "") + "\n```"} className="mt-1" />
              {solution.alternatives?.map((a, i) => (
                <div key={i} className="mt-2">
                  <p className="text-xs font-medium text-ink">Another way: {a.title}</p>
                  <Markdown source={"```" + lang + "\n" + a.code.replace(/\n+$/, "") + "\n```"} />
                  {a.note && <p className="text-xs text-ink-muted">{a.note}</p>}
                </div>
              ))}
            </li>
          )}
        </ol>
      ) : null}

      {confirming && next === 5 ? (
        <div role="alertdialog" aria-label="Show the full solution?" className="rounded-lg border border-warn/40 bg-warn/5 p-3">
          <p className="text-ink">{ex.source.kind === "daily" ? "Show the full solution? Showing it does not mark the exercise solved: you still need a passing check." : "Show the full solution? This exercise will count as solved with assistance."}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btnPrimary} onClick={() => open(5)}>Yes, show the solution</button>
            <button type="button" className={btnSecondary} onClick={() => setConfirming(false)}>Keep trying</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {next && (
            <button type="button" className={btnSecondary} onClick={() => open(next)}>
              {next === 5 ? (s.solved ? "Compare with the reference solution" : "Show the full solution") : `Show level ${next}: ${levelInfo(next)?.label.toLowerCase()}`}
            </button>
          )}
          {s.solved && next !== null && next !== 5 && s.canOpenLevel(5) && <button type="button" className={btnSecondary} onClick={() => open(5)}>Compare with the reference solution</button>}
        </div>
      )}
      {!next && <p className="text-xs text-ink-faint">{shown.length || solution ? "You have opened every level." : "This exercise has no hints."}</p>}

      {((ex.debugging?.length ?? 0) > 0 || (ex.commonMistakes?.length ?? 0) > 0) && (
        <details className="rounded-lg border border-surface-border bg-surface p-3" data-testid="debugging-guide">
          <summary className="cursor-pointer font-semibold text-ink">If something goes wrong</summary>
          {ex.commonMistakes && ex.commonMistakes.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Common mistakes</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{ex.commonMistakes.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </div>
          )}
          {ex.debugging && ex.debugging.length > 0 && (
            <ul aria-label="Debugging notes" className="mt-2 space-y-2">
              {ex.debugging.map((d, i) => (
                <li key={i} className="rounded-md bg-surface-soft p-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{d.category}</p>
                  <p className="mt-0.5 text-ink"><span className="font-medium">You see:</span> {d.symptom}</p>
                  <p className="text-ink-muted"><span className="font-medium text-ink">Why:</span> {d.cause}</p>
                  <p className="text-ink-muted"><span className="font-medium text-ink">Fix:</span> {d.fix}</p>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}

      {s.explanationVisible && (
        <section aria-label="Explanation" className="space-y-2 rounded-lg border border-surface-border bg-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Why it works</p>
          {ex.solution?.explanation ? <Markdown source={ex.solution.explanation} /> : <p className="text-ink-muted">No written explanation is attached to this exercise.</p>}
          {ex.complexity && (ex.complexity.time || ex.complexity.space) && (
            <p className="text-xs text-ink-muted">Complexity: {[ex.complexity.time && `time ${ex.complexity.time}`, ex.complexity.space && `space ${ex.complexity.space}`].filter(Boolean).join(", ")}{ex.complexity.note ? `. ${ex.complexity.note}` : ""}</p>
          )}
          {ex.interviewRelevance && <p className="text-xs text-ink-muted"><span className="font-medium text-ink">In interviews:</span> {ex.interviewRelevance}</p>}
        </section>
      )}
    </div>
  );
}
