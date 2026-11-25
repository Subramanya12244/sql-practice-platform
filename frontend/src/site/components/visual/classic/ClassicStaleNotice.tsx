/**
 * Says which query the visualization below belongs to: the editor's, the last successful run, or an earlier (stale) one.
 * The wording comes from lib/visual/classic/vizSource.ts; this only draws it with the site's theme tokens.
 */
import { vizNoticeText, type VizReason, type VizStatus } from "../../../lib/visual/classic/vizSource";

const TONE: Record<VizStatus, string> = {
  current: "border-success/30 bg-success-dim",
  "last-successful": "border-warn/40 bg-warn-dim",
  stale: "border-warn/40 bg-warn-dim",
  none: "border-surface-border bg-surface-soft",
};
const LABEL: Record<VizStatus, string> = { current: "Current", "last-successful": "Last successful run", stale: "Earlier query", none: "Nothing yet" };

export function ClassicStaleNotice({ status, reason }: { status: VizStatus; reason: VizReason }) {
  return (
    <p role="status" data-testid="classic-stale-notice" data-status={status} data-reason={reason} className={`rounded-lg border px-3 py-2 text-sm text-ink ${TONE[status]}`}>
      <strong className="font-semibold">{LABEL[status]}.</strong> {vizNoticeText(status, reason)}
    </p>
  );
}
