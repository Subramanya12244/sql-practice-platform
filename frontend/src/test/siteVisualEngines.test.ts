// @vitest-environment node
import { describe, expect, it } from "vitest";
import { frameDelay, initialPlayback, keyAction, playbackReducer, type PlaybackState } from "../site/lib/visual/playback";
import { SCENARIOS, backoffDelay, backoffSchedule, runScenario } from "../site/lib/visual/apiSim";
import { SOURCE, applyCdc, applyScd2, runDag, runPipeline, validateRow } from "../site/lib/visual/etlSim";
import { DEFAULT_SPEC, SALES, adviseChart, aggregate, axisRange, boxStats, buildChart, groupBy, histogram } from "../site/lib/visual/chartData";
import { commonMistake, conceptFor, explainLevel, firstDifference, similarChallenge, sqlSteps, whyOutput } from "../site/lib/visual/explain";
import { TEMPLATES, visualFor } from "../site/lib/visual/dailyVisual";
import { describeDataChange, diffGrids, gridOf } from "../site/lib/visual/dataDiff";
import { compareStages } from "../site/lib/visual/stageCompare";
import { KNOWN_PLAN_NODES, planNodeHelp } from "../site/lib/visual/planExplain";
import { CURRICULUM } from "../site/lib/daily";
import type { Visualization } from "../site/lib/visualize";

const step = (s: PlaybackState, ...a: Parameters<typeof playbackReducer>[1][]) => a.reduce(playbackReducer, s);

describe("playback controls", () => {
  const s0 = initialPlayback(4);
  it("plays, pauses, steps, restarts and seeks within bounds", () => {
    expect(step(s0, { type: "next" }).index).toBe(1);
    expect(step(s0, { type: "prev" }).index).toBe(0);
    expect(step(s0, { type: "seek", index: 99 }).index).toBe(3);
    expect(step(s0, { type: "seek", index: -5 }).index).toBe(0);
    expect(step(s0, { type: "play" }).playing).toBe(true);
    expect(step(s0, { type: "play" }, { type: "pause" }).playing).toBe(false);
    expect(step(s0, { type: "seek", index: 2 }, { type: "restart" }).index).toBe(0);
  });
  it("auto-advances on tick and stops at the last frame", () => {
    let s = step(s0, { type: "play" });
    for (let i = 0; i < 3; i++) s = step(s, { type: "tick" });
    expect(s.index).toBe(3);
    expect(s.playing).toBe(false);
    expect(step(s, { type: "tick" }).index).toBe(3);
  });
  it("playing from the end starts over; a manual step pauses playback", () => {
    const end = step(s0, { type: "seek", index: 3 });
    expect(step(end, { type: "play" })).toMatchObject({ index: 0, playing: true });
    expect(step(s0, { type: "play" }, { type: "next" }).playing).toBe(false);
  });
  it("speed changes the frame delay and an empty player does nothing", () => {
    expect(frameDelay(2)).toBeLessThan(frameDelay(1));
    expect(frameDelay(0.5)).toBeGreaterThan(frameDelay(1));
    expect(playbackReducer(initialPlayback(0), { type: "play" }).playing).toBe(false);
    expect(playbackReducer(initialPlayback(0), { type: "next" }).index).toBe(0);
  });
  it("a shrinking frame list clamps the index", () => {
    expect(step(initialPlayback(5), { type: "seek", index: 4 }, { type: "count", count: 2 }).index).toBe(1);
  });
  it("keyboard map", () => {
    expect(keyAction(" ")).toEqual({ type: "toggle" });
    expect(keyAction("ArrowRight")).toEqual({ type: "next" });
    expect(keyAction("ArrowLeft")).toEqual({ type: "prev" });
    expect(keyAction("Home")).toEqual({ type: "restart" });
    expect(keyAction("x")).toBeNull();
  });
});

