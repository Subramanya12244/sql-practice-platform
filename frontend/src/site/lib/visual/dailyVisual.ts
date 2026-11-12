/**
 * Maps a Daily Learning lesson to the learning aid that suits it, from data the lesson already has (its id, topics, title and
 * the language of its runnable code). No lesson file is edited. Three layers, in order:
 *   1. LESSON_OVERRIDES, keyed by lesson id, for lessons that title and topic rules cannot decide (or would decide wrongly);
 *   2. RULES, ordered title/topic patterns (specific topics before general language);
 *   3. the language of the first runnable example (sql or python) as the last fallback.
 * This file has no imports and uses only erasable TypeScript, so the coverage script can load it with plain node.
 */
export type VisualKind = "sql" | "python" | "data" | "api" | "etl" | "chart" | "tree" | "graph" | "excel" | "linux" | "git" | "stats" | "business" | "interview";

export interface VisualTemplate { kind: VisualKind; title: string; blurb: string; route: string; /** Starting example inside the aid (only the preset-aware aids use it). */ preset?: string }

export const TEMPLATES: Record<VisualKind, VisualTemplate> = {
  sql: { kind: "sql", title: "Watch the query run", blurb: "Step through each SQL clause with real rows.", route: "/query-visualizer" },
  python: { kind: "python", title: "Step through the code", blurb: "See each line run with its variables and call stack.", route: "/visual/python" },
  data: { kind: "data", title: "Watch the table change", blurb: "See pandas and NumPy values before and after every step.", route: "/visual/data" },
  api: { kind: "api", title: "Follow the request", blurb: "See the request, the response, retries and pagination.", route: "/visual/api" },
  etl: { kind: "etl", title: "Play the pipeline", blurb: "Watch rows move from source to target, including failures.", route: "/visual/etl" },
  tree: { kind: "tree", title: "Explore the tree", blurb: "Build and walk binary trees step by step.", route: "/visual/tree" },
  graph: { kind: "graph", title: "Run the graph algorithm", blurb: "Watch BFS, DFS and shortest paths with the queue or stack.", route: "/visual/graph" },
  excel: { kind: "excel", title: "Try it in the spreadsheet lab", blurb: "Evaluate formulas, lookups and pivots on a live sheet.", route: "/visual/excel" },
  linux: { kind: "linux", title: "Practise in the terminal lab", blurb: "Run commands against safe sample files.", route: "/visual/linux" },
  git: { kind: "git", title: "See the commit graph", blurb: "Watch commits, branches, merges and conflicts.", route: "/visual/git" },
  stats: { kind: "stats", title: "Explore the statistics", blurb: "Move the data and see distributions, samples and tests respond.", route: "/visual/stats" },
  business: { kind: "business", title: "Work the business case", blurb: "Dashboards and decisions on a sample business.", route: "/visual/business" },
  interview: { kind: "interview", title: "Walk through the question", blurb: "Progressive hints, example answers and follow-ups.", route: "/visual/interview" },
  chart: { kind: "chart", title: "Explore the chart", blurb: "Change the data and see how the chart changes.", route: "/visual/charts" },
};

/** Human names of the aids, used in the coverage table. */
export const AID_NAMES: Record<VisualKind, string> = {
  sql: "SQL Query Cinema", python: "Python Code Time Machine", data: "Pandas and NumPy Studio", api: "API Request Studio", etl: "ETL Pipeline Playback",
  chart: "Data Visualization Explorer", tree: "Tree Explorer", graph: "Graph Explorer", excel: "Excel Lab", linux: "Linux Terminal Lab",
  git: "Git Lab", stats: "Statistics Lab", business: "Business Analytics Lab", interview: "Interview Walkthrough",
};

/** Aids that read `?preset=`. The older aids ignore it, so no preset is ever appended for them. */
export const PRESET_KINDS: VisualKind[] = ["tree", "graph", "excel", "linux", "git", "stats", "business", "interview"];

/** Route plus the preset query. Always a path starting with "/", safe to hand to <Link to>. */
export function visualHref(t: Pick<VisualTemplate, "route" | "preset">): string {
  return t.preset ? `${t.route}?preset=${encodeURIComponent(t.preset)}` : t.route;
}

interface Rule { kind: VisualKind; label: string; re: RegExp }

