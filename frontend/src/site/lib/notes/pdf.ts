/**
 * Visual Learning Notes documents: SQL and Python content on the shared layout system
 * (layout.ts). This file decides what goes into a note; layout.ts decides how it is laid out.
 * Pure: no DOM access, so it runs inside the PDF worker.
 */
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { effectiveInclude, type NoteItem, type NotesOptions, type PyNote, type SqlNote } from "./content";
import { CONTENT_W, FIGURE_H, LANDSCAPE_W, callout, code, contents, cover, figure, frame, inline, md, muted, note, problemTitle, section, table, type Ctx } from "./layout";
import { THEMES, flowParts, layoutFlow, outlineParts, pipelineSvg, schemaParts, type Theme } from "./svg";

export { md } from "./layout";

const CATEGORY: Record<string, string> = {
  fundamentals: "Python Fundamentals for Data Engineering", dsa: "Data Structures and Algorithms", processing: "Data Processing and Transformation",
  files: "File Handling and Data Formats", etl: "ETL Pipeline Development", advanced: "Advanced Python for Data Engineering",
};
const FLOW_NOTE = "Logical query flow built from the query's syntax tree: the order in which clauses apply. It is not the database's execution plan.";

/**
 * Query flow at a readable size, never shrunk: three or more operations side by side move to
 * landscape pages, and a flow taller than a page is split between rows into numbered parts after
 * an overview of the whole flow.
 */
export function queryFlow(flow: NonNullable<SqlNote["flow"]>, t: Theme): Content[] {
  const c: Ctx = { t, dark: false };
  const wide = layoutFlow(flow, CONTENT_W).widestLayer >= 3;
  const width = wide ? LANDSCAPE_W : CONTENT_W, maxH = wide ? FIGURE_H.landscape : FIGURE_H.portrait;
  const { parts, overview } = flowParts(flow, t, width, maxH);
  if (parts.length === 1 && !wide) return section("Query flow (logical processing order)", [figure(parts[0], FLOW_NOTE, c, width)], c);
  // Each block starts its own page; the first one also switches orientation. The orientation
  // change sits on the figure itself: an empty marker paragraph would push a page-sized figure
  // onto the next page and leave a blank page behind.
  const first: Record<string, string> = wide ? { pageBreak: "before", pageOrientation: "landscape" } : { pageBreak: "before" };
  const title = (i: number) => (parts.length > 1 ? `Query flow, part ${i + 1} of ${parts.length}` : "Query flow (logical processing order)");
  const out: Content[] = [];
  if (overview) out.push(...section(`Query flow overview (${parts.length} parts follow)`, [figure(overview, "Every operation of the query, titles only; the detailed parts follow.", c, width, first)], c));
  parts.forEach((svgText, i) => out.push(...section(title(i), [figure(svgText, i === parts.length - 1 ? FLOW_NOTE : undefined, c, width, i === 0 && !overview ? first : { pageBreak: "before" })], c)));
  if (wide) out.push({ text: " ", fontSize: 1, pageBreak: "before", pageOrientation: "portrait" } as Content);
  return fixBreaks(out);
}

/** `section` wraps a figure in a heading stack; move the figure's page break up to that stack. */
function fixBreaks(nodes: Content[]): Content[] {
  return nodes.map((n) => {
    const s = (n as { stack?: Content[] }).stack;
    const inner = s?.find((x) => (x as { pageBreak?: string }).pageBreak);
    if (!s || !inner) return n;
    const { pageBreak, pageOrientation } = inner as { pageBreak?: string; pageOrientation?: string };
    delete (inner as unknown as Record<string, unknown>).pageBreak; delete (inner as unknown as Record<string, unknown>).pageOrientation;
    return { ...(n as object), pageBreak, ...(pageOrientation ? { pageOrientation } : {}) } as Content;
  });
}