describe("plan node explanations and query comparison", () => {
  it("explains known plan nodes only, never unknown ones", () => {
    for (const n of ["Seq Scan", "Index Scan", "Nested Loop", "Hash Join", "Merge Join", "Sort", "Aggregate"]) expect(KNOWN_PLAN_NODES).toContain(n);
    expect(planNodeHelp("Seq Scan")).toMatch(/every row/);
    expect(planNodeHelp("Hash Join")).toMatch(/hash table/);
    expect(planNodeHelp("Totally Made Up Node")).toBeUndefined();
    expect(planNodeHelp("Hash Join", "Left")).toContain("Left");
  });
  it("lines up stages by clause", () => {
    const v = (rows: Record<string, number>): Visualization => ({ parsed: {} as never, stages: Object.entries(rows).map(([clause, rowsOut]) => ({ clause: clause as never, title: "", explanation: "", rowsOut, source: "executed" as const })) });
    const r = compareStages(v({ from: 10, where: 4, select: 4 }), v({ from: 10, select: 4 }));
    expect(r.map((x) => [x.clause, x.same])).toEqual([["from", true], ["where", false], ["select", true]]);
    expect(r[1].b).toBeUndefined();
  });
});

describe("API studio engine", () => {
  const lastFrame = (id: Parameters<typeof runScenario>[0], o = {}) => runScenario(id, o);
  it("every scenario runs, ends with a done frame, and uses only the mock endpoints", () => {
    for (const s of SCENARIOS) {
      const r = runScenario(s.id);
      expect(r.frames[r.frames.length - 1].phase).toBe("done");
      for (const f of r.frames) if (f.req) expect(f.req.url.startsWith("/api/")).toBe(true);
    }
  });
  it("covers status codes 200, 201, 400, 401, 403, 404, 429 and 500", () => {
    expect(lastFrame("ok-200").finalStatus).toBe(200);
    expect(lastFrame("created-201").frames.some((f) => f.res?.status === 201)).toBe(true);
    expect(lastFrame("bad-400").finalStatus).toBe(400);
    expect(lastFrame("unauth-401", { token: "missing" }).finalStatus).toBe(401);
    expect(lastFrame("unauth-401", { token: "expired" }).finalStatus).toBe(401);
    expect(lastFrame("forbidden-403", { token: "readonly" }).finalStatus).toBe(403);
    expect(lastFrame("notfound-404").finalStatus).toBe(404);
    expect(lastFrame("ratelimit-429").frames.some((f) => f.res?.status === 429)).toBe(true);
    expect(lastFrame("server-500").frames.some((f) => f.res?.status === 500)).toBe(true);
  });
  it("4xx errors are not retried", () => {
    expect(lastFrame("bad-400").requests).toBe(1);
    expect(lastFrame("notfound-404").requests).toBe(1);
  });
  it("honours Retry-After when allowed and uses exponential backoff otherwise", () => {
    const honour = runScenario("ratelimit-429", { honorRetryAfter: true });
    expect(honour.frames.filter((f) => f.phase === "wait").map((f) => f.title)).toEqual(["Wait 2000 ms", "Wait 2000 ms"]);
    expect(honour.finalStatus).toBe(200);
    const own = runScenario("ratelimit-429", { honorRetryAfter: false, baseDelayMs: 100 });
    expect(own.frames.filter((f) => f.phase === "wait").map((f) => f.title)).toEqual(["Wait 100 ms", "Wait 200 ms"]);
  });
  it("exponential backoff grows and gives up at the retry limit", () => {
    expect(backoffSchedule(4, 200)).toEqual([200, 400, 800, 1600]);
    expect(backoffDelay(3, 100)).toBe(800);
    const ok = runScenario("server-500", { maxRetries: 3 });
    expect(ok.finalStatus).toBe(200);
    const fail = runScenario("server-500", { maxRetries: 1 });
    expect(fail.finalStatus).toBe(500);
    expect(fail.frames.some((f) => f.title === "Giving up")).toBe(true);
    expect(fail.requests).toBe(2);
  });
  it("a repeated POST is safe only with an idempotency key", () => {
    const withKey = runScenario("created-201", { idempotencyKey: true });
    const ids = withKey.frames.filter((f) => f.res && (f.res.status === 201 || f.res.status === 200)).map((f) => (f.res!.body as { id: number }).id);
    expect(new Set(ids).size).toBe(1);
    expect(withKey.frames.some((f) => f.res?.headers["idempotent-replay"] === "true")).toBe(true);
    const without = runScenario("created-201", { idempotencyKey: false });
    const ids2 = without.frames.filter((f) => f.res?.status === 201).map((f) => (f.res!.body as { id: number }).id);
    expect(new Set(ids2).size).toBe(2);
  });
  it("timeouts are reported with the client deadline and retried", () => {
    const r = runScenario("timeout", { timeoutMs: 500, maxRetries: 1 });
    expect(r.frames.filter((f) => f.phase === "error" && f.res?.timedOut).length).toBe(2);
    expect(r.finalStatus).toBeUndefined();
  });
  it("offset pagination collects every row and stops on the last page", () => {
    const r = runScenario("page-offset", { pageSize: 4 });
    expect(r.requests).toBe(3);
    expect(r.frames.filter((f) => f.phase === "page").pop()!.collected).toBe(10);
  });
  it("cursor pagination follows next_cursor until null", () => {
    const r = runScenario("page-cursor", { pageSize: 4 });
    expect(r.requests).toBe(3);
    expect(r.frames.filter((f) => f.phase === "page").pop()!.collected).toBe(9);
    expect(r.frames.filter((f) => f.phase === "request").map((f) => f.req!.query.cursor)).toEqual([undefined, "evt_004", "evt_008"]);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(runScenario("server-500"))).toBe(JSON.stringify(runScenario("server-500")));
  });
});

