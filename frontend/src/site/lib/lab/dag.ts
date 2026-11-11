/**
 * Pipeline orchestration simulator, modelled on Apache Airflow concepts and run on a virtual clock
 * (no real time, no Airflow). A DAG has tasks with dependencies, retries and a retry delay, a
 * schedule, and a "behaviour" that says how each task misbehaves so failures are repeatable.
 * Simplifications, stated to the learner: trigger rule is always "all_success", unlimited
 * parallelism, tasks only fail by their behaviour setting.
 */
export type Schedule = "manual" | "@hourly" | "@daily" | "@weekly";
export type Behavior =
  | { kind: "succeed" }
  /** The first `times` attempts fail, then it works (a flaky API, a lock that clears). */
  | { kind: "fail-times"; times: number }
  /** Fails every time until someone fixes it. */
  | { kind: "always-fail" }
  /** Every attempt fails in the listed runs (0 = first run), for example one bad day of data. */
  | { kind: "fail-on-runs"; runs: number[] };

export interface DagTask { id: string; name: string; deps: string[]; retries: number; retryDelayMin: number; durationMin: number; behavior: Behavior }
export interface Dag { id: string; name: string; schedule: Schedule; /** YYYY-MM-DD */ startDate: string; catchup: boolean; tasks: DagTask[] }

export type TaskState = "success" | "failed" | "upstream_failed";
export interface Attempt { number: number; startMin: number; endMin: number; ok: boolean }
export interface TaskInstance { taskId: string; state: TaskState; attempts: Attempt[] }
export interface DagRun {
  index: number;
  /** The interval this run covers (Airflow's logical date). */
  logicalDate: string;
  state: "success" | "failed";
  startMin: number;
  endMin: number;
  tasks: Record<string, TaskInstance>;
  logs: string[];
}

export const SCHEDULE_TEXT: Record<Schedule, string> = { manual: "Only when you trigger it", "@hourly": "Every hour", "@daily": "Every day", "@weekly": "Every week" };
const STEP_DAYS: Record<Exclude<Schedule, "manual">, number> = { "@hourly": 1 / 24, "@daily": 1, "@weekly": 7 };

export function validateDag(d: Dag): string[] {
  const errs: string[] = [];
  if (!d.tasks.length) errs.push("Add at least one task.");
  const ids = new Set(d.tasks.map((t) => t.id));
  if (ids.size !== d.tasks.length) errs.push("Two tasks have the same id.");
  for (const t of d.tasks) {
    if (!t.name.trim()) errs.push("Every task needs a name.");
    for (const dep of t.deps) { if (!ids.has(dep)) errs.push(`${t.name || t.id} depends on a task that does not exist.`); if (dep === t.id) errs.push(`${t.name} cannot depend on itself.`); }
    if (!(t.retries >= 0 && t.retries <= 5)) errs.push(`${t.name}: retries must be between 0 and 5.`);
    if (!(t.durationMin >= 1)) errs.push(`${t.name}: duration must be at least 1 minute.`);
    if (!(t.retryDelayMin >= 0)) errs.push(`${t.name}: retry delay cannot be negative.`);
  }
  if (!errs.length && order(d) === null) errs.push("The tasks depend on each other in a circle. A DAG must have no cycles.");
  return errs;
}

/** Task ids in dependency order, or null when there is a cycle. */
export function order(d: Dag): string[] | null {
  const left = new Map(d.tasks.map((t) => [t.id, t.deps.length]));
  const out: string[] = [];
  const queue = d.tasks.filter((t) => t.deps.length === 0).map((t) => t.id);
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const t of d.tasks) if (t.deps.includes(id)) { left.set(t.id, left.get(t.id)! - 1); if (left.get(t.id) === 0) queue.push(t.id); }
  }
  return out.length === d.tasks.length ? out : null;
}

/** Does attempt `n` (1-based, counted across manual retries) of this task fail in run `runIndex`? */
export function attemptFails(b: Behavior, n: number, runIndex: number): boolean {
  switch (b.kind) {
    case "succeed": return false;
    case "always-fail": return true;
    case "fail-times": return n <= b.times;
    case "fail-on-runs": return b.runs.includes(runIndex);
  }
}

