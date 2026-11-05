/**
 * pdfmake document definition for Visual Learning Notes (A4, vector diagrams, real text).
 * Pure: no DOM access, so it runs inside the PDF worker.
 */
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { effectiveInclude, type NoteItem, type NotesOptions, type PyNote, type SqlNote } from "./content";
import { highlight, type TokenKind } from "./highlight";
import { THEMES, flowSvg, outlineSvg, pipelineSvg, schemaSvg, type Theme } from "./svg";

const CATEGORY: Record<string, string> = {
  fundamentals: "Python Fundamentals for Data Engineering", dsa: "Data Structures and Algorithms", processing: "Data Processing and Transformation",
  files: "File Handling and Data Formats", etl: "ETL Pipeline Development", advanced: "Advanced Python for Data Engineering",
};
const PAGE_W = 595.28, MARGIN = 40, CONTENT_W = PAGE_W - 2 * MARGIN, MAX_DIAGRAM_H = 640;

const CODE_COLORS = (t: Theme, dark: boolean): Record<TokenKind, string> => ({
  kw: dark ? "#c4b5fd" : "#6d28d9", fn: dark ? "#5eead4" : "#0f766e", str: dark ? "#fcd34d" : "#a16207", num: dark ? "#fda4af" : "#be123c",
  com: t.faint, op: t.muted, plain: t.ink,
});

/** Inline Markdown: `code` and **bold** become styled runs. */
function inline(s: string, t: Theme): Content[] {
  const out: Content[] = [];
  for (const m of s.matchAll(/(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|([^`*]+|\*)/g)) {
    if (m[1]) out.push({ text: m[1].slice(1, -1), font: "DejaVuSansMono", fontSize: 8.5, color: t.accent });
    else if (m[2]) out.push({ text: m[2].slice(2, -2).replace(/`/g, ""), bold: true });
    else if (m[3]) out.push({ text: m[3].slice(1, -1), italics: true });
    else out.push({ text: m[4] });
  }
  return out;
}

/** Block Markdown subset used by the content: paragraphs, - and 1. lists, pipe tables, fenced code. */
export function md(src: string, t: Theme, dark: boolean): Content[] {
  const out: Content[] = [];
  const lines = src.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) {
      const lang = /sql/i.test(l) ? "sql" : "python";
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(codeBlock(body.join("\n"), lang, t, dark, false));
      continue;
    }
    if (/^\|/.test(l)) {
      const rows: string[][] = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) {
        if (/^\|\s*:?-{2,}/.test(lines[i])) continue;
        rows.push(lines[i].replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim()));
      }
      out.push(table(rows[0] ?? [], rows.slice(1), t));
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: Content[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, "");
        // Continuation lines (wrapped text, not a new item or block) belong to the same item.
        while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s+|^(```|\|)/.test(lines[i])) item += " " + lines[i++].trim();
        items.push({ text: inline(item, t), margin: [0, 0, 0, 2] });
      }
      out.push(ordered ? { ol: items, margin: [0, 0, 0, 6] } : { ul: items, margin: [0, 0, 0, 6] });
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !/^(```|\||\s*([-*]|\d+\.)\s+)/.test(lines[i]); i++) para.push(lines[i].trim());
    out.push({ text: inline(para.join(" "), t), margin: [0, 0, 0, 6] });
  }
  return out;
}

function table(head: string[], rows: string[][], t: Theme, mono = false): Content {
  const w = head.length;
  const fix = (r: string[]) => Array.from({ length: w }, (_, i) => r[i] ?? "");
  return {
    table: {
      headerRows: 1, widths: Array(w).fill("*"),
      body: [head.map((h) => ({ text: h, bold: true, fontSize: 8, color: t.ink, fillColor: t.accentSoft, font: mono ? "DejaVuSansMono" : undefined })),
        ...rows.map((r) => fix(r).map((c) => ({ text: c.length > 80 ? `${c.slice(0, 79)}…` : c, fontSize: 7.5, color: t.ink, font: mono ? "DejaVuSansMono" : undefined })))],
    },
    layout: { hLineColor: () => t.border, vLineColor: () => t.border, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 3, paddingBottom: () => 3 },
    margin: [0, 2, 0, 8],
  };
}

