import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { accountsEnabled, getSupabase, send } from "./supabase";
import { clearLocalData, setDataSink, startDataSync } from "./dataSync";
import { clearActivity, flush as flushActivity, setActivitySink, track, type ActivitySink } from "./activity";
import { looksLikeEmail, mergeProgress, progressToRows, usernameToEmail, type MockRow, type ProgressRow, type RemoteState } from "./account";
import { getProgress, replaceProgress, resetProgress, setProgressSink, type Progress } from "./progress";

export interface Profile {
  id: string;
  username: string;
  role: "user" | "admin";
  must_change_password: boolean;
  /** Added by migration 002; absent before it is applied. */
  public_profile?: boolean;
  created_at?: string;
}

interface AuthState {
  enabled: boolean;
  /** True until the stored session (if any) has been checked. */
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  signIn(login: string, password: string): Promise<void>;
  signUp(username: string, password: string, email?: string): Promise<{ needsConfirm: boolean }>;
  /** Emails a reset link; only works for accounts that signed up with a real email. */
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  changePassword(password: string): Promise<void>;
  audit(action: string, detail?: Record<string, unknown>): void;
  /** Re-read the profile row after the user changes it (e.g. public profile). */
  refreshProfile(): Promise<void>;
}

/** Supabase Auth messages, reworded for people. Unknown messages pass through unchanged. */
export function friendlyAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong username or password.";
  if (m.includes("user already registered") || m.includes("already been registered")) return "That username or email is already taken.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("should be different")) return "Choose a password different from your current one.";
  if (m.includes("password should be at least")) return "Use at least 8 characters.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Can't reach the server. Check your connection and try again.";
  return msg;
}

/** Delivers queued activity to the account. Duplicate ids and minutes are ignored by the database. */
function activitySink(sb: SupabaseClient, userId: string): ActivitySink {
  return {
    async send(events, minutes, session) {
      const results = await Promise.all([
        events.length ? sb.from("learning_events").upsert(events.map((e) => ({ id: e.id, user_id: userId, type: e.type, ref: e.ref ?? null, meta: e.meta ?? {}, session_id: e.session || null, at: e.at })), { onConflict: "id", ignoreDuplicates: true }) : null,
        minutes.length ? sb.from("active_minutes").upsert(minutes.map((m) => ({ user_id: userId, minute: m })), { onConflict: "user_id,minute", ignoreDuplicates: true }) : null,
        session.id ? sb.from("learning_sessions").upsert({ id: session.id, user_id: userId, started_at: session.started, last_activity_at: session.last }, { onConflict: "id" }) : null,
      ]);
      // A missing table (migration 007 not applied) or a policy refusal keeps the queue for later.
      return results.every((r) => !r || !r.error);
    },
  };
}

const AuthCtx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

const remoteState = (p: Progress): RemoteState => ({
  activeDays: p.activeDays, cards: p.cards, lessons: p.lessons,
  bookmarks: p.bookmarks, read: p.read, dailyGoal: p.dailyGoal, dayCounts: p.dayCounts,
  plan: p.plan, answers: p.answers, portfolio: p.portfolio, reviews: p.reviews, revision: p.revision, revisionMarks: p.revisionMarks,
  qmeta: Object.fromEntries(
    Object.entries(p.questions)
      .filter(([, q]) => q.practiced || q.imported || q.hintLevel || q.errorKinds || q.lastSql)
      .map(([k, q]) => [k, { practiced: q.practiced, imported: q.imported, hintLevel: q.hintLevel, assisted: q.assisted, startedAt: q.startedAt, solveSec: q.solveSec, errorKinds: q.errorKinds,
        // The saved query, so it survives sign-out and appears on other devices (capped for the profile row size).
        lastSql: q.lastSql ? q.lastSql.slice(0, 8000) : undefined }]),
  ),
});

