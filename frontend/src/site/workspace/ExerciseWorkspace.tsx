/**
 * The shared exercise workspace: Problem, Editor, Results (with feedback), Visualization and Explanation (hints), plus Run, Reset and
 * Submit. One component for every domain; the domain's adapter (see registry.ts) decides what can run, be graded or be stepped, and the
 * controls follow the adapter's capabilities. Desktop: resizable, collapsible panes. Phones: five tabs. Reduced motion is honoured
 * through the existing in-page motion toggle.
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Play, RotateCcw, Send, Square, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tabs } from "../components/ui";
import { storeProgressPort } from "./progressPort";
import { DOMAIN_LABEL } from "./registry";
import { useAdapter } from "./useAdapter";
import { useExerciseSession, type ExerciseSession } from "./useExerciseSession";
import { EditorPanel } from "./panels/EditorPanel";
import { ExplanationPanel } from "./panels/ExplanationPanel";
import { ProblemPanel } from "./panels/ProblemPanel";
import { ResultsPanel } from "./panels/ResultsPanel";
import { VisualizationPanel } from "./panels/VisualizationPanel";
import { Pane, PanelBoundary, btnPrimary, btnSecondary, useIsDesktop } from "./panels/chrome";
import type { ExecutionAdapter, ExerciseDef, ProgressPort, VisualizerProps } from "./types";

export type WorkspaceLayout = "auto" | "tabs" | "split" | "stack";
export const TAB_IDS = ["problem", "editor", "visualization", "results", "explanation"] as const;
export type TabId = (typeof TAB_IDS)[number];
export const TAB_LABEL: Record<TabId, string> = { problem: "Problem", editor: "Editor", visualization: "Visualization", results: "Results", explanation: "Explanation" };
type PaneId = "problem" | "editor" | "visualization" | "results" | "explanation";

export interface ExerciseWorkspaceProps {
  exercise: ExerciseDef;
  /** Use this adapter instead of the registry's (tests, previews). */
  adapter?: ExecutionAdapter;
  Visualizer?: ComponentType<VisualizerProps>;
  /** Where progress goes. Default: the existing stores. `null` records nothing (previews). */
  progress?: ProgressPort | null;
  /** "auto": split panes on desktop, tabs on phones. `compact` hosts (inside a lesson) stack on desktop instead of splitting. */
  layout?: WorkspaceLayout;
  compact?: boolean;
  /** "plain" forces the textarea editor (tests, low-power devices). */
  editor?: "monaco" | "plain";
  initialCode?: string;
  onCodeChange?(code: string): void;
  /** Called once per pass of a graded submit. The progress port has already recorded it. */
  onPassed?(ex: ExerciseDef): void;
  className?: string;
}

