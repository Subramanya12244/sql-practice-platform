/**
 * Which real exercise the unified workspace can open for a Learn hub topic, a Projects Lab task or a business scenario.
 *
 * Every link is an id the workspace sources understand (`sql:<slug>`, `py:<slug>`, `daily:<day>#<exercise>`). Nothing is invented:
 *
 *   Learn hub topics   derived. SQL questions the note links, Python problems whose `topic` is the note, and Daily Learning exercises
 *                      of the lessons whose own `links.notes` name the topic (a generated table, `workspaceLinksData.ts`, checked
 *                      against the lesson files by a test). An analytics module (a Daily phase) uses its phase's lessons.
 *   Projects Lab       an explicit, reviewed table below. A task is linked only when the exercise practises the same concept the
 *                      task needs (never a keyword match). Checklist and decision tasks have no exercise by design.
 *   Scenarios          the same kind of reviewed table.
 *
 * Progress is read from the existing stores only (lib/progress.ts, lib/pyPractice.ts, lib/dailyProgress.ts) and never written here.
 * Pure functions, no React: the build step and the tests call them directly.
 */
import { exerciseWorkspaceDomain, WORKSPACE_EXERCISES, type WorkspaceDomain } from "./visual/dailyVisual";
import type { DayMeta } from "./daily";
import { isDone, type DailyState } from "./dailyProgress";
import type { Progress } from "./progress";
import type { PyStat } from "./pyPractice";

export type PracticeDifficulty = "Easy" | "Medium" | "Hard";
export type PracticeState = "solved" | "attempted" | "new";

/** One exercise shown in a "Practise in the workspace" block. */
export interface PracticeItem {
  /** `sql:<slug>`, `py:<slug>` or `daily:<day>#<exercise>`. */
  id: string;
  title: string;
  difficulty: PracticeDifficulty;
  domain: WorkspaceDomain;
}

export const DOMAIN_LABEL: Record<WorkspaceDomain, string> = { sql: "SQL", python: "Python", pandas: "Pandas", numpy: "NumPy" };

// ── ids ──────────────────────────────────────────────────────────────────
export const sqlId = (slug: string) => `sql:${slug}`;
export const pyId = (slug: string) => `py:${slug}`;
export const dailyId = (dayId: string, exerciseId: string) => `daily:${dayId}#${exerciseId}`;

