import { matchPath, type Params } from "react-router-dom";
import type { ReactElement } from "react";
import type { PageData } from "./types";
import { getJSON, loadIndex, loadQuestion, loadSchema, loadTopics } from "./lib/data";
import { guideSlugs, loadAllGuides, loadCheatsheet, loadGuide, loadLesson, loadLessonSummaries, loadAllSets } from "./lib/content";
import { HomePage } from "./pages/HomePage";
import { QuestionsPage } from "./pages/QuestionsPage";
import { TopicPage } from "./pages/TopicPage";
import { QuestionPage } from "./pages/QuestionPage";
import { ConceptsPage } from "./pages/ConceptsPage";
import { GuidePage } from "./pages/GuidePage";
import { FlashcardsPage } from "./pages/FlashcardsPage";
import { CheatsheetPage } from "./pages/CheatsheetPage";
import { ProgressPage } from "./pages/ProgressPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SchemaPage } from "./pages/SchemaPage";
import { MockInterviewPage } from "./pages/MockInterviewPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { AccountPage, LoginPage, SignupPage } from "./pages/AuthPages";
import { AdminPage } from "./pages/AdminPage";
import { LearnPage, LessonPage } from "./pages/LearnPages";
import { ReviewPage } from "./pages/ReviewPage";
import { NotePage, NotesIndexPage } from "./pages/NotesPages";
import { PatternPage, PatternsIndexPage } from "./pages/PatternsPages";
import { ShortcutDocPage, ShortcutsPage } from "./pages/ShortcutsPages";
import { MindMapPage, MindMapsIndexPage } from "./pages/MindMapPages";
import { QueryVisualizerPage } from "./pages/QueryVisualizerPage";
import { SolutionComparisonPage } from "./pages/SolutionComparisonPage";
import { ReadinessPage } from "./pages/ReadinessPage";
import { TutorPage } from "./pages/TutorPage";
import { DataGeneratorPage } from "./pages/DataGeneratorPage";
import { DataEngineeringPage } from "./pages/DataEngineeringPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PythonExercisePage, PythonPracticeIndexPage } from "./pages/PythonPracticePages";
import { loadExercise, loadExerciseIndex } from "./lib/pyExercises";
import { ProjectPage, ProjectsIndexPage } from "./pages/ProjectsPages";
import { DataQualityPage } from "./pages/DataQualityPage";
import { loadAllProjects, loadProject, loadProjectIndex } from "./lib/projects";
import { ScenarioPage, ScenariosPage } from "./pages/ScenarioPages";
import { loadScenario, loadScenarioIndex } from "./lib/scenarios";
import { NORTHWIND_INFO, type DatasetInfo } from "./lib/datasets";
import {
  loadMap, loadMapIndex, loadNote, loadNoteIndex, loadPattern, loadPatternIndex, loadShortcutPage, loadShortcuts, mapsLinking,
} from "./lib/learning";
import { ChallengePage, LeaderboardPage, ProfilePage } from "./pages/CommunityPages";
import { InterviewSetPage, InterviewSetsPage } from "./pages/InterviewSetPages";

export interface SiteRoute {
  path: string;
  element: ReactElement;
  load: (params: Params) => Promise<PageData | null>;
  /** Concrete paths to prerender for this route. */
  paths: () => Promise<string[]>;
}

const base = async (): Promise<PageData> => ({ index: await loadIndex(), topics: await loadTopics() });
const datasetList = async (): Promise<DatasetInfo[]> => [
  NORTHWIND_INFO,
  ...(await getJSON<Omit<DatasetInfo, "kind">[]>("/data/datasets/index.json")).map((d) => ({ ...d, kind: "builtin" as const })),
];
const guideLinks = async () => (await loadAllGuides()).map(({ slug, title, description }) => ({ slug, title, description }));
/** Summaries every learning page needs for cross-links. */
const library = async () => ({ notes: await loadNoteIndex(), patterns: await loadPatternIndex(), mindmaps: await loadMapIndex() });
const one = (p: string) => async () => [p];

