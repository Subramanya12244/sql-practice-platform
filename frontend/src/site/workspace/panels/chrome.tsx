/** Small shared pieces of the workspace chrome: collapsible pane, panel error boundary, desktop media query. */
import { Component, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const DESKTOP = "(min-width: 1024px)";
const subscribeMq = (cb: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
};
const snapshotMq = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP).matches : false);
/** True on a desktop-width screen. Server and first hydration render say false (tabs), so the HTML always matches. */
export const useIsDesktop = () => useSyncExternalStore(subscribeMq, snapshotMq, () => false);

/** A pane with a real button header: Enter and Space toggle it, `aria-expanded` is set, and the body is not rendered while collapsed. */
export function Pane({ id, title, collapsed, onToggle, actions, children, className = "" }: {
  id: string; title: string; collapsed: boolean; onToggle: () => void; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section aria-label={title} className={`min-w-0 rounded-xl border border-surface-border bg-surface-raised ${className}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-controls={`${id}-body`} aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
          className="inline-flex min-h-8 flex-1 items-center gap-1.5 rounded-md text-left text-xs font-semibold uppercase tracking-wider text-ink-muted hover:text-ink focus-visible:outline-2">
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
          <span>{title}</span>
        </button>
        {!collapsed && actions}
      </div>
      {!collapsed && <div id={`${id}-body`} className="border-t border-surface-border p-3">{children}</div>}
    </section>
  );
}

/** Contains a crash in one panel (an adapter's visualizer, say) so the editor keeps working. */
export class PanelBoundary extends Component<{ label: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message || "unknown error" }; }
  render() {
    if (this.state.error) return <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{this.props.label} stopped working: {this.state.error}. Your code and results are unaffected.</p>;
    return this.props.children;
  }
}

export const btnBase = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = `${btnBase} bg-accent text-on-accent hover:brightness-110`;
export const btnSecondary = `${btnBase} border border-surface-border bg-surface-raised text-ink hover:border-accent/40`;
