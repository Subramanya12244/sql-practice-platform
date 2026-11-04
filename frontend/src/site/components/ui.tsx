import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { QuestionSummary } from "../types";

const DIFF_STYLE: Record<string, string> = {
  Easy: "bg-success-dim text-success",
  Medium: "bg-warn-dim text-warn",
  Hard: "bg-danger-dim text-danger",
  Advanced: "bg-danger-dim text-danger",
  Expert: "bg-accent-dim text-accent",
};

export function Difficulty({ level }: { level: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${DIFF_STYLE[level] ?? "bg-surface-soft text-ink-muted"}`}>
      {level}
    </span>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-surface-border bg-surface-overlay px-1.5 py-0.5 text-[11px] text-ink-muted">
      {children}
    </span>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function PageHeader({ eyebrow, title, intro }: { eyebrow?: string; title: string; intro?: ReactNode }) {
  return (
    <header className="pb-6 pt-10 sm:pt-14">
      {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>}
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
      {intro && <div className="mt-3 max-w-3xl text-base leading-relaxed text-ink-muted">{intro}</div>}
    </header>
  );
}

export function QuestionCard({ q, solved }: { q: QuestionSummary; solved?: boolean }) {
  return (
    <Link
      to={`/questions/${q.slug}`}
      className="group flex flex-col gap-2 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition-colors duration-fast hover:border-accent/40"
    >
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <span className="font-mono">Q{String(q.number).padStart(2, "0")}</span>
        <span>·</span>
        <span>{q.topicLabel}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {q.isNew && <span className="rounded bg-accent-dim px-1.5 text-[10px] font-semibold uppercase text-accent">New</span>}
          {q.hadMistakes && <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-label="Common trap" />}
          {solved && <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="Solved" />}
          <Difficulty level={q.difficulty} />
        </span>
      </div>
      <h3 className="font-semibold text-ink group-hover:text-accent">{q.title}</h3>
      {q.problemShort && <p className="line-clamp-2 text-sm text-ink-muted">{q.problemShort}</p>}
    </Link>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-soft ${className}`} />;
}
