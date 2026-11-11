import { loadIndex } from "./data";
import { loadExerciseIndex } from "./pyExercises";
import { loadProjectIndex } from "./projects";
import { loadMapIndex, loadNoteIndex, loadPatternIndex } from "./learning";
import type { DayLinks } from "./daily";

export interface ResolvedLink {
  kind: "Note" | "Question" | "Python exercise" | "Project" | "Mind map" | "Pattern";
  title: string;
  path: string;
}

/** Turn a day's reference ids into titled links to the existing DataForge pages. Unknown ids are dropped. */
export async function resolveLinks(links: DayLinks): Promise<ResolvedLink[]> {
  const out: ResolvedLink[] = [];
  const [notes, questions, exercises, projects, maps, patterns] = await Promise.all([
    links.notes?.length ? loadNoteIndex() : [], links.questions?.length ? loadIndex() : [], links.pyExercises?.length ? loadExerciseIndex() : [],
    links.projects?.length ? loadProjectIndex() : [], links.mindmaps?.length ? loadMapIndex() : [], links.patterns?.length ? loadPatternIndex() : [],
  ]);
  for (const s of links.notes ?? []) { const n = notes.find((x) => x.slug === s); if (n) out.push({ kind: "Note", title: n.title, path: `/notes/${n.slug}` }); }
  for (const num of links.questions ?? []) { const q = questions.find((x) => x.number === num); if (q) out.push({ kind: "Question", title: `Q${q.number} ${q.title}`, path: `/questions/${q.slug}` }); }
  for (const s of links.pyExercises ?? []) { const e = exercises.find((x) => x.slug === s); if (e) out.push({ kind: "Python exercise", title: `${e.code} ${e.title}`, path: `/practice/python/${e.slug}` }); }
  for (const s of links.projects ?? []) { const p = projects.find((x) => x.slug === s); if (p) out.push({ kind: "Project", title: p.title, path: `/projects-lab/${p.slug}` }); }
  for (const s of links.mindmaps ?? []) { const m = maps.find((x) => x.slug === s); if (m) out.push({ kind: "Mind map", title: m.title, path: `/mindmaps/${m.slug}` }); }
  for (const s of links.patterns ?? []) { const p = patterns.find((x) => x.slug === s); if (p) out.push({ kind: "Pattern", title: p.title, path: `/patterns/${p.slug}` }); }
  return out;
}
