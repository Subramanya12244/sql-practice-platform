import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, Clock, ListTree, RotateCcw } from "lucide-react";
import { Badge, Card, Chip, ProgressBar } from "../ui";
import { StatusIcon } from "./DailyDashboard";
import { CURRICULUM, PHASE_BY_ID, dayHref, isAuthored, prerequisitesOf, type DayMeta } from "../../lib/daily";
import { dayStatus, isDone } from "../../lib/dailyProgress";
import { useToday, type DailyView } from "../../lib/useDaily";

/**
 * Pieces of the lesson workspace: a thin reading-progress bar, the days of the current phase, the right-hand rail
 * (time, progress, key concepts, prerequisites, the headings of the current step) and a remembered position.
 * Layout: one column on phones and laptops (the rail and the day list fold into collapsible blocks), centre plus rail from
 * 1280px, day list plus centre plus rail from 1536px. See `.lesson-grid` in site.css.
 */

// ── Reading progress ─────────────────────────────────────────────────────
/** A 2px bar under the header: how far through the lesson's content the reader has scrolled. No animation, so nothing to reduce. */
export function ReadingProgress({ targetRef }: { targetRef: RefObject<HTMLElement> }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = targetRef.current;
      if (!el || !bar.current) return;
      const r = el.getBoundingClientRect();
      const span = Math.max(1, r.height - window.innerHeight * 0.6);
      const p = Math.min(1, Math.max(0, (window.innerHeight * 0.15 - r.top) / span));
      bar.current.style.transform = `scaleX(${p})`;
      bar.current.setAttribute("aria-valuenow", String(Math.round(p * 100)));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [targetRef]);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-30 h-0.5 bg-transparent">
      <div ref={bar} role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} className="h-full origin-left bg-accent" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}

// ── Headings of the current step ─────────────────────────────────────────
export interface Heading { id: string; text: string; level: number }

/** The h2 and h3 headings inside `ref`, kept up to date as the step's content changes. Gives each one an id to link to. */
export function useHeadings(ref: RefObject<HTMLElement>, key: unknown): Heading[] {
  const [list, setList] = useState<Heading[]>([]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const collect = () => {
      const next = [...el.querySelectorAll<HTMLElement>("h2, h3")]
        .map((h, i) => { if (!h.id) h.id = `lesson-sec-${i}`; return { id: h.id, text: (h.textContent ?? "").trim(), level: Number(h.tagName[1]) }; })
        .filter((h) => h.text);
      setList((prev) => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.text === next[i].text) ? prev : next));
    };
    collect();
    const mo = new MutationObserver(collect);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [ref, key]);
  return list;
}

// ── Remembered position (this device only) ───────────────────────────────
const POS_KEY = "df.daily.pos.v1";
export interface LessonPosition { step: string; y: number; at: string }

function readAll(): Record<string, LessonPosition> {
  try { return JSON.parse(localStorage.getItem(POS_KEY) ?? "{}") as Record<string, LessonPosition>; } catch { return {}; }
}
export function savePosition(dayId: string, pos: Omit<LessonPosition, "at">) {
  try {
    const all = readAll();
    all[dayId] = { ...pos, at: new Date().toISOString() };
    // keep the 40 most recent lessons
    const keep = Object.entries(all).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 40);
    localStorage.setItem(POS_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* storage unavailable: resume is a convenience */ }
}
export const loadPosition = (dayId: string): LessonPosition | undefined => readAll()[dayId];

/**
 * Remembers the step and scroll offset, and offers to go back to them. The saved position is read once, after mount, so the
 * prerendered page never depends on it. Nothing is restored without the reader pressing the button.
 */
export function useResume(dayId: string, step: string, completed: boolean) {
  const [saved, setSaved] = useState<LessonPosition | undefined>();
  const first = useRef(true);
  useEffect(() => { setSaved(loadPosition(dayId)); first.current = true; }, [dayId]);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // opening a lesson does not overwrite where you were
    savePosition(dayId, { step, y: Math.round(window.scrollY) });
  }, [dayId, step]);
  useEffect(() => {
    let t = 0;
    const onScroll = () => { window.clearTimeout(t); t = window.setTimeout(() => savePosition(dayId, { step, y: Math.round(window.scrollY) }), 800); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.clearTimeout(t); window.removeEventListener("scroll", onScroll); };
  }, [dayId, step]);
  const offer = !completed && saved && (saved.step !== "understand" || saved.y > 400) ? saved : undefined;
  return { offer, dismiss: () => setSaved(undefined) };
}

export function ResumeBanner({ label, onResume, onDismiss }: { offer: LessonPosition; label: string; onResume: () => void; onDismiss: () => void }) {
  return (
    <div role="region" aria-label="Resume this lesson" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent-dim px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-ink"><RotateCcw className="h-4 w-4 text-accent" aria-hidden /> You were on <strong>{label}</strong> in this lesson.</span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={onResume} className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-on-accent hover:brightness-110">Resume where you left off</button>
        <button type="button" onClick={onDismiss} className="rounded-lg px-2 py-1 text-xs text-ink-muted hover:text-ink">Dismiss</button>
      </span>
    </div>
  );
}

