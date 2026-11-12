import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Database, Download, History, RotateCcw, Save, Star, Table2, Trash2 } from "lucide-react";
import { usePage } from "../SiteApp";
import { SchemaPanel } from "../components/SchemaPanel";
import { SampleTable } from "../components/SampleTable";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { erDiagramSource } from "../lib/data";
import { resetDb, runQuery } from "../lib/browserDb";
import {
  NORTHWIND_INFO, addHistory, clearHistory, deleteSaved, describeDataset, download, getHistory, getSaved,
  loadBuiltinDatasets, loadCustomDatasets, registerAll, saveQuery, tableCounts, toCsv, type DatasetInfo, type SavedQuery,
} from "../lib/datasets";
import type { ExecuteResult } from "../../types";
import { receive } from "../lib/handoff";
import { HelpTooltip } from "../help/HelpTooltip";
import { useHelpExample } from "../help/exampleBridge";
import type { Question, SchemaTable } from "../types";

const PracticePanel = lazy(() => import("../components/PracticePanel"));
const ErDiagram = lazy(() => import("../../components/ErDiagram").then((m) => ({ default: m.ErDiagram })));

/** Stand-in "question" so the practice panel can run free-form SQL. */
const PLAYGROUND: Question = {
  number: 0, slug: "playground", title: "Playground", topic: "", topicLabel: "", difficulty: "", concepts: [],
  hadMistakes: false, watchOutFor: "", takeaway: "", category: "", outcome: "", problem: "", objective: "",
  tables: [], expectedOutput: "", approach: "", mySolution: "", myMistakes: [], solution: "", referenceQuery: "",
  sortRequired: false, why: "", pitfalls: [], followups: [], related: [],
};

const NORTHWIND_EXAMPLES: { label: string; sql: string }[] = [
  { label: "Top customers by revenue", sql: "SELECT c.company_name,\n       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue\nFROM customers c\nJOIN orders o ON o.customer_id = c.customer_id\nJOIN order_details od ON od.order_id = o.order_id\nGROUP BY c.company_name\nORDER BY revenue DESC\nLIMIT 10;" },
  { label: "Monthly orders", sql: "SELECT DATE_TRUNC('month', order_date)::date AS month, COUNT(*) AS orders\nFROM orders\nGROUP BY month\nORDER BY month;" },
  { label: "Rank products in category", sql: "SELECT c.category_name, p.product_name, p.unit_price,\n       DENSE_RANK() OVER (PARTITION BY c.category_id ORDER BY p.unit_price DESC) AS price_rank\nFROM products p\nJOIN categories c ON c.category_id = p.category_id\nORDER BY c.category_name, price_rank;" },
  { label: "Org chart", sql: "SELECT e.first_name || ' ' || e.last_name AS employee,\n       m.first_name || ' ' || m.last_name AS manager\nFROM employees e\nLEFT JOIN employees m ON m.employee_id = e.reports_to\nORDER BY manager NULLS FIRST, employee;" },
];

const starterFor = (d: DatasetInfo, schema: SchemaTable[]) =>
  d.id === "northwind"
    ? "-- Query any Northwind table. Ctrl/⌘+Enter runs everything.\n\nSELECT *\nFROM customers\nLIMIT 10;\n"
    : `-- ${d.title}: ${d.description}\n-- Tables: ${(schema.length ? schema.map((t) => t.name) : d.tables).join(", ")}\n\nSELECT *\nFROM ${schema[0]?.name ?? d.tables[0] ?? "information_schema.tables"}\nLIMIT 10;\n`;

