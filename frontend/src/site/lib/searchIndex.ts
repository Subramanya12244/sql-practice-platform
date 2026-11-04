import { loadIndex } from "./data";
import { loadAllGuides } from "./content";
import { loadAllNotes, loadAllPatterns, loadMapIndex, loadShortcuts } from "./learning";

export interface SearchDoc {
  kind: "Note" | "Pattern" | "Guide" | "Question" | "Shortcut" | "Mind map";
  title: string;
  path: string;
  text: string;
}

let cache: Promise<SearchDoc[]> | null = null;

/** Everything searchable, built once in the browser on first use. */
export function buildIndex(): Promise<SearchDoc[]> {
  cache ??= (async () => {
    const [notes, patterns, guides, questions, shortcuts, maps] = await Promise.all([
      loadAllNotes(), loadAllPatterns(), loadAllGuides(), loadIndex(), loadShortcuts(), loadMapIndex(),
    ]);
    const plain = (s: string) => s.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|_-]/g, " ").replace(/\s+/g, " ").slice(0, 4000);
    return [
      ...notes.map((n) => ({ kind: "Note" as const, title: n.title, path: `/notes/${n.slug}`, text: `${n.description} ${plain(n.body)}` })),
      ...patterns.map((p) => ({ kind: "Pattern" as const, title: p.title, path: `/patterns/${p.slug}`, text: `${p.description} ${plain(p.body)}` })),
      ...maps.map((m) => ({ kind: "Mind map" as const, title: m.title, path: `/mindmaps/${m.slug}`, text: m.description })),
      ...guides.map((g) => ({ kind: "Guide" as const, title: g.title, path: `/concepts/${g.slug}`, text: `${g.description} ${plain(g.body)}` })),
      ...questions.map((q) => ({
        kind: "Question" as const, title: `Q${q.number} ${q.title}`, path: `/questions/${q.slug}`,
        text: `${q.topicLabel} ${q.difficulty} ${q.concepts.join(" ")} ${q.takeaway}`,
      })),
      ...shortcuts.flatMap((c) =>
        c.items.map((it) => ({ kind: "Shortcut" as const, title: it.operation, path: `/shortcuts#${it.id}`, text: `${c.title} ${it.syntax} ${it.explanation}` })),
      ),
    ];
  })();
  return cache;
}

const KIND_WEIGHT: Record<SearchDoc["kind"], number> = { Note: 6, Pattern: 5, "Mind map": 4, Guide: 3, Shortcut: 2, Question: 1 };

/** Every word must appear; title hits rank first. */
export function search(docs: SearchDoc[], query: string, limit = 20): SearchDoc[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { d: SearchDoc; score: number }[] = [];
  for (const d of docs) {
    const title = d.title.toLowerCase();
    const text = d.text.toLowerCase();
    let score = 0;
    let ok = true;
    for (const w of words) {
      if (title.includes(w)) score += title.startsWith(w) ? 30 : 20;
      else if (text.includes(w)) score += 3;
      else {
        ok = false;
        break;
      }
    }
    if (ok) scored.push({ d, score: score + KIND_WEIGHT[d.kind] });
  }
  return scored.sort((a, b) => b.score - a.score || a.d.title.localeCompare(b.d.title)).slice(0, limit).map((s) => s.d);
}
