import { describe, expect, it } from "vitest";
import { toCsv } from "../site/lib/csv";
import { summarize } from "../site/pages/AdminUserDetail";

describe("CSV export", () => {
  it("quotes commas, quotes and newlines, and neutralises formulas", () => {
    const csv = toCsv([{ a: 'say "hi", ok', b: "=HYPERLINK(\"x\")", c: null, d: { k: 1 } }, { a: "line\nbreak", b: "-2", c: 3, d: "@x" }], ["a", "b", "c", "d"]);
    expect(csv.split("\r\n")).toEqual([
      "a,b,c,d",
      '"say ""hi"", ok","\'=HYPERLINK(""x"")",,"{""k"":1}"',
      '"line\nbreak",\'-2,3,\'@x',
      "",
    ]);
  });
});

describe("admin learner summary", () => {
  it("counts solves per topic and only automated project tasks", () => {
    const index = [{ number: 1, topic: "joins", topicLabel: "Joins" }, { number: 2, topic: "joins", topicLabel: "Joins" }, { number: 3, topic: "ctes", topicLabel: "CTEs" }];
    const s = summarize({
      progress: [
        { question_number: 1, attempts: 2, solved_at: "x", revealed: false, updated_at: "" },
        { question_number: 3, attempts: 4, solved_at: null, revealed: true, updated_at: "" },
      ],
      tasks: [
        { project_slug: "p", task_id: "load", passed: true, updated_at: "" },
        { project_slug: "p", task_id: "test", passed: false, updated_at: "" },
        { project_slug: "p", task_id: "checklist:review", passed: false, updated_at: "" },
      ],
    }, index);
    expect(s).toMatchObject({ solved: 1, attempts: 6, revealed: 1 });
    expect(s.topics).toEqual([{ label: "Joins", solved: 1, total: 2 }, { label: "CTEs", solved: 0, total: 1 }]);
    expect(s.projects).toEqual([{ slug: "p", passed: 1, tried: 2 }]);
  });
});
