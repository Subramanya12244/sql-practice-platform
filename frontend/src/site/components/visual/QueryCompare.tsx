import { useState } from "react";
import { Loader2 } from "lucide-react";
import { runQuery } from "../../lib/browserDb";
import { visualize, type Visualization } from "../../lib/visualize";
import { compareSolutions, type Comparison } from "../../lib/compareSolutions";
import { compareStages, operationsOf } from "../../lib/visual/stageCompare";
import { ProvenanceBadge } from "./Playback";

const area = "w-full rounded-lg border border-surface-border bg-surface-soft p-2 font-mono text-xs text-ink";

/**
 * Compare your query with an alternative (and optionally the expected solution): same output? same logical steps? what did
 * PostgreSQL's plan cost? All figures come from really running the queries here; plan costs are the planner's estimates.
 */
export function QueryCompare({ initialA = "", initialB = "", expected }: { initialA?: string; initialB?: string; expected?: string }) {
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ cmp: Comparison; va?: Visualization; vb?: Visualization; vs?: { match: boolean; message: string } } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null);
    try {
      const cmp = await compareSolutions(a, b, runQuery);
      const [va, vb] = await Promise.all([visualize(a, runQuery), visualize(b, runQuery)]);
      let vs: { match: boolean; message: string } | undefined;
      if (expected) { const c = await compareSolutions(a, expected, runQuery); vs = { match: c.equivalent, message: c.message }; }
      setOut({ cmp, va, vb, vs });
    } catch (e) { setErr(e instanceof Error ? e.message : "Comparison failed"); }
    setBusy(false);
  }

  const rows = out ? compareStages(out.va, out.vb) : [];
  return (
    <section aria-label="Compare queries" className="space-y-3 rounded-card border border-surface-border bg-surface-raised p-4">
      <h3 className="font-display text-base font-bold text-ink">Compare two queries</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-ink-muted">Your query<textarea className={area} rows={6} value={a} onChange={(e) => setA(e.target.value)} /></label>
        <label className="text-xs font-semibold text-ink-muted">Alternative (for example an optimised version)<textarea className={area} rows={6} value={b} onChange={(e) => setB(e.target.value)} /></label>
      </div>
      <button type="button" onClick={go} disabled={busy || !a.trim() || !b.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Compare
      </button>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {out && (
        <div className="space-y-3 text-sm">
          <p role="status" className={out.cmp.equivalent ? "text-success" : "text-warn"}>Output: {out.cmp.message} <ProvenanceBadge p="executed" /></p>
          {out.vs && <p className={out.vs.match ? "text-success" : "text-warn"}>Your query against the expected solution: {out.vs.message}</p>}
          <table className="w-full text-left text-xs">
            <caption className="mb-1 text-left text-ink-faint">Logical steps and rows after each (counts are exact)</caption>
            <thead><tr className="text-ink-faint"><th className="py-1">Step</th><th>Your query</th><th>Alternative</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.clause} className="border-t border-surface-border"><td className="py-1 font-mono uppercase">{r.clause}</td><td>{r.a ? r.a.rowsOut ?? "n/a" : "not used"}</td><td>{r.b ? r.b.rowsOut ?? "n/a" : "not used"}</td><td>{r.same ? "same" : ""}</td></tr>
            ))}</tbody>
          </table>
          <p className="text-xs text-ink-muted">Operations: yours {operationsOf(out.va).join(" → ") || "none"}; alternative {operationsOf(out.vb).join(" → ") || "none"}.</p>
          <p className="text-xs text-ink-muted">Plan cost: yours {out.cmp.a.planCost ?? "unavailable"}, alternative {out.cmp.b.planCost ?? "unavailable"} <ProvenanceBadge p="estimated" />. Median run time: {out.cmp.a.medianMs ?? "n/a"} ms and {out.cmp.b.medianMs ?? "n/a"} ms in this browser.</p>
        </div>
      )}
    </section>
  );
}
