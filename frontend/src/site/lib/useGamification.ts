/**
 * One view of XP, level, streaks, achievements and missions, from the right source:
 * - signed in: the account ledger (xp_events / user_achievements, read-only to the client)
 * - anonymous: computeLocal() over this browser's progress
 * Values that depend on today's date or the browser appear after mount (prerender-safe).
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth";
import { useProgress, today } from "./progress";
import { getSupabase } from "./supabase";
import { getProjectProgress, projectStatus } from "./projects";
import { TRACKS } from "./tracks";
import type { Task } from "./tasks";
import {
  ACHIEVEMENTS, computeLocal, currentStreak, earningDays, levelOf, longestStreak, missionProgress, weekStartOf, xpSince,
  type ProjectFacts, type XpEvent,
} from "./gamification";

export const DE_TOPICS: Record<string, string[]> = Object.fromEntries(TRACKS.map((t) => [t.id, t.topics.map((x) => x.slug)]));

export function projectFacts(projectTasks: { slug: string; tasks: Task[] }[] | undefined): ProjectFacts[] {
  return (projectTasks ?? []).map((p) => {
    const pr = getProjectProgress(p.slug);
    const auto = p.tasks.filter((t) => t.type !== "checklist");
    const passedTasks = auto.filter((t) => pr.tasks[t.id]?.passed).map((t) => ({ id: t.id, at: pr.tasks[t.id].at }));
    return { slug: p.slug, completed: projectStatus({ tasks: p.tasks }, pr) === "Completed", completedAt: pr.submission?.review?.at, passedTasks };
  });
}

interface Remote { events: XpEvent[]; unlocked: Record<string, string>; total: number; week: number; month: number; weekRank: number | null; public: boolean }

async function loadRemote(): Promise<Remote> {
  const sb = await getSupabase();
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const [ev, ach, me] = await Promise.all([
    sb.from("xp_events").select("source_key, kind, xp, created_at").gte("created_at", since).order("created_at"),
    sb.from("user_achievements").select("achievement_id, unlocked_at"),
    sb.rpc("my_xp"),
  ]);
  if (ev.error || ach.error || me.error) throw new Error((ev.error ?? ach.error ?? me.error)!.message);
  const m = (me.data ?? {}) as { total?: number; week?: number; month?: number; weekRank?: number | null; public?: boolean };
  return {
    events: ((ev.data ?? []) as { source_key: string; kind: XpEvent["kind"]; xp: number; created_at: string }[]).map((e) => ({ key: e.source_key, kind: e.kind, xp: e.xp, at: e.created_at })),
    unlocked: Object.fromEntries(((ach.data ?? []) as { achievement_id: string; unlocked_at: string }[]).map((a) => [a.achievement_id, a.unlocked_at])),
    total: m.total ?? 0, week: m.week ?? 0, month: m.month ?? 0, weekRank: m.weekRank ?? null, public: Boolean(m.public),
  };
}

export function useGamification(projectTasks?: { slug: string; tasks: Task[] }[]) {
  const progress = useProgress();
  const { enabled, session } = useAuth();
  const [day, setDay] = useState<string | null>(null);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  useEffect(() => setDay(today()), []);
  const signedIn = Boolean(enabled && session);

  useEffect(() => {
    if (!signedIn) return setRemote(null);
    let live = true;
    const run = () => loadRemote().then((r) => live && (setRemote(r), setRemoteError(null))).catch((e: Error) => live && setRemoteError(e.message));
    void run();
    // The server awards XP from synced rows; refresh shortly after local changes reach it.
    const t = setTimeout(run, 2500);
    return () => { live = false; clearTimeout(t); };
  }, [signedIn, progress]);

  return useMemo(() => {
    const mounted = day !== null;
    const d = day ?? "2000-01-01";
    const local = computeLocal(progress, { projects: mounted ? projectFacts(projectTasks) : [], deTopics: DE_TOPICS });
    const source: "account" | "browser" = remote ? "account" : "browser";
    const events = remote ? remote.events : local.events;
    const total = remote ? remote.total : local.xp;
    const days = earningDays(events);
    const achievements = remote
      ? ACHIEVEMENTS.map((a) => {
        const l = local.achievements.find((x) => x.id === a.id)!;
        return { ...a, value: l.value, unlocked: Boolean(remote.unlocked[a.id]), unlockedAt: remote.unlocked[a.id] ?? null };
      })
      : local.achievements;
    const weekStart = weekStartOf(d);
    const monthStart = `${d.slice(0, 7)}-01`;
    return {
      mounted, source, remoteError,
      xp: total,
      level: levelOf(total),
      weekXp: remote ? remote.week : xpSince(events, weekStart),
      monthXp: remote ? remote.month : xpSince(events, monthStart),
      weekRank: remote?.weekRank ?? null,
      isPublic: remote?.public ?? false,
      streak: currentStreak(days, d),
      longest: longestStreak(days),
      days,
      activeToday: days.includes(d),
      missions: missionProgress(events, d),
      achievements,
      recent: [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12),
      today: d,
    };
  }, [progress, projectTasks, remote, remoteError, day]);
}
