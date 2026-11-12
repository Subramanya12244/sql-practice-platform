// @vitest-environment node
// Set-operation stages run against real PostgreSQL semantics through PGlite, the same way the visualizer runs in the browser.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { analyze } from "../site/lib/sqlAst";
import { parseSetOperation, setOpBranches, type SetOpNode, type SetOpQuery } from "../site/lib/sqlClauses";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { visualize, type Run, type Stage, type Visualization } from "../site/lib/visualize";
import { rowMark } from "../site/lib/visual/setOps";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SetOpView } from "../site/components/visual/SetOpView";

let pg: PGlite;
let run: Run;
beforeAll(async () => {
  pg = new PGlite();
  // ln: 1,1,2,NULL,NULL,3   rn: 1,2,2,NULL,NULL,4   (duplicates and NULLs on both sides)
  await pg.exec(`
    CREATE TABLE ln (v int); INSERT INTO ln VALUES (1),(1),(2),(NULL),(NULL),(3);
    CREATE TABLE rn (v int); INSERT INTO rn VALUES (1),(2),(2),(NULL),(NULL),(4);
    CREATE TABLE lt (a int, b text); INSERT INTO lt VALUES (1,'x'),(1,'x'),(2,'y'),(NULL,'z'),(3,NULL);
    CREATE TABLE rt (a int, b text); INSERT INTO rt VALUES (1,'x'),(2,'y'),(2,'y'),(NULL,'z'),(NULL,NULL);
    CREATE TABLE big (n int); INSERT INTO big SELECT g FROM generate_series(1, 60) g;
    CREATE TABLE big2 (n int); INSERT INTO big2 SELECT g FROM generate_series(40, 100) g;
  `);
  run = (sql) => execute(pg as unknown as SqlDb, sql);
}, 60_000);

const key = (v: unknown) => (v === null ? "∅" : String(v));
const multiset = (rows: unknown[][]) => rows.map((r) => r.map(key).join("|")).sort();
const opStages = (v: Visualization) => v.stages.filter((s) => s.setOp);
const lastOp = (v: Visualization) => opStages(v).slice(-1)[0];
async function full(sql: string) {
  const r = await run(sql);
  expect(r.success).toBe(true);
  return r;
}
const q = (op: string) => `SELECT v FROM ln ${op} SELECT v FROM rn`;

describe("set-operation reader", () => {
  const read = (sql: string): SetOpQuery => {
    const r = parseSetOperation(sql);
    if (r.kind !== "setop") throw new Error(`not a set operation: ${JSON.stringify(r)}`);
    return r.query;
  };
  it("reads all six operators", () => {
    for (const [kw, op, all] of [["UNION", "union", false], ["UNION ALL", "union", true], ["INTERSECT", "intersect", false], ["INTERSECT ALL", "intersect", true], ["EXCEPT", "except", false], ["EXCEPT ALL", "except", true]] as const) {
      const root = read(`SELECT 1 ${kw} SELECT 2`).root as SetOpNode;
      expect([root.op, root.all, root.keyword]).toEqual([op, all, kw]);
    }
  });
  it("gives INTERSECT higher precedence and groups equal precedence to the left", () => {
    const a = read("SELECT 1 UNION SELECT 2 INTERSECT SELECT 3").root as SetOpNode;
    expect(a.op).toBe("union");
    expect((a.right as SetOpNode).op).toBe("intersect");
    const b = read("SELECT 1 UNION SELECT 2 EXCEPT SELECT 3").root as SetOpNode;
    expect(b.op).toBe("except");
    expect((b.left as SetOpNode).op).toBe("union");
    const c = read("(SELECT 1 UNION SELECT 2) INTERSECT SELECT 3").root as SetOpNode;
    expect(c.op).toBe("intersect");
    expect((c.left as SetOpNode).paren).toBe(true);
  });
  it("applies a trailing ORDER BY / LIMIT / OFFSET to the whole operation, not the last SELECT", () => {
    const x = read("SELECT a FROM t UNION SELECT b FROM u ORDER BY 1 DESC LIMIT 3 OFFSET 2");
    expect(x.tail).toMatchObject({ orderBy: "1 DESC", limit: "3", offset: "2" });
    expect(setOpBranches(x).map((b) => b.sql)).toEqual(["SELECT a FROM t", "SELECT b FROM u"]);
    // inside parentheses the clauses stay with that input
    const y = read("(SELECT a FROM t ORDER BY a LIMIT 2) UNION ALL (SELECT b FROM u) ORDER BY 1");
    expect(setOpBranches(y)[0].sql).toBe("SELECT a FROM t ORDER BY a LIMIT 2");
    expect(y.tail.orderBy).toBe("1");
  });
  it("keeps the WITH prefix and ignores keywords in strings, comments, quotes and subqueries", () => {
    const x = read("WITH c AS (SELECT 1 AS v UNION SELECT 2) SELECT v FROM c EXCEPT SELECT 2 -- UNION ALL\n");
    expect(x.with).toBe("WITH c AS (SELECT 1 AS v UNION SELECT 2)");
    expect((x.root as SetOpNode).op).toBe("except");
    expect(parseSetOperation("SELECT 'a UNION b' AS \"union\" FROM t").kind).toBe("none");
    expect(parseSetOperation("SELECT * FROM (SELECT 1 UNION SELECT 2) x").kind).toBe("none");
    expect(parseSetOperation("SELECT * FROM t WHERE a IN (SELECT 1 EXCEPT SELECT 2)").kind).toBe("none");
    expect(parseSetOperation("SELECT 1; SELECT 2 UNION SELECT 3").kind).toBe("none");
  });
  it("reports shapes it cannot read instead of guessing", () => {
    const r = parseSetOperation("SELECT 1 ORDER BY 1 UNION SELECT 2");
    expect(r.kind).toBe("unsupported");
    expect(parseSetOperation("SELECT 1 UNION").kind).toBe("unsupported");
    expect(parseSetOperation("(SELECT 1 UNION SELECT 2").kind).toBe("unsupported");
  });
});

