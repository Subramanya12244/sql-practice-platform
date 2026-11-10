/**
 * Learner extras: daily challenges, topic mastery, revision lists, submission history and a
 * downloadable personal report. Everything is derived from progress already stored for the learner;
 * nothing new is synced, and all of it is deterministic (no AI).
 */
import type { Progress } from "./progress";
import type { PyExerciseMeta } from "./pyExercises";
import type { PyStat } from "./pyPractice";
import { topicRows } from "./solveAnalytics";
import type { SolveSession } from "./solveSessions";
import type { QuestionSummary } from "../types";

/** FNV-1a: a stable hash so every visitor gets the same pick for a given day. */
export function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * Today's challenges (UTC day): one SQL question and one Python problem. The level rotates
 * Easy, Medium, Hard over the week (Sunday and Saturday are Medium), so it is the same for everyone.
 */
export function dailyChallenge(day: string, sql: QuestionSummary[], py: PyExerciseMeta[]) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  const level = ["Medium", "Easy", "Medium", "Hard", "Easy", "Medium", "Hard"][dow];
  const pick = <T extends { difficulty: string }>(items: T[], salt: string) => {
    const pool = items.filter((x) => x.difficulty === level);
    const from = pool.length ? pool : items;
    return from.length ? from[hash(`${day}:${salt}`) % from.length] : undefined;
  };
  return { day, level, sql: pick(sql, "sql"), python: pick(py, "py") };
}

/**
 * Topic mastery for the Progress page. There is ONE scorer: `solveAnalytics.masteryFor`, shared with the
 * Analytics page, so both screens always show the same level and score for a topic.
 */
export type { MasteryLevel as Mastery } from "./solveAnalytics";

export function sqlMastery(index: QuestionSummary[], progress: Progress, sessions: SolveSession[] = progress.sessions ?? []) {
  return topicRows({ index, exercises: [], progress, pyStats: {}, sessions }).filter((r) => r.kind === "sql");
}

export function pyMastery(all: PyExerciseMeta[], progress: Progress, stats: Record<string, PyStat>, sessions: SolveSession[] = progress.sessions ?? []) {
  return topicRows({ index: [], exercises: all, progress, pyStats: stats, sessions }).filter((r) => r.kind === "python");
}

/** Questions to revisit: unsolved after failed submits, solved only with help, or with repeated error kinds. */
export function sqlRevision(index: QuestionSummary[], progress: Progress, limit = 20) {
  return index.flatMap((q) => {
    const p = progress.questions[q.number];
    if (!p || !p.attempts) return [];
    const errors = Object.values(p.errorKinds ?? {}).reduce((s, n) => s + n, 0);
    const reason = !p.solvedAt ? `${p.attempts} attempt${p.attempts === 1 ? "" : "s"}, not solved yet`
      : p.assisted || p.revealed ? "solved with help: try it again without hints"
        : errors >= 3 ? `${errors} wrong submits before solving` : null;
    return reason ? [{ q, reason, weight: (p.solvedAt ? 0 : 100) + errors + p.attempts }] : [];
  }).sort((a, b) => b.weight - a.weight || a.q.number - b.q.number).slice(0, limit);
}

export interface HistoryItem { kind: "sql" | "python"; key: string; title: string; path: string; at: string; ok: boolean; detail: string; code?: string }

/** Python checks and runs come from per-problem histories; SQL from per-question progress (latest state). */
export function submissionHistory(index: QuestionSummary[], progress: Progress, py: PyExerciseMeta[],
  pyHist: Record<string, { at: string; kind: "run" | "check"; ok: boolean; message: string; code?: string }[]>): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const q of index) {
    const p = progress.questions[q.number];
    if (!p?.attempts || !p.practiced) continue;
    items.push({ kind: "sql", key: `q${q.number}`, title: `Q${q.number} ${q.title}`, path: `/questions/${q.slug}`, at: p.solvedAt ?? p.startedAt ?? "",
      ok: Boolean(p.solvedAt), detail: `${p.attempts} attempt${p.attempts === 1 ? "" : "s"}${p.solvedAt ? (p.assisted ? " · solved with help" : " · solved") : ""}`, code: p.lastSql });
  }
  const bySlug = new Map(py.map((e) => [e.slug, e]));
  for (const [slug, runs] of Object.entries(pyHist)) {
    const e = bySlug.get(slug);
    if (!e) continue;
    for (const r of runs.filter((x) => x.kind === "check"))
      items.push({ kind: "python", key: `py:${slug}`, title: `${e.code} ${e.title}`, path: `/practice/python/${slug}`, at: r.at, ok: r.ok, detail: r.message, code: r.code });
  }
  return items.filter((i) => i.at).sort((a, b) => b.at.localeCompare(a.at));
}

