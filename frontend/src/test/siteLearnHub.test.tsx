// @vitest-environment node
// The Learn hub as the build step renders it: real data, server-rendered, no browser. Checks what a crawler and a first
// paint see: structure, links, SEO tags, and that nothing depends on the visitor (progress, time) before hydration.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { allPaths, render, setJsonFetcher } from "../site/entry-server";
import { LEARN_PATHS } from "../site/lib/learnPaths";
import { learnTopicIds, loadLearnHub } from "../site/lib/learnLoad";
import { matchRoute } from "../site/routes";

beforeAll(() => {
  setJsonFetcher(async (p) => JSON.parse(await readFile(join(__dirname, "../../public", p), "utf8")));
});

const hrefs = (html: string) => [...new Set([...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
const internal = (list: string[]) => list.filter((h) => h.startsWith("/") && !h.startsWith("//"));

describe("/learn (hub)", () => {
  it("renders the hero, four paths, the first page of topics, the roadmap, practice and resources", async () => {
    const { html, page, noindex } = await render("/learn");
    expect(page.notFound).toBe(false);
    expect(noindex).toBe(false);
    expect(html).toContain("Learn data skills, in the right order");
    for (const p of LEARN_PATHS) {
      expect(html).toContain(p.title);
      expect(html).toContain(`href="/learn/path/${p.id}"`);
    }
    expect((html.match(/data-topic="/g) ?? []).length).toBe(12);
    expect(html).toContain("Showing 12 of 178 topics");
    expect(html).toContain("Curriculum roadmap");
    expect(html).toContain("Hands-on practice and projects");
    expect(html).toContain("Learning resources");
    expect(html).not.toMatch(/undefined|NaN|\[object/);
  });

  it("shows nothing that depends on the visitor before hydration", async () => {
    const { html } = await render("/learn");
    expect(html).toContain('aria-busy="true"'); // the continue card is a skeleton until the browser knows the progress
    expect(html).not.toContain("Recommended for you");
    expect(html).not.toMatch(/\d+ (minutes?|hours?|days?) ago|just now/);
    expect(html).toContain("Not started");
  });

  it("every internal link opens a real page", async () => {
    const { html } = await render("/learn");
    for (const h of internal(hrefs(html))) {
      const path = h.split(/[?#]/)[0] || "/";
      expect(matchRoute(path).route.path, `${h} is not a route`).not.toBe("*");
    }
  });

  it("has a descriptive title and the paths as structured data", async () => {
    const { head } = await render("/learn");
    expect(head).toContain("<title>Learn SQL, Python, Data Analytics and Data Engineering");
    expect(head).toContain('rel="canonical"');
    expect(head).toContain("ItemList");
    expect(head).toContain("/learn/path/data-engineer");
  });

  it("keeps the embedded page data compact", async () => {
    const { page } = await render("/learn");
    const bytes = JSON.stringify({ ...page.data, index: undefined, topics: undefined }).length;
    expect(bytes).toBeLessThan(120_000);
    expect(page.data.learnHub?.topics).toHaveLength(178);
    expect(page.data.notes).toBeUndefined();
  });
});

describe("/learn/path/:id", () => {
  it.each(LEARN_PATHS.map((p) => [p.id, p.title] as const))("%s renders objectives, modules, notes, practice and a final project", async (id, title) => {
    const { html, head, noindex } = await render(`/learn/path/${id}`);
    expect(noindex).toBe(false);
    expect(html).toContain(`>${title}</h1>`);
    for (const h of ["What you will learn", "Before you start", "Modules and lessons", "Notes for this path", "Practical exercises", "Final project"]) expect(html).toContain(h);
    expect(head).toContain('"@type":"Course"');
    expect(html).not.toMatch(/undefined|NaN|\[object/);
    for (const h of internal(hrefs(html))) expect(matchRoute(h.split(/[?#]/)[0] || "/").route.path, `${id}: ${h}`).not.toBe("*");
  });

  it("the SQL path carries the course: all 18 lessons are linked, and the old Course structured data moved with it", async () => {
    const { html, head } = await render("/learn/path/sql-developer");
    expect((html.match(/href="\/learn\/[a-z0-9-]+"/g) ?? []).filter((h) => !/path|topic/.test(h)).length).toBeGreaterThanOrEqual(18);
    expect(head).toContain("Learn SQL from scratch");
    expect(head).toContain("syllabusSections");
  });

  it("an unknown path is not found", async () => {
    const { page, noindex } = await render("/learn/path/does-not-exist");
    expect(page.notFound).toBe(true);
    expect(noindex).toBe(true);
  });
});

describe("/learn/topic/:slug", () => {
  it("is prerendered for every note and analytics module, and nothing else", async () => {
    const ids = await learnTopicIds();
    expect(ids).toHaveLength(178);
    const paths = await allPaths();
    const topicPaths = paths.filter((p) => p.startsWith("/learn/topic/"));
    expect(topicPaths).toHaveLength(ids.length);
    expect(new Set(topicPaths).size).toBe(topicPaths.length);
  });

  it.each(["left-join", "python-pandas", "etl-incremental-load", "excel", "analyst-capstone"])("%s renders with its resources and no dead links", async (id) => {
    const { html, head, page } = await render(`/learn/topic/${id}`);
    expect(page.notFound).toBe(false);
    expect(html).toContain("<h1");
    expect(head).toContain("notes, practice and projects");
    expect(html).not.toMatch(/undefined|NaN|\[object/);
    for (const h of internal(hrefs(html))) expect(matchRoute(h.split(/[?#]/)[0] || "/").route.path, `${id}: ${h}`).not.toBe("*");
    expect(JSON.stringify(page.data.learnTopic).length).toBeLessThan(40_000);
  });

  it("a note topic links its note and its interview section, and never claims mastery", async () => {
    const { html } = await render("/learn/topic/left-join");
    expect(html).toContain('href="/notes/left-join"');
    expect(html).toContain('href="/notes/left-join#interview-questions"');
    expect(html).not.toMatch(/Mastered|mastered/);
  });

  it("an unknown topic is not found", async () => {
    expect((await render("/learn/topic/does-not-exist")).page.notFound).toBe(true);
  });

  it("every topic in the hub resolves to a page", async () => {
    const hub = await loadLearnHub();
    const ids = new Set(await learnTopicIds());
    for (const t of hub.topics) expect(ids.has(t.id), t.id).toBe(true);
  });
});

describe("/dashboard", () => {
  it("is the old dashboard, whole, and is kept out of search results", async () => {
    const { html, noindex } = await render("/dashboard");
    expect(noindex).toBe(true);
    expect(html).toContain("Your learning dashboard");
    for (const h of ["What to do next", "Skill mastery", "Revision and mistakes", "Study modules"]) expect(html).toContain(h);
    expect(html).toContain('href="/learn"');
  });
});

describe("lessons keep working", () => {
  it("a lesson links back to the SQL path", async () => {
    const { html } = await render("/learn/select-basics");
    expect(html).toContain('href="/learn/path/sql-developer"');
  });
});