/** Highlighted code with line numbers; long code flows across pages, a header row repeats. */
export function codeBlock(code: string, lang: "sql" | "python", t: Theme, dark: boolean, numbers = true, caption?: string): Content {
  const colors = CODE_COLORS(t, dark);
  const lines = highlight(code.replace(/\s+$/, ""), lang);
  const body = lines.map((runs, i) => {
    const textRuns = runs.length ? runs.map((r) => ({ text: r.text, color: colors[r.kind], bold: r.kind === "kw" })) : [{ text: " " }];
    return numbers
      ? [{ text: String(i + 1), color: t.faint, alignment: "right" as const, fontSize: 7 }, { text: textRuns, preserveLeadingSpaces: true }]
      : [{ text: textRuns, preserveLeadingSpaces: true }];
  });
  const head = caption ? [numbers ? [{ text: "", fillColor: t.panel }, { text: caption, fontSize: 7, color: t.muted, fillColor: t.panel, font: "DejaVuSans" }] : [{ text: caption, fontSize: 7, color: t.muted, fillColor: t.panel, font: "DejaVuSans" }]] : [];
  return {
    table: { headerRows: head.length, widths: numbers ? [16, "*"] : ["*"], body: [...head, ...body] as Content[][] as never },
    layout: {
      fillColor: () => t.panel, hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0.5 : 0),
      vLineWidth: (i: number) => (i === 0 || i === (numbers ? 2 : 1) ? 0.5 : 0), hLineColor: () => t.border, vLineColor: () => t.border,
      paddingTop: () => 0.6, paddingBottom: () => 0.6, paddingLeft: (i: number) => (i === 0 ? 4 : 6), paddingRight: () => 4,
    },
    font: "DejaVuSansMono", fontSize: 7.6, margin: [0, 2, 0, 10],
  } as Content;
}

const h2 = (text: string, t: Theme): Content => ({ text, fontSize: 10.5, bold: true, color: t.accent, margin: [0, 10, 0, 4] });
const diagram = (title: string, svgText: string | null, t: Theme, note?: string): Content[] =>
  svgText ? [{ stack: [h2(title, t), { svg: svgText, fit: [CONTENT_W, MAX_DIAGRAM_H] }, ...(note ? [{ text: note, fontSize: 7, color: t.faint, margin: [0, 2, 0, 0] }] : [])], unbreakable: true } as Content] : [];
const chip = (s: string, t: Theme) => ({ text: ` ${s} `, fontSize: 7.5, color: t.accent, background: t.accentSoft });

function header(item: NoteItem, idx: number, o: NotesOptions, t: Theme): Content[] {
  const label = item.kind === "sql" ? `Q${item.number}` : item.code;
  const meta = item.kind === "sql" ? [item.difficulty, item.topic] : [item.difficulty, CATEGORY[item.category] ?? item.category];
  return [
    { text: `${label}  ${item.title}`, fontSize: 16, bold: true, color: t.ink, tocItem: true, tocStyle: { fontSize: 9.5, color: t.ink }, tocMargin: [0, 2, 0, 0], tocNumberStyle: { fontSize: 9, color: t.muted }, id: `item-${idx}`, pageBreak: idx > 0 ? "before" : undefined, margin: [0, 0, 0, 4] } as Content,
    ...(o.labels ? [{ text: [chip(item.kind.toUpperCase(), t), "  ", ...meta.flatMap((m) => [chip(m, t), "  "])], margin: [0, 0, 0, 2] } as Content] : []),
    ...(item.concepts.length ? [{ text: `Concepts: ${item.concepts.join(", ")}`, fontSize: 8, color: t.muted, margin: [0, 2, 0, 4] } as Content] : []),
  ];
}