describe("row fate rules (PostgreSQL multiset semantics)", () => {
  it("EXCEPT ALL subtracts counts and INTERSECT ALL takes the minimum", () => {
    // value with 2 copies on the left and 1 on the right
    expect([1, 2].map((k) => rowMark("except", true, "left", k, 1).fate)).toEqual(["cancelled", "kept"]);
    expect([1, 2].map((k) => rowMark("intersect", true, "left", k, 1).fate)).toEqual(["kept", "unmatched"]);
    expect(rowMark("union", false, "right", 1, 1).fate).toBe("duplicate");
    expect(rowMark("except", false, "left", 2, 0).fate).toBe("duplicate");
  });
});

describe("visualize: the six operators with duplicates and NULLs", () => {
  // Hand-computed from ln = {1,1,2,N,N,3} and rn = {1,2,2,N,N,4}.
  const cases: [string, number, number | undefined, number | undefined][] = [
    // op, result rows, removed, matched
    ["UNION ALL", 12, 0, 3],
    ["UNION", 5, 7, 3],
    ["INTERSECT", 3, 2, 3], // removed: distinct values in only one input (3 and 4)
    ["INTERSECT ALL", 4, 4, 4], // removed: unpartnered copies (left 1,3 / right 2,4)
    ["EXCEPT", 1, 3, undefined],
    ["EXCEPT ALL", 2, 4, undefined],
  ];
  for (const [op, expected, removed, matched] of cases) {
    it(`${op}: counts, matched, removed and result equal PostgreSQL`, async () => {
      const sql = q(op);
      const v = await visualize(sql, run);
      expect(v.unsupported).toBeUndefined();
      expect(v.stages.map((s) => s.clause)).toEqual([op.split(" ")[0].toLowerCase()]);
      const st = v.stages[0];
      const d = st.setOp!;
      expect(st.source).toBe("executed");
      expect(d.compat.ok).toBe(true);
      expect([d.op, d.all]).toEqual([op.split(" ")[0].toLowerCase(), op.endsWith("ALL")]);
      expect([d.leftCount, d.rightCount]).toEqual([6, 6]);
      expect([d.leftDistinct, d.rightDistinct]).toEqual([4, 4]); // NULLs count as one distinct value
      expect(d.resultCount).toBe(expected);
      expect(d.removedCount).toBe(removed);
      if (matched !== undefined) expect(d.matchedCount).toBe(matched);
      // the stage's result is what the whole query returns
      const whole = await full(sql);
      expect(whole.row_count).toBe(expected);
      expect(multiset(d.result.rows)).toEqual(multiset(whole.rows));
      expect(v.final!.rowCount).toBe(expected);
      // count arithmetic with real numbers adds up
      if (!op.startsWith("INTERSECT")) expect(d.arithmetic?.ok).toBe(true);
      // matched / removed sets are real derived results
      if (op === "INTERSECT" || op === "INTERSECT ALL") expect(multiset(d.matched!.rows)).toEqual(multiset(whole.rows));
      if (op === "EXCEPT") expect(multiset(d.removed!.rows)).toEqual(["1", "2", "∅"].sort());
      if (op === "EXCEPT ALL") expect(multiset(d.removed!.rows)).toEqual(multiset((await full(q("INTERSECT ALL"))).rows)); // cancelled copies
      if (op === "UNION") expect(multiset(d.removed!.rows.map((r) => r.slice(0, 1)))).toEqual(["1", "2", "∅"].sort());
      if (op === "UNION ALL") expect(d.removed!.rows).toEqual([]);
      // NULLs match each other: the NULL row is matched on both sides
      const nullLeft = d.left.rows.findIndex((r) => r[0] === null);
      expect(d.left.marks![nullLeft].matched).toBe(true);
    });
  }

  it("marks every sampled input row with a fate that adds up to the result", async () => {
    for (const [op, expected] of [["UNION", 5], ["INTERSECT", 3], ["INTERSECT ALL", 4], ["EXCEPT", 1], ["EXCEPT ALL", 2], ["UNION ALL", 12]] as const) {
      const d = (await visualize(q(op), run)).stages[0].setOp!;
      const keptLeft = d.left.marks!.filter((m) => m.fate === "kept").length;
      const keptRight = d.right.marks!.filter((m) => m.fate === "kept").length;
      // UNION*: kept rows of both sides are the result; INTERSECT: each result row has a left row; EXCEPT: kept left rows only
      if (op.startsWith("UNION")) expect(keptLeft + keptRight).toBe(expected);
      else expect(keptLeft).toBe(expected);
      expect(d.left.marks!.length).toBe(d.left.rows.length);
    }
  });

  it("works on several columns (a NULL in any column still matches an identical row)", async () => {
    const sql = "SELECT a, b FROM lt INTERSECT ALL SELECT a, b FROM rt";
    const v = await visualize(sql, run);
    const whole = await full(sql);
    expect(multiset(v.stages[0].setOp!.result.rows)).toEqual(multiset(whole.rows));
    expect(v.stages[0].setOp!.pairs!.map((p) => [p.name, p.left, p.right, p.result])).toEqual([["a", "integer", "integer", "integer"], ["b", "text", "text", "text"]]);
    const e = await visualize("SELECT a, b FROM lt EXCEPT SELECT a, b FROM rt", run);
    expect(e.stages[0].setOp!.resultCount).toBe((await full("SELECT a, b FROM lt EXCEPT SELECT a, b FROM rt")).row_count);
    expect(e.stages[0].setOp!.arithmetic?.ok).toBe(true);
  });

  it("samples at most 20 rows but counts every row", async () => {
    const v = await visualize("SELECT n FROM big UNION ALL SELECT n FROM big2", run);
    const d = v.stages[0].setOp!;
    expect(d.left.rows.length).toBe(20);
    expect(d.leftCount).toBe(60);
    expect(d.rightCount).toBe(61);
    expect(d.resultCount).toBe(121);
    const u = await visualize("SELECT n FROM big UNION SELECT n FROM big2", run);
    expect(u.stages[0].setOp!.resultCount).toBe(100);
    expect(u.stages[0].setOp!.removedCount).toBe(21);
    expect(u.stages[0].setOp!.matchedCount).toBe(21);
  });
});

