// @vitest-environment node
// Contract tests for learning content (docs/CONTENT_SPEC.md): references resolve, and every
// runnable SQL block / shortcut example runs on the browser Northwind database and returns rows.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import indexJson from "../../public/data/index.json";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { NOTE_CATEGORIES, countNodes, parseNote, parsePattern, splitFrontmatter, walkNodes, type MapNode, type MindMap, type ShortcutCategory } from "../site/lib/learning";
import { layoutTree } from "../site/components/MindMapCanvas";
import { search, type SearchDoc } from "../site/lib/searchIndex";

const raw = (g: Record<string, string>) => Object.entries(g);
const noteFiles = raw(import.meta.glob<string>("../site/content/notes/*/*.md", { eager: true, query: "?raw", import: "default" }));
const patternFiles = raw(import.meta.glob<string>("../site/content/patterns/*.md", { eager: true, query: "?raw", import: "default" }));
const guideFiles = raw(import.meta.glob<string>("../site/content/concepts/*.md", { eager: true, query: "?raw", import: "default" }));
const shortcutPages = raw(import.meta.glob<string>("../site/content/shortcuts/*.md", { eager: true, query: "?raw", import: "default" }));
const shortcutFiles = Object.values(import.meta.glob<ShortcutCategory>("../site/content/shortcuts/*.json", { eager: true, import: "default" }));
const mapFiles = Object.values(import.meta.glob<MindMap>("../site/content/mindmaps/*.json", { eager: true, import: "default" }));

const fileSlug = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");
const notes = noteFiles.map(([p, r]) => ({ path: p, ...parseNote(r, fileSlug(p), p.split("/").slice(-2, -1)[0]) }));
const patterns = patternFiles.map(([p, r]) => ({ path: p, ...parsePattern(r, fileSlug(p)) }));
const noteSlugs = new Set(notes.map((n) => n.slug));
const patternSlugs = new Set(patterns.map((p) => p.slug));
const guideSlugs = new Set(guideFiles.map(([p]) => fileSlug(p)));
const questionNums = new Set((indexJson as { number: number }[]).map((q) => q.number));

const NOTE_HEADINGS = [
  "Introduction", "Definition", "Why it matters", "How it works", "Syntax", "Simple examples", "Intermediate examples",
  "Advanced examples", "Real-world scenarios", "PostgreSQL specifics", "Visual explanation", "Common mistakes",
  "Performance", "Interview questions", "Quick revision",
];
const PATTERN_HEADINGS = ["Problem", "When to use it", "Solution", "Alternatives", "How it works", "Execution walkthrough", "Common mistakes", "Performance"];

