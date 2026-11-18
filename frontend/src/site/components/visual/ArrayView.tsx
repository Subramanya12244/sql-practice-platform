import { useMemo } from "react";
import type { DataSnap } from "../../lib/visual/dataframe";
import { axisLabel, ndPlanes, reduceTarget, unravel } from "../../lib/visual/ndarray";
import { numpyShape } from "../../lib/visual/broadcast";

const cell = "border border-surface-border px-1.5 py-0.5 text-xs tabular-nums";
const GROUP_TONES = ["bg-accent-dim", "bg-success-dim", "bg-warn-dim", "bg-info-dim"];

/** Nested lists of any depth (as captured) as planes[plane][row][col]. */
function planesOfNested<T>(data: unknown, ndim: number): T[][][] | null {
  if (data === undefined) return null;
  if (ndim === 0) return [[[data as T]]];
  if (ndim === 1) return [[data as T[]]];
  if (ndim === 2) return [data as T[][]];
  return data as T[][][];
}

export interface ArrayViewProps {
  snap: DataSnap;
  /** Variable name for tooltips, e.g. "a". */
  name?: string;
  /** The same array before the step: changed cells are highlighted. */
  before?: DataSnap | null;
  /** Nested booleans shaped like the shown part of this array: cells that a slice or mask selected. */
  selected?: unknown;
  /** For a result: nested flat positions in the input array (`pos.src`) and the input's shape, shown as "from input [r, c]". */
  origin?: { src: unknown; inShape: number[] } | null;
  /** For an input of a reduction: colour cells by the output element they feed. */
  reduce?: { axis: number[] | null; keepdims: boolean } | null;
  caption?: string;
  reducedMotion?: boolean;
}

/** A captured NumPy array with axis labels, element positions and before/after highlighting. Says when only part of it is drawn. */
export function ArrayView({ snap, name = "a", before, selected, origin, reduce, caption, reducedMotion }: ArrayViewProps) {
  const pl = useMemo(() => ndPlanes(snap), [snap]);
  const nd = snap.ndim ?? snap.shape?.length ?? 0;
  const lead = snap.lead ?? 0;
  const beforePl = useMemo(() => (before && before.k === "nd" && numpyShape(before.shape ?? []) === numpyShape(snap.shape ?? []) ? ndPlanes(before) : null), [before, snap]);
  const selPl = useMemo(() => planesOfNested<boolean>(selected, nd), [selected, nd]);
  const orgPl = useMemo(() => planesOfNested<number>(origin?.src, nd), [origin, nd]);
  if (!pl) return null;
  const shape = snap.shape ?? [];
  const trans = reducedMotion ? "" : "transition-colors duration-300";
  const groupIds = new Map<string, number>();
  const groupOf = (coords: number[]) => {
    const k = reduceTarget(coords, reduce!.axis, reduce!.keepdims).join(",");
    if (!groupIds.has(k)) groupIds.set(k, groupIds.size);
    return groupIds.get(k)!;
  };
  const coordsOf = (p: number, r: number, c: number): number[] => (nd === 0 ? [] : nd === 1 ? [c] : nd === 2 ? [r, c] : [...Array(lead).fill(0), p, r, c]);
  return (
    <div className="min-w-0 overflow-x-auto" data-array-view={`${nd}d`}>
      {caption && <p className="mb-1 text-xs font-medium text-ink-muted">{caption}</p>}
      <div className="space-y-2">
        {pl.planes.map((plane, p) => (
          <table key={p} className="border-collapse text-left" aria-label={`${caption ? `${caption}: ` : ""}${name} ${numpyShape(shape)}${pl.planeLabels[p] ? ` plane ${pl.planeLabels[p]}` : ""}`}>
            {pl.planeLabels[p] && <caption className="text-left text-[11px] text-ink-faint">{name}{pl.planeLabels[p]}</caption>}
            <thead>
              <tr>
                <th scope="col" className={`${cell} bg-surface-soft`}>{nd >= 2 ? <span className="text-[10px] font-normal text-ink-faint">{axisLabel(nd >= 3 ? nd - 2 : 0, nd >= 3 ? 3 : 2).split(" (")[0]} ↓</span> : null}</th>
                {pl.colLabels.map((c, i) => <th key={i} scope="col" className={`${cell} bg-surface-soft font-semibold`}>{c}</th>)}
              </tr>
              {nd >= 1 && <tr><th className="sr-only" scope="col">axis</th><th colSpan={pl.colLabels.length + 1} className="px-1 text-left text-[10px] font-normal text-ink-faint">{axisLabel(nd - 1, nd).replace(/ \(.*\)/, "")} → {nd === 2 ? "(across the columns)" : ""}</th></tr>}
            </thead>
            <tbody>
              {plane.map((row, r) => (
                <tr key={r}>
                  <th scope="row" className={`${cell} bg-surface-soft font-medium`}>{pl.rowLabels[r]}</th>
                  {row.map((v, c) => {
                    const co = coordsOf(p, r, c);
                    const ch = beforePl && beforePl.planes[p]?.[r]?.[c] !== v;
                    const sel = selPl?.[p]?.[r]?.[c] === true;
                    const flat = orgPl?.[p]?.[r]?.[c];
                    const g = reduce && co.length === nd && lead === 0 ? groupOf(co) : null;
                    const pos = `${name}[${co.join(", ")}]`;
                    const from = flat !== undefined && origin ? `from input [${unravel(flat, origin.inShape).join(", ")}]` : "";
                    return (
                      <td key={c} data-changed={ch ? "true" : undefined} data-selected={sel ? "true" : undefined} data-group={g ?? undefined}
                        title={[pos, v, ch ? `changed (before: ${beforePl!.planes[p]?.[r]?.[c]})` : "", sel ? "selected" : "", from, g !== null ? `feeds output element ${g + 1}` : ""].filter(Boolean).join(" · ")}
                        className={`${cell} ${trans} text-ink ${ch ? "bg-warn-dim font-semibold" : sel ? "bg-accent-dim font-semibold outline outline-1 outline-accent" : g !== null ? GROUP_TONES[g % GROUP_TONES.length] : ""}`}>
                        {v === null ? "NaN" : v}
                        {sel ? <span className="sr-only"> (selected)</span> : null}
                        {g !== null ? <sup className="ml-0.5 text-[9px] text-ink-faint">{g + 1}</sup> : null}
                        {from ? <span className="block text-[9px] font-normal text-ink-faint">{from.replace("from input ", "←")}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">
        shape {numpyShape(shape)} · {nd} dimension{nd === 1 ? "" : "s"} · size {snap.n} · dtype {snap.dtype}{snap.strides ? ` · strides ${numpyShape(snap.strides)} bytes` : ""}
        {snap.more ? ` · showing ${snap.shown?.length ? snap.shown.join(" x ") : "part"} of ${numpyShape(shape.slice(lead))}${lead ? ` (index 0 of the first ${lead} axis${lead > 1 ? "es" : ""})` : ""}` : ""}
      </p>
    </div>
  );
}
