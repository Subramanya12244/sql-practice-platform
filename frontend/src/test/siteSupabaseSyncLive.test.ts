// @vitest-environment node
// LIVE Supabase sync checks. Skipped unless SUPABASE_STAGING_URL and SUPABASE_STAGING_ANON_KEY are set. STAGING ONLY:
//   * it creates one throwaway account per run (a unique address) and CANNOT delete it: the public API has no self-delete
//     (see supabase/migrations/001_accounts.sql: no delete policy on profiles, no delete-account function). Remove the printed
//     user in the dashboard (Auth > Users) or with an admin key from your own shell. Rows it wrote to `progress` are deleted.
//   * it refuses to run against the production project (VITE_SUPABASE_URL, if set, must differ) and refuses a service-role key.
//   * the staging project needs migrations 001-012 applied and email confirmation DISABLED (Auth > Providers > Email > "Confirm
//     email" off), or sign-up returns no session and the live tests stop with that message. A throwaway address cannot confirm mail.
//   Run:  SUPABASE_STAGING_URL=https://<ref>.supabase.co SUPABASE_STAGING_ANON_KEY=<anon key> TZ=UTC npx vitest run src/test/siteSupabaseSyncLive
//
// The two "devices" are two separate client instances with separate in-memory session storage. The sync step mirrors
// startSync() in lib/auth.tsx using the real merge functions (lib/account.ts); auth.tsx itself is exercised against a fake server in
// siteSupabaseSyncApp.test.tsx. The always-on test at the bottom checks that this file's copy of the pushed keys matches auth.tsx.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mergeProgress, progressToRows, usernameToEmail, type MockRow, type ProgressRow, type RemoteState } from "../site/lib/account";
import { mergeStudy, studySec, type StudySession } from "../site/lib/dailyStudy";
import type { Progress } from "../site/lib/progress";

const URL = process.env.SUPABASE_STAGING_URL, KEY = process.env.SUPABASE_STAGING_ANON_KEY;
const configured = Boolean(URL && KEY);
const jwtRole = (k: string) => { try { return (JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString()) as { role?: string }).role; } catch { return undefined; } };
const productionUrl = process.env.VITE_SUPABASE_URL;
const unsafe = configured && (jwtRole(KEY!) === "service_role" || (productionUrl && productionUrl.replace(/\/$/, "") === URL!.replace(/\/$/, "")));
if (!configured) console.warn("[supabase live] SKIPPED: set SUPABASE_STAGING_URL and SUPABASE_STAGING_ANON_KEY (a STAGING project with migrations 001-012 and email confirmation disabled). Nothing in this file has run against a real Supabase project.");

if (unsafe) console.warn("[supabase live] REFUSED: the key is a service-role key, or the URL equals VITE_SUPABASE_URL (production). Use the anon key of a staging project.");

const run = Math.random().toString(36).slice(2, 8);
const username = `dfsync${run}`;
const password = `Pw-${Math.random().toString(36).slice(2, 12)}!A1`;
const email = `${username}@example.com`; // never used for mail: confirmation must be disabled on staging

const memoryStorage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
let net = { offline: false };
const flaky: typeof fetch = (input, init) => (net.offline ? Promise.reject(new TypeError("Failed to fetch")) : fetch(input, init));
const device = (storage = memoryStorage()) => createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage }, global: { fetch: flaky } });

