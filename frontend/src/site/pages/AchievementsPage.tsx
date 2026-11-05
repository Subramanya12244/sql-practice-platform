import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CheckCircle2, Code2, Database, FileCode2, Flame, FolderCheck, ListChecks, Lock, Medal, Sparkles, Target, Terminal, Timer, Trophy, Workflow, type LucideIcon } from "lucide-react";
import { usePage } from "../SiteApp";
import { Badge, ButtonLink, Card, Container, PageHeader, ProgressBar, SectionHeader, StatCard } from "../components/ui";
import { Seo } from "../lib/seo";
import { LEVELS, XP, weekStartOf } from "../lib/gamification";
import { useGamification } from "../lib/useGamification";

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const EVENT_LABEL: Record<string, string> = {
  sql: "SQL question solved", python: "Python exercise passed", lesson: "Lesson exercise passed", scenario: "Business scenario solved",
  note: "Note read", card: "Flashcard reviewed", task: "Project task passed", project: "Project completed", mock: "Mock interview",
  track: "Track completed", day: "Daily activity bonus", achievement: "Achievement unlocked", mission: "Mission completed",
};

/** Only the icons achievement definitions use, so the bundle doesn't pull in the whole set. */
const ICONS: Record<string, LucideIcon> = { Terminal, Database, ListChecks, Trophy, FileCode2, Code2, FolderCheck, Flame, Workflow, Timer, Medal };
function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? Trophy;
  return <C className={className} aria-hidden />;
}

/** Time until 00:00 UTC, refreshed each minute. */
function useResetIn() {
  const [s, setS] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const m = Math.max(0, Math.round((next - now.getTime()) / 60_000));
      setS(`${Math.floor(m / 60)}h ${m % 60}m`);
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);
  return s;
}

