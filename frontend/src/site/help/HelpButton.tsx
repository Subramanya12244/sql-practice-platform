import { CircleHelp } from "lucide-react";
import { useHelpOptional } from "./context";

/** The one `? Help` button, in the header on every page. Opens help for the page the learner is on. */
export function HelpButton({ compact = false }: { compact?: boolean }) {
  const help = useHelpOptional();
  return (
    <button
      type="button"
      data-help="help-button"
      onClick={() => help?.toggleHelp()}
      aria-label="Help"
      aria-haspopup="dialog"
      aria-expanded={help?.open ?? false}
      aria-keyshortcuts="Shift+/"
      title="Help for this page (?)"
      className={compact
        ? "rounded-lg p-2.5 text-ink-muted hover:bg-hover/5 hover:text-ink"
        : "inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-surface-border bg-surface-overlay/60 px-2.5 text-sm font-medium text-ink-muted transition-colors duration-fast hover:border-accent/40 hover:text-ink"}
    >
      <CircleHelp className={compact ? "h-5 w-5" : "h-4 w-4"} aria-hidden />
      {!compact && <span>Help</span>}
    </button>
  );
}
