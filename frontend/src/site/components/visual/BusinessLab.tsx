import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { useReducedMotion } from "../../lib/visual/motion";
import * as B from "../../lib/visual/business";

const card = "rounded-xl border border-surface-border bg-surface-raised p-3";
const sel = "rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs text-ink";
const chip = (on: boolean) => `rounded-lg border px-2 py-1 text-xs font-medium ${on ? "border-accent bg-accent/10 text-ink" : "border-surface-border text-ink-muted hover:text-ink"}`;
const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const money2 = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(d)}%`);
const signed = (v: number, fmt: (x: number) => string) => `${v >= 0 ? "+" : "-"}${fmt(Math.abs(v))}`;
const COLORS = { up: "#14b8a6", down: "#ef4444", total: "#6366f1" };

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="block text-xs text-ink-muted">
      <span className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums text-ink">{fmt ? fmt(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={`${label} ${fmt ? fmt(value) : value}`} className="w-full accent-[var(--color-accent,#6366f1)]" />
    </label>
  );
}
const TextEq = ({ children, title = "Numbers behind the chart" }: { children: ReactNode; title?: string }) => <details className="text-xs text-ink-muted"><summary className="cursor-pointer font-semibold text-ink">{title}</summary><div className="mt-1 space-y-1">{children}</div></details>;

/** Recharts needs a sized parent; the wrapper also carries the text equivalent as its accessible name. */
function Chart({ label, h = 220, children }: { label: string; h?: number; children: ReactNode }) {
  return <div role="img" aria-label={label} style={{ height: h }} className="w-full">{<ResponsiveContainer width="100%" height="100%">{children as never}</ResponsiveContainer>}</div>;
}

// ---------------------------------------------------------------------------------------------------------------------
// KPI dashboard and metric tree
// ---------------------------------------------------------------------------------------------------------------------

const KPI_LABEL: Record<string, string> = { revenue: "Revenue", orders: "Orders", aov: "Average order value", grossMargin: "Gross margin", conversion: "Conversion", visitors: "Visitors", grossProfit: "Gross profit" };
const KPI_FMT: Record<string, (v: number) => string> = { revenue: money, orders: (v) => String(Math.round(v)), aov: money2, grossMargin: (v) => pct(v), conversion: (v) => pct(v, 2), visitors: (v) => Math.round(v).toLocaleString("en-US"), grossProfit: money };

function TreeView({ node, depth = 0 }: { node: B.TreeNode; depth?: number }) {
  const fmt = KPI_FMT[{ gp: "grossProfit", rev: "revenue", vis: "visitors", conv: "conversion", aov: "aov", gm: "grossMargin" }[node.id]!];
  return (
    <li className="space-y-1">
      <div className="rounded-lg border border-surface-border bg-surface-soft px-2 py-1 text-sm"><span className="font-semibold text-ink">{node.label}</span> <span className="tabular-nums text-ink">{fmt(node.value)}</span>{node.formula && <span className="block text-xs text-ink-muted">= {node.formula}</span>}</div>
      {node.children && <ul className="ml-3 space-y-1 border-l border-surface-border pl-2" style={{ marginLeft: depth ? 8 : 12 }}>{node.children.map((c) => <TreeView key={c.id} node={c} depth={depth + 1} />)}</ul>}
    </li>
  );
}

function KpiSection({ mode }: { mode?: string }) {
  const [kind, setKind] = useState<B.PeriodKind>("quarter"), [index, setIndex] = useState(3);
  const [channel, setChannel] = useState(""), [region, setRegion] = useState("");
  const f: B.Filter = { channel: (channel || undefined) as B.Filter["channel"], region: (region || undefined) as B.Filter["region"] };
  const cmp = useMemo(() => B.kpiComparison(kind, index, f), [kind, index, channel, region]); // eslint-disable-line react-hooks/exhaustive-deps
  const tree = useMemo(() => B.metricTree(cmp.current), [cmp]);
  const drivers = cmp.previous ? B.revenueDrivers(cmp.previous, cmp.current) : null;
  const trend = useMemo(() => Array.from({ length: 12 }, (_, m) => ({ month: B.MONTH_NAMES[m], revenue: Math.round(B.kpis([m], f).revenue) })), [channel, region]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = kind === "month" ? 12 : 4;
  const where = [channel || "all channels", region || "all regions"].join(", ");
  return (
    <VisualShell
      left={<div className="space-y-3">
        <fieldset className={`${card} space-y-2`}><legend className="px-1 text-sm font-semibold text-ink">Filters</legend>
          <label className="block text-xs text-ink-muted">Period type<select value={kind} onChange={(e) => { setKind(e.target.value as B.PeriodKind); setIndex(e.target.value === "month" ? 11 : 3); }} className={`${sel} mt-0.5 w-full`}><option value="quarter">Quarter</option><option value="month">Month</option></select></label>
          <label className="block text-xs text-ink-muted">Period<select value={index} onChange={(e) => setIndex(Number(e.target.value))} className={`${sel} mt-0.5 w-full`}>{Array.from({ length: max }, (_, i) => <option key={i} value={i}>{B.periodLabel(kind, i)}</option>)}</select></label>
          <label className="block text-xs text-ink-muted">Channel<select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${sel} mt-0.5 w-full`}><option value="">All channels</option>{B.CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="block text-xs text-ink-muted">Region<select value={region} onChange={(e) => setRegion(e.target.value)} className={`${sel} mt-0.5 w-full`}><option value="">All regions</option>{B.REGIONS.map((c) => <option key={c}>{c}</option>)}</select></label>
        </fieldset>
        <div className={card}>
          <div className="mb-1 flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">Metric tree</h3><ProvenanceBadge p="executed" /></div>
          <p className="mb-1 text-xs text-ink-muted">Each parent is the product of its children (a143). {mode === "tree" ? "Try the filters: the identity holds for every slice." : ""}</p>
          <ul><TreeView node={tree} /></ul>
          <p className="mt-1 text-xs text-ink-muted" role="status">Check: visitors x conversion x AOV = {money2(tree.children![0].children![0].value * tree.children![0].children![1].value * tree.children![0].children![2].value)}, revenue = {money2(tree.children![0].value)}; difference {B.treeError(tree).toFixed(6)}.</p>
        </div>
      </div>}
      right={<div className="space-y-3">
        <div className={card}>
          <div className="mb-2 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">KPIs for {B.periodLabel(kind, index)} ({where})</h3><ProvenanceBadge p="executed" /></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="list" aria-label="KPI tiles">
            {cmp.changes.filter((c) => ["revenue", "orders", "aov", "grossMargin", "conversion", "grossProfit"].includes(c.key)).map((c) => {
              const isRate = c.key === "grossMargin" || c.key === "conversion";
              return <div key={c.key} role="listitem" className="rounded-lg border border-surface-border p-2"><p className="text-xs text-ink-muted">{KPI_LABEL[c.key]}</p><p className="text-lg font-semibold tabular-nums text-ink">{KPI_FMT[c.key](c.current)}</p>
                <p className="text-xs text-ink-muted">{c.change === null ? "no earlier period" : isRate ? `${c.change >= 0 ? "up" : "down"} ${Math.abs(c.change * 100).toFixed(2)} points` : `${c.change >= 0 ? "up" : "down"} ${pct(Math.abs(c.pct ?? 0))} (${signed(c.change, KPI_FMT[c.key])})`} {c.change !== null && `vs ${B.periodLabel(kind, index - 1)}`}</p></div>;
            })}
          </div>
          <p className="mt-2 text-xs text-ink-faint">Fixed sample business: 150 customers and {B.ORDERS.length} orders generated with a fixed seed. Not real data. Visitors are an input fixture.</p>
        </div>
        {drivers && cmp.previous && <div className={card}>
          <h3 className="mb-1 text-sm font-semibold text-ink">What drove the revenue change?</h3>
          <table className="w-full text-sm tabular-nums" aria-label="Revenue change drivers"><tbody>
            <tr><th className="text-left font-normal text-ink-muted">Visitors ({signed(cmp.current.visitors - cmp.previous.visitors, (v) => Math.round(v).toLocaleString("en-US"))})</th><td>{signed(drivers.visitors, money)}</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">Conversion ({signed((cmp.current.conversion - cmp.previous.conversion) * 100, (v) => v.toFixed(2))} pts)</th><td>{signed(drivers.conversion, money)}</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">Average order value ({signed(cmp.current.aov - cmp.previous.aov, money2)})</th><td>{signed(drivers.aov, money)}</td></tr>
            <tr className="font-semibold"><th className="text-left">Sum of effects</th><td>{signed(drivers.visitors + drivers.conversion + drivers.aov, money)}</td></tr>
            <tr className="font-semibold"><th className="text-left">Actual revenue change</th><td>{signed(drivers.total, money)}</td></tr></tbody></table>
          <p className="text-xs text-ink-muted" role="status">The three effects reconcile to the change (difference {Math.abs(drivers.visitors + drivers.conversion + drivers.aov - drivers.total).toFixed(6)}). They use sequential substitution, so the split depends on the order; the total does not.</p>
        </div>}
        <div className={card}>
          <h3 className="mb-1 text-sm font-semibold text-ink">Revenue by month</h3>
          <Chart label={`Monthly revenue, ${where}: ${trend.map((t) => `${t.month} ${money(t.revenue)}`).join(", ")}`} h={180}>
            <LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={48} /><Tooltip /><Line dataKey="revenue" stroke="#6366f1" dot isAnimationActive={false} /></LineChart>
          </Chart>
        </div>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Variance: waterfall
// ---------------------------------------------------------------------------------------------------------------------

function WaterfallChart({ bars, shown, label }: { bars: B.WaterfallBar[]; shown: number; label: string }) {
  const data = bars.map((b, i) => ({ label: b.label, base: i >= shown ? 0 : b.kind === "total" ? 0 : Math.min(b.start, b.end), amount: i >= shown ? 0 : b.kind === "total" ? b.value : Math.abs(b.value), kind: b.kind }));
  return (
    <Chart label={label} h={240}>
      <BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} /><YAxis tick={{ fontSize: 10 }} width={50} />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} /><Bar dataKey="amount" stackId="w" isAnimationActive={false}>{data.map((d, i) => <Cell key={i} fill={COLORS[d.kind]} />)}</Bar></BarChart>
    </Chart>
  );
}

