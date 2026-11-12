// Writes docs/VISUAL_LEARNING_COVERAGE.md: which learning aid each of the 270 Daily Learning lessons uses, and why.
//   node scripts/visual-coverage.mjs [output.md]
// Read only for lesson files. It loads src/site/lib/visual/dailyVisual.ts directly (Node strips the types), so the table
// always matches the mapping the app uses. Aid and preset status is read from the aid source files as text, because those
// files import app modules that plain node cannot load.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { curriculum, loadDays } from "./daily-lib.mjs";
import { AID_NAMES, PRESET_KINDS, TEMPLATES, explainVisual, visualHref } from "../src/site/lib/visual/dailyVisual.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, "../src/site");
const out = process.argv[2] ?? path.join(here, "../../docs/VISUAL_LEARNING_COVERAGE.md");

/** Aid kind -> files that must exist. `lib` holds the PRESETS export of the eight preset-aware aids. */
const AID_FILES = {
  tree: ["TreeExplorer", "tree"], graph: ["GraphExplorer", "graph"], excel: ["ExcelLab", "excel"], linux: ["LinuxLab", "linux"],
  git: ["GitLab", "git"], stats: ["StatsLab", "stats"], business: ["BusinessLab", "business"], interview: ["InterviewLab", "interview"],
};
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

/** { shipped, presets } per aid kind. A placeholder component holds the text "is being built". */
function aidStatus(kind) {
  if (!AID_FILES[kind]) return { shipped: true, presets: null, note: "shipped in the first release; ignores ?preset=" };
  const [comp, lib] = AID_FILES[kind];
  const c = read(path.join(site, `components/visual/${comp}.tsx`));
  const l = read(path.join(site, `lib/visual/${lib}.ts`));
  if (c === null || c.includes("is being built")) return { shipped: false, presets: null, note: "pending aid (component is still the placeholder)" };
  const m = l && l.match(/export const PRESETS[^=]*=\s*\[([\s\S]*?)\n\];/);
  const ids = m ? [...m[1].matchAll(/\bid:\s*["']([^"']+)["']/g)].map((x) => x[1]) : [];
  if (!ids.length) return { shipped: true, presets: [], note: "shipped, but no PRESETS export found" };
  return { shipped: true, presets: ids, note: `shipped, ${ids.length} presets` };
}

// What the app attached before this work: the first-release rules, with no per-lesson table.
const LEGACY = [
  ["api", /\b(apis?|http|rest|requests?|responses?|status codes?|pagination|rate limit\w*|retry|retries|backoff|idempoten\w*|oauth|tokens?)\b/i],
  ["etl", /\b(etl|elt|pipelines?|incremental|watermarks?|cdc|slowly changing|scd|dead.letter|quarantine|orchestrat\w*|airflow|data quality|loading|source-to-target|backfills?|late data|batch processing|reconciliation|validate loaded|load facts|task dependencies|data contracts|schema checks|dags?|sensors|xcoms?)\b/i],
  ["chart", /\b(charts?|visuali[sz]ations?|plots?|plotting|histograms?|dashboards?|storytelling|matplotlib|seaborn|heatmaps?|power bi)\b/i],
  ["data", /\b(pandas|dataframes?|numpy|ndarrays?|arrays?|broadcast\w*|groupby|merge|pivot|melt|vectori[sz]ation|axes|axis|dtypes?|loc and iloc|iloc|value_counts|isna|dropna|fillna|missing values|drop_duplicates|sort_values|to_datetime|rolling|resampl\w*|read_csv|boolean masks?|datetime handling|inspecting data)\b/i],
  ["sql", /\b(sql|select|joins?|where|group by|having|window|ctes?|subquer\w*|quer(y|ies)|postgres\w*|indexes|aggregat\w*|null handling|order by|distinct|exists|lag|lead|ntile|row_number|rank\w*|deduplication|ddl|constraints|relational model|northwind|date and time functions|anti-joins?)\b/i],
  ["python", /\b(python|loops?|lists?|dict(ionar(y|ies))?|tuples?|sets?|functions?|recursion|recursive|generators?|iterators?|exceptions?|class(es)?|strings?|variables?|comprehensions?|lambda|decorators?|scope|conditionals?|statements?|booleans?|operators?|numbers?|inheritance|object-oriented|dates and times|datetime|file handling|modules?|venv|regular expressions?|pytest|testing)\b/i],
];
function legacyKind(title, topics, lang) {
  const text = `${title} ${topics.join(" ")}`;
  for (const [k, re] of LEGACY) if (re.test(text)) return k;
  return lang === "sql" ? "sql" : lang === "python" ? "python" : undefined;
}

