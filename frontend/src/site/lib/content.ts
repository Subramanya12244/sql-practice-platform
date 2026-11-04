import type { ConceptGuide } from "../types";
import { parseGuide } from "./frontmatter";

// Each guide becomes its own lazy chunk; only the page that needs it loads it.
const guideFiles = import.meta.glob("../content/concepts/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const cheatsheetFile = import.meta.glob("../content/cheatsheet.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

function slugOf(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "");
}

export function guideSlugs(): string[] {
  return Object.keys(guideFiles).map(slugOf).sort();
}

export async function loadGuide(slug: string): Promise<ConceptGuide | undefined> {
  const entry = Object.entries(guideFiles).find(([p]) => slugOf(p) === slug);
  if (!entry) return undefined;
  return parseGuide(await entry[1](), slug);
}

export async function loadAllGuides(): Promise<ConceptGuide[]> {
  const guides = await Promise.all(guideSlugs().map((s) => loadGuide(s)));
  return guides.filter((g): g is ConceptGuide => !!g).sort((a, b) => a.title.localeCompare(b.title));
}

export async function loadCheatsheet(): Promise<ConceptGuide | undefined> {
  const loader = Object.values(cheatsheetFile)[0];
  return loader ? parseGuide(await loader(), "cheatsheet") : undefined;
}