function sqlSection(q: SqlNote, idx: number, o: NotesOptions, c: Ctx, afterBreak: boolean): Content[] {
  const inc = effectiveInclude(o);
  const out: Content[] = [{ ...(problemTitle(`Q${q.number}`, q.title, o.labels ? ["SQL", q.difficulty, q.topic] : [], q.concepts, idx === 0, c, `item-${idx}`) as object), ...(afterBreak ? { pageBreak: "before" } : {}) } as Content];
  if (inc.statement) out.push(...section("Problem overview", [...md(q.problem, c), callout("Objective", q.objective, c)], c));
  if (inc.schema) {
    const parts = schemaParts(q.tables, c.t, CONTENT_W, FIGURE_H.portrait);
    parts.forEach((p, i) => out.push(...section(parts.length > 1 ? `Database schema, part ${i + 1} of ${parts.length} (${p.tables.join(", ")})` : `Database schema (${p.tables.join(", ")})`,
      [figure(p.svg, i === parts.length - 1 ? "Actual Northwind tables used by this question. PK primary key, FK foreign key; N : 1 marks a foreign key (many rows reference one row)." : undefined, c)], c)));
  }
  if (inc.code) out.push(...section(q.sqlSource === "yours" ? "Your SQL query" : "SQL query (reference solution)", code(q.sql, "sql", c), c));
  if (inc.queryDiagram) {
    if (q.flow) out.push(...queryFlow(q.flow, c.t));
    else if (q.flowNote) out.push(muted(q.flowNote, c));
  }
  if (inc.explanation) {
    const blocks: Content[] = [];
    if (q.steps.length) blocks.push({ ol: q.steps.map((s) => ({ text: [{ text: `${s.clause}  `, bold: true, color: c.t.accent, font: "DejaVuSansMono", fontSize: 8 }, s.text], margin: [0, 0, 0, 3] })), margin: [0, 0, 0, 6] });
    if (q.joins.length) blocks.push({ text: [{ text: "Joins: ", bold: true }, q.joins.join("; ")], fontSize: 8.5, margin: [0, 0, 0, 6] });
    out.push(...section("Step by step", blocks.length ? blocks : [muted("This query's clauses could not be explained automatically.", c)], c));
    if (o.mode === "detailed" && q.approach) out.push(...section("Approach", md(q.approach, c), c, true));
    if (q.why) out.push(...section("Why it works", md(q.why, c), c, true));
  }
  if (inc.output) {
    out.push(...section("Expected output", q.output
      ? [table(q.output.columns, q.output.rows, c, true), note(`${q.output.total} row${q.output.total === 1 ? "" : "s"} from running the reference query on Northwind${q.output.total > q.output.rows.length ? `; first ${q.output.rows.length} shown` : ""}.`, c)]
      : [muted(q.outputNote ?? "No output.", c)], c));
  }
  if (inc.notes) {
    const pts: Content[] = [];
    if (q.watchOutFor) pts.push({ text: [{ text: "Watch out: ", bold: true }, ...inline(q.watchOutFor, c)] });
    for (const p of q.pitfalls.slice(0, o.mode === "compact" ? 2 : 6)) pts.push({ text: [{ text: "Common mistake: ", bold: true }, ...inline(p, c)] });
    for (const p of q.optimizations) pts.push({ text: [{ text: "Optimisation: ", bold: true }, p] });
    if (q.related.length) pts.push({ text: [{ text: "Practise next: ", bold: true }, q.related.join("; ")] });
    const blocks: Content[] = [...(q.takeaway ? [callout("Key point", q.takeaway, c)] : []), ...(pts.length ? [{ ul: pts, fontSize: 8.5, margin: [0, 0, 0, 6] } as Content] : [])];
    out.push(...section("Important learning points", blocks, c));
    if (o.mode === "detailed" && q.followups.length) out.push(...section("Follow-up questions", [{ ul: q.followups.map((f) => ({ text: [{ text: `${f.question} `, bold: true }, ...inline(f.answer, c)], margin: [0, 0, 0, 2] })), fontSize: 8.5 } as Content], c, true));
  }
  if (inc.reference && q.sqlSource === "yours" && q.reference.trim() !== q.sql.trim()) out.push(...section("Reference solution", code(q.reference, "sql", c), c));
  return out;
}

