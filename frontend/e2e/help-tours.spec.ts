import { test, expect } from "./fixtures";

/**
 * Every guided tour, run for real. For each step the tour card must appear, and when the step names a target the
 * highlight must land on a visible element, so help can never point at something that is not there.
 * Sections marked `pending` (pages on another branch) are skipped. Reads the registry through the dev server.
 */
type Step = { id: string; target?: string | string[]; route?: string };
type Tour = { sectionId: string; title: string; route?: string; home: string; steps: Step[] };

test.describe.configure({ mode: "serial" });

test("every tour step resolves its target on the real page", async ({ page }, info) => {
  test.setTimeout(900_000);
  test.skip(info.project.name === "mobile", "desktop run is the authority; mobile layout is covered in help-mobile.spec.ts");
  await page.goto("/");
  const tours: Tour[] = await page.evaluate(async () => {
    const r = await import(/* @vite-ignore */ "/src/site/help/registry.ts");
    return r.SECTIONS.filter((s: { pending?: string; tour?: unknown }) => !s.pending && s.tour).map((s: { id: string; title: string; home: string; tour: { route?: string; steps: Step[] } }) => ({ sectionId: s.id, title: s.title, home: s.home, route: s.tour.route, steps: s.tour.steps }));
  });
  expect(tours.length).toBeGreaterThanOrEqual(10);
  const unresolved: string[] = [];
  for (const t of tours) {
    console.log("tour", t.sectionId);
    await page.goto(t.steps[0].route ?? t.route ?? t.home);
    await page.waitForTimeout(1200);
    await page.locator('[data-help="help-button"]:visible').first().click();
    // Several sections can share one page (Pandas and NumPy): the panel then shows a tab per section. Start the tour of this one.
    await expect(page.getByRole("button", { name: /(Start|Restart) tour/ }).first()).toBeVisible({ timeout: 15_000 }); // the registry loads lazily
    const tab = page.getByRole("tablist", { name: "Sections on this page" }).getByRole("tab", { name: t.title, exact: true });
    if (await tab.count()) await tab.click();
    await page.getByRole("button", { name: /(Start|Restart) tour/ }).first().click();
    const card = page.locator("[data-guided-tour] [role=dialog]");
    await expect(card).toBeVisible();
    for (let i = 0; i < t.steps.length; i++) {
      await expect(card).toContainText(`Step ${i + 1} of ${t.steps.length}`);
      const step = t.steps[i];
      if (step.target) {
        // give lazy-mounted editors and route changes time to render
        const found = await page.locator("[data-tour-spotlight=target]").waitFor({ timeout: 6000 }).then(() => true, () => false);
        if (!found) unresolved.push(`${t.sectionId}/${step.id}`);
      }
      if (i < t.steps.length - 1) await card.getByRole("button", { name: /Next/ }).click();
    }
    await card.getByRole("button", { name: "Finish" }).click();
    await expect(card).toBeHidden();
  }
  // Steps that need data or an action first: an empty notebook has no rows, the visualizer shows stages only after a run,
  // and the completion list exists only on a lesson's last step. They show centred with an explanation instead.
  // Steps that only exist after an action the previous step asks for. The Code Time Machine, pandas and NumPy panels appear once
  // "Explain visually" has recorded a run; e2e/visual*.spec.ts checks those elements on the live page after a real trace.
  const NEEDS_STATE = [/^mistake-notebook\//, /^query-visualizer\/(tabs|stages|badges|plan)$/, /^daily-learning\/complete$/, /^python-time-machine\/(source|stack|views|playback)$/, /^pandas\/(tables|diff|playback)$/, /^numpy\/(grid|playback)$/];
  const surprising = unresolved.filter((u) => !NEEDS_STATE.some((r) => r.test(u)));
  console.log("UNRESOLVED (needs state):", JSON.stringify(unresolved.filter((u) => !surprising.includes(u))));
  expect(surprising, "tour steps whose element is not on the page").toEqual([]);
});
