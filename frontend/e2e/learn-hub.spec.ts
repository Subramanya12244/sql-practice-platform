import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// The Learn hub in a real browser: paths, the topic library, the roadmap, and progress from the learner's own record.

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** A partial but realistic progress record: 3 Daily lessons done, one opened, a note read, a question attempted twice. */
const seed = (page: Page) =>
  page.addInitScript(() => {
    try {
      const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();
      if (localStorage.getItem("df.test.seeded")) return;
      localStorage.setItem("df.test.seeded", "1");
      const days: Record<string, unknown> = {};
      for (const id of ["d001", "d002", "d003"]) days[id] = { completedAt: iso(3), lastVisit: iso(3), theory: iso(3), passed: ["x"], attempted: ["x"] };
      days.d004 = { lastVisit: iso(1), theory: iso(1) };
      localStorage.setItem("sqlp.public.progress", JSON.stringify({
        version: 1, questions: { 25: { attempts: 3 } }, activeDays: [], cards: {},
        read: { "left-join": iso(2) }, recent: [{ key: "note:left-join", title: "LEFT JOIN", path: "/notes/left-join", at: iso(2) }],
        daily: { startedOn: iso(5).slice(0, 10), days },
      }));
    } catch { /* storage unavailable */ }
  });

test("hub: renders the sections, with no console errors or hydration warnings", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/learn");
  await expect(page.getByRole("heading", { level: 1, name: /Learn data skills/ })).toBeVisible();
  for (const name of ["Learning paths", "Explore topics", "Curriculum roadmap", "Hands-on practice and projects", "Learning resources"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(await noHScroll(page)).toBeLessThanOrEqual(1);
});

test("hub: a new learner sees start points, not a made-up resume or recommendations", async ({ page }) => {
  await page.goto("/learn");
  await expect(page.getByText("Pick a starting point")).toBeVisible();
  await expect(page.getByRole("link", { name: /Start Day 1: Python from scratch/ })).toHaveAttribute("href", "/daily/day/1");
  await expect(page.getByRole("heading", { name: "Recommended for you" })).toHaveCount(0);
  for (const id of ["sql-developer", "python-for-data", "data-analyst", "data-engineer"]) {
    await expect(page.locator(`[data-path="${id}"]`).getByText("Not started")).toBeVisible();
  }
});

for (const [id, title, next] of [
  ["sql-developer", "SQL Developer", /SQL SELECT Basics/],
  ["python-for-data", "Python for Data", /Install Python/],
  ["data-analyst", "Data Analyst", /Install Python/],
  ["data-engineer", "Data Engineer", /Install Python/],
] as const) {
  test(`path: ${title} opens from the hub and shows its real contents`, async ({ page }) => {
    await page.goto("/learn");
    await page.locator(`[data-path="${id}"]`).getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/path/${id}$`));
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    for (const h of ["What you will learn", "Before you start", "Modules and lessons", "Notes for this path", "Practical exercises", "Final project"]) {
      await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    }
    await expect(page.getByLabel("Recommended next lesson")).toContainText(next);
    await expect(page.getByRole("link", { name: /Start|Continue/ }).first()).toBeVisible();
    expect(await noHScroll(page)).toBeLessThanOrEqual(1);
  });
}

test("path: a module opens to show its lessons, and a lesson link opens the lesson", async ({ page }) => {
  await page.goto("/learn/path/python-for-data");
  const module = page.getByRole("button", { name: /Python fundamentals/ }).first();
  await expect(module).toHaveAttribute("aria-expanded", "false");
  await module.click();
  await expect(module).toHaveAttribute("aria-expanded", "true");
  const first = page.getByRole("link", { name: /\bDay 1\b/ }).first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/daily\/day\/1$/);
});

test("path: progress counts completed lessons only", async ({ page }) => {
  await seed(page);
  await page.goto("/learn/path/python-for-data");
  await expect(page.getByText("3 of 55 lessons completed").first()).toBeVisible();
  // the opened-but-unfinished Day 4 is the next lesson, and the page says why
  await expect(page.getByLabel("Recommended next lesson")).toContainText("started this lesson");
});

test("hub: continue card and recommendations come from the learner's record, each with a reason", async ({ page }) => {
  await seed(page);
  await page.goto("/learn");
  const card = page.getByLabel("Continue learning");
  await expect(card).toContainText("3 of 90 lessons completed");
  await expect(card.getByRole("link", { name: "Continue" })).toHaveAttribute("href", /\/daily\/day\/4$/);
  const recs = page.getByRole("region", { name: "Recommended for you" }).or(page.locator('[data-help="hub-recs"]'));
  await expect(recs).toContainText("You opened Day 4");
  await expect(recs).toContainText("question 25 3 times");
  await expect(recs).toContainText("solved 0 of");
});

test("library: search finds topics, filters combine, and the empty state can be cleared", async ({ page }) => {
  await page.goto("/learn");
  const lib = page.locator("#topics");
  await expect(lib.getByText(/Showing 12 of 178 topics/)).toBeVisible();

  await lib.getByRole("searchbox", { name: "Search topics" }).fill("window");
  await expect(lib.getByRole("status")).toContainText(/topics?$/);
  await expect(lib.locator("[data-topic]").first()).toContainText(/window/i);

  await lib.getByRole("searchbox", { name: "Search topics" }).fill("qqqqzzzz");
  await expect(lib.getByText("No topics match these filters")).toBeVisible();
  await lib.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(lib.getByText(/Showing 12 of 178 topics/)).toBeVisible();

  await lib.getByRole("button", { name: /^Data Engineering/ }).click();
  await expect(lib.getByRole("button", { name: /^Data Engineering/ })).toHaveAttribute("aria-pressed", "true");
  await lib.getByLabel("Difficulty").selectOption("Advanced");
  const status = lib.getByRole("status");
  await expect(status).toContainText(/of \d+ topics?/);
  for (const card of await lib.locator("[data-topic]").all()) await expect(card).toContainText("Advanced");
  await lib.getByLabel("Resource type").selectOption("project");
  await expect(lib.locator("[data-topic]").first()).toBeVisible();
});

test("library: Show more reveals the next page, and the filter survives in the address", async ({ page }) => {
  await page.goto("/learn");
  const lib = page.locator("#topics");
  await lib.getByRole("button", { name: /^Show 12 more/ }).click();
  await expect(lib.getByText(/Showing 24 of 178 topics/)).toBeVisible();
  await lib.getByRole("button", { name: /^SQL/ }).click();
  await lib.getByRole("searchbox", { name: "Search topics" }).fill("join");
  await expect(page).toHaveURL(/subject=sql/);
  await expect(page).toHaveURL(/q=join/);
  await page.reload();
  await expect(lib.getByRole("searchbox", { name: "Search topics" })).toHaveValue("join");
  await expect(lib.getByRole("button", { name: /^SQL/ })).toHaveAttribute("aria-pressed", "true");
});

test("hero search jumps to the library with the query applied", async ({ page }) => {
  await page.goto("/learn");
  await page.getByRole("search").first().getByRole("textbox", { name: "Search topics" }).fill("airflow");
  await page.getByRole("search").first().getByRole("button", { name: "Search" }).click();
  await expect(page.locator("#topics").getByRole("searchbox", { name: "Search topics" })).toHaveValue("airflow");
  await expect(page.locator("#topics [data-topic]").first()).toContainText(/airflow/i);
});

test("library: it is usable from the keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard");
  await page.goto("/learn?subject=python#topics");
  const lib = page.locator("#topics");
  await expect(lib.getByRole("button", { name: /^Python for Data/ })).toHaveAttribute("aria-pressed", "true");
  await lib.getByRole("searchbox", { name: "Search topics" }).focus();
  await page.keyboard.press("Tab"); // clear button is absent when empty, so the next stop is the first subject chip
  await expect(lib.getByRole("button", { name: /^All subjects/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(lib.getByRole("button", { name: /^All subjects/ })).toHaveAttribute("aria-pressed", "true");
  const card = lib.locator("[data-topic]").first();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/learn\/topic\//);
});

test("topic: a note topic brings its note, practice and projects together, with real status", async ({ page }) => {
  await seed(page);
  await page.goto("/learn/topic/left-join");
  await expect(page.getByRole("heading", { level: 1, name: /LEFT JOIN/ })).toBeVisible();
  await expect(page.getByText("Read", { exact: true }).first()).toBeVisible(); // note read, questions still unsolved: Read, not Learned
  await expect(page.getByText("Learned", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Read the note" })).toHaveAttribute("href", "/notes/left-join");
  for (const h of ["Learn", "Practice", "Interview questions", "Learning order"]) await expect(page.getByRole("heading", { level: 2, name: h, exact: true })).toBeVisible();
  await expect(page.getByText(/0 of 6 solved/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Interview questions in the note" })).toHaveAttribute("href", "/notes/left-join#interview-questions");
  await page.getByRole("link", { name: /Customers and Order Count/ }).first().click();
  await expect(page).toHaveURL(/\/questions\//);
});

test("topic: an analytics module lists its Daily lessons and a visual lab", async ({ page }) => {
  await page.goto("/learn/topic/excel");
  await expect(page.getByRole("heading", { level: 1, name: "Excel for analysis" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Excel lab" })).toHaveAttribute("href", "/visual/excel");
  await expect(page.getByRole("link", { name: "Start the first lesson" })).toHaveAttribute("href", /\/daily\/analyst\/day\/91$/);
  await expect(page.getByRole("heading", { level: 2, name: "In Daily Learning" })).toBeVisible();
});

test("topic: an unknown id is a not-found page, not a blank screen", async ({ page }) => {
  await page.goto("/learn/topic/does-not-exist");
  await expect(page.getByRole("heading", { name: /not found|couldn.t find|404/i }).first()).toBeVisible();
});

test("roadmap: tabs switch tracks and phases link into Daily Learning", async ({ page }) => {
  await page.goto("/learn");
  const road = page.locator("#roadmap");
  await expect(road.getByRole("tab", { name: "Common core", selected: true })).toBeVisible();
  await expect(road.getByText("Python fundamentals")).toBeVisible();
  await road.getByRole("tab", { name: "Data Engineer" }).click();
  await expect(road.getByText("Airflow orchestration")).toBeVisible();
  await road.getByRole("link", { name: /Airflow orchestration/ }).click();
  await expect(page).toHaveURL(/\/daily\/engineer\/day\/157$/);
});

test("existing resources stay reachable from the hub", async ({ page }) => {
  await page.goto("/learn");
  for (const [name, href] of [["Theory notes", "/notes"], ["Patterns", "/patterns"], ["Mind maps", "/mindmaps"], ["Concept guides", "/concepts"], ["Cheat sheet", "/cheatsheet"], ["Flashcards", "/flashcards"]] as const) {
    await expect(page.locator("#resources").getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
  }
  await page.goto("/learn/select-basics");
  await expect(page.getByRole("link", { name: "Learn SQL" }).first()).toHaveAttribute("href", "/learn/path/sql-developer");
});

test("the dashboard moved to /dashboard, whole", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Your learning dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Skill mastery" })).toBeVisible();
  await expect(page.getByRole("link", { name: "learning hub", exact: true })).toHaveAttribute("href", "/learn");
});

test("navigation: Learning hub is in the Learn group and the Dashboard stays under Home", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop sidebar");
  await page.goto("/learn");
  await expect(page.getByRole("link", { name: "Learning hub", exact: true }).first()).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  await expect(page.getByRole("link", { name: "Dashboard", exact: true }).first()).toHaveAttribute("href", "/dashboard");
});

test("phone: hub, path and topic pages never scroll sideways", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  for (const path of ["/learn", "/learn/path/sql-developer", "/learn/path/data-analyst", "/learn/topic/left-join", "/learn/topic/excel", "/dashboard"]) {
    await page.goto(path);
    expect(await noHScroll(page), path).toBeLessThanOrEqual(1);
  }
});
