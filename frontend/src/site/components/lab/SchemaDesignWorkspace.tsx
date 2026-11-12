import { Suspense, lazy, useMemo, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { INDEX_DEMO, EXERCISES, checkDecompose, checkDesign, checkPick, planNodeTypes, type DecomposeExercise, type DesignExercise, type PickExercise } from "../../lib/lab/designExercises";
import { TYPES, emptySchema, newColumn, relationships, toDdl, toSchemaTables, validateSchema, type Col, type Schema, type Tbl } from "../../lib/lab/schemaDesign";
import { deleteDoc, listDocs, loadDoc, saveDoc } from "../../lib/lab/store";
import { registerDataset, runQuery } from "../../lib/browserDb";
import { Button, Skeleton, Tabs } from "../ui";
import { HelpTooltip } from "../../help/HelpTooltip";

const SchemaFlow = lazy(() => import("../SchemaFlow"));
const INPUT = "rounded-lg border border-surface-border bg-surface px-2 py-1 text-sm text-ink";
type Tab = "design" | "exercises" | "indexes";

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }

export default function SchemaDesignWorkspace() {
  const [tab, setTab] = useState<Tab>("design");
  const [schema, setSchema] = useState<Schema>(() => ({ tables: EXERCISES.flatMap((e) => (e.kind === "design" && e.id === "rel-1n" ? e.starter.tables : [])) }));
  const [exId, setExId] = useState<string>("free");
  return (
    <div className="space-y-4">
      <Tabs label="Designer sections" value={tab} onChange={setTab} tabs={[{ id: "design", label: "Design a schema" }, { id: "exercises", label: "Normalization exercises" }, { id: "indexes", label: "Indexes" }]} />
      {tab === "design" && <Designer schema={schema} setSchema={setSchema} exId={exId} setExId={setExId} />}
      {tab === "exercises" && <Exercises />}
      {tab === "indexes" && <IndexDemo />}
    </div>
  );
}

