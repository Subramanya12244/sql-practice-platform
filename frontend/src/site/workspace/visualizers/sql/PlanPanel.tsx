import { useContext, useState } from "react";
import { Loader2 } from "lucide-react";
import { PlanTree, parsePlan, type PlanNode } from "../../../components/PlanTree";
import { SourceBadge } from "../../../components/VizView";
import { SqlBackendContext } from "../../adapters/sql/backend";
import type { SqlPlanData } from "../../adapters/sql/model";

type Analyzed = { node: PlanNode | null; error?: string; executionMs?: number; planningMs?: number };

/** `Execution Time` and `Planning Time` sit next to the plan in EXPLAIN ANALYZE's JSON, outside the plan tree. */
export function timesOf(cell: unknown): { executionMs?: number; planningMs?: number } {
  try {
    const v = typeof cell === "string" ? JSON.parse(cell) : cell;
    const root = Array.isArray(v) ? v[0] : v;
    return { executionMs: typeof root?.["Execution Time"] === "number" ? root["Execution Time"] : undefined, planningMs: typeof root?.["Planning Time"] === "number" ? root["Planning Time"] : undefined };
  } catch { return {}; }
}

/** The plan the planner chose (estimates) and, only on request, what actually happened (EXPLAIN ANALYZE). The two are never mixed. */
export function PlanPanel({ plan, sql, dataset }: { plan: SqlPlanData; sql: string; dataset: string }) {
  const backend = useContext(SqlBackendContext);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analyzed, setAnalyzed] = useState<Analyzed | null>(null);

  async function analyze() {
    setAsking(false); setBusy(true);
    const r = await backend.run(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, dataset);
    setAnalyzed(r.success ? { node: parsePlan(r.rows[0]?.[0]), ...timesOf(r.rows[0]?.[0]) } : { node: null, error: r.message ?? "EXPLAIN ANALYZE failed" });
    setBusy(false);
  }
  const root = analyzed?.node;
  return (
    <div className="space-y-3 text-sm" data-testid="sql-plan">
      <section className="space-y-2" aria-label="Planner's plan">
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted"><SourceBadge s="plan" /> <SourceBadge s="estimated" /> How PostgreSQL chose to run your query. Cost and the number of rows are the planner's estimates, made before running anything.</p>
        {plan.node ? <PlanTree plan={plan.node} /> : <p role="alert" className="text-danger">{plan.error ?? "No plan is available."}</p>}
      </section>
      <section className="space-y-2" aria-label="Measured plan">
        <p className="text-xs text-ink-muted">EXPLAIN ANALYZE runs your query once more and measures each step. Times are from this browser (WebAssembly), so compare them with each other, not with a server.</p>
        {!analyzed && !asking && !busy && <button type="button" onClick={() => setAsking(true)} className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink">Run EXPLAIN ANALYZE (actual rows and timings)</button>}
        {asking && (
          <div role="alertdialog" aria-label="Confirm EXPLAIN ANALYZE" className="space-y-2 rounded-lg border border-warn/30 bg-warn-dim p-3 text-xs text-ink">
            <p>This runs your query once more (8 second limit, rolled back).</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => void analyze()} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">Run it</button>
              <button type="button" onClick={() => setAsking(false)} className="rounded-lg border border-surface-border px-3 py-1.5 text-ink-muted">Cancel</button>
            </div>
          </div>
        )}
        {busy && <p className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Running EXPLAIN ANALYZE…</p>}
        {analyzed && (
          <div data-testid="sql-plan-analyzed" className="space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">Measured <SourceBadge s="executed" />{analyzed.executionMs !== undefined && ` · execution ${analyzed.executionMs} ms`}{analyzed.planningMs !== undefined && ` · planning ${analyzed.planningMs} ms`}</p>
            {root ? (
              <>
                <PlanTree plan={root} />
                {root["Actual Rows"] !== undefined && root["Plan Rows"] !== undefined && (
                  <p className="text-xs text-ink-muted" data-testid="plan-estimate-vs-actual">Top node: the planner estimated about {root["Plan Rows"]} row(s); the run produced {root["Actual Rows"]}{root["Actual Loops"] && root["Actual Loops"] > 1 ? ` per loop (${root["Actual Loops"]} loops)` : ""}.</p>
                )}
              </>
            ) : <p role="alert" className="text-danger">{analyzed.error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
