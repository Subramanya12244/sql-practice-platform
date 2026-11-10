import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { reviewSql, tradeoff } from "../site/lib/sqlReview";
import type { Comparison, SolutionReport } from "../site/lib/compareSolutions";

const REFERENCE = `SELECT p.product_id, p.product_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS total_revenue
FROM products p
JOIN order_details od ON od.product_id = p.product_id
GROUP BY p.product_id, p.product_name
ORDER BY total_revenue DESC;`;
// Same rows, written as a correlated subquery.
const CORRELATED = `SELECT p.product_id, p.product_name,
  (SELECT ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) FROM order_details od WHERE od.product_id = p.product_id) AS total_revenue
FROM products p
WHERE EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id)
ORDER BY total_revenue DESC;`;

const report = (o: Partial<SolutionReport>): SolutionReport => ({ sql: "", ok: true, columns: ["a"], rows: [], rowCount: 0, approaches: [], complexity: { joins: 0, subqueries: 0, ctes: 0, windows: 0, nesting: 0, lines: 1 }, runsMs: [], notes: [], ...o });
const cmp = (a: Partial<SolutionReport>, b: Partial<SolutionReport>, equivalent = true, tables = [{ name: "orders", rows: 830, indexes: [] }]): Comparison => ({ a: report(a), b: report(b), equivalent, message: "", environment: { version: "PostgreSQL 18", runs: 5, tables } });

describe("review: honesty rules", () => {
  it("correctness is the grader's verdict; a different structure is never called wrong", () => {
    const r = reviewSql({ sql: CORRELATED, referenceSql: REFERENCE, sortRequired: true, graderCorrect: true, comparison: cmp({ medianMs: 4, planCost: 30 }, { medianMs: 2, planCost: 20 }) });
    expect(r.findings[0]).toMatchObject({ id: "correct", basis: "verified" });
    expect(r.findings.some((f) => /wrong|incorrect/i.test(f.title))).toBe(false);
    expect(r.alternative).toMatchObject({ sameRows: true });
  });
  it("timings are labelled as measurements on this data and never as 'X is faster'", () => {
    const r = reviewSql({ sql: CORRELATED, referenceSql: REFERENCE, sortRequired: true, graderCorrect: true, comparison: cmp({ medianMs: 9, planCost: 40 }, { medianMs: 3, planCost: 20 }) });
    const timing = r.findings.find((f) => f.id === "timing")!;
    expect(timing.basis).toBe("verified");
    expect(timing.text).toMatch(/measurement on this practice data/);
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/\b(is|are) (much )?(faster|slower)\b|always faster|better performance/i);
    expect(r.measuredOn).toMatch(/5 timed runs/);
  });
  it("close timings are reported as about the same; no timings means no speed claim", () => {
    const close = reviewSql({ sql: CORRELATED, referenceSql: REFERENCE, sortRequired: true, graderCorrect: true, comparison: cmp({ medianMs: 3.1 }, { medianMs: 3.4 }) });
    expect(close.findings.find((f) => f.id === "timing")!.text).toMatch(/about the same time/);
    const none = reviewSql({ sql: CORRELATED, referenceSql: REFERENCE, sortRequired: true, graderCorrect: true, comparison: null });
    expect(none.findings.find((f) => f.id === "no-measure")!.text).toMatch(/nothing is claimed about speed/);
    const failed = reviewSql({ sql: CORRELATED, referenceSql: REFERENCE, sortRequired: true, graderCorrect: true, comparison: cmp({ ok: false }, {}) });
    expect(failed.findings.some((f) => f.id === "compare-failed")).toBe(true);
  });
  it("heuristics are labelled heuristic and sorted after verified findings", () => {
    const r = reviewSql({ sql: "SELECT * FROM customers WHERE region = NULL", referenceSql: "", sortRequired: false, graderCorrect: false, comparison: undefined });
    expect(r.findings[0].basis).toBe("verified");
    expect(r.findings.find((f) => /= NULL/.test(f.text))).toMatchObject({ basis: "heuristic", area: "nulls" });
    expect(r.findings.find((f) => f.id === "not-yet")!.text).toMatch(/structure only/);
    const bases = r.findings.map((f) => f.basis);
    expect(bases).toEqual([...bases].sort((a, b) => ["verified", "heuristic", "info"].indexOf(a) - ["verified", "heuristic", "info"].indexOf(b)));
  });
  it("flags order, nesting and one-line queries as heuristics", () => {
    const noOrder = reviewSql({ sql: "SELECT name FROM products", referenceSql: "", sortRequired: true, graderCorrect: true });
    expect(noOrder.findings.some((f) => f.id === "order-missing" && f.basis === "heuristic")).toBe(true);
    const extra = reviewSql({ sql: "SELECT name FROM products ORDER BY 1", referenceSql: "", sortRequired: false, graderCorrect: true });
    expect(extra.findings.find((f) => f.id === "order-extra")!.basis).toBe("info");
    const long = reviewSql({ sql: "SELECT " + "column_name_long, ".repeat(10) + "x FROM some_table WHERE a = 1 AND b = 2", referenceSql: "", sortRequired: false, graderCorrect: true });
    expect(long.findings.some((f) => f.id === "oneline")).toBe(true);
  });
  it("states what it does not assess", () => {
    expect(reviewSql({ sql: "SELECT 1", referenceSql: "", sortRequired: false, graderCorrect: true }).notAssessed.join(" ")).toMatch(/larger tables/);
  });
  it("trade-off text is conditional and never ranks approaches", () => {
    for (const [a, b] of [[["Correlated subquery"], ["JOIN", "GROUP BY"]], [["JOIN"], ["EXISTS"]], [["EXISTS"], ["JOIN"]], [["JOIN"], ["CTE"]], [["CTE"], ["JOIN"]], [["GROUP BY"], ["Window function"]], [["Window function"], ["GROUP BY"]], [["JOIN"], ["JOIN"]]] as string[][][]) {
      const t = tradeoff(a, b);
      expect(t).toMatch(/depends on the data size/);
      expect(t).not.toMatch(/always|never|faster than|slower than|best/i);
    }
  });
});