function Designer({ schema, setSchema, exId, setExId }: { schema: Schema; setSchema: (s: Schema) => void; exId: string; setExId: (id: string) => void }) {
  const [db, setDb] = useState<{ status: "idle" | "busy" | "ok" | "error"; text: string }>({ status: "idle", text: "" });
  const [check, setCheck] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const [name, setName] = useState("My schema");
  const [saved, setSaved] = useState(() => listDocs("schema"));
  const [docId, setDocId] = useState<string | undefined>();
  const [orphan, setOrphan] = useState<string | null>(null);
  const issues = useMemo(() => validateSchema(schema), [schema]);
  const ddl = useMemo(() => (issues.some((i) => i.level === "error") ? "" : toDdl(schema)), [schema, issues]);
  const rels = useMemo(() => relationships(schema), [schema]);
  const exercise = EXERCISES.find((e): e is DesignExercise => e.kind === "design" && e.id === exId) ?? null;

  const setTable = (i: number, f: (t: Tbl) => Tbl) => { setSchema({ tables: schema.tables.map((t, j) => (j === i ? f(t) : t)) }); setCheck(null); setDb({ status: "idle", text: "" }); };
  const setCol = (i: number, k: number, patch: Partial<Col>) => setTable(i, (t) => ({ ...t, columns: t.columns.map((c, m) => (m === k ? { ...c, ...patch } : c)) }));
  const pickExercise = (id: string) => { setExId(id); setCheck(null); const e = EXERCISES.find((x): x is DesignExercise => x.kind === "design" && x.id === id); if (e) setSchema(JSON.parse(JSON.stringify(e.starter))); };

  async function create() {
    if (!ddl) return;
    setDb({ status: "busy", text: "Creating the tables in an isolated PostgreSQL database..." });
    try {
      const id = `designer-${hash(ddl)}`;
      registerDataset({ id, sql: ddl });
      const r = await runQuery("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1", id);
      setDb(r.success ? { status: "ok", text: `Created ${r.rows.length} table${r.rows.length === 1 ? "" : "s"}: ${r.rows.map((x) => x[0]).join(", ")}. The SQL is valid PostgreSQL.` } : { status: "error", text: r.message ?? "PostgreSQL rejected this schema." });
      const fk = schema.tables.find((t) => t.columns.some((c) => c.fk));
      if (fk && r.success) {
        const c = fk.columns.find((x) => x.fk)!;
        const bad = await runQuery(`INSERT INTO ${fk.name} (${fk.columns.filter((x) => x.pk || x.notNull || x.fk).map((x) => x.name).join(", ")}) VALUES (${fk.columns.filter((x) => x.pk || x.notNull || x.fk).map((x) => (x.name === c.name ? "999999" : /int|numeric/.test(x.type) ? "1" : "'x'")).join(", ")})`, id);
        setOrphan(bad.success ? "Inserting a row that points at a missing parent was accepted, so the database is not protecting the link." : `Try it: inserting a row in ${fk.name} that points at a parent that does not exist is refused by PostgreSQL ("${(bad.message ?? "").slice(0, 110)}"). That is referential integrity.`);
      } else setOrphan(null);
    } catch (e) {
      setDb({ status: "error", text: (e as Error).message || "The database could not start." });
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-muted">Start from <select value={exId} onChange={(e) => pickExercise(e.target.value)} className={`${INPUT} ml-1`}><option value="free">a blank design</option>{EXERCISES.filter((e) => e.kind === "design").map((e) => <option key={e.id} value={e.id}>Exercise: {e.title}</option>)}</select></label>
          <Button size="sm" variant="secondary" onClick={() => { setSchema(emptySchema()); setExId("free"); setCheck(null); }}>Clear</Button>
          <HelpTooltip id="de-reset-vs-clear" label="What does Clear do, and how is it different from Reset?" />
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <input aria-label="Schema name" value={name} onChange={(e) => setName(e.target.value)} className={`${INPUT} w-32`} maxLength={60} />
            <Button size="sm" variant="secondary" onClick={() => { const id = saveDoc("schema", { id: docId, name, data: schema }); if (id) { setDocId(id); setSaved(listDocs("schema")); } }}>Save</Button>
            {saved.length > 0 && <select aria-label="Open a saved schema" value="" onChange={(e) => { const d = loadDoc<Schema>("schema", e.target.value); if (d) { setSchema(d); setDocId(e.target.value); setExId("free"); } }} className={INPUT}><option value="">Open saved...</option>{saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
            {docId && <button type="button" onClick={() => { deleteDoc("schema", docId); setSaved(listDocs("schema")); setDocId(undefined); }} className="text-xs text-ink-muted hover:text-danger">Delete</button>}
          </span>
        </div>
        {exercise && <p className="rounded-lg bg-accent-dim px-3 py-2 text-sm text-ink"><strong>{exercise.title}.</strong> {exercise.prompt}</p>}

        {schema.tables.map((t, i) => (
          <fieldset key={i} className="rounded-card border border-surface-border bg-surface-raised p-3">
            <legend className="sr-only">Table {t.name || i + 1}</legend>
            <div className="flex items-center gap-2">
              <input aria-label="Table name" value={t.name} onChange={(e) => setTable(i, (x) => ({ ...x, name: e.target.value }))} className={`${INPUT} flex-1 font-mono font-semibold`} placeholder="table_name" />
              <button type="button" aria-label={`Remove table ${t.name}`} onClick={() => { setSchema({ tables: schema.tables.filter((_, j) => j !== i) }); setCheck(null); }} className="text-ink-muted hover:text-danger"><Trash2 className="h-4 w-4" aria-hidden /></button>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-xs">
                <thead className="text-ink-faint"><tr><th className="pr-1 font-medium">Column</th><th className="pr-1 font-medium">Type</th><th className="px-1 font-medium">PK</th><th className="px-1 font-medium">Not null</th><th className="px-1 font-medium">Unique</th><th className="pl-1 font-medium">References</th><th /></tr></thead>
                <tbody>{t.columns.map((c, k) => (
                  <tr key={k}>
                    <td className="pr-1"><input aria-label="Column name" value={c.name} onChange={(e) => setCol(i, k, { name: e.target.value })} className={`${INPUT} w-28 font-mono`} /></td>
                    <td className="pr-1"><select aria-label="Type" value={c.type} onChange={(e) => setCol(i, k, { type: e.target.value })} className={INPUT}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select></td>
                    <td className="px-1"><input type="checkbox" aria-label="Primary key" checked={c.pk} onChange={(e) => setCol(i, k, { pk: e.target.checked })} /></td>
                    <td className="px-1"><input type="checkbox" aria-label="Not null" checked={c.notNull || c.pk} disabled={c.pk} onChange={(e) => setCol(i, k, { notNull: e.target.checked })} /></td>
                    <td className="px-1"><input type="checkbox" aria-label="Unique" checked={c.unique} onChange={(e) => setCol(i, k, { unique: e.target.checked })} /></td>
                    <td className="pl-1"><select aria-label="References" value={c.fk ? `${c.fk.table}.${c.fk.column}` : ""} onChange={(e) => { const [tn, cn] = e.target.value.split("."); setCol(i, k, { fk: e.target.value ? { table: tn, column: cn } : null }); }} className={INPUT}><option value="">none</option>{schema.tables.flatMap((x) => x.columns.filter((y) => y.pk || y.unique).map((y) => <option key={`${x.name}.${y.name}`} value={`${x.name}.${y.name}`}>{x.name}.{y.name}</option>))}</select></td>
                    <td><button type="button" aria-label="Remove column" onClick={() => setTable(i, (x) => ({ ...x, columns: x.columns.filter((_, m) => m !== k) }))} className="px-1 text-ink-muted hover:text-danger">×</button></td>
                  </tr>))}</tbody>
              </table>
            </div>
            <button type="button" onClick={() => setTable(i, (x) => ({ ...x, columns: [...x.columns, newColumn(`column_${x.columns.length + 1}`)] }))} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"><Plus className="h-3 w-3" aria-hidden /> Add column</button>
          </fieldset>
        ))}
        <Button variant="secondary" onClick={() => { setSchema({ tables: [...schema.tables, { name: `table_${schema.tables.length + 1}`, columns: [{ ...newColumn("id"), pk: true }], indexes: [] }] }); setCheck(null); }}><Plus className="h-4 w-4" aria-hidden /> Add table</Button>

        {issues.length > 0 && <ul aria-label="Design problems" className="space-y-1 text-xs">{issues.map((i, n) => <li key={n} className={i.level === "error" ? "text-danger" : "text-warn"}>{i.level === "error" ? "Problem: " : "Tip: "}{i.text}</li>)}</ul>}
        {exercise && (
          <div className="space-y-2">
            <Button onClick={() => setCheck(checkDesign(exercise, schema))}>Check my design</Button>
            {check && <div role="status" className={`rounded-lg px-3 py-2 text-sm ${check.ok ? "bg-success-dim text-success" : "bg-danger-dim text-danger"}`}>{check.ok ? <><p className="font-medium"><CheckCircle2 className="mr-1 inline h-4 w-4" aria-hidden />That works.</p><p className="mt-1 text-ink">{exercise.explain}</p></> : <ul className="list-disc pl-4">{check.messages.map((m) => <li key={m}>{m}</li>)}</ul>}</div>}
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div className="h-[320px] overflow-hidden rounded-card border border-surface-border" role="region" aria-label="Entity relationship diagram">
          {schema.tables.some((t) => t.columns.length) && !issues.some((i) => /circle/.test(i.text)) ? <Suspense fallback={<Skeleton className="h-full" />}><SchemaFlow key={schema.tables.map((t) => t.name + t.columns.length).join("|")} schema={toSchemaTables(schema)} /></Suspense> : <p className="p-4 text-sm text-ink-muted">Add a table to see the diagram.</p>}
        </div>
        {rels.length > 0 && <ul aria-label="Relationships" className="space-y-1 text-xs text-ink-muted">{rels.map((r, i) => <li key={i}><span className="mr-1 rounded bg-surface-soft px-1.5 py-0.5 font-mono text-ink">{r.cardinality}</span>{r.text}</li>)}</ul>}
        <div>
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-ink">PostgreSQL</h2><Button size="sm" onClick={() => void create()} disabled={!ddl || db.status === "busy"}>Create in database</Button></div>
          <pre tabIndex={0} className="mt-1 max-h-60 overflow-auto rounded-lg bg-surface-soft p-2 font-mono text-xs text-ink">{ddl || "-- Fix the problems on the left to generate SQL."}</pre>
          {db.text && <p role={db.status === "error" ? "alert" : "status"} className={`mt-1 text-xs ${db.status === "error" ? "text-danger" : "text-ink-muted"}`}>{db.text}</p>}
          {orphan && <p className="mt-1 text-xs text-ink-muted">{orphan}</p>}
        </div>
      </div>
    </div>
  );
}

function Exercises() {
  const items = EXERCISES.filter((e): e is PickExercise | DecomposeExercise => e.kind !== "design");
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">Relationship exercises (one-to-one, one-to-many, many-to-many, keys) are in the <strong>Design a schema</strong> tab: choose one under "Start from". These need written answers.</p>
      {items.map((e) => <ExerciseCard key={e.id} e={e} />)}
    </div>
  );
}

function ExerciseCard({ e }: { e: PickExercise | DecomposeExercise }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [res, setRes] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const [reveal, setReveal] = useState(false);
  return (
    <section aria-label={e.title} className="rounded-card border border-surface-border bg-surface-raised p-4">
      <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink"><span className="rounded-full bg-accent-dim px-2 py-0.5 text-[11px] text-accent">{e.concept}</span>{e.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{e.prompt}</p>
      {e.kind === "pick-columns" ? (
        <>
          <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-ink-faint"><tr>{e.columns.map((c) => <th key={c} scope="col" className="pr-3 font-medium">{c}</th>)}</tr></thead><tbody>{e.rows.map((r, i) => <tr key={i}>{e.columns.map((c) => <td key={c} className="pr-3 font-mono text-ink">{r[c]}</td>)}</tr>)}</tbody></table></div>
          <fieldset className="mt-2 flex flex-wrap gap-3"><legend className="sr-only">Columns that break 1NF</legend>{e.columns.map((c) => <label key={c} className="flex items-center gap-1.5 text-sm text-ink"><input type="checkbox" checked={picked.includes(c)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, c] : picked.filter((x) => x !== c))} />{c}</label>)}</fieldset>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-ink-muted">Columns: <span className="font-mono text-ink">{e.attrs.join(", ")}</span></p>
          <pre className="mt-1 rounded bg-surface-soft p-2 font-mono text-xs text-ink">{e.fdText}</pre>
          <label className="mt-2 block text-xs text-ink-muted">Your tables (one per line, comma separated columns)<textarea value={text} onChange={(ev) => setText(ev.target.value)} rows={4} className={`${INPUT} mt-1 w-full font-mono`} spellCheck={false} /></label>
        </>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setRes(e.kind === "pick-columns" ? checkPick(e, picked) : checkDecompose(e, text))}>Check</Button>
        <button type="button" onClick={() => setReveal((v) => !v)} className="text-xs text-ink-muted hover:text-ink">{reveal ? "Hide" : "Show"} the worked solution</button>
      </div>
      {res && <div role="status" className={`mt-2 rounded-lg px-3 py-2 text-sm ${res.ok ? "bg-success-dim text-success" : "bg-danger-dim text-danger"}`}>{res.ok ? <><p className="font-medium">Correct.</p><p className="mt-1 text-ink">{e.explain}</p></> : <ul className="list-disc pl-4">{res.messages.map((m) => <li key={m}>{m}</li>)}</ul>}</div>}
      {reveal && <div className="mt-2 rounded-lg border border-surface-border p-2 text-xs text-ink-muted"><p className="font-medium text-ink">Worked solution</p>{e.kind === "pick-columns" ? <p>{e.answer.join(", ")}. {e.explain}</p> : <><pre className="mt-1 font-mono text-ink">{e.solution.map((p) => p.join(", ")).join("\n")}</pre><p className="mt-1">{e.explain}</p></>}</div>}
    </section>
  );
}

function IndexDemo() {
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; before: string[]; after: string[]; msg: string }>({ status: "idle", before: [], after: [], msg: "" });
  async function run() {
    setState({ status: "busy", before: [], after: [], msg: "Building a 40,000 row table..." });
    try {
      const id = `index-demo-${Date.now().toString(36)}`;
      registerDataset({ id, sql: INDEX_DEMO.setup });
      const plan = async () => { const r = await runQuery(INDEX_DEMO.explain(INDEX_DEMO.query), id); if (!r.success) throw new Error(r.message ?? "EXPLAIN failed"); return planNodeTypes(r.rows[0]?.[0]); };
      const before = await plan();
      const c = await runQuery(INDEX_DEMO.createIndex, id);
      if (!c.success) throw new Error(c.message ?? "Index creation failed");
      await runQuery("ANALYZE events", id);
      setState({ status: "done", before, after: await plan(), msg: "" });
    } catch (e) {
      setState({ status: "error", before: [], after: [], msg: (e as Error).message });
    }
  }
  return (
    <section aria-label="Index demonstration" className="max-w-3xl space-y-3">
      <p className="text-sm text-ink-muted">An index is a sorted lookup structure on one or more columns. Without it PostgreSQL may have to read every row; with it, it can jump to the matching rows. This demo builds a 40,000 row table and asks PostgreSQL how it would run the same query before and after creating an index.</p>
      <pre className="rounded-lg bg-surface-soft p-2 font-mono text-xs text-ink">{INDEX_DEMO.query};{"\n"}-- then: {INDEX_DEMO.createIndex};</pre>
      <Button onClick={() => void run()} disabled={state.status === "busy"}>Run the demo</Button>
      {state.status === "busy" && <p role="status" className="text-sm text-ink-muted">{state.msg}</p>}
      {state.status === "error" && <p role="alert" className="text-sm text-danger">The demo could not run: {state.msg}</p>}
      {state.status === "done" && (
        <div className="grid gap-3 sm:grid-cols-2" role="status">
          {[["Before the index", state.before], ["After the index", state.after]].map(([t, plan]) => <div key={t as string} className="rounded-lg border border-surface-border p-3"><p className="text-xs font-semibold text-ink-faint">{t as string}</p><p className="mt-1 font-mono text-sm text-ink">{(plan as string[]).join(" > ") || "unknown"}</p></div>)}
          <p className="text-xs text-ink-muted sm:col-span-2">This is the planner's choice on this data. Indexes also cost space and slow down writes, so add them for columns you filter or join on often, not everywhere. Seeing a different plan is evidence for this query on this table, not a rule for every query.</p>
        </div>
      )}
    </section>
  );
}
