/** Browser side of Visual Learning Notes: gathers real content, then renders the PDF in a worker. */
import { loadQuestion, loadSchema } from "../data";
import { runQuery } from "../browserDb";
import { buildGraphs } from "../queryGraph";
import { explainQuery } from "../tutor";
import { loadExercise } from "../pyExercises";
import { runPython } from "../pyRunner";
import { runPythonTask } from "../tasks";
import type { Progress } from "../progress";
import type { QuestionSummary } from "../../types";
import { outlineProgram, parseOutline } from "./pyOutline";
import { pyNote, sqlNote, type NoteItem, type NotesOptions } from "./content";
import type { FontReport, PdfRequest, PdfResponse } from "./pdf.worker";

export interface Selection { kind: "sql" | "python"; key: string } // key: question slug or Python slug

/** The learner's last passing Python code for a problem (from this browser's check history). */
export function minePython(slug: string): string | null {
  try {
    const h = JSON.parse(localStorage.getItem(`sqlp.py.history.${slug}`) ?? "[]") as { kind: string; ok: boolean; code?: string }[];
    return h.find((r) => r.kind === "check" && r.ok && r.code)?.code ?? null;
  } catch { return null; }
}

export async function collectItems(sel: Selection[], index: QuestionSummary[], progress: Progress, onStep: (done: number, label: string) => void): Promise<NoteItem[]> {
  const needSql = sel.some((s) => s.kind === "sql");
  const schema = needSql ? await loadSchema() : [];
  const items: NoteItem[] = [];
  for (const [i, s] of sel.entries()) {
    if (s.kind === "sql") {
      const q = await loadQuestion(s.key);
      onStep(i, `Q${q.number} ${q.title}`);
      const p = progress.questions[q.number];
      items.push(await sqlNote(q, p?.solvedAt ? p.lastSql : undefined, {
        schema, buildGraphs, explain: explainQuery, run: (sql) => runQuery(sql),
        titleOf: (n) => { const r = index.find((x) => x.number === n); return r ? `Q${r.number} ${r.title}` : undefined; },
      }));
    } else {
      const e = await loadExercise(s.key);
      if (!e) continue;
      onStep(i, `${e.code} ${e.title}`);
      items.push(await pyNote(e, minePython(e.slug), {
        outline: async (code) => parseOutline((await runPython(outlineProgram(code))).stdout),
        tests: async (code) => {
          if (!e.task) return null;
          const r = await runPythonTask(e.task, code, (c, t) => runPython(c, t), { count: true });
          const v = r.counts?.visible, h = r.counts?.hidden;
          return v ? { visible: { passed: v.passed, total: v.total }, hidden: { passed: h?.passed ?? 0, total: h?.total ?? 0 } } : null;
        },
      }));
    }
  }
  onStep(sel.length, "Building the PDF");
  return items;
}

let worker: Worker | null = null, seq = 0;
export function renderPdf(items: NoteItem[], options: NotesOptions): Promise<{ blob: Blob; pages: number; fonts: FontReport }> {
  worker ??= new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
  const id = ++seq;
  const req: PdfRequest = { id, items, options, generatedAt: new Date().toLocaleString() };
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<PdfResponse>) => {
      if (e.data.id !== id) return;
      worker!.removeEventListener("message", onMsg);
      if (e.data.ok) resolve({ blob: new Blob([e.data.pdf], { type: "application/pdf" }), pages: e.data.pages, fonts: e.data.fonts });
      else reject(new Error(`The PDF could not be built: ${e.data.error}`));
    };
    worker!.addEventListener("message", onMsg);
    worker!.addEventListener("error", (e) => reject(new Error(e.message || "The PDF worker failed to start.")), { once: true });
    worker!.postMessage(req);
  });
}
