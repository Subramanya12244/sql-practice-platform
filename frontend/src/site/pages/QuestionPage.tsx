import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { sendTo } from "../lib/handoff";
import { VizView } from "../components/VizView";
import { addExec, addSession, getExecs, getSessions, highlightInEditor, type ExecRecord, type VizSession } from "../lib/vizHistory";
import type { ExecuteResult } from "../../types";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { HintLadder } from "../components/HintLadder";
import { Comments, CommunitySolutions } from "../components/Community";
import { usePage } from "../SiteApp";
import { InlineMarkdown, Markdown } from "../components/Markdown";
import { Chip, Container, Difficulty, Skeleton } from "../components/ui";
import { ShareButton } from "../components/ShareButton";
import { SchemaPanel } from "../components/SchemaPanel";
import { SITE_NAME, Seo, breadcrumbs, canonical, clip, faqPage } from "../lib/seo";
import { getProgress, markRevealed, recordHint, useProgress } from "../lib/progress";
import { track } from "../lib/activity";

const PracticePanel = lazy(() => import("../components/PracticePanel"));

type Tab = "description" | "hints" | "visualize" | "history" | "solution" | "discuss" | "interview";

function Section({ id, title, children, first }: { id: string; title: string; children: React.ReactNode; first?: boolean }) {
  return (
    <section aria-labelledby={id} className={first ? "" : "mt-8"}>
      <h2 id={id} className="mb-3 font-display text-lg font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Panel({ id, active, children }: { id: Tab; active: Tab; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={active !== id}>
      {children}
    </div>
  );
}

function PrevNext({ q, dir }: { q?: { slug: string; number: number; title: string }; dir: "prev" | "next" }) {
  const Icon = dir === "prev" ? ArrowLeft : ArrowRight;
  const label = dir === "prev" ? "Previous question" : "Next question";
  if (!q) return <span className="rounded-lg p-2 text-ink-faint opacity-40"><Icon className="h-4 w-4" aria-hidden /></span>;
  return (
    <Link to={`/questions/${q.slug}`} className="rounded-lg border border-surface-border p-2 text-ink-muted hover:bg-hover/5 hover:text-ink" aria-label={`${label}: Q${q.number} ${q.title}`} title={`Q${q.number} ${q.title}`}>
      <Icon className="h-4 w-4" aria-hidden />
    </Link>
  );
}

