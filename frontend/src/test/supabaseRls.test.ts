// @vitest-environment node
// Applies supabase/migrations 001–004 in order on PGlite (real PostgreSQL) with the auth stub, then
// checks RLS as two learners and an admin: isolation, checklist rows, the submission lifecycle.
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";
import stub from "../../../supabase/tests/auth_stub.sql?raw";
import m001 from "../../../supabase/migrations/001_accounts.sql?raw";
import m002 from "../../../supabase/migrations/002_community.sql?raw";
import m003 from "../../../supabase/migrations/003_dataforge.sql?raw";
import m004 from "../../../supabase/migrations/004_submission_review.sql?raw";
import m005 from "../../../supabase/migrations/005_public_portfolio.sql?raw";
import m006 from "../../../supabase/migrations/006_gamification.sql?raw";
import m007 from "../../../supabase/migrations/007_activity_tracking.sql?raw";
import m008 from "../../../supabase/migrations/008_admin_analytics.sql?raw";
import m009 from "../../../supabase/migrations/009_study_notes.sql?raw";
import m010 from "../../../supabase/migrations/010_content_management.sql?raw";
import m011 from "../../../supabase/migrations/011_assessments.sql?raw";
import m012 from "../../../supabase/migrations/012_admin_insights.sql?raw";

/** Minimal stand-in for Supabase Storage (bucket + object tables and storage.foldername). */
const STORAGE_STUB = `
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid default auth.uid());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, delete on storage.objects to authenticated;
  grant select on storage.objects to anon;
`;
import { ACHIEVEMENTS, MISSIONS, XP } from "../site/lib/gamification";
import registry from "../site/content/tracks.json";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const ADMIN = "00000000-0000-0000-0000-0000000000ad";

let pg: PGlite;

/** Run statements as `authenticated` with the given user id (null = anon). Always resets afterwards. */
async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await pg.exec(`set role ${user ? "authenticated" : "anon"}; select set_config('request.jwt.sub', '${user ?? ""}', false);`);
  try {
    return (await pg.query<T>(sql, params)).rows;
  } finally {
    await pg.exec("reset role;");
  }
}
const fails = (p: Promise<unknown>) => expect(p).rejects.toThrow();

beforeAll(async () => {
  pg = new PGlite({ extensions: { citext, pgcrypto } });
  for (const m of [stub, m001, m002, m003, m004, m005, m006, m007, m008, STORAGE_STUB, m009, m010, m011, m012]) await pg.exec(m);
  // Re-applying must be safe (no data loss, no errors).
  await pg.exec(m003);
  await pg.exec(m004);
  await pg.exec(m008); // re-runnable, and restores the full audit action list
  await pg.exec(m009);
  await pg.exec(m010);
  await pg.exec(m011);
  await pg.exec(`
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant select on all tables in schema public to anon;
    grant usage on all sequences in schema public to authenticated;
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${A}', 'a@x.test', '{"username":"learner_a"}'), ('${B}', 'b@x.test', '{"username":"learner_b"}'), ('${ADMIN}', 'ad@x.test', '{"username":"boss"}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
  `);
}, 60_000);

describe("migrations", () => {
  it("apply in order and create the review objects", async () => {
    const t = await pg.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by 1");
    const names = t.rows.map((r) => r.table_name);
    for (const n of ["profiles", "progress", "project_progress", "project_submissions", "submission_reviews", "data_quality_runs"]) expect(names).toContain(n);
  });
});

describe("checklist rows", () => {
  it("upsert in place and can never count as passed", async () => {
    const up = (v: string) => as(A, `insert into project_progress (user_id, project_slug, task_id, passed, code) values (auth.uid(), 'p1', 'checklist:review', false, $1)
      on conflict (user_id, project_slug, task_id) do update set code = excluded.code`, [v]);
    await up("[true,false]");
    await up("[true,true]");
    const rows = await as<{ code: string }>(A, "select code from project_progress where task_id = 'checklist:review'");
    expect(rows).toEqual([{ code: "[true,true]" }]);
    await fails(as(A, "insert into project_progress (user_id, project_slug, task_id, passed) values (auth.uid(), 'p1', 'checklist:x', true)"));
    await as(A, "insert into project_progress (user_id, project_slug, task_id, passed) values (auth.uid(), 'p1', 'load', true)");
    const passed = await as<{ n: number }>(A, "select count(*)::int as n from project_progress where passed");
    expect(passed[0].n).toBe(1);
  });
});

