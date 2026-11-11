import { describe, expect, it, vi } from "vitest";

// A stand-in for the browser database that behaves like the real one: querying a dataset nobody registered fails.
const registered = new Set<string>();
const calls: string[] = [];
vi.mock("../site/lib/browserDb", () => ({
  registerDataset: (src: { id: string }) => { registered.add(src.id); calls.push(`register:${src.id}`); },
  runQuery: async (_sql: string, dataset: string) => {
    calls.push(`query:${dataset}`);
    if (!registered.has(dataset)) throw new Error(`Unknown dataset "${dataset}"`);
    return { success: true, columns: ["x"], rows: [[1]] };
  },
}));
import { exerciseDataset, runExerciseQuery } from "../site/lib/lab/guided";
import { DE_SCENARIOS } from "../site/lib/lab/deContent";

describe("guided exercises query their own dataset", () => {
  it("registers the dataset before the first query, even if no mount effect has run yet", async () => {
    const e = DE_SCENARIOS[0];
    expect(registered.has(exerciseDataset(e))).toBe(false); // nothing registered by any page effect
    const r = await runExerciseQuery(e, "SELECT 1");
    expect(r.success).toBe(true);
    expect(calls.slice(0, 2)).toEqual([`register:guided-${e.id}`, `query:guided-${e.id}`]);
  });
  it("registering again for later queries is harmless", async () => {
    const e = DE_SCENARIOS[0];
    await runExerciseQuery(e, "SELECT 1");
    await runExerciseQuery(e, "SELECT 2");
    expect(calls.filter((c) => c.startsWith("query:")).length).toBeGreaterThanOrEqual(3);
  });
});