const RULES: Rule[] = [
  { kind: "interview", label: "interview, mock or portfolio lesson", re: /\b(interviews?|mock|portfolio)\b/i },
  { kind: "tree", label: "binary tree, search tree or tree traversal", re: /\b(binary (search )?trees?|bst|tree traversals?|in-?order|pre-?order|post-?order|heaps?)\b/i },
  { kind: "graph", label: "graph algorithm or traversal", re: /\b(graph (algorithms?|traversals?)|bfs|dfs|breadth-first|depth-first|dijkstra|bellman-ford|topological|shortest paths?|cycle detection|connected components?)\b/i },
  { kind: "git", label: "Git or GitHub workflow", re: /\b(git|github|commits?|branch(es)?|pull requests?)\b/i },
  { kind: "linux", label: "Linux shell, files, permissions or cron", re: /\b(linux|shell|bash|terminal|cron|chmod|permissions|signals)\b/i },
  { kind: "business", label: "business metric, funnel, cohort, segment or stakeholder topic", re: /\b(kpis?|metric trees?|revenue|churn|retention|funnel|rfm|cohorts?|variance analysis|campaigns?|forecast\w*|scenarios?|stakeholders?|storytelling|story structure|executive|pricing)\b/i },
  { kind: "stats", label: "statistics topic", re: /\b(statistics|statistical|standard deviation|skewness|iqr|probability|normal distribution|confidence intervals?|hypothesis|p-values?|t-tests?|chi-square|regression|correlation|covariance|central limit|z-scores?|a\/b testing)\b/i },
  { kind: "api", label: "HTTP, REST or API topic", re: /\b(apis?|http|rest|requests?|responses?|status codes?|pagination|rate limit\w*|retry|retries|backoff|idempoten\w*|oauth|tokens?)\b/i },
  { kind: "etl", label: "pipeline, load or data-quality topic", re: /\b(etl|elt|pipelines?|incremental|watermarks?|cdc|slowly changing|scd|dead.letter|quarantine|orchestrat\w*|airflow|data quality|loading|source-to-target|backfills?|late data|batch processing|reconciliation|validate loaded|load facts|task dependencies|data contracts|schema checks|dags?|sensors|xcoms?)\b/i },
  { kind: "chart", label: "chart or visualisation topic", re: /\b(charts?|visuali[sz]ations?|plots?|plotting|histograms?|dashboards?|matplotlib|seaborn|heatmaps?|power bi)\b/i },
  { kind: "data", label: "pandas or NumPy topic", re: /\b(pandas|dataframes?|numpy|ndarrays?|arrays?|broadcast\w*|groupby|merge|pivot|melt|vectori[sz]ation|axes|axis|dtypes?|loc and iloc|iloc|value_counts|isna|dropna|fillna|missing values|drop_duplicates|sort_values|to_datetime|rolling|resampl\w*|read_csv|boolean masks?|datetime handling|inspecting data)\b/i },
  { kind: "excel", label: "spreadsheet formula, lookup or pivot topic", re: /\b(excel|vlookup|xlookup|spreadsheets?|pivottables?|power query|sumifs|countifs)\b/i },
  { kind: "sql", label: "SQL topic", re: /\b(sql|select|joins?|where|group by|having|window|ctes?|subquer\w*|quer(y|ies)|postgres\w*|indexes|aggregat\w*|null handling|order by|distinct|exists|lag|lead|ntile|row_number|rank\w*|deduplication|ddl|constraints|relational model|northwind|date and time functions|anti-joins?)\b/i },
  { kind: "python", label: "Python language topic", re: /\b(python|loops?|lists?|dict(ionar(y|ies))?|tuples?|sets?|functions?|recursion|recursive|generators?|iterators?|exceptions?|class(es)?|strings?|variables?|comprehensions?|lambda|decorators?|scope|conditionals?|statements?|booleans?|operators?|numbers?|inheritance|object-oriented|dates and times|datetime|file handling|modules?|venv|regular expressions?|pytest|testing)\b/i },
];

/** Why a lesson got its aid. `generic` is set when the aid only partly fits, and says what it does not cover. */
export interface VisualChoice { template: VisualTemplate; why: string; source: "override" | "rule" | "language"; generic?: string }

interface Override { kind: VisualKind; why: string; generic?: string }
const o = (kind: VisualKind, why: string, generic?: string): Override => ({ kind, why, generic });

/**
 * Lessons that the rules cannot decide, by lesson id. Only cases where the rule result is wrong, ambiguous or missing.
 * `generic` records an honest limit: the aid shows a neighbouring idea, not the lesson's own.
 */
