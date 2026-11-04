import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Search, X } from "lucide-react";
import type { SearchDoc } from "../lib/searchIndex";

/** ⌘K / Ctrl+K search across notes, patterns, maps, guides, shortcuts and questions. */
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [docs, setDocs] = useState<SearchDoc[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [results, setResults] = useState<SearchDoc[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const searchFn = useRef<typeof import("../lib/searchIndex").search>();

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (!docs) import("../lib/searchIndex").then(async (m) => { searchFn.current = m.search; setDocs(await m.buildIndex()); });
  }, [open, docs]);

  useEffect(() => {
    if (docs && searchFn.current) setResults(searchFn.current(docs, q));
    setSel(0);
  }, [q, docs]);

  if (!open) return null;
  const go = (d: SearchDoc) => {
    onClose();
    setQ("");
    navigate(d.path);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-card border border-surface-border bg-surface-raised shadow-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-surface-border px-3">
          <Search className="h-4 w-4 text-ink-faint" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter" && results[sel]) go(results[sel]);
            }}
            placeholder="Search notes, patterns, questions, syntax…"
            aria-label="Search the site"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-results"
            className="min-w-0 flex-1 bg-transparent py-3 text-sm text-ink outline-none"
          />
          {!docs && <Loader2 className="h-4 w-4 animate-spin text-ink-faint" aria-label="Loading index" />}
          <button type="button" onClick={onClose} aria-label="Close search" className="rounded p-1 text-ink-faint hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <ul id="search-results" role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
          {results.map((d, i) => (
            <li key={`${d.kind}-${d.path}`} role="option" aria-selected={i === sel}>
              <button type="button" onMouseEnter={() => setSel(i)} onClick={() => go(d)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === sel ? "bg-accent-dim" : ""}`}>
                <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.kind}</span>
                <span className="truncate text-ink">{d.title}</span>
              </button>
            </li>
          ))}
          {q && docs && !results.length && <li className="px-3 py-4 text-sm text-ink-muted">No results for “{q}”.</li>}
          {!q && <li className="px-3 py-4 text-sm text-ink-muted">Try “left join”, “lag”, “duplicates” or “Q25”.</li>}
        </ul>
      </div>
    </div>
  );
}
