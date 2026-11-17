import { describe, expect, it } from "vitest";
import { ProfileError, headerNames, histogram, inferType, isMissing, issuesOf, numberStats, profileCsv, reportMarkdown } from "../site/lib/csvProfile";
import { SAMPLE_CSV } from "../site/pages/DataProfilerPage";

describe("type inference", () => {
  it("names the type that fits at least 90% of the values and reports the rest as invalid", () => {
    expect(inferType(["1", "2", "3"])).toMatchObject({ type: "integer", invalid: [] });
    expect(inferType(["1", "2.5", "3"])).toMatchObject({ type: "decimal" });
    expect(inferType(["2026-01-05", "2026-02-10"])).toMatchObject({ type: "date" });
    expect(inferType(["true", "no", "T"])).toMatchObject({ type: "boolean" });
    const nine = [...Array(9).fill("1"), "x"];
    expect(inferType(nine)).toEqual({ type: "integer", invalid: ["x"] });
  });
  it("an impossible calendar date is not a date", () => {
    expect(inferType(["2026-02-30", "2026-13-01"]).type).toBe("text");
  });
  it("mixed formats are flagged rather than hidden", () => {
    const r = inferType(["2026-01-05", "2026-01-06", "01/07/2026", "01/08/2026"]);
    expect(r.type).toBe("text");
    expect(r.mixed).toMatchObject({ type: "date", share: 0.5 });
  });
  it("treats the usual missing markers as missing", () => {
    for (const m of ["", " ", "NULL", "n/a", "NaN", "-", "None"]) expect(isMissing(m), m).toBe(true);
    for (const m of ["0", "false", "no"]) expect(isMissing(m), m).toBe(false);
  });
});

describe("numbers", () => {
  it("computes quartiles, the IQR fences and the outliers", () => {
    const s = numberStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])!;
    expect(s.median).toBe(5.5);
    expect(s.q1).toBe(3.25);
    expect(s.q3).toBe(7.75);
    expect(s.outliers).toBe(1);
    expect(s.max).toBe(100);
  });
  it("a histogram counts every value exactly once", () => {
    const v = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
    const h = histogram(v);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(v.length);
    expect(histogram([7, 7, 7])).toEqual([{ from: 7, to: 7, count: 3 }]);
    expect(histogram([])).toEqual([]);
  });
});

describe("profiling a CSV", () => {
  const p = profileCsv("id,name,score\n1,Ada,10\n2,Bo,\n2,Bo,\n3,,abc\n4,Cy,12");
  it("counts rows, columns, duplicates and missing cells exactly", () => {
    expect(p.rows).toBe(5);
    expect(p.columns.map((c) => c.name)).toEqual(["id", "name", "score"]);
    expect(p.duplicateRows).toBe(1);
    expect(p.missingCells).toBe(1 + 2 + 0); // name: 1 blank; score: 2 blank
  });
  it("per column: type, missing, distinct, invalid and key candidates", () => {
    const [id, name, score] = p.columns;
    expect([id.type, id.missing, id.distinct, id.unique]).toEqual(["integer", 0, 4, false]);
    expect([name.type, name.missing, name.distinct]).toEqual(["text", 1, 3]);
    expect(score.missing).toBe(2);
    expect(score.type).toBe("text"); // 2 of 3 values are numbers: below the 90% bar, so mixed
    expect(score.mixed?.type).toBe("integer");
  });
  it("finds a key column only when every value is present and different", () => {
    const k = profileCsv("a,b\n1,x\n2,x\n3,y");
    expect(k.columns.map((c) => c.unique)).toEqual([true, false]);
  });
  it("every finding states a count that the profile contains", () => {
    const text = issuesOf(p).map((i) => i.text).join("\n");
    expect(text).toContain("1 duplicate row");
    expect(text).toContain("1 of 5 values missing in name");
    expect(text).toContain("2 of 5 values missing in score");
  });
  it("rejects input with nothing to profile, and duplicate headers", () => {
    expect(() => profileCsv("")).toThrow(ProfileError);
    expect(() => profileCsv("a,b\n")).toThrow(/No data rows/);
    expect(() => profileCsv("a,a\n1,2")).toThrow(/same name/);
  });
  it("reads the header as written, including quotes, and skips leading blank lines", () => {
    expect(headerNames('id,"first, last",note\n1,a,b')).toEqual(["id", "first, last", "note"]);
    expect(headerNames("\n\na,b\n1,2")).toEqual(["a", "b"]);
  });
  it("handles quoted commas and newlines", () => {
    const q = profileCsv('id,note\n1,"a, b"\n2,"line1\nline2"');
    expect(q.rows).toBe(2);
    expect(q.columns[1].distinct).toBe(2);
  });
});

describe("the built-in sample", () => {
  const p = profileCsv(SAMPLE_CSV);
  it("has the problems it was written to show, and the profiler finds each one", () => {
    expect(p.rows).toBe(11);
    expect(p.duplicateRows).toBe(1);
    const text = issuesOf(p).map((i) => i.text).join("\n");
    expect(text).toMatch(/1 of 11 values missing in amount/);
    expect(text).toMatch(/order_date looks like date/); // one US-style date and one impossible date among ISO dates
    expect(text).toMatch(/amount looks like decimal/);
    expect(p.columns.find((c) => c.name === "order_id")!.unique).toBe(false); // 1003 is repeated
  });
  it("writes a Markdown report with the same counts", () => {
    const md = reportMarkdown(p, "sample orders");
    expect(md).toContain("# Data profile: sample orders");
    expect(md).toContain("- Rows: 11");
    expect(md).toContain("- Duplicate rows: 1");
    expect(md).toContain("| amount |");
  });
});
