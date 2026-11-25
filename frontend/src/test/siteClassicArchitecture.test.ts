// @vitest-environment node
/**
 * Architecture guardrails for the SQL Practice visualizer (docs/SQL_VISUALIZER_ORIGINAL_ARCHITECTURE.md, docs/SQL_VISUALIZER_UPGRADE_CONTRACT.md).
 *
 * SQL Practice question pages show the ORIGINAL SQL visualizer (the "classic" layer, recovered from commit 9be309e^). The Query Cinema
 * (VizView, QueryCinema, cinema.ts, aggDetail.ts, the non-classic RowFlow / rowFlow / rowTrace) belongs to /query-visualizer, the business
 * scenarios and the exercise workspace. These tests read source text only (node:fs), so they are cheap, need no database and do not
 * depend on how many files the other agents add: the classic layer is found by walking the folders, never by a fixed file list.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const DOCS = resolve(SITE, "../../../docs");

/* ---------- source helpers ---------- */

const posix = (p: string) => p.split(sep).join("/");
/** Path relative to src/site, forward slashes, no extension: the form used in the tables below. */
const rel = (abs: string) => posix(relative(SITE, abs)).replace(/\.(tsx?|jsx?|css|json)$/, "");
const read = (relPath: string) => readFileSync(join(SITE, relPath), "utf8");
const exists = (relPath: string) => existsSync(join(SITE, relPath));

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : walk(full);
    return [full];
  });
}
const isCode = (f: string) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f);

/** Source without comments, so a header comment that names the Cinema is not mistaken for an import of it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Every module specifier a file imports, re-exports or dynamically imports. */
function importsOf(text: string): string[] {
  const src = code(text);
  const specs = new Set<string>();
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/gm)) specs.add(m[1]);
  for (const m of src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) specs.add(m[1]);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]);
  for (const m of src.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]);
  return [...specs];
}

/** A relative specifier resolved to a path under src/site without extension ("components/visual/RowFlow"); null for packages. */
function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const abs = resolve(dirname(fromFile), spec.replace(/\?.*$/, ""));
  let r = rel(abs);
  if (existsSync(abs) && statSync(abs).isDirectory()) r += "/index";
  return r;
}

const importsResolved = (file: string) => importsOf(readFileSync(file, "utf8")).map((spec) => ({ spec, target: resolveSpec(file, spec) }));

/* ---------- the layers ---------- */

/** Everything that belongs to the classic (original) visualizer layer. Found by name and folder, so new files are covered automatically. */
function classicFiles(): string[] {
  const inFolders = [...walk(join(SITE, "components/visual/classic")), ...walk(join(SITE, "lib/visual/classic"))];
  const byName = [...walk(join(SITE, "components"))].filter((f) => /(^|\/)(VizViewClassic|RowFlowClassic|Classic[A-Z][A-Za-z]*)\.tsx?$/.test(posix(f)));
  return [...new Set([...inFolders, ...byName])].filter(isCode).sort();
}
const classicCss = () => readdirSync(SITE).filter((f) => /^classic-.*\.css$/.test(f)).map((f) => join(SITE, f));

/** The Cinema's modules, as paths under src/site without extension. The classic layer must never import any of them. */
const CINEMA = new Set([
  "components/VizView",
  "components/visual/QueryCinema",
  "components/visual/HighlightedSql",
  "components/visual/RowFlow",
  "lib/visual/cinema",
  "lib/visual/aggDetail",
  "lib/visual/rowFlow",
  "lib/visual/rowTrace",
]);

const isClassicTarget = (t: string) =>
  t === "components/VizViewClassic" || t === "components/visual/RowFlowClassic" || t.startsWith("components/visual/classic/") || t === "components/visual/classic" ||
  t.startsWith("lib/visual/classic/") || t === "lib/visual/classic" || /^components\/visual\/Classic[A-Z]/.test(t) || /^components\/Classic[A-Z]/.test(t);

const siteCode = () => walk(SITE).filter(isCode);

