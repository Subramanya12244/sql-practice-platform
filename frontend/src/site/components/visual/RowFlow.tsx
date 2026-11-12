import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { RotateCcw } from "lucide-react";
import type { Stage } from "../../lib/visualize";
import { frameDelay, type Speed } from "../../lib/visual/playback";
import { keyColumns, pickColumns } from "../../lib/visual/cinema";
import { baseFrame, identityHint, identityLabel, tonesIn, TONE_GLYPH, TONE_WORD, type Board, type BoardCard, type FlowFrame, type Tone } from "../../lib/visual/rowFlow";

/**
 * The Query Cinema canvas: the rows of a SQL stage drawn as real table rows that move between relations (see
 * lib/visual/rowFlow.ts and rowTrace.ts for where the rows come from). Every card is a row that really exists at that stage;
 * nothing is invented, and when only a sample is drawn the exact counts say so.
 *
 * A stage plays in three beats when the learner arrives at it (forward or backward, at the playback speed):
 *   0 before   rows sit in the input relation
 *   1 evaluate the stage's verdict shows on each row (true / false / NULL, matched, duplicate ...), rows have not moved yet
 *   2 after    rows travel to their place in the output relation (kept, removed, grouped, reordered ...)
 * Replay / Before / After buttons let the learner pause on any beat. It only draws; it never runs or changes a query.
 *
 * Reduced motion: no transform, opacity or colour transition and no animation at all. The same information is shown as two
 * static boards, Before and After, with the same classes. Screen readers get the sentence in the live region.
 */

const ROW = 34, PITCH = 40, PAD = 4, GUTTER = 9;
export const GROUP_COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#a78bfa", "#fb7185", "#2dd4bf", "#f472b6", "#a3e635"];
const TONE_CLASS: Record<Tone, string> = {
  normal: "border-surface-border bg-surface-soft text-ink",
  kept: "border-success/40 bg-success-dim text-ink",
  survivor: "border-success/40 bg-success-dim text-ink",
  removed: "border-dashed border-danger/50 bg-danger-dim text-ink-muted",
  cut: "border-dashed border-danger/50 bg-danger-dim text-ink-muted",
  matched: "border-accent/50 bg-accent-dim text-ink",
  new: "border-accent/50 bg-accent-dim text-ink",
  unmatched: "border-warn/50 bg-warn-dim text-ink",
  dup: "border-dashed border-warn/50 bg-warn-dim text-ink-muted",
  group: "border-accent/40 bg-surface-raised font-semibold text-ink",
};
const VERDICT_CLASS = { true: "bg-success-dim text-success", false: "bg-danger-dim text-danger", NULL: "bg-warn-dim text-warn" } as const;
const VERDICT_GLYPH = { true: "✓", false: "✕", NULL: "∅" } as const;

/** Width of an element, tracked. A server render and jsdom have no ResizeObserver, so they get a desktop width. */
function useWidth(ref: RefObject<HTMLElement>): number {
  const [w, setW] = useState(960);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width || 960);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || 960));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

type Phase = 0 | 1 | 2;
const bare = (c: string) => c.split(".").pop()!;

function Cells({ cols, cells, picks, keys }: { cols: string[]; cells: string[]; picks: number[]; keys: Set<string> }) {
  return (
    <div className="grid min-w-0 flex-1 gap-1.5" style={{ gridTemplateColumns: `repeat(${picks.length}, minmax(0, 1fr))` }}>
      {picks.map((i) => {
        const v = cells[i] ?? "";
        return (
          <span key={i} className={`min-w-0 truncate font-mono ${v === "NULL" ? "italic text-ink-faint" : keys.has(cols[i]) ? "font-semibold text-accent" : ""}`}>{v}</span>
        );
      })}
    </div>
  );
}

