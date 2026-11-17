/**
 * One place for how long things move. CSS (site.css `--motion-*`, Tailwind `duration-*`) and JavaScript animations (page
 * transition, count-up) all read these numbers; a unit test keeps the three copies equal.
 *
 * What each speed is for:
 *   instant  100 ms  press feedback on buttons and chips
 *   fast     140 ms  hover and focus colour, small toggles, tab and chip state
 *   base     180 ms  card lift, dropdowns and accordions, tab indicator, page transition
 *   enter    220 ms  content arriving: staggered lists, scroll reveal, modal and drawer
 *   slow     280 ms  progress fills and other complex visual changes
 * Everything animates transform, opacity, colour or a progress width. Nothing here loops: a loop is only for a loading or
 * "live" cue, and those stop after a few passes.
 */
export const MOTION = { instant: 100, fast: 140, base: 180, enter: 220, slow: 280 } as const;
export type MotionSpeed = keyof typeof MOTION;

export const EASE = {
  /** Things arriving: fast start, soft landing. */
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** Things moving between two states. */
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
} as const;

/** Stagger between items of a list: small, and capped so the last item is never far behind the first. */
export const STAGGER = { stepMs: 30, maxItems: 6 } as const;

/** The longest a staggered list can take to finish: its last delay plus one item's duration. */
export const staggerSettleMs = MOTION.enter + STAGGER.stepMs * (STAGGER.maxItems - 1);
