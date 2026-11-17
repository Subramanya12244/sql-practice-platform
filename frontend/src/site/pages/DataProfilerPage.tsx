import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Download, FileUp, Info, ShieldCheck, Table2 } from "lucide-react";
import { Badge, Button, Card, Container, EmptyState, PageHeader, SectionHeader, StatCard } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { MAX_ROWS, ProfileError, fmt, issuesOf, profileCsv, reportMarkdown, type ColumnProfile, type Profile } from "../lib/csvProfile";

const MAX_BYTES = 5 * 1024 * 1024;

/** A small file with the usual problems, so there is something to look at. It is labelled as a sample, never as the learner's data. */
export const SAMPLE_CSV = `order_id,customer,order_date,amount,status
1001,ALFKI,2026-01-05,120.50,shipped
1002,ANATR,2026-01-06,,shipped
1003,ANTON,01/07/2026,"1,200.00",SHIPPED
1003,ANTON,01/07/2026,"1,200.00",SHIPPED
1004,AROUT,2026-01-09,89.9,cancelled
1005,BERGS,2026-01-10,15000,shipped
1006,BLAUS,2026-02-30,42.0,shipped
1007,BLONP,2026-01-12,abc,pending
1008,BOLID,2026-01-13,77.25,shipped
1009,BONAP,2026-01-14,63,shipped
1010,BOTTM,2026-01-15,58.5,shipped`;

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const TYPE_TONE: Record<string, "accent" | "info" | "success" | "warn" | "neutral" | "secondary"> = { integer: "accent", decimal: "accent", date: "info", boolean: "secondary", text: "neutral", empty: "warn" };
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : "0%");

