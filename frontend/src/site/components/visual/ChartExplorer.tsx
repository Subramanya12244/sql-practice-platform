import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { AGGS, CHART_TYPES, DEFAULT_SPEC, DIMS, MEASURES, adviseChart, axisRange, buildChart, dimValues, type Agg, type ChartSpec, type ChartType, type Dim, type Measure } from "../../lib/visual/chartData";

const sel = "rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs text-ink";
const COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#0ea5e9", "#84cc16", "#ec4899"];

function BoxPlot({ stats }: { stats: NonNullable<ReturnType<typeof buildChart>["box"]> }) {
  const all = stats.flatMap((s) => [s.min, s.max, ...s.outliers]);
  const lo = Math.min(...all), hi = Math.max(...all), H = 200, W = 40 + stats.length * 70;
  const y = (v: number) => 10 + (H - 20) * (1 - (v - lo) / (hi - lo || 1));
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label="Box plot" className="w-full max-w-xl">
      {stats.map((s, i) => { const x = 40 + i * 70; return (
        <g key={s.label}>
          <line x1={x} x2={x} y1={y(s.min)} y2={y(s.max)} stroke="currentColor" className="text-ink-muted" />
          <rect x={x - 16} y={y(s.q3)} width={32} height={Math.max(1, y(s.q1) - y(s.q3))} className="fill-accent/30 stroke-accent" />
          <line x1={x - 16} x2={x + 16} y1={y(s.median)} y2={y(s.median)} stroke="currentColor" strokeWidth={2} className="text-ink" />
          {s.outliers.map((o, k) => <circle key={k} cx={x} cy={y(o)} r={2.5} className="fill-danger" />)}
          <text x={x} y={H + 14} textAnchor="middle" className="fill-current text-[10px] text-ink-muted">{s.label}</text>
        </g>); })}
      <text x={4} y={14} className="fill-current text-[10px] text-ink-faint">{Math.round(hi)}</text><text x={4} y={H - 6} className="fill-current text-[10px] text-ink-faint">{Math.round(lo)}</text>
    </svg>
  );
}

function Heat({ grid }: { grid: NonNullable<ReturnType<typeof buildChart>["grid"]> }) {
  const flat = grid.cells.flat(), lo = Math.min(...flat), hi = Math.max(...flat);
  return (
    <table className="border-collapse text-xs" aria-label="Heatmap"><thead><tr><th />{grid.cols.map((c) => <th key={c} className="px-2 py-1 text-ink-muted">{c}</th>)}</tr></thead>
      <tbody>{grid.rows.map((r, i) => <tr key={r}><th className="pr-2 text-right text-ink-muted">{r}</th>{grid.cells[i].map((v, j) => <td key={j} className="border border-surface-bg px-2 py-1.5 text-center tabular-nums text-ink" style={{ background: `rgba(99,102,241,${0.12 + 0.75 * ((v - lo) / (hi - lo || 1))})` }}>{Math.round(v)}</td>)}</tr>)}</tbody></table>
  );
}

