import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { MOTION } from "../lib/motion";

/** True when the visitor asked for reduced motion. Safe on the server (returns false). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * False for the first moments after a component mounts, true afterwards. Progress that arrives from storage right after hydration
 * should snap into place; only changes that happen later (a task passes, a question is solved) should animate.
 */
export function useSettled(afterMs = 150): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), afterMs);
    return () => window.clearTimeout(id);
  }, [afterMs]);
  return settled;
}

/**
 * Scroll reveal. The server HTML (and first client render) is fully visible, so there is no
 * flash and no content hidden from crawlers. After hydration, a section that starts below
 * the fold is hidden and fades up once it is 10% in view. One observer per instance,
 * disconnected after it fires.
 */
export function Reveal({ children, as: Tag = "div", className = "" }: { children: ReactNode; as?: ElementType; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "pending" | "in">("idle");
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return; // already on screen
    setState("pending");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("in");
          io.disconnect();
        }
      },
      // Reveal a little before the section is fully in view, so a fast scroll never lands on blank space.
      { threshold: 0.05, rootMargin: "0px 0px 120px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const cls = state === "pending" ? "reveal-pending" : state === "in" ? "reveal-in" : "";
  return <Tag ref={ref} className={`${cls} ${className}`}>{children}</Tag>;
}

/**
 * A number that counts to its new value when it changes after mount (e.g. progress loaded
 * from storage). The first render shows the real value, so SSR and hydration match.
 * The frames write straight into the text node, so React does not re-render the page forty times for one number; React's own
 * render always holds the final value. Runs for at most `duration` ms, then stops.
 */
export function CountUp({ value, duration = MOTION.slow + 120, format = (n: number) => n.toLocaleString() }: { value: number; duration?: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(value);
  const fmt = useRef(format);
  fmt.current = format;
  useEffect(() => {
    const start = from.current;
    from.current = value;
    const el = ref.current;
    if (!el || start === value || prefersReducedMotion() || !Number.isFinite(value) || !Number.isFinite(start)) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt.current(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); el.textContent = fmt.current(value); };
  }, [value, duration]);
  return <span ref={ref}>{format(value)}</span>;
}
