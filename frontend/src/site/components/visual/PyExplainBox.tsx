import { useEffect, useState } from "react";
import { LessonVisual } from "./LessonVisual";

/**
 * Explain visually for a Python practice exercise. It traces the code from the learner's latest Run or Check. Exercises are
 * usually functions, so the code can be edited here (for example to add a call) without touching the editor or the grader.
 */
export function PyExplainBox({ code, topic, prompt }: { code: string; topic?: string; prompt?: string }) {
  const [text, setText] = useState(code);
  useEffect(() => setText(code), [code]);
  return (
    <section aria-label="Explain your solution" className="space-y-2 rounded-card border border-surface-border bg-surface-raised p-3 text-sm">
      <label className="block text-xs font-semibold text-ink-muted">Code to explain (your latest run; add a call such as <code>print(my_function(3))</code> to watch a function run)
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(12, text.split("\n").length + 1)} spellCheck={false} className="mt-1 w-full rounded-lg border border-surface-border bg-surface-soft p-2 font-mono text-xs text-ink" />
      </label>
      <LessonVisual key={text} lang="python" code={text} label="Explain visually" ctx={{ topic, prompt }} />
    </section>
  );
}
