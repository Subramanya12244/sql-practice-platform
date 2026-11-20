import { memo, type CSSProperties } from "react";
import { MOTION } from "../../lib/motion";
import { DataFrameView } from "./DataFrameView";
import { rowMarks, type DataStage } from "../../lib/visual/dataframe";
import { TONE_GLYPH, TONE_WORD, txt, type CalcView, type GridView, type GroupsView, type TableView, type Tone } from "../../lib/visual/pandasBeatParts";
import { GROUP_COLORS } from "./RowFlow";

/**
 * The other pandas pictures: a table whose columns or cells change colour (selection, new column, missing values), a per-row
 * calculation with a verdict or result chip, groups that collapse into their aggregate, and the real result table. All of them
 * draw only the data their beat carries. Colour changes use CSS transitions, chips that arrive use the site's short `df-cell` pop
 * (silenced by the global reduced-motion rule, and not added at all when reduced motion is on).
 */

const cell = "border border-surface-border px-1.5 py-0.5 text-xs tabular-nums";
const COL_TONE: Record<Tone, string> = {
  normal: "", kept: "bg-success-dim", removed: "bg-danger-dim text-ink-muted", matched: "bg-accent-dim", unmatched: "bg-warn-dim", dup: "bg-warn-dim text-ink-muted",
  group: "bg-surface-raised", new: "bg-accent-dim", used: "bg-info-dim", nan: "bg-warn-dim",
};
const CELL_TONE: Record<Tone, string> = { ...COL_TONE, nan: "bg-warn-dim font-bold text-warn ring-1 ring-inset ring-warn/60", new: "bg-accent-dim font-semibold" };

export const Sampled = ({ text }: { text?: string | null }) => (text ? <p data-testid="pandas-sampled" className="text-[11px] text-ink-muted">{text}</p> : null);

