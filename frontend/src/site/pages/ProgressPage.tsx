import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, CalendarDays, Download, FileText, Flame, Trophy, Upload } from "lucide-react";
import { usePage } from "../SiteApp";
import { Button, Card, Container, PageHeader, SectionHeader, StatCard } from "../components/ui";
import { ShareButton } from "../components/ShareButton";
import { PracticeNext } from "./ReviewPage";
import { Seo } from "../lib/seo";
import { exportProgress, importProgress, resetProgress, streak, useProgress } from "../lib/progress";
import { personalReportHtml, pyMastery, sqlMastery, sqlRevision } from "../lib/extras";
import { MASTERY_LABEL, type MasteryLevel, type TopicRow } from "../lib/solveAnalytics";
import { accuracy, overview, readStats, type PyStat } from "../lib/pyPractice";
import { activeMinutes, formatMinutes, summarizeMinutes } from "../lib/activity";
import { useAuth } from "../lib/auth";
import { LearningAnalytics } from "../components/LearningAnalytics";

const TONE: Record<MasteryLevel, string> = { "not-started": "text-ink-faint", "needs-practice": "text-warn", developing: "text-ink", strong: "text-success" };

/** Same scorer and labels as the Analytics page (lib/solveAnalytics.ts). */
function MasteryList({ title, rows, link }: { title: string; rows: TopicRow[]; link?: (t: string) => string }) {
  return (
    <section aria-label={title}>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <ul className="mt-2 space-y-2">
        {rows.map((t) => {
          const body = (
            <>
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate font-medium text-ink">{t.label}</span>
                <span className="shrink-0 text-xs"><span className={`font-semibold ${TONE[t.level]}`}>{MASTERY_LABEL[t.level]}</span> <span className="text-ink-faint">· {t.solved}/{t.total}</span></span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-soft" role="img" aria-label={`${t.label}: ${MASTERY_LABEL[t.level]}, strength ${t.score ?? 0} out of 100`}>
                <div className={`h-full rounded-full ${t.level === "strong" ? "bg-success" : t.level === "needs-practice" ? "bg-secondary" : "bg-accent"}`} style={{ width: `${t.score ?? 0}%` }} />
              </div>
            </>
          );
          return <li key={t.topic}>{link ? <Link to={link(t.topic)} className="block rounded-lg p-2 hover:bg-hover/5">{body}</Link> : <div className="p-2">{body}</div>}</li>;
        })}
      </ul>
      <p className="mt-2 text-[11px] text-ink-faint">Why a topic is rated this way: <Link to="/analytics#strength" className="text-accent hover:underline">Performance analytics</Link>.</p>
    </section>
  );
}

