import { loadIndex } from "./data";
import { loadAllGuides } from "./content";
import { loadAllNotes, loadAllPatterns, loadMapIndex, loadShortcuts } from "./learning";
import { loadExerciseIndex } from "./pyExercises";
import { CURRICULUM, dayHref, isAuthored } from "./daily";
import { NAV_GROUPS } from "./navigation";

export interface SearchDoc {
  kind: "Tool" | "Lesson" | "Note" | "Pattern" | "Guide" | "Question" | "Exercise" | "Shortcut" | "Mind map";
  title: string;
  path: string;
  text: string;
}

let cache: Promise<SearchDoc[]> | null = null;

/** Everything searchable, built once in the browser on first use. */
export function buildIndex(): Promise<SearchDoc[]> {
  cache ??= (async () => {
    const [notes, patterns, guides, questions, shortcuts, maps, exercises] = await Promise.all([
      loadAllNotes(), loadAllPatterns(), loadAllGuides(), loadIndex(), loadShortcuts(), loadMapIndex(), loadExerciseIndex().catch(() => []),
    ]);
    const plain = (s: string) => s.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|_-]/g, " ").replace(/\s+/g, " ").slice(0, 4000);
    return [
      // Every page and tool in the navigation, so "etl", "dag" or "planner" finds the place to go.
      ...NAV_GROUPS.flatMap((g) => (g.items ?? []).filter((i) => i.to !== "/").map((i) => ({ kind: "Tool" as const, title: i.label, path: i.to, text: `${g.label} ${i.desc ?? ""}` }))),
      // Daily Learning lessons that are written. A lesson is shown by its day and title.
      ...CURRICULUM.days.filter((d) => isAuthored(d.id)).map((d) => ({ kind: "Lesson" as const, title: `Day ${d.day}: ${d.title}`, path: dayHref(d), text: `${d.topics.join(" ")} ${d.phase} ${d.path === "common" ? "common core" : d.path}` })),
      ...exercises.map((e) => ({ kind: "Exercise" as const, title: `${e.code} ${e.title}`, path: `/practice/python/${e.slug}`, text: `${e.category ?? ""} ${(e.concepts ?? []).join(" ")} ${e.difficulty ?? ""}` })),
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

const KIND_WEIGHT: Record<SearchDoc["kind"], number> = { Tool: 9, Lesson: 7, Note: 6, Pattern: 5, "Mind map": 4, Guide: 3, Shortcut: 2, Exercise: 1.5, Question: 1 };

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
    // The whole query as a phrase in the title ("day 12") beats words that only happen to appear ("day 112").
    if (ok && words.length > 1 && title.includes(words.join(" "))) score += 25;
    if (ok) scored.push({ d, score: score + KIND_WEIGHT[d.kind] });
  }
  return scored.sort((a, b) => b.score - a.score || a.d.title.localeCompare(b.d.title)).slice(0, limit).map((s) => s.d);
}