describe("SqlReviewPanel (module)", () => {
  afterEach(cleanup);
  it("is opt-in, shows loading then labelled findings, and the alternative is collapsed", async () => {
    vi.resetModules();
    vi.doMock("../site/lib/browserDb", () => ({ runQuery: async () => ({ success: true, columns: ["a"], rows: [[1]], row_count: 1, execution_time_ms: 1 }) }));
    vi.doMock("../site/lib/sqlReview", () => ({
      runReview: async () => ({ findings: [{ id: "correct", area: "correctness", basis: "verified", title: "Correct result", text: "ok" }, { id: "h", area: "readability", basis: "heuristic", title: "Style note", text: "SELECT * returns every column" }], concepts: ["JOIN"], alternative: { approaches: ["CTE"], sql: "WITH x AS (SELECT 1) SELECT * FROM x", sameRows: true, tradeoff: "It depends on the data size." }, notAssessed: ["Larger tables."], measuredOn: "PostgreSQL, 5 runs" }),
    }));
    const { SqlReviewPanel } = await import("../site/components/SqlReviewPanel");
    render(<SqlReviewPanel sql="SELECT 1" referenceSql="SELECT 1" sortRequired={false} dataset="northwind" />);
    expect(screen.queryByText("Solution review")).not.toBeInTheDocument(); // nothing runs until asked
    fireEvent.click(screen.getByRole("button", { name: /Review my solution/ }));
    expect(await screen.findByRole("heading", { name: "Solution review" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "What the labels mean" });
    expect(within(list).getByText("Heuristic")).toBeInTheDocument();
    expect(screen.getByText("Style note").previousSibling).toHaveTextContent("Heuristic");
    expect(screen.getByText(/Verified: returns the same rows/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("What this review does not cover")).toBeInTheDocument());
    vi.doUnmock("../site/lib/browserDb"); vi.doUnmock("../site/lib/sqlReview");
  });
});
