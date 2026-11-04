/**
 * Visualization sessions and executed queries, saved per question (or scenario) in this browser.
 * Each record is appended — earlier attempts are never overwritten.
 */
export interface ExecRecord {
  at: string;
  kind: "run" | "submit";
  sql: string;
  ok: boolean;
  rows?: number;
  correct?: boolean;
  /** Attempt number at the time (submits so far, +1 for this submit). */
  attempt: number;
}
export interface VizSession {
  id: string;
  at: string;
  sql: string;
  attempt: number;
  dataset: string;
  /** Short parsed structure summary, e.g. "SELECT · 2 joins · GROUP BY". */
  structure: string;
  planCost?: number;
  planRoot?: string;
  stages: string[];
  volatile?: string[];
}

const EXEC = (k: string) => `sqlp.exec.${k}`;
const VIZ = (k: string) => `sqlp.viz.${k}`;
const read = <T,>(key: string): T[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
};
const write = (key: string, list: unknown[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage full or unavailable */
  }
};

export const getExecs = (k: string) => read<ExecRecord>(EXEC(k));
export function addExec(k: string, r: ExecRecord) {
  write(EXEC(k), [r, ...getExecs(k)].slice(0, 50));
}
export const getSessions = (k: string) => read<VizSession>(VIZ(k));
export function addSession(k: string, s: Omit<VizSession, "id" | "at">): VizSession {
  const full = { ...s, id: crypto.randomUUID(), at: new Date().toISOString() };
  write(VIZ(k), [full, ...getSessions(k)].slice(0, 30));
  return full;
}

/**
 * Best-effort: highlight a character range of `sql` inside the Monaco editor that holds it.
 * Uses the page's Monaco instance; silently does nothing if it isn't available.
 */
let decorations: { clear(): void } | null = null;
export function highlightInEditor(sql: string, range: [number, number] | null) {
  decorations?.clear();
  decorations = null;
  const monaco = (window as unknown as { monaco?: { editor: { getEditors?: () => MonacoEditor[] } } }).monaco;
  if (!range || !monaco?.editor.getEditors) return;
  for (const ed of monaco.editor.getEditors()) {
    const model = ed.getModel();
    if (!model) continue;
    const text = model.getValue();
    const at = text.indexOf(sql.trim().replace(/;\s*$/, ""));
    if (at < 0) continue;
    const start = model.getPositionAt(at + range[0]);
    const end = model.getPositionAt(at + range[1]);
    decorations = ed.createDecorationsCollection([
      { range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, options: { inlineClassName: "viz-clause-highlight" } },
    ]);
    ed.revealLineInCenterIfOutsideViewport(start.lineNumber);
    return;
  }
}
interface MonacoEditor {
  getModel(): { getValue(): string; getPositionAt(o: number): { lineNumber: number; column: number } } | null;
  createDecorationsCollection(d: unknown[]): { clear(): void };
  revealLineInCenterIfOutsideViewport(line: number): void;
}
