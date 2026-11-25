import { describe, expect, it } from "vitest";
import { normalizeSql, vizNoticeText, vizSource, type ExecLike } from "../site/lib/visual/classic/vizSource";

const A = "SELECT product_name FROM products";
const B = "SELECT c.country FROM customers c";
const BAD = "SELECT x FROM no_such_table";
// newest first, like getExecs()
let t = 0;
const ex = (sql: string, ok: boolean): ExecLike => ({ at: `2026-01-01T00:00:${String(t++).padStart(2, "0")}.000Z`, sql, ok });
const list = (...xs: ExecLike[]) => xs.reverse();

describe("vizSource: first load and first run", () => {
  it("nothing run yet: nothing shown, even after the learner asked for it (the starter is never visualized)", () => {
    for (const started of [false, true]) {
      const s = vizSource({ execs: [], draft: "SELECT * FROM products", started });
      expect(s).toMatchObject({ status: "none", reason: "no-run", sql: null, lastSuccessfulSql: null });
    }
  });
  it("a successful run that was not asked for yet is not shown", () => {
    expect(vizSource({ execs: list(ex(A, true)), draft: A, started: false })).toMatchObject({ status: "none", reason: "not-visualized", sql: null, lastSuccessfulSql: A });
  });
  it("failure first: nothing is shown, whatever the editor holds", () => {
    const s = vizSource({ execs: list(ex(BAD, false)), draft: BAD, started: true });
    expect(s).toMatchObject({ status: "none", reason: "only-failed", sql: null, lastSuccessfulSql: null, latestSql: BAD });
  });
  it("success, asked for, editor unchanged: current", () => {
    expect(vizSource({ execs: list(ex(A, true)), draft: A, started: true })).toMatchObject({ status: "current", reason: "matches-editor", sql: A });
  });
  it("an unknown editor text counts as matching", () => {
    expect(vizSource({ execs: list(ex(A, true)), started: true }).status).toBe("current");
  });
});

describe("vizSource: success then failure", () => {
  const execs = list(ex(A, true), ex(BAD, false));
  it("keeps the last successful query and says the latest run failed", () => {
    expect(vizSource({ execs, draft: BAD, started: true })).toMatchObject({ status: "last-successful", reason: "latest-failed", sql: A });
  });
  it("never shows the failed query unless the learner pins it; then it is the editor's query that failed", () => {
    const pin = { sql: BAD, after: execs[0].at };
    expect(vizSource({ execs, draft: BAD, started: true, pin })).toMatchObject({ status: "current", reason: "failed-run", sql: BAD });
  });
  it("a pinned failed query the editor has since left is stale", () => {
    const pin = { sql: BAD, after: execs[0].at };
    expect(vizSource({ execs, draft: B, started: true, pin })).toMatchObject({ status: "stale", reason: "edited-failed", sql: BAD });
  });
  it("a pin dies with the next execution: the newest successful run wins again", () => {
    const pin = { sql: BAD, after: execs[0].at };
    const next = [ex(B, true), ...execs];
    expect(vizSource({ execs: next, draft: B, started: true, pin })).toMatchObject({ status: "current", sql: B });
  });
  it("a failure that is the only run after several failures still falls back to the older success", () => {
    const e = list(ex(A, true), ex(BAD, false), ex("SELEC 1", false));
    expect(vizSource({ execs: e, draft: "SELEC 1", started: true })).toMatchObject({ status: "last-successful", reason: "latest-failed", sql: A });
  });
});

describe("vizSource: editing without executing", () => {
  const execs = list(ex(A, true));
  it("keeps what is shown and marks it as not matching the editor", () => {
    expect(vizSource({ execs, draft: `${A} WHERE unit_price > 5`, started: true })).toMatchObject({ status: "last-successful", reason: "edited", sql: A });
  });
  it("whitespace-only and trailing-semicolon edits are not stale", () => {
    for (const draft of [`  ${A}  `, `${A};`, A.replace(/ /g, "\n  "), `${A} ;\n\n`]) expect(vizSource({ execs, draft, started: true }).status, draft).toBe("current");
  });
  it("a case or comment change is a different query", () => {
    expect(vizSource({ execs, draft: A.toLowerCase(), started: true }).status).toBe("last-successful");
    expect(vizSource({ execs, draft: `-- hi\n${A}`, started: true }).status).toBe("last-successful");
  });
  it("normalizeSql collapses whitespace and one trailing semicolon run only", () => {
    expect(normalizeSql("  SELECT   1 ;;\n")).toBe("SELECT 1");
    expect(normalizeSql("SELECT ';' ")).toBe("SELECT ';'");
  });
});

describe("vizSource: repeated executions", () => {
  it("the newest successful run is always the one shown", () => {
    const e1 = list(ex(A, true));
    const e2 = [ex(B, true), ...e1];
    const e3 = [ex(A, true), ...e2];
    expect(vizSource({ execs: e1, draft: A, started: true }).sql).toBe(A);
    expect(vizSource({ execs: e2, draft: B, started: true }).sql).toBe(B);
    expect(vizSource({ execs: e3, draft: A, started: true }).sql).toBe(A);
  });
  it("a pinned older run is stale and names the older query, and the editor's newer query is not what is shown", () => {
    const execs = list(ex(A, true), ex(B, true));
    expect(vizSource({ execs, draft: B, started: true, pin: { sql: A, after: execs[0].at } })).toMatchObject({ status: "stale", reason: "older-run", sql: A, lastSuccessfulSql: B });
  });
  it("pinning the newest successful query is the same as following it", () => {
    const execs = list(ex(A, true), ex(B, true));
    expect(vizSource({ execs, draft: B, started: true, pin: { sql: B, after: execs[0].at } }).status).toBe("current");
  });
});

describe("vizNoticeText", () => {
  it("has short, distinct wording for every state", () => {
    const states = [["current", "matches-editor"], ["current", "failed-run"], ["last-successful", "edited"], ["last-successful", "latest-failed"], ["stale", "older-run"], ["stale", "edited-failed"], ["none", "no-run"], ["none", "not-visualized"], ["none", "only-failed"]] as const;
    const texts = states.map(([s, r]) => vizNoticeText(s, r));
    expect(new Set(texts).size).toBe(states.length);
    for (const x of texts) expect(x.length).toBeLessThan(100);
  });
});