function pySection(p: PyNote, idx: number, o: NotesOptions, c: Ctx, afterBreak: boolean): Content[] {
  const inc = effectiveInclude(o);
  const s = p.sections;
  const out: Content[] = [{ ...(problemTitle(p.code, p.title, o.labels ? ["PYTHON", p.difficulty, CATEGORY[p.category] ?? p.category] : [], p.concepts, idx === 0, c, `item-${idx}`) as object), ...(afterBreak ? { pageBreak: "before" } : {}) } as Content];
  if (inc.statement) {
    const blocks: Content[] = [];
    if (s.Scenario) blocks.push(callout("Scenario", s.Scenario.replace(/\n+/g, " "), c));
    if (s.Problem) blocks.push(...md(s.Problem, c));
    if (s.Objective) blocks.push(callout("Objective", s.Objective, c));
    if (s["Why it matters"]) blocks.push(callout("Data engineering relevance", s["Why it matters"], c));
    out.push(...section("Problem overview", blocks, c));
  }
  if (inc.output && (s["Input format"] || s["Output format"])) {
    out.push(...section("Input and expected output", [
      ...(s["Input format"] ? [{ text: [{ text: "Input: ", bold: true }, ...inline(s["Input format"], c)], fontSize: 8.5, margin: [0, 0, 0, 2] } as Content] : []),
      ...(s["Output format"] ? [{ text: [{ text: "Output: ", bold: true }, ...inline(s["Output format"], c)], fontSize: 8.5, margin: [0, 0, 0, 4] } as Content] : []),
    ], c));
  }
  if (inc.code) {
    const showMine = (o.pySolution === "mine" || o.pySolution === "both") && p.mine;
    const showRef = o.pySolution === "reference" || o.pySolution === "both" || (o.pySolution === "mine" && !p.mine);
    if (showMine) out.push(...section("Your solution", code(p.mine!, "python", c), c));
    if (showRef && o.pySolution !== "none" && (!showMine || p.reference.trim() !== p.mine!.trim())) out.push(...section("Reference solution", code(p.reference, "python", c), c));
  }
  if (inc.pyDiagram && p.outline) {
    const parts = outlineParts(p.outline, c.t, CONTENT_W, FIGURE_H.portrait);
    parts.forEach((part, i) => out.push(...section(i === 0 ? `Logic flow: ${part.title} (from ${p.mine ? "your" : "the reference"} solution's syntax tree)` : `Logic flow: ${part.title}`,
      [figure(part.svg, i === parts.length - 1 ? "Code-derived logical flow: each box is a real statement; dashed arrows return to the loop header. Not a runtime trace." : undefined, c)], c)));
  } else if (inc.pyDiagram && p.outlineNote) out.push(muted(p.outlineNote, c));
  if (inc.deDiagram && p.outline) {
    const stages = p.outline.stages;
    const blocks: Content[] = stages.length >= 2
      ? [figure(pipelineSvg(stages, c.t, CONTENT_W)!, "Inferred logical flow: data operations recognised in the syntax tree, in source order. It is a static reading of the code, not a trace of an actual run.", c)]
      : [muted("No data-flow diagram: no data operations in this solution were recognised with confidence, so none is drawn.", c)];
    out.push(...section(stages.length >= 2 ? "Data flow (inferred from the code)" : "Data flow", blocks, c));
    const un = p.outline.unrecognised ?? [];
    if (un.length) out.push(...section("Not visualised automatically", [
      { text: "These statements do work the rules don't recognise, so they have no stage in the diagram. Read them in the code:", fontSize: 8, color: c.t.muted, margin: [0, 0, 0, 3] },
      table(["Line", "Code"], un.map((u) => [String(u.line), u.code]), c, true),
    ], c, true));
  }
  if (inc.explanation) {
    const facts: Content[] = [];
    if (p.time) facts.push({ text: [{ text: "Time complexity: ", bold: true }, { text: p.time, font: "DejaVuSansMono" }] });
    if (p.space) facts.push({ text: [{ text: "Space complexity: ", bold: true }, { text: p.space, font: "DejaVuSansMono" }] });
    if (p.outline?.imports.length) facts.push({ text: [{ text: "Modules used: ", bold: true }, p.outline.imports.join(", ")] });
    if (p.outline?.classes.length) facts.push({ text: [{ text: "Classes: ", bold: true }, p.outline.classes.map((x) => `${x.name} (${x.methods.join(", ")})`).join("; ")] });
    out.push(...section("How it works", [...(p.explanation ? md(p.explanation, c) : []), ...(facts.length ? [{ ul: facts, fontSize: 8.5, margin: [0, 0, 0, 6] } as Content] : [])], c));
    if (o.mode === "detailed" && s.Hints) out.push(...section("Hints", md(s.Hints, c), c, true));
  }
  if (inc.output && s.Examples) out.push(...section("Example execution", md(s.Examples, c), c));
  if (inc.tests && p.tests) {
    const v = p.tests.visible, h = p.tests.hidden;
    out.push(...section("Test results", [table(["Suite", "Passed", "Total"], [["Visible tests", String(v.passed), String(v.total)], ["Hidden tests", String(h.passed), String(h.total)]], c),
      note(`Run in Python (Pyodide) against ${p.tests.ran === "yours" ? "your" : "the reference"} solution when this document was generated.`, c)], c));
  }
  if (inc.notes && s.Constraints) out.push(...section("Constraints and common mistakes to avoid", md(s.Constraints, c), c));
  return out;
}

export function buildDocDefinition(items: NoteItem[], o: NotesOptions, generatedAt: string): TDocumentDefinitions {
  const c: Ctx = { t: THEMES[o.theme], dark: o.theme === "dark" };
  const multi = items.length > 1;
  const coverPage = multi || o.branding;
  const f = { title: o.title, branding: o.branding, pageNumbers: o.pageNumbers, date: o.date, generatedAt, coverPage };
  const content: Content[] = [];
  if (coverPage) {
    content.push(...cover(o.title, `${o.mode === "compact" ? "Revision sheet" : "Study guide"} · ${items.length} problem${items.length === 1 ? "" : "s"}`,
      [...new Set(items.map((i) => (i.kind === "sql" ? i.topic : CATEGORY[i.category] ?? i.category)))].join(" · "), f, c));
    if (multi && o.toc) content.push(contents(c));
  }
  items.forEach((item, i) => content.push(...(item.kind === "sql" ? sqlSection(item, i, o, c, i === 0 && coverPage) : pySection(item, i, o, c, i === 0 && coverPage))));
  return { ...frame(f, c), info: { title: o.title, creator: "DataForge", producer: "DataForge Visual Learning Notes", subject: "Study notes" }, content: fixBreaks(content) };
}
