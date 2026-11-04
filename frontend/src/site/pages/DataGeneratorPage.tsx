import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Play, Plus, Trash2, Wand2 } from "lucide-react";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { SampleTable } from "../components/SampleTable";
import { Seo, breadcrumbs } from "../lib/seo";
import { erDiagramSource } from "../lib/data";
import { DIFFICULTY, MAX_ROWS_PER_TABLE, TEMPLATES, generate, ident, validateSpec, type ColumnKind, type ColumnSpec, type DatasetSpec, type Difficulty, type TableSpec } from "../lib/generator";
import { MAX_CUSTOM_SQL, deleteCustomDataset, download, loadCustomDatasets, saveCustomDataset, toCsv, type CustomDataset } from "../lib/datasets";

const ErDiagram = lazy(() => import("../../components/ErDiagram").then((m) => ({ default: m.ErDiagram })));

const KINDS: { kind: ColumnKind; label: string }[] = [
  { kind: "id", label: "id (primary key)" }, { kind: "fk", label: "foreign key" }, { kind: "int", label: "integer" }, { kind: "decimal", label: "decimal" },
  { kind: "text", label: "text" }, { kind: "first_name", label: "first name" }, { kind: "last_name", label: "last name" }, { kind: "email", label: "email" },
  { kind: "city", label: "city" }, { kind: "country", label: "country" }, { kind: "date", label: "date" }, { kind: "boolean", label: "boolean" }, { kind: "category", label: "category" },
];

const input = "max-w-full rounded border border-surface-border bg-surface px-2 py-1 text-sm text-ink";
const pct = (n?: number) => Math.round((n ?? 0) * 100);