export function QuestionPage() {
  const { data } = usePage();
  const q = data.question!;
  const progress = useProgress();
  const [mounted, setMounted] = useState(false);
  const [justSolved, setJustSolved] = useState(false);
  const [tab, setTab] = useState<Tab>("description");
  const navigate = useNavigate();
  const histKey = `q${q.number}`;
  const [execs, setExecs] = useState<ExecRecord[]>([]);
  const [sessions, setSessions] = useState<VizSession[]>([]);
  const [vizSql, setVizSql] = useState<string | null>(null);
  useEffect(() => {
    setExecs(getExecs(histKey));
    setSessions(getSessions(histKey));
    setVizSql(null);
    track("sql_opened", histKey);
  }, [histKey]);
  const latest = execs[0]?.sql ?? progress.questions[q.number]?.lastSql ?? "";
  const onRan = useCallback((sql: string, res: ExecuteResult) => {
    addExec(histKey, { at: new Date().toISOString(), kind: "run", sql, ok: res.success, rows: res.row_count ?? undefined, attempt: getProgress().questions[q.number]?.attempts ?? 0 });
    setExecs(getExecs(histKey));
  }, [histKey, q.number]);
  const visualizeNow = (sql: string) => {
    setVizSql(sql);
    setTab("visualize");
  };
  const panelRef = useRef<HTMLDivElement>(null);

  // Load the editor bundle only once its slot is near the viewport, so reading
  // the question (and Google's render of it) doesn't pay for Monaco.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !("IntersectionObserver" in window)) {
      setMounted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
          idle(() => setMounted(true));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    setJustSolved(false);
    setTab("description");
  }, [q.number]);

  const pos = data.index.findIndex((x) => x.number === q.number);
  const prev = data.index[pos - 1];
  const next = data.index[pos + 1];
  const related = q.related.map((n) => data.index.find((x) => x.number === n)).filter(Boolean);
  const topic = data.topics.find((t) => t.slug === q.topic);
  const path = `/questions/${q.slug}`;
  const solved = !!progress.questions[q.number]?.solvedAt;

  const jsonLd: object[] = [
    breadcrumbs([
      { name: "Home", path: "/" },
      { name: q.topicLabel, path: `/topics/${q.topic}` },
      { name: `Q${q.number} ${q.title}`, path },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "LearningResource",
      name: `${q.title} — SQL practice question`,
      description: clip(q.objective || q.problem, 300),
      url: canonical(path),
      learningResourceType: "Practice problem",
      educationalLevel: q.difficulty,
      teaches: q.concepts,
      inLanguage: "en",
      isAccessibleForFree: true,
      provider: { "@type": "Organization", name: SITE_NAME },
    },
  ];
  if (q.followups.length) jsonLd.push(faqPage(q.followups));

  const tabs: { id: Tab; label: string }[] = [
    { id: "description", label: "Description" },
    { id: "hints", label: "Hints" },
    { id: "visualize", label: "Visualize query" },
    { id: "history", label: "History" },
    { id: "solution", label: "Solution" },
    { id: "discuss", label: "Discuss" },
    ...(q.followups.length ? [{ id: "interview" as Tab, label: "Interview Q&A" }] : []),
  ];

  return (
    <Container wide className="pt-4">
      <Seo
        title={`Q${q.number}: ${q.title} — ${q.topicLabel} SQL Practice`}
        description={clip(`${q.objective || q.problem} Practice this ${q.topicLabel} SQL question free with solution and explanation.`)}
        path={path}
        type="article"
        jsonLd={jsonLd}
        image={`/og/${q.slug}.png`}
      />

      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Breadcrumb" className="w-full text-xs text-ink-faint">
          <Link to="/questions" className="hover:text-ink">Questions</Link>
          <span className="mx-1.5">/</span>
          <Link to={`/topics/${q.topic}`} className="hover:text-ink">{q.topicLabel}</Link>
        </nav>
        <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
          <span className="mr-2 font-mono text-ink-faint">Q{String(q.number).padStart(2, "0")}</span>
          {q.title}
        </h1>
        <Difficulty level={q.difficulty} />
        {solved && (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Solved
          </span>
        )}
        <a href="#editor" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white lg:hidden">Jump to the editor</a>
        <nav className="ml-auto flex items-center gap-1" aria-label="Question navigation">
          <PrevNext q={prev} dir="prev" />
          <PrevNext q={next} dir="next" />
        </nav>
      </header>

      {/* Laptop and up: a fixed-height workspace where each side scrolls on its own. */}
      <div className="mt-3 grid gap-4 lg:h-[calc(100dvh-9.75rem)] lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-card border border-surface-border bg-surface-raised shadow-panel" aria-label="Question">
          <div role="tablist" aria-label="Question sections" className="scroll-fade-x flex shrink-0 gap-0.5 overflow-x-auto border-b border-surface-border px-2 pt-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap rounded-t-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
                  tab === t.id ? "border-b-2 border-accent text-accent" : "text-ink-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Every panel stays in the HTML (search engines read it); only the active one is shown. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <Panel id="description" active={tab}>
              <div className="flex flex-wrap gap-1.5">
                {q.concepts.slice(0, 6).map((c) => <Chip key={c}>{c}</Chip>)}
              </div>
              <Markdown source={q.problem} className="mt-4 text-ink" />
              {q.objective && (
                <p className="mt-4 rounded-lg border-l-4 border-accent bg-accent-dim px-4 py-3 text-sm text-ink">
                  <strong>Task:</strong> <InlineMarkdown source={q.objective} />
                </p>
              )}
              <p className="mt-4 text-sm text-ink-muted">
                <strong className="text-ink">Tables:</strong>{" "}
                {q.tables.map((t, i) => (
                  <span key={t}>
                    <code className="font-mono text-accent">{t}</code>
                    {i < q.tables.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
              {q.expectedOutput && (
                <div className="mt-6">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Expected output</h2>
                  <Markdown source={q.expectedOutput} className="text-sm" />
                </div>
              )}
              {((data.notes?.length ?? 0) > 0 || (data.patterns?.length ?? 0) > 0) && (
                <div className="mt-6 rounded-lg border border-surface-border bg-surface px-4 py-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Learn the concepts</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {data.notes?.map((n) => <Link key={n.slug} to={`/notes/${n.slug}`} className="text-accent hover:underline">{n.title}</Link>)}
                    {data.patterns?.map((p) => <Link key={p.slug} to={`/patterns/${p.slug}`} className="text-accent hover:underline">Pattern: {p.title}</Link>)}
                  </p>
                </div>
              )}
              {data.schema && (
                <div className="mt-6">
                  <SchemaPanel schema={data.schema} highlight={q.tables} />
                </div>
              )}
              <p className="mt-6 text-sm text-ink-muted">
                Stuck? Try the{" "}
                <button type="button" className="font-medium text-accent underline" onClick={() => setTab("hints")}>hints</button>{" "}
                before the solution.
              </p>
            </Panel>

            <Panel id="hints" active={tab}>
              <HintLadder q={q} notes={data.notes ?? []} />
              {q.pitfalls.length > 0 && (
                <Section id="pitfalls" title="Common pitfalls">
                  <ul className="list-disc space-y-2 pl-5 text-sm text-ink-muted">
                    {q.pitfalls.map((p, i) => <li key={i}><Markdown source={p} /></li>)}
                  </ul>
                </Section>
              )}
            </Panel>

            <Panel id="visualize" active={tab}>
              {tab === "visualize" && (
                !latest.trim() ? (
                  <p className="text-sm text-ink-muted">Run or submit a query in the editor, then visualize it here: logical steps with real intermediate rows, its parsed structure, and PostgreSQL's plan.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <button type="button" onClick={() => setVizSql(latest)} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">
                        {vizSql ? "Visualize my latest query" : "Visualize my query"}
                      </button>
                      <span className="text-xs text-ink-faint">{execs[0] ? `Last ${execs[0].kind} · attempt ${execs[0].attempt} · ${new Date(execs[0].at).toLocaleTimeString()}` : "Your current draft"}</span>
                    </div>
                    {vizSql && (
                      <VizView
                        key={vizSql}
                        sql={vizSql}
                        onClause={(r) => highlightInEditor(vizSql, r)}
                        onDone={(summary) => {
                          const attempt = execs.find((e) => e.sql === vizSql)?.attempt ?? getProgress().questions[q.number]?.attempts ?? 0;
                          addSession(histKey, { sql: vizSql, attempt, dataset: "northwind", ...summary });
                          setSessions(getSessions(histKey));
                        }}
                      />
                    )}
                  </div>
                )
              )}
            </Panel>

            <Panel id="history" active={tab}>
              {tab === "history" && (
                <div className="space-y-6 text-sm">
                  <section>
                    <h2 className="font-display text-lg font-bold text-ink">Execution history</h2>
                    {!execs.length && <p className="mt-1 text-ink-muted">Nothing yet — runs and submits for this question appear here.</p>}
                    <ul className="mt-2 space-y-2">
                      {execs.slice(0, 20).map((e, i) => (
                        <li key={i} className="rounded-lg border border-surface-border p-2">
                          <p className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={e.kind === "submit" ? (e.correct ? "font-semibold text-success" : "font-semibold text-danger") : e.ok ? "text-ink-muted" : "text-danger"}>
                              {e.kind === "submit" ? (e.correct ? "✓ submit" : "✗ submit") : e.ok ? `run · ${e.rows ?? 0} rows` : "run · error"}
                            </span>
                            <span className="text-ink-faint">attempt {e.attempt} · {new Date(e.at).toLocaleString()}</span>
                            <button type="button" onClick={() => visualizeNow(e.sql)} className="ml-auto text-accent hover:underline">Visualize</button>
                          </p>
                          <code className="mt-1 block truncate text-xs text-ink">{e.sql.replace(/\s+/g, " ")}</code>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h2 className="font-display text-lg font-bold text-ink">Visualizations</h2>
                    {!sessions.length && <p className="mt-1 text-ink-muted">Visualizations you open are saved here, linked to the attempt they came from.</p>}
                    <ul className="mt-2 space-y-2">
                      {sessions.map((s) => (
                        <li key={s.id} className="rounded-lg border border-surface-border p-2">
                          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                            <span className="font-medium text-ink">{s.structure}</span>
                            <span>attempt {s.attempt} · {new Date(s.at).toLocaleString()}</span>
                            {s.planRoot && <span>plan: {s.planRoot}{s.planCost !== undefined ? ` (cost ${s.planCost.toFixed(1)})` : ""}</span>}
                            <button type="button" onClick={() => visualizeNow(s.sql)} className="ml-auto text-accent hover:underline">Reopen</button>
                          </p>
                          <code className="mt-1 block truncate text-xs text-ink">{s.sql.replace(/\s+/g, " ")}</code>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}
            </Panel>

            <Panel id="solution" active={tab}>
              <Section id="approach" title="Approach" first>
                <details className="rounded-card border border-surface-border bg-surface p-4">
                  <summary className="cursor-pointer font-medium text-ink">Show the approach</summary>
                  <Markdown source={q.approach} className="mt-3 text-sm" />
                </details>
              </Section>
              <Section id="solution-sql" title="Solution">
                <details
                  className="rounded-card border border-surface-border bg-surface p-4"
                  onToggle={(e) => {
                    if ((e.currentTarget as HTMLDetailsElement).open) {
                      markRevealed(q.number);
                      recordHint(q.number, 5);
                    }
                  }}
                >
                  <summary className="cursor-pointer font-medium text-ink">Reveal the solution</summary>
                  <Markdown source={"```sql\n" + q.solution + "\n```"} className="mt-3 text-sm" />
                  {q.why && <Markdown source={q.why} className="mt-4 text-sm" />}
                </details>
              </Section>
              {q.hadMistakes && q.myMistakes.length > 0 && (
                <Section id="real-mistakes" title="Mistakes made while solving this">
                  <div className="rounded-card border border-warn/30 bg-warn-dim p-4">
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn">
                      <AlertTriangle className="h-4 w-4" aria-hidden /> Real first-attempt errors — learn from them
                    </p>
                    <ul className="list-disc space-y-2 pl-5 text-sm text-ink">
                      {q.myMistakes.map((m, i) => <li key={i}><Markdown source={m} /></li>)}
                    </ul>
                  </div>
                </Section>
              )}
              {q.takeaway && (
                <Section id="takeaway" title="Key takeaway">
                  <p className="rounded-card border border-accent/30 bg-accent-dim p-4 text-ink"><InlineMarkdown source={q.takeaway} /></p>
                </Section>
              )}
              <CommunitySolutions number={q.number} />
            </Panel>

            <Panel id="discuss" active={tab}>
              <Comments number={q.number} />
              {related.length > 0 && (
                <Section id="related" title="Related questions">
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {related.map((r) => r && (
                      <li key={r.slug}>
                        <Link to={`/questions/${r.slug}`} className="text-accent hover:underline">Q{r.number} · {r.title}</Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {topic && (
                <p className="mt-6 text-sm"><Link to={`/topics/${topic.slug}`} className="text-accent hover:underline">All {topic.label} questions →</Link></p>
              )}
            </Panel>

            {q.followups.length > 0 && (
              <Panel id="interview" active={tab}>
                <h2 className="font-display text-lg font-bold text-ink">Interview follow-up questions</h2>
                <div className="mt-4 space-y-5">
                  {q.followups.map((f, i) => (
                    <div key={i}>
                      <h3 className="font-semibold text-ink">{f.question.replace(/^\d+\.\s*/, "")}</h3>
                      <Markdown source={f.answer} className="mt-1.5 text-sm text-ink-muted" />
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </section>

        <div ref={panelRef} id="editor" className="flex min-h-0 scroll-mt-16 flex-col gap-3 lg:overflow-y-auto">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel question={q} fill onRan={onRan} onSolved={(r, sql) => {
                if (r.correct) setJustSolved(true);
                addExec(histKey, { at: new Date().toISOString(), kind: "submit", sql, ok: true, correct: r.correct, rows: r.your_row_count ?? undefined, attempt: getProgress().questions[q.number]?.attempts ?? 0 });
                setExecs(getExecs(histKey));
              }} />
            </Suspense>
          ) : (
            <Skeleton className="h-[580px] lg:h-full" />
          )}
          <div className="flex shrink-0 flex-wrap gap-2 text-xs">
            <Link to={`/ai-tutor?q=${q.slug}`} className="rounded-lg border border-surface-border px-2.5 py-1.5 text-ink-muted hover:text-ink">Open in query helper</Link>
            <Link to={`/study-notes?add=${q.slug}`} className="rounded-lg border border-surface-border px-2.5 py-1.5 text-ink-muted hover:text-ink">Study notes (PDF)</Link>
            <button type="button" className="rounded-lg border border-surface-border px-2.5 py-1.5 text-ink-muted hover:text-ink"
              onClick={() => visualizeNow(latest || q.solution)}>
              Visualize ↗ tab
            </button>
            {solved && (
              <button type="button" className="rounded-lg border border-surface-border px-2.5 py-1.5 text-ink-muted hover:text-ink"
                onClick={() => { sendTo({ tool: "compare", a: progress.questions[q.number]?.lastSql ?? "", b: q.solution, labelA: "Your query", labelB: "Reference solution" }); navigate("/solution-comparison"); }}>
                Compare with the reference
              </button>
            )}
          </div>
          {(justSolved || solved) && (
            <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-card border border-success/30 bg-success-dim px-4 py-3 text-sm text-ink">
              <span className="font-semibold text-success">{justSolved ? "Nice — solved!" : "You solved this one."}</span>
              <ShareButton kind="question" title={q.title} number={q.number} />
              {next && (
                <Link to={`/questions/${next.slug}`} className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline">
                  Next question <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </Container>
  );
}