describe("user isolation", () => {
  it("hides one learner's rows from another and from anon", async () => {
    await as(A, "insert into query_visualization_sessions (user_id, question_key, executed_sql) values (auth.uid(), 'q25', 'select 1')");
    await as(A, "insert into data_quality_runs (user_id, dataset, results) values (auth.uid(), 'northwind', '[]')");
    for (const t of ["project_progress", "query_visualization_sessions", "data_quality_runs", "progress"]) {
      expect(await as(B, `select * from ${t}`)).toEqual([]);
      expect(await as(null, `select * from ${t}`)).toEqual([]);
    }
  });
  it("blocks writing rows for someone else", async () => {
    await fails(as(B, `insert into project_progress (user_id, project_slug, task_id, passed) values ('${A}', 'p1', 'load', true)`));
    await fails(as(B, `insert into project_submissions (user_id, project_slug) values ('${A}', 'p1')`));
    expect(await as(B, `update project_progress set passed = false where user_id = '${A}' returning 1`)).toEqual([]);
    expect(await as(B, `delete from project_progress where user_id = '${A}' returning 1`)).toEqual([]);
  });
});

describe("submission lifecycle", () => {
  let id: number;
  it("a learner submission always starts as Submitted, unreviewed", async () => {
    const [row] = await as<{ id: number; status: string; reviewed_by: string | null }>(A,
      `insert into project_submissions (user_id, project_slug, repo_url, checklist, status, reviewed_by, reviewed_at)
       values (auth.uid(), 'p1', 'https://github.com/a/repo', '{"review":[true,true]}', 'Submitted', null, now()) returning id, status, reviewed_by, reviewed_at`);
    id = row.id;
    expect(row).toMatchObject({ status: "Submitted", reviewed_by: null, reviewed_at: null });
    const [forced] = await as<{ id: number; status: string }>(A, "insert into project_submissions (user_id, project_slug, status) values (auth.uid(), 'p2', 'Completed') returning id, status");
    expect(forced.status).toBe("Submitted");
  });
  it("learners cannot review, even their own; other learners cannot see it", async () => {
    expect(await as(A, `update project_submissions set status = 'Completed' where id = ${id} returning 1`)).toEqual([]);
    expect(await as(B, "select * from project_submissions")).toEqual([]);
    expect(await as(B, `update project_submissions set status = 'Rejected' where id = ${id} returning 1`)).toEqual([]);
  });
  it("an admin review is stamped by the database and kept in history", async () => {
    await as(ADMIN, `update project_submissions set status = 'Changes requested', review_comment = 'Add tests', reviewed_by = '${A}' where id = ${id}`);
    await as(ADMIN, `update project_submissions set status = 'Completed', review_comment = 'Looks good' where id = ${id}`);
    const [s] = await as<{ status: string; reviewed_by: string; reviewed_at: string | null }>(ADMIN, `select status, reviewed_by, reviewed_at from project_submissions where id = ${id}`);
    expect(s.status).toBe("Completed");
    expect(s.reviewed_by).toBe(ADMIN);
    expect(s.reviewed_at).not.toBeNull();
    const hist = await as<{ from_status: string; to_status: string; reviewer_id: string }>(ADMIN, `select from_status, to_status, reviewer_id from submission_reviews where submission_id = ${id} order by id`);
    expect(hist).toEqual([
      { from_status: "Submitted", to_status: "Changes requested", reviewer_id: ADMIN },
      { from_status: "Changes requested", to_status: "Completed", reviewer_id: ADMIN },
    ]);
    const audit = await as<{ n: number }>(ADMIN, "select count(*)::int as n from audit_log where action = 'submission_review'");
    expect(audit[0].n).toBe(2);
  });
  it("admins cannot alter what the learner submitted, and nobody writes history directly", async () => {
    await fails(as(ADMIN, `update project_submissions set repo_url = 'https://github.com/x/y' where id = ${id}`));
    await fails(as(A, `insert into submission_reviews (submission_id, to_status) values (${id}, 'Completed')`));
    await fails(as(ADMIN, `insert into submission_reviews (submission_id, to_status) values (${id}, 'Completed')`));
  });
  it("the submitter sees their reviews; others do not", async () => {
    expect((await as(A, `select * from submission_reviews where submission_id = ${id}`)).length).toBe(2);
    expect(await as(B, "select * from submission_reviews")).toEqual([]);
    expect(await as(null, "select * from submission_reviews")).toEqual([]);
  });
  it("Rejected is a valid status", async () => {
    await as(ADMIN, `update project_submissions set status = 'Rejected' where id = ${id}`);
    expect((await as<{ status: string }>(A, `select status from project_submissions where id = ${id}`))[0].status).toBe("Rejected");
  });
});

