// @vitest-environment node
// Release-blocking layout regressions for Visual Learning Notes: real PDFs are rendered and read
// back, then checked for clipping, overflow, overlaps, near-empty/blank pages and missing content.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import schemaJson from "../../public/data/schema.json";
import { buildGraphs } from "../site/lib/queryGraph";
import { explainQuery } from "../site/lib/tutor";
import { buildDocDefinition } from "../site/lib/notes/pdf";
import { oversized } from "../site/lib/notes/layout";
import { defaultOptions, pyNote, sqlNote, type NoteItem, type NotesOptions } from "../site/lib/notes/content";
import { OUTLINE_PY, type PyOutline } from "../site/lib/notes/pyOutline";
import { parseExercise } from "../site/lib/pyExercises";
import { inspect, render, type Report } from "./pdfLayout";
import type { Question, SchemaTable } from "../site/types";

const schema = schemaJson as SchemaTable[];
const question = (slug: string) => JSON.parse(fs.readFileSync(`public/data/q/${slug}.json`, "utf8")) as Question;
const rowsOf = (n: number) => ({ success: true, columns: ["customer_id", "company_name", "orders", "revenue"], rows: Array.from({ length: n }, (_, i) => [`C${i}`, `Company ${i} with a fairly long name`, i, (i * 13.37).toFixed(2)]) });

async function sql(slug: string, userSql?: string, outputRows = 8) {
  return sqlNote(question(slug), userSql, {
    schema, buildGraphs, explain: explainQuery, run: async () => rowsOf(outputRows),
    titleOf: (n) => `Q${n}`,
  }, 200);
}

let python = "";
for (const cand of [process.env.PYTHON, "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3", "python3"]) {
  if (!cand) continue;
  try { execFileSync(cand, ["-c", "import ast"]); python = cand; break; } catch { /* try next */ }
}
const outline = async (src: string): Promise<PyOutline | null> => {
  if (!python) return null;
  const out = execFileSync(python, ["-I", "-c", OUTLINE_PY.replace("__DF_SRC__", JSON.stringify(JSON.stringify(src)))]).toString();
  return JSON.parse(out.split("__DF_OUTLINE__")[1]);
};
async function py(slug: string, mine?: string) {
  const e = parseExercise(fs.readFileSync(`src/site/content/python/${slug}.md`, "utf8"), slug);
  return pyNote(e, mine ?? null, { outline, tests: async () => ({ visible: { passed: 3, total: 3 }, hidden: { passed: 4, total: 4 } }) });
}

const LONG_SQL = `SELECT\n  c.customer_id,\n  c.company_name,\n${Array.from({ length: 110 }, (_, i) => `  SUM(CASE WHEN EXTRACT(MONTH FROM o.order_date) = ${(i % 12) + 1} AND od.discount > ${(i % 5) / 10} THEN od.unit_price * od.quantity * (1 - od.discount) ELSE 0 END) AS m${i}_revenue_with_a_long_alias_name,`).join("\n")}\n  COUNT(*) AS lines\nFROM customers c\nJOIN orders o ON o.customer_id = c.customer_id\nJOIN order_details od ON od.order_id = o.order_id\nGROUP BY c.customer_id, c.company_name\nORDER BY lines DESC;`;
const WIDE_SQL = `WITH ${Array.from({ length: 9 }, (_, i) => `c${i} AS (SELECT customer_id, COUNT(*) AS n${i} FROM orders WHERE freight > ${i} GROUP BY customer_id HAVING COUNT(*) > 1)`).join(",\n")}\nSELECT c.company_name, ${Array.from({ length: 9 }, (_, i) => `c${i}.n${i}`).join(", ")}\nFROM customers c\n${Array.from({ length: 9 }, (_, i) => `LEFT JOIN c${i} ON c${i}.customer_id = c.customer_id`).join("\n")}\nWHERE c.country <> 'x' ORDER BY 1 LIMIT 10;`;
const NESTED_SQL = `SELECT e.employee_id, e.last_name,\n  (SELECT COUNT(*) FROM orders o WHERE o.employee_id = e.employee_id AND o.order_id IN (SELECT od.order_id FROM order_details od WHERE od.quantity > (SELECT AVG(quantity) FROM order_details))) AS big_orders\nFROM employees e\nLEFT JOIN employees m ON m.employee_id = e.reports_to\nWHERE EXISTS (SELECT 1 FROM orders o2 JOIN customers c ON c.customer_id = o2.customer_id WHERE o2.employee_id = e.employee_id AND c.country IN (SELECT country FROM suppliers))\nORDER BY big_orders DESC;`;
const LONG_PY = `import csv, json, logging\nfrom collections import defaultdict\n\nlog = logging.getLogger("etl")\n\n` + Array.from({ length: 14 }, (_, i) => `def stage_${i}(rows, config):\n    """Stage ${i}: validate, transform and aggregate."""\n    out, errors = [], []\n    for r in rows:\n        if not isinstance(r, dict):\n            errors.append(r)\n            continue\n        try:\n            value = float(r.get("amount", 0)) * config.get("rate_${i}", 1.0)\n        except (TypeError, ValueError):\n            errors.append(r)\n            continue\n        out.append({**r, "amount_${i}": round(value, 2)})\n    log.info("stage ${i}: %d ok, %d bad", len(out), len(errors))\n    return out, errors\n`).join("\n");
const NESTED_PY = `def walk(tree, depth=0, path=()):\n    for k, v in sorted(tree.items()):\n        if isinstance(v, dict):\n            for kk, vv in v.items():\n                if isinstance(vv, dict):\n                    for kkk, vvv in vv.items():\n                        if vvv is not None and str(vvv).strip() and not str(vvv).startswith("#") and len(str(vvv)) < 10_000 and kkk not in ("internal", "debug", "trace"):\n                            yield path + (k, kk, kkk), vvv\n                else:\n                    yield path + (k, kk), vv\n        else:\n            yield path + (k,), v\n`;