function sqlSection(q: SqlNote, idx: number, o: NotesOptions, t: Theme, dark: boolean): Content[] {
  const inc = effectiveInclude(o);
  const out: Content[] = header(q, idx, o, t);
  if (inc.statement) out.push(h2("Problem overview", t), ...md(q.problem, t, dark), { text: [{ text: "Objective: ", bold: true }, ...inline(q.objective, t)], margin: [0, 0, 0, 6] });
  if (inc.schema) out.push(...diagram(`Database schema (${q.tables.map((x) => x.name).join(", ")})`, schemaSvg(q.tables, t, CONTENT_W), t, "From the Northwind schema. PK primary key, FK foreign key; N : 1 marks a foreign key (many rows reference one row)."));
  if (inc.code) out.push(h2(q.sqlSource === "yours" ? "Your SQL query" : "SQL query (reference solution)", t), codeBlock(q.sql, "sql", t, dark));
  if (inc.queryDiagram) {
    if (q.flow) out.push(...diagram("Query flow (logical processing order)", flowSvg(q.flow, t, CONTENT_W), t, "Built from the query's syntax tree; it shows the logical order in which clauses apply, not an execution plan."));
    else if (q.flowNote) out.push({ text: q.flowNote, fontSize: 8, color: t.faint, italics: true, margin: [0, 4, 0, 4] });
  }
  if (inc.explanation) {
    out.push(h2("Step by step", t));
    if (q.steps.length) out.push({ ol: q.steps.map((s) => ({ text: [{ text: `${s.clause}  `, bold: true, color: t.accent, font: "DejaVuSansMono", fontSize: 8 }, s.text], margin: [0, 0, 0, 3] })), margin: [0, 0, 0, 6] });
    if (q.joins.length) out.push({ text: [{ text: "Joins: ", bold: true }, q.joins.join("; ")], fontSize: 8.5, margin: [0, 0, 0, 6] });
    if (o.mode === "detailed" && q.approach) out.push({ text: "Approach", bold: true, fontSize: 9, margin: [0, 2, 0, 2] }, ...md(q.approach, t, dark));
    if (q.why) out.push({ text: "Why it works", bold: true, fontSize: 9, margin: [0, 2, 0, 2] }, ...md(q.why, t, dark));
  }
  if (inc.output) {
    out.push(h2("Expected output", t));
    if (q.output) out.push(table(q.output.columns, q.output.rows, t, true), { text: `${q.output.total} row${q.output.total === 1 ? "" : "s"} from running the reference query on Northwind${q.output.total > q.output.rows.length ? `; first ${q.output.rows.length} shown` : ""}.`, fontSize: 7, color: t.faint, margin: [0, -4, 0, 6] });
    else if (q.outputNote) out.push({ text: q.outputNote, fontSize: 8, color: t.faint });
  }
  if (inc.notes) {
    const pts: Content[] = [];
    if (q.takeaway) pts.push({ text: [{ text: "Key point: ", bold: true }, ...inline(q.takeaway, t)] });
    if (q.watchOutFor) pts.push({ text: [{ text: "Watch out: ", bold: true }, ...inline(q.watchOutFor, t)] });
    for (const p of q.pitfalls.slice(0, o.mode === "compact" ? 2 : 6)) pts.push({ text: [{ text: "Common mistake: ", bold: true }, ...inline(p, t)] });
    for (const p of q.optimizations) pts.push({ text: [{ text: "Optimisation: ", bold: true }, p] });
    if (q.related.length) pts.push({ text: [{ text: "Practise next: ", bold: true }, q.related.join("; ")] });
    if (pts.length) out.push(h2("Important learning points", t), { ul: pts, fontSize: 8.5, margin: [0, 0, 0, 6] });
    if (o.mode === "detailed" && q.followups.length) out.push({ text: "Follow-up questions", bold: true, fontSize: 9, margin: [0, 4, 0, 2] }, { ul: q.followups.map((f) => ({ text: [{ text: `${f.question} `, bold: true }, ...inline(f.answer, t)], margin: [0, 0, 0, 2] })), fontSize: 8.5 });
  }
  if (inc.reference && q.sqlSource === "yours" && q.reference.trim() !== q.sql.trim()) out.push(h2("Reference solution", t), codeBlock(q.reference, "sql", t, dark));
  return out;
}

