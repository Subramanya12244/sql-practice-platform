import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { useReducedMotion } from "../../lib/visual/motion";
import * as S from "../../lib/visual/stats";

const card = "rounded-xl border border-surface-border bg-surface-raised p-3";
const sel = "rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs text-ink";
const num = "w-20 rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs tabular-nums text-ink";
const chip = (on: boolean) => `rounded-lg border px-2 py-1 text-xs font-medium ${on ? "border-accent bg-accent/10 text-ink" : "border-surface-border text-ink-muted hover:text-ink"}`;
const f = (v: number | null | undefined, d = 4) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : String(Math.round(v * 10 ** d) / 10 ** d));
const pf = (p: number) => (p < 0.0001 ? "< 0.0001" : f(p, 4));

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="block text-xs text-ink-muted">
      <span className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums text-ink">{fmt ? fmt(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={`${label} ${fmt ? fmt(value) : value}`} className="w-full accent-[var(--color-accent,#6366f1)]" />
    </label>
  );
}

/** A small SVG plot. `children` draws with the scale functions. The viewBox makes it scale to a 390 px screen without scrolling. */
function Plot({ xd, yd, label, children, h = 200, xLabel, ticks = 5 }: { xd: [number, number]; yd: [number, number]; label: string; children: (sx: (x: number) => number, sy: (y: number) => number) => ReactNode; h?: number; xLabel?: string; ticks?: number }) {
  const W = 520, L = 34, R = 10, T = 8, B = 28;
  const sx = (x: number) => L + ((x - xd[0]) / (xd[1] - xd[0] || 1)) * (W - L - R), sy = (y: number) => T + (1 - (y - yd[0]) / (yd[1] - yd[0] || 1)) * (h - T - B);
  const xt = Array.from({ length: ticks }, (_, i) => xd[0] + ((xd[1] - xd[0]) * i) / (ticks - 1));
  return (
    <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={label} className="w-full text-ink-muted">
      <line x1={L} x2={W - R} y1={sy(yd[0])} y2={sy(yd[0])} stroke="currentColor" opacity={0.5} />
      <line x1={L} x2={L} y1={T} y2={sy(yd[0])} stroke="currentColor" opacity={0.5} />
      {xt.map((x, i) => <g key={i}><line x1={sx(x)} x2={sx(x)} y1={sy(yd[0])} y2={sy(yd[0]) + 4} stroke="currentColor" opacity={0.5} /><text x={sx(x)} y={sy(yd[0]) + 15} textAnchor="middle" fontSize={10} fill="currentColor">{f(x, 2)}</text></g>)}
      {[yd[0], yd[1]].map((y, i) => <text key={i} x={L - 4} y={sy(y) + 3} textAnchor="end" fontSize={10} fill="currentColor">{f(y, 2)}</text>)}
      {xLabel && <text x={(L + W - R) / 2} y={h - 2} textAnchor="middle" fontSize={10} fill="currentColor">{xLabel}</text>}
      {children(sx, sy)}
    </svg>
  );
}

const pathOf = (pts: { x: number; y: number }[], sx: (x: number) => number, sy: (y: number) => number) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
const areaOf = (pdf: (x: number) => number, a: number, b: number, sx: (x: number) => number, sy: (y: number) => number) => {
  if (!(b > a)) return "";
  const N = 80, pts = Array.from({ length: N + 1 }, (_, i) => { const x = a + ((b - a) * i) / N; return `L${sx(x).toFixed(1)},${sy(pdf(x)).toFixed(1)}`; });
  return `M${sx(a).toFixed(1)},${sy(0).toFixed(1)}${pts.join("")}L${sx(b).toFixed(1)},${sy(0).toFixed(1)}Z`;
};

/** Reproducibility notice shown on every simulated view. */
const SeedNote = ({ seed }: { seed: number }) => <p className="text-xs text-ink-faint">Simulated with seed {seed}. A seeded random generator gives the same numbers every time for the same seed; change the seed at the top to see another run.</p>;

/** Plain text equivalent of a chart, kept visible so a screen reader (or anyone) gets the numbers too. */
const TextEq = ({ children, title = "Numbers behind the chart" }: { children: ReactNode; title?: string }) => <details className="text-xs text-ink-muted"><summary className="cursor-pointer font-semibold text-ink">{title}</summary><div className="mt-1 space-y-1">{children}</div></details>;

// ---------------------------------------------------------------------------------------------------------------------
// 1. Distributions
// ---------------------------------------------------------------------------------------------------------------------

