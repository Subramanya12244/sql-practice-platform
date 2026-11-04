import { TRACKS } from "./tracks";
/**
 * Loaders for the learning library: theory notes, patterns, shortcuts and mind maps.
 * Content is Markdown/JSON under ../content (format: docs/CONTENT_SPEC.md).
 */

export interface NoteMeta {
  slug: string;
  title: string;
  category: string;
  difficulty: string;
  description: string;
  prerequisites: string[];
  related: string[];
  questions: number[];
  patterns: string[];
  guides: string[];
  /** Projects Lab slugs that apply this topic (data engineering tracks). */
  projects: string[];
  minutes: number;
  version: number;
}
export interface Note extends NoteMeta {
  body: string;
}

export interface PatternMeta {
  slug: string;
  title: string;
  category: string;
  difficulty: string;
  description: string;
  questions: number[];
  notes: string[];
  guides: string[];
}
export interface Pattern extends PatternMeta {
  body: string;
}

export interface ShortcutItem {
  id: string;
  operation: string;
  syntax: string;
  explanation: string;
  example: string;
  expected: string;
  notes: string[];
}
export interface ShortcutCategory {
  category: string;
  title: string;
  order: number;
  items: ShortcutItem[];
}

export interface MapNode {
  id: string;
  label: string;
  detail?: string;
  note?: string;
  pattern?: string;
  questions?: number[];
  prereq?: string[];
  children?: MapNode[];
}
export interface MindMap {
  slug: string;
  title: string;
  description: string;
  root: MapNode;
}
export type MindMapMeta = Pick<MindMap, "slug" | "title" | "description"> & { nodes: number };

export interface MarkdownPage {
  slug: string;
  title: string;
  description: string;
  body: string;
}

/** `group` separates the SQL library from the data engineering tracks. */
export const NOTE_CATEGORIES: { slug: string; label: string; group: "sql" | "de" }[] = [
  { slug: "fundamentals", label: "SQL Fundamentals", group: "sql" },
  { slug: "joins", label: "JOINs", group: "sql" },
  { slug: "aggregations", label: "Aggregation", group: "sql" },
  { slug: "subqueries", label: "Subqueries", group: "sql" },
  { slug: "ctes", label: "CTEs", group: "sql" },
  { slug: "window-functions", label: "Window Functions", group: "sql" },
  { slug: "set-operators", label: "Set Operators", group: "sql" },
  { slug: "advanced-sql", label: "Advanced SQL", group: "sql" },
  ...TRACKS.map((t) => ({ slug: t.id, label: t.title, group: "de" as const })),
];

export const PATTERN_CATEGORIES: Record<string, string> = {
  dedup: "Duplicates",
  missing: "Missing & unmatched",
  ranking: "Ranking & top N",
  latest: "Latest / earliest",
  running: "Running & moving",
  dates: "Dates & sequences",
  growth: "Growth",
  reshape: "Reshaping",
  hierarchy: "Hierarchies",
};

const LEVEL_ORDER: Record<string, number> = { Beginner: 0, Intermediate: 1, Advanced: 2, Expert: 3 };
export const levelRank = (l: string) => LEVEL_ORDER[l] ?? 1;

type Loader<T> = Record<string, () => Promise<T>>;
const noteFiles = import.meta.glob("../content/notes/*/*.md", { query: "?raw", import: "default" }) as Loader<string>;
const patternFiles = import.meta.glob("../content/patterns/*.md", { query: "?raw", import: "default" }) as Loader<string>;
const shortcutFiles = import.meta.glob("../content/shortcuts/*.json", { import: "default" }) as Loader<ShortcutCategory>;
const shortcutPages = import.meta.glob("../content/shortcuts/*.md", { query: "?raw", import: "default" }) as Loader<string>;
const mapFiles = import.meta.glob("../content/mindmaps/*.json", { import: "default" }) as Loader<MindMap>;

const fileSlug = (p: string) => p.split("/").pop()!.replace(/\.(md|json)$/, "");

/** `key: value` frontmatter with `[a, b]` lists. */
export function splitFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).replace(/\s+#.*$/, "").trim();
  }
  return { meta, body: m[2].trim() };
}

