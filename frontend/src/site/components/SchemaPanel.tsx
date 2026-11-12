import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Key, Link2, Table2 } from "lucide-react";
import type { SchemaTable } from "../types";
import { HelpTooltip } from "../help/HelpTooltip";

/** Compact table/column reference shown beside the editor. Question tables come first and open. */
export function SchemaPanel({ schema, highlight = [] }: { schema: SchemaTable[]; highlight?: string[] }) {
  const ordered = [
    ...highlight.map((h) => schema.find((t) => t.name === h)).filter((t): t is SchemaTable => !!t),
    ...schema.filter((t) => !highlight.includes(t.name)),
  ];
  const [open, setOpen] = useState<Set<string>>(() => new Set(highlight));
  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div data-help="schema-panel" className="rounded-card border border-surface-border bg-surface-raised shadow-panel">
      <div className="flex items-center justify-between border-b border-surface-border px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
          <Table2 className="h-3.5 w-3.5" aria-hidden /> Schema <HelpTooltip id="schema-explorer" label="What is the schema explorer?" />
        </p>
        <Link to="/schema" className="text-xs font-medium text-accent hover:underline">ER diagram</Link>
      </div>
      <ul className="max-h-[360px] divide-y divide-surface-border overflow-y-auto">
        {ordered.map((t) => {
          const isOpen = open.has(t.name);
          const used = highlight.includes(t.name);
          return (
            <li key={t.name}>
              <button
                type="button"
                onClick={() => toggle(t.name)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover/5"
              >
                <ChevronDown className={`h-3.5 w-3.5 text-ink-faint transition-transform duration-base ease-out ${isOpen ? "" : "-rotate-90"}`} aria-hidden />
                <code className={`font-mono ${used ? "font-semibold text-accent" : "text-ink"}`}>{t.name}</code>
                {used && <span className="rounded bg-accent-dim px-1.5 text-[10px] font-semibold text-accent">used here</span>}
                <span className="ml-auto text-xs text-ink-faint">{t.columns.length} cols</span>
              </button>
              <div className="collapse-grid" data-open={isOpen ? "true" : "false"} {...(isOpen ? {} : { inert: "" })} aria-hidden={!isOpen}>
                <ul className="pb-2 pl-9 pr-3">
                  {t.columns.map((c) => (
                    <li key={c.name} className="flex items-center gap-2 py-0.5 font-mono text-xs">
                      <span className="w-3.5 shrink-0">
                        {c.pk ? <Key className="h-3 w-3 text-warn" aria-label="Primary key" /> : c.fk ? <Link2 className="h-3 w-3 text-accent" aria-label="Foreign key" /> : null}
                      </span>
                      <span className="text-ink">{c.name}</span>
                      <span className="text-ink-faint">{c.type}</span>
                      {c.fk && <span className="ml-auto truncate text-ink-faint">→ {c.fk.table}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
