import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../../components/ThemeToggle";
import { Button, Card, Container, PageHeader, SectionHeader, SwitchRow } from "../components/ui";
import { Seo } from "../lib/seo";
import { useAuth } from "../lib/auth";
import { exportProgress, importProgress, resetProgress, setDailyGoal, setTutorSettings, useProgress } from "../lib/progress";
import { download, loadCustomDatasets, deleteCustomDataset } from "../lib/datasets";
import { BRAND } from "../../brand";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card as="section">
      <SectionHeader title={title} description={description} />
      <div className="divide-y divide-surface-border text-sm">{children}</div>
    </Card>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="py-3 first:pt-0 last:pb-0">{children}</div>;
}

export function SettingsPage() {
  const progress = useProgress();
  const { enabled, session, profile } = useAuth();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [customs, setCustoms] = useState(0);
  useEffect(() => setCustoms(loadCustomDatasets().length), []);
  const tutor = progress.tutor ?? { maxLevel: 5, confirmSolution: true };
  const sel = "rounded-lg border border-surface-border bg-surface px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

  return (
    <Container className="max-w-3xl">
      <Seo title="Settings" description={`${BRAND.name} settings.`} path="/settings" noindex />
      <PageHeader eyebrow={BRAND.name} title="Settings" />
      <div className="space-y-4">
        <Section title="Appearance" description="Light, dark or follow your system.">
          <Row><ThemeToggle /></Row>
        </Section>

        <Section title="Learning" description="Pace and how much help the tutor gives.">
          <label className="flex items-center justify-between gap-4 pb-3 text-ink">
            Daily goal (learning actions per day)
            <select className={sel} value={progress.dailyGoal ?? 3} onChange={(e) => setDailyGoal(Number(e.target.value))}>
              {[1, 2, 3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-4 py-3 text-ink">
            Highest hint level the tutor may show
            <select className={sel} value={tutor.maxLevel} onChange={(e) => setTutorSettings({ ...tutor, maxLevel: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <SwitchRow label="Ask before showing a complete solution" checked={tutor.confirmSolution} onChange={(checked) => setTutorSettings({ ...tutor, confirmSolution: checked })} />
        </Section>

        <Section title="Account">
          <Row>{!enabled ? (
            <p className="text-ink-muted">Accounts aren't enabled on this deployment; progress is kept in this browser.</p>
          ) : session ? (
            <p className="text-ink-muted">Signed in as <strong className="text-ink">{profile?.username}</strong>. <Link to="/account" className="text-accent underline">Manage account</Link></p>
          ) : (
            <p className="text-ink-muted"><Link to="/login" className="text-accent underline">Sign in</Link> to sync progress across devices.</p>
          )}</Row>
        </Section>

        <Section title="Your data" description="Everything here stays in this browser unless you export it.">
          <Row>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => download("dataforge-progress.json", exportProgress(), "application/json")}>Export progress</Button>
            <Button variant="secondary" size="sm" onClick={() => file.current?.click()}>Import progress</Button>
            <input ref={file} type="file" accept="application/json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setMsg(importProgress(await f.text()) ? "Progress imported." : "That file isn't a valid progress export.");
            }} />
          </div>
          {msg && <p role="status" className="mt-2 text-ink-muted">{msg}</p>}
          </Row>
          <Row><p className="text-ink-muted">
            Generated datasets stored in this browser: {customs}.{" "}
            {customs > 0 && (
              <button type="button" className="text-danger underline" onClick={() => {
                if (!confirm("Delete all generated datasets from this browser?")) return;
                for (const d of loadCustomDatasets()) deleteCustomDataset(d.id);
                setCustoms(0);
              }}>Delete them</button>
            )}
          </p></Row>
          <Row><button type="button" className="text-danger underline" onClick={() => {
            if (confirm("Reset all progress in this browser? Export it first if you want a backup. This can't be undone.")) resetProgress();
          }}>Reset progress in this browser</button></Row>
        </Section>
      </div>
    </Container>
  );
}
