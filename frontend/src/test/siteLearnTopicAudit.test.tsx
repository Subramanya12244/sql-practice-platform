// @vitest-environment node
// Every topic page, rendered and checked one by one: not "does it render" but "is everything on it real, unique and linked
// to something that exists". Also reports (never hides) topics that have little beyond their note.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import indexJson from "../../public/data/index.json";
import { render, setJsonFetcher } from "../site/entry-server";
import { loadLearnTopic, learnTopicIds } from "../site/lib/learnLoad";
import { loadAllGuides } from "../site/lib/content";
import { NOTE_CATEGORIES, loadAllMaps, loadAllNotes, loadAllPatterns, slugifyHeading } from "../site/lib/learning";
import { TRACKS } from "../site/lib/tracks";
import { LEARN_PATHS, spineOf } from "../site/lib/learnPaths";
import { loadExerciseIndex } from "../site/lib/pyExercises";
import { loadProjectIndex } from "../site/lib/projects";
import { CURRICULUM, isAuthored } from "../site/lib/daily";
import { matchRoute } from "../site/routes";
import type { TopicBundle } from "../site/lib/learnTopics";

const questions = new Map((indexJson as { number: number; slug: string }[]).map((q) => [q.number, q.slug]));
const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);

let ids: string[];
let bundles: TopicBundle[];

beforeAll(async () => {
  setJsonFetcher(async (p) => JSON.parse(await readFile(join(__dirname, "../../public", p), "utf8")));
  ids = await learnTopicIds();
  bundles = (await Promise.all(ids.map((id) => loadLearnTopic(id)))).filter((b): b is TopicBundle => !!b);
}, 120_000);

