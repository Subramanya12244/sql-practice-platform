import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clearLocalData, dataSink, mergeById, mergeProject, pickRules, projectToRows, setDataSink, startDataSync, type ProjectRow } from "../site/lib/dataSync";
import { addSession, getSessions } from "../site/lib/vizHistory";
import { getProjectProgress } from "../site/lib/projects";
import { getRules, getRuns, saveRun } from "../site/lib/dataQuality";

describe("merge rules", () => {
  it("unions lists by id, newest first, capped", () => {
    const a = { id: "a", at: "2026-01-01" }, b = { id: "b", at: "2026-01-03" }, c = { id: "c", at: "2026-01-02" };
    expect(mergeById([a, b], [b, c], 2).map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("keeps a pass from either side and ORs checklist ticks", () => {
    const local = { tasks: { t1: { passed: false, at: "2026-02-02" }, t2: { passed: true, at: "2026-01-01" } }, checklist: { m: [true, false] } };
    const rows: ProjectRow[] = [
      { project_slug: "p", task_id: "t1", passed: true, code: "select 1", message: null, updated_at: "2026-01-01" },
      { project_slug: "p", task_id: "t2", passed: false, code: null, message: null, updated_at: "2026-03-01" },
      { project_slug: "p", task_id: "checklist:m", passed: false, code: "[false,false,true]", message: null, updated_at: "2026-01-01" },
    ];
    const m = mergeProject(local, rows, [{ project_slug: "p", repo_url: "https://github.com/a/b", notes: null, checklist: {}, created_at: "2026-04-01" }]);
    expect(m.tasks.t1.passed).toBe(true);
    expect(m.tasks.t2.passed).toBe(true);
    expect(m.checklist.m).toEqual([true, false, true]);
    expect(m.submission?.url).toBe("https://github.com/a/b");
    expect(projectToRows("p", m).find((r) => r.task_id === "checklist:m")?.passed).toBe(false);
  });

  it("takes the most recently saved rule set", () => {
    const r = { id: "r", name: "n", type: "not_null" as const, table: "t" };
    const remote = [{ dataset: "d", rule: { ...r, name: "remote" }, created_at: "2026-02-01" }];
    expect(pickRules([r], "2026-03-01", remote)).toEqual({ rules: [r], push: true });
    expect(pickRules([r], "2026-01-01", remote).rules?.[0].name).toBe("remote");
    expect(pickRules(null, null, remote).push).toBe(false);
    expect(pickRules([r], null, [])).toEqual({ rules: [r], push: true });
  });
});

/** Minimal fake of the supabase query builder: records writes, returns canned rows. */
function fakeClient(tables: Record<string, unknown[]>, missing: string[] = []) {
  const writes: { table: string; op: string; rows: unknown }[] = [];
  const builder = (table: string) => {
    const result = missing.includes(table) ? { data: null, error: { message: "relation does not exist" } } : { data: tables[table] ?? [], error: null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
    q.then = (res: (v: unknown) => void) => res(result);
    for (const op of ["insert", "upsert", "delete"]) {
      q[op] = (rows?: unknown) => {
        writes.push({ table, op, rows });
        return q;
      };
    }
    return q;
  };
  return { sb: { from: builder } as unknown as SupabaseClient, writes };
}

describe("sign-in sync", () => {
  beforeEach(() => {
    localStorage.clear();
    setDataSink(null);
  });

  it("merges the account copy into the browser and pushes only what the account lacks", async () => {
    const local = addSession("q25", { sql: "select 1", attempt: 1, dataset: "northwind", structure: "SELECT", stages: [] });
    saveRun("northwind", { id: "run-local", at: "2026-05-01T00:00:00Z", dataset: "northwind", score: 90, results: [] });
    const { sb, writes } = fakeClient({
      query_visualization_sessions: [{ id: "remote-1", question_key: "q25", attempt: 2, dataset: "northwind", executed_sql: "select 2", structure: null, stages: [], plan_root: null, plan_cost: null, volatile: null, created_at: "2026-01-01T00:00:00Z" }],
      project_progress: [{ project_slug: "sales", task_id: "t1", passed: true, code: "select 1", message: null, updated_at: "2026-01-01" }],
      data_quality_rules: [{ dataset: "northwind", rule: { id: "r1", name: "x", type: "not_null", table: "orders" }, created_at: "2026-01-01" }],
      data_quality_runs: [{ id: "run-remote", dataset: "northwind", score: 70, results: [], created_at: "2026-04-01T00:00:00Z" }],
    });
    await startDataSync(sb, "u1");

    expect(getSessions("q25").map((s) => s.id).sort()).toEqual([local.id, "remote-1"].sort());
    expect(getProjectProgress("sales").tasks.t1.passed).toBe(true);
    expect(getRules("northwind")?.[0].id).toBe("r1");
    expect(getRuns("northwind").map((r) => r.id)).toEqual(["run-local", "run-remote"]);

    const vizInsert = writes.find((w) => w.table === "query_visualization_sessions" && w.op === "insert");
    expect((vizInsert?.rows as { id: string; user_id: string }[]).map((r) => [r.id, r.user_id])).toEqual([[local.id, "u1"]]);
    const runInsert = writes.find((w) => w.table === "data_quality_runs");
    expect((runInsert?.rows as { id: string }[]).map((r) => r.id)).toEqual(["run-local"]);
    expect(writes.some((w) => w.table === "data_quality_rules")).toBe(false);
    expect(dataSink()).not.toBeNull();
  });

  it("still signs in when migration 003 is not applied", async () => {
    addSession("q1", { sql: "select 1", attempt: 1, dataset: "northwind", structure: "SELECT", stages: [] });
    const { sb, writes } = fakeClient({}, ["query_visualization_sessions", "project_progress", "project_submissions", "data_quality_rules", "data_quality_runs"]);
    await startDataSync(sb, "u1");
    expect(writes).toEqual([]);
    expect(getSessions("q1")).toHaveLength(1);
  });

  it("mirrors new writes once signed in and clears the browser copy on sign-out", async () => {
    const { sb, writes } = fakeClient({});
    await startDataSync(sb, "u1");
    addSession("q2", { sql: "select 3", attempt: 1, dataset: "northwind", structure: "SELECT", stages: [] });
    expect(writes.filter((w) => w.table === "query_visualization_sessions")).toHaveLength(1);
    clearLocalData();
    expect(getSessions("q2")).toEqual([]);
  });
});
