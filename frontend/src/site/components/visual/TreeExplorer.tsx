import { useEffect, useMemo, useRef, useState } from "react";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { useReducedMotion } from "../../lib/visual/motion";
import {
  MAX_NODES, MAX_VALUE, MIN_VALUE, ORDER_LABEL, PRESETS, TreeError, buildBst, describeFrame, describeTree, layoutDiagram, levelOrderIds, parseLevelOrder, parseValue,
  presetById, presetSnap, relations, runOp, snapToDiagram, toLevelOrder, treeStats, byId,
  type DiagramKey, type DiagramNode, type Mark, type OpSpec, type Order, type Snap, type TraversalMode, type TreeFrame, type TreeRun,
} from "../../lib/visual/tree";

export type { DiagramNode } from "../../lib/visual/tree";

// ── Drawing ─────────────────────────────────────────────────────────────

const UX = 46, UY = 58, R = 17, PADX = 22, TOP = 30, BOTTOM = 20;

type Status = Mark | "current" | "related" | "visited" | "plain";
// Tailwind needs whole class names, so every combination is spelled out. Colour is never the only cue:
// current has a thick outline, risky nodes are dashed, visited nodes carry their visit number.
const CIRCLE: Record<Status, string> = {
  current: "fill-accent stroke-accent",
  new: "fill-success/30 stroke-success",
  found: "fill-success/30 stroke-success",
  removing: "fill-danger/25 stroke-danger",
  unbalanced: "fill-danger/25 stroke-danger",
  missing: "fill-danger/25 stroke-danger",
  successor: "fill-warn/30 stroke-warn",
  target: "fill-accent/30 stroke-accent",
  parent: "fill-accent/10 stroke-accent",
  child: "fill-accent/10 stroke-accent",
  related: "fill-accent/10 stroke-accent",
  visited: "fill-accent/20 stroke-accent/60",
  plain: "fill-transparent stroke-ink-faint",
};
const STATUS_TEXT: Record<Status, string> = {
  current: "current node", new: "newly inserted", found: "found", removing: "being removed", unbalanced: "unbalanced", missing: "search ended below this node",
  successor: "in-order successor", target: "node being changed", parent: "parent", child: "child", related: "parent or child of the selected node", visited: "visited", plain: "",
};

export interface TreeDiagramProps {
  root: DiagramNode | null;
  /** Node with the thick accent fill (a traversal's current node). */
  current?: DiagramKey | null;
  /** Keys in visit order; each gets a small visit-number badge. */
  visited?: readonly DiagramKey[];
  /** Keys from the root down to the current node; the edges between them are drawn heavier. */
  path?: readonly DiagramKey[];
  /** Extra per-node states keyed by String(key). */
  marks?: Readonly<Record<string, Mark>>;
  /** Keys to outline (for example the parent and children of a selected node). */
  highlight?: ReadonlySet<DiagramKey>;
  selected?: DiagramKey | null;
  /** Pointer shortcut only; the keyboard route to the same action is the inspector list in TreeExplorer. */
  onSelect?: (key: DiagramKey) => void;
  ariaLabel?: string;
  /** Overrides the learner/OS reduced-motion setting (tests, or a parent that already knows). */
  reduced?: boolean;
  className?: string;
}

/**
 * Deterministic SVG drawing of any tree (`{ label, children: (Node | null)[] }`). Layout is plain arithmetic, see `layoutDiagram`.
 * It scales with its viewBox so it never forces horizontal page scroll. Colours come from theme tokens.
 */
