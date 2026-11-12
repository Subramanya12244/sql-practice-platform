const CLAUSE_COLOR: Record<string, string> = {
  from: "bg-sky-500/15", where: "bg-amber-500/20", "group by": "bg-emerald-500/15", having: "bg-rose-500/15",
  window: "bg-violet-500/15", select: "bg-indigo-500/15", distinct: "bg-indigo-500/15", "order by": "bg-teal-500/15", limit: "bg-slate-500/15",
};

/** The learner's query with the clause being shown marked, so the words and the animation can be read together. */
export function HighlightedSql({ sql, range, clause, className = "" }: { sql: string; range?: [number, number]; clause?: string; className?: string }) {
  if (!range) return <pre className={`overflow-x-auto rounded-lg bg-surface-soft p-3 font-mono text-xs text-ink ${className}`}>{sql}</pre>;
  return (
    <pre className={`overflow-x-auto rounded-lg bg-surface-soft p-3 font-mono text-xs text-ink-muted ${className}`}>
      {sql.slice(0, range[0])}
      <mark className={`rounded px-0.5 text-ink ${CLAUSE_COLOR[clause ?? ""] ?? "bg-accent-dim"}`}>{sql.slice(range[0], range[1])}</mark>
      {sql.slice(range[1])}
    </pre>
  );
}
