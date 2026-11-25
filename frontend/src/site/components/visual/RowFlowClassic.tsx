import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { RotateCcw, X } from "lucide-react";
import type { Stage } from "../../lib/visualize";
import { frameDelay, type Speed } from "../../lib/visual/playback";
import { baseFrame, identityHint, identityLabel, keyLabel, tonesIn, TONE_GLYPH, TONE_WORD, type Board, type BoardCard, type FlowFacts, type FlowFrame, type Tone } from "../../lib/visual/classic/rowFlow";

/**
 * Movement of rows between SQL stages, drawn from real stage results (see lib/visual/classic/rowFlow.ts and rowTrace.ts).
 * It only draws; it never runs or changes a query. Each stage plays its own before -> after move when the learner arrives at it
 * (forward or backward, at the playback speed) and has Replay / Before / After buttons.
 *
 * What moves, and why (every card is a row that really occurs in the stage's result):
 * - JOIN: a matched left row and right row are joined by a curve in one colour (a left row and all its matches share it), then the
 *   joined row appears in the Result lane; rows with no partner get "no match" and either stay or are dropped.
 * - WHERE / HAVING / LIMIT: rows travel to the Kept lane or the Removed (cut off) lane and carry the verdict (true, false, NULL).
 * - GROUP BY: rows travel into the bucket of their group, one colour per group.
 * - Aggregates: the rows of a group slide together into one result row, which appears with its calculated value.
 * - ORDER BY: rows travel to their sorted place and show how far they moved (up or down by n).
 * - Window functions: rows gather under their partition (colour per partition) and the calculated value appears on each row.
 * Anything a frame adds later (cells, after, verdict, calc, group, note on a card) is drawn from the card itself, not per clause.
 *
 * One tab stop: the board is a list with a roving tabindex (Up/Down/Home/End move, Enter or click inspects, Escape closes the
 * inspector). Left/Right and the playback keys are not used here, so a host can keep them for the step.
 *
 * Reduced motion: no transform, opacity or colour transition and no animation at all. The same information is shown as two
 * static boards, Before and After, with the same classes. Screen readers get the sentence in the live region.
 * Only transform and opacity ever animate, with the site's easing token and a duration scaled by the playback speed.
 */

const GAP = 4;
const GUT = 4; // width (in % of the board) of the gutter a join curve crosses
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

/* ---------- derived, per frame (pure) ---------- */

interface Link { a: string; b: string; g: number; pair: string }
interface Derived { group: Map<string, number>; labels: Map<number, string>; links: Link[]; linkSrc: Set<string>; linkDst: Set<string> }

const NONE: Derived = { group: new Map(), labels: new Map(), links: [], linkSrc: new Set(), linkDst: new Set() };

/** Group colours and join links, from the card fields when the frame set them and from the frame's facts otherwise. */
function derive(board: Board, facts: FlowFacts | undefined): Derived {
  const group = new Map<string, number>();
  const labels = new Map<number, string>();
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  let explicit = false;
  for (const c of board.cards) {
    if (typeof c.group === "number") {
      explicit = true;
      group.set(c.id, c.group);
      if (c.tone === "group" && !c.calc && !/[→=]/.test(c.text) && /[\p{L}\p{N}]/u.test(c.text) && !labels.has(c.group)) labels.set(c.group, c.text);
      else if (c.id.startsWith("L:") && !labels.has(c.group)) labels.set(c.group, `matches of ${c.text}`);
    }
  }
  if (!explicit && facts) {
    if (facts.matched.length) {
      const lefts = new Map<string, number>();
      const pairs = new Map<string, number>();
      facts.matched.forEach(([l, r]) => {
        if (!lefts.has(l)) lefts.set(l, lefts.size);
        const g = lefts.get(l)!;
        group.set(`L:${l}`, g);
        if (!group.has(`R:${r}`)) group.set(`R:${r}`, g);
        pairs.set(`pair:${l}~${r}`, g);
        if (!labels.has(g)) labels.set(g, `matches of ${byId.get(`L:${l}`)?.text ?? `left row ${g + 1}`}`);
      });
      for (const c of board.cards) if (c.id.startsWith("pair:")) { let id = c.id; while (id.endsWith("'")) id = id.slice(0, -1); if (pairs.has(id)) group.set(c.id, pairs.get(id)!); }
    } else if (facts.groups.length) {
      facts.groups.forEach((gr, g) => {
        group.set(`bucket:${gr.key}`, g);
        labels.set(g, keyLabel(gr.key));
        for (const m of gr.members) group.set(m, g);
      });
    }
  }
  const links: Link[] = [];
  const linkSrc = new Set<string>(), linkDst = new Set<string>();
  for (const [l, r] of facts?.matched ?? []) {
    const a = `L:${l}`, b = `R:${r}`;
    if (!byId.has(a) || !byId.has(b)) continue;
    links.push({ a, b, g: group.get(a) ?? 0, pair: `pair:${l}~${r}` });
    linkSrc.add(a); linkDst.add(b);
  }
  return { group, labels, links, linkSrc, linkDst };
}