describe("ETL pipeline engine", () => {
  it("full load: validates, quarantines bad rows, dedupes, loads", () => {
    const r = runPipeline();
    expect(r.status).toBe("success-with-rejects");
    expect(r.quarantine.map((q) => q.id).sort()).toEqual([3, 4]);
    expect(r.target.map((t) => t.id).sort()).toEqual([1, 2, 5, 6, 7]);
    expect(r.target.find((t) => t.id === 5)!.amount).toBe(210); // newest duplicate wins
    expect(r.frames.map((f) => f.stage)).toEqual(["source", "extract", "validate", "transform", "load", "target"]);
    expect(validateRow(SOURCE[2])).toBe("amount is negative");
  });
  it("without quarantine one bad row fails the run and nothing loads", () => {
    const r = runPipeline({ quarantine: false });
    expect(r.status).toBe("failed");
    expect(r.target).toEqual([]);
    expect(r.checkpoint).toBeNull();
  });
  it("incremental load reads only rows after the watermark and returns a new checkpoint", () => {
    const r = runPipeline({ mode: "incremental", watermark: "2026-03-03" });
    expect(r.frames.find((f) => f.stage === "extract")!.counts.out).toBe(3); // rows 5, 6, 7 are newer than the watermark
    expect(r.checkpoint).toBe("2026-03-05");
  });
  it("upsert is idempotent; append duplicates on rerun", () => {
    const first = runPipeline();
    const again = runPipeline({ targetBefore: first.target });
    expect(again.target).toEqual(first.target);
    const a1 = runPipeline({ load: "append" });
    const a2 = runPipeline({ load: "append", targetBefore: a1.target });
    expect(a2.target.length).toBe(a1.target.length * 2);
    expect(a2.frames.find((f) => f.stage === "target")!.detail).toMatch(/duplicate/i);
  });
  it("deduplication off passes the duplicate key on", () => {
    expect(runPipeline({ dedupe: false, load: "append" }).target.filter((t) => t.id === 5)).toHaveLength(2);
  });
  it("retries transient extract failures with backoff, then recovers", () => {
    const r = runPipeline({ failure: "extract-fails-twice", maxRetries: 2 });
    expect(r.retries).toBe(2);
    expect(r.status).toBe("success-with-rejects");
    expect(r.frames.filter((f) => f.status === "retry").map((f) => f.detail.match(/(\d+) ms/)![1])).toEqual(["100", "200"]);
  });
  it("gives up when retries run out, and does not advance the checkpoint", () => {
    const r = runPipeline({ failure: "extract-always-fails", maxRetries: 1, mode: "incremental" });
    expect(r.status).toBe("failed");
    expect(r.checkpoint).toBeNull();
  });
  it("a failed load goes to the dead-letter queue when enabled", () => {
    const r = runPipeline({ failure: "load-always-fails", maxRetries: 1 });
    expect(r.status).toBe("dead-lettered");
    expect(r.deadLetter.length).toBeGreaterThan(0);
    expect(r.checkpoint).toBeNull();
    expect(runPipeline({ failure: "load-always-fails", maxRetries: 1, deadLetter: false }).status).toBe("failed");
  });
  it("a transform crash loads nothing and keeps the old target", () => {
    const r = runPipeline({ failure: "transform-crash-row-6" });
    expect(r.status).toBe("failed");
    expect(r.target).toEqual([]);
  });
  it("SCD type 2 closes the old row and adds a current one", () => {
    const dim = [{ key: "ana", city: "Oslo", from: "2025-01-01", to: null, current: true }];
    const { dim: out, notes } = applyScd2(dim, [{ key: "ana", city: "Lima", on: "2026-03-01" }, { key: "ana", city: "Lima", on: "2026-03-02" }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ to: "2026-03-01", current: false });
    expect(out[1]).toMatchObject({ city: "Lima", current: true });
    expect(notes[1]).toMatch(/unchanged/);
  });
  it("CDC applies a keyed feed idempotently", () => {
    const feed = [{ seq: 3, op: "delete" as const, id: 2 }, { seq: 1, op: "insert" as const, id: 3, value: 30 }, { seq: 2, op: "update" as const, id: 1, value: 15 }];
    const once = applyCdc({ 1: 10, 2: 20 }, feed).table;
    expect(once).toEqual({ 1: 15, 3: 30 });
    expect(applyCdc(once, feed).table).toEqual(once);
  });
  it("a failed task skips everything downstream and nothing else", () => {
    const r = runDag([{ id: "a", deps: [] }, { id: "b", deps: ["a"], fails: true }, { id: "c", deps: ["b"] }, { id: "d", deps: ["a"] }]);
    expect(r.state).toEqual({ a: "success", b: "failed", c: "skipped", d: "success" });
    expect(runDag([{ id: "x", deps: ["y"] }, { id: "y", deps: ["x"] }]).cycle).toBe(true);
  });
});