const REMOTE_KEYS = ["activeDays", "cards", "lessons", "bookmarks", "read", "dailyGoal", "dayCounts", "plan", "answers", "portfolio", "reviews", "revision", "revisionMarks", "sessions", "mistakes", "daily"] as const;
const stateOf = (p: Progress): RemoteState => ({ ...Object.fromEntries(REMOTE_KEYS.map((k) => [k, p[k]])), qmeta: {} }) as RemoteState;
const empty = (): Progress => ({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
const study = (id: string, endedAt: string, activeSec: number): StudySession => ({ id, startedAt: new Date(Date.parse(endedAt) - activeSec * 1000).toISOString(), endedAt, activeSec, awaySec: 0 });
const withStudy = (p: Progress, day: string, s: StudySession): Progress => ({ ...p, daily: { ...(p.daily ?? { days: {} }), days: { ...(p.daily?.days ?? {}), [day]: { ...(p.daily?.days[day] ?? {}), study: mergeStudy(p.daily?.days[day]?.study, [s]) } } } });
const ids = (l: { id: string }[] | undefined) => (l ?? []).map((s) => s.id).sort();

/** Pull, merge, push: what lib/auth.tsx startSync does on sign-in. Throws when the network or a policy refuses. */
async function sync(sb: SupabaseClient, uid: string, local: Progress): Promise<Progress> {
  const [rows, prof, mocks] = await Promise.all([
    sb.from("progress").select("question_number, attempts, solved_at, revealed, review_box, review_due").eq("user_id", uid),
    sb.from("profiles").select("state").eq("id", uid).single(),
    sb.from("mock_sessions").select("created_at, solved, total, used_sec, duration_min").eq("user_id", uid),
  ]);
  for (const r of [rows, prof, mocks]) if (r.error) throw new Error(r.error.message);
  const merged = mergeProgress(local, (rows.data ?? []) as ProgressRow[], (prof.data?.state ?? {}) as RemoteState, (mocks.data ?? []) as MockRow[]);
  const up = progressToRows(merged).map((r) => ({ ...r, user_id: uid, updated_at: new Date().toISOString() }));
  const writes = await Promise.all([up.length ? sb.from("progress").upsert(up) : Promise.resolve({ error: null }), sb.from("profiles").update({ state: stateOf(merged) }).eq("id", uid)]);
  for (const w of writes) if (w.error) throw new Error(w.error.message);
  return merged;
}

describe.skipIf(!configured || unsafe)("LIVE Supabase sync (staging)", () => {
  let a: SupabaseClient, b: SupabaseClient, uid = "";
  let signedUp = false;
  const storageA = memoryStorage();

  it("sign-up with a unique throwaway address creates a session and a profile", async () => {
    a = device(storageA);
    const { data, error } = await a.auth.signUp({ email, password, options: { data: { username } } });
    expect(error?.message ?? null).toBeNull();
    if (!data.session) throw new Error("Sign-up returned no session: email confirmation is enabled on this project. Disable 'Confirm email' on the STAGING project (a throwaway address cannot confirm), then rerun.");
    signedUp = true;
    uid = data.user!.id;
    const { data: prof, error: pe } = await a.from("profiles").select("id, username, state").eq("id", uid).single();
    expect(pe?.message ?? null).toBeNull();
    expect(String(prof?.username).toLowerCase()).toBe(username);
  }, 60_000);

  it("sign-out and sign-in with the password work; a new client on the same storage restores the session", async () => {
    if (!signedUp) return;
    await a.auth.signOut();
    expect((await a.auth.getSession()).data.session).toBeNull();
    const login = await a.auth.signInWithPassword({ email, password });
    expect(login.error?.message ?? null).toBeNull();
    const restored = device(storageA);
    const { data } = await restored.auth.getSession();
    expect(data.session?.user.id).toBe(uid);
  }, 60_000);

  it("a username maps to the same synthetic address the app signs in with", () => {
    expect(usernameToEmail("Alice")).toBe("alice@users.sqlpractice.local");
  });

  it("study time and progress round-trip: device A pushes, a fresh device B pulls the same union", async () => {
    if (!signedUp) return;
    let localA = withStudy({ ...empty(), questions: { 1: { attempts: 2, solvedAt: "2026-11-10T10:00:00Z", practiced: true } }, activeDays: ["2026-11-10"] }, "d001", study("live-a1", "2026-11-10T10:00:00.000Z", 600));
    localA = await sync(a, uid, localA);
    b = device();
    const li = await b.auth.signInWithPassword({ email, password });
    expect(li.error?.message ?? null).toBeNull();
    const localB = await sync(b, uid, empty());
    expect(ids(localB.daily?.days.d001?.study)).toEqual(["live-a1"]);
    expect(studySec(localB.daily!.days.d001)).toBe(600);
    expect(localB.questions[1].attempts).toBe(2);
    expect(localB.questions[1].solvedAt).toBe("2026-11-10T10:00:00Z");
  }, 90_000);

  it("two clients edit offline, both push, both pull: both end with everything, no duplicate session ids", async () => {
    if (!signedUp) return;
    let A = await sync(a, uid, empty());
    let B = await sync(b, uid, empty());
    A = withStudy(A, "d001", study("live-a2", "2026-11-11T09:00:00.000Z", 300));
    A = { ...A, activeDays: [...new Set([...A.activeDays, "2026-11-11"])] };
    B = withStudy(B, "d001", study("live-b1", "2026-11-12T09:00:00.000Z", 450));
    B = withStudy(B, "d002", study("live-b2", "2026-11-12T10:00:00.000Z", 200));
    A = await sync(a, uid, A);
    B = await sync(b, uid, B);
    A = await sync(a, uid, A);
    for (const dev of [A, B, await sync(b, uid, B)]) {
      expect(ids(dev.daily!.days.d001.study)).toEqual(["live-a1", "live-a2", "live-b1"]);
      expect(ids(dev.daily!.days.d002.study)).toEqual(["live-b2"]);
    }
    // Idempotent on the server: another sign-in changes nothing.
    const again = await sync(a, uid, A);
    expect(again.daily).toEqual(A.daily);
    // The row the account stores matches.
    const { data } = await a.from("profiles").select("state").eq("id", uid).single();
    expect(ids((data!.state as RemoteState).daily!.days.d001.study)).toEqual(["live-a1", "live-a2", "live-b1"]);
  }, 120_000);

  it("offline then reconnect: a push that fails while offline is retried by the next sign-in and nothing is lost", async () => {
    if (!signedUp) return;
    let A = await sync(a, uid, empty());
    A = withStudy(A, "d003", study("live-off", "2026-11-13T09:00:00.000Z", 120));
    net.offline = true;
    await expect(sync(a, uid, A)).rejects.toThrow(); // the app keeps A in localStorage; the push did not happen
    net.offline = false;
    const { data: before } = await b.from("profiles").select("state").eq("id", uid).single();
    expect((before!.state as RemoteState).daily!.days.d003).toBeUndefined();
    A = await sync(a, uid, A); // reconnect
    const B = await sync(b, uid, empty());
    expect(ids(B.daily!.days.d003.study)).toEqual(["live-off"]);
  }, 90_000);

  afterAll(async () => {
    if (!signedUp) return;
    try {
      net.offline = false;
      await a.from("progress").delete().eq("user_id", uid);
      await a.from("profiles").update({ state: {} }).eq("id", uid);
      await a.auth.signOut();
      await b?.auth.signOut();
    } finally {
      console.warn(`[supabase live] The throwaway account ${email} (username ${username}, id ${uid}) CANNOT be deleted with the public API. Delete it in the staging dashboard (Auth > Users) or with an admin key.`);
    }
  }, 60_000);
});

describe("live-test hygiene (always runs)", () => {
  it("this file's list of pushed state keys matches remoteState() in lib/auth.tsx", () => {
    const src = readFileSync(path.resolve(__dirname, "../site/lib/auth.tsx"), "utf8");
    const body = src.slice(src.indexOf("const remoteState"), src.indexOf("/** Pull account progress"));
    for (const k of REMOTE_KEYS) expect(body, `auth.tsx remoteState has ${k}`).toMatch(new RegExp(`\\b${k}\\b`));
    const listed = new Set<string>(REMOTE_KEYS);
    const pushed = [...body.matchAll(/\b(\w+): p\.\1\b/g)].map((m) => m[1]);
    for (const k of pushed) expect(listed.has(k), `auth.tsx pushes "${k}" but the live test's key list lacks it`).toBe(true);
  });
  it("refuses a service-role key and the production project", () => {
    const role = (r: string) => jwtRole(`x.${Buffer.from(JSON.stringify({ role: r })).toString("base64url")}.y`);
    expect(role("service_role")).toBe("service_role");
    expect(role("anon")).toBe("anon");
  });
  it("states why it is skipped when no staging project is configured", () => {
    if (configured) return;
    expect(URL ?? "").toBe("");
  });
});
