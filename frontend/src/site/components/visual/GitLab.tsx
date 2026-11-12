import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { useReducedMotion } from "../../lib/visual/motion";
import {
  NOT_IMPLEMENTED, PRESETS, SUPPORTED_COMMANDS, areaRows, compareMergeRebase, currentBranch, editFrame, headId, layoutGraph, markerProblems, parseConflicts, resolveBlock,
  runScript, shortId, startFrame, stepFrame, writeFile, type AreaRow, type AreaState, type Choice, type CompareOutcome, type CompareVariant, type Frame, type Repo,
} from "../../lib/visual/git";

const btn = "inline-flex min-h-8 items-center justify-center rounded-lg border border-surface-border px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 disabled:opacity-40";
const primaryBtn = "inline-flex min-h-8 items-center justify-center rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 disabled:opacity-40";
const LANE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6"];
const ROW_H = 40, LANE_W = 24, PAD = 14;

// ── Commit graph (SVG) ───────────────────────────────────────────────────

/** The commit graph, newest at the top. Colours are chart fills; text uses theme tokens. New commits get a halo; commits no ref reaches are dashed. */
export function GitGraph({ repo, highlight, showOld, label }: { repo: Repo; highlight?: ReadonlySet<string>; showOld?: boolean; label?: string }) {
  const reduced = useReducedMotion();
  const g = useMemo(() => layoutGraph(repo, { includeUnreachable: showOld }), [repo, showOld]);
  if (!g.nodes.length) return <p className="rounded-lg border border-dashed border-surface-border p-3 text-center text-xs text-ink-muted">{repo.initialized ? "No commits yet: the branch exists only as a name." : "No repository yet."}</p>;
  const labelX = PAD + Math.max(1, g.lanes) * LANE_W + 6;
  const width = labelX + 300, height = g.rows * ROW_H + PAD * 2;
  const x = (lane: number) => PAD + lane * LANE_W, y = (row: number) => PAD + row * ROW_H + 12;
  const color = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const summary = `Commit graph${label ? ` ${label}` : ""}: ${g.nodes.length} commits, ${g.nodes.filter((n) => n.isMerge).length} merge commits. ${g.nodes.filter((n) => n.refs.length).map((n) => `${n.refs.join(", ")} at ${n.short}`).join("; ")}.`;
  return (
    <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
      <title>{summary}</title>
      {g.edges.map((e) => {
        const x1 = x(e.fromLane), y1 = y(e.fromRow), x2 = x(e.toLane), y2 = y(e.toRow);
        const mid = y1 + Math.min(ROW_H, (y2 - y1) / 2);
        const d = x1 === x2 ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
        const orphan = byId.get(e.from)?.orphan;
        return <path key={`${e.from}-${e.to}`} d={d} fill="none" stroke={color(e.second ? e.toLane : e.fromLane)} strokeWidth={2} strokeDasharray={orphan ? "4 3" : undefined} opacity={orphan ? 0.45 : 1} />;
      })}
      {g.nodes.map((n) => {
        const cx = x(n.lane), cy = y(n.row);
        let cursor = labelX;
        return (
          <g key={n.id} opacity={n.orphan ? 0.55 : 1}>
            {highlight?.has(n.id) && <circle cx={cx} cy={cy} r={11} fill={color(n.lane)} opacity={0.3} className={reduced ? undefined : "animate-pulse"} />}
            {n.isMerge && <circle cx={cx} cy={cy} r={9} fill="none" stroke={color(n.lane)} strokeWidth={1.5} />}
            <circle cx={cx} cy={cy} r={6} fill={n.orphan ? "none" : color(n.lane)} stroke={n.isHead ? "currentColor" : color(n.lane)} strokeWidth={n.isHead ? 3 : 2} strokeDasharray={n.orphan ? "3 2" : undefined} className="text-ink" />
            {n.refs.map((ref) => {
              const w = ref.length * 6.3 + 10, at = cursor;
              cursor += w + 4;
              const fill = ref.startsWith("HEAD") ? "#4f46e5" : ref.startsWith("tag:") ? "#b45309" : "#047857";
              return <g key={ref}><rect x={at} y={cy - 17} width={w} height={14} rx={7} fill={fill} /><text x={at + 5} y={cy - 7} fontSize={10} fontWeight={600} fill="#fff">{ref}</text></g>;
            })}
            <text x={labelX} y={cy + 8} fontSize={11} className="fill-current font-mono text-ink">
              <tspan className="text-ink-muted">{n.short}</tspan> {n.message.length > 38 ? `${n.message.slice(0, 37)}…` : n.message}{n.orphan ? " (old)" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Three areas ──────────────────────────────────────────────────────────

const tone = (s: AreaState | "untracked") => (s === "same" ? "text-ink-muted" : s === "deleted" ? "text-danger" : s === "untracked" ? "text-warn" : s === "new" ? "text-success" : "text-warn");

function cells(r: AreaRow): [string, string, string][] {
  const working = r.untracked ? ["untracked", "untracked"] : r.work === undefined ? ["deleted", "deleted"] : r.unstaged === "same" ? ["", "same"] : ["modified", "modified"];
  const staged = r.index === undefined ? ["", "same"] : r.staged === "same" ? ["", "same"] : [r.staged === "new" ? "new" : r.staged === "deleted" ? "deleted" : "modified", r.staged];
  return [
    [r.workId ?? "none", working[0], working[1]],
    [r.indexId ?? "none", staged[0], staged[1]],
    [r.headId ?? "none", "", "same"],
  ];
}

/** Working tree, staging area and repository side by side; each cell is the short blob id of the file's text there. */
export function AreasPanel({ repo }: { repo: Repo }) {
  const rows = useMemo(() => areaRows(repo), [repo]);
  const [sel, setSel] = useState<string | null>(null);
  const picked = rows.find((r) => r.path === sel) ?? null;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-surface-border">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">The three areas of Git: working tree, staging area and repository. Each cell shows the short id of the file's text in that area.</caption>
          <thead className="bg-surface-soft text-[10px] uppercase tracking-wider text-ink-faint">
            <tr><th scope="col" className="px-2 py-1">File</th><th scope="col" className="px-1 py-1">Working tree</th><th scope="col" className="px-1 py-1">Staging area</th><th scope="col" className="px-1 py-1">Repository (HEAD)</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-center text-ink-muted">No files yet. Create one with <code>echo "text" &gt; file.txt</code>.</td></tr>}
            {rows.map((r) => (
              <tr key={r.path} className="border-t border-surface-border">
                <th scope="row" className="max-w-[7rem] truncate px-2 py-1 font-mono font-medium text-ink">
                  <button type="button" onClick={() => setSel(sel === r.path ? null : r.path)} aria-pressed={sel === r.path} className="max-w-full truncate rounded underline-offset-2 hover:underline focus-visible:outline-2" title={`Show the text of ${r.path} in each area`}>{r.path}{r.unmerged ? " (conflict)" : ""}</button>
                </th>
                {cells(r).map(([id, note, state], i) => (
                  <td key={i} className="px-1 py-1 font-mono"><span className={tone(state as AreaState | "untracked")}>{id}</span>{note && <span className={`ml-1 font-sans text-[10px] ${tone(state as AreaState | "untracked")}`}>{note}</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-faint">An id is the first 7 characters of the file text's real Git blob id; the same text always has the same id. Different ids in two columns mean the area holds a different version.</p>
      {picked && (
        <div className="grid gap-2 sm:grid-cols-3" aria-label={`Text of ${picked.path} in each area`}>
          {([["Working tree", picked.work], ["Staging area", picked.index], ["Repository", picked.head]] as const).map(([title, text]) => (
            <div key={title} className="min-w-0 rounded-lg border border-surface-border p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{title}</p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ink">{text === undefined ? "(no such file here)" : text === "" ? "(empty file)" : text}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Playground: scenarios, terminal, graph, areas ────────────────────────

const HEAD_NOTE = (repo: Repo) => {
  if (!repo.initialized) return "No repository yet. Run git init.";
  const id = headId(repo);
  return repo.head.kind === "branch" ? `HEAD points at branch ${repo.head.name}${id ? ` (commit ${shortId(id)})` : " (no commit yet)"}` : `HEAD is detached at commit ${shortId(repo.head.id)}`;
};

function scenarioFrames(id: string): Frame[] {
  const p = PRESETS.find((x) => x.id === id);
  return p ? runScript(p.steps, `${p.label}: ${p.teaches}. Press Play or step through to see what each command changes, or type your own commands at any step.`) : [startFrame("A blank lab. Type git init to begin; type help to see the commands.")];
}

function Playground({ preset }: { preset?: string }) {
  const initialId = PRESETS.some((p) => p.id === preset) ? preset! : PRESETS[0].id;
  const [scenario, setScenario] = useState<string>(initialId);
  const [frames, setFrames] = useState<Frame[]>(() => scenarioFrames(initialId));
  const pb = usePlayback(frames.length);
  const [line, setLine] = useState("");
  const [hist, setHist] = useState<{ items: string[]; at: number }>({ items: [], at: 0 });
  const [editing, setEditing] = useState({ path: "", text: "" });
  const logRef = useRef<HTMLDivElement>(null);
  // Jump to the last step whenever the list of steps changes (a new scenario, or a typed command).
  useEffect(() => { pb.dispatch({ type: "seek", index: Number.MAX_SAFE_INTEGER }); }, [frames]); // eslint-disable-line react-hooks/exhaustive-deps
  const frame = frames[Math.min(pb.index, frames.length - 1)];
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [pb.index, frames]);

  const pick = (id: string) => { setScenario(id); setFrames(id === "blank" ? [startFrame("A blank lab. Type git init to begin; type help to see the commands.")] : scenarioFrames(id)); };
  const submit = (text: string) => {
    const cmd = text.trim();
    if (!cmd) return;
    const base = frames.slice(0, pb.index + 1);
    if (cmd === "clear") { setLine(""); return; }
    const f = stepFrame(base[base.length - 1].repo, cmd, "");
    f.why = f.ok ? "You ran this command. The list below shows what it changed." : "This command did not complete. If it stopped on a conflict, the repository is mid-operation: resolve the files, then continue or abort.";
    setFrames([...base, f]);
    setHist((h) => ({ items: [...h.items, cmd], at: h.items.length + 1 }));
    setLine("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" && hist.items.length) { e.preventDefault(); const at = Math.max(0, hist.at - 1); setHist({ ...hist, at }); setLine(hist.items[at] ?? ""); }
    else if (e.key === "ArrowDown" && hist.items.length) { e.preventDefault(); const at = Math.min(hist.items.length, hist.at + 1); setHist({ ...hist, at }); setLine(hist.items[at] ?? ""); }
  };
  const repo = frame.repo;
  const files = Object.keys(repo.work).sort();
  const saveEdit = () => {
    if (!editing.path.trim()) return;
    const base = frames.slice(0, pb.index + 1);
    const f = editFrame(base[base.length - 1].repo, editing.path.trim(), editing.text);
    setFrames([...base, f]);
  };
  const newIds = useMemo(() => new Set(frame.newCommits), [frame]);
  const current = scenario === "blank" ? null : PRESETS.find((p) => p.id === scenario) ?? null;
  const typed = pb.index > 0 && frame.why.startsWith("You ran") ;

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Guided scenarios" className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={scenario === p.id} onClick={() => pick(p.id)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${scenario === p.id ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>{p.label}</button>
        ))}
        <button type="button" aria-pressed={scenario === "blank"} onClick={() => pick("blank")} className={`rounded-full px-2.5 py-1 text-xs font-medium ${scenario === "blank" ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>Blank repository</button>
      </div>
      {current && <p className="text-sm text-ink-muted">{current.teaches}.</p>}
      <VisualShell
        left={(
          <>
            <div className={`rounded-lg border p-2 text-sm ${frame.ok ? "border-surface-border bg-surface-soft" : "border-warn/50 bg-warn-dim"}`} role="status" aria-live="polite" data-testid="git-step">
              <p className="font-semibold text-ink">{frame.cmd ? <>Step {pb.index}: <code className="font-mono text-xs">{frame.cmd}</code></> : "Starting point"}</p>
              <p className="text-ink-muted">{frame.why}</p>
              {frame.changes.length > 0 && frame.cmd && (
                <div className="mt-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">What this command changed</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink">{frame.changes.map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
              )}
              {typed && <p className="mt-1 text-[11px] text-ink-faint">Typing at an earlier step replaces the steps that came after it.</p>}
            </div>
            <div ref={logRef} role="log" aria-label="Terminal transcript" tabIndex={0} className="max-h-72 overflow-auto rounded-lg border border-surface-border bg-surface p-2 font-mono text-xs focus-visible:outline-2">
              {frames.slice(0, pb.index + 1).filter((f) => f.cmd).map((f, i, all) => (
                <div key={i} className={i === all.length - 1 ? "rounded bg-accent-dim px-1" : "px-1"}>
                  <p className={f.ok ? "text-ink" : "text-danger"}><span className="text-ink-faint">$</span> {f.cmd}</p>
                  {f.output && <pre className={`whitespace-pre-wrap break-words ${f.ok ? "text-ink-muted" : "text-danger"}`}>{f.output}</pre>}
                </div>
              ))}
              {pb.index === 0 && <p className="text-ink-faint">Nothing has run yet.</p>}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); submit(line); }} className="flex gap-1.5">
              <label htmlFor="git-cmd" className="sr-only">Git command</label>
              <span aria-hidden className="py-1.5 font-mono text-xs text-ink-faint">$</span>
              <input id="git-cmd" value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={onKey} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder='git status   (Up and Down recall earlier commands)'
                className="min-w-0 flex-1 rounded-lg border border-surface-border bg-surface px-2 py-1.5 font-mono text-xs text-ink focus-visible:outline-2" />
              <button type="submit" className={primaryBtn}>Run</button>
            </form>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick commands">
              {["git status", "git log --oneline --graph --all", "git branch -v", "help"].map((c) => <button key={c} type="button" className={btn} onClick={() => submit(c)}><code>{c}</code></button>)}
            </div>
            <details className="rounded-lg border border-surface-border p-2 text-xs">
              <summary className="cursor-pointer font-medium text-ink">Edit a file by hand</summary>
              <div className="mt-2 space-y-1.5">
                <label className="block text-ink-muted">File
                  <input list="git-files" value={editing.path} onChange={(e) => { const p = e.target.value; setEditing({ path: p, text: repo.work[p] ?? editing.text }); }} className="mt-0.5 w-full rounded-md border border-surface-border bg-surface px-1.5 py-1 font-mono text-xs text-ink" placeholder="notes.txt" />
                  <datalist id="git-files">{files.map((f) => <option key={f} value={f} />)}</datalist>
                </label>
                <label className="block text-ink-muted">Text
                  <textarea value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={4} className="mt-0.5 w-full rounded-md border border-surface-border bg-surface px-1.5 py-1 font-mono text-xs text-ink" />
                </label>
                <button type="button" className={primaryBtn} disabled={!editing.path.trim()} onClick={saveEdit}>Save to working tree</button>
                <p className="text-ink-faint">Saving only changes the working tree. Git sees it as modified or untracked until you add and commit.</p>
              </div>
            </details>
          </>
        )}
        right={(
          <>
            <p className="text-xs text-ink-muted" data-testid="git-head">{HEAD_NOTE(repo)}</p>
            <GitGraph repo={repo} highlight={newIds} />
            <AreasPanel repo={repo} />
          </>
        )}
        bottom={<PlaybackBar pb={pb} labels={frames.map((f) => f.cmd || "Start")} />}
      />
      <details className="rounded-lg border border-surface-border p-2 text-xs">
        <summary className="cursor-pointer font-medium text-ink">What the lab supports, and what it does not</summary>
        <p className="mt-2 font-medium text-ink">Supported</p>
        <ul className="list-disc pl-4 text-ink-muted">{SUPPORTED_COMMANDS.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
        <p className="mt-2 font-medium text-ink">Not implemented</p>
        <ul className="list-disc space-y-0.5 pl-4 text-ink-muted">{NOT_IMPLEMENTED.map((c) => <li key={c}>{c}</li>)}</ul>
      </details>
    </div>
  );
}

// ── Merge versus rebase ──────────────────────────────────────────────────

const yesNo = (b: boolean) => (b ? "Yes" : "No");

function OutcomeCard({ o, startTip, rebased }: { o: CompareOutcome; startTip: string; rebased: boolean }) {
  return (
    <section aria-label={o.title} className="min-w-0 space-y-2 rounded-xl border border-surface-border bg-surface-raised p-3">
      <h3 className="font-display text-sm font-bold text-ink">{o.title}</h3>
      <ol className="space-y-0.5 font-mono text-[11px] text-ink-muted">{o.steps.map((s, i) => <li key={i}><span className="text-ink-faint">$</span> {s}</li>)}</ol>
      <GitGraph repo={o.repo} showOld={rebased} label={`after ${o.title}`} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-ink-muted">Commits on main</dt><dd className="font-semibold text-ink">{o.facts.commits}</dd>
        <dt className="text-ink-muted">Merge commits</dt><dd className="font-semibold text-ink">{o.facts.merges}</dd>
        <dt className="text-ink-muted">History is one straight line</dt><dd className="font-semibold text-ink">{yesNo(o.facts.linear)}</dd>
        <dt className="text-ink-muted">Conflict stops to resolve</dt><dd className="font-semibold text-ink">{o.conflictStops}</dd>
        <dt className="text-ink-muted">Commits with new ids</dt><dd className="font-semibold text-ink">{o.rewritten.length}</dd>
      </dl>
      {o.rewritten.length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Rewritten commits (same change, new parent, new id)</p>
          <ul className="space-y-0.5 font-mono text-[11px]">
            {o.rewritten.map((x) => <li key={x.oldId} className="text-ink"><span className="text-ink-muted line-through">{shortId(x.oldId)}</span> to <strong>{shortId(x.newId)}</strong> <span className="font-sans text-ink-muted">{x.message}</span></li>)}
          </ul>
          <p className="mt-1 text-[11px] text-ink-faint">The dashed commits in the graph are the old ones: no branch reaches them any more, but anyone who already has them still does.</p>
        </div>
      ) : <p className="text-xs text-ink-muted">No commit was rewritten: every existing commit keeps its id{startTip ? ` (main started at ${shortId(startTip)})` : ""}.</p>}
    </section>
  );
}

function MergeVsRebase() {
  const [variant, setVariant] = useState<CompareVariant>("clean");
  const c = useMemo(() => compareMergeRebase(variant), [variant]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">The same starting repository is run both ways. <ProvenanceBadge p="simulated" /> Commands for the setup are listed below; the two columns start from exactly that state.</p>
      <fieldset className="flex flex-wrap gap-3 text-xs text-ink-muted">
        <legend className="mb-1 font-semibold text-ink">Starting point</legend>
        {([["clean", "The branches change different files"], ["conflict", "Both branches change the same line"]] as const).map(([v, l]) => (
          <label key={v} className="inline-flex items-center gap-1.5"><input type="radio" name="cmp-variant" checked={variant === v} onChange={() => setVariant(v)} /> {l}</label>
        ))}
      </fieldset>
      <details className="rounded-lg border border-surface-border p-2 text-xs">
        <summary className="cursor-pointer font-medium text-ink">Starting repository (shared by both runs)</summary>
        <ol className="mt-1 space-y-0.5 font-mono text-[11px] text-ink-muted">{c.startSteps.map((s, i) => <li key={i}><span className="text-ink-faint">$</span> {s}</li>)}</ol>
        <div className="mt-2"><GitGraph repo={c.start} label="at the start" /></div>
      </details>
      <div className="grid gap-3 lg:grid-cols-2">
        <OutcomeCard o={c.merge} startTip={c.start.branches.main} rebased={false} />
        <OutcomeCard o={c.rebase} startTip={c.start.branches.main} rebased />
      </div>
      <p className={`rounded-lg border p-2 text-xs ${c.sameFinalFiles ? "border-surface-border bg-surface-soft text-ink-muted" : "border-warn/50 bg-warn-dim text-ink"}`} role="status">
        Final files on main are {c.sameFinalFiles ? "identical in both runs (same tree id), only the history differs." : "different in the two runs: each conflict is resolved separately, so merge resolved the clash once and rebase resolved it again for every replayed commit that touched the line."}
      </p>
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-lg border border-surface-border p-3"><h4 className="font-semibold text-ink">Merge fits when</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted"><li>The branch is shared or already pushed: merge never rewrites existing commits.</li><li>You want the history to show that work happened on a branch and when it joined.</li><li>You want to resolve a conflict once, not per commit.</li></ul></div>
        <div className="rounded-lg border border-surface-border p-3"><h4 className="font-semibold text-ink">Rebase fits when</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted"><li>The branch is private and unpublished, and you want it to start from the latest main.</li><li>You want a linear history that is easy to read and bisect.</li><li>You are tidying your own commits before review.</li></ul></div>
      </div>
      <div role="note" className="rounded-lg border border-danger/50 bg-danger-dim p-3 text-xs text-ink">
        <p className="font-semibold">Never rebase history that other people already have.</p>
        <p className="mt-0.5 text-ink-muted">Rebasing gives your commits new ids. A teammate who still has the old ones now holds commits that no longer match yours, and the next pull or push brings both versions back as duplicates. Rebase only commits that exist on your machine alone.</p>
      </div>
    </div>
  );
}

// ── Conflict resolution simulator ────────────────────────────────────────

type ConflictKind = "merge" | "rebase";

function startConflict(kind: ConflictKind): { repo: Repo; cmds: Frame[] } {
  const start = compareMergeRebase("conflict").start;
  const cmds = kind === "merge" ? ["git merge feature"] : ["git switch feature", "git rebase main"];
  const frames: Frame[] = [startFrame("", start)];
  for (const c of cmds) frames.push(stepFrame(frames[frames.length - 1].repo, c));
  return { repo: frames[frames.length - 1].repo, cmds: frames.slice(1) };
}

function ConflictFile({ path, text, onChange, onStage, repo }: { path: string; text: string; onChange: (t: string) => void; onStage: () => void; repo: Repo }) {
  const segs = parseConflicts(text);
  const problems = markerProblems(text);
  return (
    <section aria-label={`Conflicted file ${path}`} className="space-y-2 rounded-xl border border-surface-border bg-surface-raised p-3">
      <h3 className="font-mono text-sm font-semibold text-ink">{path}</h3>
      <div className="rounded-lg border border-surface-border bg-surface p-2 font-mono text-xs">
        {segs.length === 0 && <p className="text-ink-faint">(empty file)</p>}
        {segs.map((s, i) => s.kind === "text" ? (
          <pre key={i} className="whitespace-pre-wrap break-words text-ink">{s.lines.join("\n")}</pre>
        ) : (
          <div key={i} className="my-1.5 space-y-1 rounded-md border border-warn/50 p-1.5">
            <div className="rounded bg-accent-dim p-1"><p className="text-[10px] font-semibold uppercase text-accent">Ours (current branch, {s.oursLabel || "HEAD"})</p><pre className="whitespace-pre-wrap break-words text-ink">{s.ours.join("\n") || "(nothing)"}</pre></div>
            <div className="rounded bg-secondary-dim p-1"><p className="text-[10px] font-semibold uppercase text-secondary">Theirs ({s.theirsLabel || "other side"})</p><pre className="whitespace-pre-wrap break-words text-ink">{s.theirs.join("\n") || "(nothing)"}</pre></div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Resolve conflict ${s.index + 1}`}>
              {(["ours", "theirs", "both"] as Choice[]).map((c) => <button key={c} type="button" className={btn} onClick={() => onChange(resolveBlock(text, s.index, c))}>{c === "ours" ? "Keep ours" : c === "theirs" ? "Keep theirs" : "Keep both"}</button>)}
            </div>
          </div>
        ))}
      </div>
      <label className="block text-xs text-ink-muted">Or edit the file text yourself (delete the marker lines)
        <textarea value={text} onChange={(e) => onChange(e.target.value)} rows={Math.min(12, Math.max(4, text.split("\n").length + 1))} spellCheck={false} className="mt-0.5 w-full rounded-md border border-surface-border bg-surface px-1.5 py-1 font-mono text-xs text-ink" />
      </label>
      <p role="status" aria-live="polite" className={`text-xs ${problems.length ? "text-danger" : "text-success"}`}>
        {problems.length ? `${problems.length} conflict marker line${problems.length === 1 ? "" : "s"} still in the file: ${problems.slice(0, 3).map((p) => `line ${p.line} (${p.text.slice(0, 12)})`).join(", ")}. Remove them first.` : "No conflict markers remain. The file is ready to be staged."}
      </p>
      <button type="button" className={primaryBtn} disabled={problems.length > 0} onClick={onStage}>Stage this file (git add {path})</button>
      {repo.work[path] === undefined && <p className="text-xs text-ink-faint">The file no longer exists in the working tree.</p>}
    </section>
  );
}

function ConflictLab() {
  const [kind, setKind] = useState<ConflictKind>("merge");
  const initial = useMemo(() => startConflict(kind), [kind]);
  const [state, setState] = useState<{ repo: Repo; log: Frame[] }>(() => ({ repo: initial.repo, log: initial.cmds }));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => { setState({ repo: initial.repo, log: initial.cmds }); setDrafts({}); }, [initial]);
  const { repo, log } = state;
  const op = repo.op;
  const unmerged = op?.unmerged ?? [];
  const exec = (cmd: string) => { const f = stepFrame(repo, cmd); setState({ repo: f.repo, log: [...log, f] }); setDrafts({}); };
  const stage = (path: string) => {
    const w = writeFile(repo, path, drafts[path] ?? repo.work[path] ?? "");
    const f = stepFrame(w.repo, `git add ${path}`);
    setState({ repo: f.repo, log: [...log, { ...f, cmd: `# edit ${path}, then ${f.cmd}` }] });
    setDrafts((d) => { const n = { ...d }; delete n[path]; return n; });
  };
  const finish = op?.kind === "rebase" ? "git rebase --continue" : "git commit";
  const contextLine = op?.kind === "rebase" ? `Rebasing ${op.branch} onto ${shortId(op.onto)}: replaying commit ${op.done} of ${op.total}.` : op?.kind === "merge" ? `Merging ${op.theirsName} into ${currentBranch(repo)}.` : "Finished.";
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">Two branches changed the same line of <code>settings.txt</code>. Resolve it as you would in an editor, then let Git finish. <ProvenanceBadge p="simulated" /></p>
      <div role="group" aria-label="Conflict scenario" className="flex flex-wrap gap-1.5">
        {(["merge", "rebase"] as ConflictKind[]).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${kind === k ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>{k === "merge" ? "Merge conflict" : "Rebase conflict"}</button>)}
        <button type="button" className={btn} onClick={() => { setState({ repo: initial.repo, log: initial.cmds }); setDrafts({}); }}>Start over</button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <p className="rounded-lg border border-surface-border bg-surface-soft p-2 text-sm text-ink" role="status" aria-live="polite" data-testid="conflict-context">{contextLine} {unmerged.length ? `${unmerged.length} file${unmerged.length === 1 ? "" : "s"} still need${unmerged.length === 1 ? "s" : ""} a decision.` : op ? "All files are staged. Finish the operation." : ""}</p>
          {unmerged.map((p) => <ConflictFile key={`${op?.kind === "rebase" ? op.current : "m"}:${p}`} path={p} repo={repo} text={drafts[p] ?? repo.work[p] ?? ""} onChange={(t) => setDrafts((d) => ({ ...d, [p]: t }))} onStage={() => stage(p)} />)}
          {op && unmerged.length === 0 && <button type="button" className={primaryBtn} onClick={() => exec(finish)}>{op.kind === "rebase" ? "Continue the rebase (git rebase --continue)" : "Complete the merge (git commit)"}</button>}
          {op && <button type="button" className={btn} onClick={() => exec(op.kind === "rebase" ? "git rebase --abort" : "git merge --abort")}>Abort and go back ({op.kind === "rebase" ? "git rebase --abort" : "git merge --abort"})</button>}
          {!op && <p className="rounded-lg border border-success/50 bg-success-dim p-2 text-sm text-ink" role="status">The {log.some((f) => f.cmd.includes("abort")) ? "operation was aborted: the repository is back where it started" : "conflict is resolved and Git finished the operation"}. <code className="font-mono text-xs">settings.txt</code> now reads: <span className="font-mono text-xs">{(repo.work["settings.txt"] ?? "").trim().split("\n").join(" / ")}</span></p>}
        </div>
        <div className="min-w-0 space-y-3">
          <GitGraph repo={repo} label="during conflict resolution" />
          <div role="log" aria-label="Commands run" className="max-h-56 overflow-auto rounded-lg border border-surface-border bg-surface p-2 font-mono text-xs">
            {log.map((f, i) => <div key={i}><p className={f.ok ? "text-ink" : "text-warn"}><span className="text-ink-faint">$</span> {f.cmd}</p>{f.output && <pre className="whitespace-pre-wrap break-words text-ink-muted">{f.output}</pre>}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page component ───────────────────────────────────────────────────────

const TABS = [["play", "Guided lab"], ["compare", "Merge vs rebase"], ["conflict", "Resolve a conflict"]] as const;
type Tab = (typeof TABS)[number][0];

/** Git Lab: a simulated, in-memory Git. Nothing here reads or writes a real repository. */
export function GitLab({ preset }: { preset?: string }) {
  const [tab, setTab] = useState<Tab>("play");
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex(([id]) => id === tab);
    const n = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
    if (n >= 0) { e.preventDefault(); setTab(TABS[n][0]); document.getElementById(`git-tab-${TABS[n][0]}`)?.focus(); }
  };
  return (
    <section aria-label="Git lab" className="space-y-3">
      <p className="text-sm text-ink-muted">
        <ProvenanceBadge p="simulated" /> A teaching model of Git running in memory: it never touches a real repository, disk or network. Commit ids use Git's real object format with a fixed identity and a logical clock, so they are deterministic but will not match any real repository. Output is abridged.
      </p>
      <div role="tablist" aria-label="Git lab sections" className="flex flex-wrap gap-1.5">
        {TABS.map(([id, label]) => (
          <button key={id} id={`git-tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls={`git-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={onTabKey}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === id ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`git-panel-${tab}`} aria-labelledby={`git-tab-${tab}`}>
        {tab === "play" && <Playground preset={preset} />}
        {tab === "compare" && <MergeVsRebase />}
        {tab === "conflict" && <ConflictLab />}
      </div>
    </section>
  );
}