export function AchievementsPage() {
  const { data } = usePage();
  const g = useGamification(data.projectTasks);
  const resetIn = useResetIn();
  const daily = g.missions.filter((m) => m.period === "day");
  const weekly = g.missions.filter((m) => m.period === "week");
  const unlocked = g.achievements.filter((a) => a.unlocked).length;
  // Five weeks ending this week, Monday first.
  const start = addDays(weekStartOf(g.today), -28);
  const cal = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  const active = new Set(g.days);

  return (
    <Container>
      <Seo title="Achievements, XP and missions" description="Your DataForge level, XP, learning streak, daily and weekly missions and achievements, earned from real practice." path="/achievements" noindex />
      <PageHeader eyebrow="Dashboard" title="Achievements & missions"
        intro={g.source === "account" ? "Earned on your account. XP is awarded by the server from your synced progress, once per action." : "Earned in this browser. Sign in to keep your XP across devices and appear on the leaderboard."} />

      {g.mounted && g.streak > 0 && !g.activeToday && (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-warn/30 bg-warn-dim px-4 py-3 text-sm text-ink">
          <Flame className="h-4 w-4 text-warn" aria-hidden /> Do one learning action today to keep your {g.streak}-day streak. A missed day resets it; there's no streak recovery.
          <Link to="/questions" className="ml-auto font-semibold text-accent hover:underline">Practice now</Link>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card as="section" className="lg:col-span-2" aria-label="Level">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-secondary font-display text-2xl font-bold text-white" aria-hidden>{g.level.index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">Level {g.level.index + 1}</p>
              <h2 className="font-display text-2xl font-bold text-ink">{g.level.name}</h2>
              <p className="text-sm text-ink-muted">{g.mounted ? `${g.xp.toLocaleString()} XP` : "—"}{g.level.next ? ` · ${g.level.toNext} XP to ${g.level.next.name}` : " · top level reached"}</p>
            </div>
          </div>
          <ProgressBar className="mt-4" value={g.mounted ? Math.round(g.level.share * 100) : 0} max={100} label="Progress to next level" />
          <ol className="mt-4 flex flex-wrap gap-1.5" aria-label="Levels">
            {LEVELS.map((l, i) => (
              <li key={l.name}><Badge tone={i < g.level.index ? "success" : i === g.level.index ? "accent" : "neutral"}>{l.name} · {l.min}</Badge></li>
            ))}
          </ol>
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <StatCard icon={Flame} label="Current streak" value={g.mounted ? `${g.streak} day${g.streak === 1 ? "" : "s"}` : "—"} hint={g.mounted ? `Longest: ${g.longest} day${g.longest === 1 ? "" : "s"}` : ""} />
          <StatCard icon={Sparkles} label="This week" value={g.mounted ? `${g.weekXp} XP` : "—"} hint={g.weekRank ? `#${g.weekRank} on the weekly leaderboard` : g.source === "account" ? "Make your profile public to be ranked" : `${g.monthXp} XP this month`} />
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card as="section" className="lg:col-span-3">
          <SectionHeader title="Daily missions" description={`Reset at 00:00 UTC${resetIn ? ` · in ${resetIn}` : ""}`} action={<Target className="h-5 w-5 text-accent" aria-hidden />} />
          <ul className="space-y-3">
            {daily.map((m) => (
              <li key={m.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className={`flex items-center gap-2 ${m.done ? "text-success" : "text-ink"}`}>{m.done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <span className="h-4 w-4 rounded-full border border-surface-border" aria-hidden />}{m.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-muted">{g.mounted ? m.value : 0}/{m.target} · +{m.xp} XP</span>
                </div>
                <ProgressBar value={g.mounted ? m.value : 0} max={m.target} label={m.label} tone={m.done ? "success" : "accent"} />
              </li>
            ))}
          </ul>
        </Card>
        <Card as="section" className="lg:col-span-2">
          <SectionHeader title="This week" description="Weekly missions reset on Monday (UTC)" />
          <ul className="space-y-3">
            {weekly.map((m) => (
              <li key={m.id}>
                <div className="mb-1 flex justify-between gap-2 text-sm"><span className={m.done ? "text-success" : "text-ink"}>{m.label}</span><span className="shrink-0 text-xs tabular-nums text-ink-muted">{g.mounted ? m.value : 0}/{m.target} · +{m.xp}</span></div>
                <ProgressBar value={g.mounted ? m.value : 0} max={m.target} label={m.label} tone={m.done ? "success" : "secondary"} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-muted">{g.mounted ? `${weekly.filter((m) => m.done).length} of ${weekly.length} weekly and ${daily.filter((m) => m.done).length} of ${daily.length} daily missions done.` : ""}</p>
        </Card>
      </div>

      <Card as="section" className="mt-6">
        <SectionHeader title="Activity calendar" description="Days with at least one learning action, last five weeks" action={<CalendarDays className="h-5 w-5 text-accent" aria-hidden />} />
        <div className="grid grid-cols-7 gap-1.5 sm:max-w-md" role="grid" aria-label="Activity calendar">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="text-center text-[11px] text-ink-faint" aria-hidden>{d}</span>)}
          {cal.map((d) => {
            const on = g.mounted && active.has(d);
            const future = g.mounted && d > g.today;
            return (
              <span key={d} role="gridcell" aria-label={`${d}: ${on ? "active" : "no activity"}`} title={d}
                className={`aspect-square rounded-md ${on ? "bg-accent" : future ? "bg-transparent" : "bg-surface-soft"} ${d === g.today ? "ring-2 ring-accent/60 ring-offset-1 ring-offset-surface-raised" : ""}`} />
            );
          })}
        </div>
      </Card>

      <section className="mt-8" aria-labelledby="ach">
        <SectionHeader id="ach" title={`Achievements (${g.mounted ? unlocked : 0}/${g.achievements.length})`} description="Each unlocks once and adds its XP reward" />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {g.achievements.map((a) => {
            const on = g.mounted && a.unlocked;
            return (
              <li key={a.id} className={`flex gap-3 rounded-card border p-4 ${on ? "border-accent/40 bg-accent-dim" : "border-surface-border bg-surface-raised"}`}>
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${on ? "bg-gradient-to-br from-accent to-secondary text-white" : "bg-surface-soft text-ink-faint"}`}>
                  {on ? <Icon name={a.icon} className="h-5 w-5" /> : <Lock className="h-4 w-4" aria-hidden />}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{a.name}</p>
                  <p className="text-xs text-ink-muted">{a.description}</p>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    +{a.xp} XP · {on ? (a.unlockedAt ? `Unlocked ${fmtDate(a.unlockedAt)}` : "Unlocked") : `Locked · ${g.mounted ? Math.min(a.value, a.target) : 0}/${a.target}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card as="section">
          <SectionHeader title="Recent XP" />
          {g.mounted && g.recent.length ? (
            <ul className="divide-y divide-surface-border text-sm">
              {g.recent.map((e) => (
                <li key={e.key} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0"><span className="block truncate text-ink">{EVENT_LABEL[e.kind] ?? e.kind}</span><span className="text-xs text-ink-faint">{fmtDate(e.at)}</span></span>
                  <span className="shrink-0 font-semibold tabular-nums text-accent">+{e.xp}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-muted">No XP yet. Solve a question or read a note to earn your first.</p>}
        </Card>
        <Card as="section">
          <SectionHeader title="How XP works" />
          <ul className="space-y-1 text-sm text-ink-muted">
            <li>SQL question solved in the editor: {XP.sql} XP ({XP.sqlRevealed} if you viewed the solution)</li>
            <li>Python exercise or business scenario: {XP.python} XP · lesson exercise: {XP.lesson} XP</li>
            <li>Note read: {XP.note} XP · flashcard review: {XP.card} XP (up to {XP.cardDailyCap} a day)</li>
            <li>Project task: {XP.task} XP · project completed: {XP.project} XP · track finished: {XP.track} XP</li>
            <li>Mock interview: {XP.mockPassed} XP if you solve {XP.mockPassShare * 100}% or more, else {XP.mockFinished} XP</li>
            <li>First earning action of each day: {XP.day} XP</li>
          </ul>
          <p className="mt-3 text-xs text-ink-faint">Each action pays once. Solves imported from your GitHub history earn no XP. Streaks count days with an earning action and reset after a missed day.</p>
          <div className="mt-4 flex gap-2"><ButtonLink to="/leaderboard" size="sm" variant="secondary"><Trophy className="h-4 w-4" aria-hidden /> Leaderboard</ButtonLink></div>
        </Card>
      </div>
      {g.remoteError && <p role="alert" className="mt-4 text-sm text-danger">Couldn't load account XP ({g.remoteError}). Showing this browser's record.</p>}
    </Container>
  );
}