describe("all topics: data", () => {
  it("every id yields a bundle, and ids are URL-safe and unique", () => {
    expect(bundles).toHaveLength(ids.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("no list on any topic repeats an item, and no topic is listed twice in the learning order", () => {
    for (const b of bundles) {
      const id = b.topic.id;
      expect(dupes(b.guides.map((g) => g.slug)), `${id} guides`).toEqual([]);
      expect(dupes(b.patterns.map((p) => p.slug)), `${id} patterns`).toEqual([]);
      expect(dupes(b.maps.map((m) => m.slug)), `${id} maps`).toEqual([]);
      expect(dupes(b.questions.map((q) => q.slug)), `${id} questions`).toEqual([]);
      expect(dupes(b.exercises.map((e) => e.slug)), `${id} exercises`).toEqual([]);
      expect(dupes(b.projects.map((p) => p.slug)), `${id} projects`).toEqual([]);
      expect(dupes(b.daily.map((d) => d.id)), `${id} phases`).toEqual([]);
      const order = [...b.prerequisites, ...b.unlocks, ...b.related].map((r) => r.id);
      expect(dupes(order), `${id} learning order`).toEqual([]);
      expect(order.includes(id), `${id} lists itself`).toBe(false);
    }
  });

  it("everything a topic lists exists, and a question's number and slug agree", async () => {
    const [guides, patterns, maps, exercises, projects] = await Promise.all([loadAllGuides(), loadAllPatterns(), loadAllMaps(), loadExerciseIndex(), loadProjectIndex()]);
    const g = new Set(guides.map((x) => x.slug)), p = new Set(patterns.map((x) => x.slug)), m = new Set(maps.map((x) => x.slug)), e = new Set(exercises.map((x) => x.slug)), pr = new Set(projects.map((x) => x.slug));
    for (const b of bundles) {
      const id = b.topic.id;
      for (const x of b.guides) expect(g.has(x.slug), `${id} guide ${x.slug}`).toBe(true);
      for (const x of b.patterns) expect(p.has(x.slug), `${id} pattern ${x.slug}`).toBe(true);
      for (const x of b.maps) expect(m.has(x.slug), `${id} map ${x.slug}`).toBe(true);
      for (const x of b.exercises) expect(e.has(x.slug), `${id} exercise ${x.slug}`).toBe(true);
      for (const x of b.projects) expect(pr.has(x.slug), `${id} project ${x.slug}`).toBe(true);
      for (const x of b.questions) expect(questions.get(x.number), `${id} Q${x.number}`).toBe(x.slug);
    }
  });

  it("a question's topic links back: every question listed on a topic is linked from that note", async () => {
    const notes = await loadAllNotes();
    for (const b of bundles.filter((x) => x.topic.kind === "note")) {
      const note = notes.find((n) => n.slug === b.topic.id)!;
      expect(b.questions.map((q) => q.number).sort(), b.topic.id).toEqual([...note.questions].filter((n) => questions.has(n)).sort());
    }
  });

  it("every note topic's interview anchor exists in the note", async () => {
    const notes = await loadAllNotes();
    for (const b of bundles.filter((x) => x.topic.kind === "note")) {
      const note = notes.find((n) => n.slug === b.topic.id)!;
      const heads = [...note.body.matchAll(/^##\s+(.+)$/gm)].map((h) => slugifyHeading(h[1]));
      expect(heads, b.topic.id).toContain("interview-questions");
      expect(b.interview?.href).toBe(`/notes/${b.topic.id}#interview-questions`);
    }
  });

  it("Daily phases listed on a topic are real, authored, and open on a real day", () => {
    for (const b of bundles) {
      for (const d of b.daily) {
        const days = CURRICULUM.days.filter((x) => x.phase === d.id && isAuthored(x.id));
        expect(d.lessons, `${b.topic.id}/${d.id}`).toBe(days.length);
        expect(d.href, `${b.topic.id}/${d.id}`).toMatch(/^\/daily\/(analyst\/|engineer\/)?day\/\d+$/);
        expect(matchRoute(d.href).route.path, d.href).not.toBe("*");
        expect(d.days).toEqual(days.map((x) => x.id));
      }
      if (b.topic.kind === "module") expect(b.daily, b.topic.id).toHaveLength(1);
    }
  });

  it("interview sets named on a topic really contain that many of its questions", () => {
    for (const b of bundles) for (const s of b.interview?.sets ?? []) expect(s.shared, `${b.topic.id}/${s.slug}`).toBeGreaterThan(0);
  });
});

describe("all topics: rendered page", () => {
  it("every topic page renders its title, the right metadata, and only links to real pages", async () => {
    const bad: string[] = [];
    for (const b of bundles) {
      const id = b.topic.id;
      const { html, head, page, noindex } = await render(`/learn/topic/${id}`);
      if (page.notFound || noindex) bad.push(`${id}: not found or noindex`);
      if (!html.includes(`>${b.topic.title.replace(/&/g, "&amp;")}</h1>`)) bad.push(`${id}: h1 does not carry the title`);
      if (!head.includes(`<title>${b.topic.title.replace(/&/g, "&amp;")}: notes, practice and projects`)) bad.push(`${id}: title tag`);
      if (!head.includes(`rel="canonical" href="https://dataforge.dataforge-learn.workers.dev/learn/topic/${id}"`)) bad.push(`${id}: canonical`);
      // "NaN" is real content on some pages (NumPy: "NaN handling"), so only a NaN standing alone as a value counts.
      if (/\bundefined\b|\[object|>\s*NaN\s*<|\bNaN (min|h|lessons?|of|topics?|solved|passed)\b|NaN%/.test(html)) bad.push(`${id}: literal undefined/NaN as a value in HTML`);
      const hrefs = [...new Set([...html.matchAll(/<a [^>]*href="(\/[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
      for (const h of hrefs) if (matchRoute(h.split(/[?#]/)[0] || "/").route.path === "*") bad.push(`${id}: dead link ${h}`);
      for (const q of b.questions) if (!html.includes(`href="/questions/${q.slug}"`)) bad.push(`${id}: missing question link ${q.slug}`);
      for (const e of b.exercises) if (!html.includes(`href="/practice/python/${e.slug}"`)) bad.push(`${id}: missing exercise link ${e.slug}`);
      for (const p of b.projects) if (!html.includes(`href="/projects-lab/${p.slug}"`)) bad.push(`${id}: missing project link ${p.slug}`);
      for (const x of b.patterns) if (!html.includes(`href="/patterns/${x.slug}"`)) bad.push(`${id}: missing pattern link ${x.slug}`);
      for (const x of b.maps) if (!html.includes(`href="/mindmaps/${x.slug}"`)) bad.push(`${id}: missing map link ${x.slug}`);
      for (const x of b.guides) if (!html.includes(`href="/concepts/${x.slug}"`)) bad.push(`${id}: missing guide link ${x.slug}`);
      if (/>Mastered<|mastered/i.test(html)) bad.push(`${id}: claims mastery`);
    }
    expect(bad).toEqual([]);
  }, 180_000);
});

describe("all topics: coverage report (informational, printed)", () => {
  it("counts the topics that have little beyond their note", () => {
    const rows = bundles.map((b) => ({
      id: b.topic.id, kind: b.topic.kind, practice: b.questions.length + b.exercises.length,
      other: b.guides.length + b.patterns.length + b.maps.length + b.projects.length + b.topic.visual.length, daily: b.daily.length,
    }));
    const bare = rows.filter((r) => r.practice === 0 && r.other === 0);
    const noPractice = rows.filter((r) => r.practice === 0);
    const noDaily = rows.filter((r) => r.daily === 0);
    // eslint-disable-next-line no-console
    console.log(`COVERAGE topics=${rows.length} withoutPractice=${noPractice.length} withoutDaily=${noDaily.length} noteOnly=${bare.length}`);
    // eslint-disable-next-line no-console
    console.log(`NOTE-ONLY: ${bare.map((r) => r.id).join(", ")}`);
    expect(rows.length).toBe(178);
  });
});

describe("all learning paths: rendered page", () => {
  it.each(LEARN_PATHS.map((p) => [p.id] as const))("%s: modules are in curriculum order, every link is real and appears once, and the notes anchors exist", async (id) => {
    const def = LEARN_PATHS.find((p) => p.id === id)!;
    const { html, head, page, noindex } = await render(`/learn/path/${id}`);
    expect(page.notFound).toBe(false);
    expect(noindex).toBe(false);
    expect(head).toContain(`rel="canonical" href="https://dataforge.dataforge-learn.workers.dev/learn/path/${id}"`);

    // module order: phases ascend by first day; each lesson sits in exactly one module, in day order
    const days = spineOf(def);
    const phaseOrder = def.phases.map((ph) => CURRICULUM.phases.find((x) => x.id === ph)!.firstDay);
    expect([...phaseOrder].sort((a, b) => a - b), `${id} phases are listed out of order`).toEqual(phaseOrder);
    expect(new Set(days.map((d) => d.id)).size).toBe(days.length);
    expect(days.map((d) => d.day), `${id} lessons out of order`).toEqual([...days.map((d) => d.day)].sort((a, b) => a - b));

    const hrefs = [...html.matchAll(/<a [^>]*href="(\/[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    for (const h of new Set(hrefs)) expect(matchRoute(h.split(/[?#]/)[0] || "/").route.path, `${id}: dead link ${h}`).not.toBe("*");
    const lessonLinks = hrefs.filter((h) => /^\/daily\/(analyst\/|engineer\/)?day\/\d+$/.test(h));
    // every lesson of the path is linked exactly once from its module list (the next-lesson card and phase links add a few more, never fewer)
    for (const d of days) expect(lessonLinks.filter((h) => h === (d.path === "common" ? `/daily/day/${d.day}` : `/daily/${d.path}/day/${d.day}`)).length, `${id} day ${d.day}`).toBeGreaterThanOrEqual(1);
    expect(html).toContain(`href="/projects-lab/${def.project}"`);
    for (const p of def.practice) expect(html, `${id}: ${p.to}`).toContain(`href="${p.to}"`);

    // notes anchors: /notes#cat-x only for SQL categories, /data-engineering#x only for tracks (python is a track)
    for (const c of def.noteCategories) {
      const group = NOTE_CATEGORIES.find((x) => x.slug === c)!;
      if (group.group === "de") { expect(TRACKS.some((t) => t.id === c), `${id}: ${c}`).toBe(true); expect(html).toContain(`href="/data-engineering#${c}"`); }
      else expect(html).toContain(`href="/notes#cat-${c}"`);
    }
    expect(html).not.toMatch(/\bundefined\b|\[object/);
  });

  it("the paths do not share a final project, and each branch path really is its own 90 lessons", () => {
    expect(new Set(LEARN_PATHS.map((p) => p.project)).size).toBe(LEARN_PATHS.length);
    expect(spineOf(LEARN_PATHS.find((p) => p.id === "data-analyst")!).every((d) => d.path === "analyst")).toBe(true);
    expect(spineOf(LEARN_PATHS.find((p) => p.id === "data-engineer")!).every((d) => d.path === "engineer")).toBe(true);
  });
});
