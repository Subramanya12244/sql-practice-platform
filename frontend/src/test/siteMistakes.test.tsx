import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  applyMistake, applySolved, applyUnderstood, buildNotebook, categoryLabel, classifyPyMistake, classifySqlMistake, filterNotebook, improvement, mergeMistakes, recurring, type Mistake,
} from "../site/lib/mistakes";
import { completeExercise, getProgress, markMistakeSolved, recordAttempt, recordMistake, replaceProgress, setMistakeUnderstood } from "../site/lib/progress";
import { mergeProgress } from "../site/lib/account";
import type { Progress } from "../site/lib/progress";
import type { QuestionSummary } from "../site/types";
import type { PyExerciseMeta } from "../site/lib/pyExercises";

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../site/SiteApp", () => ({ usePage: () => ({ data: page.data }) }));
import { MistakeNotebookPage } from "../site/pages/MistakeNotebookPage";

const q = (number: number, topic: string, topicLabel: string, difficulty = "Easy"): QuestionSummary => ({ number, slug: `q${number}`, title: `Question ${number}`, topic, topicLabel, difficulty, concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "" }) as QuestionSummary;
const py = (slug: string, category: string): PyExerciseMeta => ({ slug, code: `PY-${slug}`, title: `Py ${slug}`, category, difficulty: "Easy", concepts: [] } as unknown as PyExerciseMeta);
const empty = (): Progress => ({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
const T1 = "2026-11-01T10:00:00Z", T2 = "2026-11-02T10:00:00Z", T3 = "2026-11-03T10:00:00Z";
const inp = (o = {}) => ({ ref: "sql:1", kind: "sql" as const, topic: "left-join", category: "join", graded: true, ...o });

describe("classification", () => {
  it("maps SQL error titles and files wrong results under the question's topic", () => {
    expect(classifySqlMistake("Column not grouped", "aggregations")).toBe("group-by");
    expect(classifySqlMistake("Unknown column", "cte")).toBe("schema");
    expect(classifySqlMistake("Window function in a filter", "x")).toBe("window");
    expect(classifySqlMistake("Division by zero", "x")).toBe("null");
    expect(classifySqlMistake("Wrong result", "left-join")).toBe("join");
    expect(classifySqlMistake("Wrong result", "window-functions")).toBe("window");
    expect(classifySqlMistake("Wrong result", "string-functions")).toBe("wrong-result");
    expect(classifySqlMistake("SQL error", "string-functions")).toBe("other");
  });
  it("reads Python categories from the exception", () => {
    expect(classifyPyMistake("KeyError: 'price'")).toBe("dicts");
    expect(classifyPyMistake("IndexError: list index out of range")).toBe("lists");
    expect(classifyPyMistake("SyntaxError: invalid syntax")).toBe("syntax");
    expect(classifyPyMistake("Timed out after 8s")).toBe("loops");
    expect(classifyPyMistake("Starter function raises NotImplementedError")).toBe("not-started");
    expect(classifyPyMistake("fails a hidden test")).toBe("wrong-output");
    expect(classifyPyMistake("FileNotFoundError: x")).toBe("files");
    expect(classifyPyMistake("something odd")).toBe("other");
    expect(categoryLabel("python", "dicts")).toBe("Dictionaries and keys");
  });
});

describe("record, solve, understand", () => {
  it("counts graded failures and run errors separately, never stores code", () => {
    let m = applyMistake(undefined, inp(), T1);
    m = applyMistake(m, inp({ category: "schema" }), T2);
    m = applyMistake(m, inp({ graded: false }), T3);
    expect(m).toMatchObject({ count: 2, runErrors: 1, firstAt: T1, lastAt: T3, categories: { join: 1, schema: 1 } });
    expect(JSON.stringify(m)).not.toMatch(/select|SELECT/);
  });
  it("understood sticks until the same problem goes wrong again", () => {
    let m = applyMistake(undefined, inp(), T1)!;
    m = applyUnderstood(m, true, T2)!;
    expect(m.understood).toBe(T2);
    m = applyMistake(m, inp(), T3);
    expect(m.understood).toBeUndefined();
  });
  it("solved is set once and never moves", () => {
    const m = applyMistake(undefined, inp(), T1);
    const s = applySolved(m, T2)!;
    expect(applySolved(s, T3)!.solved).toBe(T2);
    expect(applySolved(undefined, T2)).toBeUndefined();
  });
});

describe("progress store integration", () => {
  beforeEach(() => { localStorage.clear(); replaceProgress(empty()); });
  it("a failed attempt creates a record; solving it later marks it solved", () => {
    recordMistake(inp({ ref: "sql:7" }));
    recordMistake(inp({ ref: "sql:7" }));
    expect(getProgress().mistakes!["sql:7"].count).toBe(2);
    recordAttempt(7, "select 1", true);
    expect(getProgress().mistakes!["sql:7"].solved).toBeTruthy();
  });
  it("Python completion marks it solved; a pass with no mistakes creates nothing", () => {
    recordMistake({ ref: "py:a", kind: "python", topic: "dsa", category: "dicts", graded: true });
    completeExercise("py:a");
    completeExercise("py:b");
    expect(getProgress().mistakes!["py:a"].solved).toBeTruthy();
    expect(getProgress().mistakes!["py:b"]).toBeUndefined();
  });
  it("understood persists", () => {
    recordMistake(inp({ ref: "sql:9" }));
    setMistakeUnderstood("sql:9", true);
    expect(getProgress().mistakes!["sql:9"].understood).toBeTruthy();
    markMistakeSolved("sql:404"); // unknown ref: no-op
    expect(getProgress().mistakes!["sql:404"]).toBeUndefined();
  });
});

describe("sync merge", () => {
  const rec = (o: Partial<Mistake>): Mistake => ({ ref: "sql:1", kind: "sql", topic: "joins", categories: { join: 1 }, count: 1, runErrors: 0, firstAt: T2, lastAt: T2, ...o });
  it("takes max counts, earliest first, latest last, and is idempotent", () => {
    const a = { "sql:1": rec({ count: 2, categories: { join: 2 }, firstAt: T2, lastAt: T3 }) };
    const b = { "sql:1": rec({ count: 3, categories: { join: 1, schema: 2 }, firstAt: T1, lastAt: T2, solved: T3 }), "sql:2": rec({ ref: "sql:2" }) };
    const m = mergeMistakes(a, b);
    expect(m["sql:1"]).toMatchObject({ count: 3, categories: { join: 2, schema: 2 }, firstAt: T1, lastAt: T3, solved: T3 });
    expect(Object.keys(m).sort()).toEqual(["sql:1", "sql:2"]);
    expect(mergeMistakes(m, b)).toEqual(m);
    expect(mergeMistakes(m, m)).toEqual(m);
  });
  it("a newer failure on one device beats an older 'understood' on the other", () => {
    const a = { "sql:1": rec({ lastAt: T3 }) };
    const b = { "sql:1": rec({ lastAt: T2, understood: T2 }) };
    expect(mergeMistakes(a, b)["sql:1"].understood).toBeUndefined();
    expect(mergeMistakes(b, a)["sql:1"].understood).toBeUndefined();
  });
  it("mergeProgress carries the notebook and old clients cannot erase it", () => {
    const local = { ...empty(), mistakes: { "sql:1": rec({}) } };
    expect(mergeProgress(local, [], {} as never, []).mistakes!["sql:1"]).toBeTruthy();
    expect(mergeProgress(empty(), [], { mistakes: local.mistakes } as never, []).mistakes!["sql:1"]).toBeTruthy();
  });
});

describe("notebook view", () => {
  const index = [q(1, "left-join", "LEFT JOIN"), q(2, "left-join", "LEFT JOIN"), q(3, "cte", "CTEs")];
  const exercises = [py("a", "dsa")];
  it("builds rows from the notebook and from older errorKinds / Python stats, newest first", () => {
    const progress = { ...empty(),
      questions: { 2: { attempts: 5, practiced: true, hintLevel: 3, errorKinds: { "Unknown column": 2, "Wrong result": 1 } } },
      mistakes: { "sql:1": { ...applyMistake(undefined, inp(), T3), solved: T3 } },
    };
    const rows = buildNotebook({ index, exercises, progress, pyStats: { a: { attempts: 3, passes: 1, lastAt: T2, lastOk: false } } });
    expect(rows.map((r) => r.ref)).toEqual(["sql:1", "py:a", "sql:2"].sort((x, y) => rows.findIndex((r) => r.ref === x) - rows.findIndex((r) => r.ref === y)));
    const legacy = rows.find((r) => r.ref === "sql:2")!;
    expect(legacy.count).toBe(3);
    expect(legacy.notes).toEqual(["Used hints up to level 3", "5 attempts"]);
    expect(legacy.categories.map((c) => c.category).sort()).toEqual(["join", "schema"]);
    expect(rows.find((r) => r.ref === "py:a")!.count).toBe(2);
    expect(rows.find((r) => r.ref === "sql:1")!.status).toBe("solved");
  });
  it("filters, finds recurring kinds and measures improvement", () => {
    const m = (ref: string, cat: string, n: number, extra = {}): Mistake => ({ ref, kind: "sql", topic: "left-join", categories: { [cat]: n }, count: n, runErrors: 0, firstAt: T1, lastAt: T2, ...extra });
    const progress = { ...empty(), mistakes: { "sql:1": m("sql:1", "join", 2), "sql:2": m("sql:2", "join", 2, { solved: T3 }), "sql:3": { ...m("sql:3", "cte", 1), topic: "cte" } } };
    const rows = buildNotebook({ index, exercises: [], progress, pyStats: {} });
    expect(filterNotebook(rows, { status: "open" })).toHaveLength(2);
    expect(filterNotebook(rows, { topic: "cte" })).toHaveLength(1);
    expect(filterNotebook(rows, { kind: "python" })).toHaveLength(0);
    expect(recurring(rows).map((x) => x.category)).toEqual(["join"]);
    expect(improvement(rows)).toMatchObject({ missed: 3, fixed: 1 });
  });
});

describe("MistakeNotebookPage (module)", () => {
  const view = () => render(<MemoryRouter><MistakeNotebookPage /></MemoryRouter>);
  beforeEach(() => { localStorage.clear(); replaceProgress(empty()); page.data = { index: [q(1, "left-join", "LEFT JOIN"), q(2, "cte", "CTEs")], exercises: [] }; });
  afterEach(cleanup);

  it("empty state for a clean notebook; error state when data is missing", async () => {
    view();
    expect(await screen.findByText("No mistakes recorded yet")).toBeInTheDocument();
    cleanup(); page.data = {};
    view();
    expect(await screen.findByText("The notebook could not load")).toBeInTheDocument();
  });

  it("lists mistakes by topic, filters them, retries and marks understood", async () => {
    replaceProgress({ ...empty(), mistakes: {
      "sql:1": { ref: "sql:1", kind: "sql", topic: "left-join", categories: { join: 3 }, count: 3, runErrors: 1, firstAt: T1, lastAt: T3 },
      "sql:2": { ref: "sql:2", kind: "sql", topic: "cte", categories: { cte: 1 }, count: 1, runErrors: 0, firstAt: T1, lastAt: T2, solved: T3 },
    } });
    view();
    const left = await screen.findByRole("region", { name: /LEFT JOIN/ });
    expect(within(left).getByText(/JOIN · 3/)).toBeInTheDocument();
    expect(within(left).getByText(/3 failed attempts · 1 run error/)).toBeInTheDocument();
    expect(within(left).getByRole("link", { name: /Retry/ })).toHaveAttribute("href", "/questions/q1");

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "solved" } });
    expect(screen.queryByRole("region", { name: /LEFT JOIN/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /CTEs/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });

    fireEvent.click(within(await screen.findByRole("region", { name: /LEFT JOIN/ })).getByRole("button", { name: /I understand this now/ }));
    expect(getProgress().mistakes!["sql:1"].understood).toBeTruthy();
    expect(within(await screen.findByRole("region", { name: /LEFT JOIN/ })).getByText("Understood")).toBeInTheDocument();
  });
});