describe("public portfolio (005)", () => {
  type Pub = { projects: { slug: string; repo: string }[]; name: string | null } | null;
  const pub = async (who: string | null) => (await as<{ p: Pub }>(who, "select public_profile('learner_a') as p"))[0].p;
  it("is hidden until the learner opts in", async () => {
    expect(await pub(null)).toBeNull();
    expect(await pub(B)).toBeNull();
  });
  it("lists only reviewer-approved projects, without notes or emails", async () => {
    await as(A, "update profiles set public_profile = true, state = state || '{\"portfolio\":{\"name\":\"Learner A\",\"headline\":\"x\"}}' where id = auth.uid()");
    const [{ id }] = await as<{ id: number }>(A, "insert into project_submissions (user_id, project_slug, repo_url, notes) values (auth.uid(), 'p3', 'https://github.com/a/p3', 'secret notes') returning id");
    let p = await pub(null);
    expect(p?.projects.map((x) => x.slug)).not.toContain("p3");
    await as(ADMIN, `update project_submissions set status = 'Completed' where id = ${id}`);
    p = await pub(null);
    expect(p?.projects).toEqual([expect.objectContaining({ slug: "p3", repo: "https://github.com/a/p3" })]);
    expect(p?.name).toBe("Learner A");
    expect(JSON.stringify(p)).not.toMatch(/secret notes|@x\.test/);
    await as(A, "update profiles set public_profile = false where id = auth.uid()");
    expect(await pub(null)).toBeNull();
  });
});

