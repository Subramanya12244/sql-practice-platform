/**
 * Shared playback state for every visualizer. Pure: the React hook only feeds it time.
 * A visualizer produces N frames; the player decides which one is current.
 */
export type Provenance = "executed" | "parsed" | "plan" | "estimated" | "conceptual" | "simulated";

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
/** Milliseconds a frame stays on screen at 1x. */
export const BASE_FRAME_MS = 1400;

export interface PlaybackState { index: number; playing: boolean; speed: Speed; count: number }

export const initialPlayback = (count: number): PlaybackState => ({ index: 0, playing: false, speed: 1, count: Math.max(0, count) });

export type PlaybackAction =
  | { type: "play" } | { type: "pause" } | { type: "toggle" } | { type: "next" } | { type: "prev" } | { type: "restart" }
  | { type: "seek"; index: number } | { type: "speed"; speed: Speed } | { type: "tick" } | { type: "count"; count: number };

const clamp = (i: number, count: number) => Math.max(0, Math.min(Math.max(0, count - 1), Math.trunc(i)));

export function playbackReducer(s: PlaybackState, a: PlaybackAction): PlaybackState {
  const last = s.count - 1;
  switch (a.type) {
    case "play": return s.count === 0 ? s : { ...s, playing: true, index: s.index >= last ? 0 : s.index }; // playing from the end starts over
    case "pause": return { ...s, playing: false };
    case "toggle": return playbackReducer(s, { type: s.playing ? "pause" : "play" });
    case "next": return { ...s, index: clamp(s.index + 1, s.count), playing: false };
    case "prev": return { ...s, index: clamp(s.index - 1, s.count), playing: false };
    case "restart": return { ...s, index: 0, playing: false };
    case "seek": return { ...s, index: clamp(a.index, s.count), playing: false };
    case "speed": return { ...s, speed: a.speed };
    case "tick": return s.index >= last ? { ...s, playing: false } : { ...s, index: s.index + 1, playing: s.index + 1 < last };
    case "count": return { ...s, count: Math.max(0, a.count), index: clamp(s.index, a.count), playing: a.count > 0 && s.playing };
  }
}

export const frameDelay = (speed: Speed) => Math.round(BASE_FRAME_MS / speed);

/** Keyboard map used by every player: Space play/pause, arrows step, Home restart, End last frame. */
export function keyAction(key: string): PlaybackAction | null {
  switch (key) {
    case " ": return { type: "toggle" };
    case "ArrowRight": return { type: "next" };
    case "ArrowLeft": return { type: "prev" };
    case "Home": return { type: "restart" };
    case "End": return { type: "seek", index: Number.MAX_SAFE_INTEGER };
    default: return null;
  }
}

export const PROVENANCE_LABEL: Record<Provenance, { label: string; title: string }> = {
  executed: { label: "Executed", title: "Real data from actually running your code in this browser." },
  parsed: { label: "Parsed", title: "Derived from the query text only; nothing was run for this." },
  plan: { label: "Plan · EXPLAIN", title: "PostgreSQL's chosen execution plan for your query." },
  estimated: { label: "Estimated", title: "An estimate from the planner or a static analysis, not a measurement." },
  conceptual: { label: "Conceptual model", title: "A simplified teaching model. It is not a literal view of CPython memory or hardware." },
  simulated: { label: "Simulated", title: "A deterministic simulation with fixed fixtures. No real network or system was used." },
};
