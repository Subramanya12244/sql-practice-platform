import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import type { Stage } from "../../lib/visualize";
import { frameDelay, type Speed } from "../../lib/visual/playback";
import { baseFrame, identityHint, identityLabel, tonesIn, TONE_GLYPH, TONE_WORD, type Board, type BoardCard, type FlowFrame, type Tone } from "../../lib/visual/rowFlow";

/**
 * Movement of rows between SQL stages, drawn from real stage results (see lib/visual/rowFlow.ts and rowTrace.ts).
 * Each stage plays its own before -> after move when the learner arrives at it (forward or backward, with the playback
 * speed) and has Replay / Before / After buttons. It only draws; it never runs or changes a query.
 *
 * Reduced motion: no transform, opacity or colour transition and no animation at all. The same information is shown as two
 * static boards, Before and After, with the same highlight classes. Screen readers get the sentence in the live region.
 */

const ROW = 28, GAP = 4;
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

function BoardView({ board, phase, animated, dur, label }: { board: Board; phase: 0 | 1; animated: boolean; dur: number; label: string }) {
  const n = board.lanes.length;
  // A static board has no "moment in between": rows that appear later are absent before, rows that merge are absent after.
  const cards = animated ? board.cards : board.cards.filter((c) => (phase === 0 ? !c.appear : !c.vanish));
  const slot = (c: BoardCard) => (phase === 0 ? c.from : c.to);
  return (
    <div className="min-w-0">
      <div className="grid gap-1 pb-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden>
        {board.lanes.map((l, i) => (
          <p key={i} className="truncate px-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint" title={`${l.label}${l.count ? ` · ${l.count}` : ""}`}>
            {l.label}{l.count ? <span className="ml-1 font-normal normal-case tracking-normal text-ink-muted">{l.count}</span> : null}
          </p>
        ))}
      </div>
      <div role="list" aria-label={label} data-testid="rowflow-board" className="relative overflow-hidden rounded-lg border border-surface-border bg-surface" style={{ height: board.rows * (ROW + GAP) + GAP }}>
        {cards.map((c, i) => {
          const s = slot(c);
          const tone = phase === 0 ? c.toneBefore : c.tone;
          const hidden = animated && (phase === 0 ? c.appear : c.vanish);
          const style: CSSProperties = {
            position: "absolute", top: GAP, left: 0, width: `${100 / n}%`, height: ROW, padding: "0 2px",
            transform: `translate(${s.lane * 100}%, ${s.row * (ROW + GAP)}px)`,
            opacity: hidden ? 0 : 1,
            ...(animated ? { transition: `transform ${dur}ms ease, opacity ${dur}ms ease`, transitionDelay: `${Math.min(i * 18, 360)}ms` } : {}),
          };
          const text = phase === 1 && c.textAfter ? c.textAfter : c.text;
          return (
            <div key={`${i}:${c.id}`} role="listitem" style={style} data-card={c.id} data-tone={tone} aria-label={`${text} (${TONE_WORD[tone]}${c.badge ? `, ${c.badge}` : ""})`} title={`${c.title}${c.badge ? `\n${c.badge}` : ""}`}>
              <div className={`flex h-full items-center gap-1 rounded-md border px-1.5 text-[11px] leading-none ${TONE_CLASS[tone]}`}>
                {TONE_GLYPH[tone] && <span aria-hidden className="shrink-0 text-[10px]">{TONE_GLYPH[tone]}</span>}
                <span className="min-w-0 flex-1 truncate font-mono">{text}</span>
                {c.badge && n <= 2 && <span className="shrink-0 text-[9px] text-ink-faint">{c.badge}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const btn = "inline-flex items-center gap-1 rounded-md border border-surface-border px-2 py-0.5 text-[11px] text-ink-muted hover:text-ink aria-pressed:bg-accent aria-pressed:text-white";

export function RowFlow({ stage, prev, reduced, frame, stageIndex = 0, speed = 1, refining = false }: {
  stage: Stage;
  prev?: Stage;
  reduced: boolean;
  /** Row-level frame from rowTrace; without it the frame is drawn from the stage's own sample. */
  frame?: FlowFrame;
  stageIndex?: number;
  speed?: Speed;
  refining?: boolean;
}) {
  const f = useMemo(() => frame ?? baseFrame(stage, prev, stageIndex), [frame, stage, prev, stageIndex]);
  const key = `${stageIndex}:${f.clause}`;
  const [variant, setVariant] = useState<{ k: string; i: number } | null>(null);
  const [view, setView] = useState<"play" | "before" | "after">("play");
  const [replay, setReplay] = useState(0);
  const vCount = f.variants?.length ?? 0;
  const vi = variant && variant.k === key ? Math.min(variant.i, vCount - 1) : vCount - 1;
  const v = vCount ? f.variants![vi] : undefined;
  const board = v?.board ?? f.board;
  const summary = v?.summary ?? f.summary;
  const limited = v?.limited ?? f.limited;
  const animKey = `${key}:${vi}:${replay}:${view}`;
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (reduced || view !== "play") return;
    const t = window.setTimeout(() => setDone(animKey), 80);
    return () => window.clearTimeout(t);
  }, [animKey, reduced, view]);
  // Each stage change restarts from "before" without a flash of the final state.
  const phase: 0 | 1 = view === "before" ? 0 : view === "after" ? 1 : done === animKey ? 1 : 0;
  const dur = Math.round(Math.min(900, Math.max(250, frameDelay(speed) * 0.5)));

  if (!summary && !board) return null;
  const tones = tonesIn(board);
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-surface-border bg-surface-raised p-2" data-testid="rowflow" data-reduced={reduced ? "true" : "false"} data-kind={f.kind}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Rows moving through {f.clause.toUpperCase()}</p>
        {board && !reduced && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Row animation controls">
            <button type="button" className={btn} onClick={() => { setView("play"); setReplay((n) => n + 1); }}><RotateCcw className="h-3 w-3" aria-hidden /> Replay</button>
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
              <section aria-label="Before this stage"><p className="mb-1 text-[11px] font-semibold text-ink-muted">Before</p><BoardView board={board} phase={0} animated={false} dur={0} label="Rows before this stage" /></section>
              <section aria-label="After this stage"><p className="mb-1 text-[11px] font-semibold text-ink-muted">After</p><BoardView board={board} phase={1} animated={false} dur={0} label="Rows after this stage" /></section>
            </div>
          ) : (
            <BoardView board={board} phase={phase} animated dur={dur} label={phase ? "Rows after this stage" : "Rows before this stage"} />
          )}
          {tones.length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted" aria-label="Legend">
              {tones.map((t) => <li key={t} className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm border ${TONE_CLASS[t]}`} aria-hidden />{TONE_GLYPH[t]} {TONE_WORD[t]}</li>)}
            </ul>
          )}
          {limited && <p data-testid="rowflow-limited" className="text-[11px] text-ink-muted">Sample: {limited}. The counts in the table below are exact; rows that are not drawn are counted, not invented.</p>}
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
