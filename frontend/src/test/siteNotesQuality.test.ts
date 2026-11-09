// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { analyse, inCore, inFull, sanitize } from "../site/lib/notes/fonts";
import { buildGraphs } from "../site/lib/queryGraph";
import { THEMES, flowParts, layoutFlow } from "../site/lib/notes/svg";
import { queryFlow } from "../site/lib/notes/pdf";
import { OUTLINE_PY, type PyOutline } from "../site/lib/notes/pyOutline";
import type { FlowGraph } from "../site/lib/queryGraph";

const t = THEMES.light;

describe("PDF fonts", () => {
  it("keeps DataForge text in the small core subset and falls back only for glyphs the full fonts have", () => {
    for (const ch of "Café – “quotes” ✓ ✗ → ≤ € ₹ ⚠") expect(inCore(ch.codePointAt(0)!), ch).toBe(true);
    // Characters the layout emits itself (continuation marks, part markers, ellipsis, dot).
    for (const ch of "↪▲▼…·×") expect(inCore(ch.codePointAt(0)!), `layout glyph ${ch}`).toBe(true);
    expect(inCore("Ж".codePointAt(0)!)).toBe(false);
    expect(inFull("Ж".codePointAt(0)!)).toBe(true);
    expect(inFull("数".codePointAt(0)!)).toBe(false);
    expect(sanitize("✅ done, 🆕 item, ⚠️ careful")).toBe("✓ done, NEW item, ⚠ careful");
  });
  it("finds the variants a document uses and the tier it needs", () => {
    const def = { defaultStyle: { font: "DejaVuSans" }, content: [{ text: "Title", bold: true }, { text: [{ text: "x", italics: true }] }, { table: { body: [[{ text: "SELECT", bold: true }]] }, font: "DejaVuSansMono" }, { svg: '<svg><text font-family="DejaVuSansMono" font-size="8">a</text></svg>' }] };
    const n = analyse(def as never);
    expect([...n.variants].sort()).toEqual(["DejaVuSans:bold", "DejaVuSans:italics", "DejaVuSansMono:bold", "DejaVuSansMono:normal"]);
    expect(n.tier).toBe("core");
    const cyr = analyse({ content: [{ text: "Привет ✅" }] } as never);
    expect(cyr.tier).toBe("full");
    const cjk = analyse({ content: [{ text: "数据" }] } as never);
    expect(cjk).toMatchObject({ tier: "core", outside: ["数", "据"] }); // not in DejaVu at all: no point loading the full fonts
  });
  it("ships subsets far smaller than the full fonts", () => {
    const dir = "src/site/lib/notes/fonts/";
    const core = fs.readdirSync(dir).filter((f) => f.endsWith(".ttf")).reduce((s, f) => s + fs.statSync(dir + f).size, 0);
    expect(core).toBeLessThan(300_000);
  });
});

describe("large SQL diagrams", () => {
  const big = `WITH ${Array.from({ length: 9 }, (_, i) => `c${i} AS (SELECT customer_id, COUNT(*) AS n${i} FROM orders WHERE freight > ${i} GROUP BY customer_id HAVING COUNT(*) > 1)`).join(", ")}
    SELECT c.company_name, ${Array.from({ length: 9 }, (_, i) => `c${i}.n${i}`).join(", ")} FROM customers c ${Array.from({ length: 9 }, (_, i) => `LEFT JOIN c${i} ON c${i}.customer_id = c.customer_id`).join(" ")} WHERE c.country <> 'x' ORDER BY 1 LIMIT 10`;
  it("keeps boxes readable and splits a tall flow into parts with continuation labels", async () => {
    const g = await buildGraphs(big);
    expect(g.ok).toBe(true);
    const flow = (g as { ok: true; flow: FlowGraph }).flow;
    const L = layoutFlow(flow, 515);
    for (const p of L.pos.values()) expect(p.w).toBeGreaterThanOrEqual(170);
    const { parts, overview } = flowParts(flow, t, 762, 440);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain("continues in part 2");
    expect(parts[1]).toContain("continued from part 1");
    for (const svg of parts) expect(Number(svg.match(/height="([\d.]+)"/)![1])).toBeLessThanOrEqual(440);
    expect(overview === null || overview.startsWith("<svg")).toBe(true);
    const content = JSON.stringify(queryFlow(flow, t));
    expect(content).toContain('"pageOrientation":"landscape"');
    expect(content).toContain('"pageOrientation":"portrait"');
    expect(content).not.toContain('"fit"');
  });
  it("leaves a small flow as one portrait diagram", async () => {
    const g = await buildGraphs("SELECT country, COUNT(*) FROM customers GROUP BY country");
    const c = queryFlow((g as { ok: true; flow: FlowGraph }).flow, t);
    expect(c).toHaveLength(1);
    expect(JSON.stringify(c)).not.toContain("pageOrientation");
  });
});

