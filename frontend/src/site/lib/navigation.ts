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
  { id: "overview", label: "Overview", to: "/" },
  {
    id: "learn",
    label: "Learn",
    items: [
      { to: "/learn", label: "Learning dashboard", desc: "Goals, roadmap, recommendations" },
      { to: "/notes", label: "SQL notes", desc: "65 topics, beginner to expert" },
      { to: "/data-engineering#python", label: "Python" },
      { to: "/data-engineering#etl", label: "ETL / ELT" },
      { to: "/data-engineering#warehousing", label: "Data warehousing" },
      { to: "/data-engineering#spark", label: "Apache Spark" },
      { to: "/data-engineering#airflow", label: "Apache Airflow" },
      { to: "/data-engineering#dbt", label: "dbt" },
      { to: "/data-engineering#cloud", label: "Cloud" },
      { to: "/patterns", label: "SQL patterns" },
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
      { to: "/interview", label: "Interview questions", desc: "Sets by role" },
      { to: "/scenarios", label: "Business scenarios" },
      { to: "/challenge", label: "Weekly challenge" },
      { to: "/playground", label: "SQL playground", desc: "Six practice databases" },
    ],
  },
  {
    id: "de",
    label: "Data Engineering",
    short: "Data Eng.",
    items: [
      { to: "/data-engineering", label: "Learning tracks" },
      { to: "/data-engineering#etl", label: "Pipelines (ETL / ELT)" },
      { to: "/data-engineering#warehousing", label: "Data modelling" },
      { to: "/data-engineering#airflow", label: "Orchestration" },
      { to: "/data-engineering#spark", label: "Data processing" },
      { to: "/data-engineering#cloud", label: "Cloud data services" },
    ],
  },
  { id: "projects", label: "Projects", to: "/projects-lab" },
  {
    id: "dq",
    label: "Data Quality",
    items: [
      { to: "/data-quality", label: "Data quality lab", desc: "Rules, runs, reports" },
      { to: "/data-generator", label: "Dataset generator" },
    ],
  },
  {
    id: "ai",
    label: "AI & Intelligence",
    short: "AI Tools",
    items: [
      { to: "/ai-tutor", label: "AI tutor" },
      { to: "/query-visualizer", label: "Query visualizer" },
      { to: "/solution-comparison", label: "Solution comparison" },
      { to: "/learn#practice-next", label: "Recommendations" },
    ],
  },
  {
    id: "assess",
    label: "Assessments",
    short: "Assess",
    items: [
      { to: "/mock-interview", label: "Mock interview" },
      { to: "/readiness", label: "Interview readiness" },
      { to: "/review", label: "Revision queue" },
    ],
  },
  { id: "progress", label: "Progress", to: "/progress" },
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
