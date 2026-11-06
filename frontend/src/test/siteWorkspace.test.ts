import { beforeEach, describe, expect, it } from "vitest";
import { deleteSnippet, formatPython, pyLocalNames, readSnippets, saveSnippet } from "../site/lib/workspace";

describe("coding workspace", () => {
  beforeEach(() => localStorage.clear());
  it("formats Python without changing meaning", () => {
    const messy = "import json\ndef a(x):\n\tif x:   \n\t\treturn 1\n\treturn 2\nclass B:\n  def m(self):\n    s = '''keep\n\tthis'''\n    return s\n\n\n\n\nprint(a(1))";
    const out = formatPython(messy)!;
    expect(out).toBe("import json\n\n\ndef a(x):\n    if x:\n        return 1\n    return 2\n\n\nclass B:\n    def m(self):\n        s = '''keep\n\tthis'''\n        return s\n\n\nprint(a(1))\n");
    expect(formatPython(out)).toBe(out); // idempotent
    expect(formatPython("def f():\n   return 1\n")).toBe("def f():\n    return 1\n"); // any consistent indent is fine
    expect(formatPython("if a:\n        x = 1\n    y = 2\n")).toBeNull(); // dedent to a level that never opened
    expect(formatPython("x = f(1,\n      2)\n")).toBe("x = f(1,\n      2)\n"); // continuation keeps its offset
    expect(formatPython("@dec\ndef f():\n    pass\n")).toBe("@dec\ndef f():\n    pass\n");
  });
  it("finds names defined in the file for completion", () => {
    const names = pyLocalNames("import csv, json as js\nfrom collections import Counter\ndef load(path, *, limit=10):\n    rows, bad = [], 0\n    for r, i in x:\n        pass\nclass Loader:\n    pass\n");
    for (const n of ["csv", "js", "Counter", "load", "path", "limit", "rows", "bad", "r", "i", "Loader"]) expect(names).toContain(n);
  });
  it("saves and deletes snippets per language", () => {
    saveSnippet("sql", "join", "SELECT 1");
    saveSnippet("python", "", "def f():\n    pass");
    expect(readSnippets("sql").map((s) => s.name)).toEqual(["join"]);
    expect(readSnippets("python")[0].name).toBe("Untitled");
    deleteSnippet("sql", readSnippets("sql")[0].id);
    expect(readSnippets("sql")).toEqual([]);
  });
});