describe("visualize: invalid combinations use PostgreSQL's own error", () => {
  it("column count mismatch", async () => {
    const v = await visualize("SELECT a, b FROM lt UNION SELECT a FROM rt", run);
    const st = v.stages[0];
    expect(st.setOp!.compat.ok).toBe(false);
    expect(st.error).toMatch(/each UNION query must have the same number of columns/);
    expect(st.setOp!.compat.notes.join(" ")).toMatch(/2 column\(s\) and the right input has 1/);
    expect(st.setOp!.result.rows).toEqual([]);
    expect(st.setOp!.resultCount).toBeUndefined();
    // the real query still ran once and failed with the same error
    expect(v.final).toBeUndefined();
    expect(v.stages[v.stages.length - 1].error).toMatch(/same number of columns/);
  });
  it("type mismatch: names the incompatible types", async () => {
    const v = await visualize("SELECT a FROM lt UNION SELECT b FROM rt", run);
    const d = v.stages[0].setOp!;
    expect(d.compat.ok).toBe(false);
    expect(d.error).toMatch(/UNION types integer and text cannot be matched/);
    expect(d.pairs![0]).toMatchObject({ left: "integer", right: "text", same: false });
    expect(d.pairs![0].result).toBeUndefined();
    const e = await visualize("SELECT a FROM lt EXCEPT SELECT b FROM rt", run);
    expect(e.stages[0].setOp!.error).toMatch(/EXCEPT types integer and text cannot be matched/);
  });
  it("compatible but different types are resolved to a common type", async () => {
    const v = await visualize("SELECT 1 AS x UNION ALL SELECT 2.5", run);
    const d = v.stages[0].setOp!;
    expect(d.compat.ok).toBe(true);
    expect(d.pairs![0]).toMatchObject({ left: "integer", right: "numeric", result: "numeric", same: false });
    expect(d.compat.notes.join(" ")).toMatch(/integer and numeric are combined as numeric/);
    expect(d.left.columns).toEqual(["x"]);
  });
  it("names come from the left input", async () => {
    const d = (await visualize("SELECT v AS left_name FROM ln UNION SELECT v AS other FROM rn", run)).stages[0].setOp!;
    expect(d.result.columns).toEqual(["left_name"]);
    expect(d.right.columns).toEqual(["other"]);
  });
  it("an invalid input reports PostgreSQL's error and still runs nothing else", async () => {
    const v = await visualize("SELECT nope FROM ln UNION SELECT v FROM rn", run);
    expect(v.stages[0].error).toMatch(/nope/);
    expect(v.stages[0].setOp!.compat.ok).toBe(false);
  });
});