export const LESSON_OVERRIDES: Record<string, Override> = {
  // Common core: Python, SQL and NumPy/pandas lessons the rules misread
  d009: o("python", "Tuples and sets are Python collections; the tracer shows unpacking, membership and set operations."),
  d047: o("sql", "UNION, INTERSECT and EXCEPT are SQL set operators; Query Cinema draws the two inputs and the combined result."),
  d054: o("sql", "Recursive CTEs are SQL; the query runs in Query Cinema.", "The aid does not unroll the recursion one iteration at a time; it shows the query's logical stages."),
  d056: o("sql", "The lesson teaches the SQL for cohorts, retention and funnels, so the learner's own query is what runs.", "The Business Analytics Lab draws the same cohort and funnel ideas, but the lesson's work is the query."),
  d060: o("sql", "Transactions and views are SQL; COMMIT is the SQL statement, not a Git commit.", "Query Cinema shows queries, not ACID behaviour or transaction isolation."),
  d067: o("data", "A NumPy sensor-array project: masks, normalisation and summaries are array operations."),
  d072: o("data", "pandas boolean masks, isin, between and query() are DataFrame filters shown before and after."),
  d076: o("data", "These are the pandas .str methods on a column, so the table view fits.", "Regular-expression details inside .str.extract are not explained step by step."),
  d084: o("data", "Dtypes, categoricals and chunked reading change a DataFrame, and the Studio shows dtype changes.", "Memory use in bytes and chunk-by-chunk reading are not visualised."),
  // Excel
  a092: o("excel", "IF, IFS, AND, OR, SUM, ROUND and cell references are formulas that the Excel Lab evaluates step by step."),
  a093: o("excel", "LEFT, MID, TEXT, TEXTJOIN and date formulas are evaluated in the Excel Lab.", "Only a simulated subset of Excel functions is covered."),
  a095: o("excel", "SUMIFS, COUNTIFS and AVERAGEIFS are spreadsheet formulas the lab evaluates.", "Dynamic arrays and named criteria are not covered."),
  a097: o("chart", "Choosing and formatting chart types is what the Data Visualization Explorer teaches.", "Excel's own chart dialogs, combo charts and slicers are not simulated."),
  a098: o("excel", "Importing and cleaning data is the Excel Lab's cleaning view.", "Power Query's Applied Steps pane and the M language are not simulated."),
  a099: o("data", "Merge and append queries are joins and concatenation; the Pandas Studio shows both before and after.", "Power Query's merge dialog and M code are not simulated; pandas is the nearest equivalent."),
  a100: o("excel", "A monthly sales workbook with lookups and PivotTables is the Excel Lab's own scenario.", "Charts and the delivered report are not part of the lab."),
  // Statistics and EDA
  a104: o("stats", "A chi-square test is a hypothesis test on counts; the lab shows observed and expected counts and the test of independence."),
  a105: o("stats", "A/B testing is sampling variation plus a hypothesis test.", "Experiment design and sample-size planning are not covered."),
  a106: o("data", "EDA starts with profiling a table, which the Pandas Studio shows.", "The lesson is a process (questions, assumptions, checklist); no aid can show that."),
  a107: o("stats", "Distributions and spread are the Statistics Lab's core.", "Boxplot and summary-table construction are covered only as spread."),
  a108: o("stats", "Numeric-vs-numeric analysis is correlation and regression.", "Categorical-vs-numeric comparisons and cross-tabs are not covered."),
  a109: o("stats", "Outliers by IQR and z-score are spread statistics.", "Missing-data patterns and treatment choices are not covered; the Pandas Studio shows missing values."),
  a110: o("chart", "Trends, seasonality and growth are read from line and time-series charts.", "Rolling windows and derived metrics are not computed by the explorer."),
  a112: o("business", "Turning findings into evidence, a structure and caveats is communication practice with the sample business.", "No aid renders an EDA report."),
  a113: o("data", "An EDA project profiles, filters, groups and plots a dataset; the Pandas Studio shows each table step.", "The project is open-ended; the written findings are not covered."),
  a118: o("chart", "Heatmaps, pair plots and facets are chart forms.", "The explorer has a heatmap but no pair plot or FacetGrid."),
  a122: o("chart", "Colour, titles and honest axes are chart-design choices.", "Colour-blindness checks and annotations are not editable in the explorer."),
  // Power BI: no Power BI aid exists, each lesson gets the nearest honest neighbour
  a124: o("chart", "A first look at a report: connecting data and seeing visuals.", "Power BI Desktop and its connectors are not simulated."),
  a125: o("data", "Power Query transformations change a table step by step, as the Pandas Studio shows.", "Query folding, parameters and dependencies are not simulated."),
  a126: o("sql", "A star schema is joins from a fact table to dimensions, which Query Cinema runs.", "Model diagrams and relationships are not drawn."),
  a127: o("sql", "Relationships and cardinality behave like joins; Query Cinema shows join match counts.", "Filter direction and inactive relationships are Power BI specific and not shown."),
  a128: o("sql", "A date table is a generated calendar joined to facts; SQL date functions show the idea.", "Marking a date table and fiscal calendars are not covered."),
  a129: o("sql", "A DAX measure is an aggregation over a filtered table, like GROUP BY.", "DAX itself is not run."),
  a130: o("sql", "Filter context is like a WHERE clause that changes the rows an aggregate sees.", "CALCULATE, ALL and context transition are not run."),
  a131: o("sql", "Previous-period and year-to-date comparisons are window functions such as LAG.", "DAX time-intelligence functions are not run."),
  a132: o("sql", "Variables, iterators and ranking map to CTEs and RANK() in SQL.", "DAX is not run."),
  a133: o("chart", "Visual types and what each is good for.", "Slicers, drill-through, bookmarks and tooltips are Power BI behaviour and not simulated."),
  a134: o("business", "Dashboard layout and hierarchy are shown on the Business Analytics Lab's KPI dashboard.", "Themes and mobile layout are not covered."),
  a135: o("etl", "A scheduled refresh is a pipeline run that can fail; the ETL playback shows runs and retries.", "Power BI Service, row-level security and sharing are not simulated."),
  a136: o("sql", "Slow models and slow queries share a cause: scanning more than needed; the plan view shows cost.", "Performance Analyzer and DAX timing are not covered."),
  a137: o("business", "A sales dashboard project: KPIs, variance and a recommendation on the sample business.", "The Power BI model and published report are not covered."),
  a139: o("business", "Purpose, layout and noise reduction are shown on the KPI dashboard.", "Only one fixed sample business is shown."),
  // Business analytics and analyst data prep
  a150: o("business", "Stock turnover, stock-outs and service levels are operations KPIs on the sample business.", "The sample business may not include inventory data; check the presets."),
  a152: o("business", "Forecast error and communicating uncertainty are business decisions on a fixed sample.", "Moving-average and seasonal forecast building are not covered."),
  a157: o("sql", "Parameterised queries still run as SQL, and Query Cinema shows what the query returns.", "The Python connection, parameter binding and injection are not shown."),
  a158: o("sql", "The choice is where to filter and aggregate; Query Cinema's compare tool shows what the database does.", "The pandas side of the comparison is not run in the same tool."),
  a159: o("data", "The pandas half of the workflow is shown before and after each step.", "The SQL half is not traced in the Studio."),
  a160: o("data", "Reading Excel, cleaning headers and fixing types are DataFrame steps shown before and after.", "Writing to PostgreSQL is not part of the Studio."),
  a161: o("etl", "Loading with constraints and idempotent re-runs is what the ETL playback shows."),
  a164: o("api", "Parsing a JSON response is what the API Studio shows.", "Flattening nested JSON into a DataFrame and reporting are not shown."),
  a165: o("etl", "Scheduled, parameterised report runs are pipeline runs.", "Excel and CSV export are not shown."),
  a166: o("data", "SQL plus pandas mini-project: the Pandas Studio shows the transformation steps.", "Loading, validation and reporting are not covered."),
  // Capstones: each step goes to the aid that matches its work
  a172: o("business", "Scoping a question, success criteria and a plan matches the Business Analytics Lab's metric and decision framing.", "The lab uses a fixed sample business, not the learner's chosen dataset."),
  a173: o("etl", "Ingestion is the extract step of a pipeline.", "Reproducibility and the Git repository are not covered here."),
  a175: o("etl", "Loading a modelled dataset into PostgreSQL is a load step.", "Data-model design and documentation are not covered."),
  a177: o("chart", "Charts for the capstone are built with the Data Visualization Explorer's rules.", "Power BI dashboards and interactivity are not covered."),
  a178: o("business", "Insights, a recommendation and caveats are business communication on the sample business.", "The learner's own narrative is not assessed by the aid."),
  a179: o("git", "Publishing the capstone to GitHub is a Git workflow: commits, a branch and a push.", "README writing, tests and reproducibility checks are not covered."),
  a180: o("interview", "Presenting and answering follow-up questions matches the Interview Walkthrough's example answers and follow-ups.", "The aid walks through questions, not a project presentation."),
  // Engineer path: ingestion
  e091: o("etl", "Connecting and loading is the load step of a pipeline.", "Connection handling, drivers and credentials are not simulated."),
  e092: o("sql", "Target-schema design is DDL; Query Cinema runs SQL against sample tables.", "It shows queries, not CREATE TABLE design."),
  e094: o("etl", "Idempotent loads and batching are what the ETL playback shows (upsert versus append, re-runs)."),
  e095: o("etl", "Validating a load by counts and checksums is the playback's validate step."),
  e097: o("data", "Messy Excel read with pandas: merged cells, header rows and type repair are DataFrame steps.", "Merged cells and multiple header rows come from the workbook, not from a table the Studio builds."),
  e098: o("data", "Splitting a workbook into normalised tables is DataFrame selection and merge.", "Keys and relationships between the output tables are not drawn."),
  // Engineer path: APIs, SQL and Python
  e109: o("data", "Flattening, types, deduplication and validation are pandas steps shown before and after."),
  e110: o("etl", "Upserts, staging and transactions are load steps; the playback shows upsert versus append."),
  e112: o("sql", "Aggregations, windows and views over loaded data are SQL; the query runs in Query Cinema."),
  e113: o("chart", "Charts and a written explanation of insights: the Data Visualization Explorer.", "The API-to-database pipeline itself is not part of the explorer."),
  e114: o("sql", "Placeholders still run as SQL in Query Cinema.", "read_sql, typed results and injection are not shown."),
  e115: o("sql", "Pushing work to the database is a SQL question; Query Cinema's compare tool shows its cost.", "The pandas alternative and memory use are not shown side by side."),
  e116: o("data", "The pandas half of the workflow is shown before and after each step.", "The SQL half and the reusable functions are not traced."),
  e117: o("sql", "Window functions and aggregates run in Query Cinema.", "Handling the results from Python is not shown."),
  e118: o("chart", "Monitoring charts follow the same chart rules the explorer teaches.", "Matplotlib code and saving figures are not run."),
  e119: o("data", "Query, transform, chart and report: the transform is shown in the Pandas Studio.", "The query, chart and report steps are not covered."),
  // Engineer path: ETL and data quality
  e122: o("python", "Config, environment variables and secrets are Python values the tracer can show.", "Secrets handling and per-environment config are not demonstrated."),
  e124: o("etl", "Full refresh and safe re-runs are the playback's idempotency scenarios."),
  e126: o("etl", "Upserts versus appends are a playback scenario.", "INSERT ... ON CONFLICT syntax is not run."),
  e129: o("etl", "Retries, structured logs and quarantined records are playback features."),
  e138: o("python", "pytest tests are Python code; the tracer shows an assert pass or fail line by line.", "Fixtures and integration tests are not shown."),
  e139: o("etl", "Quality metrics, thresholds and alerts follow the validate step's rejects and counts.", "Dashboards and notifications are not simulated."),
  // Engineer path: warehousing
  e142: o("sql", "OLTP versus OLAP is a workload contrast; Query Cinema shows a scan and an aggregate.", "Row versus column storage is not shown."),
  e143: o("sql", "Normalisation is splitting tables and joining them back, which Query Cinema runs.", "Normal forms and entity diagrams are not drawn."),
  e144: o("sql", "Facts, dimensions and grain are seen in star-join queries.", "Dimensional design is not drawn."),
  e145: o("sql", "A star schema is a fact table joined to dimensions.", "Surrogate keys and conformed dimensions are not drawn."),
  // Engineer path: Linux, orchestration, Spark
  e155: o("linux", "Docker is driven from a terminal; the lab practises the shell skills around it.", "Docker, images, volumes and Compose are not simulated."),
  e156: o("linux", "Project layout and entry points are files and folders in a terminal.", "Packaging and dependency tools are not simulated."),
  e157: o("graph", "A DAG is a directed graph, and the scheduler runs tasks in a topological order.", "Airflow's scheduler and metadata database are not simulated."),
  e158: o("etl", "Schedules and catch-up runs are pipeline runs over time.", "Operators and start_date semantics are not simulated."),
  e159: o("graph", "Task dependencies decide which task can run next, which is topological order.", "XCom data passing and task groups are not shown."),
  e160: o("etl", "Retries, backfills and idempotent tasks are playback scenarios.", "SLAs are not simulated."),
  e161: o("etl", "Failure handling, logs and alerts follow a pipeline run.", "Sensors and callbacks are not simulated."),
  e163: o("data", "DataFrame transformations are shown before and after, as in Spark.", "Lazy evaluation, the plan and the cluster are not shown."),
  e164: o("data", "select, filter, withColumn and aggregation change a table step by step.", "Spark syntax is not run; pandas is the stand-in."),
  e165: o("sql", "Spark SQL is SQL on views; the query runs in Query Cinema.", "Query Cinema runs against a PostgreSQL-style sample database, not Spark."),
  e166: o("sql", "Joins and aggregation run in Query Cinema, with join match counts.", "Partitions, shuffles and skew are not shown."),
  e167: o("etl", "Reading and writing files is extract and load.", "Parquet, partitioned writes and schemas are not simulated."),
  e173: o("etl", "Scoping sources, requirements and an architecture matches the pipeline stages.", "The learner's own sources are not loaded."),
  e178: o("etl", "Orchestration and monitoring map to task dependencies and run metrics.", "Airflow DAG code and pytest are not run here."),
  e179: o("git", "Repository hygiene and publishing to GitHub are Git workflow steps.", "README and architecture-diagram writing are not covered."),
  e180: o("interview", "Presenting a demo and trade-offs matches the Interview Walkthrough's example answers and follow-ups.", "The aid walks through questions, not a project demo."),
};