const PHASE_TECH = {
  "python-fundamentals": "Python", "python-intermediate": "Python", "sql-fundamentals": "SQL (PostgreSQL)", "sql-advanced": "SQL (PostgreSQL)",
  "python-testing": "Python (pytest)", numpy: "NumPy", pandas: "pandas", "statistics-foundations": "Statistics (Python)", excel: "Excel",
  "analyst-statistics": "Statistics (Python)", eda: "Exploratory analysis (pandas)", visualisation: "Python charts (Matplotlib, Seaborn, Plotly)",
  "power-bi": "Power BI (Power Query, DAX)", storytelling: "Data storytelling and dashboards", "business-analytics": "Business analytics (SQL and Python)",
  "analyst-data-prep": "Python and SQL", "analyst-interview": "Interview preparation", "analyst-capstone": "Capstone project",
  "ingestion-csv-excel": "Python and PostgreSQL ingestion", "rest-api": "REST APIs (Python)", "sql-python-eng": "SQL and Python",
  etl: "ETL (Python)", "data-quality": "Data quality (Python, SQL)", warehousing: "Data warehousing (SQL)", "linux-tools": "Linux, shell and Docker",
  airflow: "Apache Airflow", spark: "Apache Spark (PySpark)", "engineer-interview": "Interview preparation", "engineer-capstone": "Capstone project",
};
const TECH_BY_ID = { d029: "Linux shell", d030: "Git and GitHub", d062: "Python (pytest)", a098: "Excel (Power Query)", a099: "Excel (Power Query)", e140: "Git and GitHub, CI", e163: "Apache Spark (PySpark)", a179: "Git and GitHub", e179: "Git and GitHub" };

const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const words = (s) => s.replace(/\*\*|`/g, "");

function objective(section = "") {
  const bullets = [...section.matchAll(/^- (.+)$/gm)].map((x) => words(x[1]));
  if (!bullets.length) return "(no Objectives section)";
  return bullets[0] + (bullets.length > 1 ? ` (+${bullets.length - 1} more)` : "");
}

const days = loadDays();
const status = Object.fromEntries(Object.keys(TEMPLATES).map((k) => [k, aidStatus(k)]));
const rows = days.map((d) => {
  const meta = d.meta;
  const lang = d.examples[0]?.lang;
  const choice = explainVisual({ id: d.id, title: meta.title, topics: meta.topics, lang });
  if (!choice) throw new Error(`${d.id} has no aid`);
  const t = choice.template;
  const kind = t.kind;
  const st = status[kind];
  const browser = d.examples.filter((e) => e.browser).length;
  const local = d.examples.length - browser;
  const graded = [...d.extras.guided, ...d.extras.independent].filter((e) => e.kind !== "written").length;
  const written = [...d.extras.guided, ...d.extras.independent].filter((e) => e.kind === "written").length;
  const old = legacyKind(meta.title, meta.topics, lang);
  const oldRulesOnly = legacyKind(meta.title, meta.topics, undefined);
  const existing = [
    `"Watch it run" under ${browser} runnable example${browser === 1 ? "" : "s"}`,
    `"Explain visually" under ${graded} graded exercise${graded === 1 ? "" : "s"}`,
    old ? `helper link before: ${AID_NAMES[old]}` : "helper link before: none",
  ].join("; ");
  const missing = [];
  if (choice.generic) missing.push(choice.generic);
  if (PRESET_KINDS.includes(kind) && !t.preset) missing.push("no preset hint: the aid opens on its default example");
  if (local) missing.push(`${local} example${local === 1 ? "" : "s"} run on the learner's computer (text only, no visual block)`);
  if (written) missing.push(`${written} written exercise${written === 1 ? "" : "s"} (self-assessed, no visual block)`);
  let validation = "mapping test; route exists";
  if (PRESET_KINDS.includes(kind)) {
    if (!st.shipped) validation += t.preset ? `; preset \`${t.preset}\` pending aid` : "; aid pending";
    else if (t.preset) validation += st.presets.includes(t.preset) ? `; preset \`${t.preset}\` exists in PRESETS` : `; PRESET \`${t.preset}\` MISSING`;
    else validation += "; no preset to check";
  } else validation += "; aid shipped and tested in the first release";
  return {
    id: d.id, day: meta.day, path: meta.path, title: meta.title, objective: objective(d.sections["Objectives"]), tech: TECH_BY_ID[d.id] ?? PHASE_TECH[meta.phase] ?? meta.phase,
    kind, aid: AID_NAMES[kind], preset: t.preset, href: visualHref(t), why: choice.why, source: choice.source, generic: choice.generic,
    oldRulesOnly, existing, missing: missing.length ? missing.join("; ") : "none identified", validation, old,
  };
});

if (rows.length !== curriculum.days.length) throw new Error(`only ${rows.length} of ${curriculum.days.length} lessons are authored`);

