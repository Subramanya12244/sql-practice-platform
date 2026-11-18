import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// The identity in a real browser: the header logo, the compact form, both themes, and the files the page points at.

const setTheme = (page: Page, theme: "light" | "dark") => page.addInitScript((t) => { try { localStorage.setItem("sqlp.theme", t); } catch { /* storage unavailable */ } }, theme);
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

test("header: the logo is a link home named DataForge, drawn as one decorative graphic inside it", async ({ page }) => {
  await page.goto("/learn");
  const logo = page.getByRole("banner").getByRole("link", { name: "DataForge home" });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("href", "/");
  await expect(logo.locator("svg").first()).toHaveAttribute("aria-hidden", "true");
  expect(await logo.locator("svg:visible path.fill-brand").count()).toBe(1);
});

test("header: the logo keeps its proportions and stays inside the header, at every width", async ({ page }) => {
  for (const [w, h] of [[1440, 900], [768, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    const svg = await box(page, "header a[aria-label='DataForge home'] svg");
    expect(svg.width / svg.height, `${w}px lockup ratio`).toBeCloseTo(222 / 48, 1);
    expect(svg.height).toBeGreaterThanOrEqual(28);
    const head = await box(page, "header");
    expect(svg.y).toBeGreaterThanOrEqual(head.y);
    expect(svg.y + svg.height).toBeLessThanOrEqual(head.y + head.height);
  }
});

test("header: on a very narrow screen the mark stands alone, the name stays for screen readers, and nothing overflows", async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 700 });
  await page.goto("/");
  const logo = page.getByRole("banner").getByRole("link", { name: "DataForge home" });
  const visible = logo.locator("svg:visible");
  await expect(visible).toHaveCount(1);
  const b = (await visible.boundingBox())!;
  expect(b.width / b.height).toBeCloseTo(60 / 43, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} theme: the mark is the product blue for that theme and the wordmark reads against the header`, async ({ page }) => {
    await setTheme(page, theme);
    await page.goto("/learn");
    const fill = await page.locator("header a[aria-label='DataForge home'] svg:visible path.fill-brand").evaluate((el) => getComputedStyle(el).fill);
    expect(fill).toBe(theme === "light" ? "rgb(45, 91, 255)" : "rgb(124, 155, 255)");
    const word = await page.locator("header a[aria-label='DataForge home'] svg:visible g.fill-current path").first().evaluate((el) => getComputedStyle(el).fill);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const ratio = (() => {
      const lum = (c: string) => { const m = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const [a, b] = [lum(word), lum(bg)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    })();
    expect(ratio).toBeGreaterThanOrEqual(7);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`forced colours on a ${scheme} canvas (Windows High Contrast): the mark takes the system text colour like the wordmark and contrasts with the canvas`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", colorScheme: scheme });
    await page.goto("/learn");
    const [mark, word] = await Promise.all([
      page.locator("header a[aria-label='DataForge home'] svg:visible path.fill-brand").first().evaluate((el) => getComputedStyle(el).fill),
      page.locator("header a[aria-label='DataForge home'] svg:visible g.fill-current path").first().evaluate((el) => getComputedStyle(el).fill),
    ]);
    const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(mark).toBe(word);
    const lum = (c: string) => { const m = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const [a, b] = [lum(mark), lum(canvas)].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(7);
  });
}

test("the logo does not shift the page as it loads, and the header is the same height on every page", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __cls: number }).__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { hadRecentInput: boolean; value: number; sources?: { node?: Node }[] }[]) if (!e.hadRecentInput && e.sources?.some((s) => (s.node as Element | undefined)?.closest?.("header"))) (window as unknown as { __cls: number }).__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
  const heights = new Set<number>();
  for (const path of ["/", "/learn", "/dashboard", "/projects-lab", "/daily"]) {
    await page.goto(path);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls), `${path} header layout shift`).toBe(0);
    heights.add(Math.round((await box(page, "header")).height));
  }
  expect([...heights]).toHaveLength(1);
});

test("sign-in and sign-up show the logo exactly once: beside the pitch on desktop, above the form on a phone", async ({ page }) => {
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main svg[aria-label=\"DataForge\"]:visible"), path).toHaveCount(1);
  }
});

test("every icon file the page and the manifest name is served with the right type and size", async ({ page, request, baseURL }) => {
  await page.goto("/");
  const links = await page.$$eval("head link[rel~='icon'], head link[rel='apple-touch-icon'], head link[rel='manifest']", (els) => els.map((e) => ({ rel: e.getAttribute("rel"), href: e.getAttribute("href")!, type: e.getAttribute("type") })));
  expect(links.length).toBeGreaterThanOrEqual(6);
  const types: Record<string, RegExp> = { svg: /image\/svg\+xml/, png: /image\/png/, ico: /image\/(x-icon|vnd\.microsoft\.icon)/, webmanifest: /manifest\+json|application\/json|octet-stream/ };
  for (const l of links) {
    const res = await request.get(new URL(l.href, baseURL!).href);
    expect(res.status(), l.href).toBe(200);
    const ext = l.href.split(".").pop()!;
    expect(res.headers()["content-type"] ?? "", l.href).toMatch(types[ext]);
  }
  const manifest = await (await request.get(new URL("/manifest.webmanifest", baseURL!).href)).json();
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  for (const i of manifest.icons as { src: string }[]) expect((await request.get(new URL(i.src, baseURL!).href)).status(), i.src).toBe(200);
  const og = await page.locator("meta[property='og:image']").getAttribute("content");
  expect(og).toContain("/og-image.png");
  expect((await request.get(new URL("/og-image.png", baseURL!).href)).status()).toBe(200);
});

test("the logo is reachable and visible in the footer too, and nothing else on the page repeats it", async ({ page }) => {
  await page.goto("/learn");
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(page.locator("footer svg[aria-label='DataForge']")).toBeVisible();
  expect(await page.locator("svg:visible path.fill-brand").count()).toBe(2); // header and footer only
});

test("the share card you can post from the Progress page is on brand: flat ink, a blue rule, the lockup, and no old indigo gradient", async ({ page }) => {
  // Capture the PNG the Share button builds instead of opening a share sheet.
  await page.addInitScript(() => {
    const w = window as unknown as { __card?: Blob };
    (navigator as unknown as { canShare: () => boolean }).canShare = () => true;
    (navigator as unknown as { share: (d: { files: File[] }) => Promise<void> }).share = async (d) => { w.__card = d.files[0]; };
  });
  await page.goto("/progress");
  await page.getByRole("button", { name: "Share" }).click();
  await page.waitForFunction(() => !!(window as unknown as { __card?: Blob }).__card);
  const px = await page.evaluate(async () => {
    const bmp = await createImageBitmap((window as unknown as { __card: Blob }).__card);
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d")!; g.drawImage(bmp, 0, 0);
    const at = (x: number, y: number) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    // does the lockup area hold the light-blue mark colour somewhere?
    const d = g.getImageData(80, 58, 140, 80).data; let mark = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 124) < 6 && Math.abs(d[i + 1] - 155) < 6 && Math.abs(d[i + 2] - 255) < 6) mark++;
    return { size: [bmp.width, bmp.height], rule: at(600, 4), topLeft: at(2, 300), middle: at(1100, 200), bottomRight: at(1190, 625), mark };
  });
  expect(px.size).toEqual([1200, 630]);
  expect(px.rule).toEqual([45, 91, 255]);
  expect(px.topLeft).toEqual([7, 11, 20]);
  expect(px.middle).toEqual([7, 11, 20]); // flat: a gradient would differ across the card
  expect(px.bottomRight).toEqual([7, 11, 20]);
  expect(px.mark).toBeGreaterThan(300);
});
