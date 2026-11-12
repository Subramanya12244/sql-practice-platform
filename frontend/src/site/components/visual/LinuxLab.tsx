import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { useReducedMotion } from "../../lib/visual/motion";
import {
  CHALLENGES, PRESETS, UNSUPPORTED, challengeById, createSession, execLine, explainMode, nodeAt, presetById, treeRows, viewFile,
  type Chunk, type Frame, type Session, type Transcript,
} from "../../lib/visual/linux";

const label = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";
const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`;
const btn = "h-7 rounded-md border border-surface-border px-2 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-40";

interface Entry { cwd: string; line: string; chunks: Chunk[]; status: number }
const tabFor = (id: string) => (id === "processes" ? "procs" : id === "permissions" ? "perms" : id === "pipes" ? "pipeline" : "files") as "pipeline" | "files" | "perms" | "procs";
const short = (cwd: string, home = "/home/learner") => (cwd === home ? "~" : cwd.startsWith(home + "/") ? "~" + cwd.slice(home.length) : cwd);

/** Cap long stage text so a 60-line log does not push the layout around; the full text is still what the next stage received. */
function clip(t: string | null, n = 10): { text: string; more: number } {
  if (t === null) return { text: "", more: 0 };
  const l = t.split("\n"); if (l[l.length - 1] === "") l.pop();
  return { text: l.slice(0, n).join("\n"), more: Math.max(0, l.length - n) };
}

function StageCard({ f, state, last }: { f: Frame; state: "done" | "current" | "pending"; last: boolean }) {
  const inp = clip(f.stdin), outp = clip(f.stdout);
  return (
    <li aria-current={state === "current" ? "step" : undefined} className={`min-w-0 space-y-1 rounded-lg border p-2 text-xs ${state === "current" ? "border-accent bg-accent-dim" : state === "done" ? "border-surface-border bg-surface-soft" : "border-surface-border opacity-50"}`}>
      <p className="break-all font-mono font-semibold text-ink">{f.stage + 1}. {f.cmd}</p>
      {state === "pending" ? <p className="text-ink-faint">Not run yet.</p> : (
        <>
          <div><p className={label}>Input (stdin)</p>{f.stdin === null ? <p className="text-ink-faint">none: reads its file arguments</p> : <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-ink">{inp.text || "(empty)"}{inp.more ? `\n... ${inp.more} more line${inp.more === 1 ? "" : "s"}` : ""}</pre>}</div>
          <div><p className={label}>{f.redirect ? `Output (written to file: ${f.redirect})` : last ? "Output (stdout)" : "Output (piped on)"}</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-ink">{f.redirect ? "(nothing is piped on)" : outp.text || "(empty)"}{!f.redirect && outp.more ? `\n... ${outp.more} more line${outp.more === 1 ? "" : "s"}` : ""}</pre></div>
          {f.stderr && <div><p className={label}>Error (stderr, goes to the terminal, not the pipe)</p><pre className="whitespace-pre-wrap break-all font-mono text-danger">{f.stderr}</pre></div>}
          <p className="text-ink-faint">Exit status {f.status}</p>
        </>
      )}
    </li>
  );
}

function PipelineView({ frames, text }: { frames: Frame[]; text: string }) {
  const pb = usePlayback(frames.length);
  useEffect(() => { pb.dispatch({ type: "restart" }); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!frames.length) return <p className="text-sm text-ink-muted">Run a command line with pipes, such as <code>cut -d, -f2 data/sales.csv | sort | uniq -c</code>, to see every stage's input and output here.</p>;
  const cur = frames[pb.index];
  return (
    <div className="space-y-2">
      <p className="break-all font-mono text-xs text-ink">{text}</p>
      <ol aria-label="Pipeline stages" className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {frames.map((f, i) => <StageCard key={i} f={f} last={i === frames.length - 1} state={i < pb.index ? "done" : i === pb.index ? "current" : "pending"} />)}
      </ol>
      <PlaybackBar pb={pb} labels={frames.map((f) => f.cmd)} />
      <p role="status" aria-live="polite" className="rounded-lg border border-surface-border bg-surface-soft p-2 text-xs text-ink-muted">
        Stage {pb.index + 1} of {frames.length}: <code className="text-ink">{cur.cmd}</code> {cur.stdin === null ? "reads its arguments" : `receives ${cur.stdin.split("\n").filter(Boolean).length} line(s)`} and {cur.redirect ? `writes to ${cur.redirect.slice(2)}` : `produces ${cur.stdout.split("\n").filter(Boolean).length} line(s)`}. {frames.length > 1 ? "A real shell starts all stages at once and streams between them; this view runs them one after another to show each hand-over." : ""}
      </p>
    </div>
  );
}

function PermissionPanel({ s, path }: { s: Session; path: string }) {
  const n = nodeAt(s, path);
  if (!n) return <p className="text-sm text-ink-muted">Select a file or folder in the tree to see its permission bits.</p>;
  const e = explainMode(n, s.user), t = e.text;
  return (
    <section aria-label="Permission bits" className="space-y-2">
      <p className="break-all font-mono text-xs text-ink-muted">{path}</p>
      <p className="font-mono text-lg tracking-wider text-ink" aria-label={`Mode ${t}, octal ${e.octal}`}>
        <span className="text-ink-faint">{t[0]}</span><span className="text-accent">{t.slice(1, 4)}</span><span className="text-success">{t.slice(4, 7)}</span><span className="text-warn">{t.slice(7, 10)}</span>
        <span className="ml-3 text-sm text-ink-muted">octal {e.octal}</span>
      </p>
      <p className="text-xs text-ink-muted">Owner {n.owner}, group {n.group}. First character: <code>{t[0]}</code> = {n.kind === "dir" ? "directory" : "regular file"}.</p>
      <table className="w-full border-collapse text-xs" aria-label="Permissions by class">
        <thead><tr><th className="border border-surface-border bg-surface-soft p-1 text-left text-ink-faint" scope="col">Who</th><th className="border border-surface-border bg-surface-soft p-1 text-ink-faint" scope="col">read 4</th><th className="border border-surface-border bg-surface-soft p-1 text-ink-faint" scope="col">write 2</th><th className="border border-surface-border bg-surface-soft p-1 text-ink-faint" scope="col">{n.kind === "dir" ? "enter 1" : "execute 1"}</th><th className="border border-surface-border bg-surface-soft p-1 text-ink-faint" scope="col">digit</th></tr></thead>
        <tbody>{e.classes.map((c) => (
          <tr key={c.who} className={c.who === e.you ? "bg-accent-dim" : ""}>
            <th scope="row" className="border border-surface-border p-1 text-left font-medium text-ink">{c.label}{c.who === e.you ? " (you)" : ""}</th>
            {[c.r, c.w, c.x].map((on, i) => <td key={i} className="border border-surface-border p-1 text-center text-ink" aria-label={on ? "allowed" : "not allowed"}>{on ? "✓" : "–"}</td>)}
            <td className="border border-surface-border p-1 text-center tabular-nums text-ink">{c.digit}</td>
          </tr>))}</tbody>
      </table>
      <p role="status" aria-live="polite" className="text-xs text-ink-muted">{e.sentence} Only one class applies: the first of owner, group, other that matches you.</p>
    </section>
  );
}

/** A simulated terminal over an in-memory file system. A lesson links with ?preset=<id>; see PRESETS in lib/visual/linux.ts. */
export function LinuxLab({ preset }: { preset?: string }) {
  const first = presetById(preset) ?? PRESETS[0];
  const [presetId, setPresetId] = useState(first.id);
  const sessionRef = useRef<Session>(createSession());
  const [ver, bump] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lines, setLines] = useState<string[]>([]), [outs, setOuts] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [hist, setHist] = useState<{ i: number; draft: string } | null>(null);
  const [sel, setSel] = useState("/home/learner/notes.txt");
  const [pipeline, setPipeline] = useState<{ frames: Frame[]; text: string }>({ frames: [], text: "" });
  const [challengeId, setChallengeId] = useState<string | undefined>(first.challenge);
  const [verdict, setVerdict] = useState<{ ok: boolean; message: string } | null>(null);
  const [tab, setTab] = useState<"pipeline" | "files" | "perms" | "procs">(tabFor(first.id));
  const reduced = useReducedMotion();
  const logRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null);
  const s = sessionRef.current;
  const p = presetById(presetId) ?? PRESETS[0];

  const reset = (id: string) => {
    sessionRef.current = createSession(); const pr = presetById(id) ?? PRESETS[0];
    setEntries([]); setLines([]); setOuts([]); setHist(null); setInput(""); setPipeline({ frames: [], text: "" }); setVerdict(null);
    setChallengeId(pr.challenge); setPresetId(pr.id); setTab(tabFor(pr.id)); bump((n) => n + 1);
  };
  useEffect(() => { const pr = presetById(preset); if (pr && pr.id !== presetId) reset(pr.id); }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const el = logRef.current; if (el) el.scrollTo?.({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" }); }, [entries, reduced]);

  const run = (line: string) => {
    const cwd = s.cwd;
    const r = execLine(s, line);
    if (r.cleared) setEntries([]);
    else setEntries((e) => [...e.slice(-200), { cwd, line, chunks: r.chunks, status: r.status }]);
    setLines((l) => [...l, line]); setOuts((o) => [...o, r.chunks.map((c) => c.text).join("")]);
    const withPipes = [...r.pipelines].reverse().find((x) => x.frames.length > 1) ?? [...r.pipelines].reverse().find((x) => x.frames.length > 0);
    if (withPipes) setPipeline({ frames: withPipes.frames, text: withPipes.text });
    if (withPipes && withPipes.frames.length > 1) setTab("pipeline");
    setVerdict(null); setHist(null); bump((n) => n + 1);
  };
  const submit = (e?: FormEvent) => { e?.preventDefault(); const line = input; setInput(""); run(line); inputRef.current?.focus(); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const h = s.history;
    if (e.key === "ArrowUp") { e.preventDefault(); if (!h.length) return; const i = hist ? Math.max(0, hist.i - 1) : h.length - 1; setHist({ i, draft: hist?.draft ?? input }); setInput(h[i]); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (!hist) return; if (hist.i >= h.length - 1) { setInput(hist.draft); setHist(null); } else { setHist({ ...hist, i: hist.i + 1 }); setInput(h[hist.i + 1]); } }
    else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); setEntries([]); }
  };
  const challenge = challengeById(challengeId);
  const check = () => {
    if (!challenge) return;
    const t: Transcript = { lastLine: lines[lines.length - 1] ?? "", lastOut: outs[outs.length - 1] ?? "", lines, outs };
    setVerdict(challenge.check(s, t));
  };
  const tree = useMemo(() => treeRows(s, "/"), [ver, s]); // eslint-disable-line react-hooks/exhaustive-deps
  const file = viewFile(s, sel);
  const prompt = `${s.user.name}@lab:${short(s.cwd)}$`;

  return (
    <section aria-label="Linux Terminal Lab" className="space-y-3" data-preset={presetId}>
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge p="simulated" />
        <p className="text-xs text-ink-muted">A simulated terminal over an in-memory file system. Nothing here touches your computer, and sample files reset when you reload.</p>
      </div>
      <div role="group" aria-label="Examples" className="flex flex-wrap gap-1.5">
        {PRESETS.map((x) => <button key={x.id} type="button" aria-pressed={x.id === presetId} title={x.blurb} className={chip(x.id === presetId)} onClick={() => reset(x.id)}>{x.label}</button>)}
      </div>
      <p className="text-sm text-ink-muted">{p.blurb}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Try these commands">
        {p.try.map((c) => <button key={c} type="button" className="max-w-full truncate rounded-md border border-surface-border bg-surface-soft px-2 py-1 font-mono text-[11px] text-ink-muted hover:text-ink" title={c} onClick={() => run(c)}>{c}</button>)}
      </div>

      <VisualShell
        left={(
          <div className="space-y-2">
            <div ref={logRef} role="log" aria-label="Terminal output" aria-live="polite" tabIndex={0} className="h-72 overflow-auto rounded-lg border border-surface-border bg-surface-soft p-2 font-mono text-xs">
              {entries.length === 0 && <p className="text-ink-faint">Type a command below, or press one of the suggestions. Try <code>help</code>.</p>}
              {entries.map((e, i) => (
                <div key={i} className="mb-1.5">
                  <p className="break-all text-ink"><span className="text-success">{s.user.name}@lab:{short(e.cwd)}$</span> {e.line}</p>
                  {e.chunks.map((c, j) => <pre key={j} className={`whitespace-pre-wrap break-all ${c.s === "err" ? "text-danger" : "text-ink"}`}>{c.text.replace(/\n$/, "")}</pre>)}
                </div>
              ))}
            </div>
            <form onSubmit={submit} className="flex items-center gap-1.5" aria-label="Command line">
              <span aria-hidden className="shrink-0 font-mono text-xs text-success">{prompt}</span>
              <input ref={inputRef} aria-label="Command" value={input} onChange={(e) => { setInput(e.target.value); setHist(null); }} onKeyDown={onKey} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off"
                className="min-w-0 flex-1 rounded-md border border-surface-border bg-surface px-2 py-1.5 font-mono text-xs text-ink focus-visible:outline-2" />
              <button type="submit" className={btn}>Run</button>
            </form>
            <p className="text-[11px] text-ink-faint">Up and Down arrows recall earlier commands. Ctrl+L clears. Exit status of the last command: <span className="font-mono">{s.status}</span>. Working directory <span className="break-all font-mono">{s.cwd}</span>.</p>
            <div className="flex gap-1.5"><button type="button" className={btn} onClick={() => reset(presetId)}>Reset terminal</button></div>
          </div>
        )}
        right={(
          <div className="space-y-2">
            <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1.5">
              {([["pipeline", "Pipeline"], ["files", "Files"], ["perms", "Permissions"], ["procs", "Processes"]] as const).map(([id, name]) => <button key={id} role="tab" type="button" aria-selected={tab === id} className={chip(tab === id)} onClick={() => setTab(id)}>{name}</button>)}
            </div>
            <div role="tabpanel" aria-label={tab}>
              {tab === "pipeline" && <section aria-label="Pipeline view" className="space-y-2"><h3 className="text-sm font-semibold text-ink">Pipeline view</h3><PipelineView frames={pipeline.frames} text={pipeline.text} /></section>}
              {tab === "files" && (
                <div className="space-y-2">
                  <section aria-label="Directory tree"><h3 className="text-sm font-semibold text-ink">Directory tree</h3>
                    <ul className="max-h-56 overflow-auto rounded-lg border border-surface-border p-1 font-mono text-xs">
                      {tree.map((r) => (
                        <li key={r.path} style={{ paddingLeft: r.depth * 12 }}>
                          <button type="button" aria-pressed={sel === r.path} onClick={() => setSel(r.path)} className={`w-full rounded px-1 text-left ${sel === r.path ? "bg-accent-dim" : "hover:bg-surface-soft"} ${r.path === s.cwd ? "font-bold" : ""} ${r.denied ? "text-danger" : "text-ink"}`}>
                            {r.kind === "dir" ? (r.name === "/" ? "/" : r.name + "/") : r.name}{r.path === s.cwd ? "  ← you are here" : ""}{r.denied ? "  (locked)" : ""}
                          </button>
                        </li>))}
                    </ul>
                  </section>
                  <section aria-label="File contents"><h3 className="text-sm font-semibold text-ink">File contents</h3>
                    <p className="break-all font-mono text-[11px] text-ink-faint">{sel}</p>
                    {file.ok ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-surface-border bg-surface-soft p-2 font-mono text-xs text-ink">{file.text || "(empty file)"}</pre>
                      : <p role="alert" className="rounded-lg border border-danger/50 bg-danger-dim p-2 text-xs text-ink">{file.error}{file.error === "Permission denied" ? ": you are not allowed to read this, exactly as cat would report." : "."}</p>}
                  </section>
                </div>
              )}
              {tab === "perms" && <div className="space-y-2"><h3 className="text-sm font-semibold text-ink">Permission bits</h3><PermissionPanel s={s} path={sel} /><p className="text-xs text-ink-faint">Pick another file in the Files tab, or run <code>ls -l</code>. The selected path is {sel}.</p></div>}
              {tab === "procs" && (
                <section aria-label="Process table" className="space-y-1"><h3 className="text-sm font-semibold text-ink">Processes <ProvenanceBadge p="simulated" /></h3>
                  <p className="text-xs text-ink-muted">A fixed fixture table, not real processes. CPU and memory figures are made up and static.</p>
                  <div className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-xs"><thead><tr>{["PID", "USER", "%CPU", "STAT", "COMMAND"].map((h) => <th key={h} scope="col" className="border border-surface-border bg-surface-soft p-1 text-left text-ink-faint">{h}</th>)}</tr></thead>
                    <tbody>{s.procs.map((q) => <tr key={q.pid} className={q.user === s.user.name ? "" : "opacity-60"}><td className="border border-surface-border p-1 tabular-nums text-ink">{q.pid}</td><td className="border border-surface-border p-1 text-ink">{q.user}</td><td className="border border-surface-border p-1 tabular-nums text-ink">{q.cpu.toFixed(1)}</td><td className="border border-surface-border p-1 text-ink">{q.stat}</td><td className="border border-surface-border p-1 font-mono text-ink">{q.cmd}</td></tr>)}</tbody></table></div>
                </section>
              )}
            </div>
          </div>
        )}
        bottom={(
          <section aria-label="Challenge" className="space-y-2 rounded-lg border border-surface-border p-2">
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">Challenge</h3>
              <select aria-label="Choose a challenge" className="rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs text-ink" value={challengeId ?? ""} onChange={(e) => { setChallengeId(e.target.value || undefined); setVerdict(null); }}>
                <option value="">(none)</option>{CHALLENGES.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></div>
            {challenge ? (<>
              <p className="text-sm text-ink-muted">{challenge.goal}</p>
              <details className="text-xs text-ink-muted"><summary className="cursor-pointer text-ink">Hint</summary><p className="mt-1">{challenge.hint}</p></details>
              <button type="button" className={btn} onClick={check}>Check my answer</button>
              {verdict && <p role="status" aria-live="polite" className={`rounded-lg border p-2 text-xs text-ink ${verdict.ok ? "border-success/40 bg-success-dim" : "border-warn/50 bg-warn-dim"}`}><strong>{verdict.ok ? "Done. " : "Not yet. "}</strong>{verdict.message}</p>}
            </>) : <p className="text-xs text-ink-faint">Pick a challenge for a goal with an automatic check. The check reads the virtual file system and your last command's output.</p>}
          </section>
        )}
      />
      <details className="rounded-lg border border-surface-border p-2 text-xs text-ink-muted">
        <summary className="cursor-pointer font-semibold text-ink">What is not supported</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">{UNSUPPORTED.map((u) => <li key={u}>{u}</li>)}</ul>
        <p className="mt-2">Type <code>help</code> for the commands and syntax that do work, and <code>man &lt;command&gt;</code> for its supported options. A flag that is not implemented says so instead of pretending to work.</p>
      </details>
    </section>
  );
}