export function ExerciseWorkspace(props: ExerciseWorkspaceProps) {
  const { exercise, compact = false, editor = "monaco", progress = storeProgressPort } = props;
  const desktop = useIsDesktop();
  const layout: Exclude<WorkspaceLayout, "auto"> = props.layout && props.layout !== "auto" ? props.layout : desktop ? (compact ? "stack" : "split") : "tabs";
  const ad = useAdapter(exercise.domain, props.adapter, props.Visualizer);
  const adapter = ad.status === "ready" ? ad.adapter : null;
  const Visualizer = ad.status === "ready" ? ad.Visualizer : undefined;
  const s = useExerciseSession({ exercise, adapter, progress, initialCode: props.initialCode, onCodeChange: props.onCodeChange });

  const [tab, setTab] = useState<TabId>("problem");
  const [closed, setClosed] = useState<Record<PaneId, boolean>>({ problem: false, editor: false, visualization: true, results: false, explanation: compact });
  const [leftHidden, setLeftHidden] = useState(false);
  const toggle = (id: PaneId) => setClosed((c) => ({ ...c, [id]: !c[id] }));
  const reveal = (id: PaneId) => { setClosed((c) => ({ ...c, [id]: false })); if (layout === "tabs") setTab(id); };

  const doRun = async () => { reveal("results"); await s.run(); };
  const doSubmit = async () => { reveal("results"); await s.submit(); };
  const doVisualize = async () => { reveal("visualization"); await s.visualize(); };

  // Report a pass once (the port has already recorded it).
  const reported = useRef(false);
  const { onPassed } = props;
  useEffect(() => {
    if (s.solved && !reported.current) { reported.current = true; onPassed?.(exercise); }
    if (!s.solved) reported.current = false;
  }, [s.solved, onPassed, exercise]);

  const language = exercise.domain === "sql" ? "sql" : "python";
  const missing = ad.status === "missing" ? ad.reason : null;
  const status = missing ? missing : s.phase === "running" ? "Running your code." : s.phase === "submitting" ? "Checking your answer." : s.phase === "visualizing" ? "Building the visualization." : "";

  const toolbar = (
    <div role="toolbar" aria-label="Exercise controls" className="flex flex-wrap items-center gap-2">
      {s.canRun && <button type="button" className={btnPrimary} onClick={() => void doRun()} disabled={s.busy} title="Run (Ctrl or Cmd + Enter)"><Play className="h-4 w-4" aria-hidden />Run</button>}
      {s.canSubmit && <button type="button" className={btnSecondary} onClick={() => void doSubmit()} disabled={s.busy}><Send className="h-4 w-4" aria-hidden />Submit</button>}
      {s.busy && <button type="button" className={btnSecondary} onClick={s.stop}><Square className="h-4 w-4" aria-hidden />Stop</button>}
      <button type="button" className={btnSecondary} onClick={s.reset}><RotateCcw className="h-4 w-4" aria-hidden />Reset</button>
      {s.canVisualize && <button type="button" className={btnSecondary} onClick={() => void doVisualize()} disabled={s.busy}>Visualize</button>}
      {layout === "split" && (
        <button type="button" className={`${btnSecondary} ml-auto`} aria-expanded={!leftHidden} aria-label={leftHidden ? "Show problem and help column" : "Hide problem and help column"} onClick={() => setLeftHidden((v) => !v)}>
          {leftHidden ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}<span className="hidden sm:inline">{leftHidden ? "Show problem" : "Hide problem"}</span>
        </button>
      )}
      <p role="status" aria-live="polite" className="basis-full text-xs text-ink-muted sm:basis-auto">{status}</p>
    </div>
  );

  const nodes: Record<PaneId, ReactNode> = {
    problem: <ProblemPanel exercise={exercise} compact={compact} />,
    editor: missing ? <NotAvailable reason={missing} domain={DOMAIN_LABEL[exercise.domain]} /> : ad.status === "loading" ? <p role="status" className="text-sm text-ink-muted">Loading the {DOMAIN_LABEL[exercise.domain]} engine...</p> : (
      <EditorPanel value={s.code} onChange={s.setCode} onRun={s.canRun ? () => void doRun() : undefined} language={language} label={`${DOMAIN_LABEL[exercise.domain]} code for ${exercise.title}`} editor={editor} height={compact ? 200 : 300}
        errorLine={s.outcome?.error?.line ?? null} errorMessage={s.outcome?.error?.message} />
    ),
    results: <ResultsPanel session={s} />,
    visualization: <PanelBoundary label="The visualization panel"><VisualizationPanel exercise={exercise} adapter={adapter} Visualizer={Visualizer} session={s} /></PanelBoundary>,
    explanation: <ExplanationPanel exercise={exercise} session={s} />,
  };
  const pane = (id: PaneId, cls = "") => <Pane key={id} id={`ws-${id}`} title={TAB_LABEL[id]} collapsed={closed[id]} onToggle={() => toggle(id)} className={cls}>{nodes[id]}</Pane>;

  let body: ReactNode;
  if (layout === "tabs") {
    body = (
      <div className="space-y-2">
        {/* w-0 min-w-full: the tab strip scrolls inside the page width instead of widening the page on a phone. */}
        <div className="w-0 min-w-full"><Tabs<TabId> label="Workspace sections" tabs={TAB_IDS.map((id) => ({ id, label: TAB_LABEL[id] }))} value={tab} onChange={setTab} /></div>
        <div role="tabpanel" aria-label={TAB_LABEL[tab]} className="min-w-0 rounded-xl border border-surface-border bg-surface-raised p-3">{nodes[tab]}</div>
      </div>
    );
  } else if (layout === "stack") {
    body = <div className="space-y-3">{pane("problem")}{pane("editor")}{pane("results")}{pane("visualization")}{pane("explanation")}</div>;
  } else {
    const right = <div className="space-y-3 pb-2">{pane("editor")}{pane("results")}{pane("visualization")}</div>;
    body = leftHidden ? right : (
      <PanelGroup direction="horizontal" autoSaveId="df-exercise-split" className="min-h-[34rem]">
        <Panel id="ws-left" order={1} defaultSize={38} minSize={22}><div className="h-full space-y-3 overflow-auto pr-1">{pane("problem")}{pane("explanation")}</div></Panel>
        <PanelResizeHandle aria-label="Resize problem and editor columns" className="mx-1 w-2 shrink-0 rounded bg-surface-border hover:bg-accent/30 focus-visible:outline-2" />
        <Panel id="ws-right" order={2} defaultSize={62} minSize={35}><div className="h-full overflow-auto pl-1">{right}</div></Panel>
      </PanelGroup>
    );
  }

  return (
    <section aria-label={`Exercise workspace: ${exercise.title}`} data-layout={layout} data-testid="exercise-workspace" className={`min-w-0 space-y-3 ${props.className ?? ""}`}>
      {toolbar}
      {body}
    </section>
  );
}

function NotAvailable({ reason, domain }: { reason: string; domain: string }) {
  return (
    <div role="status" data-testid="adapter-missing" className="rounded-lg border border-surface-border bg-surface-soft p-4 text-sm text-ink-muted">
      <p className="font-medium text-ink">{domain} practice is not available here</p>
      <p className="mt-1">{reason} You can still read the problem and open the hints, but code cannot be run or checked in this build.</p>
    </div>
  );
}

export type { ExerciseSession };
