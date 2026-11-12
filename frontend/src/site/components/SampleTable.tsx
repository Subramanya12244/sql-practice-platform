const cell = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Compact read-only result table for derived/sample rows. */
export function SampleTable({ columns, rows, caption, max = 20 }: { columns: string[]; rows: unknown[][]; caption?: string; max?: number }) {
  if (!columns.length) return null;
  return (
    <div tabIndex={0} data-help="sample-table" className="overflow-x-auto rounded-lg border border-surface-border">
      <table className="min-w-full text-xs">
        {caption && <caption className="px-2 py-1 text-left text-ink-faint">{caption}</caption>}
        <thead className="bg-surface-soft">
          <tr>{columns.map((c, i) => <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-semibold text-ink-muted">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-surface-border">
          {rows.slice(0, max).map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j} className={`whitespace-nowrap px-2 py-1 font-mono ${v === null ? "italic text-ink-faint" : "text-ink"}`}>{cell(v)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
