import { Link } from "react-router-dom";
import { Bookmark, BookmarkCheck, Clock } from "lucide-react";
import { toggleBookmark, useProgress } from "../lib/progress";
import { QuestionCard } from "./ui";
import type { QuestionSummary } from "../types";
import type { MindMapMeta, NoteMeta, PatternMeta } from "../lib/learning";

export function BookmarkButton({ itemKey, label }: { itemKey: string; label: string }) {
  const progress = useProgress();
  const on = Boolean(progress.bookmarks?.includes(itemKey));
  const Icon = on ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      onClick={() => toggleBookmark(itemKey)}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${on ? "border-accent/40 bg-accent-dim text-accent" : "border-surface-border text-ink-muted hover:text-ink"}`}
    >
      <Icon className="h-4 w-4" aria-hidden /> {on ? "Bookmarked" : `Bookmark ${label}`}
    </button>
  );
}

export function LevelBadge({ level }: { level: string }) {
  const tone: Record<string, string> = {
    Beginner: "bg-success-dim text-success",
    Intermediate: "bg-accent-dim text-accent",
    Advanced: "bg-warn-dim text-warn",
    Expert: "bg-danger-dim text-danger",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone[level] ?? "bg-surface-soft text-ink-muted"}`}>{level}</span>;
}

export function Minutes({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
      <Clock className="h-3.5 w-3.5" aria-hidden /> {n} min
    </span>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Cross-links that tie a topic to everything else: notes, patterns, guides, maps, questions. */
export function RelatedPanel({
  notes = [], patterns = [], guides = [], maps = [], questions = [], solved,
}: {
  notes?: NoteMeta[];
  patterns?: PatternMeta[];
  guides?: { slug: string; title: string }[];
  maps?: MindMapMeta[];
  questions?: QuestionSummary[];
  solved?: (n: number) => boolean;
}) {
  const link = "block rounded px-1 py-0.5 text-sm text-accent hover:bg-hover/5 hover:underline";
  return (
    <div className="space-y-6">
      {notes.length > 0 && (
        <Block title="Related notes">{notes.map((n) => <Link key={n.slug} to={`/notes/${n.slug}`} className={link}>{n.title}</Link>)}</Block>
      )}
      {patterns.length > 0 && (
        <Block title="Patterns">{patterns.map((p) => <Link key={p.slug} to={`/patterns/${p.slug}`} className={link}>{p.title}</Link>)}</Block>
      )}
      {maps.length > 0 && (
        <Block title="Mind maps">{maps.map((m) => <Link key={m.slug} to={`/mindmaps/${m.slug}`} className={link}>{m.title}</Link>)}</Block>
      )}
      {guides.length > 0 && (
        <Block title="Concept guides">{guides.map((g) => <Link key={g.slug} to={`/concepts/${g.slug}`} className={link}>{g.title}</Link>)}</Block>
      )}
      {questions.length > 0 && (
        <Block title={`Practice (${questions.filter((q) => solved?.(q.number)).length}/${questions.length} solved)`}>
          <div className="grid gap-2">{questions.map((q) => <QuestionCard key={q.slug} q={q} solved={solved?.(q.number)} />)}</div>
        </Block>
      )}
    </div>
  );
}
