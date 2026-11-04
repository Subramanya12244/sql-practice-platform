import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { accountsEnabled, getSupabase } from "./supabase";
import { clearLocalData, setDataSink, startDataSync } from "./dataSync";
import { looksLikeEmail, mergeProgress, progressToRows, usernameToEmail, type MockRow, type ProgressRow, type RemoteState } from "./account";
import { getProgress, replaceProgress, resetProgress, setProgressSink, type Progress } from "./progress";

export interface Profile {
  id: string;
  username: string;
  role: "user" | "admin";
  must_change_password: boolean;
  /** Added by migration 002; absent before it is applied. */
  public_profile?: boolean;
}

interface AuthState {
  enabled: boolean;
  /** True until the stored session (if any) has been checked. */
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  signIn(login: string, password: string): Promise<void>;
  signUp(username: string, password: string, email?: string): Promise<{ needsConfirm: boolean }>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  changePassword(password: string): Promise<void>;
  audit(action: string, detail?: Record<string, unknown>): void;
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
  qmeta: Object.fromEntries(
    Object.entries(p.questions)
      .filter(([, q]) => q.practiced || q.imported || q.hintLevel || q.errorKinds)
      .map(([k, q]) => [k, { practiced: q.practiced, imported: q.imported, hintLevel: q.hintLevel, assisted: q.assisted, startedAt: q.startedAt, solveSec: q.solveSec, errorKinds: q.errorKinds }]),
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
    void sb.from("audit_log").insert({ user_id: userId, action, detail });
  setProgressSink({
    question(num, q, solvedNow) {
      void sb.from("progress").upsert({
        user_id: userId, question_number: num, attempts: q.attempts,
        solved_at: q.solvedAt ?? null, revealed: Boolean(q.revealed), updated_at: new Date().toISOString(),
        review_box: q.reviewBox ?? null, review_due: q.reviewDue ?? null,
      });
      log(solvedNow ? "solve" : "submit", { question: num, attempts: q.attempts });
    },
    mock(m) {
      void sb.from("mock_sessions").insert({
        user_id: userId, solved: m.solved, total: m.total, used_sec: m.usedSec, duration_min: m.durationMin, created_at: m.date,
      });
      log("mock_finish", { solved: m.solved, total: m.total });
    },
    state(p) {
      void sb.from("profiles").update({ state: remoteState(p) }).eq("id", userId);
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
          return;
        }
        const { data } = await sb.from("profiles").select("*").eq("id", uid).single();
        setProfile((data as Profile) ?? null);
        await startSync(sb, uid).catch(() => undefined);
        await startDataSync(sb, uid).catch(() => undefined);
      };
      const { data } = await sb.auth.getSession();
      await onSession(data.session);
      setReady(true);
      const sub = sb.auth.onAuthStateChange((event, s) => {
        if (event === "SIGNED_IN" && s && s.user.id !== activeUser) {
          void sb.from("audit_log").insert({ user_id: s.user.id, action: "login", detail: { provider: s.user.app_metadata?.provider } });
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
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Wrong username or password." : error.message);
  }, []);

  const signUp = useCallback(async (username: string, password: string, email?: string) => {
    const sb = await getSupabase();
    const { data, error } = await sb.auth.signUp({
      email: email?.trim() || usernameToEmail(username),
      password,
      options: { data: { username: username.trim() }, emailRedirectTo: `${window.location.origin}/account` },
    });
    if (error) throw new Error(error.message);
    return { needsConfirm: !data.session };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/progress` } });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    const sb = await getSupabase();
    if (session) await sb.from("audit_log").insert({ user_id: session.user.id, action: "logout", detail: {} });
    setProgressSink(null);
    setDataSink(null);
    await sb.auth.signOut();
    // Account progress lives on the server; don't leave it in a shared browser.
    resetProgress();
    clearLocalData();
  }, [session]);

  const changePassword = useCallback(async (password: string) => {
    const sb = await getSupabase();
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);
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

  const value = useMemo<AuthState>(
    () => ({ enabled: accountsEnabled, ready, session, profile, signIn, signUp, signInWithGoogle, signOut, changePassword, audit }),
    [ready, session, profile, signIn, signUp, signInWithGoogle, signOut, changePassword, audit],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