describe("gamification (006)", () => {
  const C = "00000000-0000-0000-0000-00000000000c";
  const D = "00000000-0000-0000-0000-00000000000d";
  const xpOf = async (u: string) => (await pg.query<{ n: number }>(`select coalesce(sum(xp), 0)::int as n from xp_events where user_id = '${u}'`)).rows[0].n;
  const keys = async (u: string) => (await pg.query<{ source_key: string }>(`select source_key from xp_events where user_id = '${u}' order by id`)).rows.map((r) => r.source_key);
  const state = (u: string, st: object) => as(u, `update profiles set state = $1 where id = auth.uid()`, [JSON.stringify(st)]);

  beforeAll(async () => {
    await pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values
      ('${C}', 'c@x.test', '{"username":"gamer_c"}'), ('${D}', 'd@x.test', '{"username":"gamer_d"}')`);
  });

  it("matches the browser rules exactly", async () => {
    const defs = (await pg.query<{ id: string; xp: number; counter: string; target: number }>("select id, xp, counter, target from achievement_definitions order by id")).rows;
    expect(defs).toEqual(ACHIEVEMENTS.map(({ id, xp, counter, target }) => ({ id, xp, counter, target })).sort((a, b) => a.id.localeCompare(b.id)));
    const ms = (await pg.query<{ id: string; period: string; kind: string; target: number; xp: number }>("select id, period, kind, target, xp from mission_definitions order by id")).rows;
    expect(ms).toEqual(MISSIONS.map(({ id, period, kind, target, xp }) => ({ id, period, kind, target, xp })).sort((a, b) => a.id.localeCompare(b.id)));
    const topics = (await pg.query<{ n: number }>("select count(*)::int as n from track_topics")).rows[0].n;
    expect(topics).toBe(registry.tracks.reduce((s, t) => s + t.topics.length, 0));
    expect(XP).toMatchObject({ sql: 20, sqlRevealed: 10, python: 15, lesson: 10, scenario: 15, note: 5, card: 2, cardDailyCap: 20, task: 10, project: 100, mockPassed: 30, mockFinished: 10, track: 50, day: 5 });
  });

  it("clients can't write XP, achievements, or call the award engine", async () => {
    await fails(as(C, "insert into xp_events (user_id, source_key, kind, xp) values (auth.uid(), 'cheat', 'sql', 9999)"));
    await fails(as(C, "insert into user_achievements (user_id, achievement_id, unlocked_at) values (auth.uid(), 'sql-50', now())"));
    await fails(as(C, `select award_xp(auth.uid(), 'cheat2', 'sql', 9999, now())`));
    await fails(as(C, `select gm_state(auth.uid(), '{}'::jsonb, '{}'::jsonb)`));
    await fails(as(null, `select award_xp('${C}', 'cheat3', 'sql', 9999, now())`));
    expect(await xpOf(C)).toBe(0);
  });

  it("awards a practised solve once; imported solves earn nothing", async () => {
    await as(C, "insert into progress (user_id, question_number, attempts, solved_at) values (auth.uid(), 25, 1, '2026-11-05T10:00:00Z'), (auth.uid(), 26, 1, '2026-11-05T10:05:00Z')");
    expect(await xpOf(C)).toBe(0); // no practised flag yet (looks like an import)
    await state(C, { qmeta: { 25: { practiced: true } } });
    expect(await keys(C)).toEqual(["sql:25", "day:2026-11-05", "achievement:first-query"]);
    expect(await xpOf(C)).toBe(20 + 5 + 10);
    // Re-sync, re-solve and re-save change nothing.
    await as(C, "update progress set attempts = 3, solved_at = '2026-11-05T11:00:00Z' where user_id = auth.uid() and question_number = 25");
    await state(C, { qmeta: { 25: { practiced: true } }, dailyGoal: 3 });
    expect(await xpOf(C)).toBe(35);
  });

  it("completes the daily SQL mission and the note mission, each once", async () => {
    await state(C, { qmeta: { 25: { practiced: true }, 26: { practiced: true }, 27: { practiced: true } }, read: { "left-join": "2026-11-05T12:00:00Z" } });
    await as(C, "insert into progress (user_id, question_number, attempts, solved_at) values (auth.uid(), 27, 1, '2026-11-05T12:30:00Z')");
    const k = await keys(C);
    expect(k.filter((x) => x.startsWith("mission:"))).toEqual(["mission:note1:2026-11-05", "mission:sql3:2026-11-05"]);
    expect(k.filter((x) => x === "day:2026-11-05")).toHaveLength(1);
  });

  it("rejects future-dated client timestamps and caps flashcard XP per day", async () => {
    await state(C, { qmeta: {}, lessons: { "py:a": "2099-01-01T00:00:00Z" }, reviews: { "2026-11-05": Array.from({ length: 30 }, (_, i) => `c${i}`) } });
    const py = (await pg.query<{ created_at: Date }>(`select created_at from xp_events where user_id = '${C}' and source_key = 'py:a'`)).rows[0];
    expect(py.created_at.getTime()).toBeLessThanOrEqual(Date.now());
    const cards = (await pg.query<{ n: number }>(`select count(*)::int as n from xp_events where user_id = '${C}' and kind = 'card'`)).rows[0].n;
    expect(cards).toBe(20);
  });

  it("scores mocks and completes projects by checks (no manual steps) or by admin approval", async () => {
    await as(D, "insert into mock_sessions (user_id, solved, total, used_sec, duration_min) values (auth.uid(), 3, 5, 600, 30), (auth.uid(), 1, 5, 600, 30)");
    const mocks = (await pg.query<{ xp: number }>(`select xp from xp_events where user_id = '${D}' and kind = 'mock' order by id`)).rows.map((r) => r.xp);
    expect(mocks).toEqual([30, 10]);
    const tasks = (await pg.query<{ task_id: string }>("select task_id from project_auto_tasks where project_slug = 'data-validation-pipeline'")).rows;
    for (const t of tasks) await as(D, `insert into project_progress (user_id, project_slug, task_id, passed) values (auth.uid(), 'data-validation-pipeline', '${t.task_id}', true)`);
    expect(await keys(D)).toContain("project:data-validation-pipeline");
    expect(await keys(D)).toContain("achievement:first-project");
    // A project with a manual step needs an admin's approval.
    const [{ id }] = await as<{ id: number }>(D, "insert into project_submissions (user_id, project_slug) values (auth.uid(), 'csv-to-postgres-etl') returning id");
    expect(await keys(D)).not.toContain("project:csv-to-postgres-etl");
    await as(ADMIN, `update project_submissions set status = 'Completed' where id = ${id}`);
    expect(await keys(D)).toContain("project:csv-to-postgres-etl");
  });

  it("isolates ledgers and keeps the leaderboard to public profiles, without emails", async () => {
    expect(await as(C, `select * from xp_events where user_id = '${D}'`)).toEqual([]);
    expect(await as(null, "select * from xp_events")).toEqual([]);
    expect(await as(null, "select * from xp_leaderboard('all')")).toEqual([]);
    await pg.exec(`update profiles set public_profile = true where id = '${C}'`);
    const board = await as<{ username: string; xp: number }>(null, "select * from xp_leaderboard('all')");
    expect(board.map((r) => r.username)).toEqual(["gamer_c"]);
    expect(JSON.stringify(board)).not.toMatch(/@x\.test/);
    const [{ me }] = await as<{ me: { total: number; public: boolean; weekRank: number | null } }>(C, "select my_xp() as me");
    expect(me.total).toBe(await xpOf(C));
    expect(me.public).toBe(true);
    const [{ me: d }] = await as<{ me: { public: boolean; weekRank: number | null } }>(D, "select my_xp() as me");
    expect(d).toMatchObject({ public: false, weekRank: null });
  });

  it("re-applying the migration (backfill) awards nothing new", async () => {
    const before = (await pg.query<{ n: number }>("select count(*)::int as n from xp_events")).rows[0].n;
    await pg.exec(m006);
    expect((await pg.query<{ n: number }>("select count(*)::int as n from xp_events")).rows[0].n).toBe(before);
  });
});

describe("activity tracking (007)", () => {
  const E1 = "11111111-1111-4111-8111-111111111111";
  const S1 = "22222222-2222-4222-8222-222222222222";
  const ins = (who: string, id: string, at = "now()") => as(who, `insert into learning_events (id, user_id, type, ref, at) values ('${id}', auth.uid(), 'sql_executed', 'q25', ${at}) on conflict (id) do nothing`);
  it("accepts own events once and ignores a retried batch", async () => {
    await ins(A, E1);
    await ins(A, E1);
    expect((await as<{ n: number }>(A, "select count(*)::int as n from learning_events")).at(0)!.n).toBe(1);
  });
  it("rejects other users' rows and back- or forward-dated events", async () => {
    await fails(as(B, `insert into learning_events (id, user_id, type, at) values (gen_random_uuid(), '${A}', 'login', now())`));
    await fails(ins(A, "33333333-3333-4333-8333-333333333333", "now() + interval '1 hour'"));
    await fails(ins(A, "44444444-4444-4444-8444-444444444444", "now() - interval '8 days'"));
    await fails(as(A, "insert into learning_events (id, user_id, type, at) values (gen_random_uuid(), auth.uid(), 'made_up', now())"));
  });
  it("counts an active minute once across tabs and devices", async () => {
    const m = "date_trunc('minute', now()) - interval '2 minutes'";
    for (let i = 0; i < 3; i++) await as(A, `insert into active_minutes (user_id, minute) values (auth.uid(), ${m}) on conflict do nothing`);
    expect((await as<{ n: number }>(A, "select count(*)::int as n from active_minutes")).at(0)!.n).toBe(1);
    await fails(as(A, "insert into active_minutes (user_id, minute) values (auth.uid(), date_trunc('minute', now()) + interval '30 seconds')"));
  });
  it("keeps session start fixed and last activity moving forward only", async () => {
    await as(A, `insert into learning_sessions (id, user_id, started_at, last_activity_at) values ('${S1}', auth.uid(), now() - interval '20 minutes', now() - interval '5 minutes')`);
    await as(A, `update learning_sessions set last_activity_at = now() - interval '10 minutes' where id = '${S1}'`);
    const [r] = await as<{ ok: boolean }>(A, `select last_activity_at > now() - interval '6 minutes' as ok from learning_sessions where id = '${S1}'`);
    expect(r.ok).toBe(true);
    await fails(as(A, `update learning_sessions set started_at = now() - interval '5 days' where id = '${S1}'`));
    expect(await as(A, "delete from learning_sessions returning 1")).toEqual([]);
    expect(await as(A, "delete from learning_events returning 1")).toEqual([]);
  });
  it("hides learners' activity from each other and anonymous visitors; admins can read it", async () => {
    for (const t of ["learning_events", "active_minutes", "learning_sessions"]) {
      expect(await as(B, `select * from ${t} where user_id = '${A}'`)).toEqual([]);
      expect(await as(null, `select * from ${t}`)).toEqual([]);
      expect((await as(ADMIN, `select * from ${t} where user_id = '${A}'`)).length).toBeGreaterThan(0);
    }
  });
});

describe("admin analytics (008)", () => {
  const day = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const range = `'${from}'::date, '${day}'::date`;
  beforeAll(async () => {
    for (const [passed, ref] of [[false, "q7"], [false, "q7"], [true, "q7"]] as const)
      await as(A, `insert into learning_events (id, user_id, type, ref, meta, at) values (gen_random_uuid(), auth.uid(), 'sql_submitted', '${ref}', '{"passed": ${passed}}', now() - interval '1 hour')`);
    await as(B, `insert into learning_events (id, user_id, type, ref, meta, at) values (gen_random_uuid(), auth.uid(), 'python_submitted', 'py:safe-cast', '{"passed": false, "hidden_failed": true}', now())`);
    await pg.query(`update profiles set state = jsonb_set(state, '{lessons}', jsonb_build_object('py:safe-cast', '${day}', 'py:dedupe-preserve-order', '${day}T10:00:00Z', 'lesson:joins', '${day}')) where id = '${A}'`);
  });
  it("refuses learners and anonymous callers on every RPC", async () => {
    for (const call of [`admin_overview(${range})`, "admin_learners()", `admin_learner_activity('${A}', ${range})`, `admin_problem_stats(${range})`, "admin_audit('admin_export', '{}')"]) {
      await fails(as(A, `select * from ${call}`));
      await fails(as(null, `select * from ${call}`));
    }
    await fails(as(A, "select * from py_completions()"));
  });
  it("counts activity, accuracy and Python completions for admins", async () => {
    const [{ o }] = await as<{ o: Record<string, number> & { trend: unknown[] } }>(ADMIN, `select admin_overview(${range}) as o`);
    expect(o.users).toBeGreaterThanOrEqual(3);
    expect(o.sqlSubmits).toBe(3);
    expect(o.sqlPassed).toBe(1);
    expect(o.pySubmits).toBe(1);
    expect(o.pySolves).toBe(2);
    expect(o.wau).toBeGreaterThanOrEqual(2);
    expect(o.trend).toHaveLength(7);
    await fails(as(ADMIN, "select admin_overview('2026-01-10', '2026-01-01')"));
  });
  it("lists learners with per-learner totals", async () => {
    const rows = await as<{ username: string; sql_submits: number; sql_passed: number; py_solved: number }>(ADMIN, "select * from admin_learners()");
    const a = rows.find((r) => r.username === "learner_a")!;
    expect([Number(a.sql_submits), Number(a.sql_passed), Number(a.py_solved)]).toEqual([3, 1, 2]);
  });
  it("aggregates per-problem results", async () => {
    const rows = await as<{ kind: string; ref: string; submits: number; passed: number; hidden_failed: number }>(ADMIN, `select * from admin_problem_stats(${range}) order by ref`);
    expect(rows.map((r) => [r.kind, r.ref, Number(r.submits), Number(r.passed), Number(r.hidden_failed)])).toEqual([["python", "py:safe-cast", 1, 0, 1], ["sql", "q7", 3, 1, 0]]);
  });
  it("audits learner views and exports; learners can't forge admin audit rows", async () => {
    const [{ r }] = await as<{ r: { days: unknown[]; problems: { ref: string; fails: number }[] } }>(ADMIN, `select admin_learner_activity('${A}', ${range}) as r`);
    expect(r.days).toHaveLength(7);
    expect(r.problems.find((p) => p.ref === "q7")!.fails).toBe(2);
    await as(ADMIN, `select admin_audit('admin_export', '{"report": "learners"}')`);
    await fails(as(ADMIN, "select admin_audit('role_change', '{}')"));
    const actions = await pg.query<{ action: string }>(`select action from audit_log where user_id = '${ADMIN}' and action like 'admin_%' order by id`);
    expect(actions.rows.map((x) => x.action)).toEqual(["admin_view_learner", "admin_export"]);
    await fails(as(A, "insert into audit_log (user_id, action) values (auth.uid(), 'admin_export')"));
  });
});

describe("study notes (009)", () => {
  const N1 = "aaaaaaaa-0000-4000-8000-000000000001";
  const row = (who: string, id: string, path = `${who}/${id}.pdf`) =>
    `insert into study_notes (id, user_id, title, kind, topics, refs, pages, size_bytes, storage_path) values ('${id}', '${who}', 'Joins', 'sql', '{"LEFT JOIN"}', '{q25}', 4, 70000, '${path}')`;
  it("creates a private PDF-only bucket", async () => {
    const [b] = (await pg.query<{ public: boolean; allowed_mime_types: string[] }>("select public, allowed_mime_types from storage.buckets where id = 'study-notes'")).rows;
    expect(b).toEqual({ public: false, allowed_mime_types: ["application/pdf"] });
  });
  it("lets learners keep only their own notes and files", async () => {
    await as(A, row(A, N1));
    await fails(as(B, row(A, "aaaaaaaa-0000-4000-8000-000000000002")));
    await fails(as(A, row(A, "aaaaaaaa-0000-4000-8000-000000000003", `${B}/x.pdf`)));
    await as(A, `insert into storage.objects (bucket_id, name) values ('study-notes', '${A}/${N1}.pdf')`);
    await fails(as(A, `insert into storage.objects (bucket_id, name) values ('study-notes', '${B}/${N1}.pdf')`));
    await fails(as(A, `insert into storage.objects (bucket_id, name) values ('study-notes', '${A}/../evil.pdf')`));
    for (const who of [B, ADMIN, null]) {
      expect(await as(who, "select * from study_notes")).toEqual([]);
      expect(await as(who, "select * from storage.objects where bucket_id = 'study-notes'")).toEqual([]);
    }
    expect(await as(A, "select title from study_notes")).toEqual([{ title: "Joins" }]);
    expect(await as(A, "select name from storage.objects")).toEqual([{ name: `${A}/${N1}.pdf` }]);
  });
  it("can't be edited, and deletes only the owner's rows", async () => {
    expect(await as(A, "update study_notes set title = 'x' returning 1")).toEqual([]);
    expect(await as(B, "delete from study_notes returning 1")).toEqual([]);
    expect(await as(B, "delete from storage.objects returning 1")).toEqual([]);
    expect(await as(A, `delete from study_notes where id = '${N1}' returning 1`)).toHaveLength(1);
    expect(await as(A, "delete from storage.objects returning 1")).toHaveLength(1);
  });
});

describe("content management (010)", () => {
  const Q = `insert into custom_questions (slug, title, difficulty, topic, problem, objective, reference_query) values ('top-shippers', 'Top shippers', 'Easy', 'Aggregations', 'List the shippers by order count.', 'Return shipper and count.', 'SELECT 1')`;
  it("lets only admins override built-in questions; everyone can read overrides", async () => {
    await fails(as(A, "insert into question_overrides (kind, ref, disabled) values ('sql', '25', true)"));
    await as(ADMIN, "insert into question_overrides (kind, ref, disabled, note) values ('sql', '25', true, 'wrong expected output')");
    expect(await as(null, "select kind, ref, disabled from question_overrides")).toEqual([{ kind: "sql", ref: "25", disabled: true }]);
    expect(await as(A, "update question_overrides set disabled = false returning 1")).toEqual([]);
    await as(ADMIN, "update question_overrides set disabled = false, title = 'Customers and orders' where kind = 'sql' and ref = '25'");
    const [o] = await as<{ version: number; updated_by: string }>(ADMIN, "select version, updated_by from question_overrides");
    expect(o).toEqual({ version: 2, updated_by: ADMIN });
  });
  it("keeps every version, admin-only, and audits content edits", async () => {
    const v = await as<{ version: number; disabled: boolean }>(ADMIN, "select version, (data->>'disabled')::boolean as disabled from question_versions where ref = 'sql:25' order by version");
    expect(v).toEqual([{ version: 1, disabled: true }, { version: 2, disabled: false }]);
    expect(await as(A, "select * from question_versions")).toEqual([]);
    const audits = await pg.query<{ n: number }>("select count(*)::int as n from audit_log where action = 'content_edit'");
    expect(audits.rows[0].n).toBe(2);
    await fails(as(A, "insert into audit_log (user_id, action) values (auth.uid(), 'content_edit')"));
  });
  it("hides unpublished custom questions from learners and anonymous visitors", async () => {
    await fails(as(A, Q));
    await as(ADMIN, Q);
    expect(await as(A, "select slug from custom_questions")).toEqual([]);
    expect(await as(null, "select slug from custom_questions")).toEqual([]);
    await as(ADMIN, "update custom_questions set published = true where slug = 'top-shippers'");
    expect(await as(null, "select slug, version from custom_questions")).toEqual([{ slug: "top-shippers", version: 2 }]);
    await fails(as(ADMIN, "insert into custom_questions (slug, title, difficulty, topic, problem, objective, reference_query) values ('Bad Slug!', 'x', 'Easy', 'x', 'x', 'x', 'x')"));
  });
});

describe("assessments (011)", () => {
  type Started = { id: string; deadline: string; items: { id: string; kind: string; problem: string; cases?: string[]; answer?: unknown; reference?: unknown }[] };
  const start = async (who: string, kind = "sql", n = 3) => (await as<{ r: Started }>(who, `select start_assessment('${kind}', null, null, ${n}, 30) as r`))[0].r;
  it("never exposes answers or references before submission", async () => {
    // RLS with no policies: the table reads as empty for every role (answers stay in the database).
    for (const who of [A, ADMIN, null]) expect(await as(who, "select answer from assessment_items")).toEqual([]);
    const cat = await as<{ id: string }>(null, "select * from assessment_catalog()");
    expect(cat.length).toBe(36);
    await fails(as(null, "select start_assessment('sql', null, null, 3, 30)"));
    const s = await start(A);
    expect(s.items).toHaveLength(3);
    for (const it of s.items) { expect(it.answer).toBeUndefined(); expect(it.reference).toBeUndefined(); expect(it.problem).toBeTruthy(); }
    expect(JSON.stringify(s)).not.toMatch(/"sql":\s*"[0-9a-f]{64}"|SELECT /);
    expect(await as(A, `select save_assessment_answer('${s.id}', '${s.items[0].id}', '{"sql":"nope"}') as r`)).toEqual([{ r: "saved" }]);
  });
  it("scores against the stored fingerprints only at submit, then returns references", async () => {
    const s = await start(A, "python", 2);
    const [first, second] = s.items;
    const right = (await pg.query<{ a: unknown }>(`select answer as a from assessment_items where id = '${first.id}'`)).rows[0].a as { cases: string[] };
    await as(A, `select save_assessment_answer('${s.id}', '${first.id}', '${JSON.stringify({ cases: right.cases })}')`);
    const right2 = (await pg.query<{ a: unknown }>(`select answer as a from assessment_items where id = '${second.id}'`)).rows[0].a as { cases: string[] };
    const wrong = right2.cases.map((h, i) => (i === 0 ? "0".repeat(64) : h));
    await as(A, `select save_assessment_answer('${s.id}', '${second.id}', '${JSON.stringify({ cases: wrong })}')`);
    const [{ r }] = await as<{ r: { score: number; total: number; items: { id: string; passed: boolean; cases_passed: number; reference: string }[] } }>(A, `select submit_assessment('${s.id}') as r`);
    expect([r.score, r.total]).toEqual([1, 2]);
    expect(r.items.find((x) => x.id === first.id)).toMatchObject({ passed: true });
    expect(r.items.find((x) => x.id === second.id)).toMatchObject({ passed: false, cases_passed: right2.cases.length - 1 });
    expect(r.items[0].reference).toMatch(/def /);
    await fails(as(A, `select save_assessment_answer('${s.id}', '${first.id}', '{}')`));
    expect((await as<{ r: { score: number } }>(A, `select submit_assessment('${s.id}') as r`))[0].r.score).toBe(1);
  });
  it("enforces ownership and the server-side deadline; learners can't write attempts directly", async () => {
    const s = await start(A);
    await fails(as(B, `select save_assessment_answer('${s.id}', '${s.items[0].id}', '{}')`));
    await fails(as(B, `select submit_assessment('${s.id}')`));
    expect(await as(B, "select * from assessment_attempts")).toEqual([]);
    expect((await as(ADMIN, `select id from assessment_attempts where id = '${s.id}'`)).length).toBe(1);
    await fails(as(A, `update assessment_attempts set score = 99 where id = '${s.id}'`).then((r) => { if (!r.length) throw new Error("no rows"); }));
    await fails(as(A, "insert into assessment_attempts (user_id, config, items, deadline, total) values (auth.uid(), '{}', '{}', now(), 0)"));
    await pg.query(`update assessment_attempts set deadline = now() - interval '5 minutes' where id = '${s.id}'`);
    await fails(as(A, `select save_assessment_answer('${s.id}', '${s.items[0].id}', '{}')`));
    expect((await as<{ r: { score: number } }>(A, `select submit_assessment('${s.id}') as r`))[0].r.score).toBe(0);
    await fails(as(A, "select start_assessment('sql', null, null, 50, 30)"));
    await fails(as(A, "select start_assessment('sql', 'Impossible', null, 3, 30)"));
  });
});

describe("admin insights (012)", () => {
  const day = new Date().toISOString().slice(0, 10);
  const range = `'${new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10)}'::date, '${day}'::date`;
  it("refuses learners and anonymous callers", async () => {
    for (const c of [`admin_question_insights(${range})`, "admin_learner_extras()"]) { await fails(as(A, `select * from ${c}`)); await fails(as(null, `select * from ${c}`)); }
  });
  it("combines opens, checks and median solve times per question", async () => {
    await as(A, `insert into learning_events (id, user_id, type, ref, at) values (gen_random_uuid(), auth.uid(), 'sql_opened', 'q7', now())`);
    await as(B, `insert into learning_events (id, user_id, type, ref, at) values (gen_random_uuid(), auth.uid(), 'sql_opened', 'q7', now())`);
    await pg.query(`update profiles set state = jsonb_set(state, '{qmeta}', '{"7": {"solveSec": 600}}') where id = '${A}'`);
    await pg.query(`update profiles set state = jsonb_set(state, '{qmeta}', '{"7": {"solveSec": 1200}}') where id = '${B}'`);
    const rows = await as<{ kind: string; ref: string; opened_by: number; submits: number; median_solve_sec: number }>(ADMIN, `select * from admin_question_insights(${range}) where ref = 'q7'`);
    expect(rows).toHaveLength(1);
    expect([Number(rows[0].opened_by), Number(rows[0].submits), Number(rows[0].median_solve_sec)]).toEqual([2, 3, 900]);
  });
  it("reports assessments, projects and revision backlog per learner", async () => {
    await pg.query(`update profiles set state = jsonb_set(state, '{revision}', '{"sql:7": {"due": "2000-01-01"}, "sql:8": {"due": "2999-01-01"}}') where id = '${A}'`);
    const [r] = await as<{ assessments: number; avg_score: number; revision_due: number }>(ADMIN, `select * from admin_learner_extras() where id = '${A}'`);
    expect(Number(r.assessments)).toBeGreaterThanOrEqual(1);
    expect(Number(r.revision_due)).toBe(1);
  });
});
