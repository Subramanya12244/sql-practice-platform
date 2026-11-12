import { matchPath } from "react-router-dom";
import type { GlossaryEntry, HelpContentModule, HelpSection } from "./types";

/**
 * HelpRegistry: every section's help, defined as local data in `content/*.ts`.
 * Each content module exports `{ sections, glossary }`. Dropping a new file into `content/` registers it,
 * so section authors never edit a shared file. This module is loaded lazily (first time help is opened).
 */
const modules = import.meta.glob<HelpContentModule>("./content/*.ts", { eager: true });

/** The section shown on pages that have no help of their own. Always last. */
export const FALLBACK_SECTION_ID = "platform";

const all = Object.values(modules).flatMap((m) => m.sections);
export const SECTIONS: HelpSection[] = [
  ...all.filter((s) => s.id !== FALLBACK_SECTION_ID).sort((a, b) => a.title.localeCompare(b.title)),
  ...all.filter((s) => s.id === FALLBACK_SECTION_ID),
];

export const GLOSSARY: GlossaryEntry[] = Object.values(modules).flatMap((m) => m.glossary);
const glossaryById = new Map(GLOSSARY.map((g) => [g.id, g]));
const sectionById = new Map(SECTIONS.map((s) => [s.id, s]));

export const getSection = (id: string) => sectionById.get(id);
export const getGlossaryEntry = (id: string) => glossaryById.get(id);

const clean = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);

/** Sections whose pages match this path (several can share one page, e.g. Pandas and NumPy). Falls back to the platform guide. */
export function sectionsForPath(pathname: string): HelpSection[] {
  const path = clean(pathname);
  const hits = SECTIONS.filter((s) => s.id !== FALLBACK_SECTION_ID && s.routes.some((r) => matchPath({ path: r, end: true }, path)));
  if (hits.length) return hits;
  const fallback = sectionById.get(FALLBACK_SECTION_ID);
  return fallback ? [fallback] : [];
}

/** True when the path has help of its own rather than the general platform guide. */
export const hasOwnHelp = (pathname: string) => sectionsForPath(pathname).some((s) => s.id !== FALLBACK_SECTION_ID);
