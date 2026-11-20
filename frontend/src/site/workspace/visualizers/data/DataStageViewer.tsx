import { useEffect, useMemo, useRef } from "react";
import { PlaybackBar, ProvenanceBadge, usePlayback } from "../../../components/visual/Playback";
import { DataFrameView } from "../../../components/visual/DataFrameView";
import { ArrayView } from "../../../components/visual/ArrayView";
import { BroadcastView } from "../../../components/visual/BroadcastView";
import { rowMarks, isTabular, type DataModelData, type DataSnap, type DataStage, type StageAnalysis } from "../../../lib/visual/dataframe";
import { crossCheckBroadcast, numpyShape, pyShape } from "../../../lib/visual/broadcast";
import { beatAt, buildDataBeats } from "../../../lib/visual/dataBeats";
import { StoryPanel } from "../../../components/visual/StoryPanel";
import { PandasBeatView } from "../../../components/visual/PandasBeatView";
import { NumpyBeatView } from "../../../components/visual/NumpyBeatView";
import type { VisualizerProps } from "../../types";

const box = "rounded-xl border border-surface-border bg-surface-raised p-3";
const h = "mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint";

function GroupBlocks({ snap, reducedMotion }: { snap: DataSnap; reducedMotion: boolean }) {
  return (
    <div className="space-y-2" data-group-view>
      <p className="text-xs text-ink-muted">{snap.ngroups} group{snap.ngroups === 1 ? "" : "s"} by {snap.by?.join(", ") || "the key"}{snap.srcRows != null ? ` from ${snap.srcRows} rows` : ""}. Showing {snap.groups?.length ?? 0}.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(snap.groups ?? []).map((g, i) => (
          <div key={i} className="min-w-0 rounded-lg border border-surface-border p-2">
            <p className="mb-1 text-xs font-semibold text-ink">group {g.key} <span className="font-normal text-ink-faint">· {g.size} row{g.size === 1 ? "" : "s"}</span></p>
            <DataFrameView snap={g.snap} reducedMotion={reducedMotion} />
          </div>
        ))}
      </div>
      {(snap.ngroups ?? 0) > (snap.groups?.length ?? 0) && <p className="text-[11px] text-ink-faint">{(snap.ngroups ?? 0) - (snap.groups?.length ?? 0)} more groups are not drawn.</p>}
    </div>
  );
}