// ── Collapsible block for narrow screens ─────────────────────────────────
/** A block that is always open from 1280px up (where the rail is visible) and a disclosure below that. */
export function Collapsible({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm font-semibold text-ink xl:hidden">
        <span className="flex items-center gap-2">{icon}{title}</span>
        <ChevronDown className={`h-4 w-4 text-ink-faint transition-transform duration-fast ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div className={`${open ? "mt-2 block" : "hidden"} xl:mt-0 xl:block`}>{children}</div>
    </div>
  );
}

// ── Day navigation: the days of this phase ───────────────────────────────
export function DayList({ day, view }: { day: DayMeta; view: DailyView }) {
  const today = useToday() ?? "";
  const phase = PHASE_BY_ID.get(day.phase);
  const days = CURRICULUM.days.filter((d) => d.phase === day.phase && d.path === day.path);
  const done = days.filter((d) => isDone(view.state, d.id)).length;
  const cur = useRef<HTMLAnchorElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // Centre today's day inside the list. Scroll the list itself: scrollIntoView would also scroll the whole page when the list is below the fold.
  useEffect(() => {
    const el = cur.current, ol = listRef.current;
    if (el && ol) ol.scrollTop = Math.max(0, el.offsetTop - ol.clientHeight / 2 + el.clientHeight / 2);
  }, [day.id]);
  return (
    <Card as="section" aria-label="Days in this phase" pad="sm">
      <p className="text-label uppercase text-ink-faint">Phase</p>
      <h3 className="mt-1 font-display text-h3 text-ink">{phase?.title}</h3>
      <p className="mt-0.5 text-xs text-ink-muted">{done} of {days.length} days complete</p>
      <ProgressBar className="mt-2" value={done} max={days.length || 1} label="Phase progress" tone="success" />
      <ol ref={listRef} className="relative mt-3 max-h-[26rem] space-y-0.5 overflow-y-auto pr-1">
        {days.map((d) => {
          const here = d.id === day.id;
          const status = dayStatus(view.state.days[d.id], view.revisions[`day:${d.id}`], today);
          const ready = isAuthored(d.id);
          return (
            <li key={d.id}>
              <Link ref={here ? cur : undefined} to={dayHref(d)} aria-current={here ? "page" : undefined}
                className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-fast ${here ? "bg-accent-dim font-semibold text-accent" : "text-ink-muted hover:bg-hover/5 hover:text-ink"} ${ready ? "" : "opacity-60"}`}>
                <span className="mt-0.5"><StatusIcon status={status} current={here} /></span>
                <span className="min-w-0"><span className="block text-[11px] text-ink-faint">Day {d.day}</span><span className="block leading-snug">{d.title}</span></span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ── Right rail ───────────────────────────────────────────────────────────
export function LessonRail({ day, view, finished, total, headings }: { day: DayMeta; view: DailyView; finished: number; total: number; headings: Heading[] }) {
  const pre = prerequisitesOf(day);
  const hours = Math.round((day.minutes / 60) * 10) / 10;
  const jump = (id: string) => (e: React.MouseEvent) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  return (
    <div className="space-y-4">
      <Card as="section" aria-label="About this lesson" pad="sm">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-label uppercase text-ink-faint">Estimated time</dt><dd className="mt-1 flex items-center gap-1 font-semibold text-ink"><Clock className="h-3.5 w-3.5 text-accent" aria-hidden /> about {hours} h</dd></div>
          <div><dt className="text-label uppercase text-ink-faint">Programme</dt><dd className="mt-1 font-semibold text-ink">Day {day.day} of 180</dd></div>
        </dl>
        <div className="mt-3">
          <div className="flex justify-between text-xs text-ink-muted"><span>This lesson</span><span className="font-medium text-ink">{finished} of {total} activities</span></div>
          <ProgressBar className="mt-1.5" value={finished} max={total} label="Lesson activities done" tone="success" />
        </div>
      </Card>

      {day.topics.length > 0 && (
        <Card as="section" aria-label="Key concepts" pad="sm">
          <h3 className="text-label uppercase text-ink-faint">Key concepts</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">{day.topics.map((t) => <li key={t}><Chip>{t}</Chip></li>)}</ul>
        </Card>
      )}

      {pre.length > 0 && (
        <Card as="section" aria-label="Lesson prerequisites" pad="sm">
          <h3 className="text-label uppercase text-ink-faint">Before this lesson</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {pre.map((p) => {
              const ok = isDone(view.state, p.id);
              return <li key={p.id}><Link to={dayHref(p)} className="flex items-start gap-1.5 text-ink-muted hover:text-accent">{ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> : <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-warn" aria-hidden />}<span>Day {p.day}: {p.title}</span></Link></li>;
            })}
          </ul>
          {pre.some((p) => !isDone(view.state, p.id)) && <Badge tone="warn" className="mt-2">Not all finished yet</Badge>}
        </Card>
      )}

      {headings.length > 0 && (
        <Card as="section" aria-label="On this page" pad="sm">
          <h3 className="flex items-center gap-1.5 text-label uppercase text-ink-faint"><ListTree className="h-3 w-3" aria-hidden /> On this page</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {headings.map((h) => (
              <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
                <a href={`#${h.id}`} onClick={jump(h.id)} className="block truncate text-ink-muted transition-colors duration-fast hover:text-accent">{h.text}</a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
