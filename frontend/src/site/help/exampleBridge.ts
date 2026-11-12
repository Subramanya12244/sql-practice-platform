import { useEffect, useRef } from "react";
import type { HelpExample } from "./types";

/**
 * Try Example bridge. An editor that can safely receive an example registers a listener while it is mounted.
 *
 * Contract for listeners (the page that owns the editor):
 *  - NEVER replace learner code silently. Either load into a place that holds no learner work (e.g. a new
 *    "help_example.py" file) or report `dirty: true` so the panel asks the learner first.
 *  - `load` is only called after that decision.
 */
export interface ExampleListener {
  kind: HelpExample["target"];
  /** True when loading would replace code the learner may care about. Checked right before loading. */
  isDirty: () => boolean;
  load: (example: HelpExample) => void;
  /** Short name for messages, e.g. "the SQL editor". */
  label: string;
}

const listeners = new Set<ExampleListener>();
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

export function registerExampleListener(l: ExampleListener): () => void {
  listeners.add(l);
  notify();
  return () => { listeners.delete(l); notify(); };
}

export const findExampleListener = (kind: HelpExample["target"]) =>
  [...listeners].reverse().find((l) => l.kind === kind);

export const onExampleListenersChange = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

/** An example that was requested before its editor was on screen (the panel navigated first). */
let pending: { example: HelpExample; at: number } | null = null;
export const setPendingExample = (example: HelpExample) => { pending = { example, at: Date.now() }; };
export const clearPendingExample = () => { pending = null; };
/** Pending examples expire so a stale one never loads minutes later. */
export function takePendingExample(kind: HelpExample["target"], maxAgeMs = 15_000): HelpExample | null {
  if (!pending || pending.example.target !== kind || Date.now() - pending.at > maxAgeMs) return null;
  const { example } = pending;
  pending = null;
  return example;
}

/**
 * Editors call this once. `isDirty` and `load` may be recreated on every render; the latest ones are used.
 * A pending example (requested from another page, then navigated) is loaded right after the editor mounts.
 */
export function useHelpExample(kind: HelpExample["target"], label: string, api: { isDirty: () => boolean; load: (e: HelpExample) => void; ready?: boolean }) {
  const ref = useRef(api);
  ref.current = api;
  const ready = api.ready ?? true;
  useEffect(() => {
    if (!ready) return;
    return registerExampleListener({ kind, label, isDirty: () => ref.current.isDirty(), load: (e) => ref.current.load(e) });
  }, [kind, label, ready]);
  useEffect(() => {
    if (!ready) return;
    // The learner chose "Try example" on another page and was sent here. The editor has just mounted and
    // nothing has been typed yet, so loading is not destructive (editors that restore saved work load into a new file).
    const p = takePendingExample(kind);
    if (p) ref.current.load(p);
  }, [kind, ready]);
}
