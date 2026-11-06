import { describe, expect, it, vi } from "vitest";
import { buildExport, pushToGitHub } from "../site/lib/portfolioExport";

const sel = {
  title: "My portfolio", author: "ana",
  sql: [{ number: 25, slug: "q25", title: "Customers and Order Count", topic: "LEFT JOIN", difficulty: "Medium", objective: "Return every customer.", sql: "SELECT 1;" }],
  python: [{ code: "PY-008", slug: "incremental-load-watermark", title: "Incremental Load", category: "ETL", difficulty: "Hard", source: "def f():\n    return 1\n" }],
  projects: [{ project: { slug: "incremental-loading", title: "Incremental data loading", description: "Load rows.", level: "Intermediate", technologies: ["SQL"], dataset: "banking", prerequisites: [], minutes: 60,
    body: "## Business problem\n\nThe bank grows.\n\n## Architecture\n\n```mermaid\nflowchart LR\n a --> b\n```\n\n## Tasks\n\n<!--task:t1-->",
    tasks: [{ id: "t1", title: "First load", type: "sql", instructions: "", starter: "", solution: "", check: "" }, { id: "d1", title: "Watermark", type: "decision", instructions: "", options: ["created_at", "updated_at"], answer: 1, why: ["misses", "catches corrections"] }] } as never, status: "In progress", tasksPassed: ["t1"] }],
};

describe("portfolio export", () => {
  it("builds the files a learner selected, with a linked README", () => {
    const f = buildExport(sel);
    expect(Object.keys(f).sort()).toEqual(["README.md", "projects/incremental-loading/README.md", "python/incremental_load_watermark.py", "sql/q025-customers-and-order-count.sql"]);
    expect(f["sql/q025-customers-and-order-count.sql"]).toMatch(/^-- Q25 Customers and Order Count\n[\s\S]*SELECT 1;\n$/);
    expect(f["README.md"]).toContain("[Q25 Customers and Order Count](sql/q025-customers-and-order-count.sql)");
    const pr = f["projects/incremental-loading/README.md"];
    expect(pr).toContain("```mermaid");
    expect(pr).toContain("- [x] First load");
    expect(pr).toContain("**Watermark:** updated_at. catches corrections");
    expect(buildExport({ ...sel, sql: [], python: [], projects: [] })).toEqual({ "README.md": expect.any(String) });
  });
  it("creates a private repository and one commit with all files", async () => {
    const calls: [string, string, unknown][] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push([init.method!, url.replace("https://api.github.com", ""), body]);
      const res = (o: object) => ({ ok: true, status: 200, json: async () => o }) as Response;
      if (url.endsWith("/user/repos")) return res({ full_name: "ana/dataforge-portfolio", default_branch: "main", html_url: "https://github.com/ana/dataforge-portfolio" });
      if (url.includes("/git/ref/")) return res({ object: { sha: "base" } });
      if (url.endsWith("/git/trees")) return res({ sha: "tree1" });
      if (url.endsWith("/git/commits")) return res({ sha: "c1" });
      return res({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const files = buildExport(sel);
    const r = await pushToGitHub("tok", { repo: "dataforge-portfolio", private: true, description: "x", files, message: "Add" });
    expect(r.url).toBe("https://github.com/ana/dataforge-portfolio");
    expect(calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(["POST /user/repos", "GET /repos/ana/dataforge-portfolio/git/ref/heads/main", "POST /repos/ana/dataforge-portfolio/git/trees", "POST /repos/ana/dataforge-portfolio/git/commits", "PATCH /repos/ana/dataforge-portfolio/git/refs/heads/main"]);
    expect((calls[0][2] as { private: boolean }).private).toBe(true);
    expect((calls[2][2] as { tree: unknown[] }).tree).toHaveLength(Object.keys(files).length);
    expect((calls[3][2] as { parents: string[] }).parents).toEqual(["base"]);
    await expect(pushToGitHub("tok", { repo: "bad name!", private: true, description: "", files, message: "" })).rejects.toThrow(/Repository names/);
    vi.unstubAllGlobals();
  });
});
