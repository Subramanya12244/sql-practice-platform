import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, GitCompare, Loader2, Microscope, Settings2, ShieldAlert } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, Difficulty, PageHeader, Skeleton } from "../components/ui";
import { HintLadder } from "../components/HintLadder";
import { InlineMarkdown, Markdown } from "../components/Markdown";
import { SampleTable } from "../components/SampleTable";
import { Seo } from "../lib/seo";
import { loadQuestion } from "../lib/data";
import { setTutorSettings, useProgress } from "../lib/progress";
import { submitQuery } from "../lib/browserDb";
import { explainQuery, schemaCheck } from "../lib/tutor";
import { sendTo } from "../lib/handoff";
import type { Question } from "../types";
import type { SubmitResult } from "../../types";

const PracticePanel = lazy(() => import("../components/PracticePanel"));

type Tab = "help" | "explain" | "check" | "settings";

export function TutorPage() {
  const { data } = usePage();
  const progress = useProgress();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [slug, setSlug] = useState<string>("");
  const [q, setQ] = useState<Question | null>(null);
  const [tab, setTab] = useState<Tab>("help");
  const [check, setCheck] = useState<SubmitResult | null>(null);
  const [checking, setChecking] = useState(false);

  // Read ?q= after hydration (the prerendered page has no query string).
  useEffect(() => setSlug(new URLSearchParams(search).get("q") ?? data.index[0]?.slug ?? ""), [search, data.index]);
  useEffect(() => {
    if (!slug) return;
    setQ(null);
    setCheck(null);
    loadQuestion(slug).then(setQ);
  }, [slug]);

  const saved = q ? progress.questions[q.number] : undefined;
  const userSql = saved?.lastSql ?? "";
  const notes = q ? (data.notes ?? []).filter((n) => n.questions.includes(q.number)) : [];
  const settings = progress.tutor ?? { maxLevel: 5, confirmSolution: true };
  const explanation = userSql.trim() ? explainQuery(userSql) : null;
  const schemaProblems = userSql.trim() && data.schema ? schemaCheck(userSql, data.schema) : [];
  const mayCompare = Boolean(saved?.solvedAt || (saved?.hintLevel ?? 0) >= 5);

  async function runCheck() {
    if (!q || !userSql.trim()) return;
    setChecking(true);
    try {
      setCheck(await submitQuery(userSql, q.referenceQuery, q.sortRequired, q.orderBy ?? null));
    } finally {
      setChecking(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "help", label: "Hints" },
    { id: "explain", label: "Explain my query" },
    { id: "check", label: "Check my result" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <Container wide>
      <Seo title="SQL Query Helper" description="Step-by-step SQL help: hints, query explanations and result checks." path="/ai-tutor" noindex />
      <PageHeader eyebrow="Practice" title="SQL query helper" intro="Work on a question with prewritten hints, a rule-based explanation of your query and a result check run on the database. The help never gives the answer away unless you ask for it." />
      <label className="mb-4 flex max-w-xl items-center gap-2 text-sm">
        <span className="shrink-0 text-ink-muted">Question</span>
        <select value={slug} onChange={(e) => navigate(`/ai-tutor?q=${e.target.value}`)} className="min-w-0 flex-1 rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-ink">
          {data.index.map((x) => <option key={x.slug} value={x.slug}>Q{x.number} · {x.title}</option>)}
        </select>
      </label>

      {!q ? <Skeleton className="h-[480px]" /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="min-w-0 space-y-4">
            <div className="rounded-card border border-surface-border bg-surface-raised p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/questions/${q.slug}`} className="font-display text-lg font-bold text-ink hover:underline">Q{q.number} {q.title}</Link>
                <Difficulty level={q.difficulty} />
                {saved?.solvedAt && <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> solved{saved.assisted ? " with assistance" : saved.practiced ? " independently" : ""}</span>}
              </div>
              <Markdown source={q.problem} className="mt-2 text-sm" />
              {q.objective && <p className="mt-2 text-sm text-ink"><strong>Task:</strong> <InlineMarkdown source={q.objective} /></p>}
            </div>

            <div role="tablist" aria-label="Helper tools" className="flex flex-wrap gap-1 border-b border-surface-border">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                  className={`rounded-t-lg px-3 py-2 text-sm font-medium ${tab === t.id ? "border-b-2 border-accent text-accent" : "text-ink-muted hover:text-ink"}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "help" && <HintLadder q={q} notes={notes} />}

            {tab === "explain" && (
              <div className="space-y-3 rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
                {!explanation ? <p className="text-ink-muted">Write a query in the editor first — the helper explains your latest draft.</p> : explanation.unsupported ? (
                  <p className="text-ink-muted">{explanation.unsupported}</p>
                ) : (
                  <>
                    <p className="text-xs text-ink-faint">Rule-based explanation of your latest draft, in SQL's logical processing order.</p>
                    <ol className="space-y-2">
                      {explanation.steps.map((s, i) => (
                        <li key={i}><span className="mr-2 rounded bg-accent-dim px-1.5 py-0.5 font-mono text-xs text-accent">{s.clause}</span><span className="text-ink">{s.text}</span></li>
                      ))}
                    </ol>
                    {explanation.joins.length > 0 && <p className="text-ink-muted">Joins: {explanation.joins.join(" · ")}</p>}
                  </>
                )}
                {schemaProblems.length > 0 && (
                  <div className="rounded-lg border border-danger/30 bg-danger-dim p-3">
                    <p className="flex items-center gap-1.5 font-semibold text-danger"><ShieldAlert className="h-4 w-4" aria-hidden /> Not in the schema</p>
                    <ul className="mt-1 list-disc pl-5 text-ink">{schemaProblems.map((p) => <li key={p}>{p}</li>)}</ul>
                  </div>
                )}
                {explanation?.notes.map((n, i) => <p key={i} className="text-xs text-ink-muted">• {n.text}</p>)}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" disabled={!userSql.trim()} onClick={() => { sendTo({ tool: "visualizer", a: userSql }); navigate("/query-visualizer"); }}
                    className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50">
                    <Microscope className="h-3.5 w-3.5" aria-hidden /> Visualize step by step
                  </button>
                  <button type="button" disabled={!userSql.trim() || !mayCompare} title={mayCompare ? "" : "Unlocks after you solve it (or open the full solution)"}
                    onClick={() => { sendTo({ tool: "compare", a: userSql, b: q.solution, labelA: "Your query", labelB: "Reference solution" }); navigate("/solution-comparison"); }}
                    className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50">
                    <GitCompare className="h-3.5 w-3.5" aria-hidden /> Compare with the reference
                  </button>
                </div>
              </div>
            )}

            {tab === "check" && (
              <div className="space-y-3 rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
                <p className="text-ink-muted">Runs your latest draft and the hidden reference on the database and compares the rows — without recording a submit or revealing the solution.</p>
                <button type="button" onClick={runCheck} disabled={checking || !userSql.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-60">
                  {checking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Check my result
                </button>
                {check && (
                  <div className={`rounded-lg border p-3 ${check.correct ? "border-success/30 bg-success-dim" : "border-danger/30 bg-danger-dim"}`}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Verified by the database</p>
                    <p className="mt-1 font-semibold text-ink">{check.message}</p>
                    {check.your_row_count != null && <p className="text-ink-muted">Your rows: {check.your_row_count} · expected: {check.expected_row_count}</p>}
                    {check.diff && check.diff.missingCount > 0 && <div className="mt-2"><SampleTable caption={`Expected but missing (${check.diff.missingCount})`} columns={check.diff.columns} rows={check.diff.missing} /></div>}
                    {check.diff && check.diff.extraCount > 0 && <div className="mt-2"><SampleTable caption={`In yours but not expected (${check.diff.extraCount})`} columns={check.diff.columns} rows={check.diff.extra} /></div>}
                    {!check.correct && check.feedback.length > 0 && <ul className="mt-2 list-disc pl-5 text-ink-muted">{check.feedback.map((f, i) => <li key={i}>{f}</li>)}</ul>}
                  </div>
                )}
              </div>
            )}

            {tab === "settings" && (
              <div className="space-y-3 rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-ink"><Settings2 className="h-4 w-4" aria-hidden /> Help settings</p>
                <label className="flex items-center gap-2 text-ink-muted">
                  Highest hint level to show
                  <select value={settings.maxLevel} onChange={(e) => setTutorSettings({ ...settings, maxLevel: Number(e.target.value) })} className="rounded border border-surface-border bg-surface px-1 py-0.5 text-ink">
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-ink-muted">
                  <input type="checkbox" checked={settings.confirmSolution} onChange={(e) => setTutorSettings({ ...settings, confirmSolution: e.target.checked })} />
                  Ask before showing the complete solution
                </label>
                <p className="text-xs text-ink-faint">Applies to hints on question pages too.</p>
              </div>
            )}
          </div>

          <div className="min-w-0">
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel key={q.slug} question={q} />
            </Suspense>
            <p className="mt-2 text-xs text-ink-faint">Submitting here counts like the question page. The helper reads your latest draft from this editor.</p>
          </div>
        </div>
      )}
    </Container>
  );
}