let python = "";
for (const cand of [process.env.PYTHON, "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3", "python3"]) {
  if (!cand) continue;
  try { execFileSync(cand, ["-c", "import ast"]); python = cand; break; } catch { /* try next */ }
}
const outline = (src: string): PyOutline => {
  const out = execFileSync(python, ["-I", "-c", OUTLINE_PY.replace("__DF_SRC__", JSON.stringify(JSON.stringify(src)))]).toString();
  return JSON.parse(out.split("__DF_OUTLINE__")[1]);
};
const sol = (slug: string) => JSON.parse(fs.readFileSync(`src/site/content/python/${slug}.md`, "utf8").match(/```task\n(\{[\s\S]*?\})\s*\n```/)![1]).solution as string;

describe.skipIf(!python)("Python data-flow recognition (syntax tree)", () => {
  it.each([
    ["dedupe-preserve-order", ["Deduplicate"]],
    ["flatten-json-records", ["Flatten nested JSON", "Parse JSON"]],
    ["pandas-merge-anti-join", ["Deduplicate", "Join datasets", "Handle missing values"]],
    ["csv-quarantine-splitter", ["Read file", "Parse CSV", "Validate", "Write file"]],
    ["chunk-generator", ["Batch", "Stream out (generator)"]],
    ["incremental-load-watermark", ["Filter", "Sort"]],
    ["group-and-aggregate", ["Group", "Aggregate"]],
    ["cast-record-schema", ["Transform records"]],
  ])("%s", (slug, expected) => {
    const labels = outline(sol(slug)).stages.map((s) => s.label);
    for (const l of expected) expect(labels, labels.join(", ")).toContain(l);
  });
  it("never invents a stage: unknown work is reported as code", () => {
    const o = outline("def f(xs):\n    total = frobnicate(xs)\n    return total\n");
    expect(o.stages.map((s) => s.label)).not.toContain("Aggregate");
    expect(o.unrecognised).toEqual([{ line: 2, code: "total = frobnicate(xs)" }]);
  });
});

// Account saving and retrieval, against an in-memory stand-in for the Supabase client.
const store = { rows: [] as Record<string, unknown>[], files: new Map<string, Blob>() };
vi.mock("../site/lib/supabase", () => ({
  getSupabase: async () => ({
    from: () => ({
      select: () => ({ order: async () => ({ data: [...store.rows].reverse(), error: null }) }),
      insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => { const r = { ...row, created_at: new Date().toISOString() }; store.rows.push(r); return { data: r, error: null }; } }) }),
      delete: () => ({ eq: async (_k: string, id: string) => { store.rows = store.rows.filter((r) => r.id !== id); return { error: null }; } }),
    }),
    storage: { from: () => ({
      upload: async (path: string, blob: Blob, o: { upsert: boolean }) => (store.files.has(path) && !o.upsert ? { error: { message: "exists" } } : (store.files.set(path, blob), { error: null })),
      download: async (path: string) => (store.files.has(path) ? { data: store.files.get(path)!, error: null } : { data: null, error: { message: "not found" } }),
      remove: async (paths: string[]) => { paths.forEach((p) => store.files.delete(p)); return { error: null }; },
    }) },
  }),
}));

describe("My Study Notes: account documents", () => {
  it("saves, lists, downloads and deletes under the user's own folder", async () => {
    const { deleteNote, listNotes, noteBlob, saveNote } = await import("../site/lib/notes/library");
    const uid = "11111111-1111-4111-8111-111111111111";
    const pdf = new Blob(["%PDF-1.7 test"], { type: "application/pdf" });
    const n = await saveNote(uid, { title: "Joins", kind: "sql", topics: ["LEFT JOIN"], refs: ["q25"], options: {} as never, pages: 4, size_bytes: pdf.size }, pdf);
    expect(n.where).toBe("account");
    expect([...store.files.keys()]).toEqual([`${uid}/${n.id}.pdf`]);
    expect(store.rows[0].storage_path).toBe(`${uid}/${n.id}.pdf`);
    const { notes } = await listNotes(uid);
    expect(notes.map((x) => x.title)).toEqual(["Joins"]);
    expect(await (await noteBlob(uid, notes[0])).text()).toBe("%PDF-1.7 test");
    await deleteNote(uid, notes[0]);
    expect(store.rows).toEqual([]);
    expect(store.files.size).toBe(0);
  });
});