function VarianceSection({ mode }: { mode?: string }) {
  const [view, setView] = useState(mode === "period" ? "period" : "budget"), [q, setQ] = useState(3), [target, setTarget] = useState<"revenue" | "profit">("revenue");
  const months = B.periodMonths("quarter", q);
  const actual = useMemo(() => B.actualLines(months), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const qq = view === "period" && q === 0 ? 1 : q;
  const base = useMemo(() => (view === "budget" ? B.BUDGET[qq] : B.actualLines(B.periodMonths("quarter", qq - 1))), [view, qq]);
  const act = view === "period" && q === 0 ? B.actualLines(B.periodMonths("quarter", 1)) : actual;
  const pvm = useMemo(() => B.priceVolumeMix(base, act), [base, act]);
  const effects: [string, number][] = target === "revenue" ? [["Price", pvm.revenue.price], ["Volume", pvm.revenue.volume], ["Mix", pvm.revenue.mix]] : [["Price", pvm.profit.price], ["Volume", pvm.profit.volume], ["Mix", pvm.profit.mix], ["Cost", pvm.profit.cost]];
  const start = target === "revenue" ? pvm.base.revenue : pvm.base.grossProfit, end = target === "revenue" ? pvm.actual.revenue : pvm.actual.grossProfit;
  const bars = useMemo(() => B.waterfall(view === "budget" ? "Budget" : `Q${qq}`, start, effects, view === "budget" ? "Actual" : `Q${qq + 1}`), [start, view, qq, target, pvm]); // eslint-disable-line react-hooks/exhaustive-deps
  const pb = usePlayback(bars.length);
  const total = target === "revenue" ? pvm.revenue.total : pvm.profit.total, resid = target === "revenue" ? pvm.revenue.check : pvm.profit.check;
  const notes: Record<string, string> = {
    Price: "Same units sold at a different price: sum of Q1 x (P1 - P0). A price effect says customers accepted a higher price, or a discount was given.",
    Volume: "The change in total units, valued at the base average price: (Qtotal1 - Qtotal0) x average P0. It says demand grew or shrank.",
    Mix: "The rest of the unit change, caused by the proportions between products changing. It says customers traded up or down.",
    Cost: "Unit cost versus the base cost on the units sold: sum of Q1 x (C0 - C1). Positive means costs came in lower.",
  };
  const cur = bars[pb.index], line = target === "revenue";
  const baseName = view === "budget" ? "budget" : `Q${qq}`;
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Variance analysis</h3><ProvenanceBadge p="executed" /><span className="text-xs text-ink-faint">fixed sample business and a fixed budget table</span></div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Comparison">{[["budget", "Budget vs actual"], ["period", "Quarter vs previous quarter"]].map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} className={chip(view === k)} onClick={() => setView(k)}>{l}</button>)}</div>
        <label className="block text-xs text-ink-muted">Quarter (actual)<select value={view === "period" && q === 0 ? 1 : q} onChange={(e) => setQ(Number(e.target.value))} className={`${sel} mt-0.5 w-full`}>{[0, 1, 2, 3].filter((i) => view === "budget" || i > 0).map((i) => <option key={i} value={i}>Q{i + 1} 2025</option>)}</select></label>
        <div className="flex gap-1" role="group" aria-label="Measure">{[["revenue", "Revenue"], ["profit", "Gross profit"]].map(([k, l]) => <button key={k} type="button" aria-pressed={target === k} className={chip(target === k)} onClick={() => setTarget(k as "revenue" | "profit")}>{l}</button>)}</div>
        <div role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">
          {pb.index === 0 && <p>{cur.label} {line ? "revenue" : "gross profit"}: <strong>{money(cur.value)}</strong>. Step through to see what moved it.</p>}
          {pb.index > 0 && pb.index < bars.length - 1 && <><p><strong>{cur.label} effect: {signed(cur.value, money)}</strong> ({cur.value >= 0 ? "favourable" : "unfavourable"}). Running total {money(cur.end)}.</p><p className="text-xs text-ink-muted">{notes[cur.label]}</p></>}
          {pb.index === bars.length - 1 && <p>{cur.label}: <strong>{money(cur.value)}</strong>. Start {money(start)} + effects {signed(B_sum(effects), money)} = {money(end)}. Total variance {signed(total, money)} ({pct(start ? total / start : null)} versus {baseName}). Unexplained remainder: {Math.abs(resid).toFixed(6)}.</p>}
        </div>
        <PlaybackBar pb={pb} labels={bars.map((b) => b.label)} />
        <p className="text-xs text-ink-muted">Favourable means the variance raises profit: revenue above budget, or costs below budget. A positive variance on a cost line is unfavourable (a151). A variance says "different from plan", not good or bad by itself.</p>
      </div>}
      right={<div className="space-y-3">
        <div className={card}>
          <WaterfallChart bars={bars} shown={pb.index + 1} label={`Waterfall from ${bars[0].label} ${money(start)} to ${bars[bars.length - 1].label} ${money(end)}: ${effects.map(([l, v]) => `${l} ${signed(v, money)}`).join(", ")}.`} />
          <p className="text-xs text-ink-faint">Blue: totals. Teal: increases. Red: decreases. The last bar equals the first bar plus every effect.</p>
        </div>
        <div className={card}>
          <table className="w-full text-xs tabular-nums" aria-label="Product lines"><caption className="pb-1 text-left text-sm font-semibold text-ink">By product: {baseName} versus actual</caption>
            <thead><tr className="text-left text-ink-muted"><th>Product</th><th>Units</th><th>Price</th><th>Units</th><th>Price</th><th>Price effect</th></tr></thead>
            <tbody>{pvm.byProduct.map((p) => { const b = base.find((x) => x.product === p.product)!, a = act.find((x) => x.product === p.product)!; return <tr key={p.product}><th className="text-left font-normal">{p.product}</th><td>{b.qty}</td><td>{money2(b.price)}</td><td>{a.qty}</td><td>{money2(a.price)}</td><td>{signed(p.priceEffect, money)}</td></tr>; })}</tbody></table>
          <TextEq title="Effects as text"><ul className="list-disc pl-4">{effects.map(([l, v]) => <li key={l}>{l}: {signed(v, money)}</li>)}</ul><p>Revenue: {money(pvm.base.revenue)} to {money(pvm.actual.revenue)} (change {signed(pvm.revenue.total, money)}; price + volume + mix = {signed(pvm.revenue.price + pvm.revenue.volume + pvm.revenue.mix, money)}).</p><p>Gross profit: {money(pvm.base.grossProfit)} to {money(pvm.actual.grossProfit)} (change {signed(pvm.profit.total, money)}; price + volume + mix + cost = {signed(pvm.profit.price + pvm.profit.volume + pvm.profit.mix + pvm.profit.cost, money)}).</p></TextEq>
        </div>
      </div>}
      bottom={null}
    />
  );
}
const B_sum = (e: [string, number][]) => e.reduce((a, [, v]) => a + v, 0);

