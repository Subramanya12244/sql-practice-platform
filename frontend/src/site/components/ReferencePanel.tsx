import { useEffect, useMemo, useState } from "react";
import { Copy, Search, X } from "lucide-react";
import { loadShortcuts, type ShortcutCategory } from "../lib/learning";

/**
 * Searchable SQL reference beside the editor, built from the shortcuts library
 * (content/shortcuts/*.json). Static documentation; nothing is generated.
 */
export function ReferencePanel({ onClose, onInsert }: { onClose: () => void; onInsert?: (text: string) => void }) {
  const [cats, setCats] = useState<ShortcutCategory[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    void loadShortcuts().then(setCats).catch(() => setCats([]));
  }, []);
  const items = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (cats ?? []).flatMap((c) => c.items.map((i) => ({ ...i, cat: c.title })))
      .filter((i) => words.every((w) => `${i.operation} ${i.syntax} ${i.explanation} ${i.cat}`.toLowerCase().includes(w)))
      .slice(0, 40);
  }, [cats, q]);

  return (
    <aside aria-label="SQL reference" className="flex h-full min-h-0 flex-col border-l border-surface-border bg-surface">
      <div className="flex items-center gap-2 border-b border-surface-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Reference</span>
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-ink-muted hover:bg-hover/5 hover:text-ink" aria-label="Close reference"><X className="h-4 w-4" /></button>
      </div>
      <label className="relative mx-3 my-2 block">
        <span className="sr-only">Search SQL reference</span>
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: window, coalesce, date…"
          className="w-full rounded-lg border border-surface-border bg-surface-raised py-1.5 pl-8 pr-2 text-sm text-ink outline-none focus:border-accent" />
      </label>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {cats === null && <li className="text-xs text-ink-muted">Loading…</li>}
        {cats && !items.length && <li className="text-xs text-ink-muted">Nothing matches "{q}".</li>}
        {items.map((i) => (
          <li key={i.id} className="rounded-lg border border-surface-border bg-surface-raised p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-ink">{i.operation}</p>
              <span className="shrink-0 text-[10px] text-ink-faint">{i.cat}</span>
            </div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-surface-overlay px-2 py-1 font-mono text-[11px] text-accent">{i.syntax}</pre>
            <p className="mt-1 text-xs text-ink-muted">{i.explanation}</p>
            <div className="mt-1.5 flex gap-2 text-[11px]">
              <button type="button" className="inline-flex items-center gap-1 text-ink-muted hover:text-ink" onClick={() => void navigator.clipboard?.writeText(i.example)}><Copy className="h-3 w-3" aria-hidden /> Copy example</button>
              {onInsert && <button type="button" className="text-accent hover:underline" onClick={() => onInsert(i.example)}>Insert into editor</button>}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
