import type { SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Accounts are optional: without these env vars the site runs anonymously on localStorage. */
export const accountsEnabled = Boolean(URL && ANON_KEY);

let client: Promise<SupabaseClient> | null = null;

/** Lazily load supabase-js so anonymous visitors and the prerender never pay for it. */
export function getSupabase(): Promise<SupabaseClient> {
  if (!accountsEnabled) return Promise.reject(new Error("Accounts are not configured on this site."));
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(URL!, ANON_KEY!, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } }),
  );
  return client;
}
