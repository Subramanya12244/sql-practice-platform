import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { useHelpOptional } from "./context";
import { loadRegistry } from "./registryLoader";
import type { GlossaryEntry } from "./types";

/**
 * Small "?" button beside a complicated control. Click, Enter or Space opens a short beginner explanation
 * from the glossary (`content/*.ts`); Esc or a click elsewhere closes it. Hover and keyboard focus also show it.
 *
 *   <HelpTooltip id="group-by" label="What does GROUP BY do?" />
 *
 * `label` is the accessible name and must read as a question. The id must exist in a glossary (a test checks).
 */
export function HelpTooltip({ id, label, className = "" }: { id: string; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [entry, setEntry] = useState<GlossaryEntry | null | undefined>(undefined);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const uid = useId();
  const help = useHelpOptional();

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(b.left + b.width / 2 - width / 2, window.innerWidth - width - 12));
    const below = b.bottom + 8;
    const h = pop.current?.offsetHeight ?? 120;
    const top = below + h > window.innerHeight - 8 && b.top - h - 8 > 8 ? b.top - h - 8 : below;
    setPos({ top, left, width });
  }, []);

  useEffect(() => {
    if (!open || entry !== undefined) return;
    let live = true;
    void loadRegistry().then((r) => { if (live) setEntry(r.getGlossaryEntry(id) ?? null); });
    return () => { live = false; };
  }, [open, entry, id]);

  useEffect(() => {
    if (!open) return;
    place();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setPinned(false); btn.current?.focus(); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) { setOpen(false); setPinned(false); }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place, entry]);

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button
        ref={btn}
        type="button"
        data-help-tooltip={id}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        onClick={() => { if (pinned) { setPinned(false); setOpen(false); } else { setPinned(true); setOpen(true); } }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { if (!pinned) setOpen(false); }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => { if (!pinned && !pop.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-faint transition-colors duration-fast hover:text-accent focus-visible:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <CircleHelp className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div
          ref={pop}
          id={uid}
          role="region"
          aria-label={entry?.term ?? label}
          style={pos ? { position: "fixed", top: pos.top, left: pos.left, width: pos.width } : { position: "fixed", visibility: "hidden" }}
          className="z-[60] animate-scale-in rounded-card border border-surface-border bg-surface-raised p-3 text-left text-sm font-normal normal-case leading-relaxed tracking-normal text-ink shadow-soft"
        >
          {entry === undefined && <p className="text-ink-muted">Loading…</p>}
          {entry === null && <p className="text-ink-muted">No explanation available for this yet.</p>}
          {entry && (
            <>
              <p className="font-semibold text-ink">{entry.term}</p>
              <p className="mt-1 text-ink-muted">{entry.short}</p>
              {entry.more && <p className="mt-1.5 text-ink-muted">{entry.more}</p>}
              {entry.section && help && (
                <button type="button" onClick={() => { setOpen(false); setPinned(false); help.openHelp({ sectionId: entry.section, topicId: entry.id }); }}
                  className="mt-2 text-xs font-semibold text-accent hover:underline">
                  Open full help
                </button>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
