import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ExternalLink, Lightbulb, Tag } from "lucide-react";
import { api } from "../services/api";
import type { MistakeEntry } from "../types";

const CATEGORY_COLORS: Record<string, string> = {
  COUNT_VS_SUM: "bg-rose-900/30 text-rose-400",
  NULL_HANDLING: "bg-violet-900/30 text-violet-400",
  GROUP_BY: "bg-sky-900/30 text-sky-400",
  HAVING: "bg-sky-900/30 text-sky-400",
  JOIN_LOGIC: "bg-amber-900/30 text-amber-400",
  UNION_ALL: "bg-orange-900/30 text-orange-400",
  UNION: "bg-orange-900/30 text-orange-400",
  CTE: "bg-teal-900/30 text-teal-400",
  SUBQUERY: "bg-teal-900/30 text-teal-400",
  ORDERING: "bg-indigo-900/30 text-indigo-400",
  FILTERING: "bg-indigo-900/30 text-indigo-400",
  DUPLICATES: "bg-pink-900/30 text-pink-400",
  AGGREGATION: "bg-lime-900/30 text-lime-400",
  SYNTAX: "bg-red-900/30 text-red-400",
  OTHER: "bg-surface-overlay text-ink-muted",
};

function catClass(cat: string) {
  return CATEGORY_COLORS[cat] ?? "bg-surface-overlay text-ink-muted";
}

// Group mistakes by category
function groupMistakes(mistakes: MistakeEntry[]) {
  const map: Record<string, MistakeEntry[]> = {};
  for (const m of mistakes) {
    (map[m.category] ??= []).push(m);
  }
  return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
}

export function MistakesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["mistakes"],
    queryFn: api.getMistakes,
  });

  const mistakes = data?.mistakes ?? [];
  const grouped = groupMistakes(mistakes);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-ink-muted">Loading mistakes…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-red-400">
        <AlertCircle className="h-5 w-5" />
        <span>{(error as Error).message}</span>
      </div>
    );
  }

  if (mistakes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-muted">
        <Lightbulb className="h-10 w-10 text-accent" />
        <p className="text-lg font-semibold text-ink">No mistakes yet</p>
        <p className="text-sm">
          Import your ChatGPT history to see mistakes extracted from feedback.
        </p>
        <a href="/import/chatgpt" className="btn-primary mt-2">
          Import ChatGPT History
        </a>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Mistake Review</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {mistakes.length} mistake{mistakes.length !== 1 ? "s" : ""} extracted from your
          ChatGPT practice history. Focus on your weak areas.
        </p>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {grouped.slice(0, 4).map(([cat, items]) => (
          <div key={cat} className="rounded-xl border border-surface-border bg-surface-raised p-4">
            <div className="text-2xl font-bold text-accent">{items.length}</div>
            <div className={`mt-1 inline-flex items-center rounded px-1.5 py-0.5 text-xs ${catClass(cat)}`}>
              <Tag className="mr-1 h-3 w-3" />
              {cat.replace(/_/g, " ")}
            </div>
          </div>
        ))}
      </div>

      {/* Groups */}
      {grouped.map(([cat, items]) => (
        <div key={cat} className="rounded-xl border border-surface-border bg-surface-raised overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border bg-surface-overlay/50">
            <div className="flex items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${catClass(cat)}`}>
                {cat.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-ink-muted">{items.length} occurrence{items.length !== 1 ? "s" : ""}</span>
            </div>
          </div>
          <div className="divide-y divide-surface-border">
            {items.map((m, i) => (
              <MistakeRow key={i} mistake={m} />
            ))}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

function MistakeRow({ mistake }: { mistake: MistakeEntry }) {
  return (
    <div className="px-5 py-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink">{mistake.description}</p>
        <a
          href={`/questions/${mistake.question_number}`}
          className="shrink-0 flex items-center gap-1 text-xs text-accent hover:underline"
        >
          Q{mistake.question_number}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {mistake.correction && (
        <div className="rounded-lg bg-green-900/10 border border-green-800/40 px-3 py-2">
          <span className="text-xs font-medium text-green-400">Correction: </span>
          <span className="text-xs text-green-300">{mistake.correction}</span>
        </div>
      )}
      {mistake.question_title && (
        <p className="text-xs text-ink-faint">
          From: <span className="text-ink-muted">{mistake.question_title}</span>
        </p>
      )}
    </div>
  );
}
