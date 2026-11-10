import { describe, expect, it } from "vitest";
import { GITHUB_ACCESS_TEXT, githubScope, scopeAllows } from "../site/lib/portfolioExport";

describe("GitHub permission: ask for the least that works", () => {
  it("public repositories only need public_repo; only a private repository asks for repo", () => {
    expect(githubScope("public")).toBe("public_repo");
    expect(githubScope("private")).toBe("repo");
  });
  it("the wider permission is described honestly, including that it covers other private repositories", () => {
    expect(GITHUB_ACCESS_TEXT.private.detail).toMatch(/all your private repositories/);
    expect(GITHUB_ACCESS_TEXT.public.detail).toMatch(/cannot see your private ones/);
    expect(GITHUB_ACCESS_TEXT.private.detail).toMatch(/never stores the token/);
  });
  it("a public-only token cannot create a private repository; a wider token can create either", () => {
    expect(scopeAllows("public", false)).toBe(true);
    expect(scopeAllows("public", true)).toBe(false);
    expect(scopeAllows("private", true)).toBe(true);
    expect(scopeAllows("private", false)).toBe(true);
    expect(scopeAllows(null, false)).toBe(false); // unknown: do not assume
  });
});