/** Latest passing code per problem: the learner's own saved solutions. */
export function savedSolutions(history: HistoryItem[]) {
  const seen = new Set<string>();
  return history.filter((h) => h.ok && h.code && !seen.has(h.key) && seen.add(h.key));
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface ReportInput {
  name: string; generated: string;
  sql: { solved: number; total: number; independent: number };
  python: { solved: number; total: number; accuracy: number | null };
  activeTime: { today: string; week: string; total: string };
  streak: number;
  sqlTopics: { label: string; solved: number; total: number; level: string }[];
  pyTopics: { label: string; solved: number; total: number; level: string }[];
  revise: { title: string; reason: string }[];
  mocks: { date: string; solved: number; total: number }[];
}

/** A self-contained, printable HTML report (no scripts, no external assets). All values are escaped. */
export function personalReportHtml(r: ReportInput): string {
  const table = (rows: ReportInput["sqlTopics"]) => `<table><thead><tr><th>Topic</th><th>Solved</th><th>Mastery</th></tr></thead><tbody>${rows.map((t) => `<tr><td>${esc(t.label)}</td><td>${t.solved}/${t.total}</td><td>${esc(t.level)}</td></tr>`).join("")}</tbody></table>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DataForge report: ${esc(r.name)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#0f172a;background:#fff;max-width:820px;margin:32px auto;padding:0 16px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:28px 0 8px}.muted{color:#64748b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:16px}.tile{border:1px solid #e2e8f0;border-radius:10px;padding:12px}.tile b{display:block;font-size:20px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0}th{font-size:12px;text-transform:uppercase;color:#64748b}@media print{body{margin:0}}</style></head><body>
<h1>DataForge learning report</h1><p class="muted">${esc(r.name)} · generated ${esc(r.generated)}</p>
<div class="grid"><div class="tile">SQL solved<b>${r.sql.solved}/${r.sql.total}</b><span class="muted">${r.sql.independent} without help</span></div><div class="tile">Python solved<b>${r.python.solved}/${r.python.total}</b><span class="muted">${r.python.accuracy === null ? "no checks yet" : `${r.python.accuracy}% of checks passed`}</span></div><div class="tile">Active time<b>${esc(r.activeTime.week)}</b><span class="muted">this week · ${esc(r.activeTime.total)} total on this device</span></div><div class="tile">Streak<b>${r.streak} day${r.streak === 1 ? "" : "s"}</b></div></div>
<h2>SQL topic mastery</h2>${table(r.sqlTopics)}
<h2>Python category mastery</h2>${table(r.pyTopics)}
<h2>To revise</h2>${r.revise.length ? `<ul>${r.revise.map((x) => `<li>${esc(x.title)} <span class="muted">(${esc(x.reason)})</span></li>`).join("")}</ul>` : `<p class="muted">Nothing flagged.</p>`}
<h2>Mock interviews</h2>${r.mocks.length ? `<ul>${r.mocks.map((m) => `<li>${esc(m.date)}: ${m.solved}/${m.total}</li>`).join("")}</ul>` : `<p class="muted">None yet.</p>`}
<p class="muted" style="margin-top:32px">Strength: completion (harder questions count more), recent results, attempts per solve and hints used; speed is never part of it. Active time counts focused minutes with keyboard, mouse or touch input.</p>
</body></html>`;
}

/** One problem per level, preferring unsolved ones; seeded so a reload during setup shows the same set. */
export function pickAssessment(all: { slug: string; difficulty: string }[], done: Record<string, string> | undefined, seed: string, includeSolved: boolean) {
  return ["Easy", "Medium", "Hard"].flatMap((d) => {
    const level = all.filter((e) => e.difficulty === d);
    const fresh = level.filter((e) => !done?.[`py:${e.slug}`]);
    const pool = includeSolved || !fresh.length ? level : fresh;
    return pool.length ? [pool[hash(`${seed}:${d}`) % pool.length].slug] : [];
  });
}
