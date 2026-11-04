/**
 * Account sync for DataForge data (migration 003): visualization sessions, project progress and
 * submissions, data quality rules and runs. Browser storage stays the source the pages read;
 * on sign-in we merge the account copy into it, push anything the account lacks, then mirror
 * each new write. Signed-out visitors never load this path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VizSession } from "./vizHistory";
import type { ProjectProgress, ReviewStatus } from "./projects";
import type { QualityRun, Rule } from "./dataQuality";

export interface DataSink {
  viz(key: string, s: VizSession): void;
  project(slug: string, p: ProjectProgress, submitted: boolean): void;
  rules(dataset: string, rules: Rule[]): void;
  run(dataset: string, run: QualityRun): void;
}

let sink: DataSink | null = null;
export const setDataSink = (next: DataSink | null) => void (sink = next);
export const dataSink = () => sink;

// ── Row shapes ──────────────────────────────────────────────────────────
export interface VizRow {
  id: string; question_key: string; attempt: number; dataset: string; executed_sql: string;
  structure: string | null; stages: string[]; plan_root: string | null; plan_cost: number | null;
  volatile: string[] | null; created_at: string;
}
export interface ProjectRow { project_slug: string; task_id: string; passed: boolean; code: string | null; message: string | null; updated_at: string }
export interface SubmissionRow {
  project_slug: string; repo_url: string | null; notes: string | null; checklist: Record<string, boolean[]>; created_at: string;
  /** Review fields exist from migration 004 on. */
  status?: ReviewStatus; review_comment?: string | null; reviewed_at?: string | null;
}
export interface RuleRow { dataset: string; rule: Rule; created_at: string }
export interface RunRow { id: string; dataset: string; score: number | null; results: QualityRun["results"]; created_at: string }

/** Checklist ticks live in project_progress under this task id prefix; `passed` stays false for them. */
const CHECK = "checklist:";

export const vizToRow = (key: string, s: VizSession): Omit<VizRow, "id"> & { id: string } => ({
  id: s.id, question_key: key, attempt: s.attempt, dataset: s.dataset, executed_sql: s.sql, structure: s.structure,
  stages: s.stages, plan_root: s.planRoot ?? null, plan_cost: s.planCost ?? null, volatile: s.volatile ?? null, created_at: s.at,
});
export const rowToViz = (r: VizRow): VizSession => ({
  id: r.id, at: r.created_at, sql: r.executed_sql, attempt: r.attempt, dataset: r.dataset, structure: r.structure ?? "",
  stages: r.stages ?? [], planRoot: r.plan_root ?? undefined, planCost: r.plan_cost ?? undefined, volatile: r.volatile ?? undefined,
});

/** Union by id, newest first, capped like the browser list. */
export function mergeById<T extends { id: string; at: string }>(local: T[], remote: T[], cap: number): T[] {
  const byId = new Map<string, T>();
  for (const x of [...remote, ...local]) byId.set(x.id, x);
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, cap);
}

export function projectToRows(slug: string, p: ProjectProgress): ProjectRow[] {
  const tasks = Object.entries(p.tasks).map(([id, t]) => ({
    project_slug: slug, task_id: id, passed: t.passed, code: t.code ?? null, message: t.message ?? null, updated_at: t.at,
  }));
  const checks = Object.entries(p.checklist).map(([id, c]) => ({
    project_slug: slug, task_id: CHECK + id, passed: false, code: JSON.stringify(c), message: null, updated_at: new Date().toISOString(),
  }));
  return [...tasks, ...checks];
}

/**
 * A task passed anywhere stays passed (passes only come from automated checks); otherwise the
 * newer attempt wins. Checklist ticks are OR-ed. The newest submission wins.
 */
