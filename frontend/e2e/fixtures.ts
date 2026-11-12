import { test as base } from "@playwright/test";

/**
 * The site is prerendered: its buttons are visible before React has attached their handlers, and a click in that window is lost.
 * `page.goto` and `page.reload` therefore wait for the app's own `data-hydrated` marker (set in SiteApp once it has hydrated).
 * Real visitors who click that early lose the click too; this only makes the tests wait for what a person would wait for.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    // The first-visit welcome card would sit over every fresh browser context. Existing tests are not about it, so mark it seen,
    // unless a test opts in by setting `df.test.keepOnboarding` first (e2e/help.spec.ts does).
    await page.addInitScript(() => {
      try {
        if (!localStorage.getItem("df.test.keepOnboarding") && !localStorage.getItem("df.help.v1")) localStorage.setItem("df.help.v1", JSON.stringify({ version: 1, onboarding: "skipped", tours: {} }));
      } catch { /* storage unavailable */ }
    });
    const settle = () => page.waitForSelector("html[data-hydrated]", { timeout: 60_000 });
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = (async (url: string, options?: Parameters<typeof goto>[1]) => { const r = await goto(url, options); await settle(); return r; }) as typeof page.goto;
    page.reload = (async (options?: Parameters<typeof reload>[0]) => { const r = await reload(options); await settle(); return r; }) as typeof page.reload;
    await use(page);
  },
});
export { expect } from "@playwright/test";
