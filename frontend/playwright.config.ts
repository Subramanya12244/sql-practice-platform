import { defineConfig } from "@playwright/test";

/**
 * Browser smoke tests. Uses the system Chrome (`channel: "chrome"`), so no browser download is needed
 * locally. In CI install one first: `npx playwright install --with-deps chromium` and set E2E_CHANNEL=chromium.
 * Run: `npm run e2e` (starts the dev server itself, or reuses one on :5174).
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5174", channel: process.env.E2E_CHANNEL ?? "chrome", trace: "retain-on-failure" },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev:site", url: "http://localhost:5174", reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
});