export function mergeProject(local: ProjectProgress, rows: ProjectRow[], subs: SubmissionRow[]): ProjectProgress {
  const out: ProjectProgress = { tasks: { ...local.tasks }, checklist: { ...local.checklist }, submission: local.submission };
  for (const r of rows) {
    if (r.task_id.startsWith(CHECK)) {
      const id = r.task_id.slice(CHECK.length);
      let remote: boolean[] = [];
      try { remote = JSON.parse(r.code ?? "[]") as boolean[]; } catch { /* ignore */ }
      const mine = out.checklist[id] ?? [];
      out.checklist[id] = Array.from({ length: Math.max(mine.length, remote.length) }, (_, i) => Boolean(mine[i] || remote[i]));
      continue;
    }
    const mine = out.tasks[r.task_id];
    const theirs = { passed: r.passed, code: r.code ?? undefined, message: r.message ?? undefined, at: r.updated_at };
    if (!mine) out.tasks[r.task_id] = theirs;
    else if (theirs.passed && !mine.passed) out.tasks[r.task_id] = theirs;
    else if (theirs.passed === mine.passed && theirs.at > mine.at) out.tasks[r.task_id] = theirs;
  }
  // Postgres and the browser format timestamps differently, so compare as times.
  const ms = (s: string) => new Date(s).getTime();
  const latest = [...subs].sort((a, b) => ms(b.created_at) - ms(a.created_at))[0];
  if (latest && (!out.submission || ms(latest.created_at) >= ms(out.submission.at))) {
    out.submission = {
      url: latest.repo_url ?? undefined, notes: latest.notes ?? undefined, at: latest.created_at,
      review: latest.status ? { status: latest.status, comment: latest.review_comment ?? undefined, at: latest.reviewed_at ?? undefined } : undefined,
    };
  }
  return out;
}

/** Rules are saved as a whole set; the most recently saved set wins. */
export function pickRules(local: Rule[] | null, localAt: string | null, remote: RuleRow[]): { rules: Rule[] | null; push: boolean } {
  const remoteAt = remote.reduce<string | null>((m, r) => (!m || r.created_at > m ? r.created_at : m), null);
  if (!remote.length) return { rules: local, push: Boolean(local) };
  if (local && localAt && localAt > remoteAt!) return { rules: local, push: true };
  return { rules: remote.map((r) => r.rule), push: false };
}

// ── Sign-in sync ────────────────────────────────────────────────────────
const KEYS = { viz: "sqlp.viz.", project: "sqlp.project.", rules: "sqlp.dq.rules.", rulesAt: "sqlp.dq.rulesAt.", runs: "sqlp.dq.runs." };
const readJson = <T,>(k: string, fallback: T): T => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const writeJson = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
};
const localKeys = (prefix: string) => {
  try { return Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)); } catch { return []; }
};

/** Remove synced DataForge data from this browser (sign-out on a shared machine). */
export function clearLocalData() {
  for (const prefix of Object.values(KEYS)) for (const k of localKeys(prefix)) {
    try { localStorage.removeItem(prefix + k); } catch { /* ignore */ }
  }
}

