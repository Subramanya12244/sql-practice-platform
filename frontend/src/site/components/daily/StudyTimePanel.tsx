import { useEffect, useMemo } from "react";
import { Clock, Hourglass, Timer } from "lucide-react";
import { Card, SectionHeader, StatCard } from "../ui";
import { sequenceFor, type BranchId } from "../../lib/daily";
import { branchLabel, studyAnalytics, studySec } from "../../lib/dailyStudy";
import { sweepDailyStudy } from "../../lib/dailyStudyStore";
import { formatDuration } from "../../lib/solveSessions";
import { useToday, type DailyView } from "../../lib/useDaily";

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Active study time per lesson, week and phase. Time is a record of presence (visible tab, recent activity), never a score:
 * it does not affect completion, mastery or the streak. Analyst and Engineer time are kept apart.
 */
export function StudyTimePanel({ view }: { view: DailyView }) {
  const today = useToday();
  const { state, seq } = view;
  // Commit timers left behind by a closed tab, so the numbers below are current.
  useEffect(() => { sweepDailyStudy(); }, []);
  const a = useMemo(() => (today ? studyAnalytics(state, seq, today) : null), [state, seq, today]);
  const branches = useMemo(() => {
    if (!today) return [];
    return (["analyst", "engineer"] as BranchId[]).map((b) => {
      const days = sequenceFor(b).filter((d) => d.path === b);
      const ids = new Set(days.map((d) => d.id));
      const sec = Object.entries(state.days).filter(([id]) => ids.has(id)).reduce((n, [, r]) => n + studySec(r), 0);
      return { id: b, sec };
    }).filter((b) => b.sec > 0);
  }, [state, today]);
  if (!a) return null;
  const empty = a.totalSec === 0;
  const maxWeek = Math.max(1, ...a.weeks.map((w) => w.sec));
  const maxPhase = Math.max(1, ...a.byPhase.map((p) => p.sec));
  return (
    <section aria-labelledby="study-time">
      <SectionHeader id="study-time" title="Study time" description="Active time on lessons: only while a lesson tab is open and you are there. It never affects completion or your streak." />
      {empty ? (
        <Card><p className="text-sm text-ink-muted">Open a lesson and the timer starts by itself. Your time per lesson, week and phase appears here.</p></Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={Timer} label="Today" value={formatDuration(a.todaySec)} hint="Active study time" />
            <StatCard icon={Clock} label="This week" value={formatDuration(a.thisWeekSec)} hint="Last 7 days" />
            <StatCard icon={Hourglass} label="Total" value={formatDuration(a.totalSec)} hint={`${a.daysStudied} lessons · ${a.sessions} sessions`} />
            <StatCard icon={Clock} label="Per completed lesson" value={a.avgPerCompletedSec ? formatDuration(a.avgPerCompletedSec) : "No data"}
              hint={a.vsBudget.lessons ? `Plan ${a.vsBudget.plannedMin} min · actual ${a.vsBudget.actualMin} min (${a.vsBudget.lessons} lessons)` : "After your first completed lesson"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="font-display text-base font-bold text-ink">Last 8 weeks</h3>
              <ul className="mt-3 space-y-1.5" aria-label="Study time by week">
                {a.weeks.map((w) => (
                  <li key={w.start} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-ink-faint">{shortDate(w.start)}–{shortDate(w.end)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-soft"><span className="block h-full rounded-full bg-accent" style={{ width: `${(w.sec / maxWeek) * 100}%` }} /></span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-ink-muted">{w.sec ? formatDuration(w.sec) : "–"}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h3 className="font-display text-base font-bold text-ink">By phase</h3>
              <ul className="mt-3 space-y-1.5" aria-label="Study time by phase">
                {a.byPhase.map((p) => (
                  <li key={p.phase} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 truncate text-ink-muted" title={p.title}>{p.title}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-soft"><span className="block h-full rounded-full bg-accent" style={{ width: `${(p.sec / maxPhase) * 100}%` }} /></span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-ink-muted">{formatDuration(p.sec)}</span>
                  </li>
                ))}
              </ul>
              {branches.length > 0 && (
                <p className="mt-3 border-t border-surface-border pt-2 text-xs text-ink-muted">
                  {branches.map((b) => `${branchLabel(b.id)}: ${formatDuration(b.sec)}`).join(" · ")}
                </p>
              )}
            </Card>
          </div>
          {a.awaySec > 0 && <p className="text-xs text-ink-faint">{formatDuration(a.awaySec)} away from lessons (paused, hidden tab or idle) is not counted.</p>}
        </div>
      )}
    </section>
  );
}
