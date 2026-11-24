/**
 * The SQL ExecutionAdapter. It wraps what already exists and adds no engine of its own:
 *  - run: the existing PGlite runner (`execute`, every statement rolled back), through a `SqlBackend`.
 *  - validate: the existing grader (`submit`, with `compareResults`, `diagnose` and the hidden test rows).
 *  - visualize: the query visualizer engine (`visualize`, `traceRows`) plus real detail queries (see extras.ts).
 *  - explainFailure: categories from PostgreSQL's error text, the grader's result comparison and the SQL text (see failure.ts).
 */
import type { ExecuteResult, SubmitResult } from "../../../../types";
import type { Capability, ExecutionAdapter, ExerciseDef, FeedbackItem, RunContext, RunOutcome, ValidationOutcome, VisualModel } from "../../types";
import type { OrderKey } from "../../../lib/resultCompare";
import { browserBackend, type SqlBackend } from "./backend";
import { CATEGORY, classifyError, explainSqlFailure, lineOf } from "./failure";
import { buildSqlVisualModel } from "./model";
import { NORTHWIND_TABLES, checkSqlPolicy, derivePolicy, type PolicySpec } from "./policy";
import { READ_ONLY_PREFIX } from "./safety";

export const SQL_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(["run", "submit", "reset", "stages", "stepBack", "plan", "compare"]);

/** Shown to the learner as "Not supported here". Each line is something the engine does not do, not a plan. */
export const SQL_LIMITATIONS: readonly string[] = [
  "Runs on the exercise's practice database in your browser (PostgreSQL via PGlite). Every statement is rolled back, so nothing you run is kept.",
  "Every graded exercise runs under a SQL policy checked by a parser before anything reaches the database. Read-only exercises (the answer is a query) refuse INSERT, UPDATE, DELETE, DDL, SELECT ... INTO, side-effect functions and the like, and the transaction is opened READ ONLY. \"Setup then query\" exercises also allow CREATE and INSERT on tables the same script creates (still rolled back) and get no visualization. SQL the checker cannot read completely is refused.",
  "Only a single SELECT, WITH ... SELECT, or UNION / INTERSECT / EXCEPT statement can be visualized. Other statements get no visualization.",
  "The stages show SQL's logical order, not how PostgreSQL physically ran the query. The Plan tab shows PostgreSQL's chosen plan; its row counts and costs are estimates until you run EXPLAIN ANALYZE.",
  "Boards draw a sample of at most 20 rows per stage; counts are exact. Row identity is the real ctid for plain table rows and a labelled trace identity for derived rows.",
  "Correlated subqueries are evaluated once per outer row, so they have no result set of their own and none is shown. The stages still run the full condition.",
  "Uncorrelated subqueries and CTEs are shown by running each on its own. A recursive CTE shows its final result, not each round.",
  "Window partitions are shown for a single, ungrouped SELECT, for up to three distinct window definitions, 40 rows. Window functions over grouped rows are shown as a stage only.",
  "Group members are shown for plain GROUP BY (first 6 groups, 8 rows each). ROLLUP, CUBE, GROUPING SETS and a GROUP BY on a SELECT alias are not expanded.",
  "Set operations are staged (inputs, matches, removed rows, result). Window, group and CASE detail views are not built per branch.",
  "A query that uses random(), now(), nextval() or similar is explained but its row data is not shown: re-running parts of it would not reproduce your result.",
  "No before and after table views: SQL queries here read data, they do not change it.",
];

const WRITE_ERROR = (reasons: string[]) => reasons.join(" ");

/** Submit results kept next to the validation outcome that was built from them (diff samples, row counts, timings). */
const details = new WeakMap<ValidationOutcome, SubmitResult>();
/** The grader's own result for a validation outcome this adapter returned (row counts, a sample of missing and extra rows). */
export const submitDetail = (v: ValidationOutcome | null | undefined): SubmitResult | undefined => (v ? details.get(v) : undefined);

export const datasetOf = (ex: ExerciseDef): string => (ex.validation.kind === "sql-result" && ex.validation.database) || ex.dataset?.id || "northwind";
export const isGraded = (ex: ExerciseDef) => ex.validation.kind === "sql-result";