describe("the helpers used by these guardrails", () => {
  it("find static, re-exported and dynamic imports, and ignore comments", () => {
    const text = [
      '/** import { VizView } from "../VizView"; */',
      '// import x from "./nope";',
      'import { a } from "./a";',
      'import type { B } from "../b";',
      'import {\n  c,\n  d,\n} from "./c";',
      'export { e } from "./e";',
      'import "./side";',
      'const l = () => import("./lazy");',
      'const url = "https://example.com/not-a-comment";',
    ].join("\n");
    expect(importsOf(text).sort()).toEqual(["../b", "./a", "./c", "./e", "./lazy", "./side"].sort());
  });
  it("resolve a relative specifier to the module path the tables use, and a package to null", () => {
    expect(resolveSpec(join(SITE, "components/VizViewClassic.tsx"), "./visual/RowFlow")).toBe("components/visual/RowFlow");
    expect(resolveSpec(join(SITE, "components/visual/classic/X.tsx"), "../../../lib/visual/cinema")).toBe("lib/visual/cinema");
    expect(resolveSpec(join(SITE, "components/VizViewClassic.tsx"), "react")).toBeNull();
  });
  it("find the classic layer by walking the folders (so files other agents add are covered)", () => {
    const names = classicFiles().map((f) => rel(f));
    for (const must of ["components/VizViewClassic", "components/visual/RowFlowClassic", "lib/visual/classic/rowFlow", "lib/visual/classic/rowTrace", "lib/visual/classic/contract", "components/visual/classic/useClassicStep"]) {
      expect(names, must).toContain(must);
    }
  });
});