export function TreeDiagram({ root, current = null, visited = [], path = [], marks = {}, highlight, selected = null, onSelect, ariaLabel, reduced, className = "" }: TreeDiagramProps) {
  const system = useReducedMotion();
  const still = reduced ?? system;
  const lay = useMemo(() => layoutDiagram(root), [root]);
  if (!lay.nodes.length) return <div role="img" aria-label={ariaLabel ?? "Empty tree"} className={`rounded-lg border border-dashed border-surface-border p-4 text-center text-sm text-ink-muted ${className}`}>The tree is empty.</div>;

  const width = lay.cols * UX + PADX * 2;
  const height = TOP + R * 2 + (lay.levels - 1) * UY + BOTTOM;
  const cx = (x: number) => PADX + (x + 0.5) * UX;
  const cy = (y: number) => TOP + R + y * UY;
  const at = new Map(lay.nodes.map((n) => [n.key, n]));
  const order = new Map(visited.map((k, i) => [k, i + 1]));
  const pathIndex = new Map(path.map((k, i) => [k, i]));
  const onPath = (a: DiagramKey, b: DiagramKey) => pathIndex.has(a) && pathIndex.has(b) && pathIndex.get(b)! === pathIndex.get(a)! + 1;
  const transition = still ? "none" : "fill 180ms ease, stroke 180ms ease";
  const rootNode = lay.nodes[0];

  // An explicit mark (found, new, removing...) says more than "current", so it wins when a node is both.
  const statusOf = (key: DiagramKey): Status => marks[String(key)] ?? (key === current ? "current" : highlight?.has(key) ? "related" : order.has(key) ? "visited" : "plain");

  return (
    <svg role="img" aria-label={ariaLabel ?? `Tree with ${lay.nodes.length} nodes, root ${rootNode.label}`} viewBox={`0 0 ${width} ${height}`} className={`mx-auto block h-auto w-full ${className}`} style={{ maxWidth: Math.max(width * 1.5, 160) }} data-testid="tree-svg" data-motion={still ? "reduced" : "full"}>
      {lay.edges.map((e) => {
        const a = at.get(e.from)!, b = at.get(e.to)!;
        const hot = onPath(e.from, e.to);
        return <line key={`${e.from}-${e.to}`} x1={cx(a.x)} y1={cy(a.y)} x2={cx(b.x)} y2={cy(b.y)} className={hot ? "stroke-accent" : "stroke-ink-faint"} strokeWidth={hot ? 3 : 1.5} style={{ transition: still ? "none" : "stroke 180ms ease" }} />;
      })}
      <g aria-hidden="true">
        <line x1={cx(rootNode.x)} y1={cy(0) - R - 14} x2={cx(rootNode.x)} y2={cy(0) - R - 2} className="stroke-ink-muted" strokeWidth={1.5} />
        <text x={cx(rootNode.x)} y={cy(0) - R - 17} textAnchor="middle" fontSize={10} className="fill-ink-muted">root</text>
      </g>
      {lay.nodes.map((n) => {
        const st = statusOf(n.key);
        const dashed = st === "removing" || st === "unbalanced" || st === "missing";
        const label = n.label.length > 4 ? `${n.label.slice(0, 3)}…` : n.label;
        const visit = order.get(n.key);
        return (
          <g key={String(n.key)} data-testid={`node-${n.key}`} data-status={st} data-x={n.x} data-y={n.y}
            onClick={onSelect ? () => onSelect(n.key) : undefined} style={onSelect ? { cursor: "pointer" } : undefined}>
            <title>{`${n.label}${n.parent === null ? ", root" : ""}${n.leaf ? ", leaf" : ""}${STATUS_TEXT[st] ? `, ${STATUS_TEXT[st]}` : ""}`}</title>
            <circle cx={cx(n.x)} cy={cy(n.y)} r={R} className="fill-surface-raised" />
            <circle cx={cx(n.x)} cy={cy(n.y)} r={R} className={CIRCLE[st]} strokeWidth={st === "current" ? 3.5 : 2} strokeDasharray={dashed ? "4 3" : undefined} style={{ transition }} />
            {selected !== null && selected === n.key && <circle cx={cx(n.x)} cy={cy(n.y)} r={R + 4} className="fill-none stroke-ink" strokeWidth={1.5} strokeDasharray="2 3" />}
            <text x={cx(n.x)} y={cy(n.y)} textAnchor="middle" dominantBaseline="central" fontSize={label.length > 3 ? 10 : 12} fontWeight={600} className={st === "current" ? "fill-on-accent" : "fill-ink"}>{label}</text>
            {visit !== undefined && (
              <g>
                <circle cx={cx(n.x) + R - 2} cy={cy(n.y) - R + 2} r={8} className="fill-ink stroke-surface-raised" strokeWidth={1} />
                <text x={cx(n.x) + R - 2} y={cy(n.y) - R + 2} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} className="fill-surface">{visit}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Explorer ────────────────────────────────────────────────────────────

const field = "rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs text-ink";
const btn = "inline-flex h-8 items-center justify-center rounded-lg border border-surface-border px-2.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2";
const btnAccent = "inline-flex h-8 items-center justify-center rounded-lg bg-accent px-2.5 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2";
const eyebrow = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";

const DEFAULT_OP: OpSpec = { kind: "traverse", order: "inorder", mode: "recursive" };
const DEMO_SIZES = [5, 7, 10, 15];

interface Model { presetId: string; label: string; base: Snap; run: TreeRun }

function loadModel(presetId: string, label: string, base: Snap): Model { return { presetId, label, base, run: runOp(base, DEFAULT_OP) }; }
function initialModel(preset?: string): Model {
  const p = presetById(preset) ?? PRESETS[0];
  return loadModel(p.id, p.label, presetSnap(p));
}
const messageOf = (e: unknown) => (e instanceof TreeError ? e.message : "Something went wrong running that step.");

export function TreeExplorer({ preset }: { preset?: string }) {
  const [m, setM] = useState<Model>(() => initialModel(preset));
  const [valueText, setValueText] = useState("");
  const [order, setOrder] = useState<Order>("inorder");
  const [mode, setMode] = useState<TraversalMode>("recursive");
  const [demoSize, setDemoSize] = useState(7);
  const [customText, setCustomText] = useState(() => (presetById(preset) ?? PRESETS[0]).values);
  const [opError, setOpError] = useState("");
  const [customError, setCustomError] = useState("");
  const [info, setInfo] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const reduced = useReducedMotion();

  const pb = usePlayback(m.run.frames.length);
  const frame: TreeFrame = m.run.frames[Math.min(pb.index, m.run.frames.length - 1)];
  const stats = useMemo(() => treeStats(frame.tree), [frame.tree]);
  const baseStats = useMemo(() => treeStats(m.base), [m.base]);

  const adopt = (next: Model) => { setM(next); setSel(null); pb.dispatch({ type: "restart" }); };

  // A lesson may change ?preset= while the page stays mounted.
  const seen = useRef(preset);
  useEffect(() => {
    if (seen.current === preset) return;
    seen.current = preset;
    const p = presetById(preset);
    if (p) { adopt(loadModel(p.id, p.label, presetSnap(p))); setCustomText(p.values); setOpError(""); setCustomError(""); setInfo(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const execute = (op: OpSpec) => {
    try {
      const r = runOp(m.base, op);
      adopt({ ...m, base: r.commits ? r.final : m.base, run: r });
      setOpError(""); setInfo("");
    } catch (e) { setOpError(messageOf(e)); }
  };
  const withValue = (kind: "insert" | "search" | "delete") => {
    try { execute({ kind, value: parseValue(valueText) }); } catch (e) { setOpError(messageOf(e)); }
  };
  const loadPreset = (id: string) => {
    const p = presetById(id);
    if (!p) return;
    adopt(loadModel(p.id, p.label, presetSnap(p)));
    setCustomText(p.values); setOpError(""); setCustomError(""); setInfo("");
  };
  const loadCustom = () => {
    try {
      const snap = parseLevelOrder(customText);
      adopt(loadModel("custom", "Custom tree", snap));
      setCustomError(""); setOpError(""); setInfo("");
    } catch (e) { setCustomError(messageOf(e)); }
  };
  const rebuildBst = () => {
    const snap = m.base;
    const values = levelOrderIds(snap).map((id) => byId(snap).get(id)!.value);
    try {
      const rebuilt = buildBst(values);
      const dropped = values.length - rebuilt.nodes.length;
      adopt(loadModel(m.presetId, `${m.label} (rebuilt as BST)`, rebuilt));
      setInfo(`Re-inserted ${values.length} values in level order into an empty BST${dropped ? `; ${dropped} duplicate${dropped === 1 ? "" : "s"} skipped` : ""}.`);
      setOpError("");
    } catch (e) { setOpError(messageOf(e)); }
  };

  const effectiveMode: TraversalMode = order === "levelorder" ? "iterative" : mode;
  const rel = sel !== null ? relations(frame.tree, sel) : null;
  const related = useMemo(() => new Set<DiagramKey>(rel ? [...(rel.parent !== null ? [rel.parent] : []), ...rel.children] : []), [rel]);
  const root = useMemo(() => snapToDiagram(frame.tree), [frame.tree]);
  const lines = useMemo(() => describeTree(frame.tree), [frame.tree]);
  const nodes = frame.tree.nodes;
  const valueOf = (id: number | null) => (id === null ? "none" : String(byId(frame.tree).get(id)?.value));
  const dupValues = new Set(nodes.map((n) => n.value).filter((v, i, a) => a.indexOf(v) !== i));
  const nodeName = (id: number) => { const n = byId(frame.tree).get(id)!; return dupValues.has(n.value) ? `${n.value} (#${id})` : String(n.value); };

  const traversing = m.run.op.kind === "traverse";
  const run = m.run;
  const deepest = Math.max(0, ...run.frames.slice(0, pb.index + 1).map((f) => f.stack.length));
  const extras = describeFrame({ ...frame, text: "" }).trim();
  const kindName = stats.isBst ? "Binary search tree" : "Binary tree";
  const svgLabel = `${kindName} with ${stats.count} node${stats.count === 1 ? "" : "s"}${stats.root !== null ? `, root ${valueOf(stats.root)}` : ""}, height ${stats.height}.${frame.current !== null ? ` Current node ${valueOf(frame.current)}.` : ""}`;

  return (
    <section aria-label="Tree explorer" className="space-y-3">
      <p className="text-sm text-ink-muted">
        Watch binary trees, binary search trees, traversals, recursion, insertion, search and deletion run one step at a time. <ProvenanceBadge p="executed" />{" "}
        <span className="text-ink-faint">Executed means the algorithm itself runs in this page on the tree you see. It is not your own code, and every step shown is a real step of that run.</span>
      </p>

      <VisualShell
        left={(
          <>
            <fieldset className="space-y-2 rounded-lg border border-surface-border p-2 text-xs">
              <legend className="px-1 font-semibold text-ink">Tree</legend>
              <label className="block text-ink-muted">Preset tree
                <select className={`${field} mt-0.5 w-full`} aria-label="Preset tree" value={m.presetId} onChange={(e) => loadPreset(e.target.value)}>
                  {m.presetId === "custom" && <option value="custom">Custom tree</option>}
                  {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              {presetById(m.presetId) && <p className="text-ink-faint">{presetById(m.presetId)!.teaches}</p>}
              <label className="block text-ink-muted" htmlFor="tree-custom">Custom tree, level order (up to {MAX_NODES} nodes)</label>
              <input id="tree-custom" className={`${field} w-full font-mono`} value={customText} spellCheck={false} aria-invalid={customError ? true : undefined} aria-describedby="tree-custom-help tree-custom-error"
                onChange={(e) => setCustomText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadCustom(); } }} />
              <p id="tree-custom-help" className="text-ink-faint">Row by row, left to right; write <code>null</code> for a missing child. <code>1,null,2</code> makes 2 the right child of 1.</p>
              <p id="tree-custom-error" role="alert" className={customError ? "rounded-md border border-danger/50 bg-danger-dim p-1.5 text-danger" : "sr-only"}>{customError}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={btnAccent} onClick={loadCustom}>Load custom tree</button>
                <button type="button" className={btn} onClick={() => setCustomText(toLevelOrder(m.base))}>Show current tree as text</button>
                <button type="button" className={btn} disabled={!presetById(m.presetId)} onClick={() => loadPreset(m.presetId)}>Reset to preset</button>
              </div>
            </fieldset>

            <fieldset className="space-y-2 rounded-lg border border-surface-border p-2 text-xs">
              <legend className="px-1 font-semibold text-ink">Operations</legend>
              <form className="flex flex-wrap items-end gap-1.5" onSubmit={(e) => { e.preventDefault(); withValue("insert"); }}>
                <label className="text-ink-muted">Value
                  <input className={`${field} mt-0.5 block w-20`} inputMode="numeric" value={valueText} placeholder="e.g. 5" aria-label="Value" onChange={(e) => setValueText(e.target.value)} />
                </label>
                <button type="submit" className={btnAccent} disabled={!baseStats.isBst}>Insert</button>
                <button type="button" className={btn} disabled={!baseStats.isBst} onClick={() => withValue("search")}>Search</button>
                <button type="button" className={btn} disabled={!baseStats.isBst} onClick={() => withValue("delete")}>Delete</button>
              </form>
              <p className="text-ink-faint">Whole numbers from {MIN_VALUE} to {MAX_VALUE}. Insert, search and delete follow the binary search tree rule: smaller keys go left, larger go right, no duplicates.</p>
              {!baseStats.isBst && (
                <p className="rounded-md border border-warn/50 bg-warn-dim p-1.5 text-ink-muted">This is a plain binary tree, not a BST, so insert, search and delete are off. Traversals still work. <button type="button" className="font-semibold text-accent underline" onClick={rebuildBst}>Rebuild as BST</button> re-inserts its values in level order.</p>
              )}
              <div className="flex flex-wrap items-end gap-1.5">
                <label className="text-ink-muted">Traversal
                  <select className={`${field} mt-0.5 block`} aria-label="Traversal order" value={order} onChange={(e) => setOrder(e.target.value as Order)}>
                    {(Object.keys(ORDER_LABEL) as Order[]).map((o) => <option key={o} value={o}>{ORDER_LABEL[o]}</option>)}
                  </select>
                </label>
                <label className="text-ink-muted">Method
                  <select className={`${field} mt-0.5 block`} aria-label="Traversal method" value={effectiveMode} disabled={order === "levelorder"} onChange={(e) => setMode(e.target.value as TraversalMode)}>
                    <option value="recursive">Recursive (call stack)</option>
                    <option value="iterative">Iterative ({order === "levelorder" ? "queue" : "explicit stack"})</option>
                  </select>
                </label>
                <button type="button" className={btnAccent} onClick={() => execute({ kind: "traverse", order, mode: effectiveMode })}>Run traversal</button>
              </div>
              {order === "levelorder" && <p className="text-ink-faint">Level-order has no natural recursive form: it always uses a queue.</p>}
              <div className="flex flex-wrap items-end gap-1.5">
                <button type="button" className={btn} onClick={() => execute({ kind: "analyze" })}>Height, depth and balance</button>
                <label className="text-ink-muted">Demo size
                  <select className={`${field} mt-0.5 block`} aria-label="Demo size" value={demoSize} onChange={(e) => setDemoSize(Number(e.target.value))}>
                    {DEMO_SIZES.map((n) => <option key={n} value={n}>{n} values</option>)}
                  </select>
                </label>
                <button type="button" className={btn} onClick={() => execute({ kind: "degenerate", count: demoSize })}>Why balance matters</button>
              </div>
              <p className="text-ink-faint">"Why balance matters" builds its own trees from 1 to {demoSize}, so your tree is not touched.</p>
              <p role="alert" className={opError ? "rounded-md border border-danger/50 bg-danger-dim p-1.5 text-danger" : "sr-only"}>{opError}</p>
              <p aria-live="polite" className={info ? "text-ink-muted" : "sr-only"}>{info}</p>
            </fieldset>

            <div className="rounded-lg border border-surface-border">
              <p className="border-b border-surface-border px-2 py-1 text-xs font-semibold text-ink">{run.title} <ProvenanceBadge p="executed" /></p>
              <ol className="overflow-x-auto py-1 font-mono text-xs" aria-label="Pseudo-code of the running algorithm">
                {run.code.map((c, i) => (
                  <li key={i} aria-current={i === frame.line ? "step" : undefined} data-active={i === frame.line ? "true" : undefined}
                    className={`whitespace-pre px-2 ${i === frame.line ? "bg-accent-dim font-semibold text-ink" : "text-ink-muted"}`}>{c || " "}</li>
                ))}
              </ol>
            </div>
          </>
        )}
        right={(
          <>
            <div className="rounded-lg border border-surface-border bg-surface-soft p-2 text-sm" aria-live="polite" aria-atomic="true" data-testid="tree-live">
              {frame.phase && <p className={eyebrow}>{frame.phase}</p>}
              <p className="text-ink">{frame.note && <span className="mr-1.5 rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{frame.note}</span>}{frame.text}</p>
              <span className="sr-only">{extras}</span>
            </div>

            <div className="rounded-lg border border-surface-border bg-surface-raised p-2">
              <TreeDiagram root={root} current={frame.current} visited={frame.visited} path={frame.path} marks={frame.marks} highlight={related} selected={sel}
                onSelect={(k) => setSel(typeof k === "number" ? k : null)} ariaLabel={svgLabel} reduced={reduced} />
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-faint" aria-label="Legend">
                <li>Filled: current node</li><li>Outlined and numbered: visited, in visit order</li><li>Heavy edges: path from the root</li><li>Dashed: removed, unbalanced or missing</li>
              </ul>
            </div>

            {traversing && (
              <div className="rounded-lg border border-surface-border p-2" data-testid="tree-output">
                <p className={eyebrow}>Traversal output ({frame.output.length} of {nodes.length})</p>
                {frame.output.length ? (
                  <ol className="mt-1 flex flex-wrap gap-1" aria-label="Traversal output so far">
                    {frame.output.map((v, i) => <li key={i} className="rounded-md bg-accent-dim px-2 py-0.5 font-mono text-xs text-ink">{v}</li>)}
                  </ol>
                ) : <p className="text-xs text-ink-faint">Nothing visited yet.</p>}
              </div>
            )}

            {frame.stackKind && (
              <div className="rounded-lg border border-surface-border p-2" data-testid="tree-stack">
                <p className={eyebrow}>{frame.stackKind === "call" ? "Call stack (top first)" : frame.stackKind === "stack" ? "Explicit stack (top first)" : "Queue (front first)"}</p>
                {frame.stack.length ? (
                  <ol className="mt-1 space-y-0.5 font-mono text-xs">
                    {(frame.stackKind === "queue" ? frame.stack : [...frame.stack].reverse()).map((e, i) => (
                      <li key={i} className="rounded-md bg-surface-soft px-2 py-0.5 text-ink">
                        {e.label}{e.note && <span className="text-ink-faint"> · {e.note}</span>}{e.ret && <span className="text-success"> · returns {e.ret}</span>}
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-xs text-ink-faint">Empty.</p>}
                <p className="mt-1 text-[11px] text-ink-faint">
                  Deepest so far: {deepest}.{frame.stackKind === "call" && stats.count > 0 && ` Tree height is ${stats.height} edges, so the longest chain of real calls is ${stats.height + 1}; one more frame appears while an empty child is checked.`}
                </p>
              </div>
            )}

            <dl className="grid grid-cols-3 gap-1.5 text-xs" data-testid="tree-stats">
              {([
                ["Nodes", String(stats.count)],
                ["Height (edges)", String(stats.height)],
                ["Leaves", String(stats.leaves)],
                ["Root", stats.root === null ? "none" : valueOf(stats.root)],
                ["Balanced", stats.balanced ? "Yes" : "No"],
                ["Is a BST", stats.isBst ? "Yes" : "No"],
              ] as const).map(([k, v]) => <div key={k} className="rounded-md border border-surface-border px-2 py-1"><dt className="text-[10px] text-ink-faint">{k}</dt><dd className="font-semibold text-ink">{v}</dd></div>)}
            </dl>
            {stats.degenerate && <p className="rounded-md border border-warn/50 bg-warn-dim p-1.5 text-xs text-ink-muted">Degenerate: every node has at most one child, so this tree is a linked list. Height {stats.height} for {stats.count} nodes (a balanced tree needs only {stats.minHeight}), so search and insert cost up to {stats.count} steps.</p>}
            {!stats.balanced && !stats.degenerate && <p className="rounded-md border border-warn/50 bg-warn-dim p-1.5 text-xs text-ink-muted">Not balanced: some node has subtrees whose heights differ by more than 1. A balanced tree of {stats.count} nodes could have height {stats.minHeight}; this one has {stats.height}.</p>}

            <div className="space-y-1.5 rounded-lg border border-surface-border p-2 text-xs" data-testid="tree-inspector">
              <label className="block text-ink-muted">Inspect a node (parents and children light up)
                <select className={`${field} mt-0.5 block w-full`} aria-label="Inspect node" value={sel ?? ""} onChange={(e) => setSel(e.target.value === "" ? null : Number(e.target.value))}>
                  <option value="">None</option>
                  {nodes.map((n) => <option key={n.id} value={n.id}>{nodeName(n.id)}</option>)}
                </select>
              </label>
              {rel ? (
                <ul className="text-ink-muted" aria-label="Node relations">
                  <li>Node <strong className="text-ink">{valueOf(rel.id)}</strong>: {rel.isRoot ? "the root" : rel.isLeaf ? "a leaf" : "an internal node"}.</li>
                  <li>Parent: {rel.parent === null ? "none (it is the root)" : valueOf(rel.parent)}. Children: {rel.children.length ? rel.children.map(valueOf).join(", ") : "none"}. Sibling: {rel.siblings.length ? rel.siblings.map(valueOf).join(", ") : "none"}.</li>
                  <li>Depth {rel.depth} (edges from the root). Height {rel.height} (edges down to its deepest leaf). Subtree size {rel.subtreeSize}.</li>
                </ul>
              ) : <p className="text-ink-faint">Click a node, or pick one here, to see its parent, children, depth and height.</p>}
            </div>

            <details className="rounded-lg border border-surface-border p-2 text-xs">
              <summary className="cursor-pointer font-semibold text-ink">Text description of the tree</summary>
              <ul className="mt-1 space-y-0.5 text-ink-muted">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </details>
          </>
        )}
        bottom={(
          <div className="space-y-2">
            <PlaybackBar pb={pb} labels={run.frames.map((f) => f.text)} />
            <p className="text-xs text-ink-muted" data-testid="tree-summary">Result: {run.summary}</p>
          </div>
        )}
      />
    </section>
  );
}
