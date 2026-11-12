import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { useReducedMotion } from "../../lib/visual/motion";
import {
  AGGS, BOOKS, ERROR_HELP, MESSY, PIVOT_FIELDS, PIVOT_VALUE_FIELDS, PRESETS, SALES, SUPPORTED_FUNCTIONS, UNSUPPORTED,
  addrOf, applyCf, applyCleanOps, bookFor, bounds, changedCells, cleanOpFormula, cleanOpLabel, colName, copyCell, directDependents,
  evaluateAll, fieldValues, formatText, isErr, isFormula, numStr, parseAddr, pivot, precedents, presetById, qualityIssues, recalcOrder, showVal, traceCell,
  type Agg, type CfRule, type CleanOp, type Cells, type ExcelTab, type LookupTrace, type PivotField, type PivotSpec, type Val,
} from "../../lib/visual/excel";

const sel = "rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs text-ink";
const label = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";
const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`;
/** Accent colour at a given strength, from the theme's RGB triplet token, so it works in light and dark. */
const accentAt = (a: number): CSSProperties => ({ backgroundColor: `rgb(var(--color-accent) / ${a.toFixed(2)})` });

function display(v: Val, fmt?: string): string {
  if (fmt && !isErr(v) && v !== null) { try { return formatText(v, fmt); } catch { /* falls back to general */ } }
  return showVal(v);
}

interface Mark { cls?: string; style?: CSSProperties; badge?: string }

/** A spreadsheet grid: arrow keys move the selection, Enter or F2 jumps to the formula bar. */
function Grid({ cells, values, formats, selected, onSelect, onEdit, marks, name, cols, rows }: {
  cells: Cells; values: Record<string, Val>; formats?: Record<string, string>; selected: string; onSelect: (a: string) => void; onEdit?: () => void;
  marks?: Record<string, Mark>; name: string; cols: number; rows: number;
}) {
  const refs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const focusNext = useRef(false);
  useEffect(() => { if (focusNext.current) { focusNext.current = false; refs.current[selected]?.focus(); } }, [selected]);
  const move = (dc: number, dr: number) => {
    const p = parseAddr(selected)!;
    const c = Math.max(1, Math.min(cols, p.col + dc)), r = Math.max(1, Math.min(rows, p.row + dr));
    focusNext.current = true; onSelect(addrOf(c, r));
  };
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-surface-border">
      <table role="grid" aria-label={name} className="border-collapse text-xs"
        onKeyDown={(e) => {
          const k = e.key;
          if (k === "ArrowRight") { e.preventDefault(); move(1, 0); } else if (k === "ArrowLeft") { e.preventDefault(); move(-1, 0); }
          else if (k === "ArrowDown") { e.preventDefault(); move(0, 1); } else if (k === "ArrowUp") { e.preventDefault(); move(0, -1); }
          else if ((k === "Enter" || k === "F2") && onEdit) { e.preventDefault(); onEdit(); }
        }}>
        <thead>
          <tr role="row"><th className="w-8 bg-surface-soft" aria-label="Row" />{Array.from({ length: cols }, (_, i) => <th key={i} scope="col" className="min-w-[4.5rem] bg-surface-soft px-1 py-0.5 text-center font-medium text-ink-faint">{colName(i + 1)}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr role="row" key={r}>
              <th scope="row" className="bg-surface-soft px-1 text-center font-medium text-ink-faint">{r + 1}</th>
              {Array.from({ length: cols }, (_, c) => {
                const a = addrOf(c + 1, r + 1), v = values[a] ?? null, m = marks?.[a], on = a === selected;
                const err = isErr(v), isNum = typeof v === "number";
                return (
                  <td key={a} id={`xl-${a}`} ref={(el) => { refs.current[a] = el; }} role="gridcell" aria-selected={on} tabIndex={on ? 0 : -1}
                    aria-label={`${a}${cells[a] && isFormula(cells[a]) ? ` formula ${cells[a]}` : ""} value ${display(v, formats?.[a]) || "empty"}`}
                    onClick={() => onSelect(a)} onFocus={() => { if (!on) onSelect(a); }} style={m?.style}
                    className={`relative h-7 max-w-[11rem] cursor-cell truncate border border-surface-border px-1.5 ${isNum ? "text-right tabular-nums" : "text-left"} ${err ? "font-semibold text-danger" : "text-ink"} ${m?.cls ?? ""} ${on ? "outline outline-2 -outline-offset-2 outline-accent" : ""}`}>
                    {display(v, formats?.[a])}
                    {m?.badge && <span className="pointer-events-none absolute right-0 top-0 rounded-bl bg-warn px-0.5 text-[9px] font-bold leading-3 text-surface">{m.badge}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Lookup demonstration ─────────────────────────────────────────────────
const MODE_TEXT: Record<LookupTrace["mode"], string> = {
  exact: "Exact match: scans from the top and stops at the first equal key (so it is slow on a big list, and a miss reads every row).",
  approximate: "Approximate match: a binary search. It jumps to the middle, then halves the range. It ONLY works if the keys are sorted ascending; otherwise the answer can be wrong without any error.",
  "approximate-descending": "Approximate match on descending keys (MATCH -1): a binary search for the smallest key that is at least the value.",
  "next-smaller": "Exact, else the next smaller item: reads every key and remembers the closest one below the value.",
  "next-larger": "Exact, else the next larger item: reads every key and remembers the closest one above the value.",
  wildcard: "Wildcard match: * and ? stand for any text; the first matching key wins.",
};
const VERDICT: Record<string, string> = { equal: "equal: match", differs: "not equal", le: "at most the value: remember it, search the upper half", gt: "above the value: search the lower half", candidate: "closest so far", skip: "different type: skipped" };

function LookupDemo({ lookups }: { lookups: LookupTrace[] }) {
  const [which, setWhich] = useState(0);
  const lk = lookups[Math.min(which, lookups.length - 1)];
  const pb = usePlayback(lk?.probes.length ?? 0);
  useEffect(() => { setWhich(0); }, [lookups.length]);
  if (!lk) return null;
  const upto = lk.probes.slice(0, pb.index + 1), cur = lk.probes[pb.index];
  const seen = new Map(upto.map((p) => [p.i, p.verdict]));
  const last = pb.index >= lk.probes.length - 1;
  return (
    <section aria-label="Lookup demonstration" className="space-y-2 rounded-lg border border-surface-border p-2">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">How the lookup scans</h3><ProvenanceBadge p="simulated" />
        {lookups.length > 1 && <select aria-label="Which lookup" className={sel} value={which} onChange={(e) => { setWhich(Number(e.target.value)); pb.dispatch({ type: "restart" }); }}>{lookups.map((l, i) => <option key={i} value={i}>{l.fn}: {l.text}</option>)}</select>}</div>
      <p className="font-mono text-xs text-ink">{lk.text}</p>
      <p className="text-xs text-ink-muted">Looking for <strong className="text-ink">{typeof lk.lookupValue === "string" ? `"${lk.lookupValue}"` : showVal(lk.lookupValue)}</strong> in {lk.keys.length} {lk.orientation === "row" ? "columns" : "rows"}. {MODE_TEXT[lk.mode]}</p>
      <ol className="max-h-48 overflow-auto rounded border border-surface-border text-xs" aria-label="Keys scanned">
        {lk.keys.map((k, i) => {
          const v = seen.get(i), isCur = cur?.i === i;
          return <li key={i} aria-current={isCur ? "step" : undefined} className={`flex gap-2 px-2 py-0.5 ${v === "equal" ? "bg-success-dim" : isCur ? "bg-accent-dim" : v ? "bg-surface-soft" : ""}`}>
            <span className="w-6 tabular-nums text-ink-faint">{i + 1}</span><span className="font-mono text-ink">{showVal(k) || "(empty)"}</span><span className="ml-auto text-ink-muted">{v ? VERDICT[v] : ""}</span></li>;
        })}
      </ol>
      <PlaybackBar pb={pb} labels={lk.probes.map((p) => `Key ${p.i + 1}: ${VERDICT[p.verdict]}`)} />
      <p role="status" aria-live="polite" className={`rounded border p-2 text-xs ${last ? (lk.matchIndex < 0 ? "border-danger/50 bg-danger-dim" : "border-success/40 bg-success-dim") : "border-surface-border bg-surface-soft"}`}>
        {last ? `${lk.note} Result: ${isErr(lk.result) ? lk.result.error : showVal(lk.result)}. Keys read: ${lk.probes.length} of ${lk.keys.length}.` : cur ? `Reading key ${cur.i + 1} (${showVal(cur.value) || "empty"}): ${VERDICT[cur.verdict]}.` : ""}
      </p>
    </section>
  );
}

// ── Formulas and lookups ─────────────────────────────────────────────────
function GridLab({ presetId }: { presetId: string }) {
  const book = bookFor(presetId);
  const [cells, setCells] = useState<Cells>(book.cells);
  const [selected, setSelected] = useState(book.select);
  const [draft, setDraft] = useState(book.cells[book.select] ?? "");
  const [copyTo, setCopyTo] = useState("");
  const [note, setNote] = useState("");
  const bar = useRef<HTMLInputElement>(null);
  useEffect(() => { setCells(book.cells); setSelected(book.select); setDraft(book.cells[book.select] ?? ""); setNote(""); }, [presetId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(cells[selected] ?? ""); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const { values, circular } = useMemo(() => evaluateAll(cells), [cells]);
  const trace = useMemo(() => traceCell(cells, selected), [cells, selected]);
  const pre = useMemo(() => precedents(cells, selected), [cells, selected]);
  const dep = useMemo(() => directDependents(cells, selected), [cells, selected]);
  const recalc = useMemo(() => recalcOrder(cells, selected), [cells, selected]);
  const pb = usePlayback(trace?.steps.length ?? 0);
  const reduced = useReducedMotion();
  const dims = useMemo(() => bounds(cells), [cells]);
  const marks = useMemo(() => {
    const m: Record<string, Mark> = {};
    for (const a of pre) m[a] = { cls: "bg-accent-dim" };
    recalc.order.forEach((a, i) => { m[a] = { cls: "bg-warn-dim", badge: String(i + 1) }; });
    return m;
  }, [pre, recalc]);
  const commit = () => { if ((cells[selected] ?? "") !== draft) { setCells((c) => { const n = { ...c }; if (draft === "") delete n[selected]; else n[selected] = draft; return n; }); setNote(`${selected} changed. Dependents recalculated.`); } };
  const select = (a: string) => { setSelected(a); pb.dispatch({ type: "restart" }); };
  const cur = trace?.steps[pb.index];
  const sv = values[selected] ?? null;
  const flash = !reduced && note ? "transition-colors" : "";
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">{book.hint}</p>
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Cell editor">
        <label className="text-xs text-ink-muted">Cell<input aria-label="Selected cell" value={selected} onChange={(e) => { const a = e.target.value.toUpperCase(); if (parseAddr(a)) select(a); else setSelected(a); }} className={`${sel} mt-0.5 block w-16 font-mono`} /></label>
        <label className="min-w-0 flex-1 text-xs text-ink-muted">Formula or value
          <input ref={bar} aria-label="Formula bar" value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") { commit(); (document.getElementById(`xl-${selected}`) as HTMLElement | null)?.focus(); } if (e.key === "Escape") { setDraft(cells[selected] ?? ""); (document.getElementById(`xl-${selected}`) as HTMLElement | null)?.focus(); } }}
            className={`${sel} mt-0.5 block w-full font-mono ${flash}`} /></label>
        <label className="text-xs text-ink-muted">Copy to<input aria-label="Copy formula to" value={copyTo} onChange={(e) => setCopyTo(e.target.value.toUpperCase())} placeholder="F3" className={`${sel} mt-0.5 block w-16 font-mono`} /></label>
        <button type="button" className="h-7 rounded-md border border-surface-border px-2 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-40" disabled={!parseAddr(copyTo) || !parseAddr(selected)}
          onClick={() => { const next = copyCell(cells, selected, copyTo); setCells(next); setNote(`Copied ${selected} to ${copyTo}: ${next[copyTo]}. Relative references moved; $ references stayed.`); }}>Copy</button>
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-ink-muted">{note}</p>
      <VisualShell
        left={(
          <div className="space-y-2">
            <Grid name="Sheet" cells={cells} values={values} formats={book.formats} selected={selected} onSelect={select} onEdit={() => bar.current?.focus()} marks={marks} cols={dims.cols} rows={dims.rows} />
            <p className="text-xs text-ink-faint"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-accent-dim align-middle" /> precedents (cells the selected formula reads) <span className="ml-3 mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-warn-dim align-middle" /> cells that recalculate if {selected} changes, numbered in order</p>
            {circular.size > 0 && <p role="alert" className="rounded-lg border border-danger/50 bg-danger-dim p-2 text-xs text-ink">Circular reference involving {[...circular].join(", ")}. Excel warns and shows 0; this lab marks the cells #CIRC! and never iterates.</p>}
          </div>
        )}
        right={(
          <div className="space-y-3">
            <section aria-label="Formula evaluation" className="space-y-2">
              <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">Evaluate formula: {selected}</h3><ProvenanceBadge p="simulated" /></div>
              {!trace ? <p className="text-sm text-ink-muted">{selected} holds {cells[selected] === undefined ? "nothing" : "a plain value"}. Select a cell that starts with = to step through its evaluation.</p> : trace.syntaxError ? (
                <p role="alert" className="rounded-lg border border-danger/50 bg-danger-dim p-2 text-sm text-ink">Excel would refuse this formula: {trace.syntaxError}.</p>
              ) : (
                <>
                  <p className="break-all font-mono text-sm text-ink">{trace.formula}</p>
                  <ol aria-label="Evaluation steps" className="space-y-0.5 text-xs">
                    {trace.steps.map((s, i) => (
                      <li key={i} aria-current={i === pb.index ? "step" : undefined} className={`flex flex-wrap gap-x-2 rounded px-2 py-1 ${i === pb.index ? "bg-accent-dim" : i < pb.index ? "bg-surface-soft" : "opacity-60"}`}>
                        <span className="w-5 tabular-nums text-ink-faint">{i + 1}</span><code className="break-all text-ink">{s.text}</code>
                        <span className="text-ink-muted">=</span><strong className={`break-all ${s.value.startsWith("#") ? "text-danger" : "text-ink"}`}>{i <= pb.index ? s.value : "?"}</strong>
                      </li>
                    ))}
                  </ol>
                  <PlaybackBar pb={pb} labels={trace.steps.map((s) => `${s.text} = ${s.value}`)} />
                  <p role="status" aria-live="polite" className="rounded-lg border border-surface-border bg-surface-soft p-2 text-xs text-ink-muted">
                    {cur ? <>Step {pb.index + 1}: <code className="text-ink">{cur.text}</code> evaluates to <strong className="text-ink">{cur.value}</strong>.{cur.note ? ` ${cur.note}` : ""}</> : "No sub-expressions: the formula is a constant."}
                    {pb.index === trace.steps.length - 1 && <> Final result of {selected}: <strong className="text-ink">{display(sv, book.formats?.[selected]) || "(empty)"}</strong>.</>}
                  </p>
                </>
              )}
              {isErr(sv) && <p role="alert" className="rounded-lg border border-danger/50 bg-danger-dim p-2 text-xs text-ink"><strong>{sv.error}</strong>: {ERROR_HELP[sv.error]}</p>}
            </section>
            <section aria-label="Dependencies" className="space-y-1 text-xs text-ink-muted">
              <p><span className={label}>Precedents</span> {pre.length ? pre.slice(0, 24).join(", ") + (pre.length > 24 ? ` and ${pre.length - 24} more` : "") : "none (a value, or a formula with no references)"}</p>
              <p><span className={label}>Dependents</span> {dep.length ? dep.join(", ") : "none"}</p>
              <p><span className={label}>If {selected} changes</span> {recalc.order.length ? `recalculation order: ${recalc.order.join(" → ")}` : "nothing else recalculates"}{recalc.cyclic.length ? `. Circular: ${recalc.cyclic.join(", ")}` : ""}</p>
              {recalc.levels.length > 1 && <p className="text-ink-faint">Cells in the same level do not depend on each other; Excel may calculate them in any order within the level: {recalc.levels.map((l) => `[${l.join(", ")}]`).join(" then ")}.</p>}
            </section>
            {trace && trace.lookups.length > 0 && <LookupDemo key={selected} lookups={trace.lookups} />}
          </div>
        )}
        bottom={null}
      />
    </div>
  );
}

// ── Pivot table ──────────────────────────────────────────────────────────
function PivotLab() {
  const [rows, setRows] = useState<PivotField | null>("Product");
  const [cols, setCols] = useState<PivotField | null>("Region");
  const [value, setValue] = useState<PivotSpec["value"]>("Amount");
  const [agg, setAgg] = useState<Agg>("sum");
  const [filters, setFilters] = useState<PivotSpec["filters"]>({});
  const [pick, setPick] = useState<{ r: string; c: string } | null>(null);
  const spec: PivotSpec = { rows, cols, value, agg, filters };
  const p = useMemo(() => pivot(SALES, spec), [rows, cols, value, agg, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = (v: number | null) => (v === null ? "" : numStr(+v.toFixed(2)));
  const toggle = (f: PivotField, v: string) => setFilters((cur) => {
    const all = fieldValues(SALES, f), now = cur[f] ?? all;
    const next = now.includes(v) ? now.filter((x) => x !== v) : [...now, v];
    return { ...cur, [f]: next.length === all.length ? undefined : next };
  });
  const sourceOf = pick ? (pick.r === "\u0000" ? (pick.c === "\u0000" ? p.grand : p.colTotal(pick.c)) : pick.c === "\u0000" ? p.rowTotal(pick.r) : p.cell(pick.r, pick.c)) : null;
  const fieldSel = (name: string, v: PivotField | null, set: (f: PivotField | null) => void) => (
    <label className="text-xs text-ink-muted">{name}<select className={`${sel} mt-0.5 block w-full`} value={v ?? ""} onChange={(e) => { set((e.target.value || null) as PivotField | null); setPick(null); }}><option value="">(none)</option>{PIVOT_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
  );
  const cellBtn = (r: string, c: string, v: number | null, total?: boolean) => {
    const on = pick?.r === r && pick?.c === c;
    return <td key={c} className={`border border-surface-border p-0 ${total ? "bg-surface-soft font-semibold" : ""}`}>
      <button type="button" aria-pressed={on} disabled={v === null} aria-label={`${r === "\u0000" ? "All rows" : r || "All"} by ${c === "\u0000" ? "all columns" : c || "all"}: ${fmt(v) || "blank"}`} onClick={() => setPick({ r, c })}
        className={`block h-7 w-full min-w-[3.5rem] px-2 text-right tabular-nums text-ink disabled:cursor-default ${on ? "bg-accent-dim outline outline-2 -outline-offset-2 outline-accent" : "hover:bg-surface-soft"}`}>{fmt(v)}</button></td>;
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">A PivotTable groups rows of source data. Choose which fields become Rows and Columns, what to aggregate, and which items to keep. Click any number to see the source rows behind it. <ProvenanceBadge p="simulated" /></p>
      <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-surface-border p-2 sm:grid-cols-4"><legend className="px-1 text-xs font-semibold text-ink">PivotTable fields</legend>
        {fieldSel("Rows", rows, setRows)}{fieldSel("Columns", cols, setCols)}
        <label className="text-xs text-ink-muted">Values<select className={`${sel} mt-0.5 block w-full`} value={value} onChange={(e) => { setValue(e.target.value as PivotSpec["value"]); setPick(null); }}>{PIVOT_VALUE_FIELDS.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label className="text-xs text-ink-muted">Summarize by<select className={`${sel} mt-0.5 block w-full`} value={agg} onChange={(e) => { setAgg(e.target.value as Agg); setPick(null); }}>{AGGS.map((a) => <option key={a} value={a}>{a === "average" ? "Average" : a[0].toUpperCase() + a.slice(1)}</option>)}</select></label>
      </fieldset>
      <details className="rounded-lg border border-surface-border p-2 text-xs">
        <summary className="cursor-pointer font-semibold text-ink">Filters ({SALES.length - p.filtered.length} of {SALES.length} rows hidden)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{PIVOT_FIELDS.map((f) => (
          <fieldset key={f} className="space-x-2"><legend className={label}>{f}</legend>
            {fieldValues(SALES, f).map((v) => <label key={v} className="inline-flex items-center gap-1 text-ink-muted"><input type="checkbox" checked={(filters[f] ?? [v]).includes(v)} onChange={() => { toggle(f, v); setPick(null); }} />{v}</label>)}</fieldset>
        ))}</div>
      </details>
      <div className="max-w-full overflow-x-auto rounded-lg border border-surface-border">
        <table aria-label="PivotTable" className="w-full border-collapse text-xs">
          <thead><tr><th className="border border-surface-border bg-surface-soft px-2 py-1 text-left text-ink-faint">{agg === "average" ? "Average" : agg[0].toUpperCase() + agg.slice(1)} of {value}{cols ? ` by ${cols}` : ""}</th>
            {p.colKeys.map((c) => <th key={c} scope="col" className="border border-surface-border bg-surface-soft px-2 py-1 text-right font-medium text-ink">{c || value}</th>)}
            {cols && <th scope="col" className="border border-surface-border bg-surface-soft px-2 py-1 text-right font-semibold text-ink">Grand Total</th>}</tr></thead>
          <tbody>
            {p.rowKeys.map((r) => (
              <tr key={r}><th scope="row" className="border border-surface-border bg-surface-soft px-2 py-1 text-left font-medium text-ink">{r || "Total"}</th>
                {p.colKeys.map((c) => cellBtn(r, c, p.cell(r, c).value))}
                {cols && cellBtn(r, "\u0000", p.rowTotal(r).value, true)}</tr>
            ))}
            {rows && p.rowKeys.length > 0 && (
              <tr><th scope="row" className="border border-surface-border bg-surface-soft px-2 py-1 text-left font-semibold text-ink">Grand Total</th>
                {p.colKeys.map((c) => cellBtn("\u0000", c, p.colTotal(c).value, true))}
                {cols && cellBtn("\u0000", "\u0000", p.grand.value, true)}</tr>
            )}
          </tbody>
        </table>
      </div>
      {p.filtered.length === 0 && <p className="text-sm text-ink-muted">Every row is filtered out, so there is nothing to summarise.</p>}
      <p className="text-xs text-ink-faint">Totals are calculated from the source rows, not from the numbers in the table: with Average, the Grand Total is the average of all rows, not an average of averages. A blank cell means no source row matched (not zero).</p>
      <section aria-label="Source rows" className="space-y-1">
        {sourceOf ? (<>
          <p role="status" aria-live="polite" className="text-xs text-ink-muted"><strong className="text-ink">{sourceOf.source.length}</strong> source row{sourceOf.source.length === 1 ? "" : "s"} feed this cell, giving {fmt(sourceOf.value)}.</p>
          <div className="max-w-full overflow-x-auto rounded-lg border border-surface-border"><table className="w-full border-collapse text-xs" aria-label="Rows behind the selected pivot cell">
            <thead><tr>{["#", "Date", "Region", "Product", "Rep", "Qty", "Amount"].map((h) => <th key={h} className="border border-surface-border bg-surface-soft px-2 py-1 text-left text-ink-faint">{h}</th>)}</tr></thead>
            <tbody>{sourceOf.source.map((i) => { const s = SALES[i]; return <tr key={i}><td className="border border-surface-border px-2 text-ink-faint">{i + 1}</td><td className="border border-surface-border px-2 text-ink">{s.Date}</td><td className="border border-surface-border px-2 text-ink">{s.Region}</td><td className="border border-surface-border px-2 text-ink">{s.Product}</td><td className="border border-surface-border px-2 text-ink">{s.Rep}</td><td className="border border-surface-border px-2 text-right text-ink">{s.Qty}</td><td className="border border-surface-border px-2 text-right text-ink">{s.Amount}</td></tr>; })}</tbody></table></div>
        </>) : <p className="text-xs text-ink-faint">Click a number in the PivotTable to list the source rows that were summarised into it.</p>}
      </section>
    </div>
  );
}

// ── Conditional formatting ───────────────────────────────────────────────
type RuleKind = CfRule["kind"] | "bottom";
function FormatLab() {
  const book = BOOKS["conditional-format"];
  const [kind, setKind] = useState<RuleKind>("gt");
  const [range, setRange] = useState("C2:C11");
  const [a, setA] = useState(70), [b, setB] = useState(60), [text, setText] = useState("en"), [n, setN] = useState(3);
  const [selected, setSelected] = useState("C2");
  const { values } = useMemo(() => evaluateAll(book.cells), [book]);
  const rule: CfRule = kind === "gt" ? { kind, value: a } : kind === "lt" ? { kind, value: a } : kind === "between" ? { kind, lo: a, hi: b } : kind === "contains" ? { kind, text } : kind === "top" ? { kind, n } : kind === "bottom" ? { kind: "top", n, bottom: true } : { kind };
  const res = useMemo(() => applyCf(book.cells, range, rule), [book, range, kind, a, b, text, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const marks = useMemo(() => {
    const m: Record<string, Mark> = {};
    for (const addr of res.matches) m[addr] = kind === "scale" ? { style: accentAt(0.08 + 0.55 * res.scale[addr]) } : { cls: "bg-warn-dim font-semibold" };
    return m;
  }, [res, kind]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">A conditional formatting rule is a test applied to every cell of a range. Cells that pass get the format; the stored values never change. <ProvenanceBadge p="simulated" /></p>
      <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-surface-border p-2 sm:grid-cols-4"><legend className="px-1 text-xs font-semibold text-ink">Rule</legend>
        <label className="text-xs text-ink-muted">Highlight cells that are<select aria-label="Rule type" className={`${sel} mt-0.5 block w-full`} value={kind} onChange={(e) => setKind(e.target.value as RuleKind)}>
          <option value="gt">Greater than</option><option value="lt">Less than</option><option value="between">Between</option><option value="contains">Text contains</option><option value="top">Top N</option><option value="bottom">Bottom N</option><option value="duplicates">Duplicate values</option><option value="scale">Colour scale</option></select></label>
        <label className="text-xs text-ink-muted">Applies to range<input aria-label="Range" className={`${sel} mt-0.5 block w-full font-mono`} value={range} onChange={(e) => setRange(e.target.value)} /></label>
        {(kind === "gt" || kind === "lt" || kind === "between") && <label className="text-xs text-ink-muted">{kind === "between" ? "From" : "Value"}<input aria-label="Value" type="number" className={`${sel} mt-0.5 block w-full`} value={a} onChange={(e) => setA(Number(e.target.value))} /></label>}
        {kind === "between" && <label className="text-xs text-ink-muted">To<input aria-label="To" type="number" className={`${sel} mt-0.5 block w-full`} value={b} onChange={(e) => setB(Number(e.target.value))} /></label>}
        {kind === "contains" && <label className="text-xs text-ink-muted">Text<input aria-label="Text" className={`${sel} mt-0.5 block w-full`} value={text} onChange={(e) => setText(e.target.value)} /></label>}
        {(kind === "top" || kind === "bottom") && <label className="text-xs text-ink-muted">N<input aria-label="N" type="number" min={0} className={`${sel} mt-0.5 block w-full`} value={n} onChange={(e) => setN(Math.max(0, Number(e.target.value)))} /></label>}
      </fieldset>
      <p role="status" aria-live="polite" className="text-xs text-ink-muted">{res.note} {kind === "top" || kind === "bottom" ? "Ties at the cut-off are all formatted, as Excel does." : ""}{kind === "scale" ? " Stronger colour means a higher value (minimum is palest, maximum is strongest)." : ""}</p>
      <Grid name="Sales sheet" cells={book.cells} values={values} selected={selected} onSelect={setSelected} marks={marks} cols={4} rows={12} />
    </div>
  );
}

// ── Data cleaning ────────────────────────────────────────────────────────
function CleanLab() {
  const [ops, setOps] = useState<CleanOp[]>([]);
  const [col, setCol] = useState("Name");
  const [delim, setDelim] = useState(",");
  const [dedupe, setDedupe] = useState<string[]>(["Name", "City"]);
  const after = useMemo(() => applyCleanOps(ops), [ops]);
  const prev = useMemo(() => applyCleanOps(ops.slice(0, -1)), [ops]);
  const lastChange = useMemo(() => changedCells(prev, after), [prev, after]);
  const qb = qualityIssues(MESSY), qa = qualityIssues(after);
  const add = (op: CleanOp) => setOps((o) => [...o, op]);
  const cols = after.cols;
  const op = (kind: "trim" | "proper" | "upper" | "lower" | "value" | "date"): CleanOp => ({ kind, col });
  const Table = ({ t, name, mark }: { t: typeof MESSY; name: string; mark?: Set<string> }) => (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-surface-border">
      <table aria-label={name} className="w-full border-collapse text-xs">
        <thead><tr>{t.cols.map((c) => <th key={c} scope="col" className="border border-surface-border bg-surface-soft px-2 py-1 text-left font-medium text-ink-faint">{c}</th>)}</tr></thead>
        <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={`whitespace-pre border border-surface-border px-2 py-0.5 ${typeof v === "number" ? "text-right tabular-nums" : ""} ${mark?.has(`${i},${j}`) ? "bg-success-dim" : ""} text-ink`}><span title={typeof v === "string" ? JSON.stringify(v) : undefined}>{typeof v === "string" ? `"${v}"` : v}</span></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">Apply cleaning steps in order. Text is shown in quotes so hidden spaces are visible; numbers are right-aligned, so a text number is easy to spot. <ProvenanceBadge p="simulated" /></p>
      <fieldset className="space-y-2 rounded-lg border border-surface-border p-2"><legend className="px-1 text-xs font-semibold text-ink">Operations</legend>
        <div className="flex flex-wrap items-end gap-1.5">
          <label className="text-xs text-ink-muted">Column<select aria-label="Column" className={`${sel} mt-0.5 block`} value={cols.includes(col) ? col : cols[0]} onChange={(e) => setCol(e.target.value)}>{cols.map((c) => <option key={c}>{c}</option>)}</select></label>
          {(["trim", "proper", "upper", "lower", "value", "date"] as const).map((k) => <button key={k} type="button" className={chip(false)} onClick={() => add(op(k))}>{k === "date" ? "Date text to date" : k === "value" ? "VALUE" : k.toUpperCase()}</button>)}
        </div>
        <div className="flex flex-wrap items-end gap-1.5">
          <label className="text-xs text-ink-muted">Delimiter<input aria-label="Delimiter" className={`${sel} mt-0.5 block w-14 font-mono`} value={delim} maxLength={3} onChange={(e) => setDelim(e.target.value)} /></label>
          <button type="button" className={chip(false)} disabled={!delim} onClick={() => add({ kind: "split", col, delim })}>Text to columns</button>
          <span className="ml-3 text-xs text-ink-muted">Remove duplicates by:</span>
          {cols.map((c) => <label key={c} className="inline-flex items-center gap-1 text-xs text-ink-muted"><input type="checkbox" checked={dedupe.includes(c)} onChange={() => setDedupe((d) => (d.includes(c) ? d.filter((x) => x !== c) : [...d, c]))} />{c}</label>)}
          <button type="button" className={chip(false)} disabled={!dedupe.length} onClick={() => add({ kind: "dedupe", cols: dedupe })}>Remove duplicates</button>
        </div>
        <div className="flex gap-1.5">
          <button type="button" className={chip(false)} disabled={!ops.length} onClick={() => setOps((o) => o.slice(0, -1))}>Undo</button>
          <button type="button" className={chip(false)} disabled={!ops.length} onClick={() => setOps([])}>Reset</button>
        </div>
      </fieldset>
      <section aria-label="Applied steps" className="text-xs text-ink-muted">
        {ops.length === 0 ? "No steps yet." : <ol className="list-decimal space-y-0.5 pl-5">{ops.map((o, i) => <li key={i}><span className="text-ink">{cleanOpLabel(o)}</span> <span className="text-ink-faint">Same in Excel: {cleanOpFormula(o)}</span></li>)}</ol>}
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-1"><h3 className="text-sm font-semibold text-ink">Before ({MESSY.rows.length} rows)</h3><Table t={MESSY} name="Before cleaning" /></div>
        <div className="min-w-0 space-y-1"><h3 className="text-sm font-semibold text-ink">After ({after.rows.length} rows)</h3><Table t={after} name="After cleaning" mark={ops.length ? lastChange : undefined} />{ops.length > 0 && <p className="text-xs text-ink-faint">Green: cells changed by the last step.</p>}</div>
      </div>
      <p role="status" aria-live="polite" className="rounded-lg border border-surface-border bg-surface-soft p-2 text-xs text-ink-muted">
        Problems found, before {"→"} after: extra spaces {qb.spaces} {"→"} {qa.spaces}; text numbers {qb.textNumbers} {"→"} {qa.textNumbers}; text dates {qb.textDates} {"→"} {qa.textDates}; duplicate rows {qb.duplicates} {"→"} {qa.duplicates}. Duplicates only match once spaces and case agree, so clean first, then remove duplicates.
      </p>
    </div>
  );
}

// ── The lab ──────────────────────────────────────────────────────────────
const TABS: { id: ExcelTab; label: string }[] = [{ id: "grid", label: "Formulas and lookups" }, { id: "pivot", label: "PivotTable" }, { id: "format", label: "Conditional formatting" }, { id: "clean", label: "Data cleaning" }];

/** A teaching spreadsheet. A lesson links with ?preset=<id>; see PRESETS in lib/visual/excel.ts. */
export function ExcelLab({ preset }: { preset?: string }) {
  const [presetId, setPresetId] = useState(presetById(preset)?.id ?? "formulas");
  const [tab, setTab] = useState<ExcelTab>(presetById(preset)?.tab ?? "grid");
  useEffect(() => { const p = presetById(preset); if (p) { setPresetId(p.id); setTab(p.tab); } }, [preset]);
  const gridPreset = presetById(presetId)?.tab === "grid" ? presetId : "formulas";
  const [gridId, setGridId] = useState(gridPreset);
  useEffect(() => { if (presetById(presetId)?.tab === "grid") setGridId(presetId); }, [presetId]);
  const current = presetById(presetId);
  return (
    <section aria-label="Excel Lab" className="space-y-3" data-preset={presetId}>
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge p="simulated" />
        <p className="text-xs text-ink-muted">A simulated subset of Excel for learning, not Excel itself. It follows Excel's documented rules for the functions it supports.</p>
      </div>
      <div role="group" aria-label="Examples" className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => <button key={p.id} type="button" aria-pressed={p.id === presetId} className={chip(p.id === presetId)} title={p.blurb} onClick={() => { setPresetId(p.id); setTab(p.tab); }}>{p.label}</button>)}
      </div>
      {current && <p className="text-sm text-ink-muted">{current.blurb}</p>}
      <div role="tablist" aria-label="Excel Lab views" className="flex flex-wrap gap-1.5 border-b border-surface-border pb-2">
        {TABS.map((t) => <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={chip(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
        {tab === "grid" && <GridLab key={gridId} presetId={gridId} />}
        {tab === "pivot" && <PivotLab />}
        {tab === "format" && <FormatLab />}
        {tab === "clean" && <CleanLab />}
      </div>
      <details className="rounded-lg border border-surface-border p-2 text-xs text-ink-muted">
        <summary className="cursor-pointer font-semibold text-ink">What this lab does not support</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">{UNSUPPORTED.map((u) => <li key={u}>{u}</li>)}</ul>
        <p className="mt-2"><span className="font-semibold text-ink">Supported functions ({SUPPORTED_FUNCTIONS.length}):</span> {SUPPORTED_FUNCTIONS.join(", ")}.</p>
        <p className="mt-1">Approximate lookups use a binary search like Excel, and give the same wrong answers on unsorted keys. Date serials use Excel's 1900 system from 1 March 1900 onward (the fake 29 Feb 1900 is not modelled). Nothing you type leaves this page.</p>
      </details>
    </section>
  );
}