function DistributionsSection({ seed, mode }: { seed: number; mode?: string }) {
  const [id, setId] = useState<S.DistId>(S.DISTRIBUTIONS.some((d) => d.id === mode) ? (mode as S.DistId) : "normal");
  const [params, setParams] = useState<Record<string, number>>(() => S.defaultParams(id));
  const [shift, setShift] = useState(0);
  const [outlier, setOutlier] = useState(mode === "outlier");
  const spec = S.DISTRIBUTIONS.find((d) => d.id === id)!;
  const dist = useMemo(() => S.makeDist(id, params), [id, params]);
  const pts = useMemo(() => S.plotPoints(dist), [dist]);
  const base = useMemo(() => S.sampleData(dist, 11, seed), [dist, seed]);
  const lo = dist.lo, hi = dist.hi, range = hi - lo;
  const outlierValue = Math.round((dist.mean + 7 * dist.sd) * 10) / 10;
  const data = useMemo(() => { const d = [...base]; d[0] = Math.round((d[0] + shift) * 10) / 10; if (outlier) d.push(outlierValue); return d; }, [base, shift, outlier, outlierValue]);
  const orig = useMemo(() => S.describe(base), [base]), now = useMemo(() => S.describe(data), [data]);
  const pick = (next: S.DistId) => { setId(next); setParams(S.defaultParams(next)); setShift(0); };
  const yMax = Math.max(...pts.map((p) => p.y)) * 1.1;
  const xd: [number, number] = [Math.min(lo, ...data), Math.max(hi, ...data)];
  const stack = useMemo(() => { const seen = new Map<number, number>(); return data.map((v) => { const c = seen.get(v) ?? 0; seen.set(v, c + 1); return { v, level: c }; }); }, [data]);
  const sign = (v: number) => (v >= 0 ? "+" : "") + f(v, 2);
  return (
    <VisualShell
      left={<div className={`${card} space-y-3`}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Distribution">{S.DISTRIBUTIONS.map((d) => <button key={d.id} type="button" aria-pressed={d.id === id} className={chip(d.id === id)} onClick={() => pick(d.id)}>{d.label}</button>)}</div>
        <p className="text-sm text-ink-muted">{spec.blurb}</p>
        {spec.params.map((p) => <Slider key={p.key} label={p.label} value={params[p.key]} min={p.min} max={p.max} step={p.step} onChange={(v) => setParams((s) => ({ ...s, [p.key]: v }))} />)}
        <table className="w-full text-xs"><caption className="pb-1 text-left font-semibold text-ink">Theory for these parameters</caption><tbody>
          <tr><th className="text-left font-normal text-ink-muted">Mean</th><td className="tabular-nums">{f(dist.mean)}</td><th className="text-left font-normal text-ink-muted">Median</th><td className="tabular-nums">{f(dist.median)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Mode</th><td className="tabular-nums">{dist.mode === null ? "any value in [a, b]" : f(dist.mode)}</td><th className="text-left font-normal text-ink-muted">Std dev</th><td className="tabular-nums">{f(dist.sd)}</td></tr>
        </tbody></table>
        {dist.mean > dist.median + 1e-9 && <p className="text-xs text-ink-muted">Mean above median: the long right tail pulls the mean up (d086). The median describes the typical value better here.</p>}
      </div>}
      right={<div className="space-y-3">
        <div className={card}>
          <div className="mb-1 flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">{spec.discrete ? "Probability mass function" : "Probability density function"}</h3><ProvenanceBadge p="executed" /></div>
          <Plot xd={[lo, hi]} yd={[0, yMax]} label={`${spec.label} ${spec.discrete ? "mass" : "density"} plot. Mean ${f(dist.mean, 2)}, median ${f(dist.median, 2)}.`} xLabel="value">
            {(sx, sy) => <>
              {spec.discrete ? pts.map((p) => <rect key={p.x} x={sx(p.x) - 3} y={sy(p.y)} width={6} height={Math.max(0, sy(0) - sy(p.y))} fill="#6366f1" opacity={0.75} />) : <><path d={`${pathOf(pts, sx, sy)}L${sx(pts[pts.length - 1].x)},${sy(0)}L${sx(pts[0].x)},${sy(0)}Z`} fill="#6366f1" opacity={0.15} /><path d={pathOf(pts, sx, sy)} fill="none" stroke="#6366f1" strokeWidth={2} /></>}
              <line x1={sx(dist.mean)} x2={sx(dist.mean)} y1={8} y2={sy(0)} stroke="#ef4444" strokeDasharray="4 3" /><line x1={sx(dist.median)} x2={sx(dist.median)} y1={8} y2={sy(0)} stroke="#14b8a6" strokeDasharray="2 3" />
            </>}
          </Plot>
          <p className="text-xs text-ink-faint"><span className="text-[#ef4444]">Red dashed</span> = mean, <span className="text-[#14b8a6]">teal dotted</span> = median.</p>
        </div>
        <div className={card}>
          <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Move a point, add an outlier</h3><ProvenanceBadge p="simulated" /></div>
          <p className="text-xs text-ink-muted">Eleven values drawn from this distribution with seed {seed}, rounded to one decimal.</p>
          <Slider label="Move the first point by" value={shift} min={-Math.round(range)} max={Math.round(range)} step={Math.max(0.1, Math.round(range / 100 * 10) / 10)} onChange={setShift} fmt={(v) => sign(v)} />
          <label className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted"><input type="checkbox" checked={outlier} onChange={(e) => setOutlier(e.target.checked)} />Add an outlier at {f(outlierValue, 1)} (the mean plus 7 standard deviations)</label>
          <Plot xd={xd} yd={[0, Math.max(3, ...stack.map((s) => s.level + 1)) + 0.5]} h={140} label={`Dot plot of ${data.length} values. Mean ${f(now.mean, 2)}, median ${f(now.median, 2)}.`}>
            {(sx, sy) => <>
              {stack.map((s, i) => <circle key={i} cx={sx(s.v)} cy={sy(s.level + 0.5)} r={4} fill="#6366f1" />)}
              <line x1={sx(now.mean)} x2={sx(now.mean)} y1={8} y2={sy(0)} stroke="#ef4444" strokeWidth={2} /><line x1={sx(now.median)} x2={sx(now.median)} y1={8} y2={sy(0)} stroke="#14b8a6" strokeWidth={2} strokeDasharray="3 3" />
            </>}
          </Plot>
          <div role="status" aria-live="polite" className="space-y-0.5 text-sm text-ink">
            <p>Mean <strong className="tabular-nums">{f(now.mean, 2)}</strong> ({sign(now.mean - orig.mean)} from the original), median <strong className="tabular-nums">{f(now.median, 2)}</strong> ({sign(now.median - orig.median)}), mode <strong>{now.modes.length ? now.modes.join(" and ") : "none (all values differ)"}</strong>.</p>
            {(outlier || shift !== 0) && <p className="text-xs text-ink-muted">{Math.abs(now.mean - orig.mean) > Math.abs(now.median - orig.median) ? "The mean moved more than the median: the median is robust to extreme values, the mean is not." : "Here the median moved as much as the mean, because the point crossed the middle of the data."}</p>}
          </div>
          <TextEq><p>Values: {data.join(", ")}.</p><p>Mean {f(now.mean)}, median {f(now.median)}, mode {now.modes.length ? now.modes.join(", ") : "none"}, original mean {f(orig.mean)}, original median {f(orig.median)}.</p></TextEq>
        </div>
      </div>}
      bottom={<SeedNote seed={seed} />}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Summary statistics
// ---------------------------------------------------------------------------------------------------------------------

function SummarySection({ seed, mode }: { seed: number; mode?: string }) {
  const [text, setText] = useState("2, 3, 3, 4, 8, 11");
  const { values, bad } = useMemo(() => S.parseNumbers(text), [text]);
  const steps = useMemo(() => (values.length ? S.summarySteps(values) : []), [values]);
  const d = useMemo(() => (values.length ? S.describe(values) : null), [values]);
  const pb = usePlayback(steps.length);
  const first = useRef(true);
  useEffect(() => { if (first.current && mode === "variance") pb.dispatch({ type: "seek", index: 4 }); first.current = false; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [bn, setBn] = useState(5);
  const bias = useMemo(() => S.varianceBiasDemo(bn, 4000, seed), [bn, seed]);
  const step = steps[pb.index];
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <label className="block text-xs font-semibold text-ink">Your data (numbers separated by commas)
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-surface-border bg-surface p-1.5 text-sm font-normal text-ink" aria-describedby="sum-err" /></label>
        <p id="sum-err" role="status" className="text-xs text-danger">{bad.length ? `Could not read: ${bad.join(", ")}. Those items are ignored.` : ""}{!values.length ? "Enter at least one number." : ""}</p>
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">Step by step</h3><ProvenanceBadge p="executed" /></div>
        {step && <div role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink"><p className="font-semibold">{step.title}</p><p className="text-ink-muted">{step.text}</p>
          {step.rows && <table className="mt-1 text-xs tabular-nums"><thead><tr><th className="pr-3 text-left">x</th><th className="pr-3 text-left">x - mean</th>{pb.index >= 5 && <th className="text-left">(x - mean)^2</th>}</tr></thead><tbody>{step.rows.map((r, i) => <tr key={i}><td className="pr-3">{f(r.x)}</td><td className="pr-3">{f(r.dev)}</td>{pb.index >= 5 && <td>{f(r.sq)}</td>}</tr>)}</tbody></table>}
        </div>}
        <PlaybackBar pb={pb} labels={steps.map((s) => s.title)} />
      </div>}
      right={<div className="space-y-3">
        {d && <div className={card}>
          <h3 className="mb-1 text-sm font-semibold text-ink">Summary of the {d.n} values</h3>
          <table className="w-full text-sm tabular-nums"><tbody>
            <tr><th className="text-left font-normal text-ink-muted">Mean</th><td>{f(d.mean)}</td><th className="text-left font-normal text-ink-muted">Median</th><td>{f(d.median)}</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">Mode</th><td>{d.modes.length ? d.modes.join(", ") : "none"}</td><th className="text-left font-normal text-ink-muted">Range</th><td>{f(d.range)}</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">Q1 / Q3</th><td>{f(d.q1)} / {f(d.q3)}</td><th className="text-left font-normal text-ink-muted">IQR</th><td>{f(d.iqr)}</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">Skewness</th><td>{f(d.skew, 3)}</td><th className="text-left font-normal text-ink-muted">Outliers (1.5 x IQR)</th><td>{d.outliers.length ? d.outliers.join(", ") : "none"}</td></tr>
          </tbody></table>
          <table className="mt-3 w-full text-sm tabular-nums" aria-label="Population versus sample"><caption className="pb-1 text-left text-sm font-semibold text-ink">Population versus sample, side by side</caption>
            <thead><tr className="text-left text-xs text-ink-muted"><th /><th>Population (divide by n = {d.n})</th><th>Sample (divide by n - 1 = {d.n - 1})</th></tr></thead>
            <tbody><tr><th className="text-left font-normal text-ink-muted">Variance</th><td>{f(d.varPop)}</td><td>{f(d.varSample)}</td></tr><tr><th className="text-left font-normal text-ink-muted">Standard deviation</th><td>{f(d.sdPop)}</td><td>{f(d.sdSample)}</td></tr></tbody></table>
          <p className="mt-1 text-xs text-ink-muted">Use the population version when your data is every value you care about. Use the sample version when the data is a sample and you want to estimate the spread of the population.</p>
          <Plot xd={[Math.min(...values), Math.max(...values) + (Math.max(...values) === Math.min(...values) ? 1 : 0)]} yd={[0, 3]} h={110} label={`Dot plot with mean ${f(d.mean, 2)} and median ${f(d.median, 2)}`}>
            {(sx, sy) => <>{values.map((v, i) => <circle key={i} cx={sx(v)} cy={sy(1 + (values.slice(0, i).filter((u) => u === v).length) * 0.6)} r={4} fill="#6366f1" />)}<line x1={sx(d.mean)} x2={sx(d.mean)} y1={6} y2={sy(0)} stroke="#ef4444" strokeWidth={2} /><line x1={sx(d.median)} x2={sx(d.median)} y1={6} y2={sy(0)} stroke="#14b8a6" strokeWidth={2} strokeDasharray="3 3" /></>}
          </Plot>
        </div>}
        <div className={card}>
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">Why n - 1?</h3><ProvenanceBadge p="simulated" /></div>
          <Slider label="Sample size n" value={bn} min={2} max={30} step={1} onChange={setBn} />
          <p role="status" aria-live="polite" className="text-sm text-ink-muted">{bias.reps} seeded samples of size {bn} from a population with true variance {bias.trueVariance}. Average of the divide-by-n formula: <strong className="text-ink">{f(bias.meanDivN, 1)}</strong> (too low, about {f(bias.trueVariance * (bn - 1) / bn, 1)} in theory). Average of the divide-by-(n - 1) formula: <strong className="text-ink">{f(bias.meanDivNMinus1, 1)}</strong> (close to {bias.trueVariance}).</p>
          <SeedNote seed={seed} />
        </div>
      </div>}
      bottom={<TextEq title="All arithmetic as text">{steps.map((s) => <p key={s.title}><strong>{s.title}.</strong> {s.text}</p>)}</TextEq>}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Probability
// ---------------------------------------------------------------------------------------------------------------------

function ProbabilitySection({ seed, mode }: { seed: number; mode?: string }) {
  const [sub, setSub] = useState(mode === "conditional" || mode === "bayes" ? mode : "lln");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Probability topic">{[["lln", "Law of large numbers"], ["conditional", "Conditional probability"], ["bayes", "Bayes' rule"]].map(([k, l]) => <button key={k} type="button" aria-pressed={sub === k} className={chip(sub === k)} onClick={() => setSub(k)}>{l}</button>)}</div>
      {sub === "lln" && <LlnView seed={seed} />}
      {sub === "conditional" && <ConditionalView />}
      {sub === "bayes" && <BayesView />}
    </div>
  );
}

function LlnView({ seed }: { seed: number }) {
  const [kind, setKind] = useState<S.EventKind>("coin");
  const sim = useMemo(() => S.simulateEvent(kind, 5000, seed), [kind, seed]);
  const pb = usePlayback(sim.checkpoints.length);
  const cp = sim.checkpoints[pb.index], ev = S.EVENTS.find((e) => e.id === kind)!;
  const shown = sim.checkpoints.slice(0, pb.index + 1);
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <label className="block text-xs text-ink-muted">Experiment<select value={kind} onChange={(e) => setKind(e.target.value as S.EventKind)} className={`${sel} mt-0.5 w-full`}>{S.EVENTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
        <p className="text-sm text-ink-muted">Theory: {ev.describe} = {f(ev.theory, 4)}. Each frame shows the running proportion after more trials.</p>
        <div role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">After <strong>{cp.n}</strong> trials: {cp.hits} hits, proportion <strong className="tabular-nums">{f(cp.proportion)}</strong>, distance from theory {f(cp.error)}.{pb.index === sim.checkpoints.length - 1 ? " With many trials the proportion settles near the theoretical probability: the law of large numbers. Early values wander, and a short streak is not a sign that the next trial is due." : ""}</div>
        <PlaybackBar pb={pb} labels={sim.checkpoints.map((c) => `${c.n} trials`)} />
        <div className="flex items-center gap-2"><ProvenanceBadge p="simulated" /></div>
        <SeedNote seed={seed} />
      </div>}
      right={<div className={card}>
        <Plot xd={[0, sim.checkpoints.length - 1]} yd={[0, Math.max(0.6, ev.theory * 2, ...shown.map((c) => c.proportion))]} ticks={Math.min(6, sim.checkpoints.length)} label={`Running proportion converging to ${f(ev.theory, 3)}. Latest ${f(cp.proportion, 3)} after ${cp.n} trials.`} xLabel="checkpoint (trials: 1, 2, 5, 10 ... 5000)">
          {(sx, sy) => <>
            <line x1={sx(0)} x2={sx(sim.checkpoints.length - 1)} y1={sy(ev.theory)} y2={sy(ev.theory)} stroke="#14b8a6" strokeDasharray="4 3" />
            <path d={pathOf(shown.map((c, i) => ({ x: i, y: c.proportion })), sx, sy)} fill="none" stroke="#6366f1" strokeWidth={2} />
            {shown.map((c, i) => <circle key={i} cx={sx(i)} cy={sy(c.proportion)} r={i === pb.index ? 5 : 3} fill="#6366f1" />)}
          </>}
        </Plot>
        <TextEq><table className="tabular-nums"><thead><tr><th className="pr-3 text-left">trials</th><th className="pr-3 text-left">hits</th><th className="pr-3 text-left">proportion</th><th className="text-left">error</th></tr></thead><tbody>{shown.map((c) => <tr key={c.n}><td className="pr-3">{c.n}</td><td className="pr-3">{c.hits}</td><td className="pr-3">{f(c.proportion)}</td><td>{f(c.error)}</td></tr>)}</tbody></table></TextEq>
      </div>}
      bottom={null}
    />
  );
}

function ConditionalView() {
  const [a, setA] = useState("sum7"), [b, setB] = useState("first-even");
  const c = S.diceConditional(a, b);
  const A = S.DICE_EVENTS.find((e) => e.id === a)!, B = S.DICE_EVENTS.find((e) => e.id === b)!;
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">Two fair dice: all 36 outcomes</h3><ProvenanceBadge p="executed" /></div>
        <label className="block text-xs text-ink-muted">Event A<select value={a} onChange={(e) => setA(e.target.value)} className={`${sel} mt-0.5 w-full`}>{S.DICE_EVENTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
        <label className="block text-xs text-ink-muted">Given event B<select value={b} onChange={(e) => setB(e.target.value)} className={`${sel} mt-0.5 w-full`}>{S.DICE_EVENTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
        <div role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">
          <p>P(A) = {c.a}/36 = {f(c.pA)}. P(B) = {c.b}/36 = {f(c.pB)}. P(A and B) = {c.both}/36 = {f(c.pAandB)}.</p>
          <p className="font-semibold">P(A | B) = P(A and B) / P(B) = {c.both}/{c.b} = {f(c.pAgivenB)}</p>
          <p className="text-ink-muted">{c.independent ? `P(A and B) = P(A) x P(B), so A and B are independent: knowing B does not change the chance of A.` : `P(A and B) is not P(A) x P(B) (${f(c.pA * c.pB)}), so the events are not independent: knowing B changes the chance of A.`}</p>
        </div>
      </div>}
      right={<div className={card}>
        <table className="mx-auto border-collapse text-xs" aria-label="Outcomes of two dice. Rows are the first die, columns the second."><thead><tr><th className="p-1 text-ink-faint">1st \ 2nd</th>{[1, 2, 3, 4, 5, 6].map((y) => <th key={y} className="p-1 text-ink-muted">{y}</th>)}</tr></thead>
          <tbody>{[1, 2, 3, 4, 5, 6].map((x) => <tr key={x}><th className="p-1 text-ink-muted">{x}</th>{[1, 2, 3, 4, 5, 6].map((y) => { const ia = A.test(x, y), ib = B.test(x, y); return <td key={y} title={`${x},${y}${ia ? " in A" : ""}${ib ? " in B" : ""}`} className={`h-8 w-8 border border-surface-border text-center ${ia && ib ? "bg-accent text-white" : ib ? "bg-warn-dim text-ink" : ia ? "bg-success-dim text-ink" : "text-ink-faint"}`}>{ia && ib ? "AB" : ib ? "B" : ia ? "A" : "."}</td>; })}</tr>)}</tbody></table>
        <p className="mt-2 text-xs text-ink-muted">A = green, B = amber, both = blue. Conditioning on B means keeping only the B and AB cells and asking what share of them are AB.</p>
      </div>}
      bottom={null}
    />
  );
}

function BayesView() {
  const [prev, setPrev] = useState(0.01), [sens, setSens] = useState(0.9), [spec, setSpec] = useState(0.95);
  const t = S.bayesTable({ population: 10000, prevalence: prev, sensitivity: sens, specificity: spec });
  const pct = (v: number) => `${f(v * 100, 1)}%`;
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">A screening test</h3><ProvenanceBadge p="conceptual" /></div>
        <p className="text-xs text-ink-muted">The numbers are made-up inputs you can change, not data about any real test.</p>
        <Slider label="Prevalence: share of people who are sick" value={prev} min={0.001} max={0.5} step={0.001} onChange={setPrev} fmt={pct} />
        <Slider label="Sensitivity: P(positive | sick)" value={sens} min={0.5} max={0.999} step={0.001} onChange={setSens} fmt={pct} />
        <Slider label="Specificity: P(negative | healthy)" value={spec} min={0.5} max={0.999} step={0.001} onChange={setSpec} fmt={pct} />
        <p role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">Out of {t.positives.toFixed(0)} people who test positive, only <strong>{f(t.truePositive, 1)}</strong> are sick: P(sick | positive) = {f(t.truePositive, 1)} / {f(t.positives, 1)} = <strong>{pct(t.ppv)}</strong>. Bayes' formula gives the same: {f(sens, 3)} x {f(prev, 3)} / ({f(sens, 3)} x {f(prev, 3)} + {f(1 - spec, 3)} x {f(1 - prev, 3)}) = {pct(t.ppvBayes)}.</p>
      </div>}
      right={<div className={card}>
        <table className="w-full text-sm tabular-nums" aria-label="Natural frequency table out of 10,000 people"><caption className="pb-1 text-left font-semibold text-ink">Out of 10,000 people</caption>
          <thead><tr className="text-left text-xs text-ink-muted"><th /><th>Test positive</th><th>Test negative</th><th>Total</th></tr></thead>
          <tbody><tr><th className="text-left font-normal text-ink-muted">Sick</th><td>{f(t.truePositive, 1)}</td><td>{f(t.falseNegative, 1)}</td><td>{f(t.sick, 1)}</td></tr>
            <tr><th className="text-left font-normal text-ink-muted">Healthy</th><td>{f(t.falsePositive, 1)}</td><td>{f(t.trueNegative, 1)}</td><td>{f(t.healthy, 1)}</td></tr>
            <tr className="font-semibold"><th className="text-left">Total</th><td>{f(t.positives, 1)}</td><td>{f(t.negatives, 1)}</td><td>10000</td></tr></tbody></table>
        <div className="mt-2 flex h-6 overflow-hidden rounded" role="img" aria-label={`Of all positives, ${pct(t.ppv)} are true positives and ${pct(1 - t.ppv)} are false positives`}><div style={{ width: `${t.ppv * 100}%` }} className="bg-accent" /><div style={{ width: `${(1 - t.ppv) * 100}%` }} className="bg-warn-dim" /></div>
        <p className="text-xs text-ink-muted">Blue = true positives, amber = false positives, among everyone who tested positive. A rare condition produces many false positives even from a good test. Also P(healthy | negative) = {pct(t.npv)}.</p>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Sampling and the central limit theorem
// ---------------------------------------------------------------------------------------------------------------------

const FRAMES = [1, 5, 20, 100, 500, 2000];

function SamplingSection({ seed, mode }: { seed: number; mode?: string }) {
  const [kind, setKind] = useState<S.PopKind>("skewed");
  const [n, setN] = useState(mode === "clt" ? 30 : 10);
  const pop = useMemo(() => S.makePopulation(kind), [kind]);
  const res = useMemo(() => S.samplingDistribution(pop, n, 2000, seed), [pop, n, seed]);
  const pb = usePlayback(FRAMES.length);
  const k = FRAMES[pb.index], means = res.means.slice(0, k);
  const popH = useMemo(() => S.histogram(pop, 24), [pop]);
  const lo = Math.min(...pop), hi = Math.max(...pop);
  const sampleSe = k > 1 ? S.sdSample(means) : NaN;
  const mh = useMemo(() => S.histogram(res.means, 30, res.popMean - 4.2 * res.theoreticalSe, res.popMean + 4.2 * res.theoreticalSe), [res]);
  const hk = S.histogram(means, 30, mh.edges[0], mh.edges[30]);
  const w = hk.edges[1] - hk.edges[0], curve = (x: number) => S.normPdf(x, res.popMean, res.theoreticalSe) * k * w;
  const maxC = Math.max(...hk.counts, ...mh.edges.map((_, i) => curve(mh.edges[0] + (i / 30) * (mh.edges[30] - mh.edges[0]))), 1);
  const cs = useMemo(() => Array.from({ length: 121 }, (_, i) => ({ x: mh.edges[0] + (i / 120) * (mh.edges[30] - mh.edges[0]), y: 0 })), [mh]);
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <label className="block text-xs text-ink-muted">Population<select value={kind} onChange={(e) => setKind(e.target.value as S.PopKind)} className={`${sel} mt-0.5 w-full`}>{(Object.keys(S.POP_LABEL) as S.PopKind[]).map((p) => <option key={p} value={p}>{S.POP_LABEL[p]}</option>)}</select></label>
        <Slider label="Sample size n" value={n} min={1} max={100} step={1} onChange={setN} />
        <p className="text-xs text-ink-muted">A population of 10,000 values with known parameters: mean {f(res.popMean, 2)}, standard deviation {f(res.popSd, 2)}, skewness {f(res.skewOfPop, 2)}. Each frame adds more samples (with replacement); every sample contributes its mean.</p>
        <Plot xd={[lo, hi]} yd={[0, Math.max(...popH.counts)]} h={120} label={`Histogram of the population, skewness ${f(res.skewOfPop, 2)}`}>
          {(sx, sy) => <>{popH.counts.map((c, i) => <rect key={i} x={sx(popH.edges[i])} y={sy(c)} width={Math.max(1, sx(popH.edges[i + 1]) - sx(popH.edges[i]) - 1)} height={sy(0) - sy(c)} fill="#8b5cf6" opacity={0.7} />)}</>}
        </Plot>
        <PlaybackBar pb={pb} labels={FRAMES.map((x) => `${x} samples`)} />
        <div className="flex gap-2"><ProvenanceBadge p="simulated" /></div>
        <SeedNote seed={seed} />
      </div>}
      right={<div className={`${card} space-y-2`}>
        <h3 className="text-sm font-semibold text-ink">Sampling distribution of the mean ({k} sample{k > 1 ? "s" : ""} of n = {n})</h3>
        <Plot xd={[mh.edges[0], mh.edges[30]]} yd={[0, maxC * 1.1]} label={`Histogram of ${k} sample means with the normal curve predicted by the central limit theorem. Standard error observed ${f(sampleSe, 3)}, theory ${f(res.theoreticalSe, 3)}.`}>
          {(sx, sy) => <>
            {hk.counts.map((c, i) => <rect key={i} x={sx(hk.edges[i])} y={sy(c)} width={Math.max(1, sx(hk.edges[i + 1]) - sx(hk.edges[i]) - 1)} height={sy(0) - sy(c)} fill="#6366f1" opacity={0.75} />)}
            <path d={pathOf(cs.map((p) => ({ x: p.x, y: curve(p.x) })), sx, sy)} fill="none" stroke="#ef4444" strokeWidth={2} />
            <line x1={sx(res.popMean)} x2={sx(res.popMean)} y1={8} y2={sy(0)} stroke="#14b8a6" strokeDasharray="4 3" />
          </>}
        </Plot>
        <p className="text-xs text-ink-faint">Red curve: normal with the population mean and standard error sigma / sqrt(n). Teal dashed: population mean.</p>
        <table className="w-full text-sm tabular-nums" aria-label="Standard error comparison"><tbody>
          <tr><th className="text-left font-normal text-ink-muted">Standard error from the {k} means</th><td>{f(sampleSe, 3)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Theory: sigma / sqrt(n) = {f(res.popSd, 2)} / {f(Math.sqrt(n), 3)}</th><td>{f(res.theoreticalSe, 3)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Mean of the sample means (population mean {f(res.popMean, 2)})</th><td>{f(S.mean(means), 3)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Skewness of the sample means (population {f(res.skewOfPop, 2)})</th><td>{f(S.skewness(means), 3)}</td></tr>
        </tbody></table>
        <p role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">{k} sample means: standard error {f(sampleSe, 3)} against theory {f(res.theoreticalSe, 3)}. {n < 5 && kind === "skewed" ? "With a small n the means still inherit the skew of the population." : "The sample means are close to symmetric and bell-shaped even though the population is not: the central limit theorem."} Larger n shrinks the standard error by sqrt(n): four times the data, half the error.</p>
        <TextEq><p>Histogram counts of the {k} means (30 bins from {f(mh.edges[0], 2)} to {f(mh.edges[30], 2)}): {hk.counts.join(", ")}.</p></TextEq>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Confidence intervals
// ---------------------------------------------------------------------------------------------------------------------

function IntervalsSection({ seed, mode }: { seed: number; mode?: string }) {
  const [sub, setSub] = useState(mode === "coverage" ? "coverage" : "interval");
  return (
    <div className="space-y-3">
      <div className="flex gap-1" role="group" aria-label="Interval topic">{[["interval", "z and t intervals"], ["coverage", "Coverage of 100 samples"]].map(([k, l]) => <button key={k} type="button" aria-pressed={sub === k} className={chip(sub === k)} onClick={() => setSub(k)}>{l}</button>)}</div>
      {sub === "interval" ? <IntervalView /> : <CoverageView seed={seed} />}
    </div>
  );
}

function IntervalView() {
  const [xbar, setXbar] = useState(50), [sd, setSd] = useState(10), [n, setN] = useState(15), [conf, setConf] = useState(0.95);
  const z = S.zInterval(xbar, sd, n, conf), t = S.tInterval(xbar, sd, n, conf);
  const lo = xbar - 4 * (sd / Math.sqrt(n)) * 1.6, hi = xbar + 4 * (sd / Math.sqrt(n)) * 1.6;
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">Interval for a mean</h3><ProvenanceBadge p="executed" /></div>
        <Slider label="Sample mean" value={xbar} min={0} max={100} step={0.5} onChange={setXbar} />
        <Slider label="Standard deviation (sigma for z; sample s for t)" value={sd} min={1} max={30} step={0.5} onChange={setSd} />
        <Slider label="Sample size n" value={n} min={2} max={200} step={1} onChange={setN} />
        <Slider label="Confidence level" value={conf} min={0.5} max={0.99} step={0.01} onChange={setConf} fmt={(v) => `${Math.round(v * 100)}%`} />
        <p className="text-xs text-ink-muted">Standard error = {f(sd, 2)} / sqrt({n}) = {f(z.se, 4)}. The z interval treats sigma as known. The t interval uses the sample standard deviation and the heavier-tailed t distribution with {n - 1} degrees of freedom.</p>
      </div>}
      right={<div className={`${card} space-y-2`}>
        <table className="w-full text-sm tabular-nums" aria-label="z and t intervals"><thead><tr className="text-left text-xs text-ink-muted"><th /><th>z interval</th><th>t interval</th></tr></thead><tbody>
          <tr><th className="text-left font-normal text-ink-muted">Critical value</th><td>{f(z.crit, 4)}</td><td>{f(t.crit, 4)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Margin of error</th><td>{f(z.margin, 3)}</td><td>{f(t.margin, 3)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Interval</th><td>[{f(z.lo, 3)}, {f(z.hi, 3)}]</td><td>[{f(t.lo, 3)}, {f(t.hi, 3)}]</td></tr></tbody></table>
        <Plot xd={[lo, hi]} yd={[0, 3]} h={130} label={`z interval ${f(z.lo, 2)} to ${f(z.hi, 2)}, t interval ${f(t.lo, 2)} to ${f(t.hi, 2)}`}>
          {(sx, sy) => <>
            <line x1={sx(xbar)} x2={sx(xbar)} y1={6} y2={sy(0)} stroke="currentColor" strokeDasharray="3 3" />
            <line x1={sx(z.lo)} x2={sx(z.hi)} y1={sy(2)} y2={sy(2)} stroke="#6366f1" strokeWidth={4} /><text x={sx(z.hi) + 4} y={sy(2) + 3} fontSize={10} fill="currentColor">z</text>
            <line x1={sx(t.lo)} x2={sx(t.hi)} y1={sy(1)} y2={sy(1)} stroke="#f59e0b" strokeWidth={4} /><text x={sx(t.hi) + 4} y={sy(1) + 3} fontSize={10} fill="currentColor">t</text>
          </>}
        </Plot>
        <p role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">The t interval is {f(t.margin / z.margin, 3)} times as wide as the z interval for n = {n}. {n < 30 ? "With a small sample the extra width pays for estimating sigma." : "With a large sample the two nearly coincide."} A {Math.round(conf * 100)}% confidence level describes the method: in repeated sampling about {Math.round(conf * 100)}% of intervals built this way contain the true mean. It is not a {Math.round(conf * 100)}% chance for this one interval.</p>
      </div>}
      bottom={null}
    />
  );
}

function CoverageView({ seed }: { seed: number }) {
  const [pop, setPop] = useState<"normal" | "skewed">("normal"), [n, setN] = useState(10), [conf, setConf] = useState(0.95), [method, setMethod] = useState<"z" | "t">("t");
  const sim = useMemo(() => S.coverageSim({ pop, n, conf, reps: 100, seed, method }), [pop, n, conf, seed, method]);
  const pb = usePlayback(100);
  const k = pb.index + 1, shown = sim.intervals.slice(0, k), covered = shown.filter((i) => i.covers).length;
  const lo = Math.min(...sim.intervals.map((i) => i.lo)), hi = Math.max(...sim.intervals.map((i) => i.hi));
  const H = 330;
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">Draw 100 samples, build 100 intervals</h3><ProvenanceBadge p="simulated" /></div>
        <label className="block text-xs text-ink-muted">Population<select value={pop} onChange={(e) => setPop(e.target.value as "normal" | "skewed")} className={`${sel} mt-0.5 w-full`}><option value="normal">Normal (mean 50, sd 10)</option><option value="skewed">Skewed (lognormal)</option></select></label>
        <label className="block text-xs text-ink-muted">Interval type<select value={method} onChange={(e) => setMethod(e.target.value as "z" | "t")} className={`${sel} mt-0.5 w-full`}><option value="t">t interval (sigma estimated from each sample)</option><option value="z">z interval (true sigma known)</option></select></label>
        <Slider label="Sample size n" value={n} min={3} max={100} step={1} onChange={setN} />
        <Slider label="Confidence level" value={conf} min={0.5} max={0.99} step={0.01} onChange={setConf} fmt={(v) => `${Math.round(v * 100)}%`} />
        <div role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">After {k} sample{k > 1 ? "s" : ""}: <strong>{covered} of {k}</strong> intervals contain the true mean {f(sim.trueMean, 2)} ({f((covered / k) * 100, 0)}%). Nominal level {Math.round(conf * 100)}%.{k === 100 ? ` All 100: ${sim.covered} cover it. Expect about ${Math.round(conf * 100)} on average; any single run varies by a few.${pop === "skewed" && n < 30 ? " With a skewed population and a small n the real coverage falls below the nominal level." : ""}` : ""}</div>
        <PlaybackBar pb={pb} labels={sim.intervals.map((_, i) => `${i + 1} intervals`)} />
        <button type="button" className={chip(false)} onClick={() => pb.dispatch({ type: "seek", index: 99 })}>Show all 100</button>
        <SeedNote seed={seed} />
      </div>}
      right={<div className={card}>
        <Plot xd={[lo, hi]} yd={[0, 100]} h={H} label={`${k} confidence intervals as horizontal lines; ${covered} contain the true mean ${f(sim.trueMean, 1)}; the others are drawn in red.`}>
          {(sx, sy) => <>
            <line x1={sx(sim.trueMean)} x2={sx(sim.trueMean)} y1={8} y2={sy(0)} stroke="#14b8a6" strokeWidth={2} />
            {shown.map((iv, i) => <line key={i} x1={sx(iv.lo)} x2={sx(iv.hi)} y1={sy(i + 0.5)} y2={sy(i + 0.5)} stroke={iv.covers ? "#6366f1" : "#ef4444"} strokeWidth={2} />)}
          </>}
        </Plot>
        <p className="text-xs text-ink-faint">Teal line: the true mean. Blue intervals contain it, red intervals miss it.</p>
        <TextEq><p>Missed the true mean: samples {shown.map((iv, i) => (iv.covers ? null : i + 1)).filter(Boolean).join(", ") || "none so far"}.</p></TextEq>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Hypothesis tests
// ---------------------------------------------------------------------------------------------------------------------

const TEST_MODES: [string, string][] = [["z", "One-sample z"], ["t", "One-sample t"], ["welch", "Welch two-sample t"], ["chi-indep", "Chi-square independence"], ["chi-gof", "Chi-square goodness of fit"], ["power", "Errors and power"]];
const SAMPLE_A = "12.1, 9.8, 11.4, 13.2, 10.9, 12.7, 8.9, 14.1, 11.8, 10.2", SAMPLE_B = "9.5, 10.1, 8.7, 11.0, 9.9, 10.4, 7.8, 12.5, 9.1, 10.0, 8.4, 9.6";

function TestsSection({ seed, mode }: { seed: number; mode?: string }) {
  const [sub, setSub] = useState(TEST_MODES.some(([k]) => k === mode) ? (mode as string) : "t");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Test">{TEST_MODES.map(([k, l]) => <button key={k} type="button" aria-pressed={sub === k} className={chip(sub === k)} onClick={() => setSub(k)}>{l}</button>)}</div>
      {sub === "power" ? <PowerView seed={seed} /> : <TestView key={sub} sub={sub} />}
    </div>
  );
}

function NullPlot({ r, alpha, upto }: { r: S.TestResult; alpha: number; upto: number }) {
  const [lo, hi] = S.nullRange(r.kind, r.df, r.stat), pdf = S.nullPdf(r.kind, r.df), pts = Array.from({ length: 200 }, (_, i) => { const x = lo + ((hi - lo) * i) / 199; return { x, y: pdf(x) }; });
  const yMax = Math.max(...pts.map((p) => (Number.isFinite(p.y) ? p.y : 0)).filter((y) => y < 50)) * 1.15;
  const crit = S.criticalValues(r.kind, r.df, alpha, r.alt), regions = S.pValueRegions(r.kind, r.stat, r.alt, hi, lo);
  const rej: [number, number][] = r.kind === "chi2" ? [[crit[0], hi]] : r.alt === "two-sided" ? [[lo, crit[0]], [crit[1], hi]] : r.alt === "greater" ? [[crit[0], hi]] : [[lo, crit[0]]];
  const sx0 = Math.max(lo, Math.min(hi, r.stat));
  return (
    <Plot xd={[lo, hi]} yd={[0, yMax]} label={`Null distribution (${r.kind === "z" ? "standard normal" : r.kind === "t" ? `Student t, ${f(r.df, 2)} df` : `chi-square, ${r.df} df`}). Test statistic ${f(r.stat, 3)}, p-value ${pf(r.p)}.`} xLabel="test statistic under H0">
      {(sx, sy) => <>
        {upto >= 4 && rej.map(([a, b], i) => <path key={`r${i}`} d={areaOf(pdf, a, b, sx, sy)} fill="#f59e0b" opacity={0.28} />)}
        {upto >= 3 && regions.map(([a, b], i) => <path key={`p${i}`} d={areaOf(pdf, Math.max(a, lo), Math.min(b, hi), sx, sy)} fill="#ef4444" opacity={0.5} />)}
        <path d={pathOf(pts.map((p) => ({ x: p.x, y: Math.min(p.y, yMax) })), sx, sy)} fill="none" stroke="#6366f1" strokeWidth={2} />
        {upto >= 4 && crit.map((c, i) => <line key={`c${i}`} x1={sx(c)} x2={sx(c)} y1={8} y2={sy(0)} stroke="#f59e0b" strokeDasharray="4 3" />)}
        {upto >= 2 && <><line x1={sx(sx0)} x2={sx(sx0)} y1={8} y2={sy(0)} stroke="#ef4444" strokeWidth={2} /><text x={sx(sx0)} y={16} textAnchor={sx0 > (lo + hi) / 2 ? "end" : "start"} dx={sx0 > (lo + hi) / 2 ? -4 : 4} fontSize={11} fill="currentColor">{r.kind === "chi2" ? "chi2" : r.kind} = {f(r.stat, 3)}</text></>}
      </>}
    </Plot>
  );
}

function TestView({ sub }: { sub: string }) {
  const [textA, setTextA] = useState(SAMPLE_A), [textB, setTextB] = useState(SAMPLE_B);
  const [mu0, setMu0] = useState(10), [sigma, setSigma] = useState(2), [alpha, setAlpha] = useState(0.05), [alt, setAlt] = useState<S.Alt>("two-sided");
  const [table, setTable] = useState<number[][]>([[30, 20, 10], [22, 28, 25]]), [gof, setGof] = useState<number[]>([8, 12, 9, 14, 7, 10]);
  const A = S.parseNumbers(textA), B = S.parseNumbers(textB);
  let r: S.TestResult | null = null, problem = "";
  try {
    if (sub === "z") { if (A.values.length < 2) problem = "Enter at least 2 values."; else r = S.zTest1(A.values, mu0, sigma, alt); }
    else if (sub === "t") { if (A.values.length < 2) problem = "Enter at least 2 values."; else if (S.sdSample(A.values) === 0) problem = "All values are equal, so the standard deviation is 0 and t is undefined."; else r = S.tTest1(A.values, mu0, alt); }
    else if (sub === "welch") { if (A.values.length < 2 || B.values.length < 2) problem = "Each group needs at least 2 values."; else if (S.varianceSample(A.values) + S.varianceSample(B.values) === 0) problem = "Both groups have zero spread; t is undefined."; else r = S.welchTest(A.values, B.values, alt); }
    else if (sub === "chi-indep") { if (table.flat().some((v) => v < 0) || table.some((row) => S.sum(row) === 0) || [0, 1, 2].some((j) => table[0][j] + table[1][j] === 0)) problem = "Counts must be non-negative and no row or column may be empty."; else r = S.chi2Independence(table); }
    else if (sub === "chi-gof") { if (gof.some((v) => v < 0) || S.sum(gof) === 0) problem = "Counts must be non-negative and not all zero."; else r = S.chi2GoodnessOfFit(gof, gof.map(() => 1)); }
  } catch { problem = "These inputs cannot be tested."; }
  const labels = ["Hypotheses", "Data and standard error", "Test statistic", "p-value", "Decision at alpha"];
  const pb = usePlayback(5);
  const alt1 = sub === "z" || sub === "t" || sub === "welch";
  const effectText = r?.effect ? `${r.effect.name} = ${f(r.effect.value, 3)}` : r?.cramersV !== undefined ? `Cramer's V = ${f(r.cramersV, 3)}` : "";
  const decision = r ? S.decide(r.p, alpha) : "";
  const setCell = (i: number, j: number, v: number) => setTable((t) => t.map((row, a) => row.map((c, b) => (a === i && b === j ? v : c))));
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">{TEST_MODES.find(([k]) => k === sub)![1]} test</h3><ProvenanceBadge p="executed" /></div>
        {(sub === "z" || sub === "t" || sub === "welch") && <label className="block text-xs font-semibold text-ink">{sub === "welch" ? "Group A values" : "Sample values"}<textarea value={textA} onChange={(e) => setTextA(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-surface-border bg-surface p-1.5 text-sm font-normal text-ink" /></label>}
        {sub === "welch" && <label className="block text-xs font-semibold text-ink">Group B values<textarea value={textB} onChange={(e) => setTextB(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-surface-border bg-surface p-1.5 text-sm font-normal text-ink" /></label>}
        {(sub === "z" || sub === "t") && <Slider label="Hypothesised mean mu0 (H0)" value={mu0} min={0} max={20} step={0.1} onChange={setMu0} />}
        {sub === "z" && <Slider label="Known population sigma" value={sigma} min={0.5} max={6} step={0.1} onChange={setSigma} />}
        {alt1 && <label className="block text-xs text-ink-muted">Alternative hypothesis<select value={alt} onChange={(e) => setAlt(e.target.value as S.Alt)} className={`${sel} mt-0.5 w-full`}><option value="two-sided">two-sided (differs)</option><option value="greater">one-sided: greater</option><option value="less">one-sided: less</option></select></label>}
        {sub === "chi-indep" && <div><p className="text-xs font-semibold text-ink">Observed counts (edit them)</p>
          <table className="text-xs" aria-label="Observed counts"><thead><tr><th /><th className="px-1">Outcome 1</th><th className="px-1">Outcome 2</th><th className="px-1">Outcome 3</th></tr></thead><tbody>{table.map((row, i) => <tr key={i}><th className="pr-1 text-left font-normal text-ink-muted">Group {i + 1}</th>{row.map((c, j) => <td key={j}><input type="number" min={0} aria-label={`Group ${i + 1}, outcome ${j + 1}`} value={c} onChange={(e) => setCell(i, j, Math.max(0, Math.round(Number(e.target.value))))} className={num} /></td>)}</tr>)}</tbody></table></div>}
        {sub === "chi-gof" && <div><p className="text-xs font-semibold text-ink">Counts from 60 rolls of a die (H0: the die is fair, all six faces equally likely)</p>
          <div className="flex flex-wrap gap-1.5">{gof.map((c, i) => <label key={i} className="text-xs text-ink-muted">Face {i + 1}<input type="number" min={0} value={c} onChange={(e) => setGof((g) => g.map((v, k) => (k === i ? Math.max(0, Math.round(Number(e.target.value))) : v)))} className={`${num} block`} /></label>)}</div></div>}
        <Slider label="Significance level alpha" value={alpha} min={0.01} max={0.2} step={0.01} onChange={setAlpha} />
        <p role="status" className="text-xs text-danger">{problem}{A.bad.length && sub !== "chi-indep" ? ` Could not read: ${A.bad.join(", ")}.` : ""}{sub === "welch" && B.bad.length ? ` Group B: could not read ${B.bad.join(", ")}.` : ""}</p>
        {r && <PlaybackBar pb={pb} labels={labels} />}
      </div>}
      right={r ? <div className={`${card} space-y-2`}>
        <NullPlot r={r} alpha={alpha} upto={pb.index} />
        <p className="text-xs text-ink-faint">{pb.index >= 2 ? "Red line: the observed test statistic. " : ""}{pb.index >= 3 ? "Red area: the p-value, the probability under H0 of a statistic at least this extreme. " : ""}{pb.index >= 4 ? "Amber area: the rejection region at alpha." : ""}</p>
        <div role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">
          <p className="font-semibold">{labels[pb.index]}</p>
          {pb.index < 4 ? <p className="text-ink-muted">{r.steps[pb.index]}</p> : <p>p-value = {pf(r.p)} {r.p < alpha ? "<" : ">="} alpha = {alpha}, so <strong>{decision}</strong>. {r.p < alpha ? "The data would be unusual if H0 were true." : "The data are not unusual enough under H0; that is not proof that H0 is true."}{effectText ? ` Effect size: ${effectText}.` : ""}{r.ci ? ` 95% interval for the ${sub === "welch" ? "difference in means" : "mean"}: [${f(r.ci[0], 3)}, ${f(r.ci[1], 3)}].` : ""}</p>}
        </div>
        {r.expected && <div className="grid gap-2 sm:grid-cols-2">
          <table className="text-xs tabular-nums" aria-label="Expected counts"><caption className="text-left font-semibold text-ink">Expected counts (E)</caption><tbody>{r.expected.map((row, i) => <tr key={i}>{row.map((e, j) => <td key={j} className="pr-3">{f(e, 2)}</td>)}</tr>)}</tbody></table>
          <table className="text-xs tabular-nums" aria-label="Standardised residuals"><caption className="text-left font-semibold text-ink">Standardised residuals (O - E) / sqrt(E)</caption><tbody>{r.residuals!.map((row, i) => <tr key={i}>{row.map((e, j) => <td key={j} className={`pr-3 ${Math.abs(e) > 2 ? "font-bold text-danger" : ""}`}>{f(e, 2)}</td>)}</tr>)}</tbody></table>
        </div>}
        {r.minExpected !== undefined && r.minExpected < 5 && <p className="text-xs text-warn">Warning: a cell has an expected count of {f(r.minExpected, 2)}, below 5. The chi-square approximation is unreliable here.</p>}
        <TextEq title="All steps as text"><ol className="list-decimal pl-4">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol><p>Decision: {decision} at alpha {alpha}.</p></TextEq>
      </div> : <div className={card}><p className="text-sm text-ink-muted">{problem}</p></div>}
      bottom={null}
    />
  );
}

function PowerView({ seed }: { seed: number }) {
  const [delta, setDelta] = useState(1), [sigma, setSigma] = useState(2), [n, setN] = useState(25), [alpha, setAlpha] = useState(0.05);
  const sim = useMemo(() => S.errorSim({ delta, sigma, n, alpha, reps: 1000, seed }), [delta, sigma, n, alpha, seed]);
  const shift = (delta * Math.sqrt(n)) / sigma, zc = S.normInv(1 - alpha / 2);
  const lo = Math.min(-4, shift - 4), hi = Math.max(4, shift + 4);
  const pdf0 = (x: number) => S.normPdf(x), pdf1 = (x: number) => S.normPdf(x, shift, 1);
  const pts = (pdf: (x: number) => number) => Array.from({ length: 160 }, (_, i) => { const x = lo + ((hi - lo) * i) / 159; return { x, y: pdf(x) }; });
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex gap-2"><h3 className="text-sm font-semibold text-ink">Type I error, Type II error and power</h3><ProvenanceBadge p="simulated" /></div>
        <p className="text-xs text-ink-muted">A two-sided z-test of H0: mu = 0 where the true mean is the shift you choose. In real work the true shift is unknown; here you set it to see what the test can detect.</p>
        <Slider label="True shift from H0 (delta)" value={delta} min={0} max={5} step={0.1} onChange={setDelta} />
        <Slider label="Population sigma" value={sigma} min={0.5} max={6} step={0.1} onChange={setSigma} />
        <Slider label="Sample size n" value={n} min={2} max={200} step={1} onChange={setN} />
        <Slider label="Significance level alpha" value={alpha} min={0.01} max={0.2} step={0.01} onChange={setAlpha} />
        <SeedNote seed={seed} />
      </div>}
      right={<div className={`${card} space-y-2`}>
        <Plot xd={[lo, hi]} yd={[0, 0.45]} label={`Null distribution centred at 0 and alternative centred at ${f(shift, 2)}, with critical values at plus and minus ${f(zc, 2)}. Power ${f(sim.powerExact, 3)}.`} xLabel="standardised mean (z scale)">
          {(sx, sy) => <>
            <path d={areaOf(pdf0, lo, -zc, sx, sy) + areaOf(pdf0, zc, hi, sx, sy)} fill="#ef4444" opacity={0.45} />
            <path d={areaOf(pdf1, -zc, zc, sx, sy)} fill="#f59e0b" opacity={0.4} />
            <path d={areaOf(pdf1, zc, hi, sx, sy)} fill="#14b8a6" opacity={0.35} />
            <path d={pathOf(pts(pdf0), sx, sy)} fill="none" stroke="#6366f1" strokeWidth={2} /><path d={pathOf(pts(pdf1), sx, sy)} fill="none" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="5 3" />
            {[-zc, zc].map((c) => <line key={c} x1={sx(c)} x2={sx(c)} y1={8} y2={sy(0)} stroke="currentColor" strokeDasharray="3 3" />)}
          </>}
        </Plot>
        <p className="text-xs text-ink-faint">Solid: sampling distribution if H0 is true. Dashed: if the shift is real. Red: Type I error (reject a true H0), amber: Type II error (miss a real shift), teal: power.</p>
        <table className="w-full text-sm tabular-nums" aria-label="Error rates"><thead><tr className="text-left text-xs text-ink-muted"><th /><th>Exact</th><th>Simulated ({sim.reps} tests each)</th></tr></thead><tbody>
          <tr><th className="text-left font-normal text-ink-muted">Type I error rate</th><td>{f(sim.typeIExact, 3)} (= alpha)</td><td>{f(sim.typeIRate, 3)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Power (1 - Type II)</th><td>{f(sim.powerExact, 3)}</td><td>{f(sim.powerSim, 3)}</td></tr>
          <tr><th className="text-left font-normal text-ink-muted">Type II error rate</th><td>{f(1 - sim.powerExact, 3)}</td><td>{f(sim.typeIISim, 3)}</td></tr></tbody></table>
        <p role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">With the null true, {f(sim.typeIRate * 100, 1)}% of {sim.reps} simulated tests rejected: Type I errors, close to alpha = {f(alpha * 100, 1)}%. With the shift real, the test rejected {f(sim.powerSim * 100, 1)}% of the time (power) and missed it {f(sim.typeIISim * 100, 1)}% of the time (Type II). {delta === 0 ? "With no real shift, power equals alpha: every rejection is a false positive." : sim.powerExact < 0.8 ? "Power is below the usual 80% target: raise n, hope for a larger effect, or accept a higher alpha." : "Power is at or above the usual 80% target."} Lowering alpha reduces Type I errors and raises Type II errors.</p>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. Correlation and regression
// ---------------------------------------------------------------------------------------------------------------------

function RelationshipsSection({ mode }: { mode?: string }) {
  const [setId, setSetId] = useState<S.RelationSet>(S.RELATION_SETS.some((s) => s.id === mode) ? (mode as S.RelationSet) : "linear");
  const meta = S.RELATION_SETS.find((s) => s.id === setId)!;
  const [pts, setPts] = useState<S.Pt[]>(() => S.relationPoints(setId));
  const [selected, setSelected] = useState<number | null>(null);
  const [showResid, setShowResid] = useState(false);
  const temps = useMemo(() => S.causationData().temps, []);
  const choose = (id: S.RelationSet) => { setSetId(id); setPts(S.relationPoints(id)); setSelected(null); };
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), n = pts.length;
  const ok = n >= 3 && new Set(xs).size > 1 && new Set(ys).size > 1;
  const fit = ok ? S.ols(pts) : null;
  const r = ok ? S.pearson(xs, ys) : NaN, rho = ok ? S.spearman(xs, ys) : NaN;
  const without = useMemo(() => {
    if (selected === null || n < 4) return null;
    const rest = pts.filter((_, i) => i !== selected);
    if (new Set(rest.map((p) => p.x)).size < 2 || new Set(rest.map((p) => p.y)).size < 2) return null;
    return { fit: S.ols(rest), r: S.pearson(rest.map((p) => p.x), rest.map((p) => p.y)), rho: S.spearman(rest.map((p) => p.x), rest.map((p) => p.y)) };
  }, [pts, selected, n]);
  const partial = setId === "causation" && n === temps.length && ok ? S.partialCorrelation(xs, ys, temps) : null;
  const [xlo, xhi] = [Math.min(...xs, 0), Math.max(...xs) * 1.05 + 1], [ylo, yhi] = [Math.min(...ys, 0), Math.max(...ys) * 1.1 + 1];
  const svgRef = useRef<SVGSVGElement>(null), dragging = useRef<number | null>(null);
  const move = (i: number, x: number, y: number) => setPts((p) => p.map((q, k) => (k === i ? { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } : q)));
  const fromEvent = (e: React.PointerEvent) => { const box = svgRef.current!.getBoundingClientRect(), W = 520, L = 34, R = 10, T = 8, B = 28, h = 240; const px = ((e.clientX - box.left) / box.width) * W, py = ((e.clientY - box.top) / box.height) * h; return { x: xlo + ((px - L) / (W - L - R)) * (xhi - xlo), y: ylo + (1 - (py - T) / (h - T - B)) * (yhi - ylo) }; };
  const stepX = (xhi - xlo) / 100, stepY = (yhi - ylo) / 100;
  const key = (i: number, e: React.KeyboardEvent) => {
    const p = pts[i], d: Record<string, [number, number]> = { ArrowLeft: [-stepX, 0], ArrowRight: [stepX, 0], ArrowUp: [0, stepY], ArrowDown: [0, -stepY] };
    if (d[e.key]) { e.preventDefault(); move(i, p.x + d[e.key][0], p.y + d[e.key][1]); }
    else if ((e.key === "Delete" || e.key === "Backspace") && setId !== "causation" && n > 3) { e.preventDefault(); setPts((q) => q.filter((_, k) => k !== i)); setSelected(null); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(i); }
  };
  const strength = (v: number) => { const a = Math.abs(v); return a >= 0.8 ? "strong" : a >= 0.5 ? "moderate" : a >= 0.3 ? "weak" : "very weak or none"; };
  return (
    <VisualShell
      left={<div className={`${card} space-y-2`}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Data set">{S.RELATION_SETS.map((s) => <button key={s.id} type="button" aria-pressed={s.id === setId} className={chip(s.id === setId)} onClick={() => choose(s.id)}>{s.label}</button>)}</div>
        <p className="text-sm text-ink-muted">{meta.note}</p>
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">Points</h3><ProvenanceBadge p="executed" /><span className="text-xs text-ink-faint">{setId === "causation" ? "fixture simulated with a seed" : "start data simulated with a seed"}; statistics are computed from the points shown</span></div>
        <div className="max-h-52 overflow-auto rounded-lg border border-surface-border">
          <table className="w-full text-xs"><thead className="sticky top-0 bg-surface-raised"><tr className="text-left text-ink-muted"><th className="p-1">#</th><th className="p-1">{meta.xLabel}</th><th className="p-1">{meta.yLabel}</th><th className="p-1"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{pts.map((p, i) => <tr key={i} className={selected === i ? "bg-accent/10" : ""}><td className="p-1 text-ink-muted">{i + 1}</td>
              <td className="p-1"><input type="number" aria-label={`Point ${i + 1} x`} value={p.x} step="any" onChange={(e) => move(i, Number(e.target.value), p.y)} className={num} /></td>
              <td className="p-1"><input type="number" aria-label={`Point ${i + 1} y`} value={p.y} step="any" onChange={(e) => move(i, p.x, Number(e.target.value))} className={num} /></td>
              <td className="p-1 whitespace-nowrap"><button type="button" className={chip(selected === i)} aria-pressed={selected === i} onClick={() => setSelected(selected === i ? null : i)}>{selected === i ? "Selected" : "Select"}</button>{setId !== "causation" && n > 3 && <button type="button" className={`${chip(false)} ml-1`} aria-label={`Delete point ${i + 1}`} onClick={() => { setPts((q) => q.filter((_, k) => k !== i)); setSelected(null); }}>x</button>}</td></tr>)}</tbody></table>
        </div>
        <div className="flex flex-wrap gap-1">
          {setId !== "causation" && <button type="button" className={chip(false)} onClick={() => { setPts((q) => [...q, { x: Math.round(xhi * 0.9), y: Math.round(yhi * 0.1) }]); setSelected(n); }}>Add an outlier point</button>}
          <button type="button" className={chip(false)} onClick={() => choose(setId)}>Reset data</button>
          <label className="flex items-center gap-1 text-xs text-ink-muted"><input type="checkbox" checked={showResid} onChange={(e) => setShowResid(e.target.checked)} />Residual plot</label>
        </div>
      </div>}
      right={<div className="space-y-3">
        <div className={card}>
          <svg ref={svgRef} viewBox="0 0 520 240" role="img" aria-label={`Scatter plot of ${n} points${fit ? ` with the least squares line y = ${f(fit.intercept, 3)} + ${f(fit.slope, 3)} x. r = ${f(r, 3)}.` : "."} Drag a point, or focus it and use the arrow keys.`} className="w-full touch-none text-ink-muted"
            onPointerMove={(e) => { if (dragging.current !== null) { const c = fromEvent(e); move(dragging.current, c.x, c.y); } }} onPointerUp={() => { dragging.current = null; }} onPointerLeave={() => { dragging.current = null; }}>
            {(() => {
              const W = 520, L = 34, R = 10, T = 8, B = 28, h = 240, sx = (x: number) => L + ((x - xlo) / (xhi - xlo)) * (W - L - R), sy = (y: number) => T + (1 - (y - ylo) / (yhi - ylo)) * (h - T - B);
              return <>
                <line x1={L} x2={W - R} y1={sy(ylo)} y2={sy(ylo)} stroke="currentColor" opacity={0.5} /><line x1={L} x2={L} y1={T} y2={sy(ylo)} stroke="currentColor" opacity={0.5} />
                {[xlo, xhi].map((x, i) => <text key={i} x={sx(x)} y={h - 14} textAnchor={i ? "end" : "start"} fontSize={10} fill="currentColor">{f(x, 1)}</text>)}{[ylo, yhi].map((y, i) => <text key={i} x={L - 4} y={sy(y) + 3} textAnchor="end" fontSize={10} fill="currentColor">{f(y, 1)}</text>)}
                <text x={(L + W - R) / 2} y={h - 2} textAnchor="middle" fontSize={10} fill="currentColor">{meta.xLabel}</text>
                {fit && <line x1={sx(xlo)} x2={sx(xhi)} y1={sy(fit.intercept + fit.slope * xlo)} y2={sy(fit.intercept + fit.slope * xhi)} stroke="#ef4444" strokeWidth={2} />}
                {without && selected !== null && <line x1={sx(xlo)} x2={sx(xhi)} y1={sy(without.fit.intercept + without.fit.slope * xlo)} y2={sy(without.fit.intercept + without.fit.slope * xhi)} stroke="#14b8a6" strokeWidth={2} strokeDasharray="5 3" />}
                {fit && showResid && pts.map((p, i) => <line key={`e${i}`} x1={sx(p.x)} x2={sx(p.x)} y1={sy(p.y)} y2={sy(fit.fitted[i])} stroke="#f59e0b" />)}
                {pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={selected === i ? 7 : 5} fill={selected === i ? "#f59e0b" : "#6366f1"} stroke="white" strokeWidth={1} tabIndex={0} role="button" className="cursor-grab outline-offset-2 focus-visible:outline focus-visible:outline-2"
                  aria-label={`Point ${i + 1}: ${meta.xLabel} ${f(p.x, 2)}, ${meta.yLabel} ${f(p.y, 2)}. Arrow keys move it, Enter selects it${setId !== "causation" ? ", Delete removes it" : ""}.`}
                  onPointerDown={(e) => { e.preventDefault(); dragging.current = i; setSelected(i); (e.target as Element).setPointerCapture?.(e.pointerId); }} onKeyDown={(e) => key(i, e)} onFocus={() => setSelected(i)} />)}
              </>;
            })()}
          </svg>
          <p className="text-xs text-ink-faint"><span className="text-[#ef4444]">Red</span>: least-squares line.{without ? <> <span className="text-[#14b8a6]">Teal dashed</span>: the line without the selected point.</> : ""} Amber ticks (when shown): residuals.</p>
        </div>
        <div className={`${card} space-y-2`}>
          {fit ? <>
            <table className="w-full text-sm tabular-nums" aria-label="Correlation and regression results"><tbody>
              <tr><th className="text-left font-normal text-ink-muted">Pearson r (linear)</th><td>{f(r, 3)}</td><th className="text-left font-normal text-ink-muted">p-value</th><td>{pf(S.corrPValue(r, n))}</td></tr>
              <tr><th className="text-left font-normal text-ink-muted">Spearman rho (rank, monotonic)</th><td>{f(rho, 3)}</td><th className="text-left font-normal text-ink-muted">p-value</th><td>{pf(S.corrPValue(rho, n))}</td></tr>
              <tr><th className="text-left font-normal text-ink-muted">Slope</th><td>{f(fit.slope, 3)}</td><th className="text-left font-normal text-ink-muted">Intercept</th><td>{f(fit.intercept, 3)}</td></tr>
              <tr><th className="text-left font-normal text-ink-muted">R squared</th><td>{f(fit.r2, 3)}</td><th className="text-left font-normal text-ink-muted">Residual sd</th><td>{f(fit.sRes, 3)}</td></tr>
            </tbody></table>
            <p role="status" aria-live="polite" className="rounded-lg bg-surface-soft p-2 text-sm text-ink">{n} points: r = {f(r, 3)} ({strength(r)} {r >= 0 ? "positive" : "negative"} linear association), rho = {f(rho, 3)}. Line: y = {f(fit.intercept, 2)} + {f(fit.slope, 2)} x, so each extra unit of x goes with {f(fit.slope, 2)} units of y on average. R squared = {f(fit.r2, 3)}: the line accounts for {f(fit.r2 * 100, 1)}% of the variation in y.
              {without && selected !== null ? ` Without point ${selected + 1}: r = ${f(without.r, 3)}, rho = ${f(without.rho, 3)}, slope = ${f(without.fit.slope, 3)}, R squared = ${f(without.fit.r2, 3)}. Removing it changes the slope by ${f(without.fit.slope - fit.slope, 3)} and Pearson r by ${f(without.r - r, 3)}, Spearman rho by ${f(without.rho - rho, 3)}.` : ""}</p>
          </> : <p className="text-sm text-ink-muted">Need at least 3 points with some variation in both x and y.</p>}
          {showResid && fit && <>
            <Plot xd={[xlo, xhi]} yd={[Math.min(...fit.residuals, 0), Math.max(...fit.residuals, 0.001)]} h={150} label="Residual plot: residuals against x. A pattern means the line is the wrong shape; a random cloud around zero is what a good fit looks like.">
              {(sx, sy) => <><line x1={sx(xlo)} x2={sx(xhi)} y1={sy(0)} y2={sy(0)} stroke="currentColor" strokeDasharray="3 3" />{pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(fit.residuals[i])} r={3.5} fill="#f59e0b" />)}</>}
            </Plot>
            <p className="text-xs text-ink-muted">Residual = actual y minus the line's y. They sum to 0 ({f(S.sum(fit.residuals), 6)}). A curve or a funnel shape in this plot warns that linearity or constant spread fails. Largest residual: {f(Math.max(...fit.residuals.map(Math.abs)), 2)} at point {fit.residuals.map(Math.abs).indexOf(Math.max(...fit.residuals.map(Math.abs))) + 1}.</p>
          </>}
          {partial !== null && <div className="rounded-lg border border-warn/50 bg-warn-dim p-2 text-sm text-ink" role="note"><p className="font-semibold">Correlation is not causation</p>
            <p>Ice cream sales and drownings move together (r = {f(r, 2)}). Neither causes the other: hot weather raises both, a confounder. In this fixture, temperature was built in as the common cause. After removing what temperature explains from each series, the correlation falls to {f(partial, 2)}. Other explanations to rule out before claiming a cause: reverse causation, coincidence, and a lurking third variable. Only a well-designed experiment, or careful causal analysis, supports "X causes Y".</p></div>}
          {setId === "outlier" && <p className="text-xs text-ink-muted">Select the last point (x = 16) and compare the red and dashed teal lines. Spearman uses ranks, so a single wild value moves it far less than Pearson.</p>}
        </div>
      </div>}
      bottom={null}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Lab shell
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Statistics Lab: distributions, summaries, probability, sampling, intervals, tests and regression. Statistics shown for the
 * data on screen are computed (Executed); random draws are Simulated and use the seed below, so every run is reproducible.
 */
export function StatsLab({ preset }: { preset?: string }) {
  const start = S.presetById(preset);
  const [tab, setTab] = useState<S.StatsTab>(start?.tab ?? "distributions");
  const [seed, setSeed] = useState(2024);
  const reduced = useReducedMotion();
  const mode = start?.mode;
  const [panel, setPanel] = useState(0); // remount a section when the same preset is picked again
  useEffect(() => { if (start) setTab(start.tab); }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section aria-label="Statistics Lab" data-preset={preset} data-reduced-motion={reduced ? "true" : "false"} className="space-y-3">
      <div className={`${card} flex flex-wrap items-center gap-3 text-xs text-ink-muted`}>
        <span className="font-semibold text-ink">Statistics Lab</span>
        <ProvenanceBadge p="executed" /><ProvenanceBadge p="simulated" />
        <span>Numbers from the data on screen are computed exactly (Executed). Random draws are Simulated and fully reproducible.</span>
        <label className="ml-auto flex items-center gap-1">Seed <input type="number" value={seed} aria-label="Random seed" onChange={(e) => setSeed(Math.max(0, Math.round(Number(e.target.value))))} className={num} /></label>
        <button type="button" className={chip(false)} onClick={() => { setSeed((s) => s + 1); setPanel((p) => p + 1); }}>New seed</button>
      </div>
      <div role="tablist" aria-label="Statistics topics" className="flex flex-wrap gap-1">
        {S.TABS.map((t) => <button key={t.id} id={`stats-tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls="stats-panel" tabIndex={tab === t.id ? 0 : -1} className={chip(tab === t.id)} onClick={() => setTab(t.id)}
          onKeyDown={(e) => { const i = S.TABS.findIndex((x) => x.id === tab); if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const next = S.TABS[(i + (e.key === "ArrowRight" ? 1 : S.TABS.length - 1)) % S.TABS.length]; setTab(next.id); document.getElementById(`stats-tab-${next.id}`)?.focus(); } }}>{t.label}</button>)}
      </div>
      <div id="stats-panel" role="tabpanel" aria-labelledby={`stats-tab-${tab}`} key={`${tab}-${panel}`}>
        {tab === "distributions" && <DistributionsSection seed={seed} mode={mode} />}
        {tab === "summary" && <SummarySection seed={seed} mode={mode} />}
        {tab === "probability" && <ProbabilitySection seed={seed} mode={mode} />}
        {tab === "sampling" && <SamplingSection seed={seed} mode={mode} />}
        {tab === "intervals" && <IntervalsSection seed={seed} mode={mode} />}
        {tab === "tests" && <TestsSection seed={seed} mode={mode} />}
        {tab === "relationships" && <RelationshipsSection mode={mode} />}
      </div>
      <p className="text-xs text-ink-faint">Teaching tool: the sample data and populations are fixed or seeded fixtures, not real measurements. A p-value or interval here follows the textbook formulas the lessons teach, and says nothing about causes.</p>
    </section>
  );
}
