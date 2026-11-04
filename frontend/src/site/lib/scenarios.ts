import { splitFrontmatter } from "./learning";
import { parseOrderBy } from "./frontmatter";

export interface Scenario {
  slug: string;
  title: string;
  dataset: string;
  difficulty: string;
  description: string;
  orderBy: { column: string; desc: boolean }[] | null;
  notes: string[];
  patterns: string[];
  /** "## Heading" → markdown, in file order, without code blocks for solutions. */
  sections: { heading: string; body: string }[];
  solution: string;
  alternatives: string[];
}
export type ScenarioMeta = Omit<Scenario, "sections" | "solution" | "alternatives">;

const files = import.meta.glob("../content/scenarios/*.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const list = (v?: string) => (v ?? "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);

export function parseScenario(raw: string, fallback: string): Scenario {
  const { meta, body } = splitFrontmatter(raw);
  const blocks = (lang: string) => [...body.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map((m) => m[1].trim());
  const clean = body.replace(/```(solution|alternative)\n[\s\S]*?```/g, "").trim();
  const sections = clean.split(/^##\s+/m).filter((s) => s.trim()).map((s) => {
    const nl = s.indexOf("\n");
    return { heading: (nl < 0 ? s : s.slice(0, nl)).trim(), body: nl < 0 ? "" : s.slice(nl + 1).trim() };
  });
  return {
    slug: meta.slug || fallback,
    title: meta.title || fallback,
    dataset: meta.dataset || "northwind",
    difficulty: meta.difficulty || "Medium",
    description: meta.description || "",
    orderBy: meta.orderBy ? parseOrderBy(meta.orderBy) : null,
    notes: list(meta.notes),
    patterns: list(meta.patterns),
    sections,
    solution: blocks("solution")[0] ?? "",
    alternatives: blocks("alternative"),
  };
}

let cache: Promise<Scenario[]> | null = null;
export function loadAllScenarios(): Promise<Scenario[]> {
  cache ??= Promise.all(Object.entries(files).map(async ([p, load]) => parseScenario(await load(), p.split("/").pop()!.replace(/\.md$/, "")))).then((all) =>
    all.sort((a, b) => a.dataset.localeCompare(b.dataset) || ["Easy", "Medium", "Hard"].indexOf(a.difficulty) - ["Easy", "Medium", "Hard"].indexOf(b.difficulty) || a.title.localeCompare(b.title)),
  );
  return cache;
}
export const loadScenarioIndex = async (): Promise<ScenarioMeta[]> =>
  (await loadAllScenarios()).map(({ sections: _s, solution: _so, alternatives: _a, ...m }) => m);
export const loadScenario = async (slug: string) => (await loadAllScenarios()).find((s) => s.slug === slug);

/** Sections shown before solving vs after (explanation and follow-ups would give the answer away). */
export const AFTER_SOLVE = new Set(["Explanation", "Follow-up questions"]);
