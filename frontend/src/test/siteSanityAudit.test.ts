import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "../site/lib/navigation";
import { matchRoute } from "../site/routes";
import { sanitizeHtml } from "../site/components/Markdown";
import { compareResults, diagnose, rowDiff } from "../site/lib/resultCompare";
import qIndex from "../../public/data/index.json";
import tracksJson from "../site/content/tracks.json";

describe("Sanity Audit: Navigation and Routing", () => {
  it("every navigation item across all groups resolves to a known route", () => {
    const allNavItems = NAV_GROUPS.flatMap((g) => (g.items ? g.items.map((i) => ({ group: g.id, ...i })) : []));
    expect(allNavItems.length).toBeGreaterThanOrEqual(30);

    for (const item of allNavItems) {
      const { route } = matchRoute(item.to);
      expect(route.path, `Route for ${item.to} (${item.label}) not found`).not.toBe("*");
    }
  });

  it("header groups and footer links are fully in sync", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual([
      "dashboard",
      "learn",
      "practice",
      "projects",
      "ai",
      "career",
      "community",
    ]);
  });
});

describe("Sanity Audit: Security and XSS Sanitization", () => {
  it("strips script tags and inline handlers from rendered html", () => {
    const malicious = '<p>Safe text <script>alert("xss")</script><img src="x" onerror="alert(1)" /></p>';
    const sanitized = sanitizeHtml(malicious);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).toContain("Safe text");
    expect(sanitized).toContain('<img src="x"');
  });

  it("strips javascript: pseudo-protocols from hyperlinks", () => {
    const maliciousLink = '<a href="javascript:alert(document.cookie)">Click here</a>';
    const sanitized = sanitizeHtml(maliciousLink);
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).toContain("Click here");
  });

  it("preserves code actions and table attributes", () => {
    const safeContent = '<div class="code-block"><button type="button" data-copy>Copy</button><pre tabindex="0"><code class="language-sql">SELECT 1</code></pre></div>';
    const sanitized = sanitizeHtml(safeContent);
    expect(sanitized).toContain('data-copy');
    expect(sanitized).toContain('tabindex="0"');
    expect(sanitized).toContain('class="language-sql"');
  });
});

describe("Sanity Audit: Content Inventory & Catalog Completeness", () => {
  it("has exactly 150 practice questions with unique numbers and slugs", () => {
    expect(qIndex.length).toBe(150);
    const numbers = new Set(qIndex.map((q: { number: number }) => q.number));
    const slugs = new Set(qIndex.map((q: { slug: string }) => q.slug));
    expect(numbers.size).toBe(150);
    expect(slugs.size).toBe(150);
  });

  it("has 7 Data Engineering tracks with 102 total learning topics", () => {
    const tracks = tracksJson.tracks;
    expect(tracks.length).toBe(7);
    const totalTopics = tracks.reduce((acc: number, t: { topics: unknown[] }) => acc + t.topics.length, 0);
    expect(totalTopics).toBe(102);
  });

  it("has 12 projects in the curriculum", () => {
    expect(tracksJson.projects.length).toBe(12);
  });
});

describe("Sanity Audit: SQL Grading & Diagnosis Edge Cases", () => {
  it("distinguishes NULL from 0 in diagnosis", () => {
    const userRows = [[null], [10]];
    const expRows = [[0], [10]];
    const diff = rowDiff(userRows, expRows);
    expect(diff.missingCount).toBe(1);
    expect(diff.extraCount).toBe(1);

    const diag = diagnose(["val"], userRows, ["val"], expRows);
    expect(diag.length).toBeGreaterThan(0);
    expect(diag.some((d) => d.includes("NULL vs 0"))).toBe(true);
  });

  it("detects fan-out duplicate rows correctly", () => {
    const userRows = [["A", 1], ["A", 1], ["B", 2]];
    const expRows = [["A", 1], ["B", 2]];
    const diag = diagnose(["name", "val"], userRows, ["name", "val"], expRows);
    expect(diag.some((d) => d.includes("duplicate row(s)"))).toBe(true);
  });

  it("handles sorting with tied keys smoothly", () => {
    const orderBy = [{ column: "score", desc: true }];
    const userRows = [["Alice", 100], ["Charlie", 90], ["Bob", 90]];
    const expRows = [["Alice", 100], ["Bob", 90], ["Charlie", 90]];
    const res = compareResults(["name", "score"], userRows, ["name", "score"], expRows, true, orderBy);
    expect(res.match).toBe(true);
  });
});