const fmt = (min: number) => `+${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

/**
 * Execute tasks of one run. With `redo`, only those tasks (and so their downstream) are cleared and run
 * again; everything else keeps its result. Attempt numbers continue, and each cleared task gets a fresh
 * retry budget, like clearing a task instance in Airflow.
 */
export function executeRun(dag: Dag, index: number, logicalDate: string, startMin = 0, prev?: DagRun, redo?: Set<string>): DagRun {
  const tasks: Record<string, TaskInstance> = {};
  const logs: string[] = prev ? [...prev.logs, `--- cleared ${[...redo!].map((id) => dag.tasks.find((t) => t.id === id)?.name ?? id).join(", ")} and everything after it; running again ---`] : [];
  const endOf: Record<string, number> = {};
  for (const id of order(dag)!) {
    const t = dag.tasks.find((x) => x.id === id)!;
    const before = prev?.tasks[id];
    const rerun = !prev || redo!.has(id);
    if (prev && !rerun && before) { tasks[id] = before; endOf[id] = before.attempts.at(-1)?.endMin ?? startMin; continue; }
    const depStates = t.deps.map((d) => tasks[d]?.state);
    if (depStates.some((s) => s !== "success")) {
      tasks[id] = { taskId: id, state: "upstream_failed", attempts: before?.attempts ?? [] };
      logs.push(`[${t.name}] upstream task failed, so this task is marked upstream_failed and does not run (trigger rule: all_success)`);
      continue;
    }
    const attempts: Attempt[] = [...(before?.attempts ?? [])];
    const offset = attempts.length;
    const maxTries = t.retries + 1;
    let clock = Math.max(startMin, ...t.deps.map((d) => endOf[d] ?? startMin));
    let ok = false;
    logs.push(`[${t.name}] all upstream tasks succeeded, task is queued at ${fmt(clock)}`);
    for (let k = 1; k <= maxTries; k++) {
      const n = offset + k;
      const fails = attemptFails(t.behavior, n, index);
      logs.push(`[${t.name}] ${fmt(clock)} starting attempt ${k} of ${maxTries}`);
      attempts.push({ number: n, startMin: clock, endMin: clock + t.durationMin, ok: !fails });
      clock += t.durationMin;
      if (!fails) { ok = true; logs.push(`[${t.name}] ${fmt(clock)} task finished, marking it SUCCESS`); break; }
      if (k < maxTries) { logs.push(`[${t.name}] ${fmt(clock)} task failed with an exception, marking it UP_FOR_RETRY (retry_delay=${t.retryDelayMin}m)`); clock += t.retryDelayMin; }
      else logs.push(`[${t.name}] ${fmt(clock)} task failed with an exception and no retries are left, marking it FAILED`);
    }
    tasks[id] = { taskId: id, state: ok ? "success" : "failed", attempts };
    endOf[id] = clock;
  }
  const all = Object.values(tasks);
  return { index, logicalDate, state: all.every((x) => x.state === "success") ? "success" : "failed", startMin, endMin: Math.max(startMin, ...Object.values(endOf)), tasks, logs };
}

/** Logical dates of the runs the schedule would create up to `now`, oldest first. Manual DAGs have none. */
export function scheduledDates(dag: Pick<Dag, "schedule" | "startDate" | "catchup">, now: string, cap = 14): string[] {
  if (dag.schedule === "manual") return [];
  const step = STEP_DAYS[dag.schedule] * 86_400_000;
  const start = Date.parse(`${dag.startDate}T00:00:00Z`), end = Date.parse(now.length === 10 ? `${now}T00:00:00Z` : now);
  if (!(end >= start)) return [];
  const all: string[] = [];
  for (let t = start; t < end && all.length < 500; t += step) all.push(new Date(t).toISOString().slice(0, dag.schedule === "@hourly" ? 16 : 10));
  // Without catchup only the most recent interval runs; with it, every missed interval does.
  return dag.catchup ? all.slice(-cap) : all.slice(-1);
}

/** Simulate every scheduled run up to `now` (or one manual run), each on its own virtual clock. */
export function simulate(dag: Dag, now: string, cap = 14): DagRun[] {
  const dates = dag.schedule === "manual" ? [now.slice(0, 10)] : scheduledDates(dag, now, cap);
  return dates.map((d, i) => executeRun(dag, i, d));
}

/** Clear failed (and upstream_failed) tasks of a run and run them again with the DAG as it is now. */
export function retryFailed(dag: Dag, run: DagRun): DagRun {
  const failed = new Set(Object.values(run.tasks).filter((t) => t.state === "failed").map((t) => t.taskId));
  if (!failed.size) return run;
  const downstream = new Set(failed);
  for (const id of order(dag)!) if (dag.tasks.find((t) => t.id === id)!.deps.some((d) => downstream.has(d))) downstream.add(id);
  return executeRun(dag, run.index, run.logicalDate, run.startMin, run, downstream);
}

export interface Concept { term: string; airflow: string; meaning: string }
export const CONCEPTS: Concept[] = [
  { term: "Workflow", airflow: "DAG", meaning: "A set of tasks and the order they must run in. Directed (one way), acyclic (no loops)." },
  { term: "Step", airflow: "Task / operator", meaning: "One unit of work, such as extract a file or run a SQL transform. Each run of a task is a task instance." },
  { term: "Order", airflow: "Dependencies (>>)", meaning: "A task starts only after the tasks it depends on succeed (trigger rule all_success)." },
  { term: "Schedule", airflow: "schedule / schedule_interval", meaning: "How often the DAG runs. Each run covers one interval, named by its logical date." },
  { term: "Retries", airflow: "retries, retry_delay", meaning: "How many extra attempts a failed task gets, and how long it waits between them." },
  { term: "Catch-up", airflow: "catchup", meaning: "When on, a DAG creates a run for every interval it missed since its start date. When off, only the latest one." },
  { term: "Failure downstream", airflow: "upstream_failed", meaning: "Tasks after a failed task do not run; they are marked upstream_failed." },
  { term: "Re-run", airflow: "Clear task", meaning: "Clearing a failed task (and what follows it) runs it again. Fix the cause first, or it fails again." },
];

export const PRESET_DAG: Dag = {
  id: "etl", name: "daily_sales_etl", schedule: "@daily", startDate: "2026-11-01", catchup: false,
  tasks: [
    { id: "extract", name: "extract", deps: [], retries: 2, retryDelayMin: 5, durationMin: 8, behavior: { kind: "fail-times", times: 1 } },
    { id: "clean", name: "clean", deps: ["extract"], retries: 1, retryDelayMin: 2, durationMin: 4, behavior: { kind: "succeed" } },
    { id: "transform", name: "transform", deps: ["clean"], retries: 1, retryDelayMin: 2, durationMin: 10, behavior: { kind: "succeed" } },
    { id: "validate", name: "validate", deps: ["transform"], retries: 0, retryDelayMin: 0, durationMin: 2, behavior: { kind: "fail-on-runs", runs: [0] } },
    { id: "load", name: "load", deps: ["validate"], retries: 1, retryDelayMin: 3, durationMin: 6, behavior: { kind: "succeed" } },
  ],
};