export async function startDataSync(sb: SupabaseClient, userId: string) {
  const [viz, prog, subs, rules, runs] = await Promise.all([
    sb.from("query_visualization_sessions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1000),
    sb.from("project_progress").select("project_slug, task_id, passed, code, message, updated_at").eq("user_id", userId),
    selectSubmissions(sb, userId),
    sb.from("data_quality_rules").select("dataset, rule, created_at").eq("user_id", userId),
    sb.from("data_quality_runs").select("id, dataset, score, results, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(500),
  ]);
  // A missing table (003 not applied) must not break sign-in: skip that part.
  const pushes: PromiseLike<unknown>[] = [];

  if (!viz.error) {
    const remote = (viz.data ?? []) as VizRow[];
    const remoteIds = new Set(remote.map((r) => r.id));
    const keys = new Set([...localKeys(KEYS.viz), ...remote.map((r) => r.question_key)]);
    const toPush: ReturnType<typeof vizToRow>[] = [];
    for (const k of keys) {
      const local = readJson<VizSession[]>(KEYS.viz + k, []);
      writeJson(KEYS.viz + k, mergeById(local, remote.filter((r) => r.question_key === k).map(rowToViz), 30));
      toPush.push(...local.filter((s) => !remoteIds.has(s.id)).map((s) => vizToRow(k, s)));
    }
    if (toPush.length) pushes.push(sb.from("query_visualization_sessions").insert(toPush.map((r) => ({ ...r, user_id: userId }))));
  }

  if (!prog.error && !subs.error) {
    const rows = (prog.data ?? []) as ProjectRow[];
    const subRows = (subs.data ?? []) as SubmissionRow[];
    const slugs = new Set([...localKeys(KEYS.project), ...rows.map((r) => r.project_slug), ...subRows.map((s) => s.project_slug)]);
    for (const slug of slugs) {
      const local = readJson<ProjectProgress>(KEYS.project + slug, { tasks: {}, checklist: {} });
      const merged = mergeProject(local, rows.filter((r) => r.project_slug === slug), subRows.filter((s) => s.project_slug === slug));
      writeJson(KEYS.project + slug, merged);
      const out = projectToRows(slug, merged);
      if (out.length) pushes.push(sb.from("project_progress").upsert(out.map((r) => ({ ...r, user_id: userId }))));
      const remoteSubAts = new Set(subRows.filter((s) => s.project_slug === slug).map((s) => new Date(s.created_at).getTime()));
      if (local.submission && !remoteSubAts.has(new Date(local.submission.at).getTime())) pushes.push(insertSubmission(sb, userId, slug, merged, local.submission.at));
    }
  }

  if (!rules.error) {
    const remote = (rules.data ?? []) as RuleRow[];
    const datasets = new Set([...localKeys(KEYS.rules), ...remote.map((r) => r.dataset)]);
    for (const d of datasets) {
      const pick = pickRules(readJson<Rule[] | null>(KEYS.rules + d, null), readJson<string | null>(KEYS.rulesAt + d, null), remote.filter((r) => r.dataset === d));
      if (pick.rules) writeJson(KEYS.rules + d, pick.rules);
      if (pick.push && pick.rules) pushes.push(replaceRules(sb, userId, d, pick.rules));
    }
  }

  if (!runs.error) {
    const remote = (runs.data ?? []) as RunRow[];
    const remoteIds = new Set(remote.map((r) => r.id));
    const datasets = new Set([...localKeys(KEYS.runs), ...remote.map((r) => r.dataset)]);
    const toPush: RunRow[] = [];
    for (const d of datasets) {
      const local = readJson<QualityRun[]>(KEYS.runs + d, []);
      const fromRemote = remote.filter((r) => r.dataset === d).map((r): QualityRun => ({ id: r.id, at: r.created_at, dataset: r.dataset, score: r.score, results: r.results }));
      writeJson(KEYS.runs + d, mergeById(local, fromRemote, 20));
      toPush.push(...local.filter((x) => !remoteIds.has(x.id)).map((x) => runToRow(x)));
    }
    if (toPush.length) pushes.push(sb.from("data_quality_runs").insert(toPush.map((r) => ({ ...r, user_id: userId }))));
  }

  await Promise.all(pushes);

  setDataSink({
    viz(key, s) {
      void sb.from("query_visualization_sessions").insert({ ...vizToRow(key, s), user_id: userId });
    },
    project(slug, p, submitted) {
      const out = projectToRows(slug, p);
      if (out.length) void sb.from("project_progress").upsert(out.map((r) => ({ ...r, user_id: userId })));
      if (submitted && p.submission) void insertSubmission(sb, userId, slug, p, p.submission.at);
    },
    rules(d, list) {
      void replaceRules(sb, userId, d, list);
    },
    run(_d, run) {
      void sb.from("data_quality_runs").insert({ ...runToRow(run), user_id: userId });
    },
  });
}

/** Review columns arrive with migration 004; fall back to the 003 columns before it is applied. */
async function selectSubmissions(sb: SupabaseClient, userId: string) {
  const base = "project_slug, repo_url, notes, checklist, created_at";
  const full = await sb.from("project_submissions").select(`${base}, status, review_comment, reviewed_at`).eq("user_id", userId);
  return full.error ? sb.from("project_submissions").select(base).eq("user_id", userId) : full;
}

const runToRow = (x: QualityRun): RunRow => ({
  id: x.id, dataset: x.dataset, score: x.score, created_at: x.at,
  results: x.results.map(({ sample: _s, ...r }) => r) as QualityRun["results"],
});

const insertSubmission = (sb: SupabaseClient, userId: string, slug: string, p: ProjectProgress, at: string) =>
  sb.from("project_submissions").insert({
    user_id: userId, project_slug: slug, repo_url: p.submission?.url ?? null, notes: p.submission?.notes ?? null, checklist: p.checklist, created_at: at,
  });

async function replaceRules(sb: SupabaseClient, userId: string, d: string, list: Rule[]) {
  await sb.from("data_quality_rules").delete().eq("user_id", userId).eq("dataset", d);
  if (list.length) {
    const at = new Date().toISOString();
    await sb.from("data_quality_rules").insert(list.map((rule) => ({ user_id: userId, dataset: d, rule, created_at: at })));
  }
}