// ---------------------------------------------------------------------------------------------------------------------
// Cohorts
// ---------------------------------------------------------------------------------------------------------------------

function CohortSection() {
  const rows = useMemo(() => B.cohortTable(), []), curve = useMemo(() => B.retentionByAge(rows), [rows]);
  const [cell, setCell] = useState<[number, number]>([0, 2]);
  const det = B.cohortCell(cell[0], cell[1]);
  const pb = usePlayback(4);
  const steps = [
    `A customer's cohort is the month of their first order. The ${B.MONTH_NAMES[cell[0]]} cohort has ${det.members.length} customers.`,
    `Members: ${det.members.join(", ")}.`,
    det.rate === null ? det.label : `Month ${cell[1]} is ${B.MONTH_NAMES[cell[0] + cell[1]]}. ${det.returned.length} of them placed an order that month: ${det.returned.join(", ") || "none"}.`,
    det.rate === null ? "Cells after the end of the data are blank: those customers have not had time to return." : `Retention = ${det.returned.length} / ${det.members.length} = ${pct(det.rate)}.`,
  ];
  return (
    <VisualShell
      left={<div className="space-y-3">
        <div className={card}>
          <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Cohort retention (share of the cohort ordering again)</h3><ProvenanceBadge p="executed" /></div>
          <p className="mb-1 text-xs text-ink-muted">Fixed sample business. Rows: first-order month. Columns: months since the first order. Select a cell to see how it is computed.</p>
          <div className="overflow-x-auto">
            <table className="border-collapse text-[11px] tabular-nums" aria-label="Cohort retention heatmap"><thead><tr><th className="p-1 text-left text-ink-muted">Cohort</th><th className="p-1 text-ink-muted">Size</th>{Array.from({ length: 12 }, (_, k) => <th key={k} className="p-1 text-ink-muted">M{k}</th>)}</tr></thead>
              <tbody>{rows.map((r) => <tr key={r.cohort}><th className="p-1 text-left font-normal text-ink-muted">{B.MONTH_NAMES[r.cohort]}</th><td className="p-1 text-center">{r.size}</td>
                {r.rates.map((v, k) => <td key={k} className="p-0">{v === null ? <span className="block h-7 w-9" aria-label="not yet observable" /> : <button type="button" aria-label={`${B.MONTH_NAMES[r.cohort]} cohort month ${k}: ${r.active[k]} of ${r.size}, ${pct(v)}`} aria-pressed={cell[0] === r.cohort && cell[1] === k} onClick={() => setCell([r.cohort, k])} className={`block h-7 w-9 border text-center ${cell[0] === r.cohort && cell[1] === k ? "border-accent outline outline-2" : "border-surface-bg"} text-ink`} style={{ background: `rgba(99,102,241,${0.08 + 0.8 * v})` }}>{Math.round(v * 100)}</button>}</td>)}</tr>)}</tbody></table>
          </div>
          <p className="mt-1 text-xs text-ink-faint">Cells show percent. Darker means more of the cohort came back. Blank cells are in the future of the data.</p>
        </div>
      </div>}
      right={<div className="space-y-3">
        <div className={`${card} space-y-2`}>
          <h3 className="text-sm font-semibold text-ink">How one cell is computed</h3>
          <p className="text-xs text-ink-muted">{det.label}</p>
          <div role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">{steps[pb.index]}</div>
          <PlaybackBar pb={pb} labels={["Define the cohort", "List the members", "Count who returned", "Divide"]} />
        </div>
        <div className={card}>
          <h3 className="mb-1 text-sm font-semibold text-ink">Average retention by age</h3>
          <Chart label={`Retention by months since first order: ${curve.map((c) => `month ${c.age} ${pct(c.rate)} (${c.eligible} customers observable)`).join("; ")}`} h={170}>
            <LineChart data={curve.map((c) => ({ age: `M${c.age}`, retention: Math.round(c.rate * 1000) / 10 }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="age" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={36} unit="%" /><Tooltip /><Line dataKey="retention" stroke="#6366f1" dot isAnimationActive={false} /></LineChart>
          </Chart>
          <TextEq><table className="tabular-nums"><thead><tr><th className="pr-3 text-left">age</th><th className="pr-3 text-left">retention</th><th className="text-left">customers observable</th></tr></thead><tbody>{curve.map((c) => <tr key={c.age}><td className="pr-3">M{c.age}</td><td className="pr-3">{pct(c.rate)}</td><td>{c.eligible}</td></tr>)}</tbody></table><p>Recent cohorts are left out of later points because they have not reached that age yet. Without this the curve would fall for the wrong reason.</p></TextEq>
        </div>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------------------------------------------------

function FunnelSection() {
  const [span, setSpan] = useState("year"), [channel, setChannel] = useState("");
  const months = span === "year" ? Array.from({ length: 12 }, (_, i) => i) : B.periodMonths("quarter", Number(span));
  const f: B.Filter = { channel: (channel || undefined) as B.Filter["channel"] };
  const counts = useMemo(() => B.funnelCounts(months, f), [span, channel]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = B.funnelSteps(counts), k = B.kpis(months, f);
  const pb = usePlayback(steps.length), s = steps[pb.index];
  const [wi, setWi] = useState(2), [rate, setRate] = useState<number | null>(null);
  const base = steps[wi].stepRate ?? 1, nr = rate ?? base;
  useEffect(() => setRate(null), [wi, span, channel]);
  const what = B.funnelWhatIf(counts, wi, nr, k.aov);
  const worst = steps.slice(1).reduce((a, b) => (b.stepRate! < a.stepRate! ? b : a));
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Funnel</h3><ProvenanceBadge p="executed" /><span className="text-xs text-ink-faint">visits and purchases from the sample business; middle steps from fixture rates</span></div>
        <label className="block text-xs text-ink-muted">Period<select value={span} onChange={(e) => setSpan(e.target.value)} className={`${sel} mt-0.5 w-full`}><option value="year">Whole year</option>{[0, 1, 2, 3].map((q) => <option key={q} value={q}>Q{q + 1}</option>)}</select></label>
        <label className="block text-xs text-ink-muted">Channel<select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${sel} mt-0.5 w-full`}><option value="">All channels</option>{B.CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <div role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">{s.stepRate === null ? <p><strong>{s.count.toLocaleString("en-US")}</strong> visits: the top of the funnel, 100%.</p> : <p><strong>{s.name}</strong>: {s.count.toLocaleString("en-US")}. Of {steps[pb.index - 1].count.toLocaleString("en-US")} at the previous step, {pct(s.stepRate)} continued (step conversion) and {s.dropped!.toLocaleString("en-US")} ({pct(s.dropRate)}) dropped off. {pct(s.cumulative, 2)} of all visits reached this step.</p>}</div>
        <PlaybackBar pb={pb} labels={steps.map((x) => x.name)} />
        <p className="text-xs text-ink-muted">Biggest drop-off: <strong>{worst.name}</strong> (only {pct(worst.stepRate)} continue). The lowest step rate is a candidate bottleneck, not proof of one: check volume and cost of fixing it first.</p>
      </div>}
      right={<div className="space-y-3">
        <div className={card}>
          <div className="space-y-1" role="list" aria-label="Funnel steps">{steps.map((x, i) => <div key={x.name} role="listitem" className={i === pb.index ? "rounded outline outline-2 outline-accent" : ""}><div className="flex justify-between text-xs text-ink-muted"><span>{x.name}</span><span className="tabular-nums">{x.count.toLocaleString("en-US")}{x.stepRate !== null && ` (${pct(x.stepRate)} of previous)`}</span></div><div className="h-5 rounded bg-surface-soft"><div className="h-5 rounded bg-accent" style={{ width: `${Math.max(1, x.cumulative * 100)}%` }} /></div></div>)}</div>
          <p className="mt-2 text-sm text-ink tabular-nums" role="status">Step rates {steps.slice(1).map((x) => pct(x.stepRate)).join(" x ")} = overall conversion {pct(steps[4].cumulative, 2)}. Orders / visitors from the KPI view: {pct(k.conversion, 2)}.</p>
        </div>
        <div className={`${card} space-y-2`}>
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">What if one step improved?</h3><ProvenanceBadge p="simulated" /></div>
          <p className="text-xs text-ink-muted">A scenario, not a forecast: the other step rates stay as they are and the average order value is held at {money2(k.aov)}.</p>
          <label className="block text-xs text-ink-muted">Step to change<select value={wi} onChange={(e) => setWi(Number(e.target.value))} className={`${sel} mt-0.5 w-full`}>{steps.slice(1).map((x, i) => <option key={x.name} value={i + 1}>{steps[i].name} to {x.name} (now {pct(x.stepRate)})</option>)}</select></label>
          <Slider label="New step conversion" value={Math.round(nr * 1000) / 1000} min={0.01} max={1} step={0.005} onChange={setRate} fmt={(v) => pct(v)} />
          <p role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">Purchases change from {steps[4].count} to {what.purchases.toFixed(1)} ({signed(what.deltaOrders, (v) => v.toFixed(1))}), overall conversion from {pct(steps[4].cumulative, 2)} to {pct(what.overall, 2)}, revenue {signed(what.deltaRevenue, money)} on this period's traffic.</p>
        </div>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// RFM
// ---------------------------------------------------------------------------------------------------------------------

function RfmSection() {
  const { rows, thresholds } = useMemo(() => B.rfm(), []), seg = useMemo(() => B.segmentSummary(rows), [rows]);
  const [pick, setPick] = useState("");
  const shown = rows.filter((r) => !pick || r.segment === pick).slice(0, 12);
  return (
    <VisualShell
      left={<div className="space-y-3">
        <div className={`${card} space-y-2`}>
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">RFM scores and thresholds</h3><ProvenanceBadge p="executed" /></div>
          <p className="text-xs text-ink-muted">As of day {B.AS_OF_DAY} (the day after the data ends). Recency = days since the last order, frequency = number of orders, monetary = total revenue, one row per customer (a145). Scores are relative to these {rows.length} customers; 4 is always best.</p>
          <table className="w-full text-xs tabular-nums" aria-label="Scoring thresholds"><thead><tr className="text-left text-ink-muted"><th>Score</th><th>Recency (days)</th><th>Frequency</th><th>Monetary</th></tr></thead>
            <tbody>{[4, 3, 2, 1].map((sc) => { const r = thresholds.find((t) => t.measure === "R" && t.score === sc)!, m = thresholds.find((t) => t.measure === "M" && t.score === sc)!; return <tr key={sc}><th className="text-left font-normal">{sc}</th><td>{r.min} to {r.max} ({r.count} customers)</td><td>{B.FREQ_THRESHOLDS[sc - 1].text}</td><td>{money(m.min)} to {money(m.max)} ({m.count})</td></tr>; })}</tbody></table>
          <p className="text-xs text-ink-muted">Recency and monetary use quartiles by rank (SQL NTILE(4) with the customer id as tie-break; for recency the order is reversed so that 4 means most recent). Frequency uses explicit thresholds because most customers have one or two orders.</p>
        </div>
        <div className={card}>
          <h3 className="mb-1 text-sm font-semibold text-ink">Segment rules (first match wins)</h3>
          <ol className="list-decimal space-y-0.5 pl-4 text-xs text-ink-muted">{B.SEGMENT_RULES.map((r) => <li key={r.name}><strong className="text-ink">{r.name}</strong>: {r.text}</li>)}</ol>
          <p className="mt-1 text-xs text-ink-faint">Segment names are labels, not facts about people. A customer moves between segments as time passes.</p>
        </div>
      </div>}
      right={<div className="space-y-3">
        <div className={card}>
          <table className="w-full text-xs tabular-nums" aria-label="Segment summary"><thead><tr className="text-left text-ink-muted"><th>Segment</th><th>Customers</th><th>Revenue</th><th>Share</th><th>AOV</th></tr></thead>
            <tbody>{seg.map((s) => <tr key={s.segment} className={pick === s.segment ? "bg-accent/10" : ""}><th className="text-left font-normal"><button type="button" aria-pressed={pick === s.segment} className="underline decoration-dotted" onClick={() => setPick(pick === s.segment ? "" : s.segment)}>{s.segment}</button></th><td>{s.customers}</td><td>{money(s.revenue)}</td><td>{pct(s.share)}</td><td>{money2(s.aov)}</td></tr>)}
              <tr className="font-semibold"><th className="text-left">Total</th><td>{seg.reduce((a, s) => a + s.customers, 0)}</td><td>{money(seg.reduce((a, s) => a + s.revenue, 0))}</td><td>{pct(seg.reduce((a, s) => a + s.share, 0))}</td><td /></tr></tbody></table>
          <div className="mt-2 flex h-5 overflow-hidden rounded" role="img" aria-label={`Share of revenue by segment: ${seg.map((s) => `${s.segment} ${pct(s.share)}`).join(", ")}`}>{seg.map((s, i) => <div key={s.segment} title={s.segment} style={{ width: `${s.share * 100}%`, background: ["#6366f1", "#14b8a6", "#f59e0b", "#0ea5e9", "#ef4444"][i % 5] }} />)}</div>
          <p className="mt-1 text-xs text-ink-muted" role="status">{seg[0].customers} champions ({pct(seg[0].customers / rows.length)} of customers) bring {pct(seg[0].share)} of revenue: a small group carries much of the money.{pick ? ` Showing ${pick} customers below.` : " Select a segment name to list its customers."}</p>
        </div>
        <div className={card}>
          <table className="w-full text-xs tabular-nums" aria-label="Customer scores"><thead><tr className="text-left text-ink-muted"><th>Customer</th><th>R days</th><th>F</th><th>M</th><th>Scores R F M</th><th>Segment</th></tr></thead>
            <tbody>{shown.map((r) => <tr key={r.customer}><th className="text-left font-normal">{r.customer}</th><td>{r.recencyDays}</td><td>{r.frequency}</td><td>{money(r.monetary)}</td><td>{r.r} {r.f} {r.m}</td><td>{r.segment}</td></tr>)}</tbody></table>
          <p className="text-xs text-ink-faint">First {shown.length} customers{pick ? ` in ${pick}` : ""}.</p>
        </div>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Churn and lifetime value
// ---------------------------------------------------------------------------------------------------------------------

function ChurnSection() {
  const table = useMemo(() => B.churnTable(), []), surv = useMemo(() => B.survivalByAge(), []);
  const [cac, setCac] = useState(60);
  const ltv = B.lifetimeValue(B.SUBS, cac);
  const lost = table.reduce((a, r) => a + r.lost, 0), risk = table.reduce((a, r) => a + r.atRisk, 0);
  return (
    <VisualShell
      left={<div className="space-y-3">
        <div className={card}>
          <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Monthly churn</h3><ProvenanceBadge p="executed" /><span className="text-xs text-ink-faint">fixed sample: 240 subscribers at ${B.SUB_PRICE} a month</span></div>
          <table className="w-full text-xs tabular-nums" aria-label="Churn by month"><thead><tr className="text-left text-ink-muted"><th>Month</th><th>Active</th><th>Started</th><th>Lost</th><th>At risk</th><th>Churn</th></tr></thead>
            <tbody>{table.map((r) => <tr key={r.month}><th className="text-left font-normal">{B.MONTH_NAMES[r.month]}</th><td>{r.active}</td><td>{r.started}</td><td>{r.lost}</td><td>{r.atRisk || "-"}</td><td>{pct(r.churn)}</td></tr>)}
              <tr className="font-semibold"><th className="text-left">Overall</th><td /><td /><td>{lost}</td><td>{risk}</td><td>{pct(lost / risk, 2)}</td></tr></tbody></table>
          <p className="mt-1 text-xs text-ink-muted" role="status">Churn rate = customers lost / customers at risk (active the month before). Overall churn = {lost} lost / {risk} customer-months at risk = {pct(ltv.churn, 2)}. Check: active this month = active last month + started - lost.</p>
        </div>
        <div className={card}>
          <h3 className="mb-1 text-sm font-semibold text-ink">Still active by customer age</h3>
          <Chart label={`Share of subscribers still active by months since start: ${surv.map((s) => `month ${s.age} ${pct(s.rate)} of ${s.eligible} observable`).join("; ")}`} h={170}>
            <LineChart data={surv.map((s) => ({ age: `M${s.age}`, active: Math.round(s.rate * 1000) / 10 }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="age" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={36} unit="%" domain={[0, 100]} /><Tooltip /><Line dataKey="active" stroke="#6366f1" dot isAnimationActive={false} /></LineChart>
          </Chart>
          <TextEq><p>Only subscribers old enough to be observed at each age count, so later points use fewer subscribers.</p><ul className="list-disc pl-4">{surv.map((s) => <li key={s.age}>Month {s.age}: {s.stillActive} of {s.eligible} still active ({pct(s.rate)}).</li>)}</ul></TextEq>
        </div>
      </div>}
      right={<div className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Lifetime value</h3><ProvenanceBadge p="estimated" /></div>
        <p className="text-xs text-ink-muted">Expected lifetime = 1 / monthly churn is an approximation that assumes churn stays constant. Margin ({pct(B.SUB_GROSS_MARGIN, 0)}) and price are fixture values; customer acquisition cost is an assumption you can change.</p>
        <Slider label="Customer acquisition cost (assumed)" value={cac} min={10} max={300} step={5} onChange={setCac} fmt={money} />
        <table className="w-full text-sm tabular-nums" aria-label="Lifetime value"><tbody>
          <tr><th className="text-left font-normal text-ink-muted">Monthly gross profit per customer</th><td>{money2(ltv.monthlyGrossProfit)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Expected lifetime = 1 / {pct(ltv.churn, 2)}</th><td>{ltv.expectedLifetime.toFixed(1)} months</td></tr>
          <tr className="font-semibold"><th className="text-left">LTV = gross profit x lifetime</th><td>{money2(ltv.ltv)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">LTV to CAC ratio</th><td>{ltv.ltvToCac?.toFixed(2)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Payback on CAC</th><td>{ltv.paybackMonths?.toFixed(1)} months</td></tr></tbody></table>
        <p role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">With CAC {money(cac)}, each customer returns {money2(ltv.ltv)} of gross profit over a modelled {ltv.expectedLifetime.toFixed(1)} months: LTV to CAC {ltv.ltvToCac?.toFixed(2)}. {ltv.ltvToCac! < 1 ? "Acquiring a customer costs more than they return: the channel loses money." : ltv.ltvToCac! < 3 ? "It pays back, but with a thin cushion (3 or more is a common rule of thumb, not a law)." : "A comfortable cushion under these assumptions."}</p>
        <div className="rounded-lg border border-warn/50 bg-warn-dim p-2 text-xs text-ink" role="note"><strong>The lifetime trap.</strong> Averaging the tenure of customers who already churned gives {ltv.naiveTenure.toFixed(1)} months, far below the {ltv.expectedLifetime.toFixed(1)} months from the churn rate, because it ignores everyone still active (a146). Churn also fell with age here, so a blended rate hides that new customers leave faster than old ones.</div>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------------------------------

function Assumptions({ items }: { items: [string, string][] }) {
  return <div className="rounded-lg border border-warn/50 bg-warn-dim p-2 text-xs text-ink" role="note" aria-label="Assumptions"><p className="font-semibold">Assumptions (change them, they are not facts)</p><ul className="mt-0.5 list-disc pl-4">{items.map(([k, v]) => <li key={k}><strong>{k}:</strong> {v}</li>)}</ul></div>;
}
const verdictClass = (v: string) => (v === "adopt" || v === "scale" ? "border-success/40 bg-success-dim" : v === "reject" || v === "stop" ? "border-danger/40 bg-danger-dim" : "border-warn/50 bg-warn-dim");

function DiscountView() {
  const [price, setPrice] = useState(100), [cost, setCost] = useState(70), [units, setUnits] = useState(1000), [d, setD] = useState(0.1), [e, setE] = useState(-1.5), [bor, setBor] = useState(0);
  const inp: B.DiscountInput = { price, cost, units, discount: d, elasticity: e, borrowed: bor };
  const r = B.discountScenario(inp), rec = B.discountRecommendation(inp, r);
  const els = [-0.5, -1, -1.5, -2, -3, -4], ds = [0.05, 0.1, 0.15, 0.2, 0.25];
  const sens = B.discountSensitivity(inp, els, ds);
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Discount decision</h3><ProvenanceBadge p="simulated" /><span className="text-xs text-ink-faint">a model with assumptions, not a forecast</span></div>
        <Slider label="Current price" value={price} min={20} max={500} step={5} onChange={(v) => { setPrice(v); setCost((c) => Math.min(c, v - 1)); }} fmt={money} />
        <Slider label="Unit cost" value={cost} min={5} max={price - 1} step={1} onChange={setCost} fmt={money} />
        <Slider label="Units sold now" value={units} min={100} max={5000} step={100} onChange={setUnits} />
        <Slider label="Discount" value={d} min={0} max={0.4} step={0.01} onChange={setD} fmt={(v) => pct(v, 0)} />
        <Slider label="Price elasticity of demand (assumed)" value={e} min={-4} max={0} step={0.1} onChange={setE} fmt={(v) => v.toFixed(1)} />
        <Slider label="Share of extra units borrowed from the future (assumed)" value={bor} min={0} max={0.8} step={0.05} onChange={setBor} fmt={(v) => pct(v, 0)} />
        <Assumptions items={[["Elasticity", `${e.toFixed(1)}: a 1% price cut raises units by about ${Math.abs(e).toFixed(1)}%. It only holds for the price range tested, for these customers (a149).`], ["Borrowed demand", `${pct(bor, 0)} of the extra units would have been bought later or from another product anyway.`], ["Everything else", "Unit cost, competitor prices and the rest of the market stay the same."]]} />
      </div>}
      right={<div className="space-y-3">
        <div className={card}>
          <table className="w-full text-sm tabular-nums" aria-label="Discount result"><thead><tr className="text-left text-xs text-ink-muted"><th /><th>Now</th><th>With discount</th></tr></thead><tbody>
            <tr><th className="text-left font-normal text-ink-muted">Price</th><td>{money2(price)}</td><td>{money2(r.newPrice)}</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">Units</th><td>{units}</td><td>{r.newUnits.toFixed(0)} ({signed(r.volumeRise, (v) => pct(v))})</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">Revenue</th><td>{money(r.baseRevenue)}</td><td>{money(r.newRevenue)}</td></tr>
            <tr className="font-semibold"><th className="text-left">Gross profit</th><td>{money(r.baseProfit)}</td><td>{money(r.newProfit)} ({signed(r.profitChangePct, (v) => pct(v))})</td></tr></tbody></table>
          <p className="mt-1 text-xs text-ink-muted">Unit margin {pct(r.margin)}. Break-even rule d / (m - d): the volume must rise by {Number.isFinite(r.breakEvenVolumeRise) ? pct(r.breakEvenVolumeRise) : "more than is possible"}; the model gives {pct(r.volumeRise)}. Break-even elasticity: {r.breakEvenElasticity === null ? "none" : r.breakEvenElasticity.toFixed(2)}.</p>
        </div>
        <div role="status" aria-live="polite" className={`rounded-xl border p-3 text-sm text-ink ${verdictClass(rec.verdict)}`}><p className="font-semibold">Recommendation: {rec.verdict}</p><p>{rec.text}</p></div>
        <div className={card}>
          <table className="w-full text-xs tabular-nums" aria-label="Sensitivity of gross profit change to elasticity and discount"><caption className="pb-1 text-left text-sm font-semibold text-ink">Sensitivity: gross profit change</caption>
            <thead><tr className="text-left text-ink-muted"><th>Elasticity</th>{ds.map((x) => <th key={x}>{pct(x, 0)} off</th>)}</tr></thead>
            <tbody>{sens.map((row) => <tr key={row.elasticity}><th className="text-left font-normal">{row.elasticity.toFixed(1)}</th>{row.cells.map((c) => <td key={c.discount} className={c.profitChangePct >= 0 ? "text-success" : "text-danger"}>{signed(c.profitChangePct, (v) => pct(v))}</td>)}</tr>)}</tbody></table>
          <p className="text-xs text-ink-faint">Positive (teal text, with a plus sign) means the discount raises gross profit under that assumption. The sign is always written out, not only coloured.</p>
        </div>
      </div>}
      bottom={null}
    />
  );
}

function CampaignView() {
  const [spend, setSpend] = useState(10000), [reach, setReach] = useState(50000), [treated, setTreated] = useState(0.03), [baseline, setBaseline] = useState(0.02), [aov, setAov] = useState(60), [margin, setMargin] = useState(0.45);
  const inp: B.CampaignInput = { spend, reach, treatedRate: treated, baselineRate: baseline, aov, margin };
  const r = B.campaignScenario(inp), rec = B.campaignRecommendation(inp, r);
  const bs = [0, 0.01, 0.02, 0.025, 0.03].map((b) => Math.min(b, treated)), ms = [0.25, 0.35, 0.45, 0.55];
  const sens = B.campaignSensitivity(inp, bs, ms);
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Campaign ROI and incrementality</h3><ProvenanceBadge p="simulated" /></div>
        <Slider label="Campaign spend" value={spend} min={1000} max={50000} step={500} onChange={setSpend} fmt={money} />
        <Slider label="People reached" value={reach} min={5000} max={200000} step={5000} onChange={setReach} fmt={(v) => v.toLocaleString("en-US")} />
        <Slider label="Conversion in the reached group" value={treated} min={0.005} max={0.1} step={0.0025} onChange={(v) => { setTreated(v); setBaseline((b) => Math.min(b, v)); }} fmt={(v) => pct(v, 2)} />
        <Slider label="Conversion with no campaign (holdout, assumed)" value={baseline} min={0} max={treated} step={0.0025} onChange={setBaseline} fmt={(v) => pct(v, 2)} />
        <Slider label="Average order value" value={aov} min={10} max={300} step={5} onChange={setAov} fmt={money} />
        <Slider label="Gross margin" value={margin} min={0.1} max={0.8} step={0.01} onChange={setMargin} fmt={(v) => pct(v, 0)} />
        <Assumptions items={[["Holdout baseline", `${pct(baseline, 2)} of this audience would have bought without the campaign. This is the number the verdict depends on most.`], ["Order value and margin", `Every order is worth ${money(aov)} at a ${pct(margin, 0)} margin, whether or not the campaign caused it.`], ["One-off", "No effect on later purchases and no overlap with other campaigns."]]} />
      </div>}
      right={<div className="space-y-3">
        <div className={card}>
          <table className="w-full text-sm tabular-nums" aria-label="Campaign result"><thead><tr className="text-left text-xs text-ink-muted"><th /><th>Attributed (all conversions)</th><th>Incremental (above holdout)</th></tr></thead><tbody>
            <tr><th className="text-left font-normal text-ink-muted">Conversions</th><td>{r.attributed.toFixed(0)}</td><td>{r.incremental.toFixed(0)}</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">Revenue</th><td>{money(r.attributedRevenue)}</td><td>{money(r.incrementalRevenue)}</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">ROAS (revenue / spend)</th><td>{r.roasAttributed.toFixed(2)}</td><td>{r.roasIncremental.toFixed(2)}</td></tr>
            <tr className="font-semibold"><th className="text-left">ROI ((revenue x margin - spend) / spend)</th><td>{pct(r.roiAttributed)}</td><td>{pct(r.roiIncremental)}</td></tr></tbody></table>
          <p className="mt-1 text-xs text-ink-muted">CAC on incremental customers: {r.cac === null ? "undefined (no incremental conversions)" : money2(r.cac)}. Break-even incremental conversion rate: {pct(r.breakEvenIncrementalRate, 2)}; this campaign has {pct(treated - baseline, 2)}.</p>
        </div>
        <div role="status" aria-live="polite" className={`rounded-xl border p-3 text-sm text-ink ${verdictClass(rec.verdict)}`}><p className="font-semibold">Recommendation: {rec.verdict === "test" ? "run a holdout test before deciding" : rec.verdict}</p><p>{rec.text}</p></div>
        <div className={card}>
          <table className="w-full text-xs tabular-nums" aria-label="Sensitivity of incremental ROI to the holdout baseline and margin"><caption className="pb-1 text-left text-sm font-semibold text-ink">Sensitivity: incremental ROI</caption>
            <thead><tr className="text-left text-ink-muted"><th>Holdout conversion</th>{ms.map((m) => <th key={m}>Margin {pct(m, 0)}</th>)}</tr></thead>
            <tbody>{sens.map((row) => <tr key={row.baselineRate}><th className="text-left font-normal">{pct(row.baselineRate, 2)}</th>{row.cells.map((c) => <td key={c.margin} className={c.roi >= 0 ? "text-success" : "text-danger"}>{signed(c.roi, (v) => pct(v, 0))}</td>)}</tr>)}</tbody></table>
        </div>
      </div>}
      bottom={null}
    />
  );
}

function DecisionsSection({ mode }: { mode?: string }) {
  const [sub, setSub] = useState(mode === "campaign" ? "campaign" : "discount");
  return <div className="space-y-3"><div className="flex gap-1" role="group" aria-label="Decision">{[["discount", "Pricing and discount"], ["campaign", "Campaign ROI"]].map(([k, l]) => <button key={k} type="button" aria-pressed={sub === k} className={chip(sub === k)} onClick={() => setSub(k)}>{l}</button>)}</div>{sub === "discount" ? <DiscountView /> : <CampaignView />}</div>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------------------------------------------------

function ForecastSection() {
  const [method, setMethod] = useState<B.ForecastMethod>("seasonal-naive"), [window, setWindow] = useState(3);
  const res = useMemo(() => B.forecast(B.SERIES, method, 6, window), [method, window]);
  const bench = useMemo(() => B.forecast(B.SERIES, "naive", 6), []);
  const data = B.SERIES.map((v, i) => ({ month: i < 12 ? B.MONTH_NAMES[i] : `${B.MONTH_NAMES[i - 12]}'`, actual: v, forecast: i >= 18 ? Math.round(res.forecast[i - 18]) : null }));
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Forecast the last 6 months</h3><ProvenanceBadge p="estimated" /><span className="text-xs text-ink-faint">24 months of fixture revenue made by a formula</span></div>
        <label className="block text-xs text-ink-muted">Method<select value={method} onChange={(e) => setMethod(e.target.value as B.ForecastMethod)} className={`${sel} mt-0.5 w-full`}><option value="naive">Naive: repeat the last value</option><option value="moving-average">Moving average</option><option value="seasonal-naive">Seasonal naive: same month last year</option></select></label>
        {method === "moving-average" && <Slider label="Window (months)" value={window} min={2} max={9} step={1} onChange={setWindow} />}
        <p className="text-xs text-ink-muted">Train on months 1 to 18, forecast months 19 to 24 and compare with what happened (a152). A forecast is an estimate: it needs an error measure and a naive benchmark, and should be shown with its error.</p>
        <p role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">{method}: MAE {money(res.mae)}, MAPE {pct(res.mape)}, RMSE {money(res.rmse)}. The naive benchmark has MAE {money(bench.mae)}. {method === "naive" ? "This is the benchmark." : res.mae < bench.mae ? `It beats the benchmark by ${pct(1 - res.mae / bench.mae, 0)} on MAE.` : "It does not beat the naive benchmark, so it adds no value on this series."}</p>
      </div>}
      right={<div className={card}>
        <Chart label={`Monthly revenue for 24 months and the ${method} forecast of the last 6 months. Forecast values: ${res.forecast.map((v, i) => `month ${19 + i} ${money(v)} versus actual ${money(res.actual[i])}`).join("; ")}.`} h={240}>
          <LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 9 }} interval={1} /><YAxis tick={{ fontSize: 10 }} width={48} /><Tooltip /><Line dataKey="actual" stroke="#6366f1" dot={false} isAnimationActive={false} /><Line dataKey="forecast" stroke="#f59e0b" strokeDasharray="4 3" dot isAnimationActive={false} connectNulls /></LineChart>
        </Chart>
        <TextEq title="Forecast and errors"><table className="tabular-nums"><thead><tr><th className="pr-3 text-left">Month</th><th className="pr-3 text-left">Actual</th><th className="pr-3 text-left">Forecast</th><th className="text-left">Error</th></tr></thead><tbody>{res.actual.map((a, i) => <tr key={i}><td className="pr-3">{19 + i}</td><td className="pr-3">{money(a)}</td><td className="pr-3">{money(res.forecast[i])}</td><td>{signed(res.errors[i], money)}</td></tr>)}</tbody></table></TextEq>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Lab shell
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Business Analytics Lab. All figures are computed deterministically from a fixed sample business (not real data); model
 * assumptions in the decision views are inputs the learner can change.
 */
export function BusinessLab({ preset }: { preset?: string }) {
  const start = B.presetById(preset);
  const [tab, setTab] = useState<B.BusinessTab>(start?.tab ?? "kpi");
  const reduced = useReducedMotion();
  useEffect(() => { if (start) setTab(start.tab); }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const mode = start?.mode;
  return (
    <section aria-label="Business Analytics Lab" data-preset={preset} data-reduced-motion={reduced ? "true" : "false"} className="space-y-3">
      <div className={`${card} flex flex-wrap items-center gap-2 text-xs text-ink-muted`}>
        <span className="font-semibold text-ink">Business Analytics Lab</span><ProvenanceBadge p="executed" /><ProvenanceBadge p="simulated" />
        <span>Every figure is computed from a <strong>fixed sample business</strong> (150 customers, {B.ORDERS.length} orders, made with a fixed seed; not real data). Decision views are Simulated: their assumptions, such as price elasticity, are yours to change and are not facts.</span>
      </div>
      <div role="tablist" aria-label="Business analytics topics" className="flex flex-wrap gap-1">
        {B.TABS.map((t) => <button key={t.id} id={`biz-tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls="biz-panel" tabIndex={tab === t.id ? 0 : -1} className={chip(tab === t.id)} onClick={() => setTab(t.id)}
          onKeyDown={(e) => { const i = B.TABS.findIndex((x) => x.id === tab); if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const next = B.TABS[(i + (e.key === "ArrowRight" ? 1 : B.TABS.length - 1)) % B.TABS.length]; setTab(next.id); document.getElementById(`biz-tab-${next.id}`)?.focus(); } }}>{t.label}</button>)}
      </div>
      <div id="biz-panel" role="tabpanel" aria-labelledby={`biz-tab-${tab}`} key={tab}>
        {tab === "kpi" && <KpiSection mode={mode} />}
        {tab === "variance" && <VarianceSection mode={mode} />}
        {tab === "cohort" && <CohortSection />}
        {tab === "funnel" && <FunnelSection />}
        {tab === "rfm" && <RfmSection />}
        {tab === "churn" && <ChurnSection />}
        {tab === "decisions" && <DecisionsSection mode={mode} />}
        {tab === "forecast" && <ForecastSection />}
      </div>
    </section>
  );
}
