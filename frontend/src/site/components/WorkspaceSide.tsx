import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Clock, Copy, Database, KeyRound, Link2, Loader2, Save, Search, Trash2, X } from "lucide-react";
import { ReferencePanel } from "./ReferencePanel";
import { getKeys, runQuery, type DbKeys } from "../lib/browserDb";
import { deleteSnippet, readSnippets, saveSnippet, type Snippet } from "../lib/workspace";
import { getExecs, type ExecRecord } from "../lib/vizHistory";
import type { TableSchema } from "../../types";

export type SideTab = "schema" | "history" | "snippets" | "reference";
const TABS: { id: SideTab; label: string; icon: typeof Database }[] = [
  { id: "schema", label: "Schema", icon: Database }, { id: "history", label: "Runs", icon: Clock },
  { id: "snippets", label: "Snippets", icon: Save }, { id: "reference", label: "Reference", icon: BookOpen },
];
const cell = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v));
const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(iso).toLocaleDateString(); };

/** Side panel of the SQL workspace: the live schema, this problem's run history, snippets, reference. */
export function WorkspaceSide({ tab, onTab, onClose, schemas, dataset, datasetLabel, historyKey, historyVersion, current, onInsert, onReplace }: {
  tab: SideTab; onTab: (t: SideTab) => void; onClose: () => void;
  schemas: TableSchema[]; dataset: string; datasetLabel: string;
  historyKey: string; historyVersion: number; current: string;
  onInsert: (text: string) => void; onReplace: (text: string) => void;
}) {
  return (
    <aside aria-label="Workspace tools" className="flex h-full min-h-0 flex-col border-l border-surface-border bg-surface">
      <div className="flex items-center gap-0.5 border-b border-surface-border px-1.5 py-1" role="tablist" aria-label="Workspace tools">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${tab === id ? "bg-surface-raised text-ink shadow-panel" : "text-ink-muted hover:text-ink"}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
          </button>
        ))}
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-ink-muted hover:bg-hover/5 hover:text-ink" aria-label="Close workspace tools"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "schema" && <SchemaTab schemas={schemas} dataset={dataset} datasetLabel={datasetLabel} onInsert={onInsert} />}
        {tab === "history" && <HistoryTab historyKey={historyKey} version={historyVersion} onReplace={onReplace} />}
        {tab === "snippets" && <SnippetsTab lang="sql" current={current} onInsert={onInsert} />}
        {tab === "reference" && <ReferencePanel embedded onClose={onClose} onInsert={onInsert} />}
      </div>
    </aside>
  );
}