export const routes: SiteRoute[] = [
  { path: "/", element: <HomePage />, load: base, paths: one("/") },
  { path: "/questions", element: <QuestionsPage />, load: base, paths: one("/questions") },
  {
    path: "/questions/:slug",
    element: <QuestionPage />,
    load: async ({ slug }) => {
      const data = await base();
      if (!data.index.some((q) => q.slug === slug)) return null;
      const question = await loadQuestion(slug!);
      // Notes that teach this question, so the page links back into theory.
      const notes = (await loadNoteIndex()).filter((n) => n.questions.includes(question.number));
      const patterns = (await loadPatternIndex()).filter((p) => p.questions.includes(question.number));
      return { ...data, question, schema: await loadSchema(), notes, patterns };
    },
    paths: async () => (await loadIndex()).map((q) => `/questions/${q.slug}`),
  },
  {
    path: "/topics/:slug",
    element: <TopicPage />,
    load: async ({ slug }) => {
      const data = await base();
      return data.topics.some((t) => t.slug === slug) ? data : null;
    },
    paths: async () => (await loadTopics()).map((t) => `/topics/${t.slug}`),
  },
  {
    path: "/concepts",
    element: <ConceptsPage />,
    load: async () => ({
      ...(await base()),
      guides: (await loadAllGuides()).map(({ slug, title, description }) => ({ slug, title, description })),
    }),
    paths: one("/concepts"),
  },
  {
    path: "/concepts/:slug",
    element: <GuidePage />,
    load: async ({ slug }) => {
      const guide = await loadGuide(slug!);
      if (!guide) return null;
      const all = await loadAllGuides();
      return {
        ...(await base()),
        guide,
        guides: all.map(({ slug, title, description }) => ({ slug, title, description })),
      };
    },
    paths: async () => guideSlugs().map((s) => `/concepts/${s}`),
  },
  { path: "/flashcards", element: <FlashcardsPage />, load: base, paths: one("/flashcards") },
  {
    path: "/cheatsheet",
    element: <CheatsheetPage />,
    load: async () => ({ ...(await base()), cheatsheet: await loadCheatsheet() }),
    paths: one("/cheatsheet"),
  },
  { path: "/progress", element: <ProgressPage />, load: base, paths: one("/progress") },
  { path: "/review", element: <ReviewPage />, load: base, paths: one("/review") },
  { path: "/challenge", element: <ChallengePage />, load: base, paths: one("/challenge") },
  { path: "/leaderboard", element: <LeaderboardPage />, load: base, paths: one("/leaderboard") },
  { path: "/profile", element: <ProfilePage />, load: base, paths: one("/profile") },
  {
    path: "/schema",
    element: <SchemaPage />,
    load: async () => ({ ...(await base()), schema: await loadSchema() }),
    paths: one("/schema"),
  },
  {
    path: "/playground",
    element: <PlaygroundPage />,
    load: async () => ({ ...(await base()), schema: await loadSchema() }),
    paths: one("/playground"),
  },
  {
    path: "/mock-interview",
    element: <MockInterviewPage />,
    load: async () => ({ ...(await base()), schema: await loadSchema() }),
    paths: one("/mock-interview"),
  },
  {
    path: "/learn",
    element: <LearnPage />,
    load: async () => ({ ...(await base()), ...(await library()), lessons: await loadLessonSummaries() }),
    paths: one("/learn"),
  },
  {
    path: "/learn/:slug",
    element: <LessonPage />,
    load: async ({ slug }) => {
      const lesson = await loadLesson(slug!);
      return lesson ? { ...(await base()), lesson, lessons: await loadLessonSummaries() } : null;
    },
    paths: async () => (await loadLessonSummaries()).map((l) => `/learn/${l.slug}`),
  },
  {
    path: "/interview",
    element: <InterviewSetsPage />,
    load: async () => ({ ...(await base()), sets: (await loadAllSets()).map(({ slug, title, description }) => ({ slug, title, description })) }),
    paths: one("/interview"),
  },
  {
    path: "/interview/:slug",
    element: <InterviewSetPage />,
    load: async ({ slug }) => {
      const set = (await loadAllSets()).find((s) => s.slug === slug);
      return set ? { ...(await base()), set } : null;
    },
    paths: async () => (await loadAllSets()).map((s) => `/interview/${s.slug}`),
  },
  { path: "/notes", element: <NotesIndexPage />, load: async () => ({ ...(await base()), notes: await loadNoteIndex() }), paths: one("/notes") },
  {
    path: "/notes/:slug",
    element: <NotePage />,
    load: async ({ slug }) => {
      const note = await loadNote(slug!);
      if (!note) return null;
      return { ...(await base()), ...(await library()), guides: await guideLinks(), note, relatedMaps: await mapsLinking("note", note.slug) };
    },
    paths: async () => (await loadNoteIndex()).map((n) => `/notes/${n.slug}`),
  },
  { path: "/patterns", element: <PatternsIndexPage />, load: async () => ({ ...(await base()), patterns: await loadPatternIndex() }), paths: one("/patterns") },
  {
    path: "/patterns/:slug",
    element: <PatternPage />,
    load: async ({ slug }) => {
      const pattern = await loadPattern(slug!);
      if (!pattern) return null;
      return { ...(await base()), ...(await library()), guides: await guideLinks(), pattern, relatedMaps: await mapsLinking("pattern", pattern.slug) };
    },
    paths: async () => (await loadPatternIndex()).map((p) => `/patterns/${p.slug}`),
  },
  {
    path: "/shortcuts",
    element: <ShortcutsPage />,
    load: async () => ({ ...(await base()), notes: await loadNoteIndex(), shortcuts: await loadShortcuts() }),
    paths: one("/shortcuts"),
  },
  {
    path: "/shortcuts/:slug",
    element: <ShortcutDocPage />,
    load: async ({ slug }) => {
      const shortcutPage = await loadShortcutPage(slug!);
      return shortcutPage ? { ...(await base()), shortcutPage } : null;
    },
    paths: async () => ["/shortcuts/comparisons", "/shortcuts/interview-revision"],
  },
  { path: "/mindmaps", element: <MindMapsIndexPage />, load: async () => ({ ...(await base()), mindmaps: await loadMapIndex() }), paths: one("/mindmaps") },
  {
    path: "/mindmaps/:slug",
    element: <MindMapPage />,
    load: async ({ slug }) => {
      const mindmap = await loadMap(slug!);
      return mindmap ? { ...(await base()), ...(await library()), mindmap } : null;
    },
    paths: async () => (await loadMapIndex()).map((m) => `/mindmaps/${m.slug}`),
  },
  { path: "/query-visualizer", element: <QueryVisualizerPage />, load: base, paths: one("/query-visualizer") },
  { path: "/solution-comparison", element: <SolutionComparisonPage />, load: base, paths: one("/solution-comparison") },
  { path: "/readiness", element: <ReadinessPage />, load: async () => ({ ...(await base()), notes: await loadNoteIndex() }), paths: one("/readiness") },
  {
    path: "/ai-tutor",
    element: <TutorPage />,
    load: async () => ({ ...(await base()), notes: await loadNoteIndex(), schema: await loadSchema() }),
    paths: one("/ai-tutor"),
  },
  { path: "/data-generator", element: <DataGeneratorPage />, load: base, paths: one("/data-generator") },
  {
    path: "/data-engineering",
    element: <DataEngineeringPage />,
    load: async () => ({ ...(await base()), notes: await loadNoteIndex(), mindmaps: await loadMapIndex() }),
    paths: one("/data-engineering"),
  },
  { path: "/settings", element: <SettingsPage />, load: base, paths: one("/settings") },
  { path: "/data-quality", element: <DataQualityPage />, load: base, paths: one("/data-quality") },
  {
    path: "/projects-lab",
    element: <ProjectsIndexPage />,
    load: async () => ({
      ...(await base()),
      projects: await loadProjectIndex(),
      projectTasks: (await loadAllProjects()).map((p) => ({ slug: p.slug, tasks: p.tasks.map((t) => ({ id: t.id, type: t.type }) as never) })),
    }),
    paths: one("/projects-lab"),
  },
  {
    path: "/projects-lab/:slug",
    element: <ProjectPage />,
    load: async ({ slug }) => {
      const project = await loadProject(slug!);
      return project ? { ...(await base()), project, notes: await loadNoteIndex() } : null;
    },
    paths: async () => (await loadProjectIndex()).map((p) => `/projects-lab/${p.slug}`),
  },
  { path: "/practice/python", element: <PythonPracticeIndexPage />, load: async () => ({ ...(await base()), exercises: await loadExerciseIndex() }), paths: one("/practice/python") },
  {
    path: "/practice/python/:slug",
    element: <PythonExercisePage />,
    load: async ({ slug }) => {
      const exercise = await loadExercise(slug!);
      return exercise ? { ...(await base()), exercise, notes: await loadNoteIndex() } : null;
    },
    paths: async () => (await loadExerciseIndex()).map((e) => `/practice/python/${e.slug}`),
  },
  {
    path: "/scenarios",
    element: <ScenariosPage />,
    load: async () => ({ ...(await base()), scenarios: await loadScenarioIndex(), datasets: await datasetList() }),
    paths: one("/scenarios"),
  },
  {
    path: "/scenarios/:slug",
    element: <ScenarioPage />,
    load: async ({ slug }) => {
      const scenario = await loadScenario(slug!);
      return scenario ? { ...(await base()), scenario, datasets: await datasetList(), notes: await loadNoteIndex() } : null;
    },
    paths: async () => (await loadScenarioIndex()).map((s) => `/scenarios/${s.slug}`),
  },
  // Account pages render a shell at build time; everything else happens in the browser.
  { path: "/login", element: <LoginPage />, load: base, paths: one("/login") },
  { path: "/signup", element: <SignupPage />, load: base, paths: one("/signup") },
  { path: "/account", element: <AccountPage />, load: base, paths: one("/account") },
  { path: "/admin", element: <AdminPage />, load: base, paths: one("/admin") },
];

export const notFoundRoute: SiteRoute = {
  path: "*",
  element: <NotFoundPage />,
  load: base,
  paths: one("/404"),
};

export function matchRoute(pathname: string): { route: SiteRoute; params: Params } {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  for (const route of routes) {
    const m = matchPath(route.path, clean);
    if (m) return { route, params: m.params };
  }
  return { route: notFoundRoute, params: {} };
}

/** Load a page's data; a loader returning null means "not found". */
export async function loadPage(pathname: string): Promise<{ data: PageData; notFound: boolean }> {
  const { route, params } = matchRoute(pathname);
  const data = await route.load(params);
  if (data && route !== notFoundRoute) return { data, notFound: false };
  return { data: (await notFoundRoute.load({})) as PageData, notFound: true };
}
