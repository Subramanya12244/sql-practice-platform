/// <reference lib="webworker" />
import { validateWorkspaceFiles, VirtualFsError } from "./virtualFs";
import { friendlyPyError } from "./pyErrors";

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

const MODULE_CLEANUP = `
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

const SETUP_DIR = `
import os as _os, tempfile as _tf, sys as _s, pathlib as _pl
_d = _tf.mkdtemp(prefix="run-")
_base_dir = _pl.Path(_d).resolve()
_os.chdir(_d)
if _d not in _s.path:
    _s.path.insert(0, _d)
`;

const TEARDOWN_DIR = `
import shutil as _sh, os as _os, sys as _s
try:
    if _d in _s.path:
        _s.path.remove(_d)
    _sh.rmtree(_d, ignore_errors=True)
except Exception:
    pass
`;

async function boot(): Promise<Pyodide> {
  const mod = (await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`)) as { loadPyodide: (o: { indexURL: string }) => Promise<Pyodide> };
  const p = await mod.loadPyodide({ indexURL: PYODIDE });
  // Snapshot baseline standard library and built-in modules on the sys module for clean module unloading between runs.
  await p.runPythonAsync(`
import sys as _s
_s._df_initial_modules = frozenset(
    set(_s.modules.keys()) | set(_s.stdlib_module_names) | set(_s.builtin_module_names)
)
`);
  return p;
}

let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<{ id: number; code: string; tests?: string; stdin?: string; files?: Record<string, string> }>) => {
  queue = queue
    .then(() => handleRun(e.data))
    .catch((err) => {
      self.postMessage({
        id: e.data.id,
        ok: false,
        phase: "load",
        stdout: "",
        error: `Worker error: ${(err as Error).message ?? err}`,
      });
    });
};

async function handleRun(data: { id: number; code: string; tests?: string; stdin?: string; files?: Record<string, string> }) {
  const { id, code, tests, stdin, files } = data;
  let out = "";
  const write = (s: string) => {
    if (out.length < 20000) out += s + "\n";
  };

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

  let p: Pyodide;
  try {
    py ??= boot();
    p = await py;
  } catch (err) {
    py = null; // allow retry on next attempt if initialization failed
    self.postMessage({
      id,
      ok: false,
      phase: "load",
      stdout: "",
      error: `Python could not start: ${(err as Error).message ?? err}`,
    });
    return;
  }

  p.setStdout({ batched: write });
  p.setStderr({ batched: write });

  // Packages (pandas, numpy…) are fetched from Pyodide's own CDN before the guard applies.
  const allCode = [code, tests ?? "", ...(files ? Object.values(files) : [])].join("\n");
  try {
    await p.loadPackagesFromImports(allCode);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      phase: "load",
      stdout: out,
      error: `Failed to load required packages: ${(err as Error).message ?? err}`,
    });
    return;
  }

  const ns = p.globals.get("dict")();

  try {
    await p.runPythonAsync(GUARD, { globals: ns });
    await p.runPythonAsync(MODULE_CLEANUP, { globals: ns });
    await p.runPythonAsync(`import sys as _s, io as _io\n_s.stdin = _io.StringIO(${JSON.stringify(stdin ?? "")})`, { globals: ns });
    await p.runPythonAsync(SETUP_DIR, { globals: ns });

    if (files && Object.keys(files).length > 0) {
      const fileData = JSON.stringify(files);
      await p.runPythonAsync(
        `import json as _j, pathlib as _pl\nfor _name, _content in _j.loads(${JSON.stringify(fileData)}).items():\n    _target = (_base_dir / _name).resolve()\n    if not _target.is_relative_to(_base_dir):\n        raise PermissionError(f"Path traversal outside virtual workspace forbidden: {_name}")\n    if len(_target.parts) > len(_base_dir.parts) + 1:\n        _target.parent.mkdir(parents=True, exist_ok=True)\n    _target.write_text(_content, encoding="utf-8")`,
        { globals: ns }
      );
    }
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      phase: "load",
      stdout: out,
      error: `Python initialization error: ${(err as Error).message ?? err}`,
    });
    return;
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
    const lines = friendlyPyError(msg).split("\n");
    // Line of the learner's code that raised (tracebacks name it "<exec>"), only for the code phase.
    const at = phase === "code" ? [...msg.matchAll(/File "<exec>", line (\d+)/g)].pop()?.[1] : undefined;
    self.postMessage({ id, ok: false, phase, stdout: out, error: lines.slice(-16).join("\n").trim(), errorLine: at ? Number(at) : undefined });
  } finally {
    // Teardown ephemeral directory and clean sys.path.
    try {
      await p.runPythonAsync(TEARDOWN_DIR, { globals: ns });
    } catch {
      /* ignore cleanup error */
    }
  }
}
