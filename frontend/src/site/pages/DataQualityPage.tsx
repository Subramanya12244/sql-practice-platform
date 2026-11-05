import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Download, Loader2, Play, Plus, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { Container, EmptyState, PageHeader } from "../components/ui";
import { SampleTable } from "../components/SampleTable";
import { Seo, breadcrumbs } from "../lib/seo";
import { runQuery } from "../lib/browserDb";
import { NORTHWIND_INFO, describeDataset, download, loadBuiltinDatasets, loadCustomDatasets, registerAll, toCsv, type DatasetInfo } from "../lib/datasets";
import {
  RULE_LABELS, compareRuns, getRules, getRuns, qualityScore, runRule, saveRules, saveRun, suggestRules, validateRule,
  type QualityRun, type Rule, type RuleResult, type RuleType,
} from "../lib/dataQuality";
import type { SchemaTable } from "../types";

const sel = "max-w-full rounded border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink";
const NEEDS_REF: RuleType[] = ["foreign_key", "missing_records", "reconciliation", "row_count"];
const MULTI: RuleType[] = ["unique", "primary_key"];

function RuleForm({ schema, onAdd }: { schema: SchemaTable[]; onAdd: (r: Rule) => void }) {
  const [type, setType] = useState<RuleType>("not_null");
  const [table, setTable] = useState(schema[0]?.name ?? "");
  const [columns, setColumns] = useState<string[]>([]);
  const [refTable, setRefTable] = useState("");
  const [refColumn, setRefColumn] = useState("");
  const [extra, setExtra] = useState<Partial<Rule>>({});
  const [err, setErr] = useState<string[]>([]);
  const cols = schema.find((t) => t.name === table)?.columns ?? [];
  const refCols = schema.find((t) => t.name === refTable)?.columns ?? [];
  useEffect(() => setColumns([]), [table]);

  function add() {
    const rule: Rule = {
      id: crypto.randomUUID(),
      name: `${table}${columns.length ? "." + columns.join(",") : ""}: ${RULE_LABELS[type].toLowerCase()}`,
      type, table, columns, refTable: refTable || undefined, refColumn: refColumn || undefined, ...extra,
    };
    const e = validateRule(rule, schema);
    setErr(e);
    if (!e.length) onAdd(rule);
  }

  return (
    <div className="space-y-3 rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
      <p className="font-semibold text-ink">Add a rule</p>
      <div className="flex flex-wrap items-end gap-2">
        <label><span className="block text-xs text-ink-faint">Rule</span>
          <select className={sel} value={type} onChange={(e) => { setType(e.target.value as RuleType); setExtra({}); }}>
            {(Object.keys(RULE_LABELS) as RuleType[]).map((t) => <option key={t} value={t}>{RULE_LABELS[t]}</option>)}
          </select>
        </label>
        <label><span className="block text-xs text-ink-faint">Table</span>
          <select className={sel} value={table} onChange={(e) => setTable(e.target.value)}>{schema.map((t) => <option key={t.name}>{t.name}</option>)}</select>
        </label>
        {!["schema", "row_count", "business_rule"].includes(type) && (
          <label><span className="block text-xs text-ink-faint">{MULTI.includes(type) ? "Column(s) — Ctrl/⌘-click for several" : type === "reconciliation" ? "Key column" : "Column"}</span>
            <select className={sel} multiple={MULTI.includes(type)} size={MULTI.includes(type) ? Math.min(5, cols.length) : undefined}
              value={MULTI.includes(type) ? columns : columns[0] ?? ""}
              onChange={(e) => setColumns(MULTI.includes(type) ? [...e.target.selectedOptions].map((o) => o.value) : [e.target.value])}>
              {!MULTI.includes(type) && <option value="">choose…</option>}
              {cols.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
            </select>
          </label>
        )}
        {NEEDS_REF.includes(type) && (
          <>
            <label><span className="block text-xs text-ink-faint">{type === "foreign_key" ? "References table" : "Target table"}</span>
              <select className={sel} value={refTable} onChange={(e) => setRefTable(e.target.value)}><option value="">choose…</option>{schema.map((t) => <option key={t.name}>{t.name}</option>)}</select>
            </label>
            {type !== "row_count" && (
              <label><span className="block text-xs text-ink-faint">Target column</span>
                <select className={sel} value={refColumn} onChange={(e) => setRefColumn(e.target.value)}><option value="">same name</option>{refCols.map((c) => <option key={c.name}>{c.name}</option>)}</select>
              </label>
            )}
          </>
        )}
        {type === "data_type" && (
          <label><span className="block text-xs text-ink-faint">Expected type</span>
            <select className={sel} value={extra.expected ?? ""} onChange={(e) => setExtra({ expected: e.target.value })}><option value="">choose…</option>{["integer", "numeric", "date", "email", "boolean"].map((x) => <option key={x}>{x}</option>)}</select>
          </label>
        )}
        {type === "date_range" && (
          <>
            <label><span className="block text-xs text-ink-faint">Not before</span><input type="date" className={sel} onChange={(e) => setExtra({ ...extra, min: e.target.value })} /></label>
            <label><span className="block text-xs text-ink-faint">Not after</span><input type="date" className={sel} onChange={(e) => setExtra({ ...extra, max: e.target.value })} /></label>
          </>
        )}
        {type === "outlier" && <label><span className="block text-xs text-ink-faint">|z-score| above</span><input type="number" step="0.5" min={1} className={`${sel} w-20`} defaultValue={3} onChange={(e) => setExtra({ threshold: Number(e.target.value) })} /></label>}
        {type === "row_count" && <label><span className="block text-xs text-ink-faint">Allowed difference</span><input type="number" min={0} className={`${sel} w-24`} defaultValue={0} onChange={(e) => setExtra({ tolerance: Number(e.target.value) })} /></label>}
        {type === "reconciliation" && <label><span className="block text-xs text-ink-faint">Compare columns (comma-separated)</span><input className={sel} onChange={(e) => setExtra({ compare: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></label>}
        {type === "schema" && <label className="min-w-[240px] flex-1"><span className="block text-xs text-ink-faint">Expected columns (comma-separated)</span><input className={`${sel} w-full`} defaultValue={cols.map((c) => c.name).join(", ")} onChange={(e) => setExtra({ expectedColumns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></label>}
        {type === "business_rule" && <label className="min-w-[240px] flex-1"><span className="block text-xs text-ink-faint">Every row must satisfy (SQL expression)</span><input className={`${sel} w-full font-mono`} placeholder="amount >= 0 AND status <> 'unknown'" onChange={(e) => setExtra({ condition: e.target.value })} /></label>}
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 font-semibold text-white"><Plus className="h-4 w-4" aria-hidden /> Add rule</button>
      </div>
      {err.length > 0 && <ul role="alert" className="list-disc pl-5 text-danger">{err.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
  );
}

export function DataQualityPage() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<DatasetInfo[]>([NORTHWIND_INFO]);
  const [id, setId] = useState("northwind");
  const [schema, setSchema] = useState<SchemaTable[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [results, setResults] = useState<RuleResult[] | null>(null);
  const [runs, setRuns] = useState<QualityRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [cmp, setCmp] = useState<[string, string] | null>(null);
  const ds = datasets.find((d) => d.id === id) ?? NORTHWIND_INFO;

  useEffect(() => {
    const customs = loadCustomDatasets();
    loadBuiltinDatasets().then((b) => {
      registerAll(b, customs);
      setDatasets([...b, ...customs]);
    });
  }, []);
  useEffect(() => {
    const want = new URLSearchParams(search).get("db");
    if (want && datasets.some((d) => d.id === want)) setId(want);
  }, [search, datasets]);
  useEffect(() => {
    let alive = true;
    setResults(null);
    setSchema([]);
    describeDataset(id).then((s) => {
      if (!alive) return;
      setSchema(s);
      setRules(getRules(id) ?? suggestRules(s));
      setRuns(getRuns(id));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, datasets]);

  const persist = (next: Rule[]) => {
    setRules(next);
    saveRules(id, next);
  };

  async function runAll() {
    setBusy(true);
    const out: RuleResult[] = [];
    for (const r of rules) out.push(await runRule(r, schema, (sql) => runQuery(sql, id)));
    const run: QualityRun = { id: crypto.randomUUID(), at: new Date().toISOString(), dataset: id, results: out, score: qualityScore(out) };
    setResults(out);
    saveRun(id, run);
    setRuns(getRuns(id));
    setBusy(false);
  }

  const totals = useMemo(() => {
    if (!results) return null;
    const rowRules = results.filter((r) => r.status !== "error" && !["schema", "row_count"].includes(r.type));
    return {
      score: qualityScore(results),
      checked: rowRules.reduce((s, r) => s + r.checked, 0),
      failed: rowRules.reduce((s, r) => s + r.failed, 0),
      nulls: results.filter((r) => r.type === "not_null").reduce((s, r) => s + r.failed, 0),
      dupes: results.filter((r) => r.type === "unique" || r.type === "primary_key").reduce((s, r) => s + r.failed, 0),
      invalid: results.filter((r) => ["data_type", "date_range", "business_rule", "foreign_key", "outlier"].includes(r.type)).reduce((s, r) => s + r.failed, 0),
      passedRules: results.filter((r) => r.status === "pass").length,
      failedRules: results.filter((r) => r.status === "fail").length,
      errors: results.filter((r) => r.status === "error").length,
    };
  }, [results]);

  const report = () => results?.map((r) => ({ rule: r.name, type: RULE_LABELS[r.type], table: r.table, status: r.status, checked: r.checked, failed: r.failed, message: r.message }));
  const comparison = cmp ? (() => {
    const a = runs.find((r) => r.id === cmp[0]);
    const b = runs.find((r) => r.id === cmp[1]);
    return a && b ? { a, b, rows: compareRuns(a, b) } : null;
  })() : null;

  return (
    <Container wide>
      <Seo
        title="Data Quality Lab — NULL, Duplicate, Key and Reconciliation Checks in SQL"
        description="Practice data quality engineering: build rules for NULLs, duplicates, keys, types, dates, outliers and reconciliation, run them on real datasets and export reports."
        path="/data-quality"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Data quality lab", path: "/data-quality" }])]}
      />
      <PageHeader
        eyebrow="Data quality"
        title="Data quality lab"
        intro="Pick a dataset, build validation rules, run them, inspect failing records and track the score over time. Every rule is SQL you can read, run on an isolated copy of the data."
      />

      <section aria-labelledby="dq-dataset" className="mb-6 flex flex-wrap items-center gap-3">
        <h2 id="dq-dataset" className="sr-only">Dataset selection</h2>
        <label className="flex items-center gap-2 text-sm">
          Dataset
          <select className={sel} value={id} onChange={(e) => navigate(`/data-quality?db=${e.target.value}`)}>
            <optgroup label="Sample datasets">{datasets.filter((d) => d.kind === "builtin").map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</optgroup>
            {datasets.some((d) => d.kind === "custom") && <optgroup label="Generated datasets">{datasets.filter((d) => d.kind === "custom").map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</optgroup>}
          </select>
        </label>
        <span className="text-sm text-ink-muted">{ds.description}</span>
        <Link to="/data-generator" className="ml-auto rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink">Generate a messy dataset →</Link>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section aria-labelledby="dq-rules" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="dq-rules" className="font-display text-xl font-bold text-ink">Rules ({rules.length})</h2>
            <span className="flex gap-2">
              <button type="button" onClick={() => persist(suggestRules(schema))} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink"><Wand2 className="h-4 w-4" aria-hidden /> Suggest from schema</button>
              <button type="button" onClick={runAll} disabled={busy || !rules.length} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Run all rules
              </button>
            </span>
          </div>
          {schema.length > 0 && <RuleForm schema={schema} onAdd={(r) => persist([...rules, r])} />}
          <ul className="space-y-1 text-sm">
            {rules.map((r) => {
              const res = results?.find((x) => x.ruleId === r.id);
              return (
                <li key={r.id} className="flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!res ? "bg-surface-soft" : res.status === "pass" ? "bg-success" : res.status === "fail" ? "bg-danger" : "bg-warn"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink">{r.name}{r.suggested && <span className="ml-1 text-xs text-ink-faint">(suggested)</span>}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{RULE_LABELS[r.type]}</span>
                  <button type="button" aria-label={`Delete rule ${r.name}`} onClick={() => persist(rules.filter((x) => x.id !== r.id))} className="text-ink-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="dq-results" className="min-w-0 space-y-4">
          <h2 id="dq-results" className="font-display text-xl font-bold text-ink">Validation results</h2>
          {!totals ? (
            <EmptyState icon={ShieldCheck} title="No results yet">Press <strong className="text-ink">Run all rules</strong> to check this dataset. You'll get a quality score, failing records for each rule and downloadable reports.</EmptyState>
          ) : (
            <>
              {totals.passedRules + totals.failedRules > 0 && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-ink-muted"><span>{totals.passedRules} rules pass</span><span>{totals.failedRules} fail</span></div>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-soft" role="img" aria-label={`${totals.passedRules} rules pass, ${totals.failedRules} fail`}>
                    <div className="bg-success" style={{ width: `${(100 * totals.passedRules) / (totals.passedRules + totals.failedRules)}%` }} />
                    <div className="bg-danger" style={{ width: `${(100 * totals.failedRules) / (totals.passedRules + totals.failedRules)}%` }} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["Quality score", totals.score === null ? "—" : `${totals.score}%`], ["Records checked", totals.checked], ["Passed", totals.checked - totals.failed], ["Failed", totals.failed], ["NULLs", totals.nulls], ["Duplicates", totals.dupes], ["Invalid", totals.invalid], ["Rules pass / fail", `${totals.passedRules} / ${totals.failedRules}${totals.errors ? ` (+${totals.errors} error)` : ""}`]].map(([k, v]) => (
                  <div key={String(k)} className="rounded-card border border-surface-border bg-surface-raised p-3">
                    <p className="text-[11px] uppercase tracking-wider text-ink-faint">{k}</p>
                    <p className="font-display text-xl font-bold text-ink">{v}</p>
                  </div>
                ))}
              </div>
              <p className="flex items-start gap-1.5 text-xs text-ink-muted"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Score = the average pass rate across rules: each row-level rule counts (checked − failed) ÷ checked; schema and row-count rules count 1 (pass) or 0 (fail). Rules with errors are left out. "Records checked" adds up per rule, so a row checked by three rules counts three times.</p>
              <div className="flex flex-wrap gap-2 text-sm">
                <button type="button" onClick={() => download(`dq-${id}.csv`, toCsv(["rule", "type", "table", "status", "checked", "failed", "message"], report()!.map((r) => Object.values(r))), "text/csv")} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5"><Download className="h-4 w-4" aria-hidden /> Report CSV</button>
                <button type="button" onClick={() => download(`dq-${id}.json`, JSON.stringify({ dataset: id, at: new Date().toISOString(), score: totals.score, rules: report() }, null, 2), "application/json")} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5"><Download className="h-4 w-4" aria-hidden /> Report JSON</button>
              </div>
              <ul className="space-y-2">
                {results!.map((r) => (
                  <li key={r.ruleId} className="rounded-lg border border-surface-border p-3 text-sm">
                    <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === r.ruleId ? null : r.ruleId)} aria-expanded={open === r.ruleId}>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${r.status === "pass" ? "bg-success-dim text-success" : r.status === "fail" ? "bg-danger-dim text-danger" : "bg-warn-dim text-warn"}`}>{r.status}</span>
                      <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
                      <span className="shrink-0 text-xs text-ink-muted">{r.message}</span>
                    </button>
                    {open === r.ruleId && (
                      <div className="mt-2 space-y-2">
                        {r.sample && r.sample.rows.length > 0 && <SampleTable caption={r.type === "row_count" ? "Counts" : `Failing records (first ${r.sample.rows.length})`} columns={r.sample.columns} rows={r.sample.rows} />}
                        {r.status === "fail" && r.sample && <button type="button" className="text-xs text-accent underline" onClick={() => download(`dq-${r.table}-${r.type}-failed.csv`, toCsv(r.sample!.columns, r.sample!.rows), "text/csv")}>Download failing records (sample)</button>}
                        {r.sql && <pre className="overflow-x-auto rounded bg-surface-soft p-2 font-mono text-xs text-ink-muted">{r.sql}</pre>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {runs.length > 0 && (
            <div className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
              <h3 className="font-semibold text-ink">Validation runs</h3>
              <ul className="mt-2 space-y-1">
                {runs.map((r, i) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-ink">{r.score === null ? "—" : `${r.score}%`}</span>
                    <span className="text-ink-muted">{new Date(r.at).toLocaleString()} · {r.results.length} rules</span>
                    {runs[i + 1] && <button type="button" className="ml-auto text-accent underline" onClick={() => setCmp([runs[i + 1].id, r.id])}>Compare with previous</button>}
                  </li>
                ))}
              </ul>
              {comparison && (
                <table className="mt-3 w-full text-xs">
                  <thead><tr className="text-left text-ink-faint"><th>Rule</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
                  <tbody>
                    {comparison.rows.map((row) => (
                      <tr key={row.ruleId}><td className="py-0.5 pr-2 text-ink">{row.name}</td><td>{row.before ?? "—"}</td><td>{row.after}</td>
                        <td className={row.delta === null ? "" : row.delta < 0 ? "text-success" : row.delta > 0 ? "text-danger" : "text-ink-faint"}>{row.delta === null ? "new" : row.delta > 0 ? `+${row.delta}` : row.delta}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>
      </div>
    </Container>
  );
}