/** Column names and values of a card, as the inspector shows them. */
function rowValues(c: BoardCard): { cols: string; value: string }[] {
  if (c.cols && c.cells && c.cells.length) return c.cells.map((v, i) => ({ cols: c.cols![i] ?? `col${i + 1}`, value: v }));
  const out: { cols: string; value: string }[] = [];
  for (const line of c.title.split("\n")) {
    const m = /^(.+?) = ([\s\S]*)$/.exec(line);
    if (m) out.push({ cols: m[1], value: m[2] });
    else if (out.length) out[out.length - 1].value += `\n${line}`;
    else if (line) out.push({ cols: "row", value: line });
  }
  return out;
}

const verdictText = (c: BoardCard, tone: Tone, kind: string, clause: string): string => {
  if (c.verdict) return `${clause.toUpperCase()} is ${c.verdict.value}${c.verdict.detail ? ` (${c.verdict.detail})` : ""}: ${tone === "kept" ? "kept" : "removed"}`;
  if (kind === "filter") return tone === "kept" ? `kept by ${clause.toUpperCase()}` : tone === "removed" ? `removed by ${clause.toUpperCase()}` : TONE_WORD[tone];
  if (kind === "limit") return tone === "kept" ? "kept by LIMIT" : tone === "cut" ? "cut off" : TONE_WORD[tone];
  return TONE_WORD[tone];
};

const laneName = (board: Board, lane: number) => (Number.isInteger(lane) && lane >= 0 && board.lanes[lane] ? board.lanes[lane].label : "");

/* ---------- one card ---------- */

interface CardProps {
  c: BoardCard; i: number; n: number; rowH: number; phase: 0 | 1; animated: boolean; dur: number;
  g: number; selected: boolean; tabbable: boolean; focusable: boolean; hidden: boolean; marginLeft: number; marginRight: number;
  onPick: (id: string) => void; onActive: (id: string) => void; reg?: Map<string, HTMLElement>;
}

