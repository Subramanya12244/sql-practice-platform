import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { NAV_GROUPS } from "../lib/navigation";
import { CURRICULUM, PATHS } from "../lib/daily";

/**
 * First-visit welcome: five short screens, as a card in the corner that never blocks the page.
 * Skip is always one click. It is shown once; Settings and Help Center can replay it.
 */
export default function Onboarding({ onSkip, onDone }: { onSkip: () => void; onDone: (next: "close" | "tour") => void }) {
  const [i, setI] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const { totalDays, commonDays } = CURRICULUM.programme;
  const branchDays = totalDays - commonDays;

  const screens: { title: string; body: React.ReactNode }[] = [
    {
      title: "Welcome to DataForge",
      body: <p>Practise SQL, Python and data engineering on real data that runs in your browser. Nothing to install, and signing up is optional. This takes under a minute.</p>,
    },
    {
      title: "The main sections",
      body: (
        <ul className="space-y-1.5">
          {NAV_GROUPS.map((g) => <li key={g.id}><span className="font-semibold text-ink">{g.label}</span>{g.items?.[0]?.desc ? <span className="text-ink-muted"> · {g.items[0].desc}</span> : null}</li>)}
        </ul>
      ),
    },
    {
      title: "Learning paths",
      body: (
        <>
          <p>Daily Learning is a {totalDays}-day plan with one lesson a day. Everyone starts with a {commonDays}-day common core, then picks a path for the last {branchDays} days:</p>
          <ul className="mt-2 space-y-1.5">
            {PATHS.map((p) => <li key={p.id}><span className="font-semibold text-ink">{p.title}</span><span className="text-ink-muted"> · {p.summary}</span></li>)}
          </ul>
        </>
      ),
    },
    {
      title: "How to start practising",
      body: (
        <>
          <p>Pick whichever fits you today:</p>
          <ul className="mt-2 space-y-1.5">
            <li><Link className="font-semibold text-accent hover:underline" to="/daily/day/1" onClick={() => onDone("close")}>Daily Learning, Day 1</Link><span className="text-ink-muted"> · Python from scratch</span></li>
            <li><Link className="font-semibold text-accent hover:underline" to="/questions" onClick={() => onDone("close")}>SQL practice</Link><span className="text-ink-muted"> · graded questions, filter by Easy</span></li>
            <li><Link className="font-semibold text-accent hover:underline" to="/playground" onClick={() => onDone("close")}>SQL playground</Link><span className="text-ink-muted"> · run any query freely</span></li>
          </ul>
          <p className="mt-2 text-ink-muted">Read the problem, write your answer, run it, then submit.</p>
        </>
      ),
    },
    {
      title: "How progress is tracked",
      body: <p>Solved questions, attempts, daily activity and study time are saved automatically in this browser. Sign in to keep them with an account too. Click <span className="font-semibold text-ink">Help</span> on any page for a guide to that page, or press <kbd className="rounded border border-surface-border px-1 font-mono text-xs">?</kbd>.</p>,
    },
  ];
  const s = screens[i];
  const last = i === screens.length - 1;

  useEffect(() => { card.current?.focus({ preventScroll: true }); }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && card.current?.contains(document.activeElement)) { e.preventDefault(); onSkip(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSkip]);

  return (
    <div
      ref={card}
      role="dialog"
      aria-modal="false"
      aria-labelledby="onboarding-title"
      tabIndex={-1}
      data-onboarding=""
      className="fixed inset-x-3 bottom-3 z-[55] max-h-[80vh] animate-scale-in overflow-y-auto rounded-card border border-surface-border bg-surface-raised p-4 text-sm leading-relaxed text-ink shadow-soft outline-none sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px]"
    >
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Welcome · {i + 1} of {screens.length}</p>
        <button type="button" onClick={onSkip} aria-label="Skip welcome" className="ml-auto rounded p-1 text-ink-faint hover:text-ink"><X className="h-4 w-4" aria-hidden /></button>
      </div>
      <h2 id="onboarding-title" className="mt-2 font-display text-lg font-bold text-ink">{s.title}</h2>
      <div className="mt-2 text-ink-muted">{s.body}</div>
      <div className="mt-4 flex items-center gap-2">
        <button type="button" onClick={onSkip} className="rounded-lg px-2 py-1.5 text-xs font-medium text-ink-faint hover:text-ink">Skip</button>
        <span className="ml-auto flex gap-2">
          {i > 0 && <button type="button" onClick={() => setI(i - 1)} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-surface-border px-3 text-ink-muted hover:text-ink"><ChevronLeft className="h-4 w-4" aria-hidden /> Back</button>}
          {last ? (
            <>
              <button type="button" onClick={() => onDone("close")} className="min-h-[36px] rounded-lg border border-surface-border px-3 text-ink-muted hover:text-ink">Done</button>
              <button type="button" onClick={() => onDone("tour")} className="min-h-[36px] rounded-lg bg-accent px-3 font-semibold text-on-accent hover:brightness-110">Take the tour</button>
            </>
          ) : (
            <button type="button" onClick={() => setI(i + 1)} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-accent px-3 font-semibold text-on-accent hover:brightness-110">Next <ChevronRight className="h-4 w-4" aria-hidden /></button>
          )}
        </span>
      </div>
    </div>
  );
}
