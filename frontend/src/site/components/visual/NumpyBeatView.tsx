import { memo, type ReactNode } from "react";
import type { DataBeat } from "../../lib/visual/dataBeats";
import type { DataStage, StageAnalysis } from "../../lib/visual/dataframe";
import { pyShape } from "../../lib/visual/broadcast";
import { MOTION } from "../../lib/motion";
import { unravel } from "../../lib/visual/ndarray";
import type { AlignView, ArraysView, AxisView, CalcCell, ComputeView, ErrorView, ExpandView, LanesView, MaskView, MatmulCellView, MatmulRuleView, MoveView, NumpyView, ResultView, SelectView, ShapesView } from "../../lib/visual/numpyBeats";
import { CELL, groupTone, LabelChip, MatGrid, Panel, reveal, TONE_CLASS } from "./NumpyParts";

/**
 * Draws a NumPy beat (see lib/visual/numpyBeats.ts for what each beat is and where its data comes from). It only draws: every
 * grid, shape and calculation comes from the beat's view, which was derived once from the stage's recorded arrays. Stepping
 * back and forth re-renders the same data, nothing runs.
 *
 * `DataStageViewer` calls this as a plain function, so it must not use hooks itself: it returns a real component, keyed by the beat,
 * so the entrance animation replays when the step changes and never otherwise. Reduced motion draws the same grids with no animation.
 */
export function NumpyBeatView({ beat, reducedMotion }: { beat: DataBeat; stage: DataStage; analysis: StageAnalysis; reducedMotion: boolean }): ReactNode {
  if (beat.view.owner !== "numpy") return null;
  return <NumpyPicture key={beat.id} view={beat.view as NumpyView} reduced={reducedMotion} />;
}

const show = (c: string | null | undefined) => (c === null || c === undefined ? "NaN" : c);
const coords = (c: readonly number[]) => `[${c.join(", ")}]`;

function NumpyPicture({ view, reduced }: { view: NumpyView; reduced: boolean }) {
  return (
    <div data-testid="np-picture" data-np-view={view.type} data-motion={reduced ? "reduced" : "full"} className="min-w-0 space-y-3 rounded-xl border border-surface-border bg-surface-raised p-3">
      <Body view={view} reduced={reduced} />
    </div>
  );
}