const CardView = memo(function CardView({ c, i, n, rowH, phase, animated, dur, g, selected, tabbable, focusable, hidden, marginLeft, marginRight, onPick, onActive, reg }: CardProps) {
  const s = phase === 0 ? c.from : c.to;
  const tone = phase === 0 ? c.toneBefore : c.tone;
  const delay = Math.min(i * 18, 360) + (c.appear ? Math.round(dur * 0.35) : 0);
  const style: CSSProperties = {
    position: "absolute", top: GAP, left: 0, width: `${100 / n}%`, height: rowH, padding: "0 2px",
    transform: `translate(${s.lane * 100}%, ${s.row * (rowH + GAP)}px)`,
    opacity: hidden ? 0 : 1,
    ...(animated ? { transition: `transform ${dur}ms var(--ease-out) ${delay}ms, opacity ${dur}ms var(--ease-out) ${delay}ms` } : {}),
  };
  const after = phase === 1;
  const text = after && c.textAfter ? c.textAfter : c.text;
  const delta = c.from.lane === c.to.lane && c.from.row !== c.to.row ? c.from.row - c.to.row : 0; // sort: rows up (positive) or down
  const calc = c.calc;
  // Values a stage computes (verdict, calc, a new column) are not there yet in the "before" picture: faded in when animated, left out when static.
  const chip = (cls: string, key: string, body: string, title?: string) => (!animated && !after ? null : (
    <span key={key} className={`shrink-0 text-[10px] ${cls}`} title={title}
      style={animated ? { opacity: after ? 1 : 0, transition: `opacity ${dur}ms var(--ease-out) ${Math.round(dur * 0.5)}ms` } : undefined}>{body}</span>
  ));
  // A column the stage adds to the row (a line value, a window value) that the card text does not already carry.
  const added = !c.textAfter && c.after && c.cells && c.after.cells.length > c.cells.length ? c.after.cells.slice(c.cells.length) : undefined;
  const addedChip = added ? chip("max-w-[55%] truncate font-mono font-semibold text-ink", "a", `= ${added.join(" · ")}`, c.after!.cols.slice(c.cells!.length).map((n, i) => `${n} = ${added[i]}`).join("\n")) : null;
  const verdict = c.verdict ? chip(c.verdict.value === "true" ? "font-semibold text-success" : "font-semibold text-danger", "v", c.verdict.value, c.verdict.detail) : null;
  return (
    <div
      ref={reg ? (el) => { if (el) reg.set(c.id, el); else reg.delete(c.id); } : undefined}
      role="listitem" tabIndex={focusable && !hidden ? (tabbable ? 0 : -1) : undefined} style={style} data-card={c.id} data-tone={tone} data-stale={hidden ? "true" : undefined}
      aria-hidden={hidden ? true : undefined} aria-current={selected ? "true" : undefined}
      className="cx-card" onClick={() => onPick(c.id)} onFocus={() => onActive(c.id)}
      aria-label={`${text} (${TONE_WORD[tone]}${c.badge ? `, ${c.badge}` : ""}${c.verdict ? `, ${c.verdict.value}` : ""}${calc ? `, ${calc}` : ""})`}
      title={`${c.title}${c.badge ? `\n${c.badge}` : ""}${c.note ? `\n${c.note}` : ""}`}
    >
      <div className={`cx-chip flex h-full items-center gap-1 rounded-md border px-1.5 text-[11px] leading-none ${TONE_CLASS[tone]}${g >= 0 ? ` cx-g${g % 6} cx-has-g` : ""}`} style={marginLeft || marginRight ? { marginLeft: `${marginLeft}%`, marginRight: `${marginRight}%` } : undefined}>
        {TONE_GLYPH[tone] && <span aria-hidden className="shrink-0 text-[10px]">{TONE_GLYPH[tone]}</span>}
        <span className="cx-text min-w-0 flex-1 truncate font-mono">{text}</span>
        {delta !== 0 && after && <span aria-hidden className={`shrink-0 text-[10px] font-semibold ${delta > 0 ? "text-success" : "text-warn"}`} title={`moved ${delta > 0 ? "up" : "down"} ${Math.abs(delta)}`}>{delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>}
        {verdict}
        {addedChip}
        {calc && chip("max-w-[55%] truncate font-mono font-semibold text-ink", "c", calc)}
        {c.badge && <span className="cx-badge shrink-0 truncate text-[9px] text-ink-faint">{c.badge}</span>}
      </div>
    </div>
  );
});

/* ---------- one board ---------- */

interface BoardProps {
  board: Board; facts?: FlowFacts; phase: 0 | 1; animated: boolean; dur: number; label: string; rowH: number;
  selected: string | null; onPick: (id: string) => void; onClose: () => void; focusable: boolean; reg?: Map<string, HTMLElement>;
}

const BoardView = memo(function BoardView({ board, facts, phase, animated, dur, label, rowH, selected, onPick, onClose, focusable, reg }: BoardProps) {
  const n = board.lanes.length;
  const d = useMemo(() => derive(board, facts), [board, facts]);
  // A static board has no "moment in between": rows that appear later are absent before, rows that merge are absent after.
  const cards = useMemo(() => (animated ? board.cards : board.cards.filter((c) => (phase === 0 ? !c.appear : !c.vanish))), [animated, board, phase]);
  const isHidden = (c: BoardCard) => animated && (phase === 0 ? !!c.appear : !!c.vanish);
  const [active, setActive] = useState<string | null>(null);
  const firstVisible = cards.find((c) => !isHidden(c))?.id ?? null;
  const tabId = active && cards.some((c) => c.id === active && !isHidden(c)) ? active : firstVisible;
  const height = board.rows * (rowH + GAP) + GAP;
  const linked = phase === 1 && d.links.length > 0;
  const slot = (id: string) => board.cards.find((c) => c.id === id)!.to;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-card]");
    if (!el || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Escape") { if (selected) { e.preventDefault(); e.stopPropagation(); onClose(); } return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(el.dataset.card!); return; }
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]:not([aria-hidden='true'])")];
    const at = items.indexOf(el);
    const to = e.key === "ArrowDown" ? Math.min(items.length - 1, at + 1) : e.key === "ArrowUp" ? Math.max(0, at - 1) : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault(); e.stopPropagation();
    items[to]?.focus();
  };

  return (
    <div className="cx-boardwrap">
      <div className="grid gap-1 pb-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden>
        {board.lanes.map((l, i) => (
          <p key={i} className="truncate px-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint" title={`${l.label}${l.count ? ` · ${l.count}` : ""}`}>
            {l.label}{l.count ? <span className="ml-1 font-normal normal-case tracking-normal text-ink-muted">{l.count}</span> : null}
          </p>
        ))}
      </div>
      {/* keyed by nothing: the caller remounts the whole board when the step or the replay changes, so cards start at "before" */}
      <div
        role="list" aria-label={label} data-testid="rowflow-board" data-lanes={Math.min(n, 4)} data-phase={phase === 0 ? "before" : "after"}
        className="relative overflow-hidden rounded-lg border border-surface-border bg-surface" style={{ height }} onKeyDown={focusable ? onKeyDown : undefined}
      >
        {d.links.length > 0 && (animated || phase === 1) && (
          <svg aria-hidden width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0" data-testid="rowflow-links">
            {d.links.map((l, i) => {
              const a = slot(l.a), b = slot(l.b);
              if (b.lane <= a.lane) return null;
              const x1 = ((a.lane + 1) * 100) / n - GUT, x2 = (b.lane * 100) / n + GUT, xm = (x1 + x2) / 2;
              const y1 = GAP + a.row * (rowH + GAP) + rowH / 2, y2 = GAP + b.row * (rowH + GAP) + rowH / 2;
              const on = selected !== null && (selected === l.a || selected === l.b || selected === l.pair);
              const dim = selected !== null && !on;
              return (
                <path
                  key={`${l.a}>${l.b}:${i}`} data-link={`${l.a}>${l.b}`} className={`cx-link cx-g${l.g % 6}`} vectorEffect="non-scaling-stroke"
                  d={`M${x1} ${y1} C${xm} ${y1} ${xm} ${y2} ${x2} ${y2}`} strokeWidth={on ? 3 : 1.75}
                  style={{ opacity: linked ? (dim ? 0.25 : 1) : 0, ...(animated ? { transition: `opacity ${dur}ms var(--ease-out) ${Math.round(dur * 0.25)}ms` } : {}) }}
                />
              );
            })}
          </svg>
        )}
        {cards.map((c, i) => (
          <CardView
            key={`${i}:${c.id}`} c={c} i={i} n={n} rowH={rowH} phase={phase} animated={animated} dur={dur}
            g={d.group.get(c.id) ?? -1} selected={selected === c.id} tabbable={c.id === tabId} focusable={focusable} hidden={isHidden(c)}
            marginLeft={d.linkDst.has(c.id) ? GUT * n : 0} marginRight={d.linkSrc.has(c.id) ? GUT * n : 0}
            onPick={onPick} onActive={setActive} reg={focusable ? reg : undefined}
          />
        ))}
      </div>
    </div>
  );
});

