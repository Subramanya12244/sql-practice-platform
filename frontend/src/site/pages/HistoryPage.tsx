import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, History, Repeat, Save, XCircle } from "lucide-react";
import { usePage } from "../SiteApp";
import { Card, Container, EmptyState, PageHeader, Tabs } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { Seo } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { savedSolutions, sqlRevision, submissionHistory, type HistoryItem } from "../lib/extras";
import { overview, readStats } from "../lib/pyPractice";

type Tab = "history" | "revise" | "saved";
type PyRun = { at: string; kind: "run" | "check"; ok: boolean; message: string; code?: string };

/** Python check history lives per problem in this browser (`sqlp.py.history.<slug>`). */
function readPyHistories(): Record<string, PyRun[]> {
  const out: Record<string, PyRun[]> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("sqlp.py.history.")) continue;
      try { out[k.slice("sqlp.py.history.".length)] = JSON.parse(localStorage.getItem(k) ?? "[]"); } catch { /* skip a corrupt entry */ }
    }
  } catch { /* storage blocked */ }
  return out;
}

export function HistoryPage() {
  const { data } = usePage();
  const progress = useProgress();
  const [tab, setTab] = useState<Tab>("history");
  const [kind, setKind] = useState<"" | "sql" | "python">("");
  const [result, setResult] = useState<"" | "passed" | "failed">("");
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [pyRevise, setPyRevise] = useState<ReturnType<typeof overview>["revise"]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const exercises = data.exercises ?? [];

  useEffect(() => {
    setItems(submissionHistory(data.index, progress, exercises, readPyHistories()));
    setPyRevise(overview(exercises, progress.lessons, readStats()).revise);
  }, [data.index, data.exercises, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (items ?? []).filter((h) => (!kind || h.kind === kind) && (!result || (result === "passed") === h.ok));
  const revise = sqlRevision(data.index, progress);
  const saved = savedSolutions(items ?? []);

  return (
    <Container>
      <Seo title="Submission history" description="Your SQL and Python submissions, what to revise, and your saved solutions." path="/history" noindex />
      <PageHeader eyebrow="You" title="History and revision" intro="Every check you ran, the problems worth another try, and the last passing version of your own solutions. Stored in this browser; solved status also syncs to your account." />
      <Tabs label="History view" value={tab} onChange={setTab} tabs={[
        { id: "history", label: `Submissions${items ? ` (${items.length})` : ""}` },
        { id: "revise", label: `To revise (${revise.length + pyRevise.length})` },
        { id: "saved", label: `Saved solutions${items ? ` (${saved.length})` : ""}` },
      ]} />

      <div className="mt-4">
        {tab === "history" && (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-sm">
              <select aria-label="Language" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-ink">
                <option value="">SQL and Python</option><option value="sql">SQL</option><option value="python">Python</option>
              </select>
              <select aria-label="Result" value={result} onChange={(e) => setResult(e.target.value as typeof result)} className="rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-ink">
                <option value="">Any result</option><option value="passed">Passed</option><option value="failed">Failed</option>
              </select>
            </div>
            {items && !shown.length ? <EmptyState icon={History} title="No submissions yet">Submit a SQL query or check a Python solution and it shows up here.</EmptyState> : (
              <ul className="divide-y divide-surface-border overflow-hidden rounded-card border border-surface-border bg-surface-raised">
                {shown.slice(0, 200).map((h, i) => (
                  <li key={`${h.key}-${h.at}-${i}`} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      {h.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Passed" /> : <XCircle className="h-4 w-4 shrink-0 text-danger" aria-label="Failed" />}
                      <span className="w-14 shrink-0 text-xs uppercase tracking-wider text-ink-faint">{h.kind}</span>
                      <Link to={h.path} className="min-w-0 flex-1 truncate text-ink hover:text-accent">{h.title}</Link>
                      <span className="hidden shrink-0 text-xs text-ink-faint sm:block">{new Date(h.at).toLocaleString()}</span>
                      {h.code && <button type="button" className="shrink-0 text-xs text-accent hover:underline" aria-expanded={open === `${h.key}${h.at}`} onClick={() => setOpen(open === `${h.key}${h.at}` ? null : `${h.key}${h.at}`)}>Code</button>}
                    </div>
                    <p className="ml-7 mt-0.5 truncate text-xs text-ink-muted">{h.detail}</p>
                    {open === `${h.key}${h.at}` && h.code && <Markdown source={"```" + (h.kind === "sql" ? "sql" : "python-syntax") + "\n" + h.code + "\n```"} className="ml-7 mt-2 text-xs" />}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink-faint">SQL shows the latest state of each question you practised; Python shows every check.</p>
          </>
        )}

        {tab === "revise" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card pad="md" as="section" aria-label="SQL to revise">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Repeat className="h-4 w-4 text-accent" aria-hidden /> SQL</h2>
              {revise.length ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {revise.map((r) => <li key={r.q.number} className="flex justify-between gap-2"><Link to={`/questions/${r.q.slug}`} className="truncate text-ink hover:text-accent">Q{r.q.number} {r.q.title}</Link><span className="shrink-0 text-xs text-ink-muted">{r.reason}</span></li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-ink-muted">Nothing to revise. Solved questions also come back in the <Link to="/review" className="text-accent hover:underline">review queue</Link>.</p>}
            </Card>
            <Card pad="md" as="section" aria-label="Python to revise">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Repeat className="h-4 w-4 text-accent" aria-hidden /> Python</h2>
              {pyRevise.length ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {pyRevise.map((e) => <li key={e.slug} className="flex justify-between gap-2"><Link to={`/practice/python/${e.slug}`} className="truncate text-ink hover:text-accent">{e.code} {e.title}</Link><span className="shrink-0 text-xs text-ink-muted">{progress.lessons?.[`py:${e.slug}`] ? "solved after several failed checks" : "not solved yet"}</span></li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-ink-muted">Nothing to revise.</p>}
            </Card>
          </div>
        )}

        {tab === "saved" && (
          saved.length ? (
            <ul className="space-y-3">
              {saved.map((h) => (
                <li key={h.key}>
                  <Card pad="sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link to={h.path} className="truncate font-medium text-ink hover:text-accent">{h.title}</Link>
                      <span className="shrink-0 text-xs text-ink-faint">{h.kind.toUpperCase()} · {new Date(h.at).toLocaleDateString()}</span>
                    </div>
                    <Markdown source={"```" + (h.kind === "sql" ? "sql" : "python-syntax") + "\n" + h.code + "\n```"} className="mt-2 text-xs" />
                  </Card>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={Save} title="No saved solutions yet">The last passing version of each problem you solve is kept here. Named queries from the <Link to="/playground" className="text-accent hover:underline">playground</Link> stay in its Saved list.</EmptyState>
        )}
      </div>
    </Container>
  );
}