function pySection(p: PyNote, idx: number, o: NotesOptions, t: Theme, dark: boolean): Content[] {
  const inc = effectiveInclude(o);
  const s = p.sections;
  const out: Content[] = header(p, idx, o, t);
  if (inc.statement) {
    out.push(h2("Problem overview", t));
    if (s.Scenario) out.push({ text: "Scenario", bold: true, fontSize: 9 }, ...md(s.Scenario, t, dark));
    if (s.Problem) out.push(...md(s.Problem, t, dark));
    if (s.Objective) out.push({ text: [{ text: "Objective: ", bold: true }, ...inline(s.Objective, t)], margin: [0, 0, 0, 6] });
    if (s["Why it matters"]) out.push({ text: [{ text: "Data engineering relevance: ", bold: true }, ...inline(s["Why it matters"], t)], margin: [0, 0, 0, 6] });
  }
  if (inc.code) {
    const showMine = (o.pySolution === "mine" || o.pySolution === "both") && p.mine;
    const showRef = o.pySolution === "reference" || o.pySolution === "both" || (o.pySolution === "mine" && !p.mine);
    if (showMine) out.push(h2("Your solution", t), codeBlock(p.mine!, "python", t, dark));
    if (showRef && o.pySolution !== "none" && (!showMine || p.reference.trim() !== p.mine!.trim())) out.push(h2("Reference solution", t), codeBlock(p.reference, "python", t, dark));
  }
  if (inc.pyDiagram && p.outline) {
    const fns = p.outline.functions.filter((f) => f.steps.length);
    fns.forEach((f, i) => out.push(...diagram(i === 0 ? `Logic flow (from ${p.mine ? "your" : "the reference"} solution's syntax tree)` : `Logic flow: ${f.name}`, outlineSvg({ ...p.outline!, functions: [f] }, t, CONTENT_W), t, i === fns.length - 1 ? "Each box is a real statement; dashed arrows return to the loop header." : undefined)));
  } else if (inc.pyDiagram && p.outlineNote) out.push({ text: p.outlineNote, fontSize: 8, color: t.faint, italics: true });
  if (inc.deDiagram && p.outline && p.outline.stages.length >= 2) out.push(...diagram("Data flow", pipelineSvg(p.outline.stages, t, CONTENT_W), t, "Stages recognised from the calls and statements in the code, in source order."));
  if (inc.explanation) {
    out.push(h2("How it works", t));
    if (p.explanation) out.push(...md(p.explanation, t, dark));
    const facts: Content[] = [];
    if (p.time) facts.push({ text: [{ text: "Time complexity: ", bold: true }, { text: p.time, font: "DejaVuSansMono" }] });
    if (p.space) facts.push({ text: [{ text: "Space complexity: ", bold: true }, { text: p.space, font: "DejaVuSansMono" }] });
    if (p.outline?.imports.length) facts.push({ text: [{ text: "Modules used: ", bold: true }, p.outline.imports.join(", ")] });
    if (p.outline?.classes.length) facts.push({ text: [{ text: "Classes: ", bold: true }, p.outline.classes.map((c) => `${c.name} (${c.methods.join(", ")})`).join("; ")] });
    if (facts.length) out.push({ ul: facts, fontSize: 8.5, margin: [0, 0, 0, 6] });
    if (o.mode === "detailed" && s.Hints) out.push({ text: "Hints", bold: true, fontSize: 9, margin: [0, 2, 0, 2] }, ...md(s.Hints, t, dark));
  }
  if (inc.output && (s.Examples || s["Input format"])) {
    out.push(h2("Example execution", t));
    if (s["Input format"]) out.push({ text: [{ text: "Input: ", bold: true }, ...inline(s["Input format"], t)], fontSize: 8.5, margin: [0, 0, 0, 2] });
    if (s["Output format"]) out.push({ text: [{ text: "Output: ", bold: true }, ...inline(s["Output format"], t)], fontSize: 8.5, margin: [0, 0, 0, 4] });
    if (s.Examples) out.push(...md(s.Examples, t, dark));
  }
  if (inc.tests && p.tests) {
    const v = p.tests.visible, h = p.tests.hidden;
    out.push(h2("Test results", t), table(["Suite", "Passed", "Total"], [["Visible tests", String(v.passed), String(v.total)], ["Hidden tests", String(h.passed), String(h.total)]], t),
      { text: `Run in Python (Pyodide) against ${p.tests.ran === "yours" ? "your" : "the reference"} solution when this document was generated.`, fontSize: 7, color: t.faint, margin: [0, -4, 0, 6] });
  }
  if (inc.notes && s.Constraints) out.push(h2("Constraints to remember", t), ...md(s.Constraints, t, dark));
  return out;
}

