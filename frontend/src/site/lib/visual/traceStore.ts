/**
 * Storage and navigation for a (possibly sampled) trace. Pure TypeScript, no React, so it is unit-testable in node.
 *
 * Wire format (written by the tracer, see `pyTrace.ts`): each recorded step lists its call frames; a frame's variables are
 * either the full name -> value-index map, or `[delta, removed]` against the previous recorded step's frame at the same depth
 * and with the same function. Only variables that changed are written, which keeps a large trace small on the wire.
 *
 * In memory the steps are rebuilt with structural sharing: a frame whose variables did not change reuses the previous
 * step's `vars` object, so keeping thousands of steps costs one small object per changed variable set, not one copy per step.
 */
import type { Trace, TraceGap, TraceStep, TraceFrame } from "./pyTrace";

/** One frame on the wire: variables in full, or a delta against the previous recorded step. */
export type RawFrame = [fn: string, line: number, vars: Record<string, number> | [Record<string, number>, string[]]];
export interface RawStep { q?: number; e: TraceStep["ev"]; l: number; f: RawFrame[]; o: number; r?: number; x?: [string, string]; i?: [number, number]; c?: 1 }

/** Rebuild steps from the wire format. Legacy steps (every frame in full, no sequence number) decode too. */
export function decodeSteps(raw: RawStep[]): TraceStep[] {
  const out: TraceStep[] = [];
  let prev: TraceFrame[] = [];
  for (const s of raw) {
    const frames: TraceFrame[] = s.f.map(([fn, line, v], idx) => {
      if (!Array.isArray(v)) return { fn, line, vars: v };
      const base = prev[idx];
      const [delta, removed] = v;
      if (!base || base.fn !== fn) return { fn, line, vars: delta }; // cannot happen with our encoder; be safe with foreign input
      if (removed.length === 0 && Object.keys(delta).length === 0) return { fn, line, vars: base.vars };
      const vars = { ...base.vars, ...delta };
      for (const name of removed) delete vars[name];
      return { fn, line, vars };
    });
    prev = frames;
    const step: TraceStep = { ev: s.e, line: s.l, frames, out: s.o };
    if (s.q !== undefined) step.seq = s.q;
    if (s.r !== undefined) step.ret = s.r;
    if (s.x) step.exc = { type: s.x[0], msg: s.x[1] };
    if (s.i) step.loop = s.i;
    if (s.c) step.cp = true;
    out.push(step);
  }
  return out;
}

/** The inverse of `decodeSteps` (same rule as the tracer): used by tests to prove the delta format loses nothing. */
export function encodeSteps(steps: TraceStep[]): RawStep[] {
  const out: RawStep[] = [];
  let prev: TraceFrame[] = [];
  for (const s of steps) {
    const f: RawFrame[] = s.frames.map((fr, idx) => {
      const base = prev[idx];
      if (!base || base.fn !== fr.fn) return [fr.fn, fr.line, fr.vars];
      const delta: Record<string, number> = {};
      for (const [k, v] of Object.entries(fr.vars)) if (base.vars[k] !== v) delta[k] = v;
      return [fr.fn, fr.line, [delta, Object.keys(base.vars).filter((k) => !(k in fr.vars))]];
    });
    prev = s.frames;
    const r: RawStep = { e: s.ev, l: s.line, f, o: s.out };
    if (s.seq !== undefined) r.q = s.seq;
    if (s.ret !== undefined) r.r = s.ret;
    if (s.exc) r.x = [s.exc.type, s.exc.msg];
    if (s.loop) r.i = s.loop;
    if (s.cp) r.c = 1;
    out.push(r);
  }
  return out;
}

export const num = (n: number) => n.toLocaleString("en-US");

// ── Gaps ─────────────────────────────────────────────────────────────────

/** The gap that lies immediately before recorded step `i` (between step i-1 and step i), if any. */
export function gapBefore(t: Trace, i: number): TraceGap | undefined {
  return t.gaps?.find((g) => g.before === i);
}

/** The gap right after recorded step `i`, if any. */
export function gapAfter(t: Trace, i: number): TraceGap | undefined {
  return t.gaps?.find((g) => g.after === i);
}

