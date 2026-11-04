/// <reference lib="webworker" />
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
  return p;
}

self.onmessage = async (e: MessageEvent<{ id: number; code: string; tests?: string }>) => {
  const { id, code, tests } = e.data;
  let out = "";
  const write = (s: string) => {
    if (out.length < 20000) out += s + "\n";
  };
  try {
    py ??= boot();
    const p = await py;
    p.setStdout({ batched: write });
    p.setStderr({ batched: write });
    // Packages (pandas, numpy…) are fetched from Pyodide's own CDN before the guard applies.
    await p.loadPackagesFromImports(`${code}\n${tests ?? ""}`);
    const ns = p.globals.get("dict")();
    await p.runPythonAsync(GUARD, { globals: ns });
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
      self.postMessage({ id, ok: false, phase, stdout: out, error: lines.slice(-12).join("\n").trim() });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, phase: "load", stdout: out, error: `Python could not start: ${(err as Error).message}` });
  }
};