/** The question number a slug carries ("q147-latest-order-per-customer" is question 147). A test checks it against the real index. */
export function sqlNumberOfId(id: string): number | null {
  const m = /^sql:q(\d+)-/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * Workspace domain of any exercise id, without loading it. SQL ids are `sql`, Python library ids are `python` (the same domain the
 * converter gives them), Daily ids come from the generated lesson table. Null for an id that is malformed or not graded in the workspace.
 */
export function domainOfId(id: string): WorkspaceDomain | null {
  if (/^sql:[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) return "sql";
  if (/^py:[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) return "python";
  const m = /^daily:([A-Za-z0-9]+)#([gi]\d+)$/.exec(id);
  return m ? exerciseWorkspaceDomain(m[1], m[2]) ?? null : null;
}

/** SQL questions rate three questions "Advanced" or "Expert". The workspace shows Easy, Medium or Hard. */
export function practiceDifficulty(d: string): PracticeDifficulty {
  return d === "Easy" ? "Easy" : d === "Medium" ? "Medium" : "Hard";
}
const RANK: Record<PracticeDifficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };

// ── choosing a few exercises for a topic ─────────────────────────────────
/** `k` items from a list sorted easiest first, evenly spaced from the first to the last (a ramp, not the five easiest). */
export function spread<T>(items: T[], k: number): T[] {
  if (k <= 0 || items.length === 0) return [];
  if (items.length <= k) return [...items];
  if (k === 1) return [items[0]];
  const out: T[] = [];
  for (let i = 0; i < k; i++) out.push(items[Math.round((i * (items.length - 1)) / (k - 1))]);
  return out;
}

/**
 * Up to `max` exercises (default 5) from SQL, Python and Daily candidates. The slots go round the kinds that have candidates, and a kind
 * fills its slots with a spread from its easiest to its hardest item. The result is ordered by difficulty (a stable sort that keeps
 * the order SQL, Python, Daily within a level). Same input, same output.
 */
export function pickPractice(sql: PracticeItem[], python: PracticeItem[], daily: PracticeItem[], max = 5): PracticeItem[] {
  const sort = (xs: PracticeItem[]) => xs.map((x, i) => ({ x, i })).sort((a, b) => RANK[a.x.difficulty] - RANK[b.x.difficulty] || a.i - b.i).map((r) => r.x);
  const pools = [sort(sql), sort(python), sort(daily)];
  const quota = pools.map(() => 0);
  let left = max;
  for (let turn = 0; left > 0 && pools.some((p, i) => quota[i] < p.length); turn++) {
    const i = turn % pools.length;
    if (quota[i] < pools[i].length) { quota[i]++; left--; }
  }
  const seen = new Set<string>();
  const chosen = pools.flatMap((p, i) => spread(p, quota[i])).filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  return chosen.map((x, i) => ({ x, i, k: pools.findIndex((p) => p.includes(x)) })).sort((a, b) => RANK[a.x.difficulty] - RANK[b.x.difficulty] || a.k - b.k || a.i - b.i).map((r) => r.x);
}

// ── Daily Learning candidates for a topic (the generated table is built with this) ───────────────
export interface DailyLesson {
  id: string;
  /** Note slugs the lesson's own `links.notes` names. */
  notes: string[];
  phase: string;
  /** Graded exercises of the lesson in order: guided first, then independent. Written ones are not here. */
  exercises: { id: string; title: string; section: "guided" | "independent" }[];
}

/**
 * Daily exercises for one topic. `lessons` must be in curriculum order. A note topic takes the lessons that name it in `links.notes`;
 * an analytics module (`phase` given) takes the lessons of that phase. From those lessons: the first graded guided exercise of each,
 * spread to at most 2, then the first graded independent exercise of each, spread to at most 2. Only exercises the workspace can open.
 */
export function dailyCandidates(lessons: DailyLesson[], pick: { note?: string; phase?: string }): { id: string; title: string; section: "guided" | "independent" }[] {
  const mine = lessons.filter((l) => (pick.phase ? l.phase === pick.phase : pick.note ? l.notes.includes(pick.note) : false));
  const first = (l: DailyLesson, section: "guided" | "independent") => l.exercises.filter((e) => e.section === section).map((e) => ({ ...e, id: dailyId(l.id, e.id) })).find((e) => domainOfId(e.id) !== null);
  const guided = mine.map((l) => first(l, "guided")).filter((e): e is NonNullable<typeof e> => !!e);
  const independent = mine.map((l) => first(l, "independent")).filter((e): e is NonNullable<typeof e> => !!e);
  return [...spread(guided, 2), ...spread(independent, 2)];
}

// ── Daily path helper ────────────────────────────────────────────────────
/** Exercise ids of a lesson the workspace can open, in lesson order (guided then independent). Written exercises are skipped. */
export function lessonWorkspaceIds(dayId: string): string[] {
  const row = WORKSPACE_EXERCISES[dayId];
  if (!row) return [];
  const [guided, independent = ""] = row.split("|");
  const out: string[] = [];
  for (let i = 1; i <= guided.length; i++) out.push(dailyId(dayId, `g${i}`));
  for (let i = 1; i <= independent.length; i++) out.push(dailyId(dayId, `i${i}`));
  return out.filter((id) => domainOfId(id) !== null);
}

export interface NextPracticeStep { id: string; domain: WorkspaceDomain; day: number; dayId: string; lessonTitle: string; label: string }

/**
 * The first exercise of the first lesson not yet completed that the learner has not passed. Lessons already completed are skipped (their
 * required exercises are passed by definition of completion). Null when every lesson is completed or none has a workspace exercise.
 */
export function nextWorkspaceStep(days: DayMeta[], daily: DailyState): NextPracticeStep | null {
  for (const d of days) {
    if (isDone(daily, d.id)) continue;
    const passed = new Set(daily.days[d.id]?.passed ?? []);
    for (const id of lessonWorkspaceIds(d.id)) {
      const ex = id.slice(id.indexOf("#") + 1);
      if (passed.has(ex)) continue;
      const domain = domainOfId(id)!;
      const n = Number(ex.slice(1));
      return { id, domain, day: d.day, dayId: d.id, lessonTitle: d.title, label: `${ex[0] === "g" ? "guided" : "independent"} exercise ${n}` };
    }
  }
  return null;
}

// ── status from the existing stores ──────────────────────────────────────
/** What a learner has done with an exercise, from the stores the other pages write. Read only; "new" when there is no record. */
export function practiceState(id: string, p: Pick<Progress, "questions" | "lessons" | "daily">, stats: Record<string, PyStat>): PracticeState {
  if (id.startsWith("sql:")) {
    const n = sqlNumberOfId(id);
    const q = n === null ? undefined : p.questions[n];
    return q?.solvedAt ? "solved" : q && q.attempts > 0 ? "attempted" : "new";
  }
  if (id.startsWith("py:")) {
    const slug = id.slice(3);
    return p.lessons?.[id] ? "solved" : (stats[slug]?.attempts ?? 0) > 0 ? "attempted" : "new";
  }
  const m = /^daily:([A-Za-z0-9]+)#(.+)$/.exec(id);
  if (!m) return "new";
  const rec = p.daily?.days[m[1]];
  return rec?.passed?.includes(m[2]) ? "solved" : rec?.attempted?.includes(m[2]) ? "attempted" : "new";
}

export const STATE_LABEL: Record<PracticeState, string> = { solved: "Solved", attempted: "Attempted, not solved yet", new: "Not started" };

// ── Projects Lab: reviewed task to exercise table ────────────────────────
export interface LinkedExercise {
  id: string;
  /** The exercise's own title (a test checks it against the loaded exercise). */
  title: string;
  /** One line: what the exercise practises that the task needs. */
  why: string;
}
const L = (id: string, title: string, why: string): LinkedExercise => ({ id, title, why });

/**
 * Project task key (`<project slug>/<task id>`) to the real exercises that practise the same concept. Reviewed by hand against each
 * task's instructions and each exercise's statement. Tasks that are not here have no genuine match (the audit in
 * docs/WORKSPACE_INTEGRATION_REPORT.md lists them), and checklist and decision tasks are never linked. Only SQL and Python tasks appear.
 */
export const PROJECT_TASK_EXERCISES: Record<string, LinkedExercise[]> = {
  // Airflow ETL pipeline
  "airflow-etl-pipeline/dag-topology": [
    L("py:topological-sort", "Topological Sort With Cycle Detection", "Same algorithm: order tasks after their upstreams and reject a cycle."),
    L("py:cycle-detect-directed", "Find A Cycle In A Directed Graph", "The cycle check the task needs."),
  ],
  "airflow-etl-pipeline/data-intervals": [L("py:backfill-partition-planner", "Plan Backfill Chunks From Partition Status", "Daily partitions and backfill ranges.")],
  "airflow-etl-pipeline/retry-delays": [
    L("daily:e107#g2", "The backoff ceiling", "Exponential delays capped at a maximum, the cap this task applies."),
    L("py:retry-with-backoff", "Retry with Exponential Backoff", "Growing waits between retries."),
  ],
  // CSV to PostgreSQL ETL
  "csv-to-postgres-etl/parse-csv": [L("py:parse-csv-string", "Parse a CSV String", "Parse CSV text into typed records with empty cells handled.")],
  "csv-to-postgres-etl/parameterised-insert": [L("py:batch-records-for-load", "Batch Records for Load", "Covers the batching half of the task (splitting rows into chunks).")],
  "csv-to-postgres-etl/dedupe-orders": [
    L("daily:d055#g2", "Latest subscription per email", "Keep one row per key with ROW_NUMBER, the technique for removing duplicates."),
    L("sql:q147-latest-order-per-customer", "Latest Order Per Customer", "One row per group chosen by an ordering."),
  ],
  "csv-to-postgres-etl/idempotent-load": [
    L("daily:e094#g3", "Upsert in PostgreSQL", "INSERT ... ON CONFLICT, the construct that makes a load safe to re-run."),
    L("sql:q188-upsert-customers-with-on-conflict", "Upsert Customers With On Conflict", "ON CONFLICT on a primary key."),
  ],
  // Data validation pipeline
  "data-validation-pipeline/dq-results": [L("daily:e135#g3", "One violation report", "One query that reports the failed-row count per rule.")],
  "data-validation-pipeline/quarantine": [L("daily:e092#i1", "Reject reasons from staging", "Split staged rows with the reason each one is rejected.")],
  "data-validation-pipeline/stock-recon": [
    L("daily:e137#g3", "Per-group differences in PostgreSQL", "Compare two totals per group with missing groups as 0."),
    L("sql:q27-products-and-total-quantity-sold", "Products and Total Quantity Sold", "LEFT JOIN plus SUM with COALESCE for entries that have no rows."),
  ],
  "data-validation-pipeline/rule-engine": [L("py:config-driven-record-validator", "Config Driven Record Validator", "Rules described as data and applied to every record.")],
  "data-validation-pipeline/schema-validator": [L("py:validate-schema-dict", "Validate Records Against A Schema Spec", "Same job: check records against a schema and list the errors.")],
  // dbt analytics project
  "dbt-analytics-project/compiled-tests": [
    L("daily:e135#g1", "Duplicate keys", "The unique test as a query."),
    L("daily:e135#g2", "Orphan rows", "The relationships test as a query."),
  ],
  "dbt-analytics-project/ref-graph": [L("py:topological-sort", "Topological Sort With Cycle Detection", "Covers the build-order half (dependencies first).")],
  // End-to-end pipeline
  "end-to-end-pipeline/validate-extract": [
    L("daily:d085#i3", "Stretch: rejects with a reason", "Reject invalid rows into a table with a reason (pandas)."),
    L("daily:d085#i2", "Validate and summarise", "Clean, validate and summarise a raw file (pandas)."),
  ],
  "end-to-end-pipeline/gold-mart": [L("sql:q179-employee-shipping-status-counts", "Employee Shipping Status Counts", "Conditional aggregation (SUM CASE, COUNT FILTER), the way credits and debits are split.")],
  "end-to-end-pipeline/reconciliation": [
    L("daily:e136#g3", "Classify keys in PostgreSQL", "Source versus target comparison with a full outer join."),
    L("daily:e137#g3", "Per-group differences in PostgreSQL", "Control totals compared per group."),
  ],
  "end-to-end-pipeline/run-log": [
    L("py:dag-runner-upstream-failed", "DAG Runner With Upstream Failure Propagation", "Run steps in order and skip what depends on a failure."),
    L("py:etl-run-logger", "Log ETL Step Metrics With The logging Module", "One log record per pipeline step."),
    L("py:retry-with-backoff", "Retry with Exponential Backoff", "Retrying a failing step."),
  ],
  // HR analytics warehouse
  "hr-analytics-warehouse/mart-headcount": [
    L("sql:q35-categories-and-number-of-products", "Categories and Number of Products", "LEFT JOIN with a count so groups with no rows still appear."),
    L("sql:q179-employee-shipping-status-counts", "Employee Shipping Status Counts", "COUNT FILTER, the active and terminated counts."),
  ],
  // Incremental loading
  "incremental-loading/incremental-run": [L("daily:e125#g4", "Filter above the watermark in SQL", "Select only rows past the stored watermark.")],
  "incremental-loading/upsert-corrections": [
    L("daily:e126#g4", "Upsert in PostgreSQL syntax", "ON CONFLICT DO UPDATE with EXCLUDED."),
    L("sql:q188-upsert-customers-with-on-conflict", "Upsert Customers With On Conflict", "The same construct on a practice database."),
  ],
  "incremental-loading/idempotency": [L("daily:e094#g3", "Upsert in PostgreSQL", "A load that can run twice without changing the result.")],
  "incremental-loading/lookback-window": [
    L("py:incremental-load-watermark", "Incremental Load with a Watermark", "Watermark based extract and merge."),
    L("py:checkpointed-incremental-load", "Resume A Load From A Checkpoint File", "Re-running a load without reloading committed rows."),
  ],
  // PySpark transformation
  "pyspark-transformation/groupby-agg": [
    L("py:pandas-groupby-agg", "Revenue Summary with pandas groupby", "groupby with several aggregates, the pandas form of groupBy().agg()."),
    L("daily:d079#g4", "Named summary", "Named aggregation per group."),
  ],
  "pyspark-transformation/window-functions": [L("daily:d080#i2", "Top two products per region", "Rank within a group and filter on the rank, the pandas form of a window.")],
  "pyspark-transformation/spark-sql-ltv": [
    L("daily:d050#g2", "RANK or DENSE_RANK", "DENSE_RANK, the function the task uses for country_rank."),
    L("daily:d050#i3", "Top two customers by revenue in each country (stretch)", "Rank customers by revenue within a country."),
  ],
  // Python data cleaning
  "python-data-cleaning/clean-columns": [
    L("py:pandas-clean-dataframe", "Clean a DataFrame with pandas", "Strip names, convert text amounts and dates, drop duplicates."),
    L("daily:d076#i1", "Clean a customer table", "String methods on a pandas column."),
  ],
  "python-data-cleaning/dedupe-people": [
    L("daily:d085#g4", "Keep the corrected row", "Keep the last row per id."),
    L("daily:d075#i1", "Latest record per customer", "Keep the most recent row per customer."),
  ],
  "python-data-cleaning/null-report": [L("daily:d074#g1", "Count the gaps", "Missing values per column with isna.")],
  "python-data-cleaning/sql-employees-clean": [
    L("sql:q173-normalize-postal-codes-with-replace", "Normalize Postal Codes With Replace", "REPLACE and a regular expression to strip characters."),
    L("sql:q169-employee-full-name-and-initials", "Employee Full Name And Initials", "Joining and changing the case of name parts."),
  ],
  "python-data-cleaning/sql-dq-summary": [
    L("daily:e135#g3", "One violation report", "Counting NULL rows into a small report table."),
    L("sql:q179-employee-shipping-status-counts", "Employee Shipping Status Counts", "COUNT FILTER for NULL counts."),
  ],
  // REST API to PostgreSQL
  "rest-api-to-postgres/paginate": [
    L("daily:e106#g1", "The page loop", "Read every page until there are none left."),
    L("py:collect-paginated-results", "Collect Paginated Results", "Follow a next token to the end."),
  ],
  "rest-api-to-postgres/retry-backoff": [
    L("py:retry-with-backoff", "Retry with Exponential Backoff", "Same function."),
    L("daily:e107#i1", "A complete retry function", "Retryable failures and the waits used."),
  ],
  "rest-api-to-postgres/flatten-json": [
    L("daily:e104#g4", "Flatten with json_normalize", "pd.json_normalize with record_path and meta, exactly the call the task asks for."),
    L("py:flatten-json-records", "Flatten Nested JSON Records", "Flatten nested dictionaries."),
  ],
  "rest-api-to-postgres/upsert-orders": [
    L("daily:e110#i2", "Upsert on PostgreSQL syntax", "Upsert from a staging table into an API table."),
    L("sql:q188-upsert-customers-with-on-conflict", "Upsert Customers With On Conflict", "ON CONFLICT DO UPDATE."),
  ],
  // Sales analytics pipeline
  "sales-analytics-pipeline/monthly-revenue": [
    L("daily:d039#g1", "Orders per month in 1998", "date_trunc by month with a count."),
    L("sql:q159-orders-per-year-and-month", "Orders Per Year And Month", "Group orders by month."),
  ],
  "sales-analytics-pipeline/top-products-region": [
    L("sql:q149-top-3-products-by-revenue-per-category", "Top 3 Products By Revenue Per Category", "Top 3 per group with DENSE_RANK."),
    L("daily:d050#g4", "Three heaviest freight bills per country", "Top N per group with ROW_NUMBER."),
  ],
  "sales-analytics-pipeline/mom-growth": [
    L("daily:d083#i2", "Growth by store", "Percentage change within each group in pandas."),
    L("daily:d083#g3", "Month-on-month change", "pct_change on a monthly series."),
    L("py:percent-change", "Percentage Change", "The percentage change formula and its zero guard."),
  ],
  // Star schema warehouse
  "star-schema-warehouse/dim-date": [
    L("daily:e112#i1", "A calendar without holes", "generate_series for every day in a range, the base of a date dimension."),
    L("daily:d054#i1", "Every month of 1997 with orders and freight", "Generate a calendar with a recursive CTE."),
  ],
  "star-schema-warehouse/grain-validator": [
    L("daily:d075#g1", "Find the repeats", "Count duplicate keys in pandas."),
    L("daily:e098#g4", "List the orphans", "Keys missing from a dimension."),
    L("py:composite-key-duplicates", "Find Duplicates By Composite Key", "Duplicates over a combination of columns, the grain."),
  ],
};

/** Reviewed scenario to exercise table (the Northwind practice set and Daily lessons, never the scenario's own datasets). */
export const SCENARIO_EXERCISES: Record<string, LinkedExercise[]> = {
  "monthly-revenue-growth": [L("sql:q152-month-over-month-revenue-change", "Month Over Month Revenue Change", "LAG and a percentage change by month.")],
  "org-chart-levels": [L("sql:q197-employee-reporting-chain-with-a-recursive-cte", "Employee Reporting Chain With A Recursive CTE", "A recursive CTE over a manager hierarchy with a depth.")],
  "reporting-chain": [L("sql:q197-employee-reporting-chain-with-a-recursive-cte", "Employee Reporting Chain With A Recursive CTE", "Walking the reports_to hierarchy.")],
  "latest-performance-review": [
    L("sql:q147-latest-order-per-customer", "Latest Order Per Customer", "The most recent row per group with ROW_NUMBER."),
    L("daily:d055#g2", "Latest subscription per email", "Latest row per key with a tie-break."),
  ],
  "duplicate-orders": [L("daily:e135#g1", "Duplicate keys", "Find keys that appear more than once.")],
  "duplicate-payments": [L("daily:e135#g1", "Duplicate keys", "Find keys that appear more than once.")],
  "duplicate-transactions": [
    L("daily:d055#g2", "Latest subscription per email", "Keep one row per key (the scenario keeps the first posting)."),
    L("daily:e135#g1", "Duplicate keys", "Find keys that appear more than once."),
  ],
  "above-department-average": [L("sql:q13-products-sold-above-category-average-quantity", "Products Sold Above Category Average Quantity", "Compare each row with the average of its own group.")],
  "inactive-customers": [L("sql:q167-customers-inactive-in-last-six-months", "Customers Inactive In Last Six Months", "Customers with no order in a recent window.")],
  "orders-without-payment": [L("sql:q28-customers-with-no-orders", "Customers with No Orders", "Anti-join: rows with no partner in another table.")],
  "loans-without-accounts": [L("sql:q28-customers-with-no-orders", "Customers with No Orders", "Anti-join: rows with no partner in another table.")],
  "cohort-retention": [L("sql:q168-first-order-month-cohort-size", "First Order Month Cohort Size", "Cohorts by first-order month.")],
  "overdue-purchase-orders": [L("sql:q163-unshipped-orders-older-than-30-days", "Unshipped Orders Older Than 30 Days", "Date arithmetic against a fixed reference date.")],
  "po-receipt-reconciliation": [
    L("daily:e137#g3", "Per-group differences in PostgreSQL", "Source versus target totals per group."),
    L("daily:e136#g3", "Classify keys in PostgreSQL", "Missing, extra and changed keys with a full outer join."),
  ],
};

export const taskKey = (project: string, task: string) => `${project}/${task}`;
export const exercisesForTask = (project: string, task: string): LinkedExercise[] => PROJECT_TASK_EXERCISES[taskKey(project, task)] ?? [];
export const exercisesForScenario = (slug: string): LinkedExercise[] => SCENARIO_EXERCISES[slug] ?? [];