function ColumnRow({ c, tables, onChange, onDelete }: { c: ColumnSpec; tables: string[]; onChange: (c: ColumnSpec) => void; onDelete: () => void }) {
  const num = (k: keyof ColumnSpec, v: string, scale = 1) => onChange({ ...c, [k]: v === "" ? undefined : Number(v) / scale });
  return (
    <tr className="align-top">
      <td className="p-1"><input aria-label="Column name" className={`${input} w-32`} value={c.name} onChange={(e) => onChange({ ...c, name: e.target.value })} /></td>
      <td className="p-1">
        <select aria-label="Column type" className={input} value={c.kind} onChange={(e) => onChange({ ...c, kind: e.target.value as ColumnKind })}>
          {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
      </td>
      <td className="p-1 text-xs text-ink-muted">
        {(c.kind === "int" || c.kind === "decimal") && (
          <span className="flex gap-1">
            <input aria-label="Minimum" type="number" className={`${input} w-20`} value={c.min ?? ""} onChange={(e) => num("min", e.target.value)} placeholder="min" />
            <input aria-label="Maximum" type="number" className={`${input} w-20`} value={c.max ?? ""} onChange={(e) => num("max", e.target.value)} placeholder="max" />
          </span>
        )}
        {c.kind === "date" && (
          <span className="flex gap-1">
            <input aria-label="From date" type="date" className={input} value={c.from ?? "2024-01-01"} onChange={(e) => onChange({ ...c, from: e.target.value })} />
            <input aria-label="To date" type="date" className={input} value={c.to ?? "2025-12-31"} onChange={(e) => onChange({ ...c, to: e.target.value })} />
          </span>
        )}
        {c.kind === "category" && <input aria-label="Category values" className={`${input} w-48`} value={(c.values ?? []).join(", ")} onChange={(e) => onChange({ ...c, values: e.target.value.split(",").map((s) => s.trim()) })} placeholder="a, b, c" />}
        {c.kind === "fk" && (
          <select aria-label="References table" className={input} value={c.ref ?? ""} onChange={(e) => onChange({ ...c, ref: e.target.value })}>
            <option value="">references…</option>
            {tables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {(c.kind === "text" || c.kind === "email") && (
          <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(c.unique)} onChange={(e) => onChange({ ...c, unique: e.target.checked })} /> unique</label>
        )}
      </td>
      <td className="p-1">{c.kind !== "id" && <input aria-label="NULL percent" type="number" min={0} max={90} className={`${input} w-16`} value={pct(c.nullRate)} onChange={(e) => num("nullRate", e.target.value, 100)} />}</td>
      <td className="p-1">{["int", "decimal", "email", "date"].includes(c.kind) && <input aria-label="Invalid percent" type="number" min={0} max={50} className={`${input} w-16`} value={pct(c.invalidRate)} onChange={(e) => num("invalidRate", e.target.value, 100)} />}</td>
      <td className="p-1">{c.kind === "fk" && <input aria-label="Orphan percent" type="number" min={0} max={50} className={`${input} w-16`} value={pct(c.orphanRate)} onChange={(e) => num("orphanRate", e.target.value, 100)} />}</td>
      <td className="p-1"><button type="button" aria-label={`Delete column ${c.name}`} onClick={onDelete} className="p-1 text-ink-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button></td>
    </tr>
  );
}

export function DataGeneratorPage() {
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState<Difficulty>("realistic");
  const [spec, setSpec] = useState<DatasetSpec>(() => TEMPLATES[0].spec("realistic"));
  const [mounted, setMounted] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [customs, setCustoms] = useState<CustomDataset[]>([]);
  useEffect(() => {
    setMounted(true);
    setCustoms(loadCustomDatasets());
  }, []);

  const errors = validateSpec(spec);
  const gen = useMemo(() => (errors.length ? null : generate(spec)), [spec, errors.length]);
  const tableNames = spec.tables.map((t) => ident(t.name));

  const setTable = (i: number, t: TableSpec) => setSpec({ ...spec, tables: spec.tables.map((x, k) => (k === i ? t : x)) });

  function openInPlayground() {
    if (!gen) return;
    const id = `custom-${ident(spec.title)}`.slice(0, 40);
    const res = saveCustomDataset({ id, title: `${spec.title} (generated)`, description: `Generated in this browser, seed ${spec.seed}. ${gen.notes.length} deliberate quirks.`, tables: tableNames, rows: gen.tables.reduce((s, t) => s + t.rows.length, 0), edgeCases: gen.notes, sql: gen.sql });
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    navigate(`/playground?db=${id}`);
  }

  return (
    <Container wide>
      <Seo
        title="SQL Practice Data Generator — Tables, Keys, NULLs, Duplicates"
        description="Generate practice databases in your browser: tables, keys and realistic values with controllable NULLs, duplicates, orphans and invalid data. Export SQL or CSV."
        path="/data-generator"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Data generator", path: "/data-generator" }])]}
      />
      <PageHeader
        eyebrow="Practical SQL"
        title="Data generation studio"
        intro="Design tables, choose how messy the data should be, and get a reproducible dataset (same settings, same data). It stays in your browser and runs in its own isolated database."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 max-w-full text-sm">
          <span className="block text-xs text-ink-faint">Start from</span>
          <select className={input} onChange={(e) => { const t = TEMPLATES.find((x) => x.id === e.target.value)!; setSpec(t.spec(difficulty)); setMsg(null); }}>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="min-w-0 max-w-full text-sm">
          <span className="block text-xs text-ink-faint">Data quality</span>
          <select className={input} value={difficulty} onChange={(e) => {
            const d = e.target.value as Difficulty;
            setDifficulty(d);
            const t = TEMPLATES.find((x) => x.spec("clean").title === spec.title);
            if (t) setSpec({ ...t.spec(d), seed: spec.seed });
          }}>
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => <option key={d} value={d}>{DIFFICULTY[d].label}</option>)}
          </select>
        </label>
        <label className="min-w-0 max-w-full text-sm">
          <span className="block text-xs text-ink-faint">Dataset name</span>
          <input className={input} value={spec.title} onChange={(e) => setSpec({ ...spec, title: e.target.value })} />
        </label>
        <label className="min-w-0 max-w-full text-sm">
          <span className="block text-xs text-ink-faint">Seed</span>
          <input type="number" className={`${input} w-24`} value={spec.seed} onChange={(e) => setSpec({ ...spec, seed: Number(e.target.value) || 0 })} />
        </label>
        <button type="button" onClick={() => setSpec({ ...spec, seed: Math.floor(Math.random() * 100000) })} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink">
          <Wand2 className="h-4 w-4" aria-hidden /> New seed
        </button>
      </div>

      <div className="mt-6 space-y-4">
        {spec.tables.map((t, i) => (
          <section key={i} className="rounded-card border border-surface-border bg-surface-raised p-4" aria-label={`Table ${t.name}`}>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <input aria-label="Table name" className={`${input} font-semibold`} value={t.name} onChange={(e) => setTable(i, { ...t, name: e.target.value })} />
              <label className="flex items-center gap-1 text-ink-muted">rows <input type="number" min={1} max={MAX_ROWS_PER_TABLE} className={`${input} w-24`} value={t.rows} onChange={(e) => setTable(i, { ...t, rows: Number(e.target.value) || 1 })} /></label>
              <label className="flex items-center gap-1 text-ink-muted">duplicate rows % <input type="number" min={0} max={30} className={`${input} w-16`} value={pct(t.duplicateRate)} onChange={(e) => setTable(i, { ...t, duplicateRate: Number(e.target.value) / 100 })} /></label>
              <button type="button" onClick={() => setSpec({ ...spec, tables: spec.tables.filter((_, k) => k !== i) })} className="ml-auto inline-flex items-center gap-1 text-xs text-ink-faint hover:text-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove table</button>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="text-left">
                <thead className="text-[11px] uppercase tracking-wider text-ink-faint">
                  <tr><th className="p-1">Column</th><th className="p-1">Type</th><th className="p-1">Options</th><th className="p-1">NULL %</th><th className="p-1">Invalid %</th><th className="p-1">Orphan %</th><th /></tr>
                </thead>
                <tbody>
                  {t.columns.map((c, j) => (
                    <ColumnRow key={j} c={c} tables={tableNames.slice(0, i)}
                      onChange={(nc) => setTable(i, { ...t, columns: t.columns.map((x, k) => (k === j ? nc : x)) })}
                      onDelete={() => setTable(i, { ...t, columns: t.columns.filter((_, k) => k !== j) })} />
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => setTable(i, { ...t, columns: [...t.columns, { name: `col_${t.columns.length + 1}`, kind: "text" }] })} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add column
            </button>
          </section>
        ))}
        <button type="button" onClick={() => setSpec({ ...spec, tables: [...spec.tables, { name: `table_${spec.tables.length + 1}`, rows: 50, columns: [{ name: "id", kind: "id" }, { name: "name", kind: "text" }] }] })}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-surface-border px-3 py-2 text-sm text-ink-muted hover:text-ink">
          <Plus className="h-4 w-4" aria-hidden /> Add table
        </button>
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="mt-4 list-disc rounded-lg border border-danger/30 bg-danger-dim py-2 pl-8 pr-4 text-sm text-danger">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}

      {gen && (
        <section className="mt-6 space-y-4" aria-label="Generated dataset">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={openInPlayground} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"><Play className="h-4 w-4" aria-hidden /> Open in playground</button>
            <button type="button" onClick={() => download(`${ident(spec.title)}.sql`, gen.sql, "application/sql")} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-2 text-sm text-ink-muted hover:text-ink"><Download className="h-4 w-4" aria-hidden /> SQL</button>
            {gen.tables.map((t) => (
              <button key={t.name} type="button" onClick={() => download(`${t.name}.csv`, toCsv(t.columns, t.rows), "text/csv")} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-2 text-sm text-ink-muted hover:text-ink"><Download className="h-4 w-4" aria-hidden /> {t.name}.csv</button>
            ))}
            <span className="text-xs text-ink-faint">
              {gen.tables.reduce((s, t) => s + t.rows.length, 0)} rows · {Math.round(gen.sql.length / 1024)} KB{gen.sql.length > MAX_CUSTOM_SQL ? " — too large to keep in the browser; download it instead" : ""}
            </span>
          </div>
          {msg && <p role="alert" className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
          {gen.notes.length > 0 && (
            <div className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
              <p className="font-semibold text-ink">Deliberate data quirks (find them with SQL)</p>
              <ul className="mt-1 list-disc pl-5 text-ink-muted">{gen.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-3">{gen.tables.map((t) => <SampleTable key={t.name} caption={`${t.name} (first 8 of ${t.rows.length})`} columns={t.columns} rows={t.rows} max={8} />)}</div>
            <div className="min-w-0 rounded-card border border-surface-border bg-surface-raised p-2">
              {mounted ? <Suspense fallback={<Skeleton className="h-64" />}><ErDiagram source={erDiagramSource(gen.schema)} /></Suspense> : <Skeleton className="h-64" />}
            </div>
          </div>
        </section>
      )}

      {customs.length > 0 && (
        <section className="mt-8 text-sm">
          <h2 className="font-display text-lg font-bold text-ink">Your saved datasets</h2>
          <ul className="mt-2 space-y-1">
            {customs.map((d) => (
              <li key={d.id} className="flex items-center gap-3">
                <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/playground?db=${d.id}`)}>{d.title}</button>
                <span className="text-xs text-ink-faint">{d.rows} rows · {new Date(d.createdAt).toLocaleDateString()}</span>
                <button type="button" className="text-xs text-ink-faint hover:text-danger" onClick={() => { deleteCustomDataset(d.id); setCustoms(loadCustomDatasets()); }}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Container>
  );
}
