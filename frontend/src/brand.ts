/** Single source of truth for the product identity (public site and local app). */
export const BRAND = {
  name: "DataForge",
  tagline: "Learn. Practice. Build. Master Data.",
  description:
    "An integrated learning and development platform for SQL, Python, Data Engineering, Data Analytics and real-world data projects.",
  /** Short line for search snippets and social cards. */
  short: "Free SQL, Python and data engineering practice — real PostgreSQL in your browser.",
  colors: { primary: "#2D5BFF", primaryOnDark: "#7C9BFF", ink: "#070B14", ember: "#FF7A2F" },
} as const;
