import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { HelpTour, TourStep } from "./types";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6;
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

/** First visible element for the step's selector list; a bad selector is skipped, never thrown. */
export function resolveTarget(step: TourStep): HTMLElement | null {
  for (const sel of [step.target ?? []].flat()) {
    try {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) if (visible(el)) return el;
    } catch { /* invalid selector */ }
  }
  return null;
}

/**
 * Spotlight tour: dims the page, outlines one real element, and shows a card with Previous / Next / Skip / Finish.
 * The page underneath stays clickable so the learner can try the control. Keys (arrows, Esc) work while focus is
 * in the card or on the page body, never while typing in an editor. On narrow screens the card docks to the bottom.
 */
export default function GuidedTour({ tour, onExit, onNavigate }: { tour: HelpTour; onExit: (status: "done" | "skipped") => void; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [cardH, setCardH] = useState(200);
  const card = useRef<HTMLDivElement>(null);
  const step = tour.steps[i];
  const last = i === tour.steps.length - 1;
  const titleId = `tour-title-${tour.id}`;
  const bodyId = `tour-body-${tour.id}`;

  const exit = useCallback((s: "done" | "skipped") => onExit(s), [onExit]);
  const next = useCallback(() => (last ? exit("done") : setI((n) => n + 1)), [last, exit]);
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // Track the target: re-measure on a short interval so lazy-mounted, late-loading and moving elements are followed.
  // The first time a step's element is found it is scrolled into view (it may only appear after a page change).
  const scrolledFor = useRef<string | null>(null);
  const measure = useCallback(() => {
    const el = resolveTarget(step);
    setNarrow(window.innerWidth < 640);
    if (card.current) setCardH(card.current.offsetHeight);
    if (!el) { setRect((r) => (r === null ? r : null)); return; }
    let b = el.getBoundingClientRect();
    if (scrolledFor.current !== step.id) {
      scrolledFor.current = step.id;
      const narrowNow = window.innerWidth < 640;
      if (b.top < 72 || b.bottom > window.innerHeight - (narrowNow ? 240 : 24)) {
        if (narrowNow) window.scrollTo?.({ top: window.scrollY + b.top - 96, behavior: reduced() ? "auto" : "smooth" });
        else el.scrollIntoView?.({ block: "center", behavior: reduced() ? "auto" : "smooth" });
        b = el.getBoundingClientRect();
      }
    }
    setRect((r) => (r && Math.abs(r.top - b.top) < 0.5 && Math.abs(r.left - b.left) < 0.5 && Math.abs(r.width - b.width) < 0.5 && Math.abs(r.height - b.height) < 0.5 ? r : { top: b.top, left: b.left, width: b.width, height: b.height }));
  }, [step]);

  useLayoutEffect(() => {
    measure();
    const t = window.setInterval(measure, 200);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.clearInterval(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step, measure]);

  // A step that lives on another page takes the learner there, unless its element is already on screen.
  const route = step.route ?? tour.route;
  useEffect(() => {
    if (!route || pathname === route || resolveTarget(step)) return;
    onNavigate?.();
    navigate(route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Move focus to the card on every step so keyboard and screen-reader users land on the new text.
  useEffect(() => { card.current?.focus({ preventScroll: true }); }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inCard = !!card.current?.contains(document.activeElement);
      const onBody = document.activeElement === document.body || document.activeElement === null;
      if (!inCard && !onBody) return;
      if (e.key === "Escape") { e.preventDefault(); exit("skipped"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [exit, next, prev]);

  // Card position: docked on phones; otherwise beside the target (below, else above), clamped to the screen.
  const W = 360;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  // A target scrolled out of view (or not scrolled in yet) is treated like a missing one: the card stays centred and reachable.
  const inView = !!rect && rect.top + rect.height > 0 && rect.top < vh && rect.left + rect.width > 0 && rect.left < vw;
  const clampTop = (t: number) => Math.max(12, Math.min(t, vh - cardH - 12));
  let style: React.CSSProperties;
  if (narrow) {
    style = { left: 12, right: 12, bottom: 12 };
  } else if (rect && inView) {
    const spaceBelow = vh - (rect.top + rect.height + PAD);
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - W / 2, vw - W - 12));
    if (spaceBelow >= cardH + 16) style = { left, top: clampTop(rect.top + rect.height + PAD + 12), width: W };
    else if (rect.top - PAD >= cardH + 16) style = { left, top: clampTop(rect.top - PAD - 12 - cardH), width: W };
    else style = { right: 16, bottom: 16, width: W };
  } else {
    style = { left: "50%", top: "50%", width: Math.min(W, vw - 24), transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" data-guided-tour={tour.id}>
      {/* Dim layer with a hole. Without a target, dim everything. */}
      <div
        aria-hidden
        className="absolute rounded-xl transition-all duration-200 ease-out motion-reduce:transition-none"
        style={rect && inView
          ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 9999px rgba(2,6,23,0.6)", outline: "2px solid rgb(var(--color-accent))", outlineOffset: 0 }
          : { top: 0, left: 0, width: 0, height: 0, boxShadow: "0 0 0 9999px rgba(2,6,23,0.6)" }}
        data-tour-spotlight={rect && inView ? "target" : "none"}
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        style={style}
        className="pointer-events-auto absolute max-h-[70vh] overflow-y-auto rounded-card border border-surface-border bg-surface-raised p-4 text-sm text-ink shadow-soft outline-none animate-scale-in"
      >
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent" aria-live="polite">Step {i + 1} of {tour.steps.length}</p>
          <button type="button" onClick={() => exit("skipped")} aria-label="Skip tour" className="ml-auto rounded p-1 text-ink-faint hover:text-ink"><X className="h-4 w-4" aria-hidden /></button>
        </div>
        <div role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={tour.steps.length} aria-valuenow={i + 1} className="mt-2 h-1 overflow-hidden rounded-full bg-surface-soft">
          <div className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none" style={{ width: `${((i + 1) / tour.steps.length) * 100}%` }} />
        </div>
        <h2 id={titleId} className="mt-3 font-display text-base font-bold text-ink">{step.title}</h2>
        <p id={bodyId} className="mt-1 leading-relaxed text-ink-muted">{step.body}</p>
        {step.how && <p className="mt-2 rounded-lg bg-accent-dim px-3 py-2 leading-relaxed text-ink"><span className="font-semibold text-accent">Try it: </span>{step.how}</p>}
        {!(rect && inView) && step.target && <p className="mt-2 text-xs text-ink-faint">This part is not on screen right now. It may be hidden at this window size, still loading, or only appear once you have some data. The step still applies when you see it.</p>}
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={() => exit("skipped")} className="rounded-lg px-2 py-1.5 text-xs font-medium text-ink-faint hover:text-ink">Skip</button>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={prev} disabled={i === 0} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-surface-border px-3 text-sm text-ink-muted hover:text-ink disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
            </button>
            <button type="button" onClick={next} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent hover:brightness-110">
              {last ? "Finish" : "Next"} {!last && <ChevronRight className="h-4 w-4" aria-hidden />}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
