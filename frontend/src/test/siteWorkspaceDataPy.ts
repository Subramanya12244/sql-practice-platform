// Test helper (not a test file): runs Python for real in CPython with numpy and pandas, behind the same signature as lib/pyRunner `runPython`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PyResult } from "../site/lib/pyRunner";

const here = path.resolve(__dirname);
const candidates = [
  process.env.DATA_PYTHON, process.env.DAILY_PYTHON,
  path.resolve(here, "../../../.venv-daily/bin/python"),
  path.resolve(here, "../../../../sql-practice-platform/.venv-daily/bin/python"),
  path.resolve(here, "../../../../sql-practice-platform-integration/.venv-daily/bin/python"),
  "python3",
].filter((x): x is string => !!x);
const usable = (p: string) => (p === "python3" || existsSync(p)) && spawnSync(p, ["-c", "import numpy, pandas"]).status === 0;
export const PYTHON: string | null = candidates.find(usable) ?? null;
export const hasDataPython = PYTHON !== null;
export const pythonVersions = (): string => (PYTHON ? spawnSync(PYTHON, ["-c", "import sys,numpy,pandas;print(sys.version.split()[0],'numpy',numpy.__version__,'pandas',pandas.__version__)"], { encoding: "utf8" }).stdout.trim() : "none");

/** Same contract as runPython: code (+ optional tests run in the same namespace afterwards), phase says where it failed. */
export function cpythonRun(code: string, tests?: string, _timeoutMs?: number, _stdin?: string, files?: Record<string, string>): Promise<PyResult> {
  const wrapper = `
import sys, io, traceback, json, os, tempfile
_d = tempfile.mkdtemp(); os.chdir(_d)
for _n, _c in json.loads(${JSON.stringify(JSON.stringify(files ?? {}))}).items():
    open(_n, "w").write(_c)
_ns = {}
_phase = "code"
try:
    exec(compile(${JSON.stringify(code)}, "<exec>", "exec"), _ns)
    if ${JSON.stringify(tests ?? null)} is not None:
        _phase = "tests"
        exec(compile(${JSON.stringify(tests ?? "")}, "<tests>", "exec"), _ns)
except BaseException:
    sys.stdout.flush()
    print("\\x1fPHASE:" + _phase, file=sys.stderr)
    traceback.print_exc()
    sys.exit(3)
`;
  const t0 = Date.now();
  const r = spawnSync(PYTHON ?? "python3", ["-I", "-"], { input: wrapper, encoding: "utf8", timeout: 90_000, maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - t0;
  if (r.status === 0) return Promise.resolve({ ok: true, stdout: r.stdout, ms });
  const m = /\x1fPHASE:(code|tests)/.exec(r.stderr);
  const err = r.stderr.replace(/\x1fPHASE:\w+\n/, "").trim().split("\n").slice(-6).join("\n");
  return Promise.resolve({ ok: false, stdout: r.stdout, error: err, phase: (m?.[1] as "code" | "tests") ?? "code", ms });
}