const count = (f) => rows.filter(f).length;
const L = [];
L.push("# Visual learning coverage of the 270 lessons", "");
L.push("Generated by `frontend/scripts/visual-coverage.mjs`. Do not edit by hand: run `node scripts/visual-coverage.mjs` from `frontend/`. The mapping lives in `frontend/src/site/lib/visual/dailyVisual.ts`; no lesson file is edited.", "");
L.push("## Summary", "");
const before = count((r) => r.old);
L.push(`- Lessons: ${rows.length} (90 common, 90 Data Analyst, 90 Data Engineer). Lessons with a learning aid: ${count((r) => r.kind)} of ${rows.length}. Before this work: ${count((r) => r.oldRulesOnly)} by title and topic rules alone, ${before} once the lesson page's fallback to the language of the first example is counted (those fallback links often pointed at the Python or SQL tool for an Excel, Git, statistics or business lesson).`);
L.push(`- Chosen by a per-lesson override: ${count((r) => r.source === "override")}. By a title or topic rule: ${count((r) => r.source === "rule")}. By the language fallback: ${count((r) => r.source === "language")}.`);
L.push(`- Lessons where the aid is a generic or partial fit: ${count((r) => r.generic)} (listed below, each with what the aid does not cover).`);
L.push(`- Lessons with a preset hint (opens the aid on the matching example): ${count((r) => r.preset)}.`);
L.push("- The aids are teaching models. Each one labels itself Executed, Parsed, Plan, Estimated, Conceptual or Simulated. Nothing here claims a simulated aid is a real system.", "");
L.push("## Lessons per aid", "", "| Aid | Kind | Route | Lessons | Exact fit | Generic fit | Aid status |", "|---|---|---|---|---|---|---|");
const order = ["sql", "python", "data", "api", "etl", "chart", "tree", "graph", "excel", "linux", "git", "stats", "business", "interview"];
for (const k of order) {
  const n = count((r) => r.kind === k), g = count((r) => r.kind === k && r.generic);
  L.push(`| ${AID_NAMES[k]} | ${k} | \`${TEMPLATES[k].route}\` | ${n} | ${n - g} | ${g} | ${status[k].note} |`);
}
L.push(`| **Total** | | | **${rows.length}** | **${count((r) => !r.generic)}** | **${count((r) => r.generic)}** | |`, "");
const unused = order.filter((k) => count((r) => r.kind === k) === 0);
if (unused.length) L.push(`Aids with no lessons: ${unused.map((k) => AID_NAMES[k]).join(", ")}. The curriculum has no lesson on that topic (for example, no binary-tree or graph-traversal lesson), and no lesson was forced onto it. The aid stays reachable from the Visual Learning hub.`, "");
L.push("## Lessons whose aid is a generic or partial fit", "", "These get the nearest honest aid. The reason says what the aid does not show.", "", "| Lesson | Title | Aid | Not covered |", "|---|---|---|---|");
for (const r of rows.filter((x) => x.generic)) L.push(`| ${r.id} | ${esc(r.title)} | ${r.aid} | ${esc(r.generic)} |`);
L.push("", "## How to read the table", "",
  "- **Existing integration**: what is attached today. \"Watch it run\" sits under every runnable (browser) example and \"Explain visually\" under every graded exercise; both are the shared opt-in blocks, and they trace Python or open the SQL Query Cinema whatever the lesson topic. \"Helper link before\" is the link the first release chose from the old rules.",
  "- **Missing integration**: honest gaps. The aid's own limit, a missing preset hint, examples that only run on the learner's computer, and written exercises (self-assessed, so no visual block).",
  "- **Validation status**: `mapping test` = `siteVisualCoverage.test.ts` asserts the lesson resolves to this aid; `route exists` = the route is registered; `preset exists` = the preset id is in the aid's `PRESETS`; `pending aid` = the aid's component is still the placeholder, so its presets cannot be checked yet. Browser behaviour is not covered by this table.", "");
for (const [route, label] of [["common", "Common core (days 1 to 90)"], ["analyst", "Data Analyst path (days 91 to 180)"], ["engineer", "Data Engineer path (days 91 to 180)"]]) {
  L.push(`## ${label}`, "", "| Lesson | Title | Learning objective | Technology | Visual learning format | Why this aid | Existing integration | Missing integration | Validation status |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of rows.filter((x) => x.path === route)) {
    L.push(`| ${r.id} | ${esc(r.title)} | ${esc(r.objective)} | ${esc(r.tech)} | ${r.aid} (\`${r.href}\`) | ${esc(r.why)} | ${esc(r.existing)} | ${esc(r.missing)} | ${esc(r.validation)} |`);
  }
  L.push("");
}
fs.writeFileSync(out, L.join("\n"));
console.log(`wrote ${out}: ${rows.length} lessons; per aid ${JSON.stringify(Object.fromEntries(order.map((k) => [k, count((r) => r.kind === k)])))}`);
