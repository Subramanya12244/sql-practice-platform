import { getSupabase, send } from "./supabase";

export interface CommentRow {
  id: number;
  username: string;
  body: string;
  created_at: string;
  mine: boolean;
  hidden: boolean;
}

export interface SolutionRow {
  id: number;
  username: string;
  sql: string;
  note: string | null;
  created_at: string;
  likes: number;
  liked: boolean;
  mine: boolean;
}

export interface LeaderRow {
  username: string;
  solved: number;
  last_solve?: string;
  finished_at?: string;
}

export interface PublicProfile {
  username: string;
  joined: string;
  solved: number;
  solvedNumbers: number[];
  activeDays: string[];
  solutions: number;
  /** From migration 005: portfolio name/headline and reviewer-approved projects. */
  name?: string | null;
  headline?: string | null;
  projects?: { slug: string; repo: string | null; approved_at: string }[];
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const mustOk = ({ error }: { error: { message: string } | null }) => {
  if (error) throw new Error(error.message.includes("row-level security") ? "Not allowed (solve the question first, or slow down)." : error.message);
};

export const listComments = (q: number) => rpc<CommentRow[]>("question_comments", { q });
export const listSolutions = (q: number) => rpc<SolutionRow[]>("question_solutions", { q });
export const leaderboard = (period: "week" | "month" | "all") => rpc<LeaderRow[]>("leaderboard", { period });
export const challengeRanking = () => rpc<LeaderRow[]>("challenge_ranking");
export const publicProfile = (u: string) => rpc<PublicProfile | null>("public_profile", { u });

export async function addComment(userId: string, q: number, body: string) {
  const sb = await getSupabase();
  mustOk(await sb.from("comments").insert({ user_id: userId, question_number: q, body: body.trim() }));
  send(sb.from("audit_log").insert({ user_id: userId, action: "comment", detail: { question: q } }));
}

export async function deleteComment(id: number) {
  const sb = await getSupabase();
  mustOk(await sb.from("comments").delete().eq("id", id));
}

/** Admin only (RLS + trigger enforce it); the trigger writes the audit entry. */
export async function setHidden(table: "comments" | "solutions", id: number, hidden: boolean) {
  const sb = await getSupabase();
  mustOk(await sb.from(table).update({ hidden }).eq("id", id));
}

export async function shareSolution(userId: string, q: number, sql: string, note: string) {
  const sb = await getSupabase();
  mustOk(await sb.from("solutions").upsert({ user_id: userId, question_number: q, sql, note: note.trim() || null }, { onConflict: "user_id,question_number" }));
  send(sb.from("audit_log").insert({ user_id: userId, action: "solution_share", detail: { question: q } }));
}

export async function toggleLike(userId: string, solutionId: number, liked: boolean) {
  const sb = await getSupabase();
  mustOk(
    liked
      ? await sb.from("solution_likes").delete().eq("solution_id", solutionId).eq("user_id", userId)
      : await sb.from("solution_likes").insert({ solution_id: solutionId, user_id: userId }),
  );
}

export async function currentChallenge(): Promise<number[]> {
  const sb = await getSupabase();
  const { data } = await sb.from("weekly_challenges").select("question_numbers").order("week", { ascending: false }).limit(1);
  return (data?.[0]?.question_numbers as number[] | undefined) ?? [];
}

export async function setChallenge(week: string, numbers: number[]) {
  const sb = await getSupabase();
  mustOk(await sb.from("weekly_challenges").upsert({ week, question_numbers: numbers }));
}

export async function setPublicProfile(userId: string, value: boolean) {
  const sb = await getSupabase();
  mustOk(await sb.from("profiles").update({ public_profile: value }).eq("id", userId));
}

/** Monday of the current ISO week, as YYYY-MM-DD (UTC). */
export function weekStart(d = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/** Without a configured challenge, pick 3 questions deterministically from the week. */
export function fallbackChallenge(numbers: number[], week: string): number[] {
  let seed = [...week].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pool = [...numbers];
  const out: number[] = [];
  while (out.length < 3 && pool.length) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return out.sort((a, b) => a - b);
}
