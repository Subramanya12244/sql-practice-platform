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
  for (const m of [stub, m001, m002, m003, m004, m005, m006]) await pg.exec(m);
  // Re-applying must be safe (no data loss, no errors).
  await pg.exec(m003);
  await pg.exec(m004);
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
