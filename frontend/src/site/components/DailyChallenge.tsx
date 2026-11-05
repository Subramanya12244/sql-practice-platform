import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, CheckCircle2, Code2, Database } from "lucide-react";
import { usePage } from "../SiteApp";
import { useProgress } from "../lib/progress";
import { dailyChallenge } from "../lib/extras";
import { Card, Difficulty } from "./ui";

/** Today's SQL question and Python problem (UTC day; the same for every learner). */
export function DailyChallenge() {
  const { data } = usePage();
  const progress = useProgress();
  // The day is read after hydration so the prerendered HTML never disagrees with the browser.
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => setDay(new Date().toISOString().slice(0, 10)), []);
  if (!day) return <Card pad="md" className="h-[148px]"><span className="sr-only">Loading today's challenges</span></Card>;
  const c = dailyChallenge(day, data.index, data.exercises ?? []);
  const sqlDone = c.sql ? (progress.questions[c.sql.number]?.solvedAt ?? "").slice(0, 10) === day : false;
  const sqlEver = c.sql ? Boolean(progress.questions[c.sql.number]?.solvedAt) : false;
  const pyAt = c.python ? progress.lessons?.[`py:${c.python.slug}`] : undefined;
  const pyDone = (pyAt ?? "").slice(0, 10) === day;
  const rows = [
    c.sql && { icon: Database, kind: "SQL", title: `Q${c.sql.number} ${c.sql.title}`, path: `/questions/${c.sql.slug}`, level: c.sql.difficulty, done: sqlDone, ever: sqlEver },
    c.python && { icon: Code2, kind: "Python", title: `${c.python.code} ${c.python.title}`, path: `/practice/python/${c.python.slug}`, level: c.python.difficulty, done: pyDone, ever: Boolean(pyAt) },
  ].filter((r) => !!r);
  return (
    <Card as="section" pad="md" aria-labelledby="daily">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="daily" className="flex items-center gap-2 font-display text-lg font-bold text-ink"><CalendarCheck className="h-5 w-5 text-accent" aria-hidden /> Today's challenges</h2>
        <span className="text-xs text-ink-faint">{day} · {c.level} day · new at 00:00 UTC</span>
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.kind}>
            <Link to={r.path} className="flex items-center gap-3 rounded-lg border border-surface-border px-3 py-2 hover:border-accent/40">
              <r.icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-faint">{r.kind}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.title}</span>
              <Difficulty level={r.level} />
              {r.done ? <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> done today</span>
                : r.ever ? <span className="text-xs text-ink-faint">solved before</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
