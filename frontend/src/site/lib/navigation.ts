/** Site navigation, defined once. Groups render as disclosure sections in the sidebar and an accordion on mobile. */
export interface NavItem {
  to: string;
  label: string;
  desc?: string;
  /** Not a page of its own for breadcrumbs (a shortcut into another item's section). */
  noCrumb?: boolean;
}
export interface NavGroup {
  id: string;
  label: string;
  /** Short label for the desktop bar. */
  short?: string;
  to?: string; // a group without items is a plain link
  items?: NavItem[];
}

/**
 * Six categories: Home, Learn, Practice, Labs, Projects, Career. Every page of the site keeps one entry here.
 * A path appears in one group only, so the sidebar never highlights two groups for one page.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    label: "Home",
    items: [
      { to: "/", label: "Home", desc: "What DataForge offers and where to start" },
      { to: "/learn", label: "Dashboard", desc: "Goals, streak, what to do next, and the SQL course" },
      { to: "/progress", label: "Progress", desc: "Solved questions and activity" },
      { to: "/analytics", label: "Performance analytics", desc: "Solve time, topic strength, activity" },
      { to: "/mistakes", label: "Mistake notebook", desc: "What went wrong, by topic, and if it is fixed" },
      { to: "/achievements", label: "Achievements & missions", desc: "XP, level, streak, daily missions" },
    ],
  },
  {
    id: "learn",
    label: "Learn",
    items: [
      { to: "/daily", label: "Daily Learning", desc: "180-day plan, today's lesson, progress and calendar" },
      { to: "/daily/day/1", label: "Start at Day 1", desc: "Python from scratch", noCrumb: true },
      { to: "/data-engineering", label: "Learning tracks", desc: "Python, ETL, warehousing, Spark, Airflow, dbt, cloud" },
      { to: "/notes", label: "SQL notes", desc: "65 topics, beginner to expert" },
      { to: "/study-notes", label: "Visual study notes", desc: "PDFs of your completed problems" },
      { to: "/mindmaps", label: "Mind maps" },
      { to: "/patterns", label: "SQL patterns" },
      { to: "/concepts", label: "Concept guides" },
      { to: "/shortcuts", label: "Shortcuts & cheat sheets" },
      { to: "/flashcards", label: "Flashcards" },
      { to: "/review", label: "Revision queue", desc: "Spaced review of what you solved" },
      { to: "/history", label: "History & revision", desc: "Submissions, mistakes, saved solutions" },
    ],
  },
  {
    id: "practice",
    label: "Practice",
    items: [
      { to: "/questions", label: "SQL practice", desc: "150 graded questions" },
      { to: "/practice/python", label: "Python practice", desc: "Runs in your browser" },
      { to: "/scenarios", label: "Business scenarios" },
      { to: "/assessments", label: "Assessments", desc: "Timed, server-graded SQL and Python" },
      { to: "/practice/python/assessment", label: "Python assessment", desc: "Timed, three problems" },
      { to: "/interview", label: "Interview sets", desc: "Question sets by role" },
      { to: "/query-visualizer", label: "SQL query visualizer", desc: "Watch a query run on real rows" },
      { to: "/playground", label: "SQL playground", desc: "Six practice databases" },
      { to: "/solution-comparison", label: "Solution comparison" },
      { to: "/ai-tutor", label: "Query helper", desc: "Hints, explanations and result checks" },
      { to: "/challenge", label: "Weekly challenge" },
      { to: "/leaderboard", label: "Leaderboard" },
    ],
  },
  {
    id: "labs",
    label: "Labs",
    items: [
      { to: "/etl-builder", label: "ETL pipeline builder", desc: "Source to load, with previews and logs" },
      { to: "/dag-simulator", label: "DAG simulator", desc: "DAGs, retries and failures, Airflow concepts" },
      { to: "/schema-designer", label: "Schema designer", desc: "Keys, relationships, normalization, indexes" },
      { to: "/dq-exercises", label: "Data quality exercises", desc: "Five dimensions, before and after score" },
      { to: "/de-scenarios", label: "Data engineering scenarios", desc: "Upserts, late data, retries, reconciliation" },
      { to: "/data-quality", label: "Data quality lab", desc: "Rules, runs, reports" },
      { to: "/data-profiler", label: "Data profiler", desc: "Profile your own CSV: types, missing values, duplicates, outliers" },
      { to: "/debug-lab", label: "Pipeline debugging lab", desc: "Fix broken data pipelines" },
      { to: "/visual", label: "Visual learning", desc: "Watch code, data, APIs and pipelines run" },
      { to: "/data-generator", label: "Dataset generator" },
      { to: "/schema", label: "Northwind schema" },
    ],
  },
  {
    id: "projects",
    label: "Projects",
    items: [
      { to: "/projects-lab", label: "Guided projects", desc: "12 guided data projects, checked automatically" },
      { to: "/portfolio/export", label: "Portfolio export", desc: "ZIP or GitHub repository of your verified work" },
    ],
  },
  {
    id: "career",
    label: "Career",
    items: [
      { to: "/career/planner", label: "Study planner", desc: "Week-by-week plan by role" },
      { to: "/career/companies", label: "Prep by company type" },
      { to: "/career/answers", label: "Answer practice", desc: "Model answers, spaced review" },
      { to: "/mock-interview", label: "Mock interview", desc: "Timed, graded" },
      { to: "/readiness", label: "Interview readiness", desc: "Evidence-based estimate" },
      { to: "/portfolio", label: "Portfolio", desc: "Your verified work, ready to share" },
    ],
  },
];

const baseOf = (to: string) => to.split("#")[0];
const covers = (base: string, pathname: string) => base !== "/" && (pathname === base || pathname.startsWith(`${base}/`));

/** Which group the current path belongs to (for highlighting). The home page is the Home group. */
export function activeGroup(pathname: string): string | null {
  if (pathname === "/") return "home";
  for (const g of NAV_GROUPS) {
    if (g.to && (g.to === "/" ? pathname === "/" : pathname.startsWith(g.to))) return g.id;
    if (g.items?.some((i) => covers(baseOf(i.to), pathname))) return g.id;
  }
  return null;
}

export interface NavCrumb { label: string; to?: string }

/**
 * The trail for a path: its group, then the section it belongs to (the nav item with the longest matching path).
 * Detail pages (a note, a lesson, a question) end at their section, which links back to it. Empty for the home page and
 * for pages that are not in the navigation.
 */
export function breadcrumbFor(pathname: string): NavCrumb[] {
  if (pathname === "/") return [];
  let best: { group: NavGroup; item: NavItem; len: number } | undefined;
  for (const group of NAV_GROUPS) {
    for (const item of group.items ?? []) {
      const base = baseOf(item.to);
      if (item.noCrumb || !covers(base, pathname)) continue;
      if (!best || base.length > best.len) best = { group, item, len: base.length };
    }
  }
  if (!best) return [];
  const exact = baseOf(best.item.to) === pathname;
  return [{ label: best.group.label }, exact ? { label: best.item.label } : { label: best.item.label, to: best.item.to }];
}