export function buildDocDefinition(items: NoteItem[], o: NotesOptions, generatedAt: string): TDocumentDefinitions {
  const t = THEMES[o.theme];
  const dark = o.theme === "dark";
  const content: Content[] = [];
  const multi = items.length > 1;
  // Cover page (always for multi-item documents, and whenever branding is on).
  if (multi || o.branding) {
    content.push(
      ...(o.branding ? [{ text: "DataForge", fontSize: 13, bold: true, color: t.accent, margin: [0, 120, 0, 6] } as Content] : [{ text: "", margin: [0, 120, 0, 0] } as Content]),
      { text: o.title, fontSize: 28, bold: true, color: t.ink, margin: [0, 0, 0, 10] },
      { text: `${o.mode === "compact" ? "Revision sheet" : "Study guide"} · ${items.length} problem${items.length === 1 ? "" : "s"}`, fontSize: 12, color: t.muted },
      { text: [...new Set(items.map((i) => (i.kind === "sql" ? i.topic : CATEGORY[i.category] ?? i.category)))].join(" · "), fontSize: 9, color: t.faint, margin: [0, 8, 0, 0] },
      ...(o.date ? [{ text: `Generated ${generatedAt}`, fontSize: 9, color: t.faint, margin: [0, 24, 0, 0] } as Content] : []),
      { text: "", pageBreak: "after" },
    );
    if (multi && o.toc) content.push({ toc: { title: { text: "Contents", fontSize: 16, bold: true, color: t.ink, margin: [0, 0, 0, 12] }, numberStyle: { color: t.muted } } } as Content, { text: "", pageBreak: "after" });
  }
  items.forEach((item, i) => content.push(...(item.kind === "sql" ? sqlSection(item, i, o, t, dark) : pySection(item, i, o, t, dark))));
  return {
    pageSize: "A4", pageMargins: [MARGIN, 52, MARGIN, 46],
    info: { title: o.title, creator: "DataForge", producer: "DataForge Visual Learning Notes", subject: "Study notes" },
    defaultStyle: { font: "DejaVuSans", fontSize: 9, lineHeight: 1.25, color: t.ink },
    background: dark ? () => ({ canvas: [{ type: "rect", x: 0, y: 0, w: PAGE_W, h: 841.89, color: t.bg }] }) : undefined,
    header: (page) => (page === 1 && (multi || o.branding) ? null : {
      columns: [{ text: o.branding ? "DataForge · Visual Learning Notes" : "", fontSize: 7, color: t.faint }, { text: o.title, fontSize: 7, color: t.faint, alignment: "right" }],
      margin: [MARGIN, 22, MARGIN, 0],
    }),
    footer: (page, pages) => (o.pageNumbers && !(page === 1 && (multi || o.branding)) ? {
      columns: [{ text: o.date ? generatedAt : "", fontSize: 7, color: t.faint }, { text: `${page} / ${pages}`, fontSize: 7, color: t.faint, alignment: "right" }],
      margin: [MARGIN, 14, MARGIN, 0],
    } : null),
    content,
  };
}
