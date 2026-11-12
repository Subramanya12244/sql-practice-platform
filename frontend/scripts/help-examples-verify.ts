// Runs every Python Try Example in real Pyodide (the version the app loads) inside Chrome and compares stdout to `expectedStdout`.
//   npx vite-node scripts/help-examples-verify.ts [sectionId ...]
import { chromium } from "playwright-core";
import { SECTIONS } from "../src/site/help/registry";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
const only = new Set(process.argv.slice(2));
const norm = (s: string) => s.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
const tasks = SECTIONS.filter((s) => s.example?.language === "python" && (!only.size || only.has(s.id))).map((s) => ({ id: s.id, code: s.example!.code, expected: s.example!.expectedStdout ?? "" }));
console.log(`${tasks.length} Python help examples to verify in Pyodide`);

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto("about:blank");
await page.addScriptTag({ url: `${PYODIDE}pyodide.js` });
await page.evaluate(async (url) => { (window as any).py = await (window as any).loadPyodide({ indexURL: url }); }, PYODIDE);
let failed = 0;
for (const t of tasks) {
  const r = await page.evaluate(async (task) => {
    const py = (window as any).py;
    let stdout = "";
    let error = "";
    try {
      await py.loadPackagesFromImports(task.code);
      py.setStdout({ batched: (s: string) => { stdout += s + "\n"; } });
      py.setStderr({ batched: () => {} });
      await py.runPythonAsync(task.code);
    } catch (e) { error = String((e as Error).message ?? e).split("\n").slice(-3).join(" | "); }
    return { stdout, error };
  }, t);
  const ok = !r.error && norm(r.stdout) === norm(t.expected);
  if (!ok) { failed++; console.log(`FAIL ${t.id}: ${r.error || `got\n${norm(r.stdout)}\nexpected\n${norm(t.expected)}`}`); } else console.log(`ok   ${t.id}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