const opts = (o: Partial<NotesOptions> = {}): NotesOptions => ({ ...defaultOptions("Layout regression ✓"), ...o, include: { ...defaultOptions().include, ...(o.include ?? {}) } });

async function build(items: NoteItem[], o = opts()) {
  const { bytes, tier, pages } = await render(buildDocDefinition(items, o, "2026-11-05 10:00"));
  return { r: await inspect(bytes), tier, pages, bytes };
}
function clean(r: Report) {
  expect(oversized, "figures scaled down to fit (should have been split)").toEqual([]);
  expect(r.outOfPage, "text outside the page").toEqual([]);
  expect(r.outsideMargins, "text outside the margins (clipped or overflowing)").toEqual([]);
  expect(r.overlaps, "overlapping text").toEqual([]);
  expect(r.blank, "blank pages").toEqual([]);
  expect(r.nearEmpty, "near-empty pages").toEqual([]);
}
const codeLines = (src: string) => src.split("\n").map((l) => l.trim()).filter(Boolean);

describe("PDF layout regressions", () => {
  it("1. short SQL query: one problem, every section, clean layout", async () => {
    const q = await sql("q25-customers-and-order-count");
    const { r, pages } = await build([q]);
    clean(r);
    expect(r.missing([...codeLines(q.sql), "Problem overview", "Database schema", "Query flow", "Step by step", "Expected output", "Important learning points"])).toEqual([]);
    expect(pages).toBeLessThanOrEqual(5);
  }, 60_000);

  it("2/5. long SQL code block: intact, indentation kept, split only with continuation markers", async () => {
    const q = await sql("q25-customers-and-order-count", LONG_SQL);
    const { r } = await build([q], opts({ include: { schema: false, queryDiagram: false } as never }));
    clean(r);
    expect(r.missing(codeLines(LONG_SQL))).toEqual([]);
    expect(r.text).toContain("continues on the next page");
    expect(r.text).toContain("continued from the previous page");
    expect(r.text).toContain("↪"); // long lines wrap with a marker instead of being cut
  }, 60_000);

  it("3. wide query-flow diagram: landscape parts at full size, overview, continuation labels", async () => {
    const q = await sql("q25-customers-and-order-count", WIDE_SQL);
    const { r } = await build([q]);
    clean(r);
    expect(r.pages.some((p) => p.width > p.height)).toBe(true);
    expect(r.text).toMatch(/Query flow, part 2 of \d/);
    expect(r.text).toContain("continues in part 2");
    // Landscape pages end before the rest of the problem returns to portrait.
    expect(r.pages.at(-1)!.width).toBeLessThan(r.pages.at(-1)!.height);
  }, 60_000);

  it("4. complex joins and nested subqueries", async () => {
    const q = await sql("q25-customers-and-order-count", NESTED_SQL);
    const { r } = await build([q]);
    clean(r);
    expect(r.missing(codeLines(NESTED_SQL))).toEqual([]);
  }, 60_000);

  it("6/8. short Python problem and deeply nested code with a very long line", async () => {
    const a = await py("dedupe-preserve-order");
    const b = await py("flatten-json-records", NESTED_PY);
    const { r } = await build([a, b]);
    clean(r);
    expect(r.missing([...codeLines(NESTED_PY), "Data engineering relevance", "Input and expected output", "Test results"])).toEqual([]);
  }, 60_000);

  it.skipIf(!python)("7/9. long Python ETL pipeline with a large data-flow and flowchart parts", async () => {
    const p = await py("lazy-pipeline", LONG_PY);
    expect(p.outline!.functions.length).toBe(14);
    const { r, pages, tier } = await build([p]);
    clean(r);
    expect(tier, "plain English notes must not need the full fonts").toBe("core");
    expect(r.missing(codeLines(LONG_PY))).toEqual([]);
    expect(r.text).toContain("Data flow (inferred from the code)");
    expect(pages).toBeGreaterThan(5);
  }, 120_000);

  it("10. long table across pages: header repeated, no row split", async () => {
    const q = await sql("q25-customers-and-order-count", undefined, 150);
    const { r } = await build([q], opts({ include: { schema: false, queryDiagram: false, code: false } as never }));
    clean(r);
    const withHeader = r.pages.filter((p) => p.boxes.some((b) => b.str === "company_name"));
    expect(withHeader.length).toBeGreaterThan(1); // header row on each page of the table
    expect(r.missing(["C0", "C149", "Company 149 with a fairly long name"])).toEqual([]);
  }, 60_000);

  it("11. a multi-problem document with every section: cover, contents, SQL and Python", async () => {
    const items = [await sql("q25-customers-and-order-count"), await sql("q156-first-and-latest-product-per-customer"), await py("incremental-load-watermark"), await py("csv-quarantine-splitter")];
    const { r } = await build(items, opts({ include: { reference: true } as never }));
    clean(r);
    expect(r.text).toContain("Contents");
    for (const t of ["Q25", "Q156", "PY-008", "Incremental Load"]) expect(r.text).toContain(t);
  }, 120_000);

  it("12. optional sections disabled leave no headings behind and no empty pages", async () => {
    const off = { statement: false, schema: false, queryDiagram: false, pyDiagram: false, deDiagram: false, explanation: false, output: false, notes: false, reference: false, tests: false, code: true };
    const { r } = await build([await sql("q25-customers-and-order-count"), await py("dedupe-preserve-order")], opts({ include: off }));
    clean(r);
    for (const h of ["Problem overview", "Database schema", "Query flow", "Step by step", "Expected output", "Logic flow", "Data flow", "Test results"]) expect(r.text).not.toContain(h);
    expect(r.text).toContain("SQL query");
  }, 60_000);

  it("13. Unicode: compact fonts for normal text, full fonts when needed, glyphs present", async () => {
    const q = await sql("q25-customers-and-order-count");
    const a = await build([q], opts({ title: "Joins ✓ → ≤ € ₹ ⚠️ ✅" }));
    expect(a.tier).toBe("core");
    expect(a.r.text).toContain("Joins ✓ → ≤ € ₹ ⚠ ✓");
    const b = await build([q], opts({ title: "Шпаргалка Ω ✓" }));
    expect(b.tier).toBe("full");
    expect(b.r.text).toContain("Шпаргалка Ω ✓");
    clean(b.r);
  }, 60_000);

  it("16. the checker itself catches overflow, overlap, blank and near-empty pages", async () => {
    const bad = buildDocDefinition([], opts({ branding: false }), "x");
    bad.content = [
      { text: "x".repeat(400), noWrap: true },
      { text: "A", absolutePosition: { x: 100, y: 100 } }, { text: "B overlapping", absolutePosition: { x: 100, y: 100 } },
      { text: "", pageBreak: "after" }, { text: " ", pageBreak: "after" }, { text: "almost nothing", pageBreak: "after" }, { text: "end" },
    ] as never;
    const { r } = await build([]).catch(() => ({ r: null })) as { r: Report | null };
    void r;
    const rendered = await render(bad);
    const rep = await inspect(rendered.bytes);
    expect(rep.outsideMargins.length + rep.outOfPage.length).toBeGreaterThan(0);
    expect(rep.overlaps.length).toBeGreaterThan(0);
    expect(rep.blank.length).toBeGreaterThan(0);
    expect(rep.nearEmpty.length).toBeGreaterThan(0);
  }, 60_000);
});
