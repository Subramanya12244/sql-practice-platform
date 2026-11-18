// Unified Exercise Workspace: shared contract (v1: v0 seed from the coordinator + additive changes by Agent 1).
// Owner: Agent 1. Changes must stay additive; a breaking change goes through the coordinator.
// v1 additions are marked "v1". Every v0 name and shape is unchanged.
// Adapters (SQL, Python, Pandas, NumPy) implement `ExecutionAdapter` and only declare capabilities they really have.

export type Domain = "sql" | "python" | "pandas" | "numpy";
export type Difficulty = "Easy" | "Medium" | "Hard";

/** Where an exercise comes from. The id keeps its identity wherever it is shown. */
export type ExerciseSource =
  | { kind: "sql-question"; slug: string; number: number } // frontend/public/data/q/*.json, progress key = number
  | { kind: "python-exercise"; slug: string } // content/python/*.md, progress key = `py:${slug}`
  | { kind: "daily"; dayId: string; exerciseId: string } // content/daily/days/dNNN.md|json, ref `daily:${dayId}#${exerciseId}`
  | { kind: "authored"; id: string }; // defined directly in TypeScript (examples, tests)

/** What an adapter can do. The workspace shows only the controls whose capability is present. */
export type Capability =
  | "run" // execute the learner's code and show output
  | "submit" // grade against validation
  | "reset"
  | "stages" // ordered, real intermediate stages (SQL clauses, DataFrame steps)
  | "trace" // per-line execution trace (Python)
  | "stepBack" // reverse stepping inside a recorded trace or stage list
  | "variables" // variable inspector
  | "callStack"
  | "plan" // database execution plan
  | "compare" // compare two queries
  | "beforeAfter" // before/after data views
  | "shapes"; // array shape and broadcasting view

export type HintLevel = 1 | 2 | 3 | 4 | 5;
/**
 * Progressive help. Levels: 1 concept, 2 approach, 3 partial structure, 4 detailed explanation, 5 full solution.
 * Converters author levels 1 to 4 here. Level 5 is NOT stored as a hint: it is `ExerciseDef.solution`, shown only on request.
 * A level may be missing (an authored exercise with two hints); the workspace skips missing levels. (v1 clarification)
 */
export interface Hint { level: HintLevel; title: string; body: string }

/** Validation is declarative so the same exercise validates identically in every host page. */
export type Validation =
  | { kind: "sql-result"; expectedSql: string; orderMatters?: boolean; database?: string; /** v1: top-level ORDER BY keys of the reference query (lib/resultCompare OrderKey). */ orderBy?: { column: string; desc: boolean }[] | null }
  | { kind: "python-tests"; tests: string; stdin?: string; /** v1: run only after the visible tests pass; never shown to the learner. */ hidden?: string } // asserts appended to learner code, run in Pyodide
  | { kind: "python-stdout"; expected: string; stdin?: string }
  | { kind: "none" }; // reading / exploring exercise, no grading

/**
 * What SQL a graded exercise may run (enforced by the SQL adapter, parsed with pgsql-ast-parser; see docs/WORKSPACE_SQL_SAFETY.md).
 *  read-only   queries only (SELECT, WITH ... SELECT, VALUES, TABLE, EXPLAIN of those)
 *  own-tables  queries plus CREATE [TEMP] TABLE/VIEW/INDEX and INSERT into tables the same script creates
 *  own-data    own-tables plus UPDATE/DELETE on tables the same script creates
 * Never allowed in any graded exercise: DROP/TRUNCATE/ALTER of a table the script did not create, transaction control, COPY, roles.
 */
export type SqlPolicy = "read-only" | "own-tables" | "own-data";

/** One debugging note: a failure pattern, why it happens, and how to fix it. Never contains the full solution. */
export interface DebugNote {
  category: string; // SQL: syntax | join | filter | grouping | aggregation | null | window | performance. Python/Pandas/NumPy: syntax | types | variables | control-flow | functions | runtime | indexing | filtering | grouping | join | missing-data | shape | broadcasting | axis | matmul
  symptom: string; // what the learner sees (an error line or a wrong-looking result)
  cause: string;
  fix: string;
}

