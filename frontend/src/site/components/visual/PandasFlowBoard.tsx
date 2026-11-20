import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { MOTION, EASE, STAGGER } from "../../lib/motion";
import { TONE_GLYPH, TONE_WORD, type FlowBoardData, type FlowCard, type FlowPos, type FlowView, type Tone } from "../../lib/visual/pandasBeatParts";
import { GROUP_COLORS } from "./groupColors";

/**
 * The pandas row board: the real rows of one stage drawn as cards that sit in a lane (the input, the result, the left or right table)
 * and move between lanes or change colour as the beats go on. A card is a row that exists at that stage: its label and cells are the
 * recorded ones. Nothing is drawn that the stage did not record; when only a sample is drawn the caption below says so.
 *
 * Between two beats of one stage this component stays mounted, so a card's transform, opacity and colour change by CSS transition
 * (MOTION and EASE from lib/motion.ts, a short capped stagger, never `transition: all`, nothing loops). With reduced motion nothing
 * is animated: a beat in which cards move is drawn as two static boards (before and after) with the same classes.
 */

const ROW = 34, PITCH = 40, PAD = 4, GUTTER = 9, MIN_LANE = 172;
const TONE_CLASS: Record<Tone, string> = {
  normal: "border-surface-border bg-surface-soft text-ink",
  kept: "border-success/40 bg-success-dim text-ink",
  removed: "border-dashed border-danger/50 bg-danger-dim text-ink-muted",
  matched: "border-accent/50 bg-accent-dim text-ink",
  unmatched: "border-warn/50 bg-warn-dim text-ink",
  dup: "border-dashed border-warn/50 bg-warn-dim text-ink-muted",
  group: "border-accent/40 bg-surface-raised text-ink",
  new: "border-accent/50 bg-accent-dim text-ink",
  used: "border-info/40 bg-info-dim text-ink",
  nan: "border-warn/50 bg-warn-dim text-ink",
};
const VERDICT_CLASS = { true: "bg-success-dim text-success", false: "bg-danger-dim text-danger" } as const;

/** Width of an element, tracked. jsdom and a server render have no ResizeObserver, so they get a desktop width. */
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

/** The columns a lane draws: the ones the operation is about first, then the rest in table order, up to what fits. */
export function pickCols(cols: string[], focus: string[], max: number): number[] {
  const want = new Set<number>();
  cols.forEach((c, i) => { if (focus.includes(c) && want.size < max) want.add(i); });
  cols.forEach((_, i) => { if (want.size < max) want.add(i); });
  return [...want].sort((a, b) => a - b);
}

interface CardProps { card: FlowCard; pos: FlowPos; i: number; n: number; picks: number[]; animated: boolean; dur: number }

