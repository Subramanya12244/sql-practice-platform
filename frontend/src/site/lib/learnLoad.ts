/**
 * Page data for the Learn hub, its path pages and its topic pages. Runs in the build step and in the browser.
 * It sends a compact projection (counts and slugs, not whole note, pattern and map indexes) so each prerendered page
 * stays small; the topic page carries only its own resolved resources.
 */
import { loadAllGuides, loadAllSets, loadLessonSummaries } from "./content";
import { loadAllMaps, loadNoteIndex, loadPatternIndex } from "./learning";
import { loadExerciseIndex } from "./pyExercises";
import { loadAllProjects, loadProjectIndex, type ProjectMeta } from "./projects";
import { loadScenarioIndex } from "./scenarios";
import { loadIndex } from "./data";
import type { LessonSummary } from "../types";
import type { Task } from "./tasks";
import { buildBundle, buildTopics, mapIndex, toLite, type HubTopic, type TopicBundle, type TopicLite } from "./learnTopics";

export interface LearnHubData {
  topics: TopicLite[];
  /** The free SQL course. */
  lessons: LessonSummary[];
  projects: ProjectMeta[];
  projectTasks: { slug: string; tasks: Task[] }[];
  counts: { notes: number; patterns: number; guides: number; maps: number; exercises: number; scenarios: number; projects: number };
}

async function sources() {
  const [notes, patterns, maps, exercises, guides] = await Promise.all([loadNoteIndex(), loadPatternIndex(), loadAllMaps(), loadExerciseIndex(), loadAllGuides()]);
  const topics: HubTopic[] = buildTopics({ notes, patterns, mapsByNote: mapIndex(maps), exercises });
  return { notes, patterns, maps, exercises, guides, topics };
}

export async function loadLearnHub(): Promise<LearnHubData> {
  const [s, lessons, projects, all, scenarios] = await Promise.all([sources(), loadLessonSummaries(), loadProjectIndex(), loadAllProjects(), loadScenarioIndex()]);
  return {
    topics: s.topics.map(toLite),
    lessons,
    projects,
    projectTasks: all.map((p) => ({ slug: p.slug, tasks: p.tasks.map((t) => ({ id: t.id, type: t.type }) as unknown as Task) })),
    counts: { notes: s.notes.length, patterns: s.patterns.length, guides: s.guides.length, maps: s.maps.length, exercises: s.exercises.length, scenarios: scenarios.length, projects: projects.length },
  };
}

/** Every topic id, for prerendering. */
export async function learnTopicIds(): Promise<string[]> {
  return (await sources()).topics.map((t) => t.id);
}

export async function loadLearnTopic(id: string): Promise<TopicBundle | null> {
  const [s, index, projects, sets] = await Promise.all([sources(), loadIndex(), loadProjectIndex(), loadAllSets()]);
  return buildBundle(id, {
    topics: s.topics, notes: s.notes, patterns: s.patterns, guides: s.guides, maps: s.maps.map(({ slug, title }) => ({ slug, title })),
    index, exercises: s.exercises, projects, sets: sets.map(({ slug, title, questions }) => ({ slug, title, questions })),
  });
}