function Body({ view, reduced }: { view: NumpyView; reduced: boolean }) {
  switch (view.type) {
    case "arrays": return <Arrays v={view} reduced={reduced} />;
    case "shapes": return <Shapes v={view} reduced={reduced} />;
    case "align": return <Align v={view} reduced={reduced} />;
    case "expand": return <Expand v={view} reduced={reduced} />;
    case "compute": return <Compute v={view} reduced={reduced} />;
    case "result": return <Result v={view} reduced={reduced} />;
    case "error": return <ErrorPanel v={view} />;
    case "mm-rule": return <MatmulRule v={view} />;
    case "mm-cell": return <MatmulCell v={view} reduced={reduced} />;
    case "axis": return <Axis v={view} reduced={reduced} />;
    case "lanes": return <Lanes v={view} reduced={reduced} />;
    case "select": return <Select v={view} reduced={reduced} />;
    case "mask": return <Mask v={view} reduced={reduced} />;
    case "move": return <Move v={view} reduced={reduced} />;
  }
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3">{children}</div>;
const Hint = ({ children }: { children: ReactNode }) => <p className="text-xs text-ink-muted">{children}</p>;
const Failure = ({ problems, what }: { problems: string[]; what: string }) => (
  <Panel tone="danger" testid="np-consistency-failed">
    <p className="text-sm font-semibold text-danger">Consistency check failed: {what} is not drawn.</p>
    <ul className="mt-1 list-inside list-disc text-xs text-danger">{problems.slice(0, 3).map((p) => <li key={p}>{p}</li>)}</ul>
    <p className="mt-1 text-[11px] text-ink-muted">The values in the real arrays below are still the recorded ones.</p>
  </Panel>
);

// ── Broadcasting ──────────────────────────────────────────────────────────────

function Arrays({ v, reduced }: { v: ArraysView; reduced: boolean }) {
  return (
    <Row>
      {v.items.map((it) => (
        <div key={it.label} className="min-w-0 max-w-full" data-np-operand={it.label}>
          <LabelChip label={it.label} expr={it.expr} shape={it.mat.shape} />
          <MatGrid mat={it.mat} name={it.label} reduced={reduced} />
        </div>
      ))}
    </Row>
  );
}

function Shapes({ v }: { v: ShapesView; reduced?: boolean }) {
  return (
    <Row>
      {v.items.map((it) => (
        <div key={it.label} className="min-w-[8rem] rounded-lg border border-surface-border bg-surface-soft/60 p-3" data-np-shape={it.label}>
          <p className="text-xs"><span className="rounded bg-accent-dim px-1.5 py-0.5 font-bold text-ink">{it.label}</span> <span className="text-ink-faint">{it.scalar ? "scalar" : `${it.shape.length}-D`}</span></p>
          <p className="mt-1 font-mono text-2xl font-bold text-ink" data-np-shape-text>{pyShape(it.shape)}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
            {it.shape.length === 0 ? <li className="text-ink-faint">no axes</li> : it.shape.map((n, d) => <li key={d} className="rounded border border-surface-border px-1.5 py-0.5 font-mono text-ink">axis {d} · {n}</li>)}
          </ul>
          <p className="mt-1 text-[11px] text-ink-faint">size {it.size} · {it.dtype}</p>
        </div>
      ))}
    </Row>
  );
}

const STATUS_WORD = { equal: "equal", stretch: "stretch the 1", missing: "added as 1", incompatible: "no match" } as const;

/** Shapes lined up on the right, one column per axis. The pairs appear from the last axis to the first, the order NumPy checks them in. */
function Align({ v, reduced }: { v: AlignView; reduced: boolean }) {
  const t = v.table;
  const nd = t.ndim;
  const cols = Array.from({ length: nd }, (_, j) => j); // left to right
  const fromRight = (j: number) => nd - 1 - j;
  // The pairs appear one after the other, right to left: a slightly longer step than the grids use, still capped.
  const delay = (j: number) => reveal(reduced, fromRight(j), MOTION.fast, 4);
  const okTable = t.valid;
  return (
    <div className="min-w-0 space-y-2" data-np-valid={okTable ? "true" : "false"}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Broadcasting</p>
      <div className="max-w-full overflow-x-auto">
        <table className="border-collapse text-left" aria-label="Shapes lined up from the right">
          <caption className="mb-1 text-left text-xs font-medium text-ink-muted">Lined up from the right: the last axis is compared first.</caption>
          <thead>
            <tr>
              <th scope="col" className={`${CELL} bg-surface-soft`}> </th>
              {cols.map((j) => <th key={j} scope="col" data-np-axis={-(fromRight(j) + 1)} className={`${CELL} bg-surface-soft font-semibold`}>axis {-(fromRight(j) + 1)}<span className="block text-[9px] font-normal text-ink-faint">checked {fromRight(j) + 1}{fromRight(j) === 0 ? "st" : fromRight(j) === 1 ? "nd" : fromRight(j) === 2 ? "rd" : "th"}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {t.shapes.map((s, i) => (
              <tr key={i}>
                <th scope="row" className={`${CELL} bg-surface-soft font-bold`}>{v.labels[i]} <span className="font-mono font-normal text-ink-faint">{pyShape(s)}</span></th>
                {cols.map((j) => {
                  const cell = t.rows[fromRight(j)].cells[i];
                  const bad = cell.status === "incompatible";
                  const added = cell.status === "missing";
                  return (
                    <td key={j} data-np-cell={`${i},${j}`} data-status={cell.status} style={delay(j)} title={`${v.labels[i]} axis ${-(fromRight(j) + 1)}: ${cell.size ?? 1} (${STATUS_WORD[cell.status]})`}
                      className={`${CELL} ${bad ? TONE_CLASS.danger : cell.status === "stretch" || added ? `${TONE_CLASS.repeat}` : ""} ${added ? "italic" : ""}`}>
                      {cell.size ?? 1}{added ? <span className="block text-[9px] font-normal">added</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" className={`${CELL} bg-surface-soft font-bold`}>Result <span className="font-mono font-normal text-ink-faint">{t.resultShape ? pyShape(t.resultShape) : "none"}</span></th>
              {cols.map((j) => {
                const r = t.rows[fromRight(j)];
                return <td key={j} data-np-result={r.status} style={delay(j)} className={`${CELL} ${r.status === "incompatible" ? TONE_CLASS.danger : "font-semibold"}`}>{r.resultSize === null ? "✕" : r.resultSize}<span className="block text-[9px] font-normal">{r.status === "incompatible" ? "conflict" : r.status === "stretched" ? "stretched" : "equal"}</span></td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className={`text-xs ${okTable ? "text-ink-muted" : "text-danger"}`} data-np-verdict><span className="font-semibold">{okTable ? "Compatible." : "Not compatible."}</span> {t.message}</p>
    </div>
  );
}

function Expand({ v, reduced }: { v: ExpandView; reduced: boolean }) {
  return (
    <div className="space-y-2">
      <Row>
        {v.items.map((it) => {
          let n = 0;
          const orders = it.repeated.map((row) => row.map((r) => (r ? n++ : null)));
          return (
            <div key={it.label} className="min-w-0 max-w-full" data-np-expanded={it.label} data-changed={it.changed ? "true" : "false"}>
              <LabelChip label={it.label} shape={it.from} />
              <p className="mb-1 text-[11px] text-ink-faint">{it.changed ? `becomes ${pyShape(it.to)}${it.padded.length !== it.from.length ? ` (first treated as ${pyShape(it.padded)})` : ""}` : `already ${pyShape(it.to)}`}</p>
              <MatGrid mat={it.mat} name={`${it.label} stretched`} reduced={reduced} bare
                tone={(r, c) => (it.repeated[r][c] ? "repeat" : it.changed ? "orig" : "plain")} tag={(r, c) => (it.repeated[r][c] ? "copy" : it.changed ? "original" : undefined)}
                order={(r, c) => orders[r][c]} />
            </div>
          );
        })}
      </Row>
      <Hint>Outlined cells are the stored values; dashed, shaded cells are the same values repeated by broadcasting (no memory is copied).{v.windowed ? ` Window of the real ${pyShape(v.resultShape)} shape.` : ""}</Hint>
    </div>
  );
}

const CalcCellView = memo(function CalcCellView({ c, order, reduced }: { c: CalcCell; order: number; reduced: boolean }) {
  return (
    <td data-np-calc={c.coords.join(",")} title={`result${coords(c.coords)}: ${c.text}`} style={reveal(reduced, order)} className={`${CELL} min-w-[4.5rem] bg-surface-soft/60 text-ink`}>
      <span className="block text-[9px] font-normal text-ink-faint">{coords(c.coords)}</span>
      <span className="block whitespace-nowrap font-mono text-[11px] text-ink-muted" data-np-formula>{c.text.slice(0, c.text.lastIndexOf(" = "))}</span>
      <span className="block font-semibold">= {show(c.res)}</span>
    </td>
  );
});

function Compute({ v, reduced }: { v: ComputeView; reduced: boolean }) {
  if (!v.ok) return <Failure problems={v.problems} what="the calculation" />;
  const byPos = new Map(v.cells.map((c) => [c.coords.join(","), c]));
  const nd = v.grid.shape.length;
  const cols = v.grid.cells[0]?.length ?? 0;
  return (
    <div className="min-w-0 space-y-2">
      <div className="max-w-full overflow-x-auto">
        <table className="border-collapse text-left" aria-label={`Every result cell with its calculation, ${v.cells.length} cells`} data-np-compute>
          <thead>
            <tr>
              <th scope="col" className={`${CELL} bg-surface-soft text-[10px] font-normal text-ink-faint`}>{nd === 2 ? "axis 0 ↓" : "axis 0 →"}</th>
              {Array.from({ length: cols }, (_, c) => <th key={c} scope="col" className={`${CELL} bg-surface-soft font-semibold`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {v.grid.cells.map((row, r) => (
              <tr key={r}>
                <th scope="row" className={`${CELL} bg-surface-soft font-medium`}>{nd === 2 ? r : ""}</th>
                {row.map((_, c) => {
                  const cell = byPos.get((nd === 1 ? [c] : [r, c]).join(","));
                  return cell ? <CalcCellView key={c} c={cell} order={r * cols + c} reduced={reduced} /> : <td key={c} className={`${CELL} text-ink-faint`}>·</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Hint>Each cell: the two stretched values at that position, the operation ({v.sym}), and NumPy's real result.{v.grid.windowed ? ` Window of the real ${pyShape(v.grid.shape)} result: ${v.total} cells in all.` : ""}</Hint>
    </div>
  );
}

function Result({ v, reduced }: { v: ResultView; reduced: boolean }) {
  const o = v.origins;
  return (
    <div className="min-w-0 space-y-2">
      {!v.ok && <Failure problems={v.problems} what="the position of each cell" />}
      {v.out.scalar ? (
        <p className="font-mono text-3xl font-bold text-ink" data-np-scalar>{show(v.out.cells[0][0])} <span className="text-xs font-normal text-ink-faint">{v.dtype}</span></p>
      ) : (
        <MatGrid mat={v.out} name={v.name} reduced={reduced} caption={<>Result <code className="font-mono">{v.name}</code> · shape <span data-np-result-shape>{pyShape(v.shape)}</span></>}
          tag={o ? (r, c) => { const x = o[r]?.[c]; return x ? `←${coords(x)}` : undefined; } : undefined} />
      )}
      {v.memory && <p className="text-xs text-ink-muted" data-np-memory={v.memory}>{v.memory === "view" ? "A view: it shares memory with the input." : "A copy: it has its own memory."}</p>}
    </div>
  );
}

function ErrorPanel({ v }: { v: ErrorView }) {
  return (
    <Panel tone="danger" testid="np-error" matmulInvalid={v.matmul}>
      <p className="text-xs font-semibold text-danger">NumPy said:</p>
      <p className="mt-1 break-words font-mono text-sm text-danger" data-np-error-text>{v.errorType}: {v.message.trim()}</p>
      <p className="mt-2 text-xs text-ink" data-np-error-reason><span className="font-semibold">Why: </span>{v.reason}.</p>
    </Panel>
  );
}

// ── Matrix multiplication ─────────────────────────────────────────────────────

function MatmulRule({ v }: { v: MatmulRuleView }) {
  const bad = !v.valid;
  const chip = (shape: number[], innerAt: number) => (
    <span className="font-mono text-lg font-bold text-ink">(
      {shape.map((n, d) => <span key={d}>{d > 0 ? ", " : ""}<span className={d === innerAt ? `rounded px-1 ${bad ? "bg-danger-dim text-danger" : "bg-accent-dim"}` : ""} data-np-inner={d === innerAt ? "true" : undefined}>{n}</span></span>)}
      {shape.length === 1 ? "," : ""})</span>
  );
  return (
    <div className="min-w-0 space-y-2" data-np-valid={v.valid ? "true" : "false"} data-matmul-valid={v.valid ? "true" : "false"}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-bold text-ink">A</span>{chip(v.a, v.a.length - 1)}
        <span className="font-mono text-lg text-ink-muted">@</span>
        <span className="text-xs font-bold text-ink">B</span>{chip(v.b, v.b.length === 1 ? 0 : v.b.length - 2)}
        <span className="font-mono text-lg text-ink-muted">{v.valid ? "→" : "✕"}</span>
        {v.valid ? <span className="font-mono text-lg font-bold text-ink" data-np-rule-result>{pyShape(v.result!)}</span> : <span className="text-sm font-semibold text-danger">no result</span>}
      </p>
      {v.inner && <p className={`text-xs ${bad ? "text-danger" : "text-ink-muted"}`} data-np-inner-text>Inner sizes: A's last axis = <b>{v.inner.a}</b>, B's {v.b.length === 1 ? "only axis" : "first axis"} = <b>{v.inner.b}</b> — {bad ? "they must be equal, and they are not." : "equal, so they are summed away."}</p>}
    </div>
  );
}

function MatmulCell({ v, reduced }: { v: MatmulCellView; reduced: boolean }) {
  if (!v.ok) return <Failure problems={v.problems} what="the multiplication" />;
  const isDone = (r: number, c: number) => v.done.some((d) => (v.out.shape.length === 2 ? d[0] === r && d[1] === c : d.length === 1 ? d[0] === c : true));
  const isNow = (r: number, c: number) => (v.out.shape.length === 2 ? v.outCoords[0] === r && v.outCoords[1] === c : v.outCoords.length === 1 ? v.outCoords[0] === c : true);
  return (
    <div className="min-w-0 space-y-3" data-np-mm-cell={v.outCoords.join(",")}>
      <Row>
        <MatGrid mat={v.a} name="A" reduced={reduced} bare caption={<>A · {v.row === null ? "the whole vector" : <>row <b>{v.row}</b></>}</>}
          tone={(r) => (v.row === null || r === v.row ? "g0" : "dim")} order={() => null} />
        <MatGrid mat={v.b} name="B" reduced={reduced} bare caption={<>B · {v.col === null ? "the whole vector" : <>column <b>{v.col}</b></>}</>}
          tone={(_, c) => (v.col === null || c === v.col ? "g1" : "dim")} order={() => null} />
        <MatGrid mat={v.out} name="result" reduced={reduced} bare caption={<>result · {v.outCoords.length ? <>cell <b>{coords(v.outCoords)}</b></> : "the number"}</>}
          tone={(r, c) => (isNow(r, c) ? "now" : isDone(r, c) ? "done" : "dim")} hidden={(r, c) => !isNow(r, c) && !isDone(r, c)} order={(r, c) => (isNow(r, c) ? 0 : null)} />
      </Row>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-xs" aria-label="Products being added" data-np-products>
        {v.aVals.map((a, k) => (
          <li key={k} className="flex items-center gap-1">
            {k > 0 && <span className="text-ink-faint">+</span>}
            <span style={reveal(reduced, k)} className="rounded border border-surface-border bg-surface-soft px-1.5 py-0.5 text-ink" data-np-term={k} title={`${show(a)} × ${show(v.bVals[k])} = ${v.products[k]}`}>
              <span className="bg-accent-dim px-0.5">{show(a)}</span> × <span className="bg-success-dim px-0.5">{show(v.bVals[k])}</span> <span className="text-ink-faint">= {v.products[k]}</span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-1"><span className="text-ink-faint">=</span><span className="rounded bg-accent-dim px-1.5 py-0.5 text-sm font-bold text-ink" data-np-sum>{show(v.sum)}</span></li>
      </ol>
      <p className="text-[11px] text-ink-faint" data-np-sample={v.sampled ? "sampled" : "all"}>
        {v.sampled ? `Sampled: this walks through ${v.seqOf} of the ${v.total} output cells (the first ${v.seqOf} in reading order); every other cell follows the same rule.` : `Cell ${v.seq + 1} of ${v.seqOf}: every output cell is walked through.`}
      </p>
    </div>
  );
}

// ── Axis reductions ───────────────────────────────────────────────────────────

function Axis({ v, reduced }: { v: AxisView; reduced: boolean }) {
  const nd = v.inShape.length;
  const dir = v.axis === null ? "every cell is combined into one value" : nd === 2 && v.axis.length === 1 ? (v.axis[0] === 0 ? "axis 0 collapses: values are combined down each column" : "axis 1 collapses: values are combined across each row") : `axis ${v.axis.join(" and ")} collapses`;
  const labels = Array.from({ length: Math.min(v.groupCount, 12) }, (_, g) => (v.outShape.length ? `result${coords(unravel(g, v.outShape))}` : "result"));
  return (
    <div className="min-w-0 space-y-2" data-np-axis-view>
      <p className="text-xs font-medium text-ink-muted" data-np-direction>{v.op}: {dir}.</p>
      <MatGrid mat={v.input} name="input" reduced={reduced}
        tone={(r, c) => groupTone(v.groups[r]?.[c] ?? 0)} tag={(r, c) => `→ ${(v.groups[r]?.[c] ?? 0) + 1}`} order={(r, c) => (v.groups[r]?.[c] ?? 0)} />
      <ul className="flex flex-wrap gap-1.5 text-[11px]" aria-label="Which output element each colour feeds">
        {labels.map((l, g) => <li key={g} data-np-group={g + 1} className={`rounded border border-surface-border px-1.5 py-0.5 text-ink ${TONE_CLASS[groupTone(g)]}`}>{g + 1} → {l}</li>)}
        {v.groupCount > labels.length && <li className="text-ink-faint">… {v.groupCount - labels.length} more</li>}
      </ul>
      <Hint>Shape {pyShape(v.inShape)} → {pyShape(v.outShape)}. Cells with the same colour feed the same output element.</Hint>
    </div>
  );
}

function Lanes({ v, reduced }: { v: LanesView; reduced: boolean }) {
  if (!v.ok) return <Failure problems={v.problems} what="the reduction" />;
  return (
    <div className="min-w-0 space-y-2">
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Values that feed each output element" data-np-lanes>
        {v.lanes.map((l, i) => (
          <li key={l.label} data-np-lane={l.out.join(",")} style={reveal(reduced, i)} className={`min-w-0 rounded-lg border border-surface-border p-2 ${TONE_CLASS[groupTone(l.group)]}`}>
            <p className="text-[11px] font-semibold text-ink">{l.label}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1 font-mono text-xs">
              {l.values.map((x, k) => <span key={k} title={`input${coords(l.coords[k])} = ${show(x)}`} className="rounded border border-surface-border bg-surface-raised px-1 text-ink">{show(x)}</span>)}
              <span className="text-ink-faint">→ {v.op} →</span>
              <span className="rounded bg-surface-raised px-1.5 py-0.5 text-sm font-bold text-ink" data-np-lane-result>{show(l.result)}</span>
            </p>
            <p className="sr-only">{l.text}</p>
          </li>
        ))}
      </ul>
      <Hint>{v.sampled ? `Showing ${v.lanes.length} of the ${v.total} output elements; each one is built the same way.` : `All ${v.total} output element${v.total === 1 ? "" : "s"}.`}</Hint>
    </div>
  );
}

// ── Indexing ──────────────────────────────────────────────────────────────────

function Select({ v, reduced }: { v: SelectView; reduced: boolean }) {
  if (!v.ok) return <Failure problems={v.problems} what="the selection" />;
  const is = new Set(v.selected.map((c) => c.join(",")));
  const nd = v.input.shape.length;
  let n = 0;
  const order = v.input.cells.map((row, r) => row.map((_, c) => (is.has((nd === 1 ? [c] : [r, c]).join(",")) ? n++ : null)));
  return (
    <div className="min-w-0 space-y-2" data-np-select={v.mode}>
      <MatGrid mat={v.input} name="input" reduced={reduced}
        tone={(r, c) => (is.has((nd === 1 ? [c] : [r, c]).join(",")) ? "sel" : "dim")} order={(r, c) => order[r][c]}
        tag={(r, c) => (is.has((nd === 1 ? [c] : [r, c]).join(",")) ? "picked" : undefined)} />
      <p className="text-xs text-ink-muted" data-np-picked>
        {v.selected.length ? <>Picked cells: {v.selected.slice(0, 12).map((c) => coords(c)).join(", ")}{v.selected.length > 12 ? ", …" : ""}</> : "No cell in the drawn window is picked."}
        {" "}({v.count} of {v.total} in all.)
      </p>
    </div>
  );
}

function Mask({ v, reduced }: { v: MaskView; reduced: boolean }) {
  if (!v.ok) return <Failure problems={v.problems} what="the mask" />;
  return (
    <div className="min-w-0 space-y-2" data-np-mask>
      <Row>
        <MatGrid mat={v.input} name="input" reduced={reduced} bare caption="array" />
        <MatGrid mat={v.mask} name="mask" reduced={reduced} bare caption={<>mask · {v.trueCount} True in the drawn cells</>} tone={(r, c) => (v.mask.cells[r][c] === "True" ? "sel" : "dim")} />
      </Row>
      <Hint>Cells over a True entry are kept; cells over a False entry are dropped.</Hint>
    </div>
  );
}

// ── Reshape and transpose ─────────────────────────────────────────────────────

function Move({ v, reduced }: { v: MoveView; reduced: boolean }) {
  if (!v.ok) return <Failure problems={v.problems} what="the movement" />;
  const nd = v.input.shape.length;
  const rowOf = (c: number[]) => c[0];
  const dest = new Map(v.moves.map((m) => [m.from.join(","), m.to]));
  const org = new Map(v.moves.map((m) => [m.to.join(","), m]));
  const key = (r: number, c: number, n: number) => (n === 1 ? [c] : [r, c]).join(",");
  const outNd = v.out.shape.length;
  return (
    <div className="min-w-0 space-y-3" data-np-move={v.mode}>
      {v.mode === "regroup" && (
        <div data-np-strip>
          <p className="mb-1 text-xs font-medium text-ink-muted">The elements in order, with their position in the original{v.out.windowed ? " (the first ones)" : ""}</p>
          <ol className="flex flex-wrap gap-1" aria-label="Elements in memory order">
            {v.moves.slice(0, 16).map((m, i) => (
              <li key={i} data-np-elem={m.flat} style={reveal(reduced, i)} className={`rounded border border-surface-border px-1.5 py-0.5 text-center text-xs ${TONE_CLASS[groupTone(rowOf(m.from))]}`}>
                <span className="block text-[9px] text-ink-faint">#{m.flat}</span>{show(m.value)}
              </li>
            ))}
            {v.moves.length > 16 && <li className="px-1 text-xs text-ink-faint">…</li>}
          </ol>
        </div>
      )}
      <Row>
        <MatGrid mat={v.input} name="before" reduced={reduced} caption={`Before ${pyShape(v.input.shape)}`}
          tone={(r) => groupTone(nd === 1 ? 0 : r)} order={() => null}
          tag={(r, c) => { const d = dest.get(key(r, c, nd)); return v.mode === "swap" && d ? `→${coords(d)}` : v.mode === "regroup" ? `#${nd === 1 ? c : r * (v.input.shape[1] ?? 0) + c}` : undefined; }} />
        <MatGrid mat={v.out} name="after" reduced={reduced} caption={`After ${pyShape(v.out.shape)}`}
          tone={(r, c) => { const m = org.get(key(r, c, outNd)); return m ? groupTone(nd === 1 ? 0 : m.from[0]) : "plain"; }}
          tag={(r, c) => { const m = org.get(key(r, c, outNd)); return m ? `←${coords(m.from)}` : undefined; }} />
      </Row>
      <Hint>{v.mode === "regroup" ? "Colours follow the original rows; the order of the elements does not change." : "Colours follow the original rows: they become columns."}</Hint>
    </div>
  );
}
