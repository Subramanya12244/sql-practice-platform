/**
 * The four short answers every visualization step gives, in every domain (Python, Pandas, NumPy), the way the SQL Query Cinema
 * answers "what / why / which rows changed" for each clause:
 *
 *   what      what is happening now (the operation, in one sentence)
 *   changed   the exact change, with the real numbers, values, shapes or variables
 *   why       the Python / Pandas / NumPy idea behind it
 *   remember  one takeaway the learner can reuse
 *
 * A story is built only from data the engine really recorded (the trace, the stage snapshots). `storyProblems` is the guard the tests
 * run over every story: all four parts present, short, and free of placeholder or broken text.
 */
export interface StepStory {
  what: string;
  changed: string;
  why: string;
  remember: string;
}

export const STORY_PARTS = [
  { key: "what", title: "What is happening?" },
  { key: "changed", title: "What changed?" },
  { key: "why", title: "Why did it happen?" },
  { key: "remember", title: "Remember this" },
] as const satisfies readonly { key: keyof StepStory; title: string }[];

/** Longest a single part may be. Longer text is a paragraph, and the brief asks for concise answers. */
export const STORY_MAX = 280;

const BROKEN = /\b(undefined|NaN|nan|inf|Infinity)\b|\[object |\{\{|\}\}|TODO|lorem/i;

/** Problems with one story. Empty when it is fit to show. `allowNaN` lets a story quote a real NaN or inf value (pandas cells, Python floats). */
export function storyProblems(s: StepStory, opts: { allowNaN?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const { key } of STORY_PARTS) {
    const t = s[key];
    if (typeof t !== "string" || !t.trim()) { out.push(`${key} is empty`); continue; }
    if (t.length > STORY_MAX) out.push(`${key} is ${t.length} characters (max ${STORY_MAX})`);
    const probe = opts.allowNaN ? t.replace(/\b(NaN|nan|inf|-inf)\b/gi, "") : t;
    if (BROKEN.test(probe.replace(/\bnull\b/gi, "")) ) out.push(`${key} contains placeholder or broken text`);
    if (/\s{2,}/.test(t.replace(/\n/g, " ").trim())) out.push(`${key} has repeated whitespace`);
  }
  return out;
}

/** Clip to a length at a word boundary, for values pasted into a sentence. */
export function clip(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** "1 row", "2 rows". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
