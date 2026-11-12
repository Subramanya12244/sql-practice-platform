import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests. `desktop` and `mobile` (Chromium) are the defaults and keep their names, so `npm run e2e` and any CI that
 * runs them behave exactly as before. They use the system Chrome (`channel: "chrome"`), so no download is needed locally. In CI
 * install one first: `npx playwright install --with-deps chromium` and set E2E_CHANNEL=chromium.
 *
 * Firefox and WebKit are OPT-IN: each engine is a separate download (~80 MB each) and the visual specs load Pyodide and pandas
 * (slow), so running three engines by default would roughly triple the run time. Enable them with E2E_ENGINES:
 *
 *   npx playwright install firefox webkit                       (once; stored in the Playwright cache)
 *   E2E_ENGINES=firefox npx playwright test --project=firefox-desktop --project=firefox-mobile
 *   E2E_ENGINES=webkit  npx playwright test --project=webkit-desktop  --project=webkit-mobile
 *   E2E_ENGINES=all     npx playwright test                       (chromium, firefox and webkit, desktop and mobile)
 *
 * Projects: desktop, mobile (Chromium) | firefox-desktop, firefox-mobile | webkit-desktop, webkit-mobile.
 *   - Mobile Chromium: 390x844 with touch and mobile emulation.
 *   - WebKit mobile: Playwright's real "iPhone 13" device profile (WebKit, 390x664, touch, iOS user agent).
 *   - Firefox mobile: Playwright does not support `isMobile` on Firefox, so it is a 390x844 touch viewport. It checks the
 *     small-screen layout in the Gecko engine, not mobile emulation.
 * With E2E_ENGINES unset, the Firefox and WebKit projects do not exist (selecting one with --project fails with "project not found").
 * Run: `npm run e2e` (starts the dev server itself, or reuses one on :5174).
 */
const engines = new Set((process.env.E2E_ENGINES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const want = (name: "firefox" | "webkit") => engines.has("all") || engines.has(name);
const channel = process.env.E2E_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  // `channel` is Chromium-only, so it lives on the Chromium projects below and not here.
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5174", trace: "retain-on-failure" },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev:site", url: "http://localhost:5174", reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: "desktop", use: { channel, viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { channel, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    ...(want("firefox") ? [
      { name: "firefox-desktop", use: { browserName: "firefox" as const, viewport: { width: 1440, height: 900 } } },
      { name: "firefox-mobile", use: { browserName: "firefox" as const, viewport: { width: 390, height: 844 }, hasTouch: true } },
    ] : []),
    ...(want("webkit") ? [
      { name: "webkit-desktop", use: { browserName: "webkit" as const, viewport: { width: 1440, height: 900 } } },
      { name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
    ] : []),
  ],
});
