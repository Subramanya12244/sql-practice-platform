import { expect, test } from "./fixtures";

/**
 * Structural accessibility checks on the main pages (no axe dependency): every interactive element has a name, every field a label,
 * one h1, no duplicate ids, landmarks present, images have alt text. Colour contrast is covered by the design tokens, not here.
 */
const PAGES = ["/", "/learn", "/daily", "/daily/day/3", "/questions", "/practice/python", "/etl-builder", "/dag-simulator", "/schema-designer", "/dq-exercises", "/data-profiler", "/query-visualizer", "/projects-lab", "/career/planner", "/mistakes", "/progress"];

for (const path of PAGES) {
  test(`structure: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const visible = (el: Element) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && (b.width > 0 || b.height > 0); };
      const nameOf = (el: Element) => {
        const lab = el.getAttribute("aria-label")?.trim();
        if (lab) return lab;
        const by = el.getAttribute("aria-labelledby");
        if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return "labelled-by";
        if ((el.textContent ?? "").trim()) return "text";
        if (el.getAttribute("title")?.trim()) return "title";
        if (el.querySelector("img[alt]:not([alt=''])")) return "img";
        return "";
      };
      const unnamed = [...document.querySelectorAll("button, a[href], [role=button], [role=tab], [role=option]")].filter((e) => visible(e) && !nameOf(e)).map((e) => `${e.tagName}.${String(e.className).slice(0, 50)}`);
      const unlabelled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((e) => {
        if (!visible(e) || e.closest(".monaco-editor")) return false;
        const id = e.getAttribute("id");
        return !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby") && !e.getAttribute("title") && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) && !e.closest("label");
      }).map((e) => `${e.tagName}[${e.getAttribute("type") ?? ""}].${String(e.className).slice(0, 40)}`);
      const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
      const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
      const noAlt = [...document.querySelectorAll("img:not([alt])")].map((e) => (e as HTMLImageElement).src.slice(-40));
      return {
        h1: [...document.querySelectorAll("h1")].filter(visible).length,
        main: document.querySelectorAll("main").length,
        unnamed, unlabelled, dupes, noAlt,
        lang: document.documentElement.lang,
      };
    });
    expect(r.lang, "html lang").toBeTruthy();
    expect(r.main, "main landmarks").toBe(1);
    expect(r.h1, "visible h1").toBe(1);
    expect(r.unnamed, "interactive elements without a name").toEqual([]);
    expect(r.unlabelled, "fields without a label").toEqual([]);
    expect(r.dupes, "duplicate ids").toEqual([]);
    expect(r.noAlt, "images without alt").toEqual([]);
  });
}

test("keyboard: the skip link is the first stop and reaches the main content", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard");
  await page.goto("/learn");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("focus ring is visible on links and buttons", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard");
  await page.goto("/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
});
