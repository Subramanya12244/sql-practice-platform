import { memo, type CSSProperties, type ReactNode } from "react";
import { EASE, MOTION, STAGGER } from "../../lib/motion";
import { pyShape } from "../../lib/visual/broadcast";
import type { Cell, Mat } from "../../lib/visual/numpyBeats";

/**
 * Small drawing pieces shared by the NumPy beat pictures: a grid of real cells with positions, reveal animation, and chips.
 * Animation is transform and opacity only (`df-pop`, defined in site.css), delayed by a short stagger that stops growing after
 * `STAGGER.maxItems` cells so a big grid never takes long. With reduced motion no animation style is set at all: the cells are
 * simply there, with the same classes and the same text.
 */

export type Tone = "plain" | "sel" | "orig" | "repeat" | "now" | "done" | "dim" | "danger" | "g0" | "g1" | "g2" | "g3";
export const TONE_CLASS: Record<Tone, string> = {
  plain: "text-ink",
  sel: "bg-accent-dim font-semibold text-ink outline outline-1 outline-accent",
  orig: "bg-surface-soft font-semibold text-ink outline outline-1 outline-surface-border",
  repeat: "bg-accent-dim text-ink [border-style:dashed] border-accent/50",
  now: "bg-accent-dim font-bold text-ink outline outline-2 outline-accent",
  done: "bg-success-dim text-ink",
  dim: "text-ink-faint",
  danger: "bg-danger-dim font-semibold text-danger",
  g0: "bg-accent-dim text-ink",
  g1: "bg-success-dim text-ink",
  g2: "bg-warn-dim text-ink",
  g3: "bg-info-dim text-ink",
};
export const groupTone = (g: number): Tone => (`g${((g % 4) + 4) % 4}`) as Tone;

export const CELL = "border border-surface-border px-1.5 py-0.5 text-center text-xs tabular-nums";

/** The entrance of one element: scale and fade in, a short capped stagger after the first. Undefined when motion is reduced or the element is static. */
export function reveal(reduced: boolean, order: number | null | undefined, stepMs: number = STAGGER.stepMs, maxItems: number = STAGGER.maxItems): CSSProperties | undefined {
  if (reduced || order === null || order === undefined) return undefined;
  return {
    animationName: "df-pop", animationDuration: `${MOTION.enter}ms`, animationTimingFunction: EASE.out, animationFillMode: "both",
    animationDelay: `${Math.min(order, maxItems - 1) * stepMs}ms`,
  };
}

const show = (c: Cell | undefined) => (c === null || c === undefined ? "NaN" : c);

interface GridCellProps { value: string; tone: Tone; tag?: string; title: string; pos: string; order: number | null; reduced: boolean; dot?: boolean }
/** One cell of a grid. Memoized on primitives, so a re-render with the same data repaints nothing. */
export const GridCell = memo(function GridCell({ value, tone, tag, title, pos, order, reduced, dot }: GridCellProps) {
  return (
    <td data-pos={pos} data-tone={tone} title={title} style={reveal(reduced, order)} className={`${CELL} ${TONE_CLASS[tone]}`}>
      {tag ? <span className="block text-[9px] font-normal leading-tight text-ink-faint">{tag}</span> : null}
      {dot ? <span aria-hidden>·</span> : value}
    </td>
  );
});

export interface MatGridProps {
  mat: Mat;
  /** Name for tooltips and the table label: "A", "result". */
  name: string;
  reduced: boolean;
  tone?: (r: number, c: number) => Tone;
  /** Small text above the value inside a cell. */
  tag?: (r: number, c: number) => string | undefined;
  /** A cell that is not computed yet: drawn as a faint dot, its value not shown. */
  hidden?: (r: number, c: number) => boolean;
  /** Reveal order of a cell, or null for a cell that does not animate. Default: every cell, in reading order. */
  order?: (r: number, c: number) => number | null;
  caption?: ReactNode;
  /** Leave out the shape / dtype / window line. */
  bare?: boolean;
}

const posOf = (m: Mat, r: number, c: number) => (m.shape.length === 0 ? "" : m.shape.length === 1 ? String(c) : `${r},${c}`);
const coordText = (m: Mat, r: number, c: number) => (m.shape.length === 0 ? "" : m.shape.length === 1 ? `[${c}]` : `[${r}, ${c}]`);

/** A recorded array (or scalar) as a grid of its real cells. Every cell carries its position; a window of a bigger array says so. */
export function MatGrid({ mat, name, reduced, tone, tag, hidden, order, caption, bare }: MatGridProps) {
  const nd = mat.shape.length;
  const cols = mat.cells[0]?.length ?? 0;
  return (
    <div className="min-w-0 max-w-full" data-np-grid={name}>
      {caption && <p className="mb-1 text-xs font-medium text-ink-muted">{caption}</p>}
      <div className="max-w-full overflow-x-auto">
        <table className="border-collapse text-left" aria-label={`${name}, shape ${pyShape(mat.shape)}${mat.windowed ? ", window of the array" : ""}`}>
          {nd > 0 && (
            <thead>
              <tr>
                <th scope="col" className={`${CELL} bg-surface-soft text-[10px] font-normal text-ink-faint`}>{nd === 2 ? "axis 0 ↓" : "axis 0 →"}</th>
                {Array.from({ length: cols }, (_, c) => <th key={c} scope="col" className={`${CELL} bg-surface-soft font-semibold`}>{c}{nd === 2 && c === 0 ? <span className="ml-1 text-[9px] font-normal text-ink-faint">axis 1 →</span> : null}</th>)}
              </tr>
            </thead>
          )}
          <tbody>
            {mat.cells.map((row, r) => (
              <tr key={r}>
                {nd > 0 && <th scope="row" className={`${CELL} bg-surface-soft font-medium`}>{nd === 2 ? r : ""}</th>}
                {row.map((v, c) => (
                  <GridCell key={c} value={show(v)} tone={tone?.(r, c) ?? "plain"} tag={tag?.(r, c)} pos={posOf(mat, r, c)} reduced={reduced} dot={hidden?.(r, c)}
                    title={`${name}${coordText(mat, r, c)} = ${show(v)}`} order={order ? order(r, c) : r * cols + c} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!bare && (
        <p className="mt-1 text-[11px] text-ink-faint" data-np-facts>
          shape {pyShape(mat.shape)} · dtype {mat.dtype}
          {mat.windowed ? <span data-np-window> · window: the first {mat.shown.join(" × ")} cells of the real {pyShape(mat.shape)} array</span> : null}
        </p>
      )}
    </div>
  );
}

/** A label chip such as "A" or "B". */
export function LabelChip({ label, expr, shape }: { label: string; expr?: string | null; shape?: number[] }) {
  return (
    <p className="mb-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
      <span className="rounded bg-accent-dim px-1.5 py-0.5 font-bold text-ink">{label}</span>
      {expr ? <code className="min-w-0 break-all font-mono text-ink-muted">{expr}</code> : null}
      {shape ? <span className="font-mono text-ink-faint">{pyShape(shape)}</span> : null}
    </p>
  );
}

export const Panel = ({ children, tone = "plain", label, testid, matmulInvalid }: { children: ReactNode; tone?: "plain" | "danger"; label?: string; testid?: string; matmulInvalid?: boolean }) => (
  <div data-testid={testid} aria-label={label} data-matmul-valid={matmulInvalid ? "false" : undefined} className={`min-w-0 rounded-xl border p-3 ${tone === "danger" ? "border-danger/30 bg-danger-dim" : "border-surface-border bg-surface-raised"}`}>{children}</div>
);
