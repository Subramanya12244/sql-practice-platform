import { describe, expect, it } from "vitest";
import { CONCEPTS, PRESET_DAG, attemptFails, executeRun, order, retryFailed, scheduledDates, simulate, validateDag, type Dag, type DagTask } from "../site/lib/lab/dag";

const task = (id: string, o: Partial<DagTask> = {}): DagTask => ({ id, name: id, deps: [], retries: 0, retryDelayMin: 0, durationMin: 5, behavior: { kind: "succeed" }, ...o });
const dag = (tasks: DagTask[], o: Partial<Dag> = {}): Dag => ({ id: "d", name: "d", schedule: "manual", startDate: "2026-11-01", catchup: false, tasks, ...o });

describe("validation and ordering", () => {
  it("accepts the preset and orders it by dependency", () => {
    expect(validateDag(PRESET_DAG)).toEqual([]);
    expect(order(PRESET_DAG)).toEqual(["extract", "clean", "transform", "validate", "load"]);
  });
  it("explains every kind of mistake", () => {
    expect(validateDag(dag([]))).toEqual(["Add at least one task."]);
    expect(validateDag(dag([task("a"), task("a")])).join()).toMatch(/same id/);
    expect(validateDag(dag([task("a", { deps: ["zzz"] })])).join()).toMatch(/does not exist/);
    expect(validateDag(dag([task("a", { deps: ["a"] })])).join()).toMatch(/cannot depend on itself/);
    expect(validateDag(dag([task("a", { retries: 9 })])).join()).toMatch(/retries must be between 0 and 5/);
    expect(validateDag(dag([task("a", { durationMin: 0 })])).join()).toMatch(/at least 1 minute/);
    expect(validateDag(dag([task("a", { name: " " })])).join()).toMatch(/needs a name/);
    expect(validateDag(dag([task("a", { deps: ["b"] }), task("b", { deps: ["a"] })])).join()).toMatch(/circle/);
  });
});

describe("a single run on the virtual clock", () => {
  it("runs tasks in order; each starts when its dependencies end; parallel branches overlap", () => {
    const r = executeRun(dag([task("a", { durationMin: 5 }), task("b", { deps: ["a"], durationMin: 10 }), task("c", { deps: ["a"], durationMin: 3 }), task("d", { deps: ["b", "c"], durationMin: 2 })]), 0, "2026-11-01");
    expect(r.state).toBe("success");
    expect(r.tasks.b.attempts[0]).toMatchObject({ startMin: 5, endMin: 15 });
    expect(r.tasks.c.attempts[0]).toMatchObject({ startMin: 5, endMin: 8 }); // overlaps with b
    expect(r.tasks.d.attempts[0].startMin).toBe(15); // waits for the slower branch
    expect(r.endMin).toBe(17);
  });
  it("retries with a delay, and says what it is doing in Airflow's words", () => {
    const r = executeRun(dag([task("flaky", { retries: 2, retryDelayMin: 4, behavior: { kind: "fail-times", times: 2 } })]), 0, "2026-11-01");
    const a = r.tasks.flaky.attempts;
    expect(r.tasks.flaky.state).toBe("success");
    expect(a.map((x) => [x.number, x.ok, x.startMin])).toEqual([[1, false, 0], [2, false, 9], [3, true, 18]]); // 5 min work + 4 min delay each
    expect(r.logs.join("\n")).toMatch(/starting attempt 1 of 3/);
    expect(r.logs.join("\n")).toMatch(/UP_FOR_RETRY \(retry_delay=4m\)/);
    expect(r.logs.join("\n")).toMatch(/marking it SUCCESS/);
  });
  it("runs out of retries: FAILED, downstream upstream_failed and never started", () => {
    const r = executeRun(dag([task("a", { retries: 1, behavior: { kind: "always-fail" } }), task("b", { deps: ["a"] }), task("c", { deps: ["b"] })]), 0, "2026-11-01");
    expect(r.state).toBe("failed");
    expect(r.tasks.a).toMatchObject({ state: "failed" });
    expect(r.tasks.a.attempts).toHaveLength(2);
    expect(r.tasks.b).toMatchObject({ state: "upstream_failed", attempts: [] });
    expect(r.tasks.c.state).toBe("upstream_failed");
    expect(r.logs.join("\n")).toMatch(/no retries are left, marking it FAILED/);
    expect(r.logs.join("\n")).toMatch(/upstream_failed and does not run/);
  });
  it("behaviours: fail-times, always-fail, fail-on-runs", () => {
    expect([1, 2, 3].map((n) => attemptFails({ kind: "fail-times", times: 2 }, n, 0))).toEqual([true, true, false]);
    expect(attemptFails({ kind: "always-fail" }, 99, 5)).toBe(true);
    expect([0, 1, 2].map((i) => attemptFails({ kind: "fail-on-runs", runs: [1] }, 1, i))).toEqual([false, true, false]);
    expect(attemptFails({ kind: "succeed" }, 1, 0)).toBe(false);
  });
});

