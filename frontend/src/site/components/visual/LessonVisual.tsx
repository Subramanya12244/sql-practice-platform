import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import { PythonTimeMachine } from "./PythonTimeMachine";
import { ExplainPanel } from "./ExplainPanel";
import { sendTo } from "../../lib/handoff";
import type { ExplainContext } from "../../lib/visual/explain";

/**
 * "Watch it run" for one runnable block of a lesson or exercise. Closed by default, so nothing is traced until the learner
 * opens it. It runs the code separately from the lesson's own Run and Check, so grading, progress and completion are
 * never touched.
 */
export function LessonVisual({ lang, code, stdin, ctx, label = "Watch it run" }: { lang: "python" | "sql"; code: string; stdin?: string; ctx?: Omit<ExplainContext, "lang" | "code">; label?: string }) {
  const [open, setOpen] = useState(false);
  const data = lang === "python" && /\b(pandas|numpy)\b/.test(code);
  return (
    <details className="rounded-lg border border-surface-border bg-surface-soft/40 text-sm" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 font-medium text-accent"><Eye className="h-4 w-4" aria-hidden /> {label}</summary>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          {lang === "python"
            ? <PythonTimeMachine code={code} stdin={stdin} mode={data ? "data" : "variables"} />
            : (
              <p className="text-sm text-ink-muted">Step through this query clause by clause, with the rows each step keeps and removes.{" "}
                <Link to="/query-visualizer" onClick={() => sendTo({ tool: "visualizer", a: code })} className="font-semibold text-accent hover:underline">Open it in the Query Cinema</Link>.
                <span className="block text-xs text-ink-faint">The Query Cinema runs on the Northwind sample database; a query written for another dataset may not run there.</span></p>
            )}
          {ctx && <ExplainPanel ctx={{ ...ctx, lang, code }} />}
        </div>
      )}
    </details>
  );
}
