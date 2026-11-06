import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical, Loader2, Pencil, Plus, Search, XCircle } from "lucide-react";
import { usePage } from "../SiteApp";
import { getSupabase } from "../lib/supabase";
import { loadContent, overrideKey, type CustomQuestion, type Override } from "../lib/contentOverrides";
import { loadQuestion } from "../lib/data";
import { loadExercise } from "../lib/pyExercises";
import { runQuery } from "../lib/browserDb";
import { runPython } from "../lib/pyRunner";
import { runPythonTask } from "../lib/tasks";
import { pct, presetRange } from "../lib/adminAnalytics";
import { Button, Card, Difficulty } from "./ui";

const INPUT = "max-w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-faint";
const td = "px-3 py-2 text-sm text-ink";

interface Row { kind: "sql" | "python"; ref: string; code: string; slug: string; title: string; difficulty: string; topic: string; override?: Override; submits: number; fails: number }
interface Check { ref: string; kind: "sql" | "python"; ok: boolean; problem: string }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Admin content management (migration 010): overrides, custom SQL questions, quality checks. */
export function AdminContent() {
  const { data } = usePage();
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [custom, setCustom] = useState<CustomQuestion[]>([]);
  const [stats, setStats] = useState<Map<string, { submits: number; passed: number }>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | "sql" | "python">("");
  const [status, setStatus] = useState<"" | "disabled" | "edited" | "failing">("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [editingCustom, setEditingCustom] = useState<Partial<CustomQuestion> | null>(null);
  const [checks, setChecks] = useState<{ running: boolean; done: number; total: number; results: Check[] } | null>(null);

  const refresh = useCallback(async () => {
    const r = await loadContent(true);
    setOverrides(r.overrides); setCustom(r.custom);
    const sb = await getSupabase();
    const range = presetRange(90);
    const { data: rows, error } = await sb.rpc("admin_problem_stats", { p_from: range.from, p_to: range.to });
    if (!error) setStats(new Map(((rows ?? []) as { kind: string; ref: string; submits: number; passed: number }[]).map((x) => [`${x.kind}:${x.kind === "sql" ? x.ref.replace(/^q/, "") : x.ref.replace(/^py:/, "")}`, { submits: Number(x.submits), passed: Number(x.passed) }])));
    const probe = await sb.from("question_overrides").select("kind").limit(1);
    if (probe.error) setErr("Content management needs migration 010_content_management.sql.");
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const rows: Row[] = useMemo(() => [
    ...data.index.map((x) => ({ kind: "sql" as const, ref: String(x.number), code: `Q${x.number}`, slug: x.slug, title: x.title, difficulty: x.difficulty, topic: x.topicLabel })),
    ...(data.exercises ?? []).map((e) => ({ kind: "python" as const, ref: e.slug, code: e.code, slug: e.slug, title: e.title, difficulty: e.difficulty, topic: e.category })),
  ].map((r) => {
    const s = stats.get(`${r.kind}:${r.ref}`);
    return { ...r, override: overrides.get(overrideKey(r.kind, r.ref)), submits: s?.submits ?? 0, fails: s ? s.submits - s.passed : 0 };
  }), [data.index, data.exercises, overrides, stats]);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!kind || r.kind === kind) && (!needle || `${r.code} ${r.title} ${r.topic}`.toLowerCase().includes(needle))
    && (!status || (status === "disabled" ? r.override?.disabled : status === "edited" ? r.override && !r.override.disabled : r.submits >= 3 && (pct(r.fails, r.submits) ?? 0) >= 70)));

  /** Every reference solution against the real engines, plus missing fields and duplicate titles. */
  async function qualityCheck() {
    const items = rows;
    const results: Check[] = [];
    setChecks({ running: true, done: 0, total: items.length, results });
    const titles = new Map<string, string>();
    for (const [i, r] of items.entries()) {
      try {
        const t = norm(r.title);
        if (titles.has(t)) results.push({ ref: r.code, kind: r.kind, ok: false, problem: `Same title as ${titles.get(t)}` });
        titles.set(t, r.code);
        if (r.kind === "sql") {
          const full = await loadQuestion(r.slug);
          const missing = (["problem", "objective", "referenceQuery", "solution"] as const).filter((k) => !String(full[k] ?? "").trim());
          if (missing.length) results.push({ ref: r.code, kind: "sql", ok: false, problem: `Missing ${missing.join(", ")}` });
          const res = await runQuery(full.referenceQuery);
          if (!res.success) results.push({ ref: r.code, kind: "sql", ok: false, problem: `Reference query fails: ${res.message ?? ""}`.slice(0, 160) });
          else if (!res.rows.length) results.push({ ref: r.code, kind: "sql", ok: false, problem: "Reference query returns no rows (check the expected output)" });
        } else {
          const e = await loadExercise(r.slug);
          if (!e?.task) { results.push({ ref: r.code, kind: "python", ok: false, problem: "No task block" }); continue; }
          if (!e.task.hidden?.trim()) results.push({ ref: r.code, kind: "python", ok: false, problem: "No hidden tests" });
          const res = await runPythonTask(e.task, e.task.solution, (c, t) => runPython(c, t));
          if (!res.ok) results.push({ ref: r.code, kind: "python", ok: false, problem: `Reference solution fails: ${res.message}`.slice(0, 160) });
          const starter = await runPythonTask(e.task, e.task.starter, (c, t) => runPython(c, t));
          if (starter.ok) results.push({ ref: r.code, kind: "python", ok: false, problem: "The starter passes the tests (tests too weak)" });
        }
      } catch (x) {
        results.push({ ref: r.code, kind: r.kind, ok: false, problem: `Check crashed: ${(x as Error).message}`.slice(0, 160) });
      }
      setChecks({ running: true, done: i + 1, total: items.length, results: [...results] });
    }
    setChecks({ running: false, done: items.length, total: items.length, results: [...results] });
  }

  return (
    <section aria-labelledby="content" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="content" className="font-display text-xl font-bold text-ink">Content</h2>
          <p className="text-xs text-ink-muted">Disable or adjust built-in questions without a rebuild, add SQL questions, and check that every reference solution still passes. Every change is versioned and audited.</p>
        </div>
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditingCustom({ difficulty: "Easy", topic: "Aggregations", published: false, hints: [], concepts: [], sort_required: false })}><Plus className="h-4 w-4" aria-hidden /> New SQL question</Button>
          <Button size="sm" onClick={() => void qualityCheck()} disabled={checks?.running}>{checks?.running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />} Run quality check</Button>
        </span>
      </div>
      {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-dim px-3 py-2 text-sm text-danger">{err}</p>}

      {checks && (
        <Card pad="sm" as="section" aria-label="Quality check">
          <p className="text-sm text-ink">{checks.running ? `Checking ${checks.done} of ${checks.total}…` : `Checked ${checks.total} questions: ${checks.results.length ? `${checks.results.length} issue${checks.results.length === 1 ? "" : "s"}` : "no issues"}.`}</p>
          {checks.results.length > 0 && <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs">{checks.results.map((c, i) => <li key={i} className="flex gap-2"><XCircle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden /><span className="font-mono text-ink">{c.ref}</span><span className="text-ink-muted">{c.problem}</span></li>)}</ul>}
          {!checks.running && !checks.results.length && <p className="mt-1 flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Every reference solution runs and passes its tests.</p>}
        </Card>
      )}

      {editingCustom && <CustomEditor value={editingCustom} onClose={() => setEditingCustom(null)} onSaved={() => { setEditingCustom(null); void refresh(); }} />}
      {editing && <OverrideEditor row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />}

      {custom.length > 0 && (
        <Card pad="sm" as="section" aria-label="Admin questions">
          <h3 className="text-sm font-semibold text-ink">Admin SQL questions ({custom.length})</h3>
          <ul className="mt-2 divide-y divide-surface-border text-sm">
            {custom.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-ink">{c.title}</span>
                <span className={`text-xs ${c.published ? "text-success" : "text-ink-faint"}`}>{c.published ? "published" : "draft"} · v{c.version}</span>
                <Difficulty level={c.difficulty} />
                <Button size="sm" variant="ghost" onClick={() => setEditingCustom(c)} aria-label={`Edit ${c.title}`}><Pencil className="h-3.5 w-3.5" aria-hidden /></Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search questions</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID, title or topic" className={`${INPUT} w-full pl-8`} />
        </label>
        <select aria-label="Language" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={INPUT}><option value="">SQL and Python</option><option value="sql">SQL</option><option value="python">Python</option></select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={INPUT}><option value="">Any status</option><option value="disabled">Disabled</option><option value="edited">Edited</option><option value="failing">70%+ failure rate</option></select>
      </div>
      <div className="max-h-[480px] overflow-auto rounded-card border border-surface-border">
        <table className="w-full min-w-[720px]">
          <thead className="sticky top-0 bg-surface-raised"><tr><th className={th}>ID</th><th className={th}>Title</th><th className={th}>Level</th><th className={th} title="Checks in the last 90 days">Checks</th><th className={th}>Fail rate</th><th className={th}>Status</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-surface-border">
            {shown.slice(0, 400).map((r) => {
              const fr = pct(r.fails, r.submits);
              return (
                <tr key={`${r.kind}:${r.ref}`}>
                  <td className={`${td} font-mono text-xs`}>{r.code}</td>
                  <td className={td}>{r.override?.title || r.title}{r.override?.title && <span className="ml-1 text-xs text-ink-faint">(was {r.title})</span>}</td>
                  <td className={td}><Difficulty level={r.override?.difficulty || r.difficulty} /></td>
                  <td className={`${td} tabular-nums`}>{r.submits}</td>
                  <td className={`${td} tabular-nums ${fr !== null && fr >= 70 && r.submits >= 3 ? "text-danger" : ""}`}>{fr === null ? "—" : `${fr}%`}</td>
                  <td className={`${td} text-xs`}>{r.override?.disabled ? <span className="text-danger">disabled</span> : r.override ? <span className="text-accent">edited v{r.override.version}</span> : <span className="text-ink-faint">built-in</span>}</td>
                  <td className={td}><Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.code}`}><Pencil className="h-3.5 w-3.5" aria-hidden /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-faint">{shown.length} of {rows.length} questions. Fail rate counts failed checks out of all checks in the last 90 days.</p>
    </section>
  );
}

function OverrideEditor({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const o = row.override;
  const [disabled, setDisabled] = useState(o?.disabled ?? false);
  const [title, setTitle] = useState(o?.title ?? "");
  const [difficulty, setDifficulty] = useState(o?.difficulty ?? "");
  const [note, setNote] = useState(o?.note ?? "");
  const [reference, setReference] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ version: number; data: Record<string, unknown>; changed_at: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void (row.kind === "sql" ? loadQuestion(row.slug).then((x) => x.solution || x.referenceQuery) : loadExercise(row.slug).then((x) => x?.task?.solution ?? "")).then(setReference).catch(() => setReference(""));
    void getSupabase().then((sb) => sb.from("question_versions").select("version, data, changed_at").eq("kind", "override").eq("ref", `${row.kind}:${row.ref}`).order("version", { ascending: false }).limit(20))
      .then(({ data }) => setVersions((data ?? []) as typeof versions));
  }, [row]);
  async function save() {
    const sb = await getSupabase();
    const { error } = await sb.from("question_overrides").upsert({ kind: row.kind, ref: row.ref, disabled, title: title.trim() || null, difficulty: difficulty || null, note: note.trim() || null });
    if (error) return setErr(error.message);
    onSaved();
  }
  async function clear() {
    if (!confirm("Remove this override and restore the built-in question?")) return;
    const sb = await getSupabase();
    const { error } = await sb.from("question_overrides").delete().eq("kind", row.kind).eq("ref", row.ref);
    if (error) return setErr(error.message);
    onSaved();
  }
  return (
    <Card pad="md" as="section" aria-label={`Edit ${row.code}`}>
      <div className="flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-ink">{row.code} · {row.title}</h3><button type="button" className="text-xs text-ink-muted hover:text-ink" onClick={onClose}>Close</button></div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} /> Disabled (hidden from lists; the page shows a notice)</label>
          <label className="block text-ink-muted">Title override<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={row.title} className={`${INPUT} mt-1 w-full`} /></label>
          <label className="block text-ink-muted">Difficulty override<select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={`${INPUT} mt-1 w-full`}><option value="">Keep {row.difficulty}</option>{["Easy", "Medium", "Hard"].map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="block text-ink-muted">Admin note (why)<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} className={`${INPUT} mt-1 w-full`} /></label>
          {err && <p role="alert" className="text-danger">{err}</p>}
          <div className="flex gap-2"><Button size="sm" onClick={() => void save()}>Save</Button>{o && <Button size="sm" variant="ghost" onClick={() => void clear()}>Restore built-in</Button>}</div>
        </div>
        <div className="min-w-0 space-y-2 text-xs">
          <p className="font-semibold uppercase tracking-wider text-ink-faint">Reference solution</p>
          <pre className="max-h-56 overflow-auto rounded-lg bg-surface-overlay p-2 font-mono text-ink">{reference ?? "Loading…"}</pre>
          <p className="font-semibold uppercase tracking-wider text-ink-faint">Versions</p>
          {versions.length ? <ul className="space-y-0.5">{versions.map((v) => <li key={v.version} className="text-ink-muted">v{v.version} · {new Date(v.changed_at).toLocaleString()} · {v.data.disabled ? "disabled" : "enabled"}{v.data.title ? ` · "${String(v.data.title)}"` : ""}{v.data.difficulty ? ` · ${String(v.data.difficulty)}` : ""}</li>)}</ul> : <p className="text-ink-muted">No changes yet.</p>}
        </div>
      </div>
    </Card>
  );
}

function CustomEditor({ value, onClose, onSaved }: { value: Partial<CustomQuestion>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<CustomQuestion>>(value);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof CustomQuestion>(k: K, x: CustomQuestion[K]) => { setV((p) => ({ ...p, [k]: x })); setCheck(null); };
  async function validate() {
    const res = await runQuery(v.reference_query ?? "");
    const ok = res.success && res.rows.length > 0;
    setCheck({ ok, text: res.success ? `${res.rows.length} row${res.rows.length === 1 ? "" : "s"}, columns: ${res.columns.join(", ")}${res.rows.length ? "" : " (no rows: learners can't be graded meaningfully)"}` : res.message ?? "Query failed." });
    return ok;
  }
  async function save() {
    setErr(null);
    if (v.published && !(await validate())) return setErr("The reference query must run and return rows before the question can be published.");
    const sb = await getSupabase();
    const row = { slug: v.slug, title: v.title, difficulty: v.difficulty, topic: v.topic, concepts: v.concepts ?? [], scenario: v.scenario ?? "", problem: v.problem, objective: v.objective,
      expected_output: v.expected_output ?? "", hints: v.hints ?? [], explanation: v.explanation ?? "", reference_query: v.reference_query, sort_required: !!v.sort_required, published: !!v.published };
    const { error } = v.id ? await sb.from("custom_questions").update(row).eq("id", v.id) : await sb.from("custom_questions").insert(row);
    if (error) return setErr(error.message);
    onSaved();
  }
  const field = (k: keyof CustomQuestion, label: string, rows = 0) => (
    <label className="block text-xs text-ink-muted">{label}
      {rows ? <textarea value={String(v[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} rows={rows} className={`${INPUT} mt-1 w-full font-${k === "reference_query" ? "mono" : "sans"}`} />
        : <input value={String(v[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} className={`${INPUT} mt-1 w-full`} />}
    </label>
  );
  return (
    <Card pad="md" as="section" aria-label="Edit SQL question">
      <div className="flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-ink">{v.id ? `Edit ${v.title}` : "New SQL question"}</h3><button type="button" className="text-xs text-ink-muted hover:text-ink" onClick={onClose}>Close</button></div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          {field("title", "Title")}
          {field("slug", "URL slug (lowercase letters, digits, hyphens)")}
          <div className="flex gap-2">
            <label className="block flex-1 text-xs text-ink-muted">Difficulty<select value={v.difficulty} onChange={(e) => set("difficulty", e.target.value)} className={`${INPUT} mt-1 w-full`}>{["Easy", "Medium", "Hard"].map((d) => <option key={d}>{d}</option>)}</select></label>
            <div className="flex-1">{field("topic", "Topic")}</div>
          </div>
          <label className="block text-xs text-ink-muted">Concepts (comma separated)<input value={(v.concepts ?? []).join(", ")} onChange={(e) => set("concepts", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} className={`${INPUT} mt-1 w-full`} /></label>
          {field("scenario", "Business scenario", 2)}
          {field("problem", "Problem statement (Markdown)", 4)}
          {field("objective", "Objective", 2)}
        </div>
        <div className="space-y-2">
          {field("reference_query", "Reference query (graded on Northwind; never shown to learners before they solve)", 8)}
          <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={!!v.sort_required} onChange={(e) => set("sort_required", e.target.checked)} /> Row order matters (grade ORDER BY)</label>
          {field("expected_output", "Expected output description (Markdown)", 3)}
          <label className="block text-xs text-ink-muted">Hints (one per line)<textarea value={(v.hints ?? []).join("\n")} onChange={(e) => set("hints", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} rows={3} className={`${INPUT} mt-1 w-full`} /></label>
          {field("explanation", "Explanation (shown after solving)", 3)}
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!v.published} onChange={(e) => set("published", e.target.checked)} /> Published (visible to learners)</label>
          {check && <p className={`text-xs ${check.ok ? "text-success" : "text-danger"}`}>{check.ok ? "Reference query OK: " : "Reference query problem: "}{check.text}</p>}
          {err && <p role="alert" className="text-xs text-danger">{err}</p>}
          <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => void validate()}>Validate query</Button><Button size="sm" onClick={() => void save()}>Save</Button></div>
        </div>
      </div>
    </Card>
  );
}