/** Plain-language account of what one gap skipped and why. Never implies the skipped steps exist. */
export function gapSummary(g: TraceGap): string {
  const events = `${num(g.skipped)} traced event${g.skipped === 1 ? "" : "s"} not recorded`;
  if (g.kind === "detached") return "Tracing had stopped here: the program ran on untraced to its end (how many events is not known).";
  if (g.kind === "limit") return `${events}: the step budget was reached, so only the first and last steps (and checkpoints) are kept.`;
  const parts = g.loops.map((l) => {
    const n = l.to - l.from + 1;
    return `loop at line ${l.line}${l.fn === "<module>" ? "" : ` in ${l.fn}()`}: iterations ${num(l.from)} to ${num(l.to)} summarised (${num(n)} iteration${n === 1 ? "" : "s"})`;
  });
  return `${parts.join("; ")}. ${events}.`;
}

/** Short label for a gap marker row. */
export function gapLabel(g: TraceGap): string {
  if (g.kind === "loop" && g.loops.length) {
    const first = g.loops[0], last = g.loops[g.loops.length - 1];
    const range = g.loops.length === 1 ? `iterations ${num(first.from)} to ${num(first.to)} summarised` : `iterations ${num(first.from)} to ${num(last.to)} summarised in ${g.loops.length} stretches`;
    return `${range} (${num(g.skipped)} events not recorded)`;
  }
  if (g.kind === "detached") return "tracing stopped here; the program ran on untraced to its end";
  return `${num(g.skipped)} events skipped (step budget)`;
}

// ── Pages: the viewer lists a window of the recorded steps, never all of them at once ─────────

export const PAGE_SIZE = 40;
export const pageCount = (n: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(n / size));
export const pageOf = (i: number, size = PAGE_SIZE) => Math.floor(Math.max(0, i) / size);

export type StepRow = { type: "step"; index: number; step: TraceStep } | { type: "gap"; gap: TraceGap };

/** Rows of one page: the recorded steps of that window, with a gap marker row wherever steps were skipped in between. */
export function pageRows(t: Trace, page: number, size = PAGE_SIZE): StepRow[] {
  const start = Math.max(0, page) * size;
  const end = Math.min(t.steps.length, start + size);
  const gapsBefore = new Map<number, TraceGap>();
  for (const g of t.gaps ?? []) if (g.before >= start && g.before < end) gapsBefore.set(g.before, g);
  const rows: StepRow[] = [];
  for (let i = start; i < end; i++) {
    const g = gapsBefore.get(i);
    if (g) rows.push({ type: "gap", gap: g });
    rows.push({ type: "step", index: i, step: t.steps[i] });
  }
  return rows;
}

// ── Jumps ────────────────────────────────────────────────────────────────

export interface Jumps { first: number; last: number; exception: number | null; nextCheckpoint: number | null; prevCheckpoint: number | null; nextGap: number | null }

/** Where each jump button goes from step `i` (indexes into `t.steps`; null when there is nowhere to go). */
export function jumpTargets(t: Trace, i: number): Jumps {
  const last = Math.max(0, t.steps.length - 1);
  let exception: number | null = t.exceptionStep ?? null;
  if (exception === null) {
    const idx = t.steps.map((s, k) => (s.ev === "exception" ? k : -1)).filter((k) => k >= 0);
    // With no recorded exit reason, the last exception step is the best answer only when the program really failed.
    exception = !t.ok && idx.length ? idx[idx.length - 1] : null;
  }
  const cps = t.checkpoints ?? [];
  const nextCheckpoint = cps.find((k) => k > i) ?? null;
  const prevCheckpoint = [...cps].reverse().find((k) => k < i) ?? null;
  const gaps = t.gaps ?? [];
  const nextGap = gaps.find((g) => g.before > i)?.before ?? null;
  return { first: 0, last, exception, nextCheckpoint, prevCheckpoint, nextGap };
}

/** One line saying where step `i` sits in the run: its place among recorded steps and its event number. */
export function stepPosition(t: Trace, i: number): string {
  const s = t.steps[i];
  if (!s) return "";
  const total = t.counts?.events;
  const ev = s.seq !== undefined ? ` · traced event ${num(s.seq)}${total ? ` of ${num(total)}` : ""}` : "";
  const loop = s.loop ? ` · loop at line ${s.loop[0]}, iteration ${num(s.loop[1])}` : "";
  return `Recorded step ${num(i + 1)} of ${num(t.steps.length)}${ev}${loop}${s.cp ? " · checkpoint" : ""}`;
}
