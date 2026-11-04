import { matchPath, type Params } from "react-router-dom";
import type { ReactElement } from "react";
import type { PageData } from "./types";
import { loadIndex, loadQuestion, loadTopics } from "./lib/data";
import { guideSlugs, loadAllGuides, loadCheatsheet, loadGuide } from "./lib/content";
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

export interface SiteRoute {
  path: string;
  element: ReactElement;
  load: (params: Params) => Promise<PageData | null>;
  /** Concrete paths to prerender for this route. */
  paths: () => Promise<string[]>;
}

const base = async (): Promise<PageData> => ({ index: await loadIndex(), topics: await loadTopics() });
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
      return { ...data, question: await loadQuestion(slug!) };
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