/** Pick data, an aggregation and a chart type, and see the chart, the exact numbers behind it, and honest advice on fit. */
export function ChartExplorer() {
  const [spec, setSpec] = useState<ChartSpec>(DEFAULT_SPEC);
  const model = useMemo(() => buildChart(spec), [spec]);
  const advice = useMemo(() => adviseChart(spec, model), [spec, model]);
  const set = (p: Partial<ChartSpec>) => setSpec((s) => ({ ...s, ...p }));
  const pts = model.points ?? [];
  const range = axisRange(pts, spec.zeroBaseline);
  const toggleFilter = (d: Dim, v: string) => setSpec((s) => { const cur = s.filter[d] ?? []; const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]; return { ...s, filter: { ...s.filter, [d]: next } }; });
  const usesDim = !["scatter", "histogram", "timeseries"].includes(spec.type);
  return (
    <section aria-label="Data visualization explorer" className="grid gap-3 lg:grid-cols-[minmax(0,16rem)_1fr]">
      <fieldset className="space-y-2 rounded-lg border border-surface-border p-2 text-xs">
        <legend className="px-1 font-semibold text-ink">Chart settings</legend>
        <label className="block text-ink-muted">Chart type<select className={`${sel} mt-0.5 w-full`} value={spec.type} onChange={(e) => set({ type: e.target.value as ChartType })}>{CHART_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        {usesDim && <label className="block text-ink-muted">Dimension (group by)<select className={`${sel} mt-0.5 w-full`} value={spec.dim} onChange={(e) => set({ dim: e.target.value as Dim })}>{DIMS.map((d) => <option key={d}>{d}</option>)}</select></label>}
        {spec.type === "heatmap" && <label className="block text-ink-muted">Second dimension<select className={`${sel} mt-0.5 w-full`} value={spec.dim2} onChange={(e) => set({ dim2: e.target.value as Dim })}>{DIMS.map((d) => <option key={d}>{d}</option>)}</select></label>}
        <label className="block text-ink-muted">Measure<select className={`${sel} mt-0.5 w-full`} value={spec.measure} onChange={(e) => set({ measure: e.target.value as Measure })}>{MEASURES.map((d) => <option key={d}>{d}</option>)}</select></label>
        {spec.type === "scatter" && <label className="block text-ink-muted">Second measure<select className={`${sel} mt-0.5 w-full`} value={spec.measure2} onChange={(e) => set({ measure2: e.target.value as Measure })}>{MEASURES.map((d) => <option key={d}>{d}</option>)}</select></label>}
        {!["scatter", "histogram", "box"].includes(spec.type) && <label className="block text-ink-muted">Aggregation<select className={`${sel} mt-0.5 w-full`} value={spec.agg} onChange={(e) => set({ agg: e.target.value as Agg })}>{AGGS.map((d) => <option key={d}>{d}</option>)}</select></label>}
        {spec.type === "histogram" && <label className="block text-ink-muted">Bins ({spec.bins})<input type="range" min={3} max={20} value={spec.bins} onChange={(e) => set({ bins: Number(e.target.value) })} className="w-full" /></label>}
        {(spec.type === "bar" || spec.type === "line" || spec.type === "timeseries") && <label className="flex items-center gap-1 text-ink-muted"><input type="checkbox" checked={spec.zeroBaseline} onChange={(e) => set({ zeroBaseline: e.target.checked })} /> Start the axis at zero</label>}
        <div><p className="font-semibold text-ink-muted">Filters</p>
          {(["region", "category", "channel"] as Dim[]).map((d) => <div key={d} className="mt-1"><span className="text-ink-faint">{d}:</span> {dimValues(d).map((v) => <label key={v} className="mr-2 inline-flex items-center gap-0.5 text-ink-muted"><input type="checkbox" checked={spec.filter[d]?.includes(v) ?? false} onChange={() => toggleFilter(d, v)} />{v}</label>)}</div>)}
          <p className="mt-1 text-ink-faint">No box ticked in a row means all values.</p></div>
      </fieldset>
      <div className="min-w-0 space-y-3">
        <div className="rounded-lg border border-surface-border p-2" style={{ minHeight: 260 }} aria-label="Chart">
          {model.rowCount === 0 ? <p className="p-4 text-sm text-ink-muted">The filters leave no rows.</p> : (
            <div className="h-64 w-full">
              {(spec.type === "bar" || spec.type === "histogram") && (
                <ResponsiveContainer><BarChart data={spec.type === "bar" ? pts : (model.bins ?? []).map((b) => ({ label: `${b.from}–${b.to}`, value: b.count }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis domain={spec.type === "bar" ? range : [0, "auto"]} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="value" fill="#6366f1" /></BarChart></ResponsiveContainer>)}
              {(spec.type === "line" || spec.type === "timeseries") && (
                <ResponsiveContainer><LineChart data={pts}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis domain={range} tick={{ fontSize: 10 }} /><Tooltip /><Line dataKey="value" stroke="#6366f1" dot /></LineChart></ResponsiveContainer>)}
              {spec.type === "pie" && (
                <ResponsiveContainer><PieChart><Pie data={pts} dataKey="value" nameKey="label" outerRadius={90} label>{pts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>)}
              {spec.type === "scatter" && (
                <ResponsiveContainer><ScatterChart><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey="x" name={spec.measure} tick={{ fontSize: 10 }} /><YAxis type="number" dataKey="y" name={spec.measure2} tick={{ fontSize: 10 }} /><Tooltip /><Scatter data={model.scatter} fill="#6366f1" /></ScatterChart></ResponsiveContainer>)}
              {spec.type === "box" && model.box && <BoxPlot stats={model.box} />}
              {spec.type === "heatmap" && model.grid && <Heat grid={model.grid} />}
            </div>
          )}
        </div>
        <ul className="space-y-1 text-sm" aria-label="Chart advice">{advice.map((a) => <li key={a.text} className={`rounded-lg border px-2 py-1 ${a.level === "warn" ? "border-warn/50 bg-warn-dim" : "border-success/40 bg-success-dim"}`}><span className="font-semibold">{a.level === "warn" ? "Careful: " : "Fits: "}</span>{a.text}</li>)}</ul>
        <p className="text-xs text-ink-faint">{model.rowCount} of 144 fixture rows after filtering. The data is a fixed sample, generated by a formula.</p>
        {pts.length > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold text-ink">Data behind the chart</summary>
          <table className="mt-1 text-left"><thead><tr><th className="pr-4">{spec.type === "timeseries" ? "month" : spec.dim}</th><th className="pr-4">{spec.agg} of {spec.measure}</th><th>rows</th></tr></thead><tbody>{pts.map((p) => <tr key={p.label}><td className="pr-4">{p.label}</td><td className="pr-4 tabular-nums">{p.value}</td><td className="tabular-nums">{p.n}</td></tr>)}</tbody></table></details>}
      </div>
    </section>
  );
}
