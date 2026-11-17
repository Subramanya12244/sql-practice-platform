import { describe, expect, it } from "vitest";
import { search, type SearchDoc } from "../site/lib/searchIndex";

const doc = (kind: SearchDoc["kind"], title: string, path: string, text = ""): SearchDoc => ({ kind, title, path, text });

describe("global search ranking", () => {
  const docs = [
    doc("Lesson", "Day 112: Analytical SQL on API data", "/daily/analyst/day/112"),
    doc("Lesson", "Day 12: while loops, break and continue", "/daily/day/12"),
    doc("Tool", "ETL pipeline builder", "/etl-builder", "Labs source to load"),
    doc("Exercise", "PY-085 Log ETL Step Metrics", "/practice/python/log-etl"),
    doc("Note", "ETL architecture", "/notes/etl-architecture"),
  ];
  it("a whole-phrase title match beats a lookalike number", () => {
    expect(search(docs, "day 12")[0].path).toBe("/daily/day/12");
  });
  it("a tool or page comes before notes and exercises for the same word", () => {
    const hits = search(docs, "etl");
    expect(hits[0].kind).toBe("Tool");
    expect(hits.map((h) => h.kind)).toContain("Exercise");
  });
  it("finds a page by what its description says", () => {
    expect(search(docs, "source load").map((h) => h.path)).toEqual(["/etl-builder"]);
  });
});
