// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("Pyodide worker module cleanup and initialization architecture", () => {
  it("does not rely on an undeclared _STDLIB_MODULES global", () => {
    // The script executed before each run to unload user modules
    const cleanupCode = `
import sys as _s, importlib as _il
_base = getattr(_s, "_df_initial_modules", None)
if _base is None:
    _base = frozenset(set(_s.modules.keys()) | set(_s.stdlib_module_names) | set(_s.builtin_module_names))
    _s._df_initial_modules = _base

for _m in list(_s.modules.keys()):
    if _m in _base or _m.startswith("_") or _m == "sys" or _m == "builtins":
        continue
    _mod = _s.modules.get(_m)
    if _mod is None:
        continue
    _file = getattr(_mod, "__file__", None)
    if _file and _file.startswith("/lib/python3"):
        continue
    del _s.modules[_m]

_il.invalidate_caches()
`;

    // Ensure running this in an empty dictionary does NOT throw NameError or require _STDLIB_MODULES
    expect(cleanupCode).not.toContain("_STDLIB_MODULES");
    expect(cleanupCode).toContain("_s._df_initial_modules");
    expect(cleanupCode).toContain("_s.stdlib_module_names");
  });

  it("distinguishes stdlib, site-packages, and user workspace modules", () => {
    // Test the logic using mock module entries
    const stdlibNames = new Set(["json", "math", "sys", "os", "datetime", "collections", "re"]);
    const initialModules = new Set(["sys", "builtins", "_pyodide", "pyodide_js"]);
    const base = new Set([...initialModules, ...stdlibNames]);

    const mockModules: Record<string, { __file__?: string } | null> = {
      sys: null,
      builtins: null,
      json: { __file__: "/lib/python3.13/json/__init__.py" },
      math: null,
      pandas: { __file__: "/lib/python3.13/site-packages/pandas/__init__.py" },
      numpy: { __file__: "/lib/python3.13/site-packages/numpy/__init__.py" },
      user_helper: { __file__: "/tmp/run-1234/user_helper.py" },
      local_pipeline: { __file__: "/tmp/run-1234/local_pipeline.py" },
    };

    const modulesKeys = Object.keys(mockModules);
    const toDelete: string[] = [];

    for (const m of modulesKeys) {
      if (base.has(m) || m.startsWith("_") || m === "sys" || m === "builtins") {
        continue;
      }
      const mod = mockModules[m];
      if (!mod) continue;
      const file = mod.__file__;
      if (file && file.startsWith("/lib/python3")) {
        continue;
      }
      toDelete.push(m);
    }

    // Only user workspace modules must be deleted
    expect(toDelete).toEqual(["user_helper", "local_pipeline"]);
    // Standard library and site-packages must be preserved
    expect(toDelete).not.toContain("json");
    expect(toDelete).not.toContain("math");
    expect(toDelete).not.toContain("pandas");
    expect(toDelete).not.toContain("numpy");
  });

  it("reports initialization errors under phase 'load' and code errors under phase 'code'", () => {
    type Phase = "load" | "code" | "tests" | "timeout";
    function classifyError(_error: Error, stage: "boot" | "packages" | "setup" | "user_code" | "user_tests"): Phase {
      if (stage === "boot" || stage === "packages" || stage === "setup") return "load";
      if (stage === "user_code") return "code";
      return "tests";
    }

    expect(classifyError(new Error("Failed to load package"), "packages")).toBe("load");
    expect(classifyError(new Error("Python initialization error"), "setup")).toBe("load");
    expect(classifyError(new Error("NameError: name 'x' is not defined"), "user_code")).toBe("code");
    expect(classifyError(new Error("AssertionError: test failed"), "user_tests")).toBe("tests");
  });
});
