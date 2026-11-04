import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Flame, Trophy, Upload } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, PageHeader } from "../components/ui";
import { ShareButton } from "../components/ShareButton";
import { Seo } from "../lib/seo";
import { exportProgress, importProgress, resetProgress, streak, useProgress } from "../lib/progress";

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
      <PageHeader eyebrow="You" title="Your progress" intro="Saved in this browser only — export it to move to another device." />

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
      </div>

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

      <h2 className="mt-12 font-display text-xl font-bold text-ink">By topic</h2>
      <div className="mt-4 space-y-3">
        {data.topics.map((t) => {
          const done = t.questions.filter((n) => solvedNums.has(n)).length;
          const pct = Math.round((done / t.questions.length) * 100);
          return (
            <Link key={t.slug} to={`/topics/${t.slug}`} className="block rounded-lg p-2 hover:bg-hover/5">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-ink">{t.label}</span>
                <span className="text-ink-muted">{done}/{t.questions.length}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-soft" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.label} progress`}>
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
            </Link>
          );
        })}
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
