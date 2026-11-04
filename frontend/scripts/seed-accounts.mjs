#!/usr/bin/env node
// Create the owner and admin accounts in Supabase and import the owner's solved questions.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//   SEED_USER_PASSWORD=… SEED_ADMIN_PASSWORD=… \
//   node scripts/seed-accounts.mjs
//
// Never commit these values. The service-role key bypasses RLS: keep it off the frontend.
// Re-running is safe: existing users are reused and progress is upserted.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const env = (k, fallback) => {
  const v = process.env[k] ?? fallback;
  if (!v) {
    console.error(`Missing ${k}`);
    process.exit(1);
  }
  return v;
};

const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const DOMAIN = "users.sqlpractice.local";
const OWNER = env("SEED_USER_NAME", "Subramanya.a");
const ADMIN = env("SEED_ADMIN_NAME", "admin");

async function findUser(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit || data.users.length < 200) return hit;
  }
}

async function ensureUser(username, password, role, mustChange) {
  const email = `${username.toLowerCase()}@${DOMAIN}`;
  let user = await findUser(email);
  if (!user) {
    const { data, error } = await sb.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { username },
    });
    if (error) throw error;
    user = data.user;
    console.log(`created ${username}`);
  } else {
    console.log(`exists  ${username} (password unchanged)`);
  }
  const { error } = await sb.from("profiles").update({ role, must_change_password: mustChange }).eq("id", user.id);
  if (error) throw error;
  return user.id;
}

const ownerId = await ensureUser(OWNER, env("SEED_USER_PASSWORD"), "user", false);
await ensureUser(ADMIN, env("SEED_ADMIN_PASSWORD"), "admin", true);

// Every question in the repo that is not marked 🆕 has been solved by the owner.
const index = JSON.parse(await readFile(new URL("../public/data/index.json", import.meta.url), "utf8"));
const solved = index.filter((q) => !q.isNew);
const now = new Date().toISOString();
const rows = solved.map((q) => ({
  user_id: ownerId,
  question_number: q.number,
  // A question with recorded mistakes took at least two tries.
  attempts: q.hadMistakes ? 2 : 1,
  solved_at: now,
  revealed: false,
  updated_at: now,
}));
const { error } = await sb.from("progress").upsert(rows, { onConflict: "user_id,question_number", ignoreDuplicates: true });
if (error) throw error;
await sb.from("audit_log").insert({ user_id: ownerId, action: "progress_import", detail: { solved: rows.length, source: "northwind-sql-practice" } });
console.log(`imported ${rows.length} solved questions for ${OWNER}`);
