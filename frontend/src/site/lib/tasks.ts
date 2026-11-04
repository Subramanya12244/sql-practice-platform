/**
 * Validated tasks shared by Python practice and the Projects Lab (format: docs/CONTENT_SPEC.md).
 * - sql: learner SQL + `check` run in ONE rolled-back transaction on the task's dataset.
 * - python: learner code + `tests` (asserts) run in the Pyodide sandbox.
 * - checklist: manual steps; never sufficient on their own for "Completed".
 */
import type { ExecuteResult } from "../../types";

export interface SqlTask { id: string; title: string; type: "sql"; instructions: string; starter: string; solution: string; check: string }
export interface PythonTask { id: string; title: string; type: "python"; instructions: string; starter: string; solution: string; tests: string }
export interface ChecklistTask { id: string; title: string; type: "checklist"; instructions: string; items: string[] }
export type Task = SqlTask | PythonTask | ChecklistTask;

export interface TaskResult {
  ok: boolean;
  message: string;
  output?: string;
  ms?: number;
}

/** All ```task JSON blocks in a Markdown body, plus the body with them removed. */
export function extractTasks(body: string): { tasks: Task[]; errors: string[]; rest: string } {
  const tasks: Task[] = [];
  const errors: string[] = [];
  // A task block ends at a line "```" right after the closing brace. JSON strings escape their
  // newlines, so "}\n```" can't occur inside instructions that themselves contain ``` fences.
  const rest = body.replace(/```task\n(\{[\s\S]*?\})\s*\n```/g, (_m, json: string) => {
    try {
      const t = JSON.parse(json) as Task;
      if (!t.id || !t.type) throw new Error("task needs id and type");
      tasks.push(t);
      return `\n<!--task:${t.id}-->\n`;
    } catch (e) {
      errors.push((e as Error).message);
      return "";
    }
  });
  return { tasks, errors, rest };
}

type RunSql = (sql: string) => Promise<ExecuteResult>;

/** The check's single row must expose a boolean `ok` and a text `message`. */
export function interpretCheck(res: ExecuteResult): TaskResult {
  if (!res.success) return { ok: false, message: res.message ?? "The SQL failed." };
  const okIdx = res.columns.indexOf("ok");
  const msgIdx = res.columns.indexOf("message");
  const row = res.rows[0];
  if (okIdx < 0 || !row) return { ok: false, message: "The check didn't return a result — did your SQL create the expected objects?" };
  const ok = row[okIdx] === true || row[okIdx] === "t" || row[okIdx] === "true";
  const msg = msgIdx >= 0 ? String(row[msgIdx] ?? "") : "";
  return { ok, message: ok ? "Check passed." : msg || "Check failed." };
}

export async function runSqlTask(task: SqlTask, userSql: string, run: RunSql): Promise<TaskResult> {
  if (!userSql.trim()) return { ok: false, message: "Write some SQL first." };
  const started = performance.now();
  const body = userSql.trim().replace(/;?\s*$/, ";");
  const res = await run(`${body}\n${task.check}`);
  return { ...interpretCheck(res), ms: Math.round(performance.now() - started) };
}

type RunPy = (code: string, tests?: string) => Promise<{ ok: boolean; stdout: string; error?: string; phase?: string; ms: number }>;

export async function runPythonTask(task: PythonTask, code: string, run: RunPy): Promise<TaskResult> {
  if (!code.trim()) return { ok: false, message: "Write some code first." };
  const r = await run(code, task.tests);
  if (r.ok) return { ok: true, message: "All tests passed.", output: r.stdout, ms: r.ms };
  const lastLine = (r.error ?? "").trim().split("\n").pop() ?? "";
  const message =
    r.phase === "timeout" ? r.error ?? "Timed out."
      : r.phase === "load" ? r.error ?? "Python could not start."
        : r.phase === "code" ? `Your code raised an error: ${lastLine}`
          : /^AssertionError/.test(lastLine) ? `A test failed${lastLine.length > 15 ? `: ${lastLine.replace(/^AssertionError:?\s*/, "")}` : "."}`
            : `A test raised: ${lastLine}`;
  return { ok: false, message, output: [r.stdout, r.error].filter(Boolean).join("\n"), ms: r.ms };
}