describe("visualize: nested, parenthesised and mixed operations", () => {
  it("one stage per operation, inner first, and the last stage equals the full query", async () => {
    const sql = "(SELECT v FROM ln UNION SELECT v FROM rn) EXCEPT SELECT 4";
    const v = await visualize(sql, run);
    const ops = opStages(v).map((s) => s.setOp!.op);
    expect(ops).toEqual(["union", "except"]);
    expect(opStages(v)[1].setOp!.leftLabel).toMatch(/result of step 1/);
    expect(opStages(v)[0].setOp!.resultCount).toBe(5);
    expect(lastOp(v).setOp!.resultCount).toBe(4);
    expect(multiset(lastOp(v).setOp!.result.rows)).toEqual(multiset((await full(sql)).rows));
    // the inner result is the outer's left input
    expect(opStages(v)[1].setOp!.leftCount).toBe(5);
  });
  it("INTERSECT binds tighter than UNION: A UNION B INTERSECT C = A UNION (B INTERSECT C)", async () => {
    const sql = "SELECT 4 AS v UNION SELECT v FROM rn INTERSECT SELECT v FROM ln";
    const v = await visualize(sql, run);
    expect(opStages(v).map((s) => s.setOp!.op)).toEqual(["intersect", "union"]);
    expect(opStages(v)[0].setOp!.resultCount).toBe(3); // rn INTERSECT ln = {1,2,NULL}
    const whole = await full(sql);
    expect(multiset(lastOp(v).setOp!.result.rows)).toEqual(multiset(whole.rows));
    expect(lastOp(v).setOp!.resultCount).toBe(whole.row_count);
    // a left-to-right reading would give a different answer
    const wrong = await full("(SELECT 4 AS v UNION SELECT v FROM rn) INTERSECT SELECT v FROM ln");
    expect(wrong.row_count).not.toBe(whole.row_count);
  });
  it("equal precedence is left to right", async () => {
    const sql = "SELECT v FROM ln UNION SELECT v FROM rn EXCEPT SELECT v FROM rn";
    const v = await visualize(sql, run);
    expect(opStages(v).map((s) => s.setOp!.op)).toEqual(["union", "except"]);
    expect(lastOp(v).setOp!.resultCount).toBe((await full(sql)).row_count);
  });
  it("parenthesised input with its own ORDER BY / LIMIT keeps it", async () => {
    const sql = "(SELECT v FROM ln WHERE v IS NOT NULL ORDER BY v DESC LIMIT 2) UNION ALL (SELECT v FROM rn WHERE v = 4)";
    const v = await visualize(sql, run);
    const d = opStages(v)[0].setOp!;
    expect(d.leftCount).toBe(2);
    expect(d.left.rows.map((r) => r[0])).toEqual([3, 2]);
    expect(d.resultCount).toBe(3);
  });
});

