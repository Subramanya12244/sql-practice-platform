import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, Download, Eye, FileText, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { usePage } from "../SiteApp";
import { Badge, Button, Card, Container, Difficulty, EmptyState, PageHeader, Tabs } from "../components/ui";
import { Seo } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { useAuth } from "../lib/auth";
import { PY_CATEGORIES } from "../lib/pyPractice";
import { defaultOptions, effectiveInclude, kindOf, topicsOf, type NoteItem, type NotesInclude, type NotesOptions } from "../lib/notes/content";
import { THEMES, flowSvg, outlineSvg, pipelineSvg, schemaSvg } from "../lib/notes/svg";
import { collectItems, renderPdf, type Selection } from "../lib/notes/generate";
import { deleteNote, listNotes, noteBlob, saveNote, type StoredNote } from "../lib/notes/library";

const MAX_ITEMS = 60;
const INPUT = "max-w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink";
const DE = new Set(["ETL Pipeline Development", "Data Processing and Transformation", "File Handling and Data Formats"]);
const groupOf = (n: StoredNote) => (n.kind === "sql" ? "SQL" : n.topics.some((t) => DE.has(t)) ? "Data Engineering" : n.kind === "mixed" ? "Mixed" : "Python");
const catLabel = (slug: string) => PY_CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;

const INCLUDE_LABELS: [keyof NotesInclude, string][] = [
  ["statement", "Problem statement"], ["schema", "Database schema"], ["queryDiagram", "SQL query diagram"], ["pyDiagram", "Python logic diagram"],
  ["deDiagram", "Data flow diagram"], ["code", "SQL / Python code"], ["explanation", "Step-by-step explanation"], ["output", "Expected output / examples"],
  ["notes", "Important notes"], ["reference", "Reference solution (SQL)"], ["tests", "Test-case results"],
];

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileName = (title: string) => `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "study-notes"}.pdf`;