const list = (v?: string) =>
  (v ?? "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
const nums = (v?: string) => list(v).map(Number).filter((n) => Number.isFinite(n));

export function parseNote(raw: string, fallback: string, folder = ""): Note {
  const { meta, body } = splitFrontmatter(raw);
  return {
    slug: meta.slug || fallback,
    title: meta.title || fallback,
    category: meta.category || folder,
    difficulty: meta.difficulty || "Beginner",
    description: meta.description || "",
    prerequisites: list(meta.prerequisites),
    related: list(meta.related),
    questions: nums(meta.questions),
    patterns: list(meta.patterns),
    guides: list(meta.guides),
    projects: list(meta.projects),
    minutes: Number(meta.minutes) || 5,
    version: Number(meta.version) || 1,
    body,
  };
}

export function parsePattern(raw: string, fallback: string): Pattern {
  const { meta, body } = splitFrontmatter(raw);
  return {
    slug: meta.slug || fallback,
    title: meta.title || fallback,
    category: meta.category || "",
    difficulty: meta.difficulty || "Intermediate",
    description: meta.description || "",
    questions: nums(meta.questions),
    notes: list(meta.notes),
    guides: list(meta.guides),
    body,
  };
}

const strip = <T extends { body: string }>({ body: _b, ...rest }: T) => rest;

let notesCache: Promise<Note[]> | null = null;
export function loadAllNotes(): Promise<Note[]> {
  notesCache ??= Promise.all(
    Object.entries(noteFiles).map(async ([p, load]) => parseNote(await load(), fileSlug(p), p.split("/").slice(-2, -1)[0])),
  ).then((all) => {
    const cat = Object.fromEntries(NOTE_CATEGORIES.map((c, i) => [c.slug, i]));
    return all.sort((a, b) => (cat[a.category] ?? 99) - (cat[b.category] ?? 99) || levelRank(a.difficulty) - levelRank(b.difficulty) || a.title.localeCompare(b.title));
  });
  return notesCache;
}
export const loadNoteIndex = async (): Promise<NoteMeta[]> => (await loadAllNotes()).map(strip);
export const loadNote = async (slug: string) => (await loadAllNotes()).find((n) => n.slug === slug);

let patternsCache: Promise<Pattern[]> | null = null;
export function loadAllPatterns(): Promise<Pattern[]> {
  patternsCache ??= Promise.all(Object.entries(patternFiles).map(async ([p, load]) => parsePattern(await load(), fileSlug(p)))).then((all) =>
    all.sort((a, b) => a.title.localeCompare(b.title)),
  );
  return patternsCache;
}
export const loadPatternIndex = async (): Promise<PatternMeta[]> => (await loadAllPatterns()).map(strip);
export const loadPattern = async (slug: string) => (await loadAllPatterns()).find((p) => p.slug === slug);

export async function loadShortcuts(): Promise<ShortcutCategory[]> {
  const all = await Promise.all(Object.values(shortcutFiles).map((load) => load()));
  return all.sort((a, b) => a.order - b.order);
}

export async function loadShortcutPage(slug: string): Promise<MarkdownPage | undefined> {
  const entry = Object.entries(shortcutPages).find(([p]) => fileSlug(p) === slug);
  if (!entry) return undefined;
  const { meta, body } = splitFrontmatter(await entry[1]());
  return { slug, title: meta.title || slug, description: meta.description || "", body };
}

export function countNodes(n: MapNode): number {
  return 1 + (n.children ?? []).reduce((s, c) => s + countNodes(c), 0);
}
export function walkNodes(n: MapNode, fn: (node: MapNode, depth: number, parent?: MapNode) => void, depth = 0, parent?: MapNode) {
  fn(n, depth, parent);
  for (const c of n.children ?? []) walkNodes(c, fn, depth + 1, n);
}

export async function loadAllMaps(): Promise<MindMap[]> {
  const all = await Promise.all(Object.values(mapFiles).map((load) => load()));
  const order = ["sql-roadmap", "execution-order"];
  return all.sort((a, b) => {
    const ia = order.indexOf(a.slug);
    const ib = order.indexOf(b.slug);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.title.localeCompare(b.title);
  });
}
export const loadMapIndex = async (): Promise<MindMapMeta[]> =>
  (await loadAllMaps()).map((m) => ({ slug: m.slug, title: m.title, description: m.description, nodes: countNodes(m.root) }));
export const loadMap = async (slug: string) => (await loadAllMaps()).find((m) => m.slug === slug);

/** Mind maps that link to a given note or pattern. */
export async function mapsLinking(kind: "note" | "pattern", slug: string): Promise<MindMapMeta[]> {
  const out: MindMapMeta[] = [];
  for (const m of await loadAllMaps()) {
    let hit = false;
    walkNodes(m.root, (n) => {
      if ((kind === "note" ? n.note : n.pattern) === slug) hit = true;
    });
    if (hit) out.push({ slug: m.slug, title: m.title, description: m.description, nodes: countNodes(m.root) });
  }
  return out;
}

/** "## Heading" list for an in-page table of contents. */
export function headings(body: string): { id: string; text: string }[] {
  return [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => ({ id: slugifyHeading(m[1]), text: m[1].trim() }));
}
export const slugifyHeading = (s: string) =>
  s.toLowerCase().replace(/[`*_]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