describe("visualize: ORDER BY / LIMIT / OFFSET on the whole operation", () => {
  it("adds ORDER BY and LIMIT stages after the set operation and matches the full query", async () => {
    const sql = "SELECT v FROM ln UNION SELECT v FROM rn ORDER BY v DESC LIMIT 3 OFFSET 1";
    const v = await visualize(sql, run);
    expect(v.stages.map((s) => s.clause)).toEqual(["union", "order by", "limit"]);
    const [u, o, l] = v.stages;
    expect(u.setOp!.resultCount).toBe(5); // LIMIT is not applied to the last SELECT only
    expect(o.rowsOut).toBe(5);
    expect(o.sample!.rows.map((r) => r[0])).toEqual([null, 4, 3, 2, 1]); // NULLs sort first in DESC
    expect(l.rowsIn).toBe(5);
    expect(l.rowsOut).toBe(3);
    const whole = await full(sql);
    expect(l.sample!.rows).toEqual(whole.rows);
    expect(v.final!.rows).toEqual(whole.rows);
    expect(l.explanation).toMatch(/Skip 1 row\(s\), then keep at most 3/);
  });
  it("ORDER BY on the whole result of INTERSECT ALL", async () => {
    const sql = "SELECT v FROM ln INTERSECT ALL SELECT v FROM rn ORDER BY 1";
    const v = await visualize(sql, run);
    expect(v.stages.map((s) => s.clause)).toEqual(["intersect", "order by"]);
    expect(v.stages[1].sample!.rows).toEqual((await full(sql)).rows);
    expect(v.stages[1].rowsOut).toBe(4);
  });
  it("an expression in ORDER BY is invalid for a set operation: PostgreSQL's error is shown", async () => {
    const v = await visualize("SELECT v FROM ln UNION SELECT v FROM rn ORDER BY v + 1", run);
    expect(v.stages.some((s) => s.error && /ORDER BY/.test(s.error))).toBe(true);
  });
  it("ranges point at the real clauses in the original text", async () => {
    const sql = "SELECT v FROM ln UNION SELECT v FROM rn ORDER BY v LIMIT 2";
    const v = await visualize(sql, run);
    expect(sql.slice(...v.parsed.ranges["order by"]!).trim()).toBe("ORDER BY v");
    expect(sql.slice(...v.parsed.ranges.limit!)).toBe("LIMIT 2");
    expect(sql.slice(...v.stages[0].range!)).toBe("SELECT v FROM ln UNION SELECT v FROM rn");
  });
});

describe("visualize: CTE in front of a set operation", () => {
  it("the WITH clause applies to every input", async () => {
    const sql = "WITH hi AS (SELECT v FROM ln WHERE v >= 2), lo AS (SELECT v FROM rn WHERE v <= 2) SELECT v FROM hi UNION ALL SELECT v FROM lo ORDER BY v";
    const v = await visualize(sql, run);
    expect(v.parsed.with).toMatch(/^WITH hi AS/);
    expect(v.stages.map((s) => s.clause)).toEqual(["union", "order by"]);
    const d = v.stages[0].setOp!;
    expect([d.leftCount, d.rightCount]).toEqual([2, 3]); // NULLs fail the WHERE tests
    expect(d.resultCount).toBe(5);
    expect(v.stages[1].sample!.rows).toEqual((await full(sql)).rows);
  });
  it("a CTE with its own UNION inside is not mistaken for the top-level operation", async () => {
    const v = await visualize("WITH c AS (SELECT 1 AS v UNION SELECT 2) SELECT v FROM c EXCEPT SELECT 2", run);
    expect(opStages(v).map((s) => s.setOp!.op)).toEqual(["except"]);
    expect(lastOp(v).setOp!.resultCount).toBe(1);
  });
});

