import { useSyncExternalStore } from "react";

/**
 * HelpProgress: which walkthroughs a learner finished and whether onboarding was seen.
 * Kept in localStorage on this device; every access is guarded because storage may be unavailable.
 * Never blocks a visit: when storage is unavailable the learner simply sees the offer again.
 */
export const HELP_KEY = "df.help.v1";

export interface HelpProgress {
  version: 1;
  /** "done" once finished, "skipped" once dismissed. Undefined = never shown. */
  onboarding?: "done" | "skipped";
  onboardingAt?: string;
  tours: Record<string, { status: "done" | "skipped"; at: string }>;
}

const EMPTY: HelpProgress = { version: 1, tours: {} };

let cache: HelpProgress | null = null;
const listeners = new Set<() => void>();

function read(): HelpProgress {
  try {
    const raw = localStorage.getItem(HELP_KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<HelpProgress>;
    if (p && p.version === 1 && typeof p.tours === "object" && p.tours) return { version: 1, tours: p.tours, onboarding: p.onboarding, onboardingAt: p.onboardingAt };
  } catch { /* storage unavailable or corrupt: start empty */ }
  return EMPTY;
}

export function getHelpProgress(): HelpProgress {
  return (cache ??= read());
}

function write(next: HelpProgress) {
  cache = next;
  try { localStorage.setItem(HELP_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

export const setOnboarding = (status: "done" | "skipped") =>
  write({ ...getHelpProgress(), onboarding: status, onboardingAt: new Date().toISOString() });

/** Forget onboarding so the welcome card shows again. */
export function restartOnboarding() {
  const { onboarding: _o, onboardingAt: _a, ...rest } = getHelpProgress();
  void _o; void _a;
  write(rest as HelpProgress);
}

export const setTourStatus = (id: string, status: "done" | "skipped") =>
  write({ ...getHelpProgress(), tours: { ...getHelpProgress().tours, [id]: { status, at: new Date().toISOString() } } });

export function resetTour(id: string) {
  const { [id]: _gone, ...rest } = getHelpProgress().tours;
  void _gone;
  write({ ...getHelpProgress(), tours: rest });
}

export function resetAllHelpProgress() {
  write({ version: 1, tours: {} });
}

/** Test hook: drop the in-memory copy so the next read goes to storage. */
export function _resetHelpProgressCache() {
  cache = null;
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === HELP_KEY) { cache = null; cb(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
};

/** Server and first client render both see EMPTY, so prerendered markup always matches. */
export function useHelpProgress(): HelpProgress {
  return useSyncExternalStore(subscribe, getHelpProgress, () => EMPTY);
}

export const tourDone = (p: HelpProgress, id: string) => p.tours[id]?.status === "done";