const FlowCardView = memo(function FlowCardView({ card, pos, i, n, picks, animated, dur }: CardProps) {
  const style: CSSProperties = {
    position: "absolute", top: PAD, left: 0, width: `${100 / n}%`, height: ROW, padding: `0 ${GUTTER}px`,
    transform: `translate(${pos.lane * 100}%, ${pos.row * PITCH}px)`,
    opacity: !pos.show ? 0 : pos.fade ? 0.5 : 1,
    pointerEvents: pos.show ? undefined : "none",
    ...(animated ? { transition: `transform ${dur}ms ${EASE.inOut}, opacity ${dur}ms ${EASE.out}`, transitionDelay: `${Math.min(i, STAGGER.maxItems) * STAGGER.stepMs}ms` } : {}),
  };
  const accent = pos.group !== undefined ? GROUP_COLORS[pos.group % GROUP_COLORS.length] : undefined;
  const text = card.head ?? `${card.label}: ${card.cells.join(", ")}`;
  const glyph = TONE_GLYPH[pos.tone];
  return (
    <div role="listitem" style={style} data-card={card.label} data-tone={pos.tone} data-lane={pos.lane} data-faded={pos.fade ? "true" : undefined} data-verdict={pos.verdict ? String(pos.verdict.value) : undefined} data-group={pos.group} aria-hidden={pos.show ? undefined : true}
      aria-label={`${text} (${TONE_WORD[pos.tone]}${pos.verdict ? `, ${pos.verdict.text}` : ""}${pos.badge ? `, ${pos.badge}` : ""})`} title={`${text}${pos.badge ? `\n${pos.badge}` : ""}`}>
      <div className={`flex h-full items-center gap-1.5 rounded-md border px-1.5 text-[11px] leading-none ${animated ? "transition-colors" : ""} ${TONE_CLASS[pos.tone]}`}
        style={{ ...(animated ? { transitionDuration: `${MOTION.base}ms` } : {}), ...(accent ? { borderLeft: `3px solid ${accent}` } : {}) }}>
        {glyph && !pos.verdict && <span aria-hidden className="shrink-0 text-[10px]">{glyph}</span>}
        {card.head !== undefined ? (
          <span className="min-w-0 flex-1 truncate font-semibold">{card.head}</span>
        ) : (
          <>
            <span className="shrink-0 rounded bg-surface px-1 py-0.5 font-mono text-[10px] font-semibold text-ink-muted" data-testid="card-label">{card.label}</span>
            <div className="grid min-w-0 flex-1 gap-1.5" style={{ gridTemplateColumns: `repeat(${picks.length}, minmax(0, 1fr))` }}>
              {picks.map((j) => {
                const v = card.cells[j] ?? "";
                const flagged = pos.flags && card.nan?.[j];
                return <span key={j} className={`min-w-0 truncate font-mono ${flagged ? "rounded bg-warn-dim px-1 py-0.5 font-bold text-warn ring-1 ring-warn/60" : card.nan?.[j] ? "italic text-ink-faint" : ""}`} data-nan={flagged ? "true" : undefined}>{v}</span>;
              })}
            </div>
          </>
        )}
        {pos.verdict && <span data-testid="flow-verdict" className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold ${VERDICT_CLASS[String(pos.verdict.value) as "true" | "false"]}`}>{pos.verdict.value ? "✓" : "✕"} {pos.verdict.text}</span>}
        {pos.badge && !pos.verdict && <span className="shrink-0 text-[9px] text-ink-faint" data-testid="flow-badge">{pos.badge}</span>}
      </div>
    </div>
  );
});

function Board({ board, phase, animated, label, width, links }: { board: FlowBoardData; phase: number; animated: boolean; label: string; width: number; links?: FlowBoardData["links"] }) {
  const n = board.lanes.length;
  const laneW = Math.max(MIN_LANE, width / n);
  const maxCols = Math.max(2, Math.min(6, Math.floor((laneW - 70) / 70)));
  const picks = useMemo(() => board.lanes.map((l) => pickCols(l.cols, l.focus, maxCols)), [board, maxCols]);
  const height = board.rows * PITCH + PAD * 2;
  const dur = MOTION.slow + 140;
  // A static board has no "moment in between": a card that is not there yet is simply absent.
  const shown = board.cards.map((c, i) => ({ c, i, p: c.at[Math.min(phase, c.at.length - 1)] })).filter((x) => animated || x.p.show);
  const pos = new Map(board.cards.map((c) => [c.id, c.at[Math.min(phase, c.at.length - 1)]]));
  const rowOf = (id: string) => pos.get(id)?.row ?? 0;
  const laneIdx = (p: FlowPos) => Math.min(n - 1, Math.max(0, Math.round(p.lane)));
  return (
    <div className="min-w-0 overflow-x-auto" data-testid="flow-scroll">
      <div style={{ minWidth: n * MIN_LANE }}>
        <div className="grid pb-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden>
          {board.lanes.map((l, i) => (
            <div key={i} className="min-w-0 px-[9px]">
              <p className="flex items-baseline justify-between gap-2 truncate text-[11px] font-bold uppercase tracking-wider text-ink">
                <span className="truncate">{l.label}</span>
                {l.count ? <span className="shrink-0 font-mono text-[11px] font-semibold normal-case tracking-normal text-accent" data-testid="lane-count">{l.count}</span> : null}
              </p>
              <div className="mt-0.5 grid gap-1.5 border-b border-surface-border px-1.5 pb-0.5" style={{ gridTemplateColumns: `repeat(${picks[i].length}, minmax(0, 1fr))` }}>
                {picks[i].map((j) => <span key={j} className={`truncate font-mono text-[10px] ${l.focus.includes(l.cols[j]) ? "font-semibold text-accent" : "text-ink-faint"}`}>{l.cols[j]}</span>)}
              </div>
            </div>
          ))}
        </div>
        <div className="max-h-[min(56vh,560px)] overflow-y-auto overflow-x-hidden rounded-lg border border-surface-border bg-surface">
          <div role="list" aria-label={label} data-testid="flow-board" data-phase={phase} className="relative" style={{ height }}>
            {board.lanes.map((l, i) => (
              <div key={i} aria-hidden className={`absolute bottom-0 top-0 ${i > 0 ? "border-l border-surface-border" : ""} ${i % 2 ? "bg-surface-soft/30" : ""}`} style={{ left: `${(i * 100) / n}%`, width: `${100 / n}%` }}>
                {l.placeholder && !shown.some((x) => laneIdx(x.p) === i && x.p.show && i > 0) && <p className="px-3 pt-2 text-[11px] italic text-ink-faint">{l.placeholder}</p>}
              </div>
            ))}
            {links && n >= 2 && (
              <svg aria-hidden data-testid="flow-links" className="pointer-events-none absolute top-0" style={{ left: `calc(${100 / n}% - ${GUTTER}px)`, width: GUTTER * 2, height }} width={GUTTER * 2} height={height}>
                {links.map((k, i) => {
                  const y = (id: string) => PAD + rowOf(id) * PITCH + ROW / 2;
                  const on = phase >= k.from && (k.to === undefined || phase <= k.to);
                  return <line key={i} x1={0} y1={y(k.a)} x2={GUTTER * 2} y2={y(k.b)} stroke={GROUP_COLORS[i % GROUP_COLORS.length]} strokeWidth={2} strokeLinecap="round" opacity={on ? 0.9 : 0} data-link={on ? "on" : "off"} style={animated ? { transition: `opacity ${MOTION.base}ms ${EASE.out}` } : undefined} />;
                })}
              </svg>
            )}
            {shown.map(({ c, i, p }) => (
              <FlowCardView key={c.id} card={c} pos={p} i={i} n={n} picks={picks[laneIdx(p)]} animated={animated} dur={dur} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FlowBoardView({ view, reducedMotion }: { view: FlowView; reducedMotion: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const width = useWidth(root);
  const { board, phase, from } = view;
  const links = board.links;
  return (
    <div ref={root} className="space-y-2" data-testid="pandas-flow" data-reduced={reducedMotion ? "true" : "false"} data-phase={phase}>
      <p className="text-[11px] font-semibold text-ink-faint">{view.caption}</p>
      {reducedMotion && from !== null ? (
        <div className="space-y-2" data-testid="flow-static">
          <section aria-label="Before this step"><p className="mb-1 text-[11px] font-semibold text-ink-muted">Before</p><Board board={board} phase={from} animated={false} label="Rows before this step" width={width} links={links} /></section>
          <section aria-label="After this step"><p className="mb-1 text-[11px] font-semibold text-ink-muted">After</p><Board board={board} phase={phase} animated={false} label="Rows after this step" width={width} links={links} /></section>
        </div>
      ) : (
        <Board board={board} phase={phase} animated={!reducedMotion} label={from !== null ? "Rows moving" : "Rows"} width={width} links={links} />
      )}
      {board.legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted" aria-label="Legend">
          {board.legend.map((t) => <li key={t} className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm border ${TONE_CLASS[t]}`} aria-hidden />{TONE_GLYPH[t]} {TONE_WORD[t]}</li>)}
        </ul>
      )}
    </div>
  );
}
