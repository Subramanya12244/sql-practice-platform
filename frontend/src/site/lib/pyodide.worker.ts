/// <reference lib="webworker" />
import { validateWorkspaceFiles, VirtualFsError } from "./virtualFs";

/**
 * Python sandbox: Pyodide (CPython compiled to WebAssembly) in its own worker.
 * - No server involved: code never reaches FastAPI or any backend.
 * - Filesystem is Pyodide's in-memory FS, not the user's disk.
 * - Imports that bridge to JavaScript/network (js, pyodide.http, micropip…) are blocked.
 * - The page enforces a wall-clock limit by terminating this worker.
 */
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";

interface Pyodide {
  loadPackagesFromImports(code: string): Promise<void>;
  runPythonAsync(code: string, opts?: { globals?: unknown }): Promise<unknown>;
  globals: { get(name: string): (...a: unknown[]) => unknown };
  setStdout(o: { batched: (s: string) => void }): void;
  setStderr(o: { batched: (s: string) => void }): void;
}

let py: Promise<Pyodide> | null = null;

const GUARD = `
import sys, importlib.abc
_BLOCKED = {"js", "pyodide_js", "pyodide.http", "pyodide.ffi", "micropip", "pyodide.webloop", "socket", "urllib.request", "http.client", "ssl"}
class _Block(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path, target=None):
        if name in _BLOCKED or any(name.startswith(b + ".") for b in _BLOCKED):
            raise ImportError(f"'{name}' is disabled in this sandbox (no network or browser access)")
        return None
for _m in list(sys.modules):
    if _m in _BLOCKED or any(_m.startswith(b + ".") for b in _BLOCKED):
        del sys.modules[_m]
sys.meta_path.insert(0, _Block())
`;

async function boot(): Promise<Pyodide> {
  const mod = (await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`)) as { loadPyodide: (o: { indexURL: string }) => Promise<Pyodide> };
  const p = await mod.loadPyodide({ indexURL: PYODIDE });
  // Snapshot standard library modules on boot for clean module unloading between runs.
  await p.runPythonAsync(`import sys as _s\n_STDLIB_MODULES = set(_s.modules.keys())`);
  return p;
}

self.onmessage = async (e: MessageEvent<{ id: number; code: string; tests?: string; stdin?: string; files?: Record<string, string> }>) => {
  const { id, code, tests, stdin, files } = e.data;
  let out = "";
  const write = (s: string) => {
    if (out.length < 20000) out += s + "\n";
  };
  try {
    // Validate virtual filesystem structure and quotas before running.
    if (files) {
      try {
        validateWorkspaceFiles(files);
      } catch (err) {
        if (err instanceof VirtualFsError) {
          self.postMessage({ id, ok: false, phase: "code", stdout: "", error: `VirtualFS Error: ${err.message}` });
          return;
        }
        throw err;
      }
    }

    py ??= boot();
    const p = await py;
    p.setStdout({ batched: write });
    p.setStderr({ batched: write });

    // Packages (pandas, numpy…) are fetched from Pyodide's own CDN before the guard applies.
    const allCode = [code, tests ?? "", ...(files ? Object.values(files) : [])].join("\n");
    await p.loadPackagesFromImports(allCode);
    const ns = p.globals.get("dict")();
    await p.runPythonAsync(GUARD, { globals: ns });

    // Unload user/workspace modules from previous runs to prevent state leaking.
    await p.runPythonAsync(
      `import sys as _s, importlib as _il\nfor _m in list(_s.modules.keys()):\n    if _m not in _STDLIB_MODULES and not _m.startswith("_"):\n        del _s.modules[_m]\n_il.invalidate_caches()`,
      { globals: ns }
    );

    // Standard input for input()/sys.stdin. JSON string literals are valid Python string literals.
    await p.runPythonAsync(`import sys as _s, io as _io\n_s.stdin = _io.StringIO(${JSON.stringify(stdin ?? "")})`, { globals: ns });

    // Create an isolated ephemeral working directory with sys.path configured for local imports.
    await p.runPythonAsync(
      `import os as _os, tempfile as _tf, sys as _s, pathlib as _pl\n_d = _tf.mkdtemp(prefix="run-")\n_base_dir = _pl.Path(_d).resolve()\n_os.chdir(_d)\nif _d not in _s.path:\n    _s.path.insert(0, _d)`,
      { globals: ns }
    );

    // Populate virtual filesystem files into the isolated workspace directory with path traversal guards.
    if (files && Object.keys(files).length > 0) {
      const fileData = JSON.stringify(files);
      await p.runPythonAsync(
        `import json as _j, pathlib as _pl\nfor _name, _content in _j.loads(${JSON.stringify(fileData)}).items():\n    _target = (_base_dir / _name).resolve()\n    if not _target.is_relative_to(_base_dir):\n        raise PermissionError(f"Path traversal outside virtual workspace forbidden: {_name}")\n    if len(_target.parts) > len(_base_dir.parts) + 1:\n        _target.parent.mkdir(parents=True, exist_ok=True)\n    _target.write_text(_content, encoding="utf-8")`,
        { globals: ns }
      );
    }

    let phase: "code" | "tests" = "code";
    try {
      await p.runPythonAsync(code, { globals: ns });
      if (tests) {
        phase = "tests";
        await p.runPythonAsync(tests, { globals: ns });
      }
      self.postMessage({ id, ok: true, stdout: out });
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      // Keep the last line (the exception) prominent; trim Pyodide's internal frames.
      const lines = msg.split("\n").filter((l) => !l.includes("/lib/python3") && !l.includes("_pyodide"));
      // Line of the learner's code that raised (tracebacks name it "<exec>"), only for the code phase.
      const at = phase === "code" ? [...msg.matchAll(/File "<exec>", line (\d+)/g)].pop()?.[1] : undefined;
      self.postMessage({ id, ok: false, phase, stdout: out, error: lines.slice(-12).join("\n").trim(), errorLine: at ? Number(at) : undefined });
    } finally {
      // Teardown ephemeral directory and clean sys.path.
      try {
        await p.runPythonAsync(
          `import shutil as _sh, os as _os, sys as _s\ntry:\n    if _d in _s.path:\n        _s.path.remove(_d)\n    _sh.rmtree(_d, ignore_errors=True)\nexcept Exception:\n    pass`,
          { globals: ns }
        );
      } catch {
        /* ignore cleanup error */
      }
    }
  } catch (err) {
    self.postMessage({ id, ok: false, phase: "load", stdout: out, error: `Python could not start: ${(err as Error).message}` });
  }
};