/** Starting example inside the preset-aware aids, by lesson id. Ids must exist in the aid's PRESETS export (tested). */
export const LESSON_PRESETS: Record<string, string> = {
  // Statistics Lab
  d086: "descriptive", d087: "variance", d088: "normal", d089: "clt", d090: "t-test",
  a101: "correlation", a102: "regression", a103: "t-test", a104: "chi-square", a105: "welch", a107: "skewed", a108: "correlation", a109: "outliers",
  // Excel Lab
  a091: "conditional-format", a092: "formulas", a093: "text-formulas", a094: "lookups", a095: "sumifs", a096: "pivot", a098: "cleaning", a100: "pivot",
  // Graph Explorer: a DAG of tasks is ordered by topological sort
  e157: "dag", e159: "dag",
  // Git Lab
  d030: "branching", e140: "branching", a179: "first-commit", e179: "first-commit",
  // Business Analytics Lab
  a111: "cohort", a134: "kpi", a137: "kpi", a138: "kpi", a139: "kpi", a140: "kpi", a141: "kpi", a142: "kpi", a143: "metric-tree", a144: "price-volume-mix",
  a145: "rfm", a146: "churn", a147: "funnel", a148: "campaign-roi", a149: "pricing", a150: "kpi", a151: "variance", a152: "forecast", a153: "variance",
  a154: "rfm", a155: "campaign-roi", a156: "kpi", a172: "metric-tree", a178: "variance",
  // PRESETS_PLACEHOLDER
};

