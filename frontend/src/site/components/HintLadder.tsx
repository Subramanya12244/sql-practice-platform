import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { InlineMarkdown, Markdown } from "./Markdown";
import type { Question } from "../types";

/**
 * Replace literals and selected column names with blanks, keeping the clause
 * structure: enough to unblock without handing over the answer.
 */
export function solutionSkeleton(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:[^']|'')*'/g, "'___'")
    .replace(/\b\d+(\.\d+)?\b/g, "__")
    .replace(/\bSELECT\b([\s\S]*?)\bFROM\b/gi, (_m, cols: string) => {
      const n = cols.split(",").length;
      return `SELECT ${Array.from({ length: n }, () => "___").join(", ")}\nFROM`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const LEVELS = ["Where to start", "The approach", "Solution skeleton"];

export function HintLadder({ q }: { q: Question }) {
  const [level, setLevel] = useState(0);
  return (
    <div className="rounded-card border border-surface-border bg-surface-raised p-4">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <Lightbulb className="h-4 w-4 text-warn" aria-hidden /> Hints
        <span className="text-xs font-normal text-ink-faint">({level}/3 used)</span>
      </p>
      <ol className="mt-3 space-y-3 text-sm">
        {level >= 1 && (
          <li>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{LEVELS[0]}</p>
            <p className="mt-1 text-ink-muted">
              <InlineMarkdown
                source={`Use ${q.tables.map((t) => `\`${t}\``).join(", ") || "the Northwind tables"}${
                  q.concepts.length ? ` with ${q.concepts.slice(0, 3).join(", ")}` : ""
                }. ${q.watchOutFor ? `Watch out: ${q.watchOutFor}` : ""}`}
              />
            </p>
          </li>
        )}
        {level >= 2 && (
          <li>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{LEVELS[1]}</p>
            <Markdown source={q.approach || q.why || "_No approach notes for this question._"} className="mt-1" />
          </li>
        )}
        {level >= 3 && (
          <li>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{LEVELS[2]}</p>
            <Markdown source={"```sql\n" + solutionSkeleton(q.solution) + "\n```"} className="mt-1" />
          </li>
        )}
      </ol>
      {level < 3 && (
        <button
          type="button"
          onClick={() => setLevel((l) => l + 1)}
          className="mt-3 rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
        >
          Show hint {level + 1}: {LEVELS[level].toLowerCase()}
        </button>
      )}
    </div>
  );
}
