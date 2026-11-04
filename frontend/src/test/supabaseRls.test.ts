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
  for (const m of [stub, m001, m002, m003, m004]) await pg.exec(m);
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