/** Tables and columns from the running database (never a static list), with keys and sample rows. */
function SchemaTab({ schemas, dataset, datasetLabel, onInsert }: { schemas: TableSchema[]; dataset: string; datasetLabel: string; onInsert: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [keys, setKeys] = useState<DbKeys | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sample, setSample] = useState<Record<string, { columns: string[]; rows: unknown[][] } | string>>({});
  useEffect(() => { setKeys(null); if (schemas.length) void getKeys(dataset).then(setKeys).catch(() => setKeys({ pk: {}, fk: [] })); }, [dataset, schemas.length]);
  const needle = q.trim().toLowerCase();
  const tables = useMemo(() => schemas
    .map((t) => ({ t, cols: t.columns.filter((c) => !needle || t.table_name.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle)) }))
    .filter(({ t, cols }) => !needle || t.table_name.toLowerCase().includes(needle) || cols.length), [schemas, needle]);
  const loadSample = async (table: string) => {
    if (sample[table]) return;
    const r = await runQuery(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 5`, dataset);
    setSample((s) => ({ ...s, [table]: r.success ? { columns: r.columns, rows: r.rows } : r.message ?? "Could not read rows." }));
  };
  const fkOf = (table: string, col: string) => keys?.fk.find((f) => f.table === table && f.column === col);
  const refsTo = (table: string) => keys?.fk.filter((f) => f.refTable === table) ?? [];
  if (!schemas.length) return <p className="p-3 text-xs text-ink-muted">The schema appears once PostgreSQL has started (click into the editor).</p>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <label className="relative mx-3 my-2 block">
        <span className="sr-only">Search tables and columns</span>
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${datasetLabel} tables and columns`}
          className="w-full rounded-lg border border-surface-border bg-surface-raised py-1.5 pl-8 pr-2 text-sm text-ink outline-none focus:border-accent" />
      </label>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {!tables.length && <li className="text-xs text-ink-muted">Nothing matches "{q}".</li>}
        {tables.map(({ t, cols }) => {
          const isOpen = open === t.table_name || (!!needle && cols.length < t.columns.length);
          const s = sample[t.table_name];
          return (
            <li key={t.table_name} className="rounded-lg border border-surface-border bg-surface-raised">
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button type="button" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : t.table_name); if (!isOpen) void loadSample(t.table_name); }} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />}
                  <span className="truncate font-mono text-sm font-semibold text-ink">{t.table_name}</span>
                  <span className="shrink-0 text-[10px] text-ink-faint">{t.columns.length} cols</span>
                </button>
                <button type="button" className="rounded px-1 text-[11px] text-accent hover:underline" onClick={() => onInsert(t.table_name)} aria-label={`Insert ${t.table_name}`}>Insert</button>
              </div>
              {isOpen && (
                <div className="border-t border-surface-border px-2 py-1.5">
                  <ul className="space-y-0.5">
                    {(needle ? cols : t.columns).map((c) => {
                      const pk = keys?.pk[t.table_name]?.includes(c.name), fk = fkOf(t.table_name, c.name);
                      return (
                        <li key={c.name} className="flex items-center gap-1.5 text-xs">
                          <button type="button" className="truncate font-mono text-ink hover:text-accent" onClick={() => onInsert(c.name)} title="Insert column name">{c.name}</button>
                          {pk && <KeyRound className="h-3 w-3 shrink-0 text-secondary" aria-label="Primary key" />}
                          {fk && <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-accent" title={`References ${fk.refTable}.${fk.refColumn}`}><Link2 className="h-3 w-3" aria-hidden />{fk.refTable}</span>}
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-faint">{c.data_type}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {refsTo(t.table_name).length > 0 && <p className="mt-1.5 text-[10px] text-ink-faint">Referenced by {refsTo(t.table_name).map((f) => `${f.table}.${f.column}`).join(", ")}</p>}
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Sample rows</p>
                  {!s ? <Loader2 className="mt-1 h-3.5 w-3.5 animate-spin text-ink-faint" aria-label="Loading rows" />
                    : typeof s === "string" ? <p className="text-[11px] text-danger">{s}</p>
                      : (
                        <div className="mt-1 max-w-full overflow-x-auto">
                          <table className="text-[10px]">
                            <thead><tr>{s.columns.map((c) => <th key={c} className="px-1.5 py-0.5 text-left font-medium text-ink-faint">{c}</th>)}</tr></thead>
                            <tbody>{s.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="whitespace-nowrap px-1.5 py-0.5 font-mono text-ink">{cell(v).slice(0, 40)}</td>)}</tr>)}</tbody>
                          </table>
                        </div>
                      )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** This problem's runs and submits from the shared execution history (also on the question's History tab). */
function HistoryTab({ historyKey, version, onReplace }: { historyKey: string; version: number; onReplace: (t: string) => void }) {
  const [runs, setRuns] = useState<ExecRecord[]>([]);
  useEffect(() => setRuns(getExecs(historyKey)), [historyKey, version]);
  if (!runs.length) return <p className="p-3 text-xs text-ink-muted">Runs and submits of this problem appear here, newest first.</p>;
  return (
    <ul className="h-full min-h-0 space-y-1.5 overflow-y-auto p-3">
      {runs.slice(0, 30).map((r, i) => {
        const label = r.kind === "submit" ? (r.correct ? "Correct" : "Incorrect") : r.ok ? `Ran · ${r.rows ?? 0} rows` : "Error";
        const good = r.kind === "submit" ? r.correct : r.ok;
        return (
          <li key={i} className="rounded-lg border border-surface-border bg-surface-raised p-2">
            <div className="flex items-center gap-2 text-[11px]">
              <span className={`font-semibold ${good ? "text-success" : "text-danger"}`}>{label}</span>
              <span className="ml-auto shrink-0 text-ink-faint">{ago(r.at)}</span>
            </div>
            <pre className="mt-1 max-h-20 overflow-hidden whitespace-pre-wrap font-mono text-[11px] text-ink-muted">{r.sql.slice(0, 300)}</pre>
            <div className="mt-1 flex gap-3 text-[11px]">
              <button type="button" className="text-accent hover:underline" onClick={() => { if (confirm("Replace the editor with this version?")) onReplace(r.sql); }}>Restore</button>
              <button type="button" className="inline-flex items-center gap-1 text-ink-muted hover:text-ink" onClick={() => void navigator.clipboard?.writeText(r.sql)}><Copy className="h-3 w-3" aria-hidden /> Copy</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SnippetsTab({ lang, current, onInsert }: { lang: "sql" | "python"; current: string; onInsert: (t: string) => void }) {
  const [items, setItems] = useState<Snippet[]>([]);
  const [name, setName] = useState("");
  useEffect(() => setItems(readSnippets(lang)), [lang]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <form className="flex gap-1.5 border-b border-surface-border p-3" onSubmit={(e) => { e.preventDefault(); if (current.trim()) { setItems(saveSnippet(lang, name || current.trim().split("\n")[0], current)); setName(""); } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name for the current code" aria-label="Snippet name"
          className="min-w-0 flex-1 rounded-lg border border-surface-border bg-surface-raised px-2 py-1 text-xs text-ink outline-none focus:border-accent" />
        <button type="submit" disabled={!current.trim()} className="inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"><Save className="h-3 w-3" aria-hidden /> Save</button>
      </form>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {!items.length && <li className="text-xs text-ink-muted">Save code you reuse (a join pattern, a CTE skeleton) and insert it into any {lang === "sql" ? "SQL" : "Python"} editor. Kept in this browser.</li>}
        {items.map((s) => (
          <li key={s.id} className="rounded-lg border border-surface-border bg-surface-raised p-2">
            <div className="flex items-center gap-2"><span className="truncate text-xs font-semibold text-ink">{s.name}</span>
              <button type="button" className="ml-auto text-ink-faint hover:text-danger" aria-label={`Delete ${s.name}`} onClick={() => setItems(deleteSnippet(lang, s.id))}><Trash2 className="h-3 w-3" /></button></div>
            <pre className="mt-1 max-h-20 overflow-hidden whitespace-pre-wrap font-mono text-[11px] text-ink-muted">{s.code.slice(0, 300)}</pre>
            <div className="mt-1 flex gap-3 text-[11px]">
              <button type="button" className="text-accent hover:underline" onClick={() => onInsert(s.code)}>Insert</button>
              <button type="button" className="inline-flex items-center gap-1 text-ink-muted hover:text-ink" onClick={() => void navigator.clipboard?.writeText(s.code)}><Copy className="h-3 w-3" aria-hidden /> Copy</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