/* ---------- the row inspector ---------- */

function Inspector({ card, board, kind, clause, phase, onClose }: { card: BoardCard; board: Board; kind: string; clause: string; phase: 0 | 1; onClose: () => void }) {
  const values = rowValues(card);
  const tone = phase === 0 ? card.toneBefore : card.tone;
  const verdict = verdictText(card, card.tone, kind, clause);
  const from = laneName(board, card.from.lane), to = laneName(board, card.to.lane);
  const moved = card.from.lane !== card.to.lane || card.from.row !== card.to.row;
  const summary = `Row details. ${values.slice(0, 8).map((v) => `${v.cols} ${v.value}`).join(", ")}${values.length > 8 ? `, and ${values.length - 8} more columns` : ""}. ${verdict}.`;
  return (
    <section
      data-testid="classic-inspect" role="region" aria-label="Row details" className="cx-inspect max-h-56 overflow-auto rounded-lg border border-surface-border bg-surface p-2 text-xs"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
    >
      <p className="sr-only" aria-live="polite">{summary}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-ink"><span aria-hidden>{TONE_GLYPH[tone]} </span>{verdict}{card.badge ? <span className="ml-2 font-normal text-ink-muted">{card.badge}</span> : null}</p>
        <button type="button" onClick={onClose} aria-label="Close row details" className="cx-btn inline-flex items-center justify-center rounded-md border border-surface-border px-1.5 text-ink-muted hover:text-ink"><X className="h-3.5 w-3.5" aria-hidden /></button>
      </div>
      {values.length > 0 && (
        <dl className="mt-1 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {values.map((v, i) => (<div key={i} className="contents"><dt className="truncate text-ink-faint">{v.cols}</dt><dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-ink">{v.value}</dd></div>))}
        </dl>
      )}
      {card.after && card.after.cells.length > 0 && (
        <>
          <p className="mt-2 font-semibold text-ink-muted">After this stage</p>
          <dl className="mt-0.5 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            {card.after.cells.map((v, i) => (<div key={i} className="contents"><dt className="truncate text-ink-faint">{card.after!.cols[i] ?? `col${i + 1}`}</dt><dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-ink">{v}</dd></div>))}
          </dl>
        </>
      )}
      {card.calc && <p className="mt-1 font-mono font-semibold text-ink">{card.calc}</p>}
      {card.note && <p className="mt-1 text-ink-muted">{card.note}</p>}
      {moved && (from || to) && <p className="mt-1 text-ink-muted">{from ? `Before: ${from}, row ${card.from.row + 1}` : ""}{from && to ? " · " : ""}{to ? `After: ${to}, row ${card.to.row + 1}` : ""}</p>}
    </section>
  );
}