const sqlBlocks = (body: string) => [...body.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1].trim());
const h2 = (body: string) => [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
const isSubsequence = (got: string[], want: string[]) => {
  let i = 0;
  for (const h of got) if (h === want[i]) i++;
  return got.every((h) => want.includes(h)) && got.length >= want.length - 3 && i === got.length;
};

describe("notes", () => {
  it("exist and have unique slugs in known categories", () => {
    expect(notes.length).toBeGreaterThan(50);
    expect(noteSlugs.size).toBe(notes.length);
    const cats = new Set(NOTE_CATEGORIES.map((c) => c.slug));
    expect(notes.filter((n) => !cats.has(n.category)).map((n) => n.path)).toEqual([]);
  });
  it("use the spec's section headings in order", () => {
    expect(notes.filter((n) => !isSubsequence(h2(n.body), NOTE_HEADINGS)).map((n) => `${n.slug}: ${h2(n.body).join(" | ")}`)).toEqual([]);
  });
  it("only reference things that exist", () => {
    const bad: string[] = [];
    for (const n of notes) {
      for (const s of [...n.prerequisites, ...n.related]) if (!noteSlugs.has(s)) bad.push(`${n.slug} → note ${s}`);
      for (const s of n.patterns) if (!patternSlugs.has(s)) bad.push(`${n.slug} → pattern ${s}`);
      for (const s of n.guides) if (!guideSlugs.has(s)) bad.push(`${n.slug} → guide ${s}`);
      for (const q of n.questions) if (!questionNums.has(q)) bad.push(`${n.slug} → Q${q}`);
      if (n.description.length > 160) bad.push(`${n.slug}: description ${n.description.length} chars`);
    }
    expect(bad).toEqual([]);
  });
});

describe("patterns", () => {
  it("follow the spec and reference things that exist", () => {
    expect(patterns.length).toBeGreaterThanOrEqual(20);
    const bad: string[] = [];
    for (const p of patterns) {
      if (!isSubsequence(h2(p.body), PATTERN_HEADINGS)) bad.push(`${p.slug}: headings ${h2(p.body).join(" | ")}`);
      for (const s of p.notes) if (!noteSlugs.has(s)) bad.push(`${p.slug} → note ${s}`);
      for (const s of p.guides) if (!guideSlugs.has(s)) bad.push(`${p.slug} → guide ${s}`);
      for (const q of p.questions) if (!questionNums.has(q)) bad.push(`${p.slug} → Q${q}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("shortcuts and mind maps", () => {
  it("shortcuts link to real notes and have the comparison pages", () => {
    expect(shortcutFiles.length).toBe(13);
    const ids = shortcutFiles.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(shortcutFiles.flatMap((c) => c.items.flatMap((i) => i.notes.filter((s) => !noteSlugs.has(s)).map((s) => `${i.id} → ${s}`)))).toEqual([]);
    expect(shortcutPages.map(([p]) => fileSlug(p)).sort()).toEqual(["comparisons", "interview-revision"]);
    for (const [, r] of shortcutPages) expect(splitFrontmatter(r).meta.title).toBeTruthy();
  });
  it("mind maps are valid trees whose links resolve", () => {
    expect(mapFiles.length).toBe(10);
    const bad: string[] = [];
    for (const m of mapFiles) {
      const ids = new Set<string>();
      let depth = 0;
      walkNodes(m.root, (n: MapNode, d) => {
        if (ids.has(n.id)) bad.push(`${m.slug}: duplicate ${n.id}`);
        ids.add(n.id);
        depth = Math.max(depth, d);
        if (n.note && !noteSlugs.has(n.note)) bad.push(`${m.slug}/${n.id} → note ${n.note}`);
        if (n.pattern && !patternSlugs.has(n.pattern)) bad.push(`${m.slug}/${n.id} → pattern ${n.pattern}`);
        for (const q of n.questions ?? []) if (!questionNums.has(q)) bad.push(`${m.slug}/${n.id} → Q${q}`);
      });
      walkNodes(m.root, (n) => (n.prereq ?? []).forEach((p) => !ids.has(p) && bad.push(`${m.slug}/${n.id} → prereq ${p}`)));
      if (depth > 4) bad.push(`${m.slug}: depth ${depth}`);
      const size = countNodes(m.root);
      if (size < 15 || size > 45) bad.push(`${m.slug}: ${size} nodes`);
    }
    expect(bad).toEqual([]);
  });
  it("lays out a tree without overlaps and hides collapsed branches", () => {
    const root: MapNode = { id: "r", label: "r", children: [{ id: "a", label: "a", children: [{ id: "a1", label: "a1" }, { id: "a2", label: "a2" }] }, { id: "b", label: "b" }] };
    const open = layoutTree(root, new Set());
    expect(open.size).toBe(5);
    expect(new Set([...open.values()].filter((p) => p.depth === 2).map((p) => p.y)).size).toBe(2);
    expect(open.get("a")!.y).toBe((open.get("a1")!.y + open.get("a2")!.y) / 2);
    const closed = layoutTree(root, new Set(["a"]));
    expect(closed.has("a1")).toBe(false);
  });
});

describe("search", () => {
  const docs: SearchDoc[] = [
    { kind: "Question", title: "Q25 Customers and order count", path: "/q", text: "left join" },
    { kind: "Note", title: "LEFT JOIN", path: "/n", text: "keeps all rows" },
  ];
  it("needs every word and ranks title hits first", () => {
    expect(search(docs, "left join").map((d) => d.path)).toEqual(["/n", "/q"]);
    expect(search(docs, "left nothing")).toEqual([]);
  });
});

describe("runnable SQL", () => {
  let db: SqlDb;
  beforeAll(async () => {
    const pg = new PGlite();
    await pg.exec(northwind);
    db = pg as unknown as SqlDb;
  }, 60_000);

  const cases = [
    ...notes.flatMap((n) => sqlBlocks(n.body).map((sql, i) => ({ where: `note ${n.slug}#${i}`, sql }))),
    ...patterns.flatMap((p) => sqlBlocks(p.body).map((sql, i) => ({ where: `pattern ${p.slug}#${i}`, sql }))),
    ...shortcutPages.flatMap(([p, r]) => sqlBlocks(r).map((sql, i) => ({ where: `${fileSlug(p)}#${i}`, sql }))),
    ...shortcutFiles.flatMap((c) => c.items.map((it) => ({ where: `shortcut ${it.id}`, sql: it.example }))),
  ];

  it("has a large body of examples", () => expect(cases.length).toBeGreaterThan(300));

  it("every block runs in the browser database and returns rows", async () => {
    const bad: string[] = [];
    for (const c of cases) {
      const r = await execute(db, c.sql);
      if (!r.success) bad.push(`${c.where}: ${r.message}`);
      else if (!r.row_count) bad.push(`${c.where}: 0 rows`);
    }
    expect(bad).toEqual([]);
  }, 300_000);
});
