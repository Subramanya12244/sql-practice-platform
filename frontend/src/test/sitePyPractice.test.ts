import { describe, expect, it } from "vitest";
import { countingHarness, readCounts, runPythonTask } from "../site/lib/tasks";
import { feedbackFor, filterExercises, overview, splitHints } from "../site/lib/pyPractice";
import type { PyExerciseMeta } from "../site/lib/pyExercises";

describe("python practice helpers", () => {
  it("counting harness reports per-test results and keeps hidden sources out", () => {
    const h = countingHarness([{ name: "visible", src: "x = 1\nassert x == 1\nassert x == 2" }, { name: "hidden", src: "assert x == 3" }]);
    expect(h).toContain("__DF_TESTS__");
    const { stdout, counts } = readCounts('hi\n__DF_TESTS__{"visible":{"passed":1,"total":2,"failures":[{"test":"assert x == 2","error":"AssertionError: "}]}}\n');
    expect(stdout).toBe("hi\n");
    expect(counts?.visible.total).toBe(2);
  });
  it("passes counts through runPythonTask and keeps old messages", async () => {
    const out = '__DF_TESTS__{"visible":{"passed":0,"total":1,"failures":[]}}\n';
    const r = await runPythonTask({ id: "a", title: "", type: "python", instructions: "", starter: "", solution: "", tests: "assert f()" }, "x",
      async () => ({ ok: false, stdout: out, phase: "tests", error: "AssertionError: expected 1", ms: 1 }), { count: true });
    expect(r.message).toBe("A test failed: expected 1");
    expect(r.counts?.visible.total).toBe(1);
  });
  it("splits hints out of the body", () => {
    const { body, hints } = splitHints("## Problem\n\nDo it.\n\n## Hints\n\n- one\n- two\n\n## Why it matters\n\nBecause.");
    expect(hints).toEqual(["one", "two"]);
    expect(body).not.toContain("## Hints");
    expect(body).toContain("Why it matters");
  });
  it("gives rule-based feedback", () => {
    expect(feedbackFor("Your code raised an error: KeyError: 'id'")).toMatch(/\.get/);
    expect(feedbackFor("Passes the visible tests but fails a hidden test.")).toMatch(/edge|empty/i);
    expect(feedbackFor("fine")).toBeNull();
  });
  it("filters and summarises by category with accuracy", () => {
    const m = (slug: string, category: string, difficulty = "Easy") => ({ slug, title: slug, difficulty, description: "", topic: "", minutes: 5, code: "", concepts: [], category, skill: "validation", time: "", space: "" }) as PyExerciseMeta;
    const all = [m("a", "etl"), m("b", "etl", "Hard"), m("c", "files")];
    const stats = { a: { attempts: 4, passes: 1, lastAt: "2026-01-02", lastOk: true }, b: { attempts: 2, passes: 0, lastAt: "2026-01-03", lastOk: false } };
    const done = { "py:a": "2026-01-02" };
    expect(filterExercises(all, { q: "", difficulty: "", category: "etl", skill: "", status: "attempted" }, done, stats).map((e) => e.slug)).toEqual(["b"]);
    const o = overview(all, done, stats);
    expect(o.categories.find((c) => c.key === "etl")).toMatchObject({ total: 2, solved: 1, attempts: 6, passes: 1 });
    expect(o.revise.map((e) => e.slug)).toEqual(["a", "b"]);
    expect(o.recent[0].ex.slug).toBe("b");
  });
});
