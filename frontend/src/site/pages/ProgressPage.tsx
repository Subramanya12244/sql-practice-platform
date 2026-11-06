import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileText, Flame, Trophy, Upload } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, PageHeader } from "../components/ui";
import { ShareButton } from "../components/ShareButton";
import { PracticeNext } from "./ReviewPage";
import { Seo } from "../lib/seo";
import { exportProgress, importProgress, resetProgress, streak, useProgress } from "../lib/progress";
import { MASTERY, personalReportHtml, pyMastery, sqlMastery, sqlRevision, type Mastery } from "../lib/extras";
import { PY_CATEGORIES, accuracy, overview, readStats, type PyStat } from "../lib/pyPractice";
import { activeMinutes, formatMinutes, summarizeMinutes } from "../lib/activity";
import { useAuth } from "../lib/auth";
import { LearningAnalytics } from "../components/LearningAnalytics";

const TONE: Record<Mastery, string> = { "Not started": "text-ink-faint", Learning: "text-ink-muted", Practising: "text-ink", Proficient: "text-accent", Mastered: "text-success" };

function MasteryList({ title, rows, link }: { title: string; rows: { topic: string; label: string; total: number; solved: number; level: Mastery; score: number }[]; link?: (t: string) => string }) {
  return (
    <section aria-label={title}>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <ul className="mt-2 space-y-2">
        {rows.map((t) => {
          const body = (
            <>
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate font-medium text-ink">{t.label}</span>
                <span className="shrink-0 text-xs"><span className={`font-semibold ${TONE[t.level]}`}>{t.level}</span> <span className="text-ink-faint">· {t.solved}/{t.total}</span></span>
              </div>
              <div className="mt-1 flex gap-[2px]" role="img" aria-label={`${t.label}: ${t.level}, mastery score ${t.score}`}>
                {MASTERY.slice(1).map((m, i) => <span key={m} className={`h-1.5 flex-1 rounded-full ${MASTERY.indexOf(t.level) > i ? "bg-accent" : "bg-surface-soft"}`} />)}
              </div>
            </>
          );
          return <li key={t.topic}>{link ? <Link to={link(t.topic)} className="block rounded-lg p-2 hover:bg-hover/5">{body}</Link> : <div className="p-2">{body}</div>}</li>;
        })}
      </ul>
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
  const pyRows = pyMastery(exercises, progress, mounted ? pyStats : {}, PY_CATEGORIES);

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
      streak: days, sqlTopics: sqlRows, pyTopics: pyRows,
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
    { label: "Attempts", value: String(attempts), icon: null },
    { label: "Active days", value: String(progress.activeDays.length), icon: null },
  ];

  return (
    <Container>
      <Seo title="Your SQL Practice Progress" description="Track solved SQL questions, streaks and revision progress. Stored only in your browser." path="/progress" noindex />
      <PageHeader eyebrow="You" title="Your progress" intro={profile ? "Synced to your account and saved in this browser. You can also export it." : "Saved in this browser — sign in to sync it across devices, or export it."} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-faint">
              {s.icon && <s.icon className="h-3.5 w-3.5" aria-hidden />} {s.label}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-ink">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <ShareButton kind="progress" solved={solvedNums.size} total={data.index.length} streak={days} />
        <Link to="/review" className="ml-3 text-sm font-semibold text-accent hover:underline">Open review queue →</Link>
      </div>

      <LearningAnalytics />

      <PracticeNext />

      {(progress.mocks?.length ?? 0) > 0 && (
        <>
          <h2 className="mt-12 font-display text-xl font-bold text-ink">Mock interviews</h2>
          <ul className="mt-4 divide-y divide-surface-border rounded-card border border-surface-border">
            {[...progress.mocks!].reverse().slice(0, 10).map((m) => (
              <li key={m.date} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-ink-muted">{new Date(m.date).toLocaleDateString()}</span>
                <span className="font-semibold text-ink">{m.solved}/{m.total}</span>
                <span className="text-ink-faint">{Math.round(m.usedSec / 60)} of {m.durationMin} min</span>
              </li>
            ))}
          </ul>
          <Link to="/mock-interview" className="mt-2 inline-block text-sm font-medium text-accent hover:underline">Start another</Link>
        </>
      )}

      <div className="mt-12 flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-display text-xl font-bold text-ink">Topic mastery</h2>
        <button type="button" onClick={downloadReport} disabled={!mounted} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-4 py-2 text-sm font-medium text-ink hover:border-accent/40 disabled:opacity-50">
          <FileText className="h-4 w-4" aria-hidden /> Download report
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-muted">Independent solves count fully; solves after hints or a revealed solution count half. Mastered needs 85% and a Hard solve.</p>
      <div className="mt-4 grid gap-8 md:grid-cols-2">
        <MasteryList title="SQL topics" rows={sqlRows} link={(t) => `/topics/${t}`} />
        <MasteryList title="Python categories" rows={pyRows} />
      </div>

      <h2 className="mt-12 font-display text-xl font-bold text-ink">Back up your progress</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-4 py-2 text-sm font-medium text-ink hover:border-accent/40">
          <Download className="h-4 w-4" aria-hidden /> Export
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-4 py-2 text-sm font-medium text-ink hover:border-accent/40">
          <Upload className="h-4 w-4" aria-hidden /> Import
        </button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Delete all progress saved in this browser? This cannot be undone.")) resetProgress();
          }}
          className="rounded-lg px-4 py-2 text-sm font-medium text-danger hover:bg-danger-dim"
        >
          Reset
        </button>
      </div>
      {msg && <p className="mt-3 text-sm text-ink-muted" role="status">{msg}</p>}
    </Container>
  );
}