function BoardView({ board, phase, animated, dur, label, sql, expr, links, width }: {
  board: Board; phase: Phase; animated: boolean; dur: number; label: string; sql: string; expr?: string; links?: [string, string][]; width: number;
}) {
  const n = board.lanes.length;
  // A static board has no "moment in between": rows that appear later are absent before, rows that merge are absent after.
  const cards = animated ? board.cards : board.cards.filter((c) => (phase === 0 ? !c.appear : !c.vanish));
  const slot = (c: BoardCard) => (phase === 2 ? c.to : c.from);
  // On a phone the lanes keep a readable width and the canvas scrolls sideways inside itself (the page never does).
  const MIN_LANE = 210;
  const laneW = Math.max(MIN_LANE, width / n);
  const maxCols = Math.max(2, Math.min(6, Math.floor((laneW - 24) / 74)));
  const dataOf = (c: BoardCard) => (phase === 2 && c.after ? c.after : c.cells && c.cols ? { cols: c.cols, cells: c.cells } : null);
  // Columns that are NULL in every drawn row of a relation are not worth a slot.
  const emptyOf = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const c of board.cards) {
      if (!c.cols || !c.cells) continue;
      const k = c.cols.join("|");
      const set = m.get(k) ?? new Set(c.cols.map((_, i) => i));
      c.cells.forEach((v, i) => { if (v !== "NULL") set.delete(i); });
      m.set(k, set);
    }
    return m;
  }, [board]);
  const layout = (cols: string[]) => {
    const keys = keyColumns(expr, cols);
    // The two sides of an equality (c.customer_id = o.customer_id) hold the same value: one of them is enough on screen.
    const seen = new Set<string>();
    const must = [...keys].filter((k) => { const b = bare(k).toLowerCase(); if (seen.has(b)) return false; seen.add(b); return true; });
    return { picks: pickColumns(cols, `${sql}\n${expr ?? ""}`, maxCols, must, emptyOf.get(cols.join("|"))), keys };
  };
  // One column layout per lane, taken from the first row that sits in it, so headers and rows line up.
  const laneHead = board.lanes.map((_, L) => {
    const rep = cards.find((c) => dataOf(c) && Math.min(n - 1, Math.max(0, Math.round(slot(c).lane))) === L);
    const d = rep && dataOf(rep);
    if (!d) return null;
    const lay = layout(d.cols);
    const names = lay.picks.map((i) => d.cols[i]);
    const dup = new Set(names.map(bare)).size !== names.length;
    return { ...lay, full: names, names: names.map((c) => (dup ? c : bare(c))) };
  });
  const rowsHere = Math.max(1, ...cards.map((c) => slot(c).row + 1));
  const height = rowsHere * PITCH + PAD * 2;
  const pos = new Map(board.cards.map((c) => [c.id, c]));
  const showLinks = Boolean(links?.length) && n >= 2 && phase < 2;
  const hasVerdict = cards.some((c) => c.verdict);
  return (
    <div className="min-w-0 overflow-x-auto" data-testid="rowflow-scroll">
     <div style={{ minWidth: n * MIN_LANE }}>
      <div className="grid gap-0 pb-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden>
        {board.lanes.map((l, i) => (
          <div key={i} className="min-w-0 px-[9px]" title={`${l.label}${l.count ? ` · ${l.count}` : ""}`}>
            <p className="flex items-baseline justify-between gap-2 truncate text-[11px] font-bold uppercase tracking-wider text-ink">
              <span className="truncate">{l.label}</span>
              {l.count ? <span className="shrink-0 font-mono text-[11px] font-semibold normal-case tracking-normal text-accent">{l.count}</span> : null}
            </p>
            {laneHead[i] && (
              <div className="mt-0.5 grid gap-1.5 border-b border-surface-border px-1.5 pb-0.5" style={{ gridTemplateColumns: `repeat(${laneHead[i]!.picks.length}, minmax(0, 1fr))` }}>
                {laneHead[i]!.names.map((nm, k) => <span key={k} className={`truncate font-mono text-[10px] ${laneHead[i]!.keys.has(laneHead[i]!.full[k]) ? "font-semibold text-accent" : "text-ink-faint"}`}>{nm}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="max-h-[min(56vh,560px)] overflow-y-auto overflow-x-hidden rounded-lg border border-surface-border bg-surface">
        <div role="list" aria-label={label} data-testid="rowflow-board" data-verdicts={hasVerdict ? "true" : "false"} className="relative" style={{ height }}>
          {board.lanes.map((_, i) => (
            <div key={i} aria-hidden className={`absolute bottom-0 top-0 ${i > 0 ? "border-l border-surface-border" : ""} ${i % 2 ? "bg-surface-soft/30" : ""}`} style={{ left: `${(i * 100) / n}%`, width: `${100 / n}%` }} />
          ))}
          {showLinks && (
            <svg aria-hidden data-testid="rowflow-links" className="pointer-events-none absolute top-0" style={{ left: `calc(${100 / n}% - ${GUTTER}px)`, width: GUTTER * 2, height }} width={GUTTER * 2} height={height}>
              {links!.map(([l, r], i) => {
                const a = pos.get(`L:${l}`), b = pos.get(`R:${r}`);
                if (!a || !b) return null;
                const y = (c: BoardCard) => PAD + c.from.row * PITCH + ROW / 2;
                return <line key={i} x1={0} y1={y(a)} x2={GUTTER * 2} y2={y(b)} stroke={GROUP_COLORS[(a.group ?? 0) % GROUP_COLORS.length]} strokeWidth={2} strokeLinecap="round" opacity={phase === 1 ? 0.95 : 0.5} />;
              })}
            </svg>
          )}
          {cards.map((c, i) => {
            const s = slot(c);
            const tone = phase === 0 ? c.toneBefore : c.tone;
            const hidden = animated && (phase < 2 ? c.appear : c.vanish);
            const style: CSSProperties = {
              position: "absolute", top: PAD, left: 0, width: `${100 / n}%`, height: ROW, padding: `0 ${GUTTER}px`,
              transform: `translate(${s.lane * 100}%, ${s.row * PITCH}px)`,
              opacity: hidden ? 0 : 1,
              ...(animated ? { transition: `transform ${dur}ms cubic-bezier(.4,0,.2,1), opacity ${dur}ms ease`, transitionDelay: `${Math.min(i * 16, 320)}ms` } : {}),
            };
            const text = phase === 2 && c.textAfter ? c.textAfter : c.text;
            const d = dataOf(c);
            const lay = d ? layout(d.cols) : null;
            const verdict = phase >= 1 && c.verdict ? c.verdict : undefined;
            const accent = c.group !== undefined && phase >= 1 ? GROUP_COLORS[c.group % GROUP_COLORS.length] : undefined;
            return (
              <div key={`${i}:${c.id}`} role="listitem" style={style} data-card={c.id} data-tone={tone} data-verdict={verdict?.value} data-group={c.group}
                aria-label={`${text} (${TONE_WORD[tone]}${verdict ? `, condition ${verdict.value}` : ""}${c.badge ? `, ${c.badge}` : ""})`}
                title={`${c.title}${verdict ? `\nCondition: ${verdict.value}${verdict.detail ? ` (${verdict.detail})` : ""}` : ""}${c.badge ? `\n${c.badge}` : ""}`}>
                <div className={`flex h-full items-center gap-1.5 rounded-md border px-1.5 text-[11px] leading-none ${animated ? "transition-colors" : ""} ${TONE_CLASS[tone]}`}
                  style={animated ? { transitionDuration: `${Math.round(dur * 0.7)}ms`, ...(accent ? { borderLeft: `3px solid ${accent}` } : {}) } : accent ? { borderLeft: `3px solid ${accent}` } : undefined}>
                  {TONE_GLYPH[tone] && <span aria-hidden className="shrink-0 text-[10px]">{TONE_GLYPH[tone]}</span>}
                  {d && lay ? <Cells cols={d.cols} cells={d.cells} picks={lay.picks} keys={lay.keys} />
                    : <span className="min-w-0 flex-1 truncate font-mono">{text}{c.calc ? <span className="ml-2 font-semibold text-accent">{c.calc}</span> : null}</span>}
                  {verdict && <span data-testid="rowflow-verdict" className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold ${VERDICT_CLASS[verdict.value]}`}>{VERDICT_GLYPH[verdict.value]} {verdict.value}</span>}
                  {c.badge && !verdict && n <= 2 && <span className="shrink-0 text-[9px] text-ink-faint">{c.badge}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
     </div>
    </div>
  );
}

const btn = "inline-flex items-center gap-1 rounded-md border border-surface-border px-2 py-0.5 text-[11px] text-ink-muted hover:text-ink aria-pressed:bg-accent aria-pressed:text-white";

export function RowFlow({ stage, prev, reduced, frame, stageIndex = 0, speed = 1, refining = false, sql = "", expr }: {
  stage: Stage;
  prev?: Stage;
  reduced: boolean;
  /** Row-level frame from rowTrace; without it the frame is drawn from the stage's own sample. */
  frame?: FlowFrame;
  stageIndex?: number;
  speed?: Speed;
  refining?: boolean;
  /** The learner's query, so the columns the query names are the ones drawn. */
  sql?: string;
  /** The condition this stage applies (ON, WHERE, HAVING), so its columns are highlighted. */
  expr?: string;
}) {
  const f = useMemo(() => frame ?? baseFrame(stage, prev, stageIndex), [frame, stage, prev, stageIndex]);
  const key = `${stageIndex}:${f.clause}:${f.kind}`;
  const [variant, setVariant] = useState<{ k: string; i: number } | null>(null);
  const [view, setView] = useState<"play" | "before" | "after">("play");
  const [replay, setReplay] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const width = useWidth(root);
  const vCount = f.variants?.length ?? 0;
  const vi = variant && variant.k === key ? Math.min(variant.i, vCount - 1) : vCount - 1;
  const v = vCount ? f.variants![vi] : undefined;
  const board = v?.board ?? f.board;
  const summary = v?.summary ?? f.summary;
  const limited = v?.limited ?? f.limited;
  const condition = expr ?? v?.on ?? f.expr;
  const animKey = `${key}:${vi}:${replay}:${view}`;
  const [beat, setBeat] = useState<{ key: string; phase: Phase }>({ key: "", phase: 0 });
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    if (reduced || view !== "play") return;
    const d = frameDelay(speedRef.current);
    const t1 = window.setTimeout(() => setBeat({ key: animKey, phase: 1 }), Math.max(60, Math.round(d * 0.18)));
    const t2 = window.setTimeout(() => setBeat({ key: animKey, phase: 2 }), Math.max(140, Math.round(d * 0.42)));
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [animKey, reduced, view]);
  // Each stage change restarts from "before" without a flash of the final state: a beat only counts for its own key.
  const phase: Phase = view === "before" ? 0 : view === "after" ? 2 : beat.key === animKey ? beat.phase : 0;
  const dur = Math.round(Math.min(900, Math.max(220, frameDelay(speed) * 0.45)));
  const links = f.kind === "join" ? (v?.facts ?? f.facts).matched : undefined;

  if (!summary && !board) return null;
  const tones = tonesIn(board);
  const hasVerdict = board?.cards.some((c) => c.verdict) ?? false;
  return (
    <div ref={root} className="space-y-2 rounded-xl border border-surface-border bg-surface-raised p-3" data-testid="rowflow" data-reduced={reduced ? "true" : "false"} data-kind={f.kind} data-phase={reduced ? "static" : phase}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Rows moving through {f.clause.toUpperCase()}</p>
        {board && !reduced && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Row animation controls">
            <button type="button" className={btn} onClick={() => { setView("play"); setReplay((x) => x + 1); }}><RotateCcw className="h-3 w-3" aria-hidden /> Replay</button>
            <button type="button" className={btn} aria-pressed={view === "before"} onClick={() => setView(view === "before" ? "play" : "before")}>Before</button>
            <button type="button" className={btn} aria-pressed={view === "after"} onClick={() => setView(view === "after" ? "play" : "after")}>After</button>
          </div>
        )}
      </div>
      <p aria-live="polite" data-testid="rowflow-live" className="text-xs text-ink">{summary}</p>
      {board && (
        <>
          {vCount > 1 && (
            <label className="flex items-center gap-1 text-xs text-ink-muted">Join step
              <select aria-label="Join step" value={vi} onChange={(e) => setVariant({ k: key, i: Number(e.target.value) })} className="min-w-0 max-w-full rounded-md border border-surface-border bg-surface px-1 py-0.5 text-xs text-ink">
                {f.variants!.map((x, i) => <option key={i} value={i}>{i + 1}. {x.label}</option>)}
              </select>
            </label>
          )}
          {reduced ? (
            <div className="space-y-2" data-testid="rowflow-static">
              <section aria-label="Before this stage"><p className="mb-1 text-[11px] font-semibold text-ink-muted">Before</p><BoardView board={board} phase={0} animated={false} dur={0} label="Rows before this stage" sql={sql} expr={condition} links={links} width={width} /></section>
              <section aria-label="After this stage"><p className="mb-1 text-[11px] font-semibold text-ink-muted">After</p><BoardView board={board} phase={2} animated={false} dur={0} label="Rows after this stage" sql={sql} expr={condition} width={width} /></section>
            </div>
          ) : (
            <BoardView board={board} phase={phase} animated dur={dur} label={phase === 2 ? "Rows after this stage" : "Rows before this stage"} sql={sql} expr={condition} links={links} width={width} />
          )}
          {(tones.length > 0 || hasVerdict) && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted" aria-label="Legend">
              {tones.map((t) => <li key={t} className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm border ${TONE_CLASS[t]}`} aria-hidden />{TONE_GLYPH[t]} {TONE_WORD[t]}</li>)}
              {hasVerdict && <li className="flex items-center gap-1"><span className="rounded bg-warn-dim px-1 text-[10px] font-bold text-warn">∅ NULL</span> unknown counts as not true, so the row is removed</li>}
            </ul>
          )}
          {limited && <p data-testid="rowflow-limited" className="text-[11px] text-ink-muted">Sample: {limited}. The counts above are exact; rows that are not drawn are counted, not invented.</p>}
          {f.kind !== "none" && (
            <p data-testid="rowflow-identity" title={identityHint(f.identity)} className="text-[11px] text-ink-faint">
              {identityLabel(f.identity)}{f.identityNote ? ` · ${f.identityNote}` : ""}
              {f.source === "stage" && refining ? <span className="ml-2">looking up real row ids…</span> : null}
            </p>
          )}
        </>
      )}
    </div>
  );
}
