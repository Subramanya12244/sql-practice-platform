// Runs every browser-flagged Python example and every graded Python exercise solution in real Pyodide (the version the app
// loads) inside Chrome, and compares the output. This is the check the CPython-based tests cannot make.
//   node scripts/daily-browser-verify.mjs [dayId ...]
import { chromium } from "playwright-core";
import { loadDays } from "./daily-lib.mjs";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
const only = new Set(process.argv.slice(2));
const norm = (s) => s.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");

const tasks = [];
for (const d of loadDays()) {
  if (only.size && !only.has(d.id)) continue;
  for (const e of d.examples) if (e.lang === "python" && e.browser) tasks.push({ where: `${d.id} example ${e.id}`, code: e.code, stdin: e.stdin ? `${e.stdin}\n` : "", expected: e.output });
  for (const e of [...d.extras.guided, ...d.extras.independent]) {
    if (e.kind === "python") tasks.push({ where: `${d.id} exercise ${e.id} solution`, code: e.solution, stdin: e.stdin ? `${e.stdin}\n` : "", expected: e.expected });
  }
}
console.log(`${tasks.length} Python tasks to verify in Pyodide`);

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto("about:blank");
await page.addScriptTag({ url: `${PYODIDE}pyodide.js` });
await page.evaluate(async (url) => { window.py = await loadPyodide({ indexURL: url }); }, PYODIDE);

let failed = 0;
const CHUNK = 25;
for (let i = 0; i < tasks.length; i += CHUNK) {
  const results = await page.evaluate(async (batch) => {
    const out = [];
    for (const t of batch) {
      let stdout = "";
      let error = "";
      try {
        await window.py.loadPackagesFromImports(t.code);
        let stdin = t.stdin;
        window.py.setStdout({ batched: (s) => { stdout += s + "\n"; } });
        window.py.setStderr({ batched: () => {} });
        window.py.setStdin({ stdin: () => { if (!stdin) return null; const i = stdin.indexOf("\n"); const line = i < 0 ? stdin : stdin.slice(0, i + 1); stdin = stdin.slice(line.length); return line; } });
        const globals = window.py.globals.get("dict")();
        try { await window.py.runPythonAsync(t.code, { globals }); } finally { globals.destroy(); }
      } catch (e) { error = String(e.message ?? e).split("\n").slice(-3).join(" | "); }
      out.push({ stdout, error });
    }
    return out;
  }, tasks.slice(i, i + CHUNK));
  results.forEach((r, k) => {
    const t = tasks[i + k];
    if (r.error || norm(r.stdout) !== norm(t.expected)) {
      failed++;
      console.log(`FAIL ${t.where}${r.error ? `\n  error: ${r.error}` : `\n  expected: ${JSON.stringify(norm(t.expected).slice(0, 200))}\n  got:      ${JSON.stringify(norm(r.stdout).slice(0, 200))}`}`);
    }
  });
}
await browser.close();
console.log(failed ? `${failed} of ${tasks.length} failed in Pyodide` : `all ${tasks.length} Python tasks match in Pyodide`);
process.exit(failed ? 1 : 0);