/** Pull account progress, merge with this browser, push the union back, then mirror changes live. */
async function startSync(sb: SupabaseClient, userId: string) {
  const [rows, prof, mocks] = await Promise.all([
    sb.from("progress").select("question_number, attempts, solved_at, revealed, review_box, review_due").eq("user_id", userId),
    sb.from("profiles").select("state").eq("id", userId).single(),
    sb.from("mock_sessions").select("created_at, solved, total, used_sec, duration_min").eq("user_id", userId),
  ]);
  const merged = mergeProgress(
    getProgress(),
    (rows.data ?? []) as ProgressRow[],
    (prof.data?.state ?? {}) as RemoteState,
    (mocks.data ?? []) as MockRow[],
  );
  replaceProgress(merged);

  const remoteMockDates = new Set((mocks.data ?? []).map((m) => (m as MockRow).created_at.slice(0, 16)));
  const newMocks = (merged.mocks ?? []).filter((m) => !remoteMockDates.has(m.date.slice(0, 16)));
  await Promise.all([
    sb.from("progress").upsert(progressToRows(merged).map((r) => ({ ...r, user_id: userId, updated_at: new Date().toISOString() }))),
    sb.from("profiles").update({ state: remoteState(merged) }).eq("id", userId),
    newMocks.length
      ? sb.from("mock_sessions").insert(newMocks.map((m) => ({
          user_id: userId, solved: m.solved, total: m.total, used_sec: m.usedSec, duration_min: m.durationMin, created_at: m.date,
        })))
      : null,
    sb.rpc("touch_last_seen"),
  ]);

  const log = (action: string, detail: Record<string, unknown>) =>
    send(sb.from("audit_log").insert({ user_id: userId, action, detail }));
  setProgressSink({
    question(num, q, solvedNow) {
      send(sb.from("progress").upsert({
        user_id: userId, question_number: num, attempts: q.attempts,
        solved_at: q.solvedAt ?? null, revealed: Boolean(q.revealed), updated_at: new Date().toISOString(),
        review_box: q.reviewBox ?? null, review_due: q.reviewDue ?? null,
      }));
      log(solvedNow ? "solve" : "submit", { question: num, attempts: q.attempts });
    },
    mock(m) {
      send(sb.from("mock_sessions").insert({
        user_id: userId, solved: m.solved, total: m.total, used_sec: m.usedSec, duration_min: m.durationMin, created_at: m.date,
      }));
      log("mock_finish", { solved: m.solved, total: m.total });
    },
    state(p) {
      send(sb.from("profiles").update({ state: remoteState(p) }).eq("id", userId));
    },
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!accountsEnabled);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!accountsEnabled) return;
    let unsub: (() => void) | undefined;
    let activeUser: string | null = null;
    getSupabase().then(async (sb) => {
      const onSession = async (s: Session | null) => {
        setSession(s);
        const uid = s?.user.id ?? null;
        if (uid === activeUser) return;
        activeUser = uid;
        if (!uid) {
          setProfile(null);
          setProgressSink(null);
          setDataSink(null);
          setActivitySink(null);
          return;
        }
        const { data } = await sb.from("profiles").select("*").eq("id", uid).single();
        setProfile((data as Profile) ?? null);
        await startSync(sb, uid).catch(() => undefined);
        await startDataSync(sb, uid).catch(() => undefined);
        setActivitySink(activitySink(sb, uid));
      };
      const { data } = await sb.auth.getSession();
      await onSession(data.session);
      setReady(true);
      const sub = sb.auth.onAuthStateChange((event, s) => {
        if (event === "SIGNED_IN" && s && s.user.id !== activeUser) {
          send(sb.from("audit_log").insert({ user_id: s.user.id, action: "login", detail: { provider: s.user.app_metadata?.provider } }));
          track("login");
        }
        void onSession(s);
      });
      unsub = () => sub.data.subscription.unsubscribe();
    }).catch(() => setReady(true));
    return () => unsub?.();
  }, []);

  const signIn = useCallback(async (login: string, password: string) => {
    const sb = await getSupabase();
    let email = login.trim();
    if (!looksLikeEmail(email)) {
      const { data } = await sb.rpc("email_for_username", { u: email });
      email = (data as string | null) ?? usernameToEmail(email);
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyAuthError(error.message));
  }, []);

  const signUp = useCallback(async (username: string, password: string, email?: string) => {
    const sb = await getSupabase();
    const { data, error } = await sb.auth.signUp({
      email: email?.trim() || usernameToEmail(username),
      password,
      options: { data: { username: username.trim() }, emailRedirectTo: `${window.location.origin}/account` },
    });
    if (error) throw new Error(friendlyAuthError(error.message));
    return { needsConfirm: !data.session };
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const sb = await getSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/account?reset=1` });
    if (error) throw new Error(friendlyAuthError(error.message));
  }, []);

  const signOut = useCallback(async () => {
    const sb = await getSupabase();
    if (session) await sb.from("audit_log").insert({ user_id: session.user.id, action: "logout", detail: {} });
    setProgressSink(null);
    setDataSink(null);
    await flushActivity();
    setActivitySink(null);
    await sb.auth.signOut();
    // Account progress lives on the server; don't leave it in a shared browser.
    resetProgress();
    clearLocalData();
    clearActivity();
  }, [session]);

  const changePassword = useCallback(async (password: string) => {
    const sb = await getSupabase();
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(friendlyAuthError(error.message));
    if (session) {
      await sb.from("profiles").update({ must_change_password: false }).eq("id", session.user.id);
      await sb.from("audit_log").insert({ user_id: session.user.id, action: "password_change", detail: {} });
      setProfile((p) => (p ? { ...p, must_change_password: false } : p));
    }
  }, [session]);

  const audit = useCallback((action: string, detail: Record<string, unknown> = {}) => {
    if (!session) return;
    void getSupabase().then((sb) => sb.from("audit_log").insert({ user_id: session.user.id, action, detail }));
  }, [session]);

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    const sb = await getSupabase();
    const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
    if (data) setProfile(data as Profile);
  }, [session]);

  const value = useMemo<AuthState>(
    () => ({ enabled: accountsEnabled, ready, session, profile, signIn, signUp, resetPassword, signOut, changePassword, audit, refreshProfile }),
    [ready, session, profile, signIn, signUp, resetPassword, signOut, changePassword, audit, refreshProfile],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
