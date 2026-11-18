// @vitest-environment node
// The pages as the build step renders them: the workspace blocks are in the server HTML with the empty progress snapshot,
// every workspace link is /workspace?e=<encoded real id>, and the existing page structure is intact.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { render, setJsonFetcher } from "../site/entry-server";
import { loadAllProjects } from "../site/lib/projects";
import { loadExerciseById } from "../site/workspace/sources";
import { PROJECT_TASK_EXERCISES } from "../site/lib/workspaceLinks";
import { LEARN_PATHS } from "../site/lib/learnPaths";

beforeAll(() => { setJsonFetcher(async (p) => JSON.parse(await readFile(join(__dirname, "../../public", p), "utf8"))); });

const wsIds = (html: string) => [...html.matchAll(/href="\/workspace\?e=([^"]+)"/g)].map((m) => decodeURIComponent(m[1].replace(/&amp;/g, "&")));

describe("server-rendered pages", () => {
  it("a Learn hub topic page has the block, with real ids and no progress", async () => {
    const { html } = await render("/learn/topic/left-join");
    expect(html).toContain("Practise in the workspace");
    expect(html).toContain('data-testid="workspace-practice"');
    const ids = wsIds(html);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids.length).toBeLessThanOrEqual(5);
    for (const id of ids) expect(await loadExerciseById(id), id).not.toBeNull();
    expect(html).not.toMatch(/\d+ of \d+ solved<\/span><\/div><p/);
    expect(html).toContain("SQL questions"); // the existing Practice section is untouched
    expect(html).not.toMatch(/undefined|NaN|\[object/);
  });

  it("an analytics module (Daily phase) links its lessons' exercises, and a topic with none shows no block", async () => {
    const eda = await render("/learn/topic/eda");
    expect(wsIds(eda.html).length).toBeGreaterThan(0);
    const none = await render("/learn/topic/dbt-models");
    expect(none.html).not.toContain("Practise in the workspace");
    expect(none.html).toContain("No graded practice is linked to this topic yet");
  });

  it.each(LEARN_PATHS.map((p) => p.id))("path %s links the first exercise of its first lesson", async (id) => {
    const { html } = await render(`/learn/path/${id}`);
    const m = /data-testid="path-workspace-step"[^>]*data-exercise-id="([^"]+)"/.exec(html);
    expect(m, id).toBeTruthy();
    expect(await loadExerciseById(m![1])).not.toBeNull();
    expect(html).toContain("Practical exercises");
  });

  it("every project page offers an entry point on exactly its linked sql and python tasks", async () => {
    for (const p of await loadAllProjects()) {
      const { html } = await render(`/projects-lab/${p.slug}`);
      const linked = p.tasks.filter((t) => PROJECT_TASK_EXERCISES[`${p.slug}/${t.id}`]).length;
      expect((html.match(/data-testid="task-practice"/g) ?? []).length, p.slug).toBe(linked);
      for (const id of wsIds(html)) expect(await loadExerciseById(id), `${p.slug} ${id}`).not.toBeNull();
      expect(html).toContain("Submit your project");
    }
  }, 120_000);

  it("scenario, topic and question list pages link real questions", async () => {
    const sc = await render("/scenarios/monthly-revenue-growth");
    expect(sc.html).toContain("Practise the concept first");
    expect(wsIds(sc.html)).toEqual(["sql:q152-month-over-month-revenue-change"]);
    const topic = await render("/topics/left-join");
    expect(wsIds(topic.html)).toHaveLength(1);
    const list = await render("/questions");
    expect(wsIds(list.html)).toEqual(["sql:q01-product-revenue"]);
  });
});