describe("the classic layer never imports the Query Cinema", () => {
  it("no classic file imports VizView, QueryCinema, cinema.ts, aggDetail.ts, the Cinema's HighlightedSql, or the non-classic RowFlow, rowFlow and rowTrace", () => {
    const offenders: string[] = [];
    for (const file of classicFiles()) {
      for (const { spec, target } of importsResolved(file)) {
        if (target && CINEMA.has(target)) offenders.push(`${rel(file)} imports ${spec} (${target})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("classic code and styles use no Cinema class name or test id (the Cinema's CSS must not leak into SQL Practice)", () => {
    const offenders: string[] = [];
    for (const file of classicFiles()) {
      const src = code(readFileSync(file, "utf8"));
      if (/\bcinema-[a-z]/i.test(src) || /["'`]cinema["'`]/.test(src) || /\bcinema-(fit|split|canvas|insights|expand|keys|dark)\b/.test(src)) offenders.push(rel(file));
    }
    for (const file of classicCss()) if (/\.cinema/i.test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""))) offenders.push(rel(file));
    expect(offenders).toEqual([]);
  });

  it("classic stylesheets are scoped: no rule on a bare element selector, so Python, Pandas, NumPy and the Cinema are not restyled", () => {
    const bare = /^(a|abbr|body|button|code|dd|div|dl|dt|h[1-6]|html|input|label|li|ol|p|pre|section|select|span|svg|table|tbody|td|th|thead|tr|ul)\b(?![.#[:-])/;
    const offenders: string[] = [];
    for (const file of classicCss()) {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      // top-level and one-level-nested (@media / @container) selector lists; @keyframes bodies are not selectors
      let depth = 0, buf = "", skip = -1;
      for (const ch of css) {
        if (ch === "{") {
          const sel = buf.trim();
          if (skip < 0 && /^@keyframes|^@font-face|^@property/.test(sel)) skip = depth;
          else if (skip < 0 && !sel.startsWith("@")) for (const one of sel.split(",")) if (bare.test(one.trim())) offenders.push(`${rel(file)}: ${one.trim()}`);
          depth++; buf = "";
        } else if (ch === "}") { depth--; if (depth === skip) skip = -1; buf = ""; }
        else if (ch === ";") buf = "";
        else buf += ch;
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the classic layer adds no second execution engine and no second playback system", () => {
  const ENGINE = /pglite|pyodide|pyRunner|sqlRunner|pglite\.worker|pyodide\.worker|virtualFs/i;

  it("no classic file imports or starts PGlite, Pyodide, a worker or a runner", () => {
    const offenders: string[] = [];
    for (const file of classicFiles()) {
      const text = readFileSync(file, "utf8");
      for (const spec of importsOf(text)) if (ENGINE.test(spec)) offenders.push(`${rel(file)} imports ${spec}`);
      const src = code(text);
      if (/\bnew\s+(Shared)?Worker\s*\(|\bPGlite(Worker)?\b|\bloadPyodide\b|\bWebAssembly\.(instantiate|compile)/.test(src)) offenders.push(`${rel(file)} starts an engine`);
    }
    expect(offenders).toEqual([]);
  });

  it("only the host (VizViewClassic) reaches the database, through lib/browserDb.runQuery; every other classic file is handed what it needs", () => {
    const offenders: string[] = [];
    for (const file of classicFiles()) {
      if (rel(file) === "components/VizViewClassic") continue;
      for (const { spec, target } of importsResolved(file)) if (target === "lib/browserDb" || (target && /^lib\/(sqlRunner|pglite\.worker)$/.test(target))) offenders.push(`${rel(file)} imports ${spec}`);
    }
    expect(offenders).toEqual([]);
  });

  it("lib/visual/classic is pure data: no React, no component and no DOM or storage access", () => {
    const offenders: string[] = [];
    for (const file of classicFiles().filter((f) => rel(f).startsWith("lib/visual/classic/"))) {
      const text = readFileSync(file, "utf8");
      for (const { spec, target } of importsResolved(file)) {
        if (/^react(-dom)?(\/|$)/.test(spec) || (target && /^(components|pages|workspace)\//.test(target))) offenders.push(`${rel(file)} imports ${spec}`);
      }
      if (/\b(?:window\.(?:localStorage|sessionStorage|matchMedia|addEventListener|location|document|requestAnimationFrame|setTimeout|getComputedStyle)|document\.(?:body|documentElement|getElementById|querySelector|querySelectorAll|createElement|addEventListener)|localStorage\.|sessionStorage\.|navigator\.)/.test(code(text))) offenders.push(`${rel(file)} touches the DOM or storage`);
    }
    expect(offenders).toEqual([]);
  });

  it("the classic layer does not import the pages, the workspace or the other visualizers' engines", () => {
    const offenders: string[] = [];
    for (const file of classicFiles()) {
      for (const { spec, target } of importsResolved(file)) {
        if (target && (/^(pages|workspace)\//.test(target) || /^lib\/(py[A-Z]|pandas|numpy|ndarray|dataframe|broadcast|dataBeats|dataDiff|dataProbe)/.test(target) || /^components\/(visual\/)?(Python|PandasFlow|PandasPictures|PandasBeat|NumpyBeat|NumpyParts|DataFrameView|ArrayView|BroadcastView|DataStudio)/.test(target))) {
          offenders.push(`${rel(file)} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("one playback: the shared usePlayback is called exactly once in the classic layer, and no classic file reimplements it", () => {
    const calls: string[] = [];
    const offenders: string[] = [];
    for (const file of classicFiles()) {
      const src = code(readFileSync(file, "utf8"));
      calls.push(...[...src.matchAll(/(?<![.\w])usePlayback\s*\(/g)].map(() => rel(file)));
      if (/\b(playbackReducer|initialPlayback)\b/.test(src) || /\bsetInterval\s*\(/.test(src)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
    expect(calls).toEqual(["components/VizViewClassic"]);
  });
});

describe("the SQL Practice integration point", () => {
  it("QuestionPage renders VizViewClassic and imports nothing from the Cinema", () => {
    const file = join(SITE, "pages/QuestionPage.tsx");
    const targets = importsResolved(file).map((i) => i.target).filter((t): t is string => Boolean(t));
    expect(targets).toContain("components/VizViewClassic");
    expect(targets.filter((t) => CINEMA.has(t))).toEqual([]);
    const src = code(read("pages/QuestionPage.tsx"));
    expect(src).toMatch(/<VizViewClassic\b/);
    expect(src).not.toMatch(/<VizView\b(?!Classic)/);
    expect(src).not.toMatch(/QueryCinema/);
  });

  it("the host keeps its public contract: sql, dataset, onDone (session summary) and onClause (editor highlight), plus the VizSummary type", () => {
    const text = read("components/VizViewClassic.tsx");
    expect(text).toMatch(/export function VizViewClassic\s*\(/);
    expect(text).toMatch(/export interface VizSummary\b/);
    const sig = /export function VizViewClassic\s*\(\{([^}]*)\}\s*:\s*\{([\s\S]*?)\n\}\)/.exec(text);
    expect(sig, "VizViewClassic signature").not.toBeNull();
    const props = `${sig![1]}\n${sig![2]}`;
    for (const p of ["sql", "dataset", "onDone", "onClause"]) expect(props, p).toMatch(new RegExp(`\\b${p}\\b`));
    // QuestionPage still feeds both callbacks
    const page = code(read("pages/QuestionPage.tsx"));
    expect(page).toMatch(/onClause=/);
    expect(page).toMatch(/onDone=/);
    expect(page).toMatch(/highlightInEditor/);
  });

  it("the host runs the one existing engine: runQuery, visualize() and the classic traceRows, never the Cinema's rowTrace", () => {
    const file = join(SITE, "components/VizViewClassic.tsx");
    const byTarget = new Map(importsResolved(file).filter((i) => i.target).map((i) => [i.target!, i.spec]));
    expect([...byTarget.keys()]).toEqual(expect.arrayContaining(["lib/browserDb", "lib/visualize", "lib/visual/classic/rowTrace", "components/visual/Playback", "components/visual/RowFlowClassic"]));
    const text = code(readFileSync(file, "utf8"));
    expect(text).toMatch(/\brunQuery\b/);
    expect(text).toMatch(/\bvisualize\s*\(/);
    expect(text).toMatch(/\btraceRows\s*\(/);
  });

  it("the host derives everything from the one ClassicStep (useClassicStep), as the contract requires", () => {
    const text = code(read("components/VizViewClassic.tsx"));
    expect(text).toMatch(/\buseClassicStep\s*\(/);
    const hook = code(read("components/visual/classic/useClassicStep.ts"));
    expect(hook).toMatch(/export function useClassicStep\b/);
    const contract = read("lib/visual/classic/contract.ts");
    expect(contract).toMatch(/export interface ClassicStep\b/);
    for (const field of ["index", "count", "stage", "range", "frame", "teach", "progress", "playing"]) expect(contract, `ClassicStep.${field}`).toMatch(new RegExp(`\\b${field}\\??:`));
  });

  it("the Cinema keeps its places: /query-visualizer, the business scenarios and the exercise workspace import VizView, not the classic layer", () => {
    for (const f of ["pages/QueryVisualizerPage.tsx", "pages/ScenarioPages.tsx", "workspace/visualizers/sql/ClassicSqlVisualizer.tsx"]) {
      const file = join(SITE, f);
      const targets = importsResolved(file).map((i) => i.target).filter((t): t is string => Boolean(t));
      expect(targets, f).toContain("components/VizView");
      expect(targets.filter(isClassicTarget), f).toEqual([]);
      expect(code(read(f)), f).not.toMatch(/VizViewClassic/);
    }
  });

  it("the shared original VizView stays for the other pages, and the Cinema is gone from the code base (main removed it)", () => {
    for (const f of ["components/VizView.tsx", "components/visual/RowFlow.tsx", "lib/visual/rowFlow.ts", "lib/visual/rowTrace.ts"]) expect(exists(f), f).toBe(true);
    for (const f of ["components/visual/QueryCinema.tsx", "lib/visual/cinema.ts", "lib/visual/aggDetail.ts", "components/visual/HighlightedSql.tsx"]) expect(exists(f), f).toBe(false);
    expect(code(read("components/VizView.tsx"))).not.toMatch(/QueryCinema/);
  });
});

describe("nothing outside SQL Practice reaches into the classic layer", () => {
  it("only the classic layer itself and pages/QuestionPage.tsx import classic modules (so the Cinema pages, the workspace and every other page stay clear)", () => {
    const classic = new Set(classicFiles());
    const offenders: string[] = [];
    for (const file of siteCode()) {
      if (classic.has(file)) continue;
      for (const { spec, target } of importsResolved(file)) {
        if (target && isClassicTarget(target) && rel(file) !== "pages/QuestionPage") offenders.push(`${rel(file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no Python, Pandas or NumPy visualizer file imports anything from components/visual/classic or lib/visual/classic", () => {
    const named = /(^|\/)(py[A-Z][A-Za-z]*|Py[A-Z][A-Za-z]*|Python[A-Za-z]*|Pandas[A-Za-z]*|pandas[A-Za-z]*|Numpy[A-Za-z]*|numpy[A-Za-z]*|ndarray|dataframe|DataFrameView|ArrayView|broadcast|Broadcast[A-Za-z]*|dataBeats|dataDiff|dataProbeProgram|DataStudio|DataStageViewer)\.tsx?$/;
    const folders = /^workspace\/(visualizers|adapters)\/(python|data)\//;
    const files = siteCode().filter((f) => named.test(posix(f)) || folders.test(posix(relative(SITE, f))));
    expect(files.length, "the pattern must find the Python, Pandas and NumPy visualizers").toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const { spec, target } of importsResolved(file)) if (target && isClassicTarget(target)) offenders.push(`${rel(file)} imports ${spec}`);
      if (/visual\/classic\b|RowFlowClassic|VizViewClassic/.test(code(text))) offenders.push(`${rel(file)} mentions the classic layer`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the architecture document", () => {
  it("exists and records the git evidence it is built on", () => {
    const file = join(DOCS, "SQL_VISUALIZER_ORIGINAL_ARCHITECTURE.md");
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    for (const evidence of ["9be309e", "cb29eff", "0db0b58", "4e4acb9", "ClassicStep", "useClassicStep"]) expect(text, evidence).toContain(evidence);
  });
});