describe("schedules", () => {
  it("manual DAGs have no scheduled runs; daily without catchup runs only the latest interval", () => {
    expect(scheduledDates({ schedule: "manual", startDate: "2026-11-01", catchup: true }, "2026-11-10")).toEqual([]);
    expect(scheduledDates({ schedule: "@daily", startDate: "2026-11-01", catchup: false }, "2026-11-05")).toEqual(["2026-11-04"]);
  });
  it("catchup creates a run for every missed interval (capped), weekly steps by 7 days, nothing before the start", () => {
    expect(scheduledDates({ schedule: "@daily", startDate: "2026-11-01", catchup: true }, "2026-11-05")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(scheduledDates({ schedule: "@weekly", startDate: "2026-10-01", catchup: true }, "2026-11-01")).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
    expect(scheduledDates({ schedule: "@daily", startDate: "2026-11-10", catchup: true }, "2026-11-05")).toEqual([]);
    expect(scheduledDates({ schedule: "@hourly", startDate: "2026-11-01", catchup: true }, "2026-11-02", 3)).toHaveLength(3);
    expect(scheduledDates({ schedule: "@daily", startDate: "2025-01-01", catchup: true }, "2026-11-05", 14)).toHaveLength(14);
  });
  it("simulate gives each run its own index, so a bad-day behaviour hits only that run", () => {
    const d = dag([task("a"), task("b", { deps: ["a"], behavior: { kind: "fail-on-runs", runs: [1] } })], { schedule: "@daily", catchup: true });
    const runs = simulate(d, "2026-11-04");
    expect(runs.map((r) => r.state)).toEqual(["success", "failed", "success"]);
    expect(simulate(dag([task("a")]), "2026-11-04")).toHaveLength(1); // manual: one run
  });
});

describe("retrying failed tasks", () => {
  it("clears the failed task and everything after it, keeps finished work, and counts attempts on", () => {
    const d = dag([task("a"), task("b", { deps: ["a"], retries: 0, behavior: { kind: "fail-times", times: 1 } }), task("c", { deps: ["b"] })]);
    const first = executeRun(d, 0, "2026-11-01");
    expect(first.state).toBe("failed");
    const again = retryFailed(d, first);
    expect(again.state).toBe("success");
    expect(again.tasks.a).toBe(first.tasks.a); // untouched, not re-run
    expect(again.tasks.b.attempts.map((x) => [x.number, x.ok])).toEqual([[1, false], [2, true]]);
    expect(again.tasks.c.state).toBe("success");
    expect(again.logs.join("\n")).toMatch(/cleared b, c and everything after it/);
  });
  it("an always-failing task fails again until the cause is fixed in the DAG", () => {
    const broken = dag([task("a", { behavior: { kind: "always-fail" } }), task("b", { deps: ["a"] })]);
    const first = executeRun(broken, 0, "2026-11-01");
    expect(retryFailed(broken, first).state).toBe("failed");
    const fixed = dag([task("a"), task("b", { deps: ["a"] })]);
    const after = retryFailed(fixed, first);
    expect(after.state).toBe("success");
    expect(after.tasks.a.attempts.map((x) => x.ok)).toEqual([false, true]);
  });
  it("a successful run is returned unchanged", () => {
    const d = dag([task("a")]);
    const r = executeRun(d, 0, "2026-11-01");
    expect(retryFailed(d, r)).toBe(r);
  });
  it("the preset tells a story: extract flakes and recovers, validate fails the first run, a retry cannot fix bad data", () => {
    const [first] = simulate({ ...PRESET_DAG, catchup: true }, "2026-11-03");
    expect(first.tasks.extract.attempts.map((x) => x.ok)).toEqual([false, true]);
    expect(first.tasks.validate.state).toBe("failed");
    expect(first.tasks.load.state).toBe("upstream_failed");
    expect(retryFailed(PRESET_DAG, first).state).toBe("failed"); // fail-on-runs: run 0 is bad data
  });
});

it("explains the Airflow concepts it borrows", () => {
  expect(CONCEPTS.map((c) => c.airflow)).toEqual(expect.arrayContaining(["DAG", "retries, retry_delay", "catchup", "upstream_failed", "Clear task"]));
});