function Histogram({ col }: { col: ColumnProfile }) {
  const bins = col.histogram ?? [];
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div role="img" aria-label={`Histogram of ${col.name}: ${bins.map((b) => `${fmt(b.from)} to ${fmt(b.to)}: ${b.count}`).join("; ")}`} className="flex h-24 items-end gap-1">
      {bins.map((b, i) => (
        <div key={i} className="flex h-full flex-1 flex-col justify-end" title={`${fmt(b.from)} to ${fmt(b.to)}: ${b.count} values`}>
          <div className="w-full rounded-t bg-accent/70" style={{ height: `${Math.max(4, (b.count / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function ColumnDetail({ col }: { col: ColumnProfile }) {
  return (
    <details className="rounded-lg border border-surface-border bg-surface-raised">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="font-mono font-semibold text-ink">{col.name}</span>
        <Badge tone={TYPE_TONE[col.type]}>{col.type}</Badge>
        {col.unique && <Badge tone="success">possible key</Badge>}
        {col.missing > 0 && <Badge tone="warn">{col.missing} missing</Badge>}
        {col.invalid > 0 && <Badge tone="warn">{col.invalid} invalid</Badge>}
        {col.mixed && <Badge tone="warn">mixed formats</Badge>}
      </summary>
      <div className="grid gap-4 border-t border-surface-border p-3 sm:grid-cols-2">
        <div>
          <p className="text-label uppercase text-ink-faint">Most common values</p>
          <ul className="mt-2 space-y-1 text-sm">
            {col.top.map((t) => <li key={t.value} className="flex justify-between gap-2"><span className="truncate font-mono text-ink">{t.value}</span><span className="tabular-nums text-ink-muted">{t.count}</span></li>)}
            {col.top.length === 0 && <li className="text-ink-muted">No values.</li>}
          </ul>
          {col.invalidSamples.length > 0 && <p className="mt-3 text-xs text-ink-muted">Values that do not fit {col.type}: {col.invalidSamples.map((s) => <code key={s} className="mr-1 rounded bg-surface-soft px-1 font-mono text-ink">{s}</code>)}</p>}
        </div>
        <div>
          {col.stats ? (
            <>
              <p className="text-label uppercase text-ink-faint">Spread</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                {([["Min", col.stats.min], ["Median", col.stats.median], ["Max", col.stats.max], ["Mean", col.stats.mean], ["Q1", col.stats.q1], ["Q3", col.stats.q3]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-[11px] text-ink-faint">{k}</dt><dd className="font-mono text-ink">{fmt(v)}</dd></div>
                ))}
              </dl>
              <div className="mt-3"><Histogram col={col} /></div>
              {col.stats.outliers > 0 && <p className="mt-2 text-xs text-ink-muted">{col.stats.outliers} outside {fmt(col.stats.lowFence)} to {fmt(col.stats.highFence)}.</p>}
            </>
          ) : col.type === "text" ? (
            <p className="text-sm text-ink-muted">Text length: {col.minLength} to {col.maxLength} characters.</p>
          ) : <p className="text-sm text-ink-muted">Distinct values: {col.distinct}.</p>}
        </div>
      </div>
    </details>
  );
}

export function DataProfilerPage() {
  const [text, setText] = useState("");
  const [name, setName] = useState("pasted data");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function run(source: string, label: string, isSample = false) {
    try {
      setProfile(profileCsv(source));
      setError(null);
    } catch (e) {
      setProfile(null);
      setError(e instanceof ProfileError || e instanceof Error ? e.message : "The data could not be profiled.");
    }
    setName(label);
    setSample(isSample);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) { setProfile(null); setError(`That file is ${(file.size / 1048576).toFixed(1)} MB. This tool reads up to 5 MB, so it can run in your browser.`); return; }
    const content = await file.text();
    setText(content.length > 200_000 ? "" : content);
    run(content, file.name);
  }

  const issues = profile ? issuesOf(profile) : [];
  const problems = issues.filter((i) => i.level === "problem");

  return (
    <Container wide>
      <Seo
        title="Data Profiler: Profile a CSV in Your Browser"
        description="Check a CSV for column types, missing values, duplicate rows, invalid values and outliers. It runs in your browser; the file is never uploaded."
        path="/data-profiler"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Data profiler", path: "/data-profiler" }])]}
      />
      <PageHeader eyebrow="Data quality" title="Data profiler" intro="Drop in a CSV and see what is in it before you use it: column types, missing values, duplicates, values that do not fit, and outliers. Everything is computed in your browser; the file is never uploaded." />

      <div className="grid gap-4 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card as="section" aria-labelledby="dp-input">
          <SectionHeader id="dp-input" title="Your data" description={`CSV with a header row. Up to ${MAX_ROWS.toLocaleString()} rows and 5 MB.`} />
          <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" aria-label="Choose a CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => fileInput.current?.click()}><FileUp className="h-4 w-4" aria-hidden /> Choose a CSV file</Button>
            <Button variant="secondary" onClick={() => { setText(SAMPLE_CSV); run(SAMPLE_CSV, "sample orders", true); }}>Try the sample</Button>
          </div>
          <label className="mt-4 block text-sm font-medium text-ink" htmlFor="dp-text">Or paste CSV text</label>
          <textarea id="dp-text" value={text} onChange={(e) => setText(e.target.value)} rows={9} spellCheck={false}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-xs text-ink" placeholder={"id,name,amount\n1,Ada,10.5"} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => run(text, "pasted data")} disabled={!text.trim()}>Profile this text</Button>
            <span className="inline-flex items-center gap-1 text-xs text-ink-faint"><ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden /> Stays in this tab</span>
          </div>
          {error && <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger-dim px-3 py-2 text-sm text-danger">{error}</p>}
        </Card>

        <section aria-labelledby="dp-result" className="min-w-0 space-y-4">
          <h2 id="dp-result" className="sr-only">Profile</h2>
          {!profile ? (
            <EmptyState icon={Table2} title="Nothing profiled yet">Choose a file, paste CSV text, or try the sample. You will see each column's type, missing and invalid values, duplicate rows and outliers here. For rule-based checks on the practice databases, use the <Link to="/data-quality" className="text-accent underline">Data quality lab</Link>.</EmptyState>
          ) : (
            <>
              {sample && <p className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-dim px-3 py-2 text-sm text-ink"><Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden /> This is a built-in sample with problems added on purpose. It is not your data.</p>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="dp-summary">
                <StatCard label="Rows" value={profile.rows.toLocaleString()} />
                <StatCard label="Columns" value={profile.columns.length} />
                <StatCard label="Duplicate rows" value={profile.duplicateRows.toLocaleString()} />
                <StatCard label="Missing cells" value={profile.missingCells.toLocaleString()} />
              </div>

              <Card as="section" aria-labelledby="dp-findings">
                <SectionHeader id="dp-findings" title="Findings" description={problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"} to look at` : "No problems found by these checks"}
                  action={<span className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => download(`${name.replace(/\.[^.]+$/, "")}-profile.md`, reportMarkdown(profile, name), "text/markdown")}><Download className="h-3.5 w-3.5" aria-hidden /> Report</Button></span>} />
                {issues.length === 0 ? <p className="text-sm text-ink-muted">Every column is complete and fits its type, and no row is repeated.</p> : (
                  <ul className="space-y-1.5 text-sm" data-testid="dp-issues">
                    {issues.map((i, n) => (
                      <li key={n} className="flex items-start gap-2">
                        {i.level === "problem" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-label="Problem" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-label="Note" />}
                        <span className="text-ink">{i.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <section aria-labelledby="dp-columns">
                <SectionHeader id="dp-columns" title="Columns" description="Open a column for its common values, spread and histogram." />
                <div className="mb-3 overflow-x-auto rounded-card border border-surface-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface-overlay text-xs text-ink-faint"><tr><th scope="col" className="px-3 py-2">Column</th><th scope="col" className="px-3 py-2">Type</th><th scope="col" className="px-3 py-2">Missing</th><th scope="col" className="px-3 py-2">Distinct</th><th scope="col" className="px-3 py-2">Invalid</th></tr></thead>
                    <tbody className="divide-y divide-surface-border">
                      {profile.columns.map((c) => (
                        <tr key={c.name}>
                          <th scope="row" className="px-3 py-2 font-mono font-medium text-ink">{c.name}</th>
                          <td className="px-3 py-2"><Badge tone={TYPE_TONE[c.type]}>{c.type}</Badge></td>
                          <td className="px-3 py-2 tabular-nums text-ink-muted">{c.missing} ({pct(c.missing, c.rows)})</td>
                          <td className="px-3 py-2 tabular-nums text-ink-muted">{c.distinct}</td>
                          <td className="px-3 py-2 tabular-nums text-ink-muted">{c.invalid}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2">{profile.columns.map((c) => <ColumnDetail key={c.name} col={c} />)}</div>
              </section>
            </>
          )}
        </section>
      </div>
    </Container>
  );
}