/**
 * Optional teaching content layered on an ExerciseDef by id (content/workspace/enrichment/*.json). It never replaces grading data:
 * `validation`, `starterCode` and `solution.code` are not part of it.
 */
export interface ExerciseEnrichment {
  /** Levels 1 to 4 only. 1 concept, 2 syntax or concept to use, 3 approach, 4 structured steps with the key expression left for the learner. Level 5 is always the stored solution, on request. */
  hints?: Hint[];
  debugging?: DebugNote[];
  alternatives?: { title: string; code: string; note?: string }[];
  constraints?: string[];
  realWorld?: string;
  prerequisites?: string[];
  commonMistakes?: string[];
  complexity?: { time?: string; space?: string; note?: string };
  interviewRelevance?: string;
  /** Explanation of the stored solution, when the source has none. */
  explanation?: string;
}

export interface ExerciseDef {
  /** Deprecated alias for `sqlPolicy: "read-only"`. */
  readOnly?: boolean;
  /** SQL exercises only. Absent: the adapter derives it from the reference query (read-only unless that query itself creates tables). */
  sqlPolicy?: SqlPolicy;
  /** Limits on the input or the answer (sizes, allowed libraries, ordering). */
  constraints?: string[];
  /** Why this matters outside the classroom. */
  realWorld?: string;
  /** Failure patterns for this exercise's domain. */
  debugging?: DebugNote[];
  /** Virtual files (name to text) made available to the code, for example a CSV read with pandas. */
  files?: Record<string, string>;
  id: string; // stable, unique, e.g. "sql:q01-product-revenue", "py:cart-line-total", "daily:d031#ex2"
  domain: Domain;
  source: ExerciseSource;
  title: string;
  difficulty: Difficulty;
  topic: string;
  /** v1: human label for `topic` (SQL: "Aggregations" for topic slug "aggregations"). */
  topicLabel?: string;
  /** v1: curriculum category. Python: the PY_CATEGORIES slug, used as the Mistake Notebook topic. */
  category?: string;
  subtopic?: string;
  statement: string; // markdown
  businessContext?: string;
  objectives: string[];
  prerequisites?: string[]; // exercise ids or concept names
  concepts: string[];
  starterCode: string;
  dataset?: { /** v1: dataset id the SQL runner loads (default "northwind"). */ id?: string; label: string; tables?: { name: string; columns: { name: string; type: string }[] }[]; note?: string };
  expectedOutput?: string;
  validation: Validation;
  hints: Hint[]; // progressive; solution is separate and only shown on request
  commonMistakes?: string[];
  /** v1: self-assessment criteria for `validation: none` written exercises (Daily Learning "written"). */
  rubric?: string[];
  /** v1: estimated minutes, when the source states one. */
  minutes?: number;
  solution?: { code: string; explanation: string; alternatives?: { title: string; code: string; note?: string }[] };
  complexity?: { time?: string; space?: string; note?: string };
  interviewRelevance?: string;
  visualization?: { enabled: boolean; presets?: string[]; note?: string };
  related?: string[]; // exercise ids
  next?: string; // recommended next concept or exercise id
}

export type RunStatus = "ok" | "error" | "timeout" | "stopped";

export interface RunOutcome {
  status: RunStatus;
  durationMs: number;
  stdout?: string; // python
  stderr?: string;
  error?: { type?: string; message: string; line?: number };
  /** Tabular result (SQL rows, or a printed DataFrame converted to rows). Never fabricated. */
  table?: { columns: string[]; rows: unknown[][]; truncated?: boolean };
  /** Domain-specific raw payload the adapter's visualizer understands. */
  raw?: unknown;
}