export const GridPicture = memo(function GridPicture({ view, reducedMotion }: { view: GridView; reducedMotion: boolean }) {
  const g = view.grid;
  const trans = reducedMotion ? "" : "transition-colors duration-300";
  return (
    <div className="space-y-2" data-testid="pandas-grid" data-reduced={reducedMotion ? "true" : "false"}>
      <p className="text-[11px] font-semibold text-ink-faint">{view.caption}</p>
      {g.all && (
        <ul className="flex flex-wrap gap-1" aria-label="Every column">
          {g.all.map((c) => <li key={c.name} data-col={c.name} data-tone={c.tone} className={`rounded border border-surface-border px-1.5 py-0.5 font-mono text-[10px] ${trans} ${COL_TONE[c.tone]}`}>{TONE_GLYPH[c.tone]} {c.name}</li>)}
        </ul>
      )}
      <div className="min-w-0 overflow-x-auto">
        <table className="border-collapse text-left" aria-label={view.caption}>
          <thead>
            <tr>
              <th scope="col" className={`${cell} bg-surface-soft`}><span className="sr-only">index</span></th>
              {g.cols.map((c, j) => (
                <th key={j} scope="col" data-col={c} data-tone={g.colTone[j]} className={`${cell} ${trans} font-semibold ${g.colTone[j] === "normal" ? "bg-surface-soft" : COL_TONE[g.colTone[j]]}`}>
                  {c}
                  {g.colTag[j] && <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted" data-testid="col-tag">{TONE_GLYPH[g.colTone[j]]} {g.colTag[j]}</span>}
                  <span className="block text-[10px] font-normal text-ink-faint">{g.dtypes[j]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.rows.map((row, i) => (
              <tr key={i}>
                <th scope="row" className={`${cell} bg-surface-soft font-medium`}>{g.index[i]}</th>
                {row.map((c, j) => {
                  const tone = g.cellTone?.[i]?.[j] ?? null;
                  const text = g.cellText?.[i]?.[j] ?? txt(c);
                  return (
                    <td key={j} data-tone={tone ?? undefined} data-nan={c === null ? "true" : undefined} title={tone ? TONE_WORD[tone] : undefined}
                      className={`${cell} ${trans} ${tone ? CELL_TONE[tone] : g.colTone[j] !== "normal" ? COL_TONE[g.colTone[j]] : ""} ${c === null && !tone ? "italic text-ink-faint" : ""} ${!reducedMotion && tone === "new" ? "df-cell" : ""}`}
                      style={!reducedMotion && tone === "new" ? ({ "--i": i } as CSSProperties) : undefined}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-faint">shape ({g.shape.join(", ")}){g.more ? ` · showing the first ${g.rows.length} of ${g.shape[0]} rows${g.cols.length < (g.shape[1] ?? 0) ? ` and ${g.cols.length} of ${g.shape[1]} columns` : ""}` : ""}</p>
      <Sampled text={view.sampled} />
    </div>
  );
});

export function TablePicture({ view, stage, reducedMotion }: { view: TableView; stage: DataStage; reducedMotion: boolean }) {
  return (
    <div className="space-y-2" data-testid="pandas-table">
      <DataFrameView snap={view.snap} before={view.before} caption={view.caption} rowMarks={view.marks === "merge" ? rowMarks(stage, "out") : undefined} markHeader="Origin" keyCols={view.keyCols} reducedMotion={reducedMotion} />
      <Sampled text={view.sampled} />
    </div>
  );
}

const CHIP = { true: "bg-success-dim text-success", false: "bg-danger-dim text-danger", value: "bg-accent-dim font-semibold text-ink" } as const;

export const CalcPicture = memo(function CalcPicture({ view, reducedMotion }: { view: CalcView; reducedMotion: boolean }) {
  return (
    <div className="space-y-2" data-testid="pandas-calc" data-reduced={reducedMotion ? "true" : "false"}>
      <p className="text-[11px] font-semibold text-ink-faint">{view.caption}</p>
      <div className="min-w-0 overflow-x-auto">
        <table className="border-collapse text-left" aria-label={view.caption}>
          <thead>
            <tr>
              <th scope="col" className={`${cell} bg-surface-soft`}>row</th>
              {view.identHeads.map((h) => <th key={h} scope="col" className={`${cell} bg-surface-soft font-semibold text-ink-faint`}>{h}</th>)}
              {view.heads.map((h, k) => <th key={k} scope="colgroup" colSpan={h.span} className={`${cell} bg-surface-soft font-mono font-semibold`}>{h.text}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r, i) => (
              <tr key={r.label} data-testid="calc-row" data-row={r.label} data-verdict={[...r.parts].reverse().find((p) => p.chip === "true" || p.chip === "false")?.chip}>
                <th scope="row" className={`${cell} bg-surface-soft font-medium`}>{r.label}</th>
                {r.ident.map((t, k) => <td key={k} className={`${cell} text-ink`}>{t}</td>)}
                {r.parts.map((p, k) => {
                  const hidden = view.hideResult && k === r.parts.length - 1;
                  return (
                    <td key={k} aria-hidden={hidden ? true : undefined} className={`${cell} ${p.muted ? "text-center text-ink-faint" : "text-ink"}`}>
                      {p.chip ? (
                        <span data-testid={`calc-${p.chip}`} className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${CHIP[p.chip]} ${hidden ? "invisible" : !reducedMotion ? "df-cell" : ""}`}
                          style={!reducedMotion && !hidden ? ({ "--i": i } as CSSProperties) : undefined}>{p.chip === "true" ? "✓ " : p.chip === "false" ? "✕ " : ""}{p.text}</span>
                      ) : <span className="font-mono">{p.text}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sampled text={view.sampled} />
    </div>
  );
});

export const GroupsPicture = memo(function GroupsPicture({ view, reducedMotion }: { view: GroupsView; reducedMotion: boolean }) {
  const { phase } = view;
  const trans = reducedMotion ? undefined : { transition: `opacity ${MOTION.slow}ms ease, background-color ${MOTION.base}ms ease` };
  return (
    <div className="space-y-2" data-testid="pandas-groups" data-phase={phase} data-reduced={reducedMotion ? "true" : "false"}>
      <p className="text-[11px] font-semibold text-ink-faint">{view.caption}</p>
      <div className="grid gap-2 sm:grid-cols-2" role="list" aria-label="Groups">
        {view.groups.map((b) => {
          const calc = b.calcs[0];
          return (
            <div key={b.key} role="listitem" data-group-key={b.key} className="min-w-0 rounded-lg border border-surface-border bg-surface-raised p-2" style={{ borderLeft: `4px solid ${GROUP_COLORS[b.color % GROUP_COLORS.length]}` }}>
              <p className="mb-1 flex items-baseline justify-between gap-2 text-xs font-semibold text-ink"><span className="truncate">{b.key}</span><span className="shrink-0 font-normal text-ink-faint">{b.size} row{b.size === 1 ? "" : "s"}</span></p>
              <ul className="space-y-0.5" style={{ ...trans, opacity: phase === 2 ? 0.45 : 1 }}>
                {b.members.map((m) => (
                  <li key={m.label} className="flex items-center gap-2 rounded bg-surface-soft px-1.5 py-0.5 font-mono text-[11px] text-ink" data-member={m.label}>
                    <span className="shrink-0 rounded bg-surface px-1 text-[10px] font-semibold text-ink-muted">{m.label}</span>
                    <span className="min-w-0 truncate">{view.cols.length && m.cells.length ? m.cells.join(", ") : `row ${m.label}`}</span>
                  </li>
                ))}
                {b.hidden > 0 && <li className="px-1.5 text-[10px] text-ink-faint">+ {b.hidden} more row{b.hidden === 1 ? "" : "s"} not drawn</li>}
              </ul>
              {calc && (reducedMotion ? phase >= 1 : true) && (
                <p data-testid="group-calc" aria-hidden={phase < 1 ? true : undefined} className="mt-1.5 flex flex-wrap items-center gap-1 font-mono text-[11px] text-ink" style={{ ...trans, opacity: phase >= 1 ? 1 : 0 }}>
                  <span className="min-w-0 break-words">{`${view.fn}(${calc.complete ? calc.values.join(", ") : `${calc.values.join(", ")}, …`}) = `}</span>
                  <span data-testid="group-value" className="rounded bg-accent-dim px-1.5 py-0.5 font-bold text-ink">{calc.value}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
      {view.moreGroups > 0 && <p className="text-[11px] text-ink-faint">{view.moreGroups} more group{view.moreGroups === 1 ? "" : "s"} are not drawn.</p>}
      {view.result && <DataFrameView snap={view.result} caption={view.caption} reducedMotion={reducedMotion} />}
      <Sampled text={view.sampled} />
    </div>
  );
});