export interface SqlAdapterOptions {
  backend?: SqlBackend;
  /**
   * Legacy switch: which exercises must be read-only. Without it the policy of an exercise is `sqlPolicy`, `readOnly: true`
   * (read-only), or, for graded exercises, derived from the reference query (see `policyOf`). `false` for an exercise turns the
   * policy off for it (everything is still rolled back).
   */
  readOnly?: (ex: ExerciseDef) => boolean;
}

export interface SqlAdapter extends ExecutionAdapter {
  readonly backend: SqlBackend;
  /** Fresh copy of the exercise's database on the next run. */
  reset(ctx: RunContext): Promise<void>;
}

const err = (type: string, message: string, durationMs = 0, status: RunOutcome["status"] = "error"): RunOutcome => ({ status, durationMs, error: { type, message } });

/** The policy an exercise runs under, or null when it has none (an ungraded exercise that did not ask for one). */
export async function policyOf(ex: ExerciseDef, legacy?: SqlAdapterOptions["readOnly"]): Promise<PolicySpec | null> {
  const protectedTables = [...new Set([...NORTHWIND_TABLES, ...(ex.dataset?.tables ?? []).map((t) => t.name)])];
  if (legacy) return legacy(ex) ? { level: "read-only", protectedTables } : null;
  const explicit = ex.sqlPolicy ?? ((ex as { readOnly?: boolean }).readOnly === true ? "read-only" : undefined);
  if (ex.validation.kind !== "sql-result") return explicit ? { level: explicit, protectedTables } : null;
  const d = await derivePolicy(ex.validation.expectedSql, protectedTables);
  if (!explicit) return d.spec;
  // An explicit level keeps the grants and the parse fallback of the reference only when it is wide enough to use them.
  return { level: explicit, allow: explicit === "read-only" ? [] : d.spec.allow, lexical: d.spec.lexical, protectedTables };
}

const refusalType = (spec: PolicySpec) => (spec.level === "read-only" ? "READ_ONLY" : "SQL_POLICY");

