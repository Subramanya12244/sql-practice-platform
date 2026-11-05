/**
 * Validated tasks shared by Python practice and the Projects Lab (format: docs/CONTENT_SPEC.md).
 * - sql: learner SQL + `check` run in ONE rolled-back transaction on the task's dataset.
 * - python: learner code + `tests` (asserts) run in the Pyodide sandbox.
 * - checklist: manual steps; never sufficient on their own for "Completed".
 */
import type { ExecuteResult } from "../../types";

export interface SqlTask { id: string; title: string; type: "sql"; instructions: string; starter: string; solution: string; check: string }
export interface PythonTask {
  id: string; title: string; type: "python"; instructions: string; starter: string; solution: string; tests: string;
  /** Run after the visible tests pass; never shown to the learner. */
  hidden?: string;
  /** Shown after the learner passes or chooses to view the solution. */
  explanation?: string;
}
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

export interface TestCounts { passed: number; total: number; failures: { test: string; error: string }[] }
const MARK = "__DF_TESTS__";

/**
 * Wrap test code so each top-level statement runs on its own and is counted. Statements share one
 * namespace (setup lines still work); afterwards the first failure is re-raised so the run fails
 * exactly as before. Only `assert` statements count as tests.
 */
export function countingHarness(groups: { name: "visible" | "hidden"; src: string }[]): string {
  return `import ast as _df_ast, json as _df_json
_df_out = {}
_df_first = None
for _df_name, _df_src in ${JSON.stringify(groups.map((g) => [g.name, g.src]))}:
    _df_r = _df_out.setdefault(_df_name, {"passed": 0, "total": 0, "failures": []})
    for _df_node in _df_ast.parse(_df_src).body:
        _df_seg = (_df_ast.get_source_segment(_df_src, _df_node) or "").strip()
        _df_test = isinstance(_df_node, (_df_ast.Assert, _df_ast.For, _df_ast.With, _df_ast.Try))
        try:
            exec(compile(_df_ast.Module([_df_node], []), "<tests>", "exec"), globals())
            if _df_test:
                _df_r["total"] += 1
                _df_r["passed"] += 1
        except Exception as _df_e:
            _df_r["total"] += 1
            _df_msg = (type(_df_e).__name__ + ": " + str(_df_e))[:300]
            _df_r["failures"].append({"test": _df_seg[:300] if _df_name == "visible" else "", "error": _df_msg if _df_name == "visible" else type(_df_e).__name__})
            if _df_first is None:
                _df_first = (_df_e, _df_seg)
print("${MARK}" + _df_json.dumps(_df_out))
if _df_first is not None:
    _df_e, _df_seg = _df_first
    if isinstance(_df_e, AssertionError):
        raise AssertionError(str(_df_e) or _df_seg.splitlines()[0][:200])
    raise _df_e
`;
}

/** Pull the counts line out of stdout. */
export function readCounts(stdout: string): { stdout: string; counts?: Record<string, TestCounts> } {
  const i = stdout.lastIndexOf(MARK);
  if (i < 0) return { stdout };
  const end = stdout.indexOf("\n", i);
  try {
    return { stdout: stdout.slice(0, i) + (end < 0 ? "" : stdout.slice(end + 1)), counts: JSON.parse(stdout.slice(i + MARK.length, end < 0 ? undefined : end)) };
  } catch {
    return { stdout };
  }
}

export async function runPythonTask(task: PythonTask, code: string, run: RunPy, opts: { count?: boolean } = {}): Promise<TaskResult & { counts?: Record<string, TestCounts> }> {
  if (!code.trim()) return { ok: false, message: "Write some code first." };
  const wrap = (groups: { name: "visible" | "hidden"; src: string }[]) => (opts.count ? countingHarness(groups) : groups.map((g) => g.src).join("\n"));
  const raw = await run(code, wrap([{ name: "visible", src: task.tests }]));
  const { stdout, counts } = readCounts(raw.stdout ?? "");
  const r = { ...raw, stdout };
  if (r.ok && task.hidden) {
    const hr = await run(code, wrap([{ name: "visible", src: task.tests }, { name: "hidden", src: task.hidden }]));
    const hc = readCounts(hr.stdout ?? "");
    const h = { ...hr, stdout: hc.stdout };
    const all = hc.counts ?? counts;
    if (h.ok) return { ok: true, message: "All visible and hidden tests passed.", output: h.stdout, ms: r.ms + h.ms, counts: all };
    if (h.phase === "timeout") return { ok: false, message: h.error ?? "Timed out on the hidden tests.", ms: h.ms, counts };
    return { ok: false, message: "Passes the visible tests but fails a hidden test. Check edge cases: empty input, duplicates, negatives, ties and very large values.", ms: r.ms + h.ms, counts: all };
  }
  if (r.ok) return { ok: true, message: "All tests passed.", output: r.stdout, ms: r.ms, counts };
  const lastLine = (r.error ?? "").trim().split("\n").pop() ?? "";
  const message =
    r.phase === "timeout" ? r.error ?? "Timed out."
      : r.phase === "load" ? r.error ?? "Python could not start."
        : r.phase === "code" ? `Your code raised an error: ${lastLine}`
          : /^AssertionError/.test(lastLine) ? `A test failed${lastLine.length > 15 ? `: ${lastLine.replace(/^AssertionError:?\s*/, "")}` : "."}`
            : `A test raised: ${lastLine}`;
  return { ok: false, message, output: [r.stdout, r.error].filter(Boolean).join("\n"), ms: r.ms, counts };
}
