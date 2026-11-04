import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Flame, Trophy } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, PageHeader, QuestionCard } from "../components/ui";
import { Seo } from "../lib/seo";
import { useAuth } from "../lib/auth";
import { streak, useProgress } from "../lib/progress";
import {
  challengeRanking, currentChallenge, fallbackChallenge, leaderboard, publicProfile, weekStart,
  type LeaderRow, type PublicProfile,
} from "../lib/community";

function NeedsAccounts() {
  return <p className="text-ink-muted">Community features need accounts, which are not enabled on this deployment.</p>;
}

function Board({ rows, empty }: { rows: LeaderRow[] | null; empty: string }) {
  if (!rows) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <ol className="divide-y divide-surface-border overflow-hidden rounded-card border border-surface-border">
      {rows.map((r, i) => (
        <li key={r.username} className="flex items-center gap-3 bg-surface-raised px-4 py-2.5 text-sm">
          <span className={`w-6 text-right font-mono ${i < 3 ? "font-bold text-accent" : "text-ink-faint"}`}>{i + 1}</span>
          <Link to={`/profile?u=${encodeURIComponent(r.username)}`} className="font-medium text-ink hover:underline">{r.username}</Link>
          <span className="ml-auto text-ink-muted">{r.solved} solved</span>
        </li>
      ))}
    </ol>
  );
}

export function LeaderboardPage() {
  const { enabled, profile } = useAuth();
  const [period, setPeriod] = useState<"week" | "month" | "all">("week");
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setRows(null);
    leaderboard(period).then(setRows).catch(() => setRows([]));
  }, [enabled, period]);

  return (
    <Container>
      <Seo title="SQL Practice Leaderboard" description="Weekly, monthly and all-time leaderboard for SQL practice questions solved." path="/leaderboard" noindex />
      <PageHeader eyebrow="Community" title="Leaderboard" intro="Questions solved. Only people with a public profile are listed." />
      {!enabled ? <NeedsAccounts /> : (
        <>
          <div className="mb-4 flex gap-2 text-sm" role="tablist">
            {(["week", "month", "all"] as const).map((p) => (
              <button key={p} type="button" role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1.5 ${period === p ? "bg-accent text-white" : "border border-surface-border text-ink-muted"}`}>
                {p === "all" ? "All time" : `This ${p}`}
              </button>
            ))}
          </div>
          <Board rows={rows} empty="No solves yet in this period." />
          {profile && <p className="mt-4 text-sm text-ink-muted">Not listed? Turn on your public profile on the <Link to="/account" className="text-accent underline">account page</Link>.</p>}
        </>
      )}
    </Container>
  );
}

export function ProfilePage() {
  const { data } = usePage();
  const { enabled } = useAuth();
  const { search } = useLocation();
  const username = new URLSearchParams(search).get("u") ?? "";
  const [p, setP] = useState<PublicProfile | null | undefined>(undefined);
  useEffect(() => {
    if (enabled && username) publicProfile(username).then(setP).catch(() => setP(null));
  }, [enabled, username]);

  const byTopic = data.topics.map((t) => {
    const qs = data.index.filter((q) => q.topic === t.slug);
    const solved = p ? qs.filter((q) => p.solvedNumbers.includes(q.number)).length : 0;
    return { label: t.label, solved, total: qs.length };
  });

  return (
    <Container>
      <Seo title="Profile" description="SQL practice profile." path="/profile" noindex />
      {!enabled ? <NeedsAccounts /> : p === undefined ? <p className="py-10 text-ink-muted">Loading…</p> : !p ? (
        <p className="py-10 text-ink-muted">This profile is private or doesn't exist.</p>
      ) : (
        <>
          <PageHeader eyebrow="Profile" title={p.username} intro={`Practicing since ${new Date(p.joined).toLocaleDateString()}`} />
          <div className="grid grid-cols-3 gap-3">
            {[["Solved", `${p.solved} / ${data.index.length}`], ["Day streak", String(streak(p.activeDays))], ["Shared solutions", String(p.solutions)]].map(([k, v]) => (
              <div key={k} className="rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel">
                <p className="text-xs uppercase tracking-wider text-ink-faint">{k}</p>
                <p className="mt-1 font-display text-2xl font-bold text-ink">{v}</p>
              </div>
            ))}
          </div>
          <h2 className="mt-8 font-display text-xl font-bold text-ink">By topic</h2>
          <ul className="mt-3 space-y-2">
            {byTopic.map((t) => (
              <li key={t.label} className="text-sm">
                <div className="flex justify-between text-ink"><span>{t.label}</span><span className="text-ink-muted">{t.solved}/{t.total}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-border" aria-hidden>
                  <div className="h-full bg-accent" style={{ width: `${t.total ? (100 * t.solved) / t.total : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Container>
  );
}

export function ChallengePage() {
  const { data } = usePage();
  const { enabled } = useAuth();
  const progress = useProgress();
  const [week, setWeek] = useState<string | null>(null);
  const [numbers, setNumbers] = useState<number[]>([]);
  const [rows, setRows] = useState<LeaderRow[] | null>(null);

  useEffect(() => {
    const w = weekStart();
    setWeek(w);
    const fallback = () => fallbackChallenge(data.index.map((q) => q.number), w);
    if (!enabled) return setNumbers(fallback());
    currentChallenge().then((n) => setNumbers(n.length ? n : fallback())).catch(() => setNumbers(fallback()));
    challengeRanking().then(setRows).catch(() => setRows([]));
  }, [enabled, data.index]);

  const qs = numbers.map((n) => data.index.find((q) => q.number === n)).filter((q) => q !== undefined);
  const done = qs.filter((q) => progress.questions[q.number]?.solvedAt).length;

  return (
    <Container>
      <Seo title="Weekly SQL Challenge" description="Three SQL interview questions every week. Solve them and climb the weekly ranking." path="/challenge" />
      <PageHeader eyebrow={week ? `Week of ${week}` : "This week"} title="Weekly SQL challenge" intro="Three questions, new every Monday (UTC). First solves this week count toward the ranking." />
      <p className="mb-4 flex items-center gap-2 text-sm text-ink-muted">
        <Flame className="h-4 w-4 text-warn" aria-hidden /> You've solved {done} of {qs.length}.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {qs.map((q) => <QuestionCard key={q.slug} q={q} solved={!!progress.questions[q.number]?.solvedAt} />)}
      </div>
      {enabled && (
        <>
          <h2 className="mt-10 flex items-center gap-2 font-display text-xl font-bold text-ink"><Trophy className="h-5 w-5 text-accent" aria-hidden /> Ranking</h2>
          <div className="mt-3"><Board rows={rows} empty="Nobody has finished this week's questions yet." /></div>
        </>
      )}
    </Container>
  );
}
