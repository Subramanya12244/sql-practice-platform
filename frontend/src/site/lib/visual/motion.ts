/**
 * Reduced-motion preference for visual learning animations. The operating-system setting is the default; a learner can
 * override it with the "Reduce motion" switch (remembered in this browser). Playback timing is not affected: only movement.
 */
import { useEffect, useState } from "react";

const KEY = "sqlp.visual.reduceMotion";
export type MotionPref = "system" | "reduce" | "full";

export function readMotionPref(): MotionPref {
  try { const v = localStorage.getItem(KEY); return v === "reduce" || v === "full" ? v : "system"; } catch { return "system"; }
}
export function writeMotionPref(p: MotionPref) {
  try { if (p === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* preference just won't persist */ }
  window.dispatchEvent(new Event("visual-motion"));
}

/** Pure: should animations be reduced, given the stored preference and the system setting. */
export const shouldReduce = (pref: MotionPref, systemReduces: boolean) => (pref === "reduce" ? true : pref === "full" ? false : systemReduces);

export function useReducedMotion(): boolean {
  const [state, setState] = useState(false);
  useEffect(() => {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const update = () => setState(shouldReduce(readMotionPref(), !!mq?.matches));
    update();
    mq?.addEventListener?.("change", update);
    window.addEventListener("visual-motion", update);
    window.addEventListener("storage", update);
    return () => { mq?.removeEventListener?.("change", update); window.removeEventListener("visual-motion", update); window.removeEventListener("storage", update); };
  }, []);
  return state;
}
