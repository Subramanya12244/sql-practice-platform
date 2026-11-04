import { useState } from "react";
import { Link } from "react-router-dom";
import { Lightbulb, ShieldCheck } from "lucide-react";
import { InlineMarkdown, Markdown } from "./Markdown";
import { recordHint, useProgress } from "../lib/progress";
import type { Question } from "../types";
import type { NoteMeta } from "../lib/learning";

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

/** Break approach text into separate hints: numbered/bulleted items, else sentences. */
export function approachSteps(approach: string): string[] {
  const items = approach.split("\n").map((l) => l.trim()).filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l)).map((l) => l.replace(/^(\d+[.)]|[-*•])\s+/, ""));
  if (items.length >= 2) return items;
  return approach.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z`])/).map((s) => s.trim()).filter(Boolean);
}

export const LEVELS = [
  { n: 1, label: "Concept", desc: "Which ideas this question needs" },
  { n: 2, label: "First hint", desc: "Where to start" },
  { n: 3, label: "Progressive hints", desc: "One step of the approach at a time" },
  { n: 4, label: "Detailed explanation", desc: "Why it works, pitfalls, and a solution outline" },
  { n: 5, label: "Complete solution", desc: "The reference answer" },
] as const;

/**
 * Five-level assistance. Nothing opens automatically; each level is recorded, and using
 * level 2 or more before solving marks the solve as assisted (never "independent").
 */
export function HintLadder({ q, notes = [] }: { q: Question; notes?: NoteMeta[] }) {
  const progress = useProgress();
  const saved = progress.questions[q.number];
  const settings = progress.tutor ?? { maxLevel: 5, confirmSolution: true };
  const [level, setLevel] = useState(0);
  const [stepsShown, setStepsShown] = useState(1);
  const used = Math.max(level, saved?.hintLevel ?? 0);
  const steps = approachSteps(q.approach || q.why || "");

  const open = (n: number) => {
    if (n === 5 && settings.confirmSolution && !confirm("Show the complete solution? This question will count as solved with assistance.")) return;
    setLevel(n);
    recordHint(q.number, n);
  };
  const next = Math.min(level + 1, settings.maxLevel);
  const solvedIndependently = saved?.solvedAt && !saved.assisted && saved.practiced;

  return (
    <div className="rounded-card border border-surface-border bg-surface-raised p-4">
      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
        <Lightbulb className="h-4 w-4 text-warn" aria-hidden /> Help, one level at a time
        <span className="text-xs font-normal text-ink-faint">(highest used: {used}/5)</span>
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Levels 2–5 mark a later solve as <em>assisted</em>. {solvedIndependently && <span className="inline-flex items-center gap-1 text-success"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> You solved this independently.</span>}
      </p>
      <ol className="mt-3 space-y-4 text-sm">
        {level >= 1 && (
          <li>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">1 · {LEVELS[0].label}</p>
            <p className="mt-1 text-ink-muted">This question practices <strong className="text-ink">{q.concepts.slice(0, 4).join(", ") || q.topicLabel}</strong>.</p>
            {notes.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {notes.map((n) => <li key={n.slug}><Link to={`/notes/${n.slug}`} className="text-accent hover:underline">{n.title}</Link> — <span className="text-ink-muted">{n.description}</span></li>)}
              </ul>
            )}
          </li>
        )}
        {level >= 2 && (
          <li>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">2 · {LEVELS[1].label}</p>
            <p className="mt-1 text-ink-muted">
              <InlineMarkdown source={`Start from ${q.tables.map((t) => `\`${t}\``).join(", ") || "the Northwind tables"}. ${q.watchOutFor ? `Watch out: ${q.watchOutFor}` : ""}`} />
            </p>
          </li>
        )}
        {level >= 3 && steps.length > 0 && (
          <li>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">3 · {LEVELS[2].label} ({Math.min(stepsShown, steps.length)}/{steps.length})</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-muted">
              {steps.slice(0, stepsShown).map((s, i) => <li key={i}><InlineMarkdown source={s} /></li>)}
            </ol>
            {stepsShown < steps.length && level === 3 && (
              <button type="button" onClick={() => setStepsShown((n) => n + 1)} className="mt-1 text-xs font-medium text-accent hover:underline">Next hint →</button>
            )}
          </li>
        )}
        {level >= 4 && (
          <li>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">4 · {LEVELS[3].label}</p>
            {q.why && <Markdown source={q.why} className="mt-1" />}
            {q.pitfalls.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-ink-muted">{q.pitfalls.slice(0, 3).map((p, i) => <li key={i}><InlineMarkdown source={p} /></li>)}</ul>
            )}
            <Markdown source={"```sql-syntax\n" + solutionSkeleton(q.solution) + "\n```"} className="mt-2" />
          </li>
        )}
        {level >= 5 && (
          <li>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">5 · {LEVELS[4].label}</p>
            <Markdown source={"```sql\n" + q.solution + "\n```"} className="mt-1" />
          </li>
        )}
      </ol>
      {level < settings.maxLevel ? (
        <button
          type="button"
          onClick={() => (level === 3 && stepsShown < steps.length ? setStepsShown(steps.length) : open(next))}
          className="mt-3 rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
        >
          {level === 0 ? "Show level 1: concept" : `Show level ${next}: ${LEVELS[next - 1].label.toLowerCase()}`}
        </button>
      ) : (
        level < 5 && <p className="mt-3 text-xs text-ink-faint">Your tutor settings stop at level {settings.maxLevel}. Change them on the AI tutor page.</p>
      )}
    </div>
  );
}
