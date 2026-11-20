import type { ReactNode } from "react";
import type { DataBeat } from "../../lib/visual/dataBeats";
import type { DataStage, StageAnalysis } from "../../lib/visual/dataframe";
import type { PandasView } from "../../lib/visual/pandasBeatParts";
import { DataFrameView } from "./DataFrameView";
import { FlowBoardView } from "./PandasFlowBoard";
import { CalcPicture, GridPicture, GroupsPicture, Sampled, TablePicture } from "./PandasPictures";

/**
 * Draws a pandas beat (lib/visual/pandasBeats.ts): the picture a learner watches while the story panel above it answers
 * what / changed / why / remember. A beat's view carries copies of the real cells it draws, so this is a pure function of the beat:
 * Previous, Next and Reset show exactly the same picture, and nothing runs again.
 *
 * The host calls this as a plain function, so it holds no hooks of its own: it returns an element whose type and key stay the
 * same for all beats of one stage (the row board then stays mounted and its cards move by CSS transition from beat to beat).
 * Returns null for a beat it does not own; the host then draws the generic stage instead.
 */
function PandasPicture({ view, stage, reducedMotion }: { view: PandasView; stage: DataStage; reducedMotion: boolean }) {
  switch (view.type) {
    case "flow":
      return (
        <div className="space-y-2">
          <FlowBoardView view={view} reducedMotion={reducedMotion} />
          {view.result && <DataFrameView snap={view.result.snap} caption={view.caption} reducedMotion={reducedMotion} />}
          {view.reasons && view.reasons.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-ink-muted" aria-label="Why each row was kept or removed" data-testid="flow-reasons">
              {view.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          <Sampled text={view.sampled} />
        </div>
      );
    case "grid": return <GridPicture view={view} reducedMotion={reducedMotion} />;
    case "table": return <TablePicture view={view} stage={stage} reducedMotion={reducedMotion} />;
    case "calc": return <CalcPicture view={view} reducedMotion={reducedMotion} />;
    case "groups": return <GroupsPicture view={view} reducedMotion={reducedMotion} />;
    default: return null;
  }
}

export function PandasBeatView({ beat, stage, reducedMotion }: { beat: DataBeat; stage: DataStage; analysis: StageAnalysis; reducedMotion: boolean }): ReactNode {
  if (beat.view.owner !== "pandas") return null;
  const view = beat.view as unknown as PandasView;
  return <PandasPicture key={`s${beat.stage}`} view={view} stage={stage} reducedMotion={reducedMotion} />;
}
