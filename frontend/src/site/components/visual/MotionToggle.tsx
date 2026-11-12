import { useEffect, useState } from "react";
import { readMotionPref, useReducedMotion, writeMotionPref, type MotionPref } from "../../lib/visual/motion";

/** "Animations" switch: follow the system setting, always reduce, or always animate. */
export function MotionToggle({ className = "" }: { className?: string }) {
  const [pref, setPref] = useState<MotionPref>("system");
  const reduced = useReducedMotion();
  useEffect(() => {
    // Several toggles can be on one page; keep them in step with the stored choice.
    const sync = () => setPref(readMotionPref());
    sync();
    window.addEventListener("visual-motion", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("visual-motion", sync); window.removeEventListener("storage", sync); };
  }, []);
  return (
    <label title="Reduced motion shows rows as a static before and after view" className={`inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted ${className}`}>Animations
      <select aria-label="Animations" value={pref} onChange={(e) => { const v = e.target.value as MotionPref; setPref(v); writeMotionPref(v); }} className="rounded-md border border-surface-border bg-surface px-1 py-0.5 text-xs text-ink">
        <option value="system">Follow system{reduced ? " (reduced)" : ""}</option><option value="reduce">Reduce motion</option><option value="full">Full motion</option>
      </select>
    </label>
  );
}
