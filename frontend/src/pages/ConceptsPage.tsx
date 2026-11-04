import { useQuery } from "@tanstack/react-query";
import { AlertCircle, BookOpen, BrainCircuit } from "lucide-react";
import { api } from "../services/api";
import type { ConceptEntry } from "../types";

const CONCEPT_CATEGORY_HINTS: Record<string, string> = {
  "CTE": "Common Table Expressions",
  "ADVANCED CTE": "Recursive and multi-step CTEs",
  "SUBQUERY": "Nested SELECT statements",
  "CORRELATED SUBQUERY": "Subqueries referencing outer query",
  "WINDOW FUNCTIONS": "ROW_NUMBER, RANK, LAG, LEAD",
  "CONDITIONAL AGGREGATION": "SUM(CASE), COUNT(CASE)",
  "UNION ALL": "Combining result sets without dedup",
  "UNION": "Combining result sets with dedup",
  "SELF JOIN": "Joining a table with itself",
  "CROSS JOIN": "Cartesian product of tables",
  "GROUP BY": "Aggregation grouping",
  "HAVING": "Filter on aggregated results",
  "NULL HANDLING": "COALESCE, IS NULL, NULLIF",
  "DISTINCT": "Remove duplicate rows",
  "COUNT_VS_SUM": "COUNT vs SUM in CASE expressions",
};

function getCategory(name: string): string {
  const n = name.toUpperCase();
  if (n.includes("JOIN")) return "Joins";
  if (n.includes("CTE") || n.includes("SUBQUERY")) return "CTEs & Subqueries";
  if (n.includes("WINDOW") || n.includes("ROW_NUMBER") || n.includes("RANK") || n.includes("LAG") || n.includes("LEAD")) return "Window Functions";
  if (n.includes("AGGREG") || n.includes("SUM") || n.includes("COUNT") || n.includes("GROUP") || n.includes("HAVING") || n.includes("CONDITIONAL")) return "Aggregation";
  if (n.includes("UNION") || n.includes("INTERSECT") || n.includes("EXCEPT")) return "Set Operations";
  if (n.includes("NULL") || n.includes("COALESCE")) return "Null Handling";
  return "Other";
}

function groupConcepts(concepts: ConceptEntry[]) {
  const map: Record<string, ConceptEntry[]> = {};
  for (const c of concepts) {
    const cat = getCategory(c.name);
    (map[cat] ??= []).push(c);
  }
  return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
}

export function ConceptsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["concepts"],
    queryFn: api.getConcepts,
  });

  const concepts = data?.concepts ?? [];
  const grouped = groupConcepts(concepts);
  const maxCount = Math.max(...concepts.map((c) => c.question_count), 1);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-ink-muted">Loading concepts…</div>
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

  if (concepts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-muted">
        <BrainCircuit className="h-10 w-10 text-accent" />
        <p className="text-lg font-semibold text-ink">No concepts yet</p>
        <p className="text-sm">
          Import your ChatGPT history to extract SQL concepts discussed.
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
        <h1 className="text-2xl font-bold text-ink">SQL Concepts</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {concepts.length} concept{concepts.length !== 1 ? "s" : ""} extracted from your
          practice history. Bar shows relative frequency across questions.
        </p>
      </div>

      {grouped.map(([category, items]) => (
        <div key={category} className="rounded-xl border border-surface-border bg-surface-raised overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-border bg-surface-overlay/40">
            <BookOpen className="h-4 w-4 text-accent" />
            <span className="font-medium text-ink">{category}</span>
            <span className="text-xs text-ink-muted">{items.length} concept{items.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="divide-y divide-surface-border">
            {items
              .sort((a, b) => b.question_count - a.question_count)
              .map((c) => (
                <ConceptRow key={c.id} concept={c} maxCount={maxCount} />
              ))}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

function ConceptRow({
  concept,
  maxCount,
}: {
  concept: ConceptEntry;
  maxCount: number;
}) {
  const pct = maxCount > 0 ? Math.round((concept.question_count / maxCount) * 100) : 0;
  const hint = CONCEPT_CATEGORY_HINTS[concept.name.toUpperCase()];

  return (
    <div className="px-5 py-3 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-mono text-sm font-semibold text-accent">
            {concept.name}
          </span>
          {hint && <span className="ml-2 text-xs text-ink-faint">{hint}</span>}
        </div>
        <span className="shrink-0 text-xs text-ink-muted">
          {concept.question_count} question{concept.question_count !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 rounded-full bg-surface-overlay">
          <div
            className="h-2 rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-8 text-right text-[11px] text-ink-faint">{pct}%</span>
      </div>
      {concept.description && (
        <p className="text-xs text-ink-faint line-clamp-2">{concept.description}</p>
      )}
    </div>
  );
}
