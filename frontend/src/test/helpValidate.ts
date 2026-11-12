// Shared checks for DataForge Guide content (used by the content tests). Node only: reads the repo.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GlossaryEntry, HelpLink, HelpSection } from "../site/help/types";

const root = join(__dirname, "..", "..");
const src = join(root, "src", "site");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const slugsIn = (dir: string, ext: string) => readdirSync(join(src, "content", dir)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length));

/** Route patterns declared in routes.tsx (the real ones; nothing is invented). */
export const ROUTE_PATTERNS: string[] = [...readFileSync(join(src, "routes.tsx"), "utf8").matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "*");

const frontSlug = (dir: string, ext: string) => readdirSync(join(src, "content", dir)).filter((f) => f.endsWith(ext)).map((f) => /^slug:\s*(\S+)/m.exec(readFileSync(join(src, "content", dir, f), "utf8"))?.[1] ?? f.slice(0, -ext.length));
const companyIds = () => [...(/COMPANY_TYPES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(readFileSync(join(src, "lib", "career.ts"), "utf8"))?.[1] ?? "").matchAll(/^\s{4}id:\s*"([^"]+)"/gm)].map((m) => m[1]);
const noteSlugs = () => walk(join(src, "content", "notes")).filter((f) => f.endsWith(".md")).map((f) => /^slug:\s*(\S+)/m.exec(readFileSync(f, "utf8"))?.[1] ?? f.split("/").pop()!.slice(0, -3));

export const CONTENT: Record<string, Set<string>> = {
  questions: new Set((JSON.parse(readFileSync(join(root, "public", "data", "index.json"), "utf8")) as { slug: string }[]).map((q) => q.slug)),
  topics: new Set((JSON.parse(readFileSync(join(root, "public", "data", "topics.json"), "utf8")) as { slug: string }[]).map((t) => t.slug)),
  python: new Set(slugsIn("python", ".md")),
  scenarios: new Set(slugsIn("scenarios", ".md")),
  projects: new Set(slugsIn("projects", ".md")),
  concepts: new Set(slugsIn("concepts", ".md")),
  patterns: new Set(slugsIn("patterns", ".md")),
  mindmaps: new Set(slugsIn("mindmaps", ".json")),
  lessons: new Set(frontSlug("lessons", ".md")),
  sets: new Set(frontSlug("sets", ".md")),
  shortcuts: new Set(["comparisons", "interview-revision"]),
  companies: new Set(companyIds()),
  notes: new Set(noteSlugs()),
};

const DYNAMIC: [prefix: string, set: keyof typeof CONTENT][] = [
  ["/questions/", "questions"], ["/topics/", "topics"], ["/practice/python/", "python"], ["/scenarios/", "scenarios"],
  ["/projects-lab/", "projects"], ["/concepts/", "concepts"], ["/patterns/", "patterns"], ["/mindmaps/", "mindmaps"],
  ["/learn/", "lessons"], ["/notes/", "notes"], ["/interview/", "sets"], ["/shortcuts/", "shortcuts"], ["/career/companies/", "companies"],
];

