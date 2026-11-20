import { memo, useMemo, type CSSProperties } from "react";
import { ValueView } from "../../../components/visual/PythonTimeMachine";
import { EASE, MOTION } from "../../../lib/motion";
import { changedVars, type Trace } from "../../../lib/visual/pyTrace";
import type { LineEffect } from "../../../lib/visual/pyStory";

/**
 * Variable inspector. One row per variable of every frame on the stack (innermost first). A row says two things, both read from the trace:
 *   "just changed": the value differs from the previous recorded step of this function (what the line before this step did);
 *   "this line sets": the value the next recorded step holds (what the line at this step is about to do; `lineEffect`).
 * The row's colour changes with a short transition when it becomes one of these; with reduced motion the same chips are shown with no
 * transition. Rows are memoised on primitive props, so stepping re-renders only the rows whose text changed.
 */
interface RowProps {
  trace: Trace; name: string; idx: number; scopeLabel: string; typeName: string;
  change: "new" | "changed" | "" ; was: string; now: string; next: "new" | "changed" | ""; nextWas: string; nextNow: string; reduced: boolean;
}

const move: CSSProperties = { transitionDuration: `${MOTION.base}ms`, transitionTimingFunction: EASE.out };

const Row = memo(function Row({ trace, name, idx, scopeLabel, typeName, change, was, now, next, nextWas, nextNow, reduced }: RowProps) {
  const tint = change ? "bg-warn-dim" : next ? "bg-accent-dim" : "";
  return (
    <tr data-changed={change || undefined} data-next={next || undefined} style={reduced ? undefined : move} className={`${reduced ? "" : "transition-colors"} ${tint}`}>
      <td className="py-0.5 pr-2 align-top"><code className="font-semibold text-ink">{name}</code></td>
      <td className="py-0.5 pr-2 align-top"><ValueView t={trace} idx={idx} /></td>
      <td className="py-0.5 pr-2 align-top text-ink-faint">{typeName}</td>
      <td className="py-0.5 pr-2 align-top text-ink-muted">{scopeLabel}</td>
      <td className="py-0.5 align-top">
        <div className="flex flex-col items-start gap-0.5">
          {change === "new" && <span className="rounded bg-accent-dim px-1 text-accent" data-testid="chip-new">new</span>}
          {change === "changed" && <span className="rounded bg-warn-dim px-1 text-ink" data-testid="chip-changed">was <code>{was}</code> <span aria-hidden>→</span> <code>{now}</code></span>}
          {next && (
            <span className="rounded border border-dashed border-accent px-1 text-ink" data-testid="chip-next" title="What the line marked in the code sets, read from the next recorded step">
              this line: {next === "new" ? "creates" : <><code>{nextWas}</code> <span aria-hidden>→</span></>} <code>{nextNow}</code>
            </span>
          )}
        </div>
      </td>
    </tr>
  );
});

export const PyInspector = memo(function PyInspector({ trace, i, effect, reduced }: { trace: Trace; i: number; effect: LineEffect; reduced: boolean }) {
  const s = trace.steps[i];
  const changes = useMemo(() => changedVars(trace, i), [trace, i]);
  const rows = useMemo(() => {
    if (!s) return [];
    const out: { key: string; props: RowProps }[] = [];
    const top = s.frames.length - 1;
    for (let k = top; k >= 0; k--) {
      const f = s.frames[k];
      for (const [name, idx] of Object.entries(f.vars)) {
        const v = trace.vals[idx];
        if (v?.k === "func" || v?.k === "class") continue;
        const ch = k === top ? changes.find((c) => c.name === name) : undefined;
        const nx = effect.deltas.find((d) => d.depth === k + 1 && d.name === name && !d.isFunction);
        const clip = (x: number | undefined) => (x === undefined ? "" : trace.vals[x]?.r ?? "");
        out.push({ key: `${k}.${name}`, props: {
          trace, name, idx, scopeLabel: f.fn === "<module>" ? "global" : `${f.fn}()`, typeName: v?.t ?? v?.k ?? "",
          change: ch?.kind === "new" ? "new" : ch?.kind === "changed" ? "changed" : "", was: clip(ch?.before), now: clip(ch?.after),
          next: nx && nx.kind !== "removed" ? (nx.kind === "new" ? "new" : "changed") : "", nextWas: nx?.before ?? "", nextNow: nx?.after ?? "", reduced,
        } });
      }
    }
    return out;
  }, [trace, s, changes, effect, reduced]);
  const empty = rows.length === 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" aria-label="Variable inspector">
        <thead><tr className="text-ink-faint"><th className="pr-2 font-semibold">Name</th><th className="pr-2 font-semibold">Value</th><th className="pr-2 font-semibold">Type</th><th className="pr-2 font-semibold">Scope</th><th className="font-semibold">Changed</th></tr></thead>
        <tbody>{rows.map((r) => <Row key={r.key} {...r.props} />)}</tbody>
      </table>
      {empty && <p className="text-xs text-ink-faint">No variables yet.</p>}
      <p className="mt-1 text-[11px] text-ink-faint">Values are the state before the marked line runs. "was → now" compares with the previous recorded step of this function; "this line" shows what the marked line sets, from the next recorded step.</p>
    </div>
  );
});
