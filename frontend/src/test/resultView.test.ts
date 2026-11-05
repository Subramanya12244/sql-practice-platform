import { describe, expect, it } from "vitest";
import { applyResultView, compareCells, nextSort } from "../utils/resultView";

const rows = [["b", 10, null], ["a", 2, "x"], ["c", null, "y"], ["A2", 33, "z"]];
describe("result grid sort and filter", () => {
  it("sorts numbers numerically, text naturally, NULLs last both ways", () => {
    expect(applyResultView(rows, { sortCol: 1, dir: "asc", filter: "" }).map((r) => r[1])).toEqual([2, 10, 33, null]);
    expect(applyResultView(rows, { sortCol: 1, dir: "desc", filter: "" }).map((r) => r[1])).toEqual([33, 10, 2, null]);
    expect(applyResultView(rows, { sortCol: 0, dir: "asc", filter: "" }).map((r) => r[0])).toEqual(["a", "A2", "b", "c"]);
    expect(compareCells("9", "10")).toBeLessThan(0);
  });
  it("filters across all cells, including NULL as text, without changing the input", () => {
    expect(applyResultView(rows, { sortCol: null, dir: "asc", filter: "null" }).map((r) => r[0])).toEqual(["b", "c"]);
    expect(applyResultView(rows, { sortCol: null, dir: "asc", filter: "Y" })).toEqual([["c", null, "y"]]);
    expect(rows[0][0]).toBe("b");
  });
  it("cycles header clicks asc → desc → off", () => {
    let v = { sortCol: null as number | null, dir: "asc" as const, filter: "" };
    v = nextSort(v, 2) as typeof v; expect(v).toMatchObject({ sortCol: 2, dir: "asc" });
    const d = nextSort(v, 2); expect(d).toMatchObject({ sortCol: 2, dir: "desc" });
    expect(nextSort(d, 2)).toMatchObject({ sortCol: null });
  });
});

import { errorPositionFromMessage } from "../site/lib/sqlRunner";
describe("SQL error position fallback", () => {
  it("finds a uniquely named identifier and refuses ambiguous ones", () => {
    expect(errorPositionFromMessage("SELECT company_nam FROM customers;", 'column "company_nam" does not exist')).toBe(8);
    expect(errorPositionFromMessage("SELECT x, x FROM t", 'column "x" does not exist')).toBeNull();
    expect(errorPositionFromMessage("SELECT 1", "syntax error at end of input")).toBeNull();
    expect(errorPositionFromMessage("SELECT a.idx FROM a", 'column "id" does not exist')).toBeNull();
  });
});