export interface LessonVisualInput { id?: string; title: string; topics: string[]; lang?: "python" | "sql" | "bash" }

/** The full decision for a lesson, with its rationale. Undefined only when nothing fits (cannot happen for the 270 shipped lessons). */
export function explainVisual(input: LessonVisualInput): VisualChoice | undefined {
  const pick = (kind: VisualKind, why: string, source: VisualChoice["source"], generic?: string): VisualChoice => {
    const preset = input.id && PRESET_KINDS.includes(kind) ? LESSON_PRESETS[input.id] : undefined;
    return { template: preset ? { ...TEMPLATES[kind], preset } : TEMPLATES[kind], why, source, generic };
  };
  const ov = input.id ? LESSON_OVERRIDES[input.id] : undefined;
  if (ov) return pick(ov.kind, ov.why, "override", ov.generic);
  const text = `${input.title} ${input.topics.join(" ")}`;
  for (const r of RULES) if (r.re.test(text)) return pick(r.kind, `Rule: ${r.label}.`, "rule");
  if (input.lang === "sql") return pick("sql", "Fallback: the lesson's runnable examples are SQL.", "language");
  if (input.lang === "python") return pick("python", "Fallback: the lesson's runnable examples are Python.", "language");
  return undefined;
}

/**
 * Pick the aid for a lesson. Pass `id` so the per-lesson table applies; without it only the title/topic rules run (and the
 * result is the shared template object, with no preset). `lang` is the fence language of the first runnable block.
 */
export function visualFor(input: LessonVisualInput): VisualTemplate | undefined {
  return explainVisual(input)?.template;
}

/** Python/pandas example code of a lesson can be traced in place; SQL uses the query visualizer. */
export const isTraceable = (k: VisualKind | undefined) => k === "python" || k === "data";