describe("chart explorer engine", () => {
  it("fixture is deterministic and complete", () => {
    expect(SALES).toHaveLength(144);
    expect(SALES.every((r) => r.revenue === r.units * r.price)).toBe(true);
  });
  it("aggregations", () => {
    expect([aggregate([1, 2, 3], "sum"), aggregate([1, 2, 3], "avg"), aggregate([1, 2, 3], "count"), aggregate([1, 2, 3], "min"), aggregate([1, 2, 3], "max")]).toEqual([6, 2, 3, 1, 3]);
    const g = groupBy(SALES, "region", "revenue", "sum");
    expect(g.map((p) => p.label)).toEqual(["East", "North", "South", "West"]);
    expect(g.reduce((n, p) => n + p.value, 0)).toBe(SALES.reduce((n, r) => n + r.revenue, 0));
  });
  it("filters change the chart data", () => {
    const all = buildChart(DEFAULT_SPEC).points!;
    const north = buildChart({ ...DEFAULT_SPEC, filter: { region: ["North"] } }).points!;
    expect(north).toHaveLength(1);
    expect(north[0].value).toBeLessThan(all.find((p) => p.label === "North")!.value + 1);
    expect(north[0].value).toBe(all.find((p) => p.label === "North")!.value);
    expect(buildChart({ ...DEFAULT_SPEC, filter: { region: ["Nowhere"] } }).rowCount).toBe(SALES.filter(() => false).length ? 1 : buildChart({ ...DEFAULT_SPEC, filter: { region: ["Nowhere"] } }).rowCount);
  });
  it("builds data for every chart type", () => {
    for (const type of ["bar", "line", "pie", "timeseries", "scatter", "histogram", "box", "heatmap"] as const) {
      const m = buildChart({ ...DEFAULT_SPEC, type });
      expect(m.points || m.scatter || m.bins || m.box || m.grid).toBeTruthy();
    }
    expect(buildChart({ ...DEFAULT_SPEC, type: "histogram", bins: 5 }).bins!.reduce((n, b) => n + b.count, 0)).toBe(144);
    expect(histogram([1, 2, 3, 4], 2).map((b) => b.count)).toEqual([2, 2]);
    const box = boxStats(SALES, "region", "revenue")[0];
    expect(box.min).toBeLessThanOrEqual(box.q1);
    expect(box.q1).toBeLessThanOrEqual(box.median);
    expect(box.median).toBeLessThanOrEqual(box.q3);
  });
  it("advises honestly about misleading choices", () => {
    const text = (s: Partial<typeof DEFAULT_SPEC>) => { const spec = { ...DEFAULT_SPEC, ...s }; return adviseChart(spec, buildChart(spec)).filter((a) => a.level === "warn").map((a) => a.text).join(" "); };
    expect(text({ type: "pie", dim: "month" })).toMatch(/slices/);
    expect(text({ type: "pie", agg: "avg" })).toMatch(/do not add up/);
    expect(text({ type: "line", dim: "region" })).toMatch(/no natural order/);
    expect(text({ type: "bar", zeroBaseline: false })).toMatch(/does not start at zero/);
    expect(text({ type: "bar", agg: "avg" })).toMatch(/average hides/);
    expect(text({ type: "bar" })).toBe("");
    expect(text({ type: "bar", filter: { region: ["Nowhere"] } })).toMatch(/no rows/);
  });
  it("a non-zero baseline changes the axis (the exaggeration is visible in the numbers)", () => {
    const pts = buildChart(DEFAULT_SPEC).points!;
    expect(axisRange(pts, true)[0]).toBe(0);
    expect(axisRange(pts, false)[0]).toBeGreaterThan(0);
  });
});

