/**
 * My Study Notes: saved PDFs. Signed-in learners store them in Supabase (row in study_notes +
 * file in the private "study-notes" bucket, both owner-only under RLS). Anonymous learners keep
 * them in this browser's IndexedDB. Both expose the same small API.
 */
import { getSupabase } from "../supabase";
import type { NotesOptions } from "./content";

export interface StoredNote {
  id: string; title: string; kind: "sql" | "python" | "mixed"; topics: string[]; refs: string[];
  options: NotesOptions; pages: number; size_bytes: number; created_at: string; where: "account" | "device";
}
type NewNote = Omit<StoredNote, "id" | "created_at" | "where">;

// ── IndexedDB (this browser) ─────────────────────────────────────────────
const DB = "dataforge-notes", STORE = "notes";
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "meta.id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB is unavailable in this browser."));
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Public API ───────────────────────────────────────────────────────────
export async function listNotes(userId: string | null): Promise<StoredNote[]> {
  if (userId) {
    const sb = await getSupabase();
    const { data, error } = await sb.from("study_notes").select("id, title, kind, topics, refs, options, pages, size_bytes, created_at").order("created_at", { ascending: false });
    if (error) throw new Error(/study_notes/.test(error.message) ? "Saving notes to your account needs migration 009_study_notes.sql." : error.message);
    return (data ?? []).map((r) => ({ ...(r as Omit<StoredNote, "where">), where: "account" as const }));
  }
  const rows = await tx<{ meta: StoredNote }[]>("readonly", (s) => s.getAll() as IDBRequest<{ meta: StoredNote }[]>);
  return rows.map((r) => r.meta).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function saveNote(userId: string | null, note: NewNote, pdf: Blob): Promise<StoredNote> {
  const id = crypto.randomUUID();
  if (userId) {
    const sb = await getSupabase();
    const path = `${userId}/${id}.pdf`;
    const up = await sb.storage.from("study-notes").upload(path, pdf, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data, error } = await sb.from("study_notes").insert({ id, ...note, storage_path: path }).select("created_at").single();
    if (error) {
      await sb.storage.from("study-notes").remove([path]);
      throw new Error(error.message);
    }
    return { ...note, id, created_at: (data as { created_at: string }).created_at, where: "account" };
  }
  const meta: StoredNote = { ...note, id, created_at: new Date().toISOString(), where: "device" };
  await tx("readwrite", (s) => s.put({ meta, pdf }));
  return meta;
}

export async function noteBlob(userId: string | null, n: StoredNote): Promise<Blob> {
  if (n.where === "account" && userId) {
    const sb = await getSupabase();
    const { data, error } = await sb.storage.from("study-notes").download(`${userId}/${n.id}.pdf`);
    if (error || !data) throw new Error(error?.message ?? "Download failed.");
    return data;
  }
  const row = await tx<{ meta: StoredNote; pdf: Blob } | undefined>("readonly", (s) => s.get(n.id) as IDBRequest<{ meta: StoredNote; pdf: Blob } | undefined>);
  if (!row) throw new Error("This note is no longer stored in this browser.");
  return row.pdf;
}

export async function deleteNote(userId: string | null, n: StoredNote) {
  if (n.where === "account" && userId) {
    const sb = await getSupabase();
    const { error } = await sb.from("study_notes").delete().eq("id", n.id);
    if (error) throw new Error(error.message);
    await sb.storage.from("study-notes").remove([`${userId}/${n.id}.pdf`]);
    return;
  }
  await tx("readwrite", (s) => s.delete(n.id));
}