export function createSqlAdapter(opts: SqlAdapterOptions = {}): SqlAdapter {
  const backend = opts.backend ?? browserBackend;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  function toOutcome(res: ExecuteResult, code: string, shift: number, elapsed: number): RunOutcome {
    const durationMs = res.execution_time_ms ?? Math.round(elapsed);
    if (res.success) return { status: "ok", durationMs, table: { columns: res.columns, rows: res.rows, truncated: res.truncated }, raw: res };
    const position = res.error_position && res.error_position > shift ? res.error_position - shift : null;
    const timedOut = res.error_type === "TIMEOUT";
    return {
      status: timedOut ? "timeout" : "error", durationMs,
      error: { type: res.error_type ?? "SQL_ERROR", message: res.message ?? "The query failed.", line: lineOf(code, position) },
      raw: res,
    };
  }

  const adapter: SqlAdapter = {
    domain: "sql",
    capabilities: SQL_CAPABILITIES,
    limitations: [...SQL_LIMITATIONS],
    backend,

    async run(code, ctx) {
      if (ctx.signal?.aborted) return err("STOPPED", "Stopped.", 0, "stopped");
      if (!code.trim()) return err("EMPTY", "Write a query first.");
      // First boundary: the policy decides before anything reaches the backend. (lib/sqlRunner checks again, see backend.run.)
      const spec = await policyOf(ctx.exercise, opts.readOnly);
      if (spec) {
        const check = await checkSqlPolicy(code, spec);
        if (!check.allowed) return err(refusalType(spec), WRITE_ERROR(check.reasons));
      }
      const readOnly = spec?.level === "read-only";
      const sql = readOnly ? `${READ_ONLY_PREFIX}${code}` : code;
      const started = now();
      let stop: (() => void) | undefined;
      const stopped = new Promise<"stopped">((resolve) => { stop = () => resolve("stopped"); ctx.signal?.addEventListener("abort", stop, { once: true }); });
      try {
        const res = await Promise.race([backend.run(sql, datasetOf(ctx.exercise), spec ? { policy: spec } : undefined), stopped]);
        if (res === "stopped") return err("STOPPED", "Stopped.", Math.round(now() - started), "stopped");
        return toOutcome(res, code, readOnly ? READ_ONLY_PREFIX.length : 0, now() - started);
      } catch (e) {
        // The backend contract is "never throws"; a worker that failed to start still must not crash the workspace.
        return err("ENGINE", e instanceof Error ? e.message : String(e), Math.round(now() - started));
      } finally {
        if (stop) ctx.signal?.removeEventListener("abort", stop);
      }
    },

    async validate(code, outcome, ctx): Promise<ValidationOutcome> {
      const v = ctx.exercise.validation;
      if (v.kind !== "sql-result") {
        // An exercise with no grading: nothing to compare. "passed" only says the query ran.
        const ok = outcome.status === "ok";
        return { passed: ok, tests: [{ name: "The query runs", passed: ok, detail: ok ? undefined : outcome.error?.message }], feedback: ok ? [] : explainSqlFailure(code, outcome.status, outcome.error, null) };
      }
      const runs: ValidationOutcome["tests"][number] = { name: "The query runs", passed: outcome.status === "ok", detail: outcome.error?.message };
      const spec = await policyOf(ctx.exercise, opts.readOnly);
      const refused = spec ? await checkSqlPolicy(code, spec) : null;
      if (spec && refused && !refused.allowed) {
        const readOnly = spec.level === "read-only";
        return {
          passed: false,
          tests: [runs, { name: readOnly ? "Read-only: only a SELECT is allowed" : "Only the statements this exercise allows", passed: false, detail: WRITE_ERROR(refused.reasons) }],
          feedback: [{ category: CATEGORY.safety, message: WRITE_ERROR(refused.reasons), suggestion: readOnly ? "Rewrite it as a SELECT that returns the rows asked for." : "Keep to queries and the tables your own script creates." }],
        };
      }
      if (outcome.status !== "ok") {
        return { passed: false, tests: [runs], feedback: explainSqlFailure(code, outcome.status, outcome.error, null) };
      }
      const orderBy = (v.orderBy ?? null) as OrderKey[] | null;
      const r = await backend.submit(code, v.expectedSql, v.orderMatters ?? false, orderBy, datasetOf(ctx.exercise), spec ? { policy: spec } : undefined);

      const failedToRun = r.message === "Your query has an error." || r.message === "Write a query first.";
      const timedOut = /^Query took longer than/.test(r.message);
      const tests: ValidationOutcome["tests"] = [{ name: "The query runs", passed: !failedToRun && !timedOut, detail: failedToRun ? r.feedback[0] : timedOut ? r.message : undefined }];
      if (!failedToRun && !timedOut) {
        const visibleOk = r.correct || Boolean(r.hidden_failed);
        tests.push({
          name: "Matches the expected result",
          passed: visibleOk,
          detail: visibleOk ? undefined : [r.message, r.your_row_count != null && r.expected_row_count != null ? `${r.your_row_count} row(s), expected ${r.expected_row_count}.` : ""].filter(Boolean).join(" "),
        });
        // The hidden test runs on Northwind only, and only after the visible data matches.
        if (visibleOk && datasetOf(ctx.exercise) === "northwind") tests.push({ name: "Hidden test data", passed: !r.hidden_failed, hidden: true, detail: r.hidden_failed ? r.feedback[0] : undefined });
      }
      let feedback: FeedbackItem[] = [];
      if (!r.correct) {
        feedback = failedToRun ? [classifyError(code, r.feedback[0] ?? r.message, { line: outcome.error?.line })]
          : timedOut ? [classifyError(code, r.message, { status: "timeout", type: "TIMEOUT" })]
          : explainSqlFailure(code, "ok", undefined, r);
      }
      const result: ValidationOutcome = { passed: r.correct, tests, feedback };
      details.set(result, r);
      return result;
    },

    async visualize(code, outcome, ctx): Promise<VisualModel | null> {
      // A query that failed has no stages to show; the failure is explained by `explainFailure`.
      if (outcome.status !== "ok") return null;
      const dataset = datasetOf(ctx.exercise);
      return buildSqlVisualModel(code, (q) => backend.run(q, dataset), dataset);
    },

    explainFailure(code, outcome, validation): FeedbackItem[] {
      if (validation?.feedback?.length) return validation.feedback;
      if (outcome.status !== "ok" || outcome.error) return explainSqlFailure(code, outcome.status, outcome.error ?? { message: "The query did not finish." }, null);
      return [];
    },

    async reset(ctx) { await backend.reset(datasetOf(ctx.exercise)); },
  };
  return adapter;
}

/** The app's adapter: the existing PGlite worker. Tests use `createSqlAdapter({ backend: createDbBackend(pglite) })`. */
export const sqlAdapter: SqlAdapter = createSqlAdapter();
