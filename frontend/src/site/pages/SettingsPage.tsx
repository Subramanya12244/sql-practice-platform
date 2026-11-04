import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../../components/ThemeToggle";
import { Container, PageHeader } from "../components/ui";
import { Seo } from "../lib/seo";
import { useAuth } from "../lib/auth";
import { exportProgress, importProgress, resetProgress, setDailyGoal, setTutorSettings, useProgress } from "../lib/progress";
import { download, loadCustomDatasets, deleteCustomDataset } from "../lib/datasets";
import { BRAND } from "../../brand";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-surface-border bg-surface-raised p-5">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-sm">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const progress = useProgress();
  const { enabled, session, profile } = useAuth();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [customs, setCustoms] = useState(0);
  useEffect(() => setCustoms(loadCustomDatasets().length), []);
  const tutor = progress.tutor ?? { maxLevel: 5, confirmSolution: true };
  const sel = "rounded border border-surface-border bg-surface px-2 py-1 text-ink";

  return (
    <Container className="max-w-3xl">
      <Seo title="Settings" description={`${BRAND.name} settings.`} path="/settings" noindex />
      <PageHeader eyebrow={BRAND.name} title="Settings" />
      <div className="space-y-4">
        <Section title="Appearance">
          <ThemeToggle />
        </Section>

        <Section title="Learning">
          <label className="flex items-center gap-2 text-ink-muted">
            Daily goal (learning actions per day)
            <select className={sel} value={progress.dailyGoal ?? 3} onChange={(e) => setDailyGoal(Number(e.target.value))}>
              {[1, 2, 3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            Highest hint level the tutor may show
            <select className={sel} value={tutor.maxLevel} onChange={(e) => setTutorSettings({ ...tutor, maxLevel: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            <input type="checkbox" checked={tutor.confirmSolution} onChange={(e) => setTutorSettings({ ...tutor, confirmSolution: e.target.checked })} />
            Ask before showing a complete solution
          </label>
        </Section>

        <Section title="Account">
          {!enabled ? (
            <p className="text-ink-muted">Accounts aren't enabled on this deployment; progress is kept in this browser.</p>
          ) : session ? (
            <p className="text-ink-muted">Signed in as <strong className="text-ink">{profile?.username}</strong>. <Link to="/account" className="text-accent underline">Manage account</Link></p>
          ) : (
            <p className="text-ink-muted"><Link to="/login" className="text-accent underline">Sign in</Link> to sync progress across devices.</p>
          )}
        </Section>

        <Section title="Your data">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border border-surface-border px-3 py-1.5" onClick={() => download("dataforge-progress.json", exportProgress(), "application/json")}>Export progress</button>
            <button type="button" className="rounded-lg border border-surface-border px-3 py-1.5" onClick={() => file.current?.click()}>Import progress</button>
            <input ref={file} type="file" accept="application/json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setMsg(importProgress(await f.text()) ? "Progress imported." : "That file isn't a valid progress export.");
            }} />
          </div>
          {msg && <p role="status" className="text-ink-muted">{msg}</p>}
          <p className="text-ink-muted">
            Generated datasets stored in this browser: {customs}.{" "}
            {customs > 0 && (
              <button type="button" className="text-danger underline" onClick={() => {
                if (!confirm("Delete all generated datasets from this browser?")) return;
                for (const d of loadCustomDatasets()) deleteCustomDataset(d.id);
                setCustoms(0);
              }}>Delete them</button>
            )}
          </p>
          <button type="button" className="text-danger underline" onClick={() => {
            if (confirm("Reset all progress in this browser? Export it first if you want a backup. This can't be undone.")) resetProgress();
          }}>Reset progress in this browser</button>
        </Section>
      </div>
    </Container>
  );
}
