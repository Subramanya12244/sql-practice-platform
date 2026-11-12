import { test, expect } from "./fixtures";

/** Mobile behaviour: the drawer is a bottom sheet, tours dock to the bottom, nothing scrolls sideways. */
test.describe("mobile help", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) > 500, "mobile project only");

  test("Help button sits in the top bar and opens a bottom sheet with a backdrop", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-help="help-button"]:visible').first().click();
    const p = page.locator("[data-help-panel]");
    await expect(p).toBeVisible();
    const box = (await p.boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(388);
    expect(box.y + box.height).toBeGreaterThanOrEqual(840);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.mouse.click(190, 60); // backdrop
    await expect(p).toBeHidden();
  });

  test("tour card docks to the bottom and fits the screen", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-help="help-button"]:visible').first().click();
    await page.getByRole("button", { name: /Start tour/ }).first().click();
    const card = page.locator("[data-guided-tour] [role=dialog]");
    await expect(card).toBeVisible();
    const b = (await card.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(391);
    expect(b.y + b.height).toBeGreaterThan(700);
    await card.getByRole("button", { name: /Next/ }).click();
    await expect(card).toContainText("Step 2");
  });
});
