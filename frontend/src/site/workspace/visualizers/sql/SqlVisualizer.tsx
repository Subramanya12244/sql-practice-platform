/**
 * The SQL visualizer for the exercise workspace. It renders the model the SQL adapter built, from the shared contract
 * (`VisualizerProps`), and reuses what exists: the Query Cinema (rail, rows moving between stages, shared player), the set-operation
 * view, the plan tree, and the query comparison. Stepping never runs SQL. Under reduced motion the cinema draws static boards.
 */
import { useContext, useEffect, useMemo, useState } from "react";
import { QueryCinema, useCinemaSteps } from "../../../components/visual/QueryCinema";
import { QueryCompare } from "../../../components/visual/QueryCompare";
import { ProvenanceBadge, usePlayback } from "../../../components/visual/Playback";
import { SetOpView } from "../../../components/visual/SetOpView";
import { SampleTable } from "../../../components/SampleTable";
import { SourceBadge, StageView } from "../../../components/VizView";
import { SqlBackendContext } from "../../adapters/sql/backend";
import { isSqlVisualData, type SqlVisualData } from "../../adapters/sql/model";
import type { VisualizerProps } from "../../types";
import { CtePanel, GroupPanel, NullPanel, SubqueryPanel, WindowPanel } from "./DetailPanels";
import { PlanPanel } from "./PlanPanel";

export interface SqlVisualizerProps extends VisualizerProps {
  /** The host shows the player (play, pause, step, speed). The visualizer then leaves out its own controls and follows `step`. */
  hostPlayer?: boolean;
}

type Tab = "stages" | "details" | "plan" | "compare";

export function SqlVisualizer(props: SqlVisualizerProps) {
  const { model } = props;
  if (!isSqlVisualData(model.data)) {
    return <p role="status" className="rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-ink-muted">This visualization has no SQL data to draw.</p>;
  }
  return <Visualizer {...props} data={model.data} />;
}

function Visualizer({ model, data, step, onStepChange, reducedMotion, hostPlayer }: SqlVisualizerProps & { data: SqlVisualData }) {
  const backend = useContext(SqlBackendContext);
  const [tab, setTab] = useState<Tab>("stages");
  const { viz, trace, sql, extras } = data;
  const steps = useCinemaSteps(viz, trace, sql);
  const pb = usePlayback(steps.length);

  // The player and the host stay in step: a change on one side moves the other, and neither loops back.
  useEffect(() => {
    const target = Math.max(0, Math.min(step, Math.max(0, steps.length - 1)));
    if (target !== pb.index && steps.length) pb.dispatch({ type: "seek", index: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, steps.length]);
  useEffect(() => {
    if (pb.index !== step && steps.length) onStepChange(pb.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb.index]);

  const sections = useMemo(() => [
    extras.ctes.length > 0, extras.subqueries.length > 0, extras.windows.length > 0, Boolean(extras.groups), Boolean(extras.nulls),
  ].filter(Boolean).length, [extras]);

  const tabs: [Tab, string][] = [["stages", "Stages"], ["details", `Details${sections ? ` (${sections})` : ""}`], ["plan", "Plan"], ["compare", "Compare"]];
  return (
    <div className="space-y-3" data-testid="sql-visualizer" data-reduced-motion={reducedMotion ? "true" : "false"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Query views" className="flex flex-wrap gap-2 text-sm">
          {tabs.map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 ${tab === t ? "bg-accent text-white" : "border border-surface-border text-ink-muted hover:text-ink"}`}>{label}</button>
          ))}
        </div>
        <ProvenanceBadge p={model.provenance} />
      </div>
      {model.notes && model.notes.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-ink-faint" aria-label="About this visualization">{model.notes.slice(0, 2).map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}
      {viz.volatile && <p className="rounded-lg border border-warn/30 bg-warn-dim px-3 py-2 text-xs text-ink">Your query uses {viz.volatile.join(", ")}, which return different values on each run. The stages are explained from the query text; no intermediate rows are shown.</p>}

      {tab === "stages" && (
        <>
          <QueryCinema viz={viz} trace={trace} sql={sql} pb={pb} steps={steps} reduced={reducedMotion} refining={false} hideControls={hostPlayer} scrollIntoView={false}
            extra={(stage) => (stage.setOp ? <SetOpView data={stage.setOp} /> : null)} details={(stage) => <StageView s={stage} />} />
          {viz.final && (
            <div>
              <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Final result ({viz.final.rowCount} rows) <SourceBadge s="executed" /></p>
              <SampleTable columns={viz.final.columns} rows={viz.final.rows} />
            </div>
          )}
        </>
      )}

      {tab === "details" && (
        <div className="space-y-3" data-testid="sql-details">
          {extras.ctes.length > 0 && <CtePanel ctes={extras.ctes} />}
          {extras.subqueries.length > 0 && <SubqueryPanel subqueries={extras.subqueries} />}
          {extras.groups && <GroupPanel g={extras.groups} />}
          {extras.windows.length > 0 && <WindowPanel windows={extras.windows} />}
          {extras.nulls && <NullPanel n={extras.nulls} />}
          {sections === 0 && <p role="status" className="text-sm text-ink-muted">This query has no CTE, subquery, window function, group or NULL-sensitive condition to break down. The Stages tab shows every clause.</p>}
          {extras.notes.length > 0 && (
            <div className="rounded-lg border border-surface-border bg-surface-soft/60 p-2 text-xs text-ink-muted" data-testid="sql-detail-notes">
              <p className="font-semibold text-ink">Not shown for this query</p>
              <ul className="list-disc pl-5">{extras.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {tab === "plan" && <PlanPanel plan={data.plan} sql={sql} dataset={data.dataset} />}

      {tab === "compare" && <QueryCompare initialA={sql} initialB="" run={(q) => backend.run(q, data.dataset)} />}
    </div>
  );
}