describe("visualize: volatile functions", () => {
  it("runs nothing but the user's own query and labels every stage parsed", async () => {
    const calls: string[] = [];
    const counting: Run = (sql) => { calls.push(sql); return run(sql); };
    const sql = "SELECT v, random() AS r FROM ln UNION ALL SELECT v, random() FROM rn ORDER BY 1 LIMIT 3";
    const v = await visualize(sql, counting);
    expect(v.volatile).toEqual(["random()"]);
    expect(v.stages.map((s) => s.clause)).toEqual(["union", "order by", "limit"]);
    expect(v.stages.every((s) => s.source === "parsed" && !s.sample && !s.setOp && s.rowsOut === undefined)).toBe(true);
    expect(v.stages[0].explanation).toMatch(/random\(\)/);
    expect(calls).toEqual([sql]); // only the final, real query
    expect(v.final!.rowCount).toBe(3);
  });
});

describe("visualize: unchanged behaviour and structure tab", () => {
  it("single SELECT and set operations inside subqueries still use the logical stages", async () => {
    const v = await visualize("SELECT * FROM (SELECT 1 AS n UNION SELECT 2) x WHERE n > 1", run);
    expect(v.stages.map((s) => s.clause)).toEqual(["from", "where", "select"]);
    expect(v.stages.every((s) => !s.setOp)).toBe(true);
  });
  it("reports a set operation it cannot read", async () => {
    const v = await visualize("SELECT 1 ORDER BY 1 UNION SELECT 2", run);
    expect(v.unsupported).toMatch(/could not be read/);
    expect(v.stages).toEqual([]);
  });
  it("analyze lists the branches with the whole-operation ORDER BY / LIMIT kept out of the last branch", async () => {
    const s = await analyze("SELECT v FROM ln UNION SELECT v FROM rn ORDER BY v LIMIT 3");
    expect(s.branches).toEqual([{ op: "", sql: "SELECT v FROM ln" }, { op: "UNION", sql: "SELECT v FROM rn" }]);
    const i = await analyze("SELECT v FROM ln INTERSECT ALL SELECT v FROM rn EXCEPT SELECT 1");
    expect(i.branches.map((b) => b.op)).toEqual(["", "INTERSECT ALL", "EXCEPT"]);
    const p = await analyze("(SELECT v FROM ln) UNION (SELECT v FROM rn)");
    expect(p.branches.length).toBe(2);
    const c = await analyze("WITH a AS (SELECT 1 AS v) SELECT v FROM a UNION SELECT 2");
    expect(c.branches.map((b) => b.op)).toEqual(["", "UNION"]);
  });
  it("every stage kind is a known clause", async () => {
    const v = await visualize("SELECT v FROM ln UNION SELECT v FROM rn ORDER BY 1 LIMIT 1", run);
    const known: Stage["clause"][] = ["union", "order by", "limit"];
    expect(v.stages.every((s) => known.includes(s.clause))).toBe(true);
  });
});

describe("SetOpView", () => {
  it("shows the rule, both inputs, per-row marks, removed rows and the result from real data", async () => {
    const d = (await visualize(q("EXCEPT ALL"), run)).stages[0].setOp!;
    const html = renderToStaticMarkup(createElement(SetOpView, { data: d }));
    expect(html).toContain("EXCEPT ALL");
    expect(html).toContain("Duplicate rule");
    expect(html).toContain("Left input");
    expect(html).toContain("Right input");
    expect(html).toContain("removed by right input");
    expect(html).toContain("NULL");
    expect(html).toContain("Compatible");
    expect(html).toContain("Removed");
  });
  it("shows PostgreSQL's error and no result for an invalid combination", async () => {
    const d = (await visualize("SELECT a FROM lt UNION SELECT b FROM rt", run)).stages[0].setOp!;
    const html = renderToStaticMarkup(createElement(SetOpView, { data: d }));
    expect(html).toContain("UNION types integer and text cannot be matched");
    expect(html).toContain("Rejected by PostgreSQL");
    expect(html).not.toContain("aria-label=\"Result\"");
  });
});