/* ---------- the component ---------- */

const btn = "cx-btn inline-flex items-center gap-1 rounded-md border border-surface-border px-2 py-0.5 text-[11px] text-ink-muted hover:text-ink aria-pressed:bg-accent aria-pressed:text-on-accent";

function useRowHeight(): number {
  const [h] = useState(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches ? 40 : 28));
  return h;
}

export const RowFlow = memo(function RowFlow({ stage, prev, reduced, frame, stageIndex = 0, speed = 1, refining = false, liveRegion = true }: {
  stage: Stage;
  prev?: Stage;
  reduced: boolean;
  /** The frame to draw (the host passes the one from useClassicStep). Only a standalone use without it falls back to the stage's own sample. */
  frame?: FlowFrame;
  stageIndex?: number;
  speed?: Speed;
  /** true while the real row ids are still being looked up (the sample-based frame is shown meanwhile); the host sets it false when the trace arrives or fails. */
  refining?: boolean;
  /** false when the host announces step changes elsewhere (the row sentence is then not a live region). */
  liveRegion?: boolean;
}) {
  const f = useMemo(() => frame ?? baseFrame(stage, prev, stageIndex), [frame, stage, prev, stageIndex]);
  const key = `${stageIndex}:${f.clause}`;
  const rowH = useRowHeight();
  const [variant, setVariant] = useState<{ k: string; i: number } | null>(null);
  const [viewState, setViewState] = useState<{ k: string; v: "before" | "after" } | null>(null);
  const [replay, setReplay] = useState(0);
  const vCount = f.variants?.length ?? 0;
  const vi = variant && variant.k === key ? Math.min(variant.i, vCount - 1) : vCount - 1;
  const v = vCount ? f.variants![vi] : undefined;
  const board = v?.board ?? f.board;
  const facts = v?.facts ?? f.facts;
  const summary = v?.summary ?? f.summary;
  const limited = v?.limited ?? f.limited;
  // A step change, a join step change and a replay all start a new animation; the same step again never does. The view buttons
  // belong to one step and are forgotten when the step changes, so a new step never opens stuck on "before".
  const boardKey = `${key}:${vi}:${replay}`;
  const view = viewState && viewState.k === key ? viewState.v : "play";
  const animKey = boardKey;
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (reduced || view !== "play") return;
    const t = window.setTimeout(() => setDone(animKey), 80);
    return () => window.clearTimeout(t);
  }, [animKey, reduced, view]);
  // Each stage change restarts from "before" without a flash of the final state: `done` names the animation that has finished.
  const phase: 0 | 1 = view === "before" ? 0 : view === "after" ? 1 : done === animKey ? 1 : 0;
  const dur = Math.round(Math.min(900, Math.max(250, frameDelay(speed) * 0.5)));

  const [sel, setSel] = useState<{ k: string; id: string } | null>(null);
  const reg = useRef(new Map<string, HTMLElement>());
  const pickedKey = `${key}:${vi}`;
  const selId = sel && sel.k === pickedKey && board?.cards.some((c) => c.id === sel.id) ? sel.id : null;
  const onPick = useCallback((id: string) => setSel({ k: pickedKey, id }), [pickedKey]);
  const selIdRef = useRef<string | null>(null);
  selIdRef.current = selId;
  const onClose = useCallback(() => {
    const id = selIdRef.current;
    setSel(null);
    if (id) reg.current.get(id)?.focus(); // Escape or Close: the focus goes back to the row that was inspected
  }, []);
  const d = useMemo(() => (board ? derive(board, facts) : NONE), [board, facts]);

  if (!summary && !board) return null;
  const tones = tonesIn(board);
  const selCard = selId && board ? board.cards.find((c) => c.id === selId) : undefined;
  const legend = [...new Set([...d.group.values()])].sort((a, b) => a - b);
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-surface-border bg-surface-raised p-2" data-testid="rowflow" data-step-index={stageIndex} data-reduced={reduced ? "true" : "false"} data-kind={f.kind} data-refining={refining && f.source === "stage" ? "true" : "false"} data-phase={reduced ? "static" : phase === 0 ? "before" : "after"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Rows moving through {f.clause.toUpperCase()}</p>
        {board && !reduced && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Row animation controls">
            <button type="button" className={btn} onClick={() => { setViewState(null); setReplay((x) => x + 1); }}><RotateCcw className="h-3 w-3" aria-hidden /> Replay</button>
            <button type="button" className={btn} aria-pressed={view === "before"} onClick={() => setViewState(view === "before" ? null : { k: key, v: "before" })}>Before</button>
            <button type="button" className={btn} aria-pressed={view === "after"} onClick={() => setViewState(view === "after" ? null : { k: key, v: "after" })}>After</button>
          </div>
        )}
      </div>
      <p aria-live={liveRegion ? "polite" : "off"} data-testid="rowflow-live" className="text-xs text-ink">{summary}</p>
      {refining && f.source === "stage" && <p role="status" data-testid="rowflow-refining" className="text-[11px] text-ink-muted">looking up real row ids…</p>}
      {board && (
        <>
          {vCount > 1 && (
            <label className="flex items-center gap-1 text-xs text-ink-muted">{f.kind === "join" ? "Join step" : "Part of this stage"}
              <select aria-label={f.kind === "join" ? "Join step" : "Part of this stage"} value={vi} onChange={(e) => setVariant({ k: key, i: Number(e.target.value) })} className="cx-select min-w-0 max-w-full rounded-md border border-surface-border bg-surface px-1 text-xs text-ink">
                {f.variants!.map((x, i) => <option key={i} value={i}>{i + 1}. {x.label}</option>)}
              </select>
            </label>
          )}
          {board.cards.length === 0 ? (
            // A frame with no cards is a real result (e.g. WHERE removed every row): say so, with the counts the frame carries.
            <div role="note" data-testid="rowflow-empty" className="rounded-lg border border-dashed border-surface-border bg-surface px-3 py-4 text-center text-xs text-ink-muted">
              <p className="font-semibold text-ink">No rows to draw at this step.</p>
              <p className="mt-1">{board.lanes.map((l) => `${l.label}${l.count ? ` ${l.count}` : ""}`).join(" · ")}</p>
            </div>
          ) : reduced ? (
            <div className="space-y-2" data-testid="rowflow-static">
              <section aria-label="Before this stage"><p className="mb-1 text-[11px] font-semibold text-ink-muted">Before</p><BoardView board={board} facts={facts} phase={0} animated={false} dur={0} label="Rows before this stage" rowH={rowH} selected={selId} onPick={onPick} onClose={onClose} focusable={false} /></section>
              <section aria-label="After this stage"><p className="mb-1 text-[11px] font-semibold text-ink-muted">After</p><BoardView board={board} facts={facts} phase={1} animated={false} dur={0} label="Rows after this stage" rowH={rowH} selected={selId} onPick={onPick} onClose={onClose} focusable reg={reg.current} /></section>
            </div>
          ) : (
            <BoardView key={boardKey} board={board} facts={facts} phase={phase} animated dur={dur} label={phase ? "Rows after this stage" : "Rows before this stage"} rowH={rowH} selected={selId} onPick={onPick} onClose={onClose} focusable reg={reg.current} />
          )}
          {selCard ? <Inspector card={selCard} board={board} kind={f.kind} clause={f.clause} phase={reduced || phase === 1 ? 1 : 0} onClose={onClose} />
            : board.cards.length > 0 && <p className="text-[11px] text-ink-faint">Click a row, or focus one and press Enter, to see its values. Up and Down move between rows.</p>}
          {(tones.length > 0 || legend.length > 0) && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted" aria-label="Legend">
              {tones.map((t) => <li key={t} className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm border ${TONE_CLASS[t]}`} aria-hidden />{TONE_GLYPH[t]} {TONE_WORD[t]}</li>)}
              {legend.length > 0 && legend.length <= 6 && legend.map((g) => <li key={`g${g}`} className="flex min-w-0 items-center gap-1"><span aria-hidden className={`cx-dot cx-g${g % 6}`} /><span className="truncate">{d.labels.get(g) ?? `group ${g + 1}`}</span></li>)}
            </ul>
          )}
          {limited && <p data-testid="rowflow-limited" className="text-[11px] text-ink-muted">Sample: {limited}. The counts in the table below are exact; rows that are not drawn are counted, not invented.</p>}
          {f.kind !== "none" && (
            <p data-testid="rowflow-identity" title={identityHint(f.identity)} className="text-[11px] text-ink-faint">
              {identityLabel(f.identity)}{f.identityNote ? ` · ${f.identityNote}` : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
});