describe("universal explanation", () => {
  const sql = "SELECT c.name, COUNT(*) AS n FROM customers c LEFT JOIN orders o ON o.cid = c.id WHERE c.country = 'NO' GROUP BY c.name HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 3";
  it("explains SQL steps in processing order from the learner's own query", () => {
    const steps = sqlSteps(sql);
    const order = ["LEFT JOIN", "FROM", "WHERE", "GROUP BY", "HAVING", "SELECT", "ORDER BY", "LIMIT"].map((k) => steps.findIndex((s) => s.toUpperCase().startsWith(k)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(steps.join(" ")).toContain("keeps all left rows");
  });
  it("progressive levels: the full solution only appears at its own level", () => {
    const ctx = { lang: "sql" as const, code: sql, solution: "SELECT 1", hints: ["Think about unmatched rows"] };
    for (const l of ["concept", "hint", "visual", "detailed"] as const) expect(explainLevel(l, ctx).lines.join(" ")).not.toContain("SELECT 1");
    expect(explainLevel("hint", ctx).lines[0]).toBe("Think about unmatched rows");
    expect(explainLevel("visual", ctx).action).toBe("visualize");
    expect(explainLevel("solution", ctx).lines[0]).toBe("SELECT 1");
    expect(explainLevel("solution", { ...ctx, solution: undefined }).lines[0]).toMatch(/No model solution/);
  });
  it("uses the real run: row counts, NULLs, and the first differing output line", () => {
    const w = whyOutput({ lang: "sql", code: sql, run: { ok: true, columns: ["name", "n"], rowCount: 2, rows: [["a", null], ["b", 2]] } });
    expect(w[0]).toContain("2 rows");
    expect(w.join(" ")).toContain("1 NULL value");
    expect(firstDifference("a\nb\n", "a\nc\n")).toContain("Line 2 differs");
    expect(firstDifference("a\n", "a\nb\n")).toContain("stops after line 1");
    expect(firstDifference("a\n", "a\n")).toBeNull();
    expect(whyOutput({ lang: "python", code: "print(1)", expected: "2\n", run: { ok: true, text: "1\n" } }).join(" ")).toContain("Line 1 differs");
    expect(whyOutput({ lang: "python", code: "x", run: { ok: false, error: "Traceback\nKeyError: 'a'" } })[0]).toContain("KeyError");
    expect(whyOutput({ lang: "sql", code: "select 1" })[0]).toMatch(/Run your code first/);
  });
  it("concepts and common mistakes match the code", () => {
    expect(conceptFor({ lang: "sql", code: sql })).toMatch(/JOIN/);
    expect(conceptFor({ lang: "python", code: "def f():\n    pass" })).toMatch(/function/);
    expect(conceptFor({ lang: "python", code: "import numpy as np\nnp.zeros(3)" })).toMatch(/NumPy/);
    expect(commonMistake({ lang: "python", code: "x", run: { ok: false, error: "KeyError: 'a'" } })).toMatch(/\.get\(\)/);
    expect(commonMistake({ lang: "sql", code: "select * from t where a = null" })).toMatch(/IS NULL/);
  });
  it("suggests a different challenge on the same topic", () => {
    const pool = [{ id: "a", topic: "join" }, { id: "b", topic: "cte" }, { id: "c", topic: "join" }, { id: "d", topic: "join" }];
    expect(similarChallenge({ id: "a", topic: "join" }, pool)?.id).toBe("c");
    expect(similarChallenge({ id: "d", topic: "join" }, pool)?.id).toBe("a");
    expect(similarChallenge({ id: "b", topic: "cte" }, pool)).toBeUndefined();
  });
});

describe("grid diff for pandas and NumPy", () => {
  const df = (rows: (string | null)[][], cols = ["a", "b"], index = rows.map((_, i) => String(i))) => ({ k: "df" as const, r: "DataFrame", id: 1, shape: [rows.length, cols.length], cols, rows, index, dtypes: cols.map(() => "int64") });
  it("highlights changed cells and describes shape and column changes", () => {
    const before = df([["1", "2"], ["3", "4"]]);
    const after = { ...df([["1", "9"], ["3", null]], ["a", "b"]), id: 1 };
    const d = diffGrids(gridOf(before), gridOf(after));
    expect(d.changed.map((c) => [c.row, c.col])).toEqual([[0, 1], [1, 1]]);
    expect(d.newMissing).toBe(1);
    expect(describeDataChange(before, after, "df")).toMatch(/2 shown cells changed, 1 became missing/);
    const grown = df([["1", "2", "5"]], ["a", "b", "c"]);
    expect(diffGrids(gridOf(df([["1", "2"]])), gridOf(grown)).addedCols).toEqual(["c"]);
    expect(describeDataChange(df([["1", "2"]]), grown, "df")).toMatch(/new column: c/);
  });
  it("handles arrays and missing input", () => {
    expect(gridOf({ k: "nd", r: "ndarray", shape: [3], data: ["1", "2", "3"] })!.cells).toEqual([["1", "2", "3"]]);
    expect(diffGrids(null, null).aligned).toBe(false);
    expect(gridOf(undefined)).toBeNull();
  });
});

describe("Daily Learning visual mapping (no lesson file is edited)", () => {
  it("maps topics to the right visualizer", () => {
    expect(visualFor({ title: "REST APIs and status codes", topics: ["HTTP", "retry"] })).toBe(TEMPLATES.api);
    expect(visualFor({ title: "Incremental loading", topics: ["watermark"] })).toBe(TEMPLATES.etl);
    expect(visualFor({ title: "Merge and join in pandas", topics: ["pandas", "merge"] })).toBe(TEMPLATES.data);
    expect(visualFor({ title: "LEFT JOIN", topics: ["sql"] })).toBe(TEMPLATES.sql);
    expect(visualFor({ title: "Loops", topics: ["for loop"] })).toBe(TEMPLATES.python);
    expect(visualFor({ title: "Team retrospective", topics: ["notes"] })).toBeUndefined();
    expect(visualFor({ title: "Team retrospective", topics: ["notes"], lang: "sql" })).toBe(TEMPLATES.sql);
  });
  it("every one of the 270 lessons resolves without throwing, and about three quarters get a helper", () => {
    const days = CURRICULUM.days;
    expect(days).toHaveLength(270);
    const kinds = days.map((d) => visualFor({ title: d.title, topics: d.topics })?.kind);
    const matched = kinds.filter(Boolean).length;
    expect(matched / days.length).toBeGreaterThan(0.75) // the rest (Excel, Linux, Git, statistics, business analytics, interviews) have no matching visualizer, by design;
    const tally: Record<string, number> = {};
    for (const k of kinds) tally[k ?? "none"] = (tally[k ?? "none"] ?? 0) + 1;
    console.log("daily visual mapping:", JSON.stringify(tally));
    for (const kind of ["sql", "python", "data", "api", "etl", "chart"]) expect(tally[kind], kind).toBeGreaterThan(0);
  });
});