export function PlaygroundPage() {
  const { data } = usePage();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([NORTHWIND_INFO]);
  const [id, setId] = useState("northwind");
  const [schema, setSchema] = useState<SchemaTable[]>(data.schema ?? []);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [seed, setSeed] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<{ table: string; res: ExecuteResult } | null>(null);
  const [last, setLast] = useState<{ sql: string; res: ExecuteResult } | null>(null);
  const [history, setHistory] = useState<ReturnType<typeof getHistory>>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [side, setSide] = useState<"schema" | "er" | "history" | "saved">("schema");
  const [schemaError, setSchemaError] = useState<string | null>(null);

  const ds = datasets.find((d) => d.id === id) ?? NORTHWIND_INFO;

  useEffect(() => {
    setMounted(true);
    const customs = loadCustomDatasets();
    loadBuiltinDatasets().then((builtins) => {
      registerAll(builtins, customs);
      setDatasets([...builtins, ...customs]);
    });
  }, []);

  // ?db= selects a dataset (read after hydration; the prerendered page has no query string).
  useEffect(() => {
    const want = new URLSearchParams(search).get("db");
    if (want && datasets.some((d) => d.id === want)) setId(want);
  }, [search, datasets]);

  // Only the latest selection may write state: a slower lookup for a previous dataset is dropped.
  const current = useRef(id);
  current.current = id;
  const refreshSchema = useCallback(async () => {
    const want = id;
    setSchemaError(null);
    try {
      const s = await describeDataset(want);
      const c = await tableCounts(want, s.map((t) => t.name));
      if (current.current !== want) return null;
      setSchema(s);
      setCounts(c);
      return s;
    } catch (e) {
      if (current.current === want) setSchemaError((e as Error).message);
      return current.current === want ? [] : null;
    }
  }, [id]);

  useEffect(() => {
    if (!mounted) return;
    setPreview(null);
    setLast(null);
    setHistory(getHistory(id));
    setSaved(getSaved(id));
    setSchema(id === "northwind" ? data.schema ?? [] : []);
    const handed = receive("playground");
    void refreshSchema().then((s) => {
      if (s === null) return;
      setSeed(handed?.a ?? starterFor(ds, s));
      setVersion((v) => v + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mounted]);

  const load = (sql: string) => {
    setSeed(sql);
    setVersion((v) => v + 1);
  };

  const onRan = useCallback((sql: string, res: ExecuteResult) => {
    setLast({ sql, res });
    addHistory(id, { sql, ok: res.success, rows: res.row_count ?? undefined });
    setHistory(getHistory(id));
  }, [id]);

  async function previewTable(t: string) {
    setPreview({ table: t, res: await runQuery(`SELECT * FROM "${t.replace(/"/g, '""')}" LIMIT 20`, id) });
  }

  function reset() {
    if (!confirm(`Reset the ${ds.title} database to its original data? This only affects this browser tab.`)) return;
    resetDb(id);
    setPreview(null);
    void refreshSchema();
  }

  // Try Example from Help. The editor's text lives inside PracticePanel, so we cannot tell if it was touched: always ask first.
  useHelpExample("sql", "the SQL playground editor", { isDirty: () => true, load: (e) => load(e.code), ready: mounted && seed !== null });

  const question = { ...PLAYGROUND, starter: seed ?? undefined } as Question;
  const tab = (t: typeof side, label: string, Icon: typeof Table2) => (
    <button type="button" role="tab" aria-selected={side === t} onClick={() => setSide(t)}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${side === t ? "bg-accent-dim text-accent" : "text-ink-muted hover:text-ink"}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
    </button>
  );

  return (
    <Container wide>
      <Seo
        title="Online PostgreSQL Playground — Northwind, HR, Sales, E-commerce, Banking"
        description="Run SQL in your browser on several practice databases: Northwind, HR, sales, e-commerce, banking and inventory. Schema explorer, ER diagrams, saved queries, CSV export."
        path="/playground"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Playground", path: "/playground" }])]}
      />
      <PageHeader
        eyebrow="Playground"
        title="SQL playground"
        intro="Pick a database and query it freely. Each database runs in its own isolated instance in your browser, and every query is rolled back, so nothing you run changes the data."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label data-help="playground-database" className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-accent" aria-hidden />
          <span className="sr-only">Database</span>
          <select value={id} onChange={(e) => navigate(`/playground?db=${e.target.value}`)} className="rounded-lg border border-surface-border bg-surface px-2 py-1.5 font-medium text-ink">
            <optgroup label="Practice databases">
              {datasets.filter((d) => d.kind === "builtin").map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </optgroup>
            {datasets.some((d) => d.kind === "custom") && (
              <optgroup label="Your datasets (this browser)">
                {datasets.filter((d) => d.kind === "custom").map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <HelpTooltip id="practice-databases" label="What are the practice databases?" />
        <span className="text-sm text-ink-muted">{ds.description}</span>
        <span className="ml-auto flex gap-2">
          <Link to="/data-generator" className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink">Create a dataset</Link>
          <button type="button" data-help="playground-reset" onClick={reset} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset database
          </button>
          <HelpTooltip id="reset-database" label="What does Reset database do?" />
        </span>
      </div>
      {ds.edgeCases?.length ? (
        <details className="mb-4 text-sm">
          <summary className="cursor-pointer text-ink-muted">Data quirks worth finding in {ds.title} ({ds.edgeCases.length})</summary>
          <ul className="mt-1 list-disc pl-5 text-ink-muted">{ds.edgeCases.map((e) => <li key={e}>{e}</li>)}</ul>
        </details>
      ) : null}
      {id === "northwind" && (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Example queries">
          {NORTHWIND_EXAMPLES.map((ex) => (
            <button key={ex.label} type="button" onClick={() => load(ex.sql)}
              className="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 text-sm text-ink-muted hover:border-accent/40 hover:text-ink">
              {ex.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside data-help="playground-side" className="order-2 min-w-0 space-y-3 lg:order-1">
          <div role="tablist" className="flex flex-wrap gap-1">
            {tab("schema", "Schema", Table2)}
            {tab("er", "ER diagram", Database)}
            {tab("history", `History (${history.length})`, History)}
            {tab("saved", `Saved (${saved.length})`, Star)}
          </div>
          {schemaError && <p role="alert" className="text-sm text-danger">Couldn't load this database: {schemaError}</p>}
          {side === "schema" && (
            <>
              <ul className="space-y-1 text-sm">
                {schema.map((t) => (
                  <li key={t.name} className="flex items-center justify-between gap-2">
                    <code className="truncate text-ink">{t.name}</code>
                    <span className="flex items-center gap-2 text-xs text-ink-faint">
                      {counts[t.name] !== undefined && `${counts[t.name]} rows`}
                      <button type="button" onClick={() => previewTable(t.name)} className="text-accent hover:underline">Preview</button>
                    </span>
                  </li>
                ))}
              </ul>
              {schema.length > 0 && <SchemaPanel schema={schema} />}
            </>
          )}
          {side === "er" && (
            mounted && schema.length ? (
              <div className="overflow-x-auto rounded-card border border-surface-border bg-surface-raised p-2">
                <Suspense fallback={<Skeleton className="h-64" />}><ErDiagram source={erDiagramSource(schema)} /></Suspense>
              </div>
            ) : <Skeleton className="h-64" />
          )}
          {side === "history" && (
            <div className="space-y-2 text-sm">
              {!history.length && <p className="text-ink-muted">Queries you run on {ds.title} appear here.</p>}
              {history.map((h) => (
                <button key={h.at} type="button" onClick={() => load(h.sql)} className="block w-full rounded-lg border border-surface-border p-2 text-left hover:border-accent/40">
                  <span className={`text-[11px] ${h.ok ? "text-success" : "text-danger"}`}>{h.ok ? `${h.rows ?? 0} rows` : "error"} · {new Date(h.at).toLocaleTimeString()}</span>
                  <code className="mt-0.5 block truncate text-xs text-ink">{h.sql.replace(/\s+/g, " ")}</code>
                </button>
              ))}
              {history.length > 0 && <button type="button" onClick={() => { clearHistory(id); setHistory([]); }} className="text-xs text-ink-faint underline">Clear history</button>}
            </div>
          )}
          {side === "saved" && (
            <div className="space-y-2 text-sm">
              {!saved.length && <p className="text-ink-muted">Save a query from the bar under the editor.</p>}
              {saved.map((q) => (
                <div key={q.id} className="flex items-start gap-2 rounded-lg border border-surface-border p-2">
                  <button type="button" onClick={() => load(q.sql)} className="min-w-0 flex-1 text-left">
                    <span className="block font-medium text-ink">{q.name}</span>
                    <code className="block truncate text-xs text-ink-muted">{q.sql.replace(/\s+/g, " ")}</code>
                  </button>
                  <button type="button" aria-label={`Delete ${q.name}`} onClick={() => setSaved(deleteSaved(id, q.id))} className="text-ink-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
        </aside>

        <div data-help="playground-editor" className="order-1 min-w-0 space-y-3 lg:order-2">
          {mounted && seed !== null ? (
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel key={`${id}-${version}`} question={question} playground fresh dataset={id} datasetLabel={ds.title} onRan={onRan} />
            </Suspense>
          ) : (
            <Skeleton className="h-[580px]" />
          )}
          <div data-help="playground-actions" className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" disabled={!last} onClick={() => { const name = prompt("Name this query"); if (name !== null && last) setSaved(saveQuery(id, name, last.sql)); }}
              className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-ink-muted hover:text-ink disabled:opacity-50">
              <Save className="h-3.5 w-3.5" aria-hidden /> Save last query
            </button>
            <button type="button" disabled={!last?.res.success} onClick={() => last && download(`${id}-result.csv`, toCsv(last.res.columns, last.res.rows), "text/csv")}
              className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-ink-muted hover:text-ink disabled:opacity-50">
              <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
            </button>
            <button type="button" disabled={!last?.res.success} onClick={() => last && download(`${id}-result.json`, JSON.stringify(last.res.rows.map((r) => Object.fromEntries(last.res.columns.map((c, i) => [c, r[i]]))), null, 2), "application/json")}
              className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-ink-muted hover:text-ink disabled:opacity-50">
              <Download className="h-3.5 w-3.5" aria-hidden /> Export JSON
            </button>
            {last?.res.truncated && <span className="text-xs text-ink-faint">Export includes the first {last.res.rows.length} rows (display limit).</span>}
          </div>
          {preview && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Preview: {preview.table} (first 20 rows)</p>
              {preview.res.success ? <SampleTable columns={preview.res.columns} rows={preview.res.rows} /> : <p className="text-sm text-danger">{preview.res.message}</p>}
            </div>
          )}
        </div>
      </div>
    </Container>
  );
}
