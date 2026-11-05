// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import schemaJson from "../../public/data/schema.json";
import { buildGraphs } from "../site/lib/queryGraph";
import { THEMES, flowSvg, outlineSvg, pipelineSvg, schemaSvg } from "../site/lib/notes/svg";
import { highlight } from "../site/lib/notes/highlight";
import { buildDocDefinition, md } from "../site/lib/notes/pdf";
import { defaultOptions, effectiveInclude, sections, sqlNote, type PyNote } from "../site/lib/notes/content";
import { outlineProgram, parseOutline } from "../site/lib/notes/pyOutline";
import type { SchemaTable } from "../site/types";

const schema = schemaJson as SchemaTable[];
const t = THEMES.light;

describe("visual learning notes", () => {
  it("draws the real schema of a question's tables, with FK cardinality, and escapes text", () => {
    const s = schemaSvg(schema.filter((x) => ["orders", "customers"].includes(x.name)), t)!;
    expect(s).toMatch(/^<svg /);
    for (const c of ["customer_id", "order_date", "PK", "FK"]) expect(s).toContain(c);
    expect(s).toContain(">N<");
    expect(schemaSvg([{ name: "<x>", columns: [{ name: "a&b", type: "int" }] } as never], t)).toContain("&lt;x&gt;");
    expect(schemaSvg([], t)).toBeNull();
  });
  it("draws the query flow from the AST and refuses unsupported SQL instead of inventing one", async () => {
    const g = await buildGraphs("SELECT c.country, COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10 GROUP BY c.country ORDER BY 2 DESC");
    expect(g.ok).toBe(true);
    const s = flowSvg((g as unknown as { flow: never }).flow, t)!;
    for (const k of ["TABLE", "JOIN", "WHERE", "GROUP BY", "SELECT", "ORDER BY", "RESULT", "o.freight &gt; 10"]) expect(s).toContain(k);
    expect((await buildGraphs("this is not sql")).ok).toBe(false);
  });
  it("builds a flowchart and data flow from a Python outline", () => {
    const o = { functions: [{ name: "f", args: ["rows"], line: 1, steps: [{ kind: "loop" as const, text: "for r in rows", line: 2, children: [{ kind: "branch" as const, text: "if r in seen", line: 3, children: [] }] }, { kind: "return" as const, text: "return out", line: 5 }] }], classes: [], stages: [{ label: "Deduplicate", line: 3 }, { label: "Return result", line: 5 }], imports: [] };
    const s = outlineSvg(o, t)!;
    expect(s).toContain("LOOP");
    expect(s).toContain("stroke-dasharray"); // loop back edge
    expect(pipelineSvg(o.stages, t)).toContain("Deduplicate");
    expect(pipelineSvg([o.stages[0]], t)).toBeNull();
  });
  it("highlights SQL and Python per line", () => {
    const sql = highlight("SELECT name -- c\nFROM t WHERE x = 'a'", "sql");
    expect(sql).toHaveLength(2);
    expect(sql[0][0]).toEqual({ text: "SELECT", kind: "kw" });
    expect(sql[0].at(-1)!.kind).toBe("com");
    const py = highlight('def f(x):\n    return len("s") + 1', "python");
    expect(py[0][0]).toEqual({ text: "def", kind: "kw" });
    expect(py[1].map((r) => r.kind)).toEqual(expect.arrayContaining(["kw", "fn", "str", "num"]));
  });
  it("parses Markdown blocks, keeping wrapped list lines in their item", () => {
    const out = md("Para **bold** and `code`.\n\n- one\n  continued\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |", { t, dark: false }) as { ul?: unknown[]; table?: { body: unknown[][] } }[];
    expect(out[1].ul).toHaveLength(2);
    expect(JSON.stringify(out[1].ul![0])).toContain("one continued");
    expect(out[2].table!.body).toHaveLength(2);
    expect(sections("## A\nx\n## B\ny").B).toBe("y");
  });
  it("collects SQL content from real sources and renders a multi-page PDF with TOC and page numbers", async () => {
    const q = JSON.parse(fs.readFileSync("public/data/q/q25-customers-and-order-count.json", "utf8"));
    const note = await sqlNote(q, undefined, {
      schema, buildGraphs, explain: () => ({ steps: [{ clause: "FROM", text: "Reads rows" }], joins: [], notes: [{ text: "x" }] }),
      run: async () => ({ success: true, columns: ["customer_id", "order_count"], rows: [["ALFKI", 6], ["ÜNÏ", null]] }), titleOf: () => undefined,
    });
    expect(note.sqlSource).toBe("reference");
    expect(note.tables.map((x) => x.name).sort()).toEqual(["customers", "orders"]);
    expect(note.output!.rows[1]).toEqual(["ÜNÏ", "NULL"]);
    const py: PyNote = { kind: "python", ref: "py:x", code: "PY-001", slug: "x", title: "Big ✓ problem", difficulty: "Hard", category: "etl", skill: "incremental", concepts: ["a"],
      sections: { Scenario: "S", Problem: "P", Examples: "```\nf(1) -> 2\n```" }, time: "O(n)", space: "O(1)", explanation: "E", mine: "def f(x):\n" + "    x += 1\n".repeat(400) + "    return x\n", reference: "def f(x):\n    return x + 1\n",
      outline: { functions: [{ name: "f", args: ["x"], line: 1, steps: [{ kind: "return", text: "return x", line: 2 }] }], classes: [], stages: [], imports: [] }, outlineNote: null,
      tests: { visible: { passed: 3, total: 3 }, hidden: { passed: 2, total: 2 }, ran: "yours" } };
    const o = { ...defaultOptions("Notes ✓ ünïcödé"), theme: "dark" as const };
    const def = buildDocDefinition([note, py], o, "2026-11-05 10:00");
    const json = JSON.stringify(def.content);
    expect(json).toContain('"toc"');
    expect(json).toContain("Query flow");
    expect(effectiveInclude({ ...o, mode: "compact" }).schema).toBe(false);
    // Render for real with the bundled fonts.
    const pdfMake = (await import("pdfmake/build/pdfmake")).default as unknown as { createPdf: (d: unknown, a: unknown, f: unknown, v: unknown) => { getBuffer: (cb: (b: Uint8Array) => void) => void } };
    const f = (n: string) => fs.readFileSync(`node_modules/dejavu-fonts-ttf/ttf/${n}.ttf`).toString("base64");
    const vfs = { "s.ttf": f("DejaVuSans"), "sb.ttf": f("DejaVuSans-Bold"), "si.ttf": f("DejaVuSans-Oblique"), "sbi.ttf": f("DejaVuSans-BoldOblique"), "m.ttf": f("DejaVuSansMono"), "mb.ttf": f("DejaVuSansMono-Bold"), "mi.ttf": f("DejaVuSansMono-Oblique"), "mbi.ttf": f("DejaVuSansMono-BoldOblique") };
    const fonts = { DejaVuSans: { normal: "s.ttf", bold: "sb.ttf", italics: "si.ttf", bolditalics: "sbi.ttf" }, DejaVuSansMono: { normal: "m.ttf", bold: "mb.ttf", italics: "mi.ttf", bolditalics: "mbi.ttf" } };
    let pages = 0;
    const footer = def.footer as (p: number, n: number, s: unknown) => unknown;
    def.footer = ((p: number, n: number, s: unknown) => { pages = n; return footer(p, n, s); }) as never;
    const bytes: Uint8Array = await new Promise((r) => pdfMake.createPdf(def, undefined, fonts, vfs).getBuffer(r));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(pages).toBeGreaterThan(6); // cover, contents, SQL, and 400 lines of code across pages
  }, 60_000);
  it("outline program round-trips its marker", () => {
    expect(outlineProgram("x = 1")).toContain(JSON.stringify(JSON.stringify("x = 1")));
    expect(parseOutline('noise\n__DF_OUTLINE__{"functions":[],"classes":[],"stages":[],"imports":["json"]}\n')!.imports).toEqual(["json"]);
    expect(parseOutline("nothing")).toBeNull();
  });
});