export interface TestResult { name: string; passed: boolean; detail?: string; hidden?: boolean }
export interface ValidationOutcome { passed: boolean; tests: TestResult[]; feedback?: FeedbackItem[] }

/** Why an answer is wrong, by category (SQL: syntax, join logic, filtering, aggregation, grouping, window, null, performance;
 *  Python: syntax, types, control flow, functions, collections, algorithm, runtime, output). */
export interface FeedbackItem { category: string; message: string; line?: number; suggestion?: string }

/** Honest label for every visualization. */
export type Provenance = "executed" | "parsed" | "plan" | "estimated" | "conceptual" | "simulated";

export interface VisualModel {
  provenance: Provenance;
  /** Opaque to the workspace. Rendered by the adapter's own `Visualizer` component. */
  data: unknown;
  /** Number of steps the player can move through, if the model is steppable. */
  steps?: number;
  notes?: string[]; // e.g. "trace sampled", "supported subset only"
}

/** v1: an adapter module (what `adapters/<folder>/index.ts` exports). See docs/WORKSPACE_ARCHITECTURE.md "Adapter module convention". */
export interface AdapterModule {
  /** The adapter for `domain`. One module may serve several domains (the data module serves "pandas" and "numpy"). */
  getAdapter(domain: Domain): ExecutionAdapter;
  /** React component that renders this module's VisualModels. Optional: a module without one has no visualization panel. */
  Visualizer?: import("react").ComponentType<VisualizerProps>;
}

export interface RunContext {
  exercise: ExerciseDef;
  signal?: AbortSignal;
}

export interface ExecutionAdapter {
  domain: Domain;
  capabilities: ReadonlySet<Capability>;
  /** Optional engine-side cleanup when the learner presses Reset (for example drop scratch tables). */
  reset?(ctx: RunContext): Promise<void>;
  /** True when `visualize` can build a useful view from a run that failed (for example a Python trace that ends in an exception). */
  visualizeOnError?: boolean;
  /** Run without grading. Reuses the existing runner (PGlite, Pyodide worker). */
  run(code: string, ctx: RunContext): Promise<RunOutcome>;
  /** Grade. Must go through the existing grading code, not a copy. */
  validate?(code: string, outcome: RunOutcome, ctx: RunContext): Promise<ValidationOutcome>;
  /** Build real, steppable data from a run. Return null when the engine cannot do it accurately. */
  visualize?(code: string, outcome: RunOutcome, ctx: RunContext): Promise<VisualModel | null>;
  /** Plain-language category + message for a failure. */
  explainFailure?(code: string, outcome: RunOutcome, validation: ValidationOutcome | null, ctx: RunContext): FeedbackItem[];
  /** Explicit list of what is not supported, shown to the learner as "Not supported here". */
  limitations?: string[];
}

/** Props every adapter visualizer receives. The workspace owns the player; the visualizer renders `model` at `step`. */
export interface VisualizerProps {
  model: VisualModel;
  step: number;
  onStepChange(step: number): void;
  reducedMotion: boolean;
  /** True when the workspace shows its own player; the visualizer then hides its own play/step/speed controls. */
  hostPlayer?: boolean;
}

/** Progress and mistakes go through existing stores only (lib/progress.ts, lib/pyPractice.ts, lib/mistakes.ts). */
export interface ProgressPort {
  /**
   * A graded submit finished. `errorKind` is free text describing a failure (first feedback message or error text); the port
   * classifies it for the Mistake Notebook. `code` (v1) is the learner's code, needed by the SQL store. Never called on open or run.
   */
  recordAttempt(ex: ExerciseDef, passed: boolean, errorKind?: string, code?: string): void;
  recordHint(ex: ExerciseDef, level: number): void;
  recordReveal(ex: ExerciseDef): void;
  /** v1, optional: an ungraded run finished (a failed run goes to the Mistake Notebook as "not graded"). Never marks anything solved. */
  recordRun?(ex: ExerciseDef, ok: boolean, errorText?: string): void;
}