function SnapView({ snap, before, stage, role, an, reducedMotion, caption }: { snap: DataSnap; before?: DataSnap | null; stage: DataStage; role: "in0" | "in1" | "out"; an: StageAnalysis; reducedMotion: boolean; caption?: string }) {
  if (isTabular(snap)) {
    const keys = stage.merge && !stage.merge.skipped ? (role === "in0" ? stage.merge.leftKeys : role === "in1" ? stage.merge.rightKeys : stage.merge.leftKeys) : undefined;
    return <DataFrameView snap={snap} before={before} caption={caption} rowMarks={rowMarks(stage, role)} markHeader={stage.merge ? "Match" : stage.concat ? "From" : "Row"} keyCols={keys} reducedMotion={reducedMotion} />;
  }
  if (snap.k === "nd") {
    const o = role === "out" && stage.pos && stage.inputs[0]?.shape ? { src: stage.pos.src, inShape: stage.inputs[0].shape } : null;
    return <ArrayView snap={snap} name={role === "out" ? stage.assignedTo ?? "result" : role === "in0" ? "input" : "other"} before={before} caption={caption} selected={role === "in0" ? stage.pos?.sel : undefined} origin={o}
      reduce={role === "in0" && an.nd?.reduce?.op === "reduce" ? { axis: an.nd.reduce.axis, keepdims: an.nd.reduce.keepdims } : null} reducedMotion={reducedMotion} />;
  }
  if (snap.k === "group") return <GroupBlocks snap={snap} reducedMotion={reducedMotion} />;
  if (snap.k === "obj") return <p className="text-xs text-ink">{snap.t}{snap.params ? ` (${Object.entries(snap.params).map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}</p>;
  return <p className="font-mono text-xs text-ink">{snap.r}{snap.dtype ? <span className="ml-1 font-sans text-ink-faint">{snap.dtype}</span> : snap.t ? <span className="ml-1 font-sans text-ink-faint">{snap.t}</span> : null}</p>;
}

function Facts({ st, an }: { st: DataStage; an: StageAnalysis }) {
  const rows: [string, string][] = [];
  const shp = (s: number[] | null) => (s ? (an.domain === "numpy" ? numpyShape(s) : pyShape(s)) : "n/a");
  if (st.inputs.length) rows.push(["Input shape", st.inputs.map((s) => (s.shape ? shp(s.shape) : s.k === "group" ? `${s.ngroups} groups` : s.r)).join("  and  ")]);
  if (st.output) rows.push(["Output shape", st.output.shape ? shp(st.output.shape) : st.output.k === "group" ? `${st.output.ngroups} groups` : st.output.r]);
  if (an.rowsIn !== null && an.rowsOut !== null) rows.push(["Rows", an.rowsExact && an.rowsRetained !== null ? `${an.rowsIn} in, ${an.rowsRetained} retained, ${an.rowsRemoved} removed${an.rowsAdded ? `, ${an.rowsAdded} new` : ""}, ${an.rowsOut} out` : `${an.rowsIn} in, ${an.rowsOut} out${st.rows ? " (rows cannot be followed one by one here)" : ""}`]);
  if (an.colsAdded.length || an.colsRemoved.length) rows.push(["Columns", [an.colsAdded.length ? `added: ${an.colsAdded.join(", ")}` : "", an.colsRemoved.length ? `removed: ${an.colsRemoved.join(", ")}` : ""].filter(Boolean).join("; ")]);
  if (an.dtypeChanges.length) rows.push(["Dtype changes", an.dtypeChanges.map((d) => `${d.name}: ${d.before} → ${d.after}`).join(", ")]);
  else if (st.output?.k === "df" && st.output.dtypes) rows.push(["Dtypes", (st.output.colNames ?? []).map((c, i) => `${c}: ${st.output!.colDtypes?.[i]}`).slice(0, 8).join(", ")]);
  else if (st.output?.dtype) rows.push(["Dtype", st.output.dtype + (an.dtypeIn && an.dtypeIn !== st.output.dtype ? ` (was ${an.dtypeIn})` : "")]);
  if (an.missingBefore !== null && an.missingAfter !== null && an.missingBefore !== an.missingAfter) rows.push(["Missing cells", `${an.missingBefore} → ${an.missingAfter}`]);
  if (st.output?.k === "nd") rows.push(["Array", `${st.output.ndim} dimension${st.output.ndim === 1 ? "" : "s"}, size ${st.output.n}, ${st.output.itemsize} bytes per element${st.view !== undefined ? `, ${st.view ? "view of the input's memory" : "copy"}` : ""}`]);
  if (st.merge && !st.merge.skipped) {
    const m = st.merge;
    rows.push(["Keys", `${(m.leftKeys ?? []).join(", ")} = ${(m.rightKeys ?? []).join(", ")}`]);
    rows.push(["Matched keys", `${m.matchedKeyCount}${m.matchedKeys?.length ? `: ${m.matchedKeys.map((k) => `${k.key} (${k.left}×${k.right})`).join(", ")}${(m.matchedKeyCount ?? 0) > m.matchedKeys.length ? ", …" : ""}` : ""}`]);
    rows.push(["Left only", `${m.leftUnmatchedRows} row${m.leftUnmatchedRows === 1 ? "" : "s"}${m.unmatchedLeftKeys?.length ? `: keys ${m.unmatchedLeftKeys.map((k) => k.key).join(", ")}` : ""}`]);
    rows.push(["Right only", `${m.rightUnmatchedRows} row${m.rightUnmatchedRows === 1 ? "" : "s"}${m.unmatchedRightKeys?.length ? `: keys ${m.unmatchedRightKeys.map((k) => k.key).join(", ")}` : ""}`]);
  }
  if (st.argsRepr?.length || (st.kwargsRepr && Object.keys(st.kwargsRepr).length)) rows.push(["Arguments", [...(st.argsRepr ?? []), ...Object.entries(st.kwargsRepr ?? {}).map(([k, v]) => `${k}=${v}`)].join(", ")]);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-faint">{k}</dt><dd className="min-w-0 break-words text-ink">{v}</dd></div>)}
    </dl>
  );
}

/** `explain` is false when the story panel above already says the same sentence (the story's "what" is the analysis explanation). */
function StageBody({ st, an, reducedMotion, explain = true }: { st: DataStage; an: StageAnalysis; reducedMotion: boolean; explain?: boolean }) {
  const before = st.kind === "change" ? st.inputs[0] : null;
  const names = st.inputs.map((_, i) => (st.inputs.length > 1 ? `operand ${i + 1}` : `input`));
  return (
    <div className="space-y-3">
      <div className={box}>
        <p className={h}>Code executed{st.line ? ` · line ${st.line}` : ""}</p>
        <code className="block break-words font-mono text-xs text-ink">{st.kind === "change" || st.kind === "binop" || st.kind === "compare" || st.kind === "unary" || st.kind === "func" ? st.expr : st.expr}</code>
        {st.kind !== "change" && st.code !== st.expr && <p className="mt-1 text-[11px] text-ink-faint">This step: <code>{st.code}</code></p>}
        {st.stmt !== st.expr && <p className="mt-0.5 text-[11px] text-ink-faint">Statement: <code>{st.stmt}</code></p>}
      </div>
      {st.error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-dim px-3 py-2 text-sm text-danger"><span className="font-semibold">{st.error.type}: </span>{st.error.msg}</p>}
      {explain && <p className="text-sm text-ink" data-explanation>{an.explanation}</p>}
      <Facts st={st} an={an} />
      {an.nd?.broadcast && <div className={box}><p className={h}>Broadcasting</p><BroadcastView table={an.nd.broadcast} names={names} errorText={st.error?.msg} check={crossCheckBroadcast(an.nd.broadcast, st.error ? { errorText: st.error.msg } : { resultShape: st.output?.shape })} /></div>}
      {an.nd?.matmul && (
        <div className={box} data-matmul-valid={an.nd.matmul.valid ? "true" : "false"}>
          <p className={h}>Matrix multiplication</p>
          <p className="font-mono text-sm text-ink">{an.nd.matmul.rule}</p>
          <p className={`mt-1 text-xs ${an.nd.matmul.valid ? "text-ink-muted" : "text-danger"}`}>{an.nd.matmul.message}</p>
          {an.nd.matmul.inner && <p className="mt-1 text-xs text-ink-faint">Inner dimensions: first array last axis = {an.nd.matmul.inner.a}, second array {an.nd.matmul.b.length === 1 ? "only axis" : "second-to-last axis"} = {an.nd.matmul.inner.b}.</p>}
          {st.error && <p className="mt-1 rounded border border-danger/30 bg-danger-dim px-2 py-1 font-mono text-xs text-danger"><span className="font-sans font-semibold">NumPy said: </span>{st.error.msg}</p>}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {st.inputs.map((s, i) => (
          <div key={`in${i}`} className={`${box} min-w-0`}>
            <p className={h}>{st.kind === "change" ? "Before" : st.merge ? (i === 0 ? "Left table" : "Right table") : st.inputs.length > 1 ? `Operand ${i + 1}` : "Input"}</p>
            <SnapView snap={s} stage={st} role={i === 0 ? "in0" : "in1"} an={an} reducedMotion={reducedMotion} caption={st.kind === "change" && i === 0 ? "Before this step" : undefined} />
          </div>
        ))}
        {st.argSnaps.slice(0, 2).map((s, i) => (
          <div key={`arg${i}`} className={`${box} min-w-0`}>
            <p className={h}>{st.merge ? "Right table" : `Argument${isTabular(s) && s.dtype === "bool" ? " (the condition)" : ""}`}</p>
            <SnapView snap={s} stage={st} role="in1" an={an} reducedMotion={reducedMotion} />
          </div>
        ))}
        {st.output && (
          <div className={`${box} min-w-0 ${st.inputs.length + st.argSnaps.length >= 2 ? "lg:col-span-2" : ""}`}>
            <p className={h}>{st.kind === "change" ? "After" : "Output"}</p>
            <SnapView snap={st.output} before={before ?? (st.inputs.length === 1 && st.output.k === st.inputs[0].k ? st.inputs[0] : null)} stage={st} role="out" an={an} reducedMotion={reducedMotion} caption={st.kind === "change" ? "After (changed cells highlighted)" : "Current value"} />
          </div>
        )}
      </div>
      <p className={`text-[11px] ${an.consistent ? "text-ink-faint" : "text-danger"}`} data-consistency={an.consistent ? "ok" : "failed"}>
        {an.checks.length === 0 ? "No derived numbers to check for this step." : an.consistent ? `Consistency: ${an.checks.length} check${an.checks.length === 1 ? "" : "s"} against the real result passed.` : `Consistency check failed: ${an.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}.`}
      </p>
    </div>
  );
}

/**
 * Steps through the beats of a DataModelData with the shared player. Controlled by `step`. A beat is one idea of one stage (see
 * lib/visual/dataBeats.ts): the story panel gives the four answers for it, the beat's own picture shows the real data it uses, and the
 * full stage (code, shapes, every table) stays one click away. Stages without a dedicated picture show the generic stage.
 */
export function DataStageViewer({ model, step, onStepChange, reducedMotion, hostPlayer }: VisualizerProps) {
  const data = model.data as DataModelData;
  const beats = useMemo(() => buildDataBeats(data), [data]);
  const count = beats.length;
  const pb = usePlayback(count);
  // `sent` is the last step both sides agree on. The player starts at 0; each side only pushes a value the other has not seen, so the two never ping-pong.
  const sent = useRef(0);
  useEffect(() => { if (pb.index !== sent.current) { sent.current = pb.index; onStepChange(pb.index); } }, [pb.index]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (step !== sent.current) { sent.current = step; pb.dispatch({ type: "seek", index: step }); } }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const i = Math.max(0, Math.min(count - 1, step));
  const beat = beatAt(beats, i);
  const st = beat ? data.stages[beat.stage] : undefined, an = beat ? data.analyses[beat.stage] : undefined;
  const picture = beat && st && an ? (beat.view.owner === "pandas" ? PandasBeatView({ beat, stage: st, analysis: an, reducedMotion }) : beat.view.owner === "numpy" ? NumpyBeatView({ beat, stage: st, analysis: an, reducedMotion }) : null) : null;
  return (
    <div className="min-w-0 space-y-3" data-data-visualizer={data.domain}>
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge p={model.provenance} />
        <span className="text-xs text-ink-faint">Real values from running your code in Pyodide{data.libs.numpy ? ` · numpy ${data.libs.numpy}` : ""}{data.libs.pandas ? ` · pandas ${data.libs.pandas}` : ""}</span>
      </div>
      {count === 0 || !beat || !st || !an ? (
        <p className="text-sm text-ink-muted">Your code ran, but it created no DataFrame, Series or array to show.</p>
      ) : (
        <>
          {!hostPlayer && <PlaybackBar pb={pb} labels={beats.map((b) => (b.of > 1 ? `${data.analyses[b.stage].title}: ${b.title}` : b.title))} />}
          <p className="text-sm font-semibold text-ink" aria-live="polite">Stage {beat.stage + 1} of {data.stages.length}: <code className="font-mono font-normal">{an.title}</code>{beat.of > 1 && <span className="ml-2 text-xs font-normal text-ink-muted" data-beat={beat.id}>part {beat.beat + 1} of {beat.of}: {beat.title}</span>}</p>
          <StoryPanel story={beat.story} stepKey={beat.id} step={i + 1} total={count} reduced={reducedMotion} />
          {picture ? (
            <>
              <div data-testid="beat-picture" data-beat-type={beat.view.type} className="min-w-0">{picture}</div>
              <details className="text-xs" data-testid="stage-details">
                <summary className="cursor-pointer text-ink-muted">Code, shapes and every table for this stage</summary>
                <div className="mt-2"><StageBody key={beat.stage} st={st} an={an} reducedMotion={reducedMotion} /></div>
              </details>
            </>
          ) : (
            <StageBody key={beat.stage} st={st} an={an} reducedMotion={reducedMotion} explain={beat.view.owner !== "generic"} />
          )}
        </>
      )}
      {data.seeds.seeds.length > 0 && <p className="text-xs text-ink-muted">Random numbers are seeded with {data.seeds.seeds.join(", ")}, so every run gives the same values.</p>}
      {data.seeds.unseeded && <p role="note" className="text-xs text-warn">Random numbers are used without a seed: the values change on every run. Use <code>np.random.seed(42)</code> or <code>np.random.default_rng(42)</code> for repeatable output.</p>}
      {!data.ok && data.error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-dim px-3 py-2 text-sm text-danger">The program stopped with {data.error.type}{data.error.line ? ` on line ${data.error.line}` : ""}: {data.error.msg}</p>}
      {data.stdout && <details className="text-xs"><summary className="cursor-pointer text-ink-muted">Program output</summary><pre className="mt-1 overflow-x-auto rounded bg-surface-soft p-2 text-ink">{data.stdout}</pre></details>}
      {!data.consistent && <p role="alert" className="text-xs text-danger">A derived number disagreed with the real result: {data.failedChecks.join(" | ")}</p>}
      {data.notes.length > 0 && <ul className="list-inside list-disc text-[11px] text-ink-faint">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </div>
  );
}
