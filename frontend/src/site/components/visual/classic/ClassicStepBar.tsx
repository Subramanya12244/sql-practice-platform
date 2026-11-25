/**
 * A one-line step bar for the SQL Practice visualizer: Previous, Play/Pause, Next and the current step label.
 * It is a second VIEW of the same playback the full ClassicPlayer drives (every button dispatches a reducer action, nothing here keeps a
 * step or a timer) and it appears only after the full player has scrolled out of view, so it never covers the board or the rows in the
 * normal position and never takes room in the page (it is absolutely placed inside the visualizer root, which is its containing block).
 *
 * Why it follows the scroll by script and not with `position: sticky`: the page scrolls in two different places. On a desktop the question
 * pane scrolls inside itself; on a phone the document scrolls while the pane element (overflow-y: auto, but no fixed height) does not, and
 * `sticky` binds to that non-scrolling element and never sticks. So the bar finds the scroll area that really scrolls, takes its top edge
 * (or the bottom of the site's sticky header when the document scrolls), and keeps itself just under that edge while the visualizer is in view.
 * Button names differ from the player's on purpose, so a screen reader and a test can tell the two sets apart.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { usePlayback } from "../Playback";

const BAR_H = 36;

/** The nearest ancestor that really scrolls vertically right now, or null when the document does the scrolling. */
function scrollArea(from: HTMLElement | null): HTMLElement | null {
  for (let e = from?.parentElement ?? null; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1) return e;
  }
  return null;
}

/** Where the visible area starts: the top of the scrolling pane, or the bottom of a sticky or fixed site header above the document. */
function topEdge(area: HTMLElement | null): number {
  let top = area ? area.getBoundingClientRect().top : 0;
  document.querySelectorAll("header").forEach((h) => {
    const pos = getComputedStyle(h).position;
    if (pos === "sticky" || pos === "fixed") top = Math.max(top, h.getBoundingClientRect().bottom);
  });
  return Math.max(0, top);
}

export function ClassicStepBar({ pb, label, watch, root }: {
  pb: ReturnType<typeof usePlayback>;
  /** The current step's name. */
  label?: string;
  /** The element (the full player) whose scrolling out of view shows the bar. */
  watch: RefObject<HTMLElement | null>;
  /** The visualizer root: the bar stays inside it. */
  root: RefObject<HTMLElement | null>;
}) {
  const { index, count, playing, dispatch } = pb;
  const bar = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    let frame = 0;
    // The handler only READS layout and then writes one transform (which moves nothing else: the bar is absolutely placed) and one boolean.
    // It writes only when the value changed, and a burst of scroll or resize events collapses into one run per animation frame, so it can
    // never re-trigger itself: a transform on an absolute box fires no scroll, resize or ResizeObserver callback.
    let lastY = Number.NaN;
    const place = () => {
      frame = 0;
      const player = watch.current;
      const host = root.current;
      if (!player || !host) return;
      const edge = topEdge(scrollArea(host));
      const h = host.getBoundingClientRect();
      // Away: the player's bottom edge is above the top of the visible area (scrolled past). Below the fold is not away.
      setAway(player.getBoundingClientRect().bottom < edge + 1 && h.bottom > edge);
      const y = Math.min(Math.max(0, edge - h.top + 4), Math.max(0, h.height - BAR_H));
      const ry = Math.round(y);
      if (bar.current && ry !== lastY) { lastY = ry; bar.current.style.transform = `translateY(${ry}px)`; }
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(place); };
    // `scroll` does not bubble, but a capturing listener on the document hears every scroll area, the pane and the window alike.
    document.addEventListener("scroll", queue, { capture: true, passive: true });
    window.addEventListener("resize", queue);
    place();
    return () => { document.removeEventListener("scroll", queue, true); window.removeEventListener("resize", queue); if (frame) cancelAnimationFrame(frame); };
  }, [watch, root]);
  const text = count ? `Step ${index + 1} of ${count}${label ? ` · ${label}` : ""}` : "No steps";
  return (
    <div ref={bar} role="toolbar" aria-label="Step bar" hidden={!away} data-testid="classic-step-bar" data-step-index={index} className="vizc-bar">
      <button type="button" className="vizc-bar-btn" aria-label="Step bar: back" title="Previous step" disabled={index === 0} onClick={() => dispatch({ type: "prev" })}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
      <button type="button" className="vizc-bar-btn bg-accent text-on-accent" aria-label={playing ? "Step bar: stop" : "Step bar: auto-run"} title={playing ? "Pause" : "Play"} disabled={count === 0} onClick={() => dispatch({ type: "toggle" })}>
        {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
      </button>
      <button type="button" className="vizc-bar-btn" aria-label="Step bar: forward" title="Next step" disabled={index >= count - 1} onClick={() => dispatch({ type: "next" })}><ChevronRight className="h-4 w-4" aria-hidden /></button>
      <span className="vizc-bar-label" title={text}>{text}</span>
    </div>
  );
}
