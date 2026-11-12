import { useHelpOptional } from "./context";
import { resetAllHelpProgress, useHelpProgress } from "./progress";

/** Settings rows for the help system: replay the welcome tour, forget finished tours. */
export function HelpSettings() {
  const help = useHelpOptional();
  const progress = useHelpProgress();
  const finished = Object.values(progress.tours).filter((t) => t.status === "done").length;
  const btn = "min-h-[36px] rounded-lg border border-surface-border px-3 text-sm text-ink-muted hover:border-accent/40 hover:text-ink";
  return (
    <div className="flex flex-wrap items-center gap-3 text-ink">
      <button type="button" className={btn} onClick={() => help?.replayWelcome()}>Replay welcome tour</button>
      <button type="button" className={btn} onClick={() => resetAllHelpProgress()} disabled={!Object.keys(progress.tours).length}>Forget finished tours</button>
      <span className="text-sm text-ink-muted">{finished ? `${finished} guided tour${finished > 1 ? "s" : ""} finished.` : "No guided tours finished yet."} Open Help on any page to start one.</span>
    </div>
  );
}