export function ProgressPage() {
  const { data } = usePage();
  const progress = useProgress();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const solvedNums = new Set(
    Object.entries(progress.questions).filter(([, q]) => q.solvedAt).map(([n]) => Number(n)),
  );
  const days = streak(progress.activeDays);
  const attempts = Object.values(progress.questions).reduce((s, q) => s + q.attempts, 0);

  function download() {
    const blob = new Blob([exportProgress()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sql-practice-progress.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const { profile } = useAuth();
  const [pyStats, setPyStats] = useState<Record<string, PyStat>>({});
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); setPyStats(readStats()); }, []);
  const exercises = data.exercises ?? [];
  const sqlRows = sqlMastery(data.index, progress);
  const pyRows = pyMastery(exercises, progress, mounted ? pyStats : {});

  /** Self-contained HTML file the learner can open, print or save as PDF. */
  function downloadReport() {
    const today = new Date().toISOString().slice(0, 10);
    const t = summarizeMinutes(activeMinutes(), today);
    const o = overview(exercises, progress.lessons, pyStats);
    const html = personalReportHtml({
      name: profile?.username ?? "This browser", generated: new Date().toLocaleString(),
      sql: { solved: solvedNums.size, total: data.index.length, independent: Object.values(progress.questions).filter((q) => q.solvedAt && !q.assisted && !q.revealed).length },
      python: { solved: o.solved, total: o.total, accuracy: accuracy({ attempts: Object.values(pyStats).reduce((x, y) => x + y.attempts, 0), passes: Object.values(pyStats).reduce((x, y) => x + y.passes, 0) }) },
      activeTime: { today: formatMinutes(t.todayMin), week: formatMinutes(t.weekMin), total: formatMinutes(t.totalMin) },
      streak: days, sqlTopics: sqlRows.map((r) => ({ ...r, level: MASTERY_LABEL[r.level] })), pyTopics: pyRows.map((r) => ({ ...r, level: MASTERY_LABEL[r.level] })),
      revise: [...sqlRevision(data.index, progress, 10).map((r) => ({ title: `Q${r.q.number} ${r.q.title}`, reason: r.reason })), ...o.revise.map((e) => ({ title: `${e.code} ${e.title}`, reason: "Python: failed checks" }))],
      mocks: [...(progress.mocks ?? [])].reverse().slice(0, 10).map((m) => ({ date: m.date.slice(0, 10), solved: m.solved, total: m.total })),
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `dataforge-report-${today}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(file: File) {
    setMsg(importProgress(await file.text()) ? "Progress imported." : "That file is not a valid progress export.");
  }

  const stats = [
    { label: "Solved", value: `${solvedNums.size} / ${data.index.length}`, icon: Trophy },
    { label: "Day streak", value: String(days), icon: Flame },
    { label: "Attempts", value: String(attempts), icon: Activity },
    { label: "Active days", value: String(progress.activeDays.length), icon: CalendarDays },
  ];

  return (
    <Container>
      <Seo title="Your SQL Practice Progress" description="Track solved SQL questions, streaks and revision progress. Stored only in your browser." path="/progress" noindex />
      <PageHeader eyebrow="You" title="Your progress" intro={profile ? "Synced to your account and saved in this browser. You can also export it." : "Saved in this browser — sign in to sync it across devices, or export it."} />

      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ShareButton kind="progress" solved={solvedNums.size} total={data.index.length} streak={days} />
        <Link to="/review" className="text-sm font-semibold text-accent hover:underline">Open review queue →</Link>
      </div>

      <LearningAnalytics />

      <PracticeNext />

      {(progress.mocks?.length ?? 0) > 0 && (
        <section className="mt-12" aria-labelledby="mocks">
          <SectionHeader id="mocks" title="Mock interviews" action={<Link to="/mock-interview" className="text-sm font-medium text-accent hover:underline">Start another</Link>} />
          <Card pad="none" className="overflow-hidden">
          <ul className="divide-y divide-surface-border">
            {[...progress.mocks!].reverse().slice(0, 10).map((m) => (
              <li key={m.date} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-ink-muted">{new Date(m.date).toLocaleDateString()}</span>
                <span className="font-semibold text-ink">{m.solved}/{m.total}</span>
                <span className="text-ink-faint">{Math.round(m.usedSec / 60)} of {m.durationMin} min</span>
              </li>
            ))}
          </ul>
          </Card>
        </section>
      )}

      <section className="mt-12" aria-labelledby="mastery">
        <SectionHeader id="mastery" title="Topic mastery"
          description="Independent solves count fully; solves after hints or a revealed solution count half. Mastered needs 85% and a Hard solve."
          action={<Button variant="secondary" onClick={downloadReport} disabled={!mounted}><FileText className="h-4 w-4" aria-hidden /> Download report</Button>} />
        <div className="grid gap-4 md:grid-cols-2">
          <Card><MasteryList title="SQL topics" rows={sqlRows} link={(t) => `/topics/${t}`} /></Card>
          <Card><MasteryList title="Python categories" rows={pyRows} /></Card>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="backup">
      <SectionHeader id="backup" title="Back up your progress" />
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={download}>
          <Download className="h-4 w-4" aria-hidden /> Export
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden /> Import
        </Button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button
          variant="ghost"
          onClick={() => {
            if (window.confirm("Delete all progress saved in this browser? This cannot be undone.")) resetProgress();
          }}
          className="text-danger hover:bg-danger-dim hover:text-danger"
        >
          Reset
        </Button>
      </div>
      {msg && <p className="mt-3 text-sm text-ink-muted" role="status">{msg}</p>}
      </section>
    </Container>
  );
}
