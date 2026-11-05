/** Site navigation, defined once. Groups render as dropdowns on desktop and an accordion on mobile. */
export interface NavItem {
  to: string;
  label: string;
  desc?: string;
}
export interface NavGroup {
  id: string;
  label: string;
  /** Short label for the desktop bar. */
  short?: string;
  to?: string; // a group without items is a plain link
  items?: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    items: [
      { to: "/learn", label: "Learning dashboard", desc: "Goals, streak, what to do next" },
      { to: "/progress", label: "Progress", desc: "Solved questions and activity" },
      { to: "/achievements", label: "Achievements & missions", desc: "XP, level, streak, daily missions" },
      { to: "/review", label: "Revision queue", desc: "Spaced review of what you solved" },
    ],
  },
  {
    id: "learn",
    label: "Learn",
    items: [
      { to: "/notes", label: "SQL notes", desc: "65 topics, beginner to expert" },
      { to: "/data-engineering", label: "Data engineering tracks", desc: "Python, ETL, warehousing, Spark, Airflow, dbt, cloud" },
      { to: "/patterns", label: "SQL patterns" },
      { to: "/concepts", label: "Concept guides" },
      { to: "/mindmaps", label: "Mind maps" },
      { to: "/shortcuts", label: "Shortcuts & cheat sheets" },
      { to: "/flashcards", label: "Flashcards" },
    ],
  },
  {
    id: "practice",
    label: "Practice",
    items: [
      { to: "/questions", label: "SQL practice", desc: "133 graded questions" },
      { to: "/practice/python", label: "Python practice", desc: "Runs in your browser" },
      { to: "/scenarios", label: "Business scenarios" },
      { to: "/interview", label: "Interview sets", desc: "Question sets by role" },
      { to: "/mock-interview", label: "Mock interview", desc: "Timed, graded" },
      { to: "/playground", label: "SQL playground", desc: "Six practice databases" },
    ],
  },
  {
    id: "projects",
    label: "Projects",
    items: [
      { to: "/projects-lab", label: "Projects lab", desc: "12 guided data projects" },
      { to: "/data-quality", label: "Data quality lab", desc: "Rules, runs, reports" },
      { to: "/data-generator", label: "Dataset generator" },
      { to: "/schema", label: "Northwind schema" },
    ],
  },
  {
    id: "ai",
    label: "Intelligence",
    items: [
      { to: "/ai-tutor", label: "AI tutor", desc: "Hints and explanations" },
      { to: "/query-visualizer", label: "Query visualizer" },
      { to: "/solution-comparison", label: "Solution comparison" },
      { to: "/readiness", label: "Interview readiness", desc: "Evidence-based estimate" },
    ],
  },
  {
    id: "career",
    label: "Career",
    items: [
      { to: "/career/planner", label: "Study planner", desc: "Week-by-week plan by role" },
      { to: "/career/companies", label: "Prep by company type" },
      { to: "/career/answers", label: "Answer practice", desc: "Model answers, spaced review" },
      { to: "/portfolio", label: "Portfolio", desc: "Export your verified work" },
    ],
  },
  {
    id: "community",
    label: "Community",
    items: [
      { to: "/challenge", label: "Weekly challenge" },
      { to: "/leaderboard", label: "Leaderboard" },
    ],
  },
];

/** Which group the current path belongs to (for highlighting). */
export function activeGroup(pathname: string): string | null {
  for (const g of NAV_GROUPS) {
    if (g.to && (g.to === "/" ? pathname === "/" : pathname.startsWith(g.to))) return g.id;
    if (g.items?.some((i) => {
      const base = i.to.split("#")[0];
      return base !== "/" && (pathname === base || pathname.startsWith(`${base}/`));
    })) return g.id;
  }
  return null;
}