/** Why a link target is not real, or null when it is. */
export function brokenLink(to: string): string | null {
  const path = to.split(/[?#]/)[0];
  if (ROUTE_PATTERNS.includes(path)) return null;
  const day = /^\/daily\/(?:(analyst|engineer)\/)?day\/(\d+)$/.exec(path);
  if (day) {
    const n = Number(day[2]);
    return day[1] ? (n >= 91 && n <= 180 ? null : `day ${n} is not an ${day[1]} day (91-180)`) : n >= 1 && n <= 90 ? null : `day ${n} is not a common day (1-90)`;
  }
  const dyn = DYNAMIC.find(([prefix]) => path.startsWith(prefix) && path.length > prefix.length);
  if (dyn) return CONTENT[dyn[1]].has(path.slice(dyn[0].length)) ? null : `no ${dyn[1]} item "${path.slice(dyn[0].length)}"`;
  return `no such route (${path})`;
}

const SRC_TEXT = walk(src).filter((f) => /\.(tsx?|md|json)$/.test(f) && !f.includes("/help/")).map((f) => readFileSync(f, "utf8")).join("\n").toLowerCase();
/** True when the visible label appears somewhere in the app source (so a control name is not invented). */
export function labelExists(name: string): boolean {
  const parts = name.replace(/\(.*?\)/g, " ").split(/\s*(?:\/| or | and |,|\+)\s*/i).map((p) => p.replace(/[?!.…"“”]/g, "").trim().toLowerCase()).filter((p) => p.length > 1);
  return parts.some((p) => SRC_TEXT.includes(p));
}

const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const min = (list: unknown[] | undefined, n: number) => (list?.length ?? 0) >= n;

export function checkSection(s: HelpSection): string[] {
  const e: string[] = [];
  const w = (cond: unknown, msg: string) => { if (!cond) e.push(`${s.id}: ${msg}`); };
  w(kebab.test(s.id), "id must be kebab-case");
  for (const k of ["title", "blurb", "home"] as const) w(s[k]?.trim(), `${k} empty`);
  w(s.blurb.length <= 140, "blurb over 140 chars");
  for (const k of ["what", "why", "when"] as const) w(s.overview?.[k]?.trim().length > 20, `overview.${k} too short`);
  w(min(s.routes, 1), "needs routes");
  w(s.routes.includes(s.home), "home must be one of routes");
  w(!s.home.includes(":"), "home must have no params");
  w(min(s.keywords, 3), "needs >=3 keywords");
  w(min(s.canDo, 3), "canDo needs >=3");
  w(min(s.howTo, 3), "howTo needs >=3");
  w(min(s.controls, 3), "controls needs >=3");
  w(min(s.mistakes, 2), "mistakes needs >=2");
  w(min(s.tips, 2), "tips needs >=2");
  w(min(s.related, 1), "related needs >=1");
  w(min(s.recommendations, 1), "recommendations needs >=1");
  w(min(s.topics, 3), "topics needs >=3");
  const ids = [...s.topics.map((t) => t.id), ...(s.tour?.steps.map((t) => t.id) ?? [])];
  w(new Set(s.topics.map((t) => t.id)).size === s.topics.length, "duplicate topic ids");
  w(new Set(s.tour?.steps.map((t) => t.id)).size === (s.tour?.steps.length ?? 0), "duplicate tour step ids");
  void ids;
  if (s.tour) {
    w(s.tour.id === s.id, "tour.id should equal the section id (progress is keyed by it)");
    w(s.tour.steps.length >= 5 && s.tour.steps.length <= 9, "tour needs 5-9 steps");
    for (const st of s.tour.steps) {
      w(st.title && st.body, `tour step ${st.id} needs title and body`);
      for (const sel of [st.target ?? []].flat()) {
        try { document.createDocumentFragment().querySelector(sel); } catch { w(false, `tour step ${st.id}: bad selector ${sel}`); }
      }
    }
  }
  if (s.example) {
    w(s.example.code.trim(), "example code empty");
    w(s.example.expected.trim() && s.example.explains.trim(), "example needs explains and expected");
    if (s.example.language === "sql") w(s.example.expectedRows, "SQL example needs expectedRows");
    if (s.example.language === "python") w(s.example.expectedStdout !== undefined, "Python example needs expectedStdout");
  }
  if (!s.pending) {
    for (const r of [s.tour?.route, ...(s.tour?.steps.map((x) => x.route) ?? [])]) if (r) { const b = brokenLink(r); w(!b, `tour route ${r}: ${b}`); w(!r.includes(":"), `tour route ${r} must be concrete`); }
    for (const r of s.routes) w(ROUTE_PATTERNS.includes(r), `route ${r} is not in routes.tsx`);
    const links: HelpLink[] = [...s.related, ...s.recommendations];
    for (const l of links) { const b = brokenLink(l.to); w(!b, `link "${l.label}" -> ${l.to}: ${b}`); }
    for (const c of s.controls) w(labelExists(c.name), `control "${c.name}" not found anywhere in app source (invented?)`);
  } else {
    for (const l of [...s.related, ...s.recommendations]) {
      if (!l.to.startsWith("/visual")) { const b = brokenLink(l.to); w(!b, `link "${l.label}" -> ${l.to}: ${b}`); }
    }
  }
  return e;
}

export function checkGlossary(g: GlossaryEntry[], sectionIds: Set<string>): string[] {
  const e: string[] = [];
  const seen = new Set<string>();
  for (const x of g) {
    if (!kebab.test(x.id)) e.push(`glossary ${x.id}: id must be kebab-case`);
    if (seen.has(x.id)) e.push(`glossary ${x.id}: duplicate`);
    seen.add(x.id);
    if (!x.term.trim() || x.short.length < 20 || x.short.length > 320) e.push(`glossary ${x.id}: short must be 20-320 chars`);
    if (x.section && !sectionIds.has(x.section)) e.push(`glossary ${x.id}: unknown section ${x.section}`);
  }
  return e;
}

/** Glossary ids used by `<HelpTooltip id="...">` anywhere in the app. */
export function tooltipIdsInSource(): { id: string; file: string }[] {
  const out: { id: string; file: string }[] = [];
  for (const f of walk(src).filter((p) => p.endsWith(".tsx") && !p.includes("/help/"))) {
    for (const m of readFileSync(f, "utf8").matchAll(/<HelpTooltip\b[^>]*?\bid="([^"]+)"/gs)) out.push({ id: m[1], file: f.replace(src, "") });
  }
  return out;
}

/** Accessible names of every `<HelpTooltip label="...">` in the app. */
export function tooltipLabelsInSource(): { label: string; file: string }[] {
  const out: { label: string; file: string }[] = [];
  for (const f of walk(src).filter((p) => p.endsWith(".tsx") && !p.includes("/help/"))) {
    for (const m of readFileSync(f, "utf8").matchAll(/<HelpTooltip\b[^>]*?\blabel="([^"]+)"/gs)) out.push({ label: m[1], file: f.replace(src, "") });
  }
  return out;
}

/** Button and link names the browser tests look up by role; a tooltip whose name contains one makes that locator ambiguous. */
export function e2eControlNames(): (string | RegExp)[] {
  const names: (string | RegExp)[] = [];
  for (const f of readdirSync(join(root, "e2e")).filter((x) => x.endsWith(".spec.ts") && !x.startsWith("help"))) {
    const text = readFileSync(join(root, "e2e", f), "utf8");
    for (const m of text.matchAll(/getByRole\("(?:button|link)",\s*\{\s*name:\s*(?:"([^"]+)"|\/((?:[^/\\]|\\.)+)\/(i?))([^}]*)\}/g)) {
      if (/exact:\s*true/.test(m[4] ?? "")) continue;
      names.push(m[1] ?? new RegExp(m[2].replace(/\\\//g, "/"), m[3]));
    }
  }
  return names;
}
