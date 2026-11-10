/**
 * Saved documents for the labs (pipelines, DAGs, schemas). One small index plus one record per
 * document in localStorage, so a corrupt or oversized document never takes the list down.
 */
export interface DocMeta { id: string; name: string; savedAt: string }
const MAX_DOCS = 20;
const idx = (kind: string) => `sqlp.lab.${kind}.index`;
const doc = (kind: string, id: string) => `sqlp.lab.${kind}.doc.${id}`;

const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };

export const listDocs = (kind: string): DocMeta[] => read<DocMeta[]>(idx(kind), []).sort((a, b) => b.savedAt.localeCompare(a.savedAt));

/** Save (new when `id` is missing) and return the id. The oldest documents are dropped past the cap. */
export function saveDoc<T>(kind: string, input: { id?: string; name: string; data: T }): string | null {
  const id = input.id ?? crypto.randomUUID().slice(0, 8);
  const meta: DocMeta = { id, name: input.name.trim().slice(0, 60) || "Untitled", savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(doc(kind, id), JSON.stringify(input.data));
    const rest = read<DocMeta[]>(idx(kind), []).filter((m) => m.id !== id);
    const all = [meta, ...rest].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    for (const old of all.slice(MAX_DOCS)) localStorage.removeItem(doc(kind, old.id));
    localStorage.setItem(idx(kind), JSON.stringify(all.slice(0, MAX_DOCS)));
    return id;
  } catch {
    return null; // storage full or blocked
  }
}

export function loadDoc<T>(kind: string, id: string): T | null {
  try { const v = localStorage.getItem(doc(kind, id)); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}

export function deleteDoc(kind: string, id: string) {
  try {
    localStorage.removeItem(doc(kind, id));
    localStorage.setItem(idx(kind), JSON.stringify(read<DocMeta[]>(idx(kind), []).filter((m) => m.id !== id)));
  } catch { /* nothing to do */ }
}