export function StudyNotesPage() {
  const { data } = usePage();
  const progress = useProgress();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { search } = useLocation();
  const [tab, setTab] = useState<"create" | "library">("create");
  const [kind, setKind] = useState<"sql" | "python">("sql");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [status, setStatus] = useState<"completed" | "all" | "bookmarked">("completed");
  const [picked, setPicked] = useState<Selection[]>([]);
  const [opts, setOpts] = useState<NotesOptions>(() => defaultOptions());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<NoteItem[] | null>(null);
  const [pdf, setPdf] = useState<{ url: string; blob: Blob; pages: number; saved: StoredNote | null } | null>(null);
  const [notes, setNotes] = useState<StoredNote[] | null>(null);
  const [mounted, setMounted] = useState(false);
  const exercises = data.exercises ?? [];

  useEffect(() => {
    setMounted(true);
    const add = new URLSearchParams(search).getAll("add");
    if (add.length) {
      const sel = add.map((a): Selection => (a.startsWith("py:") ? { kind: "python", key: a.slice(3) } : { kind: "sql", key: a }));
      setPicked(sel);
      setKind(sel[0].kind);
      setStatus("all");
    }
  }, [search]);
  const refresh = () => listNotes(userId).then(setNotes).catch((e: Error) => { setNotes([]); setErr(e.message); });
  useEffect(() => { if (mounted) void refresh(); }, [mounted, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url); }, [pdf]);

  const done = mounted ? progress : { questions: {}, lessons: {}, bookmarks: [] as string[] } as unknown as typeof progress;
  const rows = useMemo(() => {
    if (kind === "sql") return data.index.filter((q) => (!topic || q.topic === topic) && (!difficulty || q.difficulty === difficulty) &&
      (status === "all" || (status === "completed" ? done.questions[q.number]?.solvedAt : done.bookmarks?.includes(`q:${q.number}`))))
      .map((q) => ({ sel: { kind: "sql" as const, key: q.slug }, label: `Q${q.number} ${q.title}`, difficulty: q.difficulty, group: q.topicLabel, solved: !!done.questions[q.number]?.solvedAt }));
    return exercises.filter((e) => (!topic || e.category === topic) && (!difficulty || e.difficulty === difficulty) &&
      (status === "all" || (status === "completed" ? done.lessons?.[`py:${e.slug}`] : done.bookmarks?.includes(`py:${e.slug}`))))
      .map((e) => ({ sel: { kind: "python" as const, key: e.slug }, label: `${e.code} ${e.title}`, difficulty: e.difficulty, group: catLabel(e.category), solved: !!done.lessons?.[`py:${e.slug}`] }));
  }, [kind, topic, difficulty, status, data.index, exercises, done]);
  const isPicked = (s: Selection) => picked.some((p) => p.kind === s.kind && p.key === s.key);
  const toggle = (s: Selection) => setPicked((p) => (isPicked(s) ? p.filter((x) => !(x.kind === s.kind && x.key === s.key)) : [...p, s].slice(0, MAX_ITEMS)));
  const labelOf = (s: Selection) => (s.kind === "sql" ? data.index.find((q) => q.slug === s.key)?.title : exercises.find((e) => e.slug === s.key)?.title) ?? s.key;

  async function collect() {
    setErr(null); setPdf(null);
    try {
      const items = await collectItems(picked, data.index, progress, (n, label) => setBusy(`Preparing ${Math.min(n + 1, picked.length)} of ${picked.length}: ${label}`));
      setPreview(items);
      return items;
    } catch (e) {
      setErr(`Could not prepare the notes: ${(e as Error).message}`);
      return null;
    } finally { setBusy(null); }
  }
  async function generate(items?: NoteItem[] | null, o = opts) {
    const it = items ?? preview ?? (await collect());
    if (!it?.length) return;
    setErr(null); setBusy("Building the PDF (fonts load once, about 4 MB)…");
    try {
      const { blob, pages } = await renderPdf(it, o);
      let saved: StoredNote | null = null;
      try {
        saved = await saveNote(userId, { title: o.title, kind: kindOf(it), topics: topicsOf(it).map((t) => catLabel(t)), refs: it.map((i) => i.ref), options: o, pages, size_bytes: blob.size }, blob);
        void refresh();
      } catch (e) { setErr(`The PDF is ready but was not saved to My Study Notes: ${(e as Error).message}`); }
      setPdf({ url: URL.createObjectURL(blob), blob, pages, saved });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function regenerate(n: StoredNote) {
    const sel = n.refs.map((r): Selection => (r.startsWith("py:") ? { kind: "python", key: r.slice(3) } : { kind: "sql", key: data.index.find((q) => `q${q.number}` === r)?.slug ?? r }));
    setTab("create"); setPicked(sel); setOpts(n.options);
    const items = await collectItems(sel, data.index, progress, (i, label) => setBusy(`Preparing ${Math.min(i + 1, sel.length)} of ${sel.length}: ${label}`)).catch((e: Error) => { setErr(e.message); return null; });
    setBusy(null);
    if (items) { setPreview(items); await generate(items, n.options); }
  }

  const inc = effectiveInclude(opts);
  const t = THEMES[opts.theme];
  const set = <K extends keyof NotesOptions>(k: K, v: NotesOptions[K]) => { setOpts((o) => ({ ...o, [k]: v })); setPdf(null); };

  return (
    <Container wide>
      <Seo title="Visual Learning Notes" description="Turn completed SQL and Python problems into PDF study notes with schemas, query-flow diagrams, code and explanations." path="/study-notes" noindex />
      <PageHeader eyebrow="Study notes" title="Visual Learning Notes" intro="Pick problems you have completed and download a PDF study guide: real schema diagrams, query-flow and logic diagrams drawn from the code, highlighted code, explanations and expected output." />
      <Tabs label="Study notes view" value={tab} onChange={setTab} tabs={[{ id: "create", label: "Create notes" }, { id: "library", label: `My Study Notes${notes ? ` (${notes.length})` : ""}` }]} />
      {err && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-dim px-4 py-3 text-sm text-danger">{err}</p>}

      {tab === "create" && (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card pad="md" as="section" className="min-w-0" aria-label="Choose problems">
            <div className="flex flex-wrap gap-2">
              <select aria-label="Language" value={kind} onChange={(e) => { setKind(e.target.value as "sql" | "python"); setTopic(""); }} className={INPUT}><option value="sql">SQL</option><option value="python">Python</option></select>
              <select aria-label={kind === "sql" ? "Topic" : "Category"} value={topic} onChange={(e) => setTopic(e.target.value)} className={INPUT}>
                <option value="">{kind === "sql" ? "All topics" : "All categories"}</option>
                {kind === "sql" ? data.topics.map((x) => <option key={x.slug} value={x.slug}>{x.label}</option>) : PY_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.short}</option>)}
              </select>
              <select aria-label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={INPUT}><option value="">All levels</option>{["Easy", "Medium", "Hard"].map((d) => <option key={d}>{d}</option>)}</select>
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={INPUT}><option value="completed">Completed</option><option value="bookmarked">Bookmarked</option><option value="all">All problems</option></select>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Button size="sm" variant="secondary" disabled={!rows.length} onClick={() => setPicked((p) => [...p, ...rows.map((r) => r.sel).filter((s) => !p.some((x) => x.kind === s.kind && x.key === s.key))].slice(0, MAX_ITEMS))}>Select all {rows.length} shown</Button>
              {picked.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setPicked([]); setPreview(null); setPdf(null); }}>Clear selection</Button>}
              <span className="text-ink-muted">{picked.length} selected (max {MAX_ITEMS})</span>
            </div>
            {mounted && !rows.length ? (
              <div className="mt-3"><EmptyState icon={BookOpen} title={status === "completed" ? "No completed problems here yet" : "Nothing matches"}>{status === "completed" ? <>Solve some {kind === "sql" ? <Link to="/questions" className="text-accent hover:underline">SQL questions</Link> : <Link to="/practice/python" className="text-accent hover:underline">Python problems</Link>} first, or switch Status to All problems.</> : "Change the filters."}</EmptyState></div>
            ) : (
              <ul className="mt-3 max-h-[420px] divide-y divide-surface-border overflow-y-auto rounded-lg border border-surface-border">
                {rows.map((r) => (
                  <li key={r.sel.key}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-overlay">
                      <input type="checkbox" checked={isPicked(r.sel)} onChange={() => { toggle(r.sel); setPreview(null); setPdf(null); }} />
                      <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
                      <span className="hidden shrink-0 text-xs text-ink-faint sm:block">{r.group}</span>
                      {r.solved && <Badge tone="success">done</Badge>}
                      <Difficulty level={r.difficulty} />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card pad="md" as="section" className="min-w-0" aria-label="Document options">
            <label className="block text-sm text-ink">Document title
              <input value={opts.title} maxLength={120} onChange={(e) => set("title", e.target.value)} className={`${INPUT} mt-1 w-full`} />
            </label>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <select aria-label="Document type" value={opts.mode} onChange={(e) => set("mode", e.target.value as NotesOptions["mode"])} className={INPUT}><option value="detailed">Detailed study guide</option><option value="compact">Compact revision sheet</option></select>
              <select aria-label="Theme" value={opts.theme} onChange={(e) => set("theme", e.target.value as NotesOptions["theme"])} className={INPUT}><option value="light">Light theme</option><option value="dark">Dark theme</option></select>
              <select aria-label="Python solution" value={opts.pySolution} onChange={(e) => set("pySolution", e.target.value as NotesOptions["pySolution"])} className={INPUT}>
                <option value="both">Python: my + reference solution</option><option value="mine">Python: my solution</option><option value="reference">Python: reference solution</option><option value="none">Python: no code</option>
              </select>
            </div>
            <fieldset className="mt-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Content</legend>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {INCLUDE_LABELS.map(([k, label]) => (
                  <label key={k} className={`flex items-center gap-2 ${opts.mode === "compact" && !inc[k] && opts.include[k] ? "text-ink-faint" : "text-ink"}`}>
                    <input type="checkbox" checked={opts.include[k]} onChange={(e) => set("include", { ...opts.include, [k]: e.target.checked })} />{label}
                  </label>
                ))}
              </div>
              {opts.mode === "compact" && <p className="mt-1 text-xs text-ink-faint">A revision sheet leaves out schemas, data-flow diagrams, output tables and test results.</p>}
            </fieldset>
            <fieldset className="mt-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Document</legend>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-ink">
                {([["branding", "DataForge branding"], ["pageNumbers", "Page numbers"], ["toc", "Table of contents"], ["labels", "Difficulty and topic labels"], ["date", "Date generated"]] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={opts[k]} onChange={(e) => set(k, e.target.checked)} />{label}</label>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={!picked.length || !!busy} onClick={() => void collect()}><Eye className="h-4 w-4" aria-hidden /> Preview</Button>
              <Button disabled={!picked.length || !!busy} onClick={() => void generate()}><FileText className="h-4 w-4" aria-hidden /> Generate study notes</Button>
            </div>
            {busy && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {busy}</p>}
            {!picked.length && <p className="mt-3 text-xs text-ink-faint">Select at least one problem.</p>}
            {picked.length > 0 && !busy && !preview && <p className="mt-3 text-xs text-ink-muted">Selected: {picked.slice(0, 6).map(labelOf).join(", ")}{picked.length > 6 ? ` and ${picked.length - 6} more` : ""}.</p>}
          </Card>

          {pdf && (
            <Card pad="md" as="section" aria-label="Generated PDF" className="lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink"><strong>{opts.title}</strong> · {pdf.pages} page{pdf.pages === 1 ? "" : "s"} · {(pdf.blob.size / 1024).toFixed(0)} KB{pdf.saved ? ` · saved to My Study Notes (${pdf.saved.where === "account" ? "your account" : "this browser"})` : ""}</p>
                <Button onClick={() => download(pdf.blob, fileName(opts.title))}><Download className="h-4 w-4" aria-hidden /> Download PDF</Button>
              </div>
              <iframe title="PDF preview" src={pdf.url} className="mt-3 h-[720px] w-full rounded-lg border border-surface-border bg-white" />
            </Card>
          )}

          {preview && !pdf && (
            <section aria-label="Preview" className="space-y-4 lg:col-span-2">
              <p className="text-sm text-ink-muted">Preview of the content and diagrams that go into the PDF ({preview.length} problem{preview.length === 1 ? "" : "s"}). Page layout appears once the PDF is generated.</p>
              {preview.map((it) => {
                const diagrams = it.kind === "sql"
                  ? [inc.schema && schemaSvg(it.tables, t), inc.queryDiagram && it.flow && flowSvg(it.flow, t)]
                  : [inc.pyDiagram && it.outline && outlineSvg(it.outline, t), inc.deDiagram && it.outline && pipelineSvg(it.outline.stages, t)];
                return (
                  <Card key={it.ref} pad="md" as="article">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-bold text-ink">{it.kind === "sql" ? `Q${it.number}` : it.code} {it.title}</h3>
                      <Difficulty level={it.difficulty} /><Badge>{it.kind === "sql" ? it.topic : catLabel(it.category)}</Badge>
                    </div>
                    {it.kind === "sql" ? (
                      <p className="mt-1 text-xs text-ink-muted">{it.sqlSource === "yours" ? "Your solved query" : "Reference query"} · {it.steps.length} explained clauses · {it.output ? `${it.output.total} expected rows` : it.outputNote}{it.flowNote ? ` · ${it.flowNote}` : ""}</p>
                    ) : (
                      <p className="mt-1 text-xs text-ink-muted">{it.mine ? "Your passing solution found" : "No passing solution of yours in this browser: the reference is used"} · {it.tests ? `visible ${it.tests.visible.passed}/${it.tests.visible.total}, hidden ${it.tests.hidden.passed}/${it.tests.hidden.total}` : "tests not run"}{it.outline ? ` · data flow: ${it.outline.stages.map((s) => s.label).join(" → ") || "none"}` : ""}</p>
                    )}
                    <div className="mt-3 grid gap-3 xl:grid-cols-2">
                      {diagrams.filter((d): d is string => typeof d === "string").map((d, i) => (
                        // SVG strings are generated by lib/notes/svg.ts with every text value escaped.
                        <div key={i} className="overflow-x-auto rounded-lg border border-surface-border [&>svg]:h-auto [&>svg]:max-w-full" dangerouslySetInnerHTML={{ __html: d }} />
                      ))}
                    </div>
                  </Card>
                );
              })}
            </section>
          )}
        </div>
      )}

      {tab === "library" && (
        <div className="mt-4">
          {!notes ? <p className="text-sm text-ink-muted">Loading…</p> : !notes.length ? (
            <EmptyState icon={FileText} title="No study notes yet">Generated PDFs are kept here{userId ? " in your account (only you can see them)" : " in this browser. Sign in to keep them in your account"}.</EmptyState>
          ) : (
            ["SQL", "Python", "Data Engineering", "Mixed"].map((g) => {
              const list = notes.filter((n) => groupOf(n) === g);
              return list.length ? (
                <section key={g} aria-label={`${g} notes`} className="mb-6">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-faint">{g}</h2>
                  <ul className="divide-y divide-surface-border overflow-hidden rounded-card border border-surface-border bg-surface-raised">
                    {list.map((n) => (
                      <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{n.title}</span>
                          <span className="block truncate text-xs text-ink-muted">{new Date(n.created_at).toLocaleString()} · {n.refs.length} problem{n.refs.length === 1 ? "" : "s"} · {n.pages} pages · {n.topics.join(", ")}</span>
                        </span>
                        <span className="flex shrink-0 gap-1">
                          <Button size="sm" variant="ghost" aria-label={`Download ${n.title}`} onClick={() => noteBlob(userId, n).then((b) => download(b, fileName(n.title))).catch((e: Error) => setErr(e.message))}><Download className="h-4 w-4" aria-hidden /></Button>
                          <Button size="sm" variant="ghost" aria-label={`Generate an updated version of ${n.title}`} disabled={!!busy} onClick={() => void regenerate(n)}><RefreshCw className="h-4 w-4" aria-hidden /></Button>
                          <Button size="sm" variant="ghost" aria-label={`Delete ${n.title}`} onClick={() => { if (confirm(`Delete "${n.title}"?`)) deleteNote(userId, n).then(refresh).catch((e: Error) => setErr(e.message)); }}><Trash2 className="h-4 w-4 text-danger" aria-hidden /></Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null;
            })
          )}
          <p className="text-xs text-ink-faint">{userId ? "Saved in your account: the files are private to you." : "Saved in this browser only."}</p>
        </div>
      )}
    </Container>
  );
}
