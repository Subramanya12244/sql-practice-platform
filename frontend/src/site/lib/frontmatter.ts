import type { ConceptGuide } from "../types";

/** Parse the simple `key: value` frontmatter used by content/*.md files. */
export function parseGuide(raw: string, fallbackSlug: string): ConceptGuide {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  let body = raw;
  if (m) {
    body = m[2];
    for (const line of m[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  const list = (v?: string) =>
    (v ?? "")
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    slug: meta.slug || fallbackSlug,
    title: meta.title || fallbackSlug,
    description: meta.description || "",
    keywords: list(meta.keywords),
    questions: list(meta.questions).map(Number).filter((n) => Number.isFinite(n)),
    related: list(meta.related),
    body: body.trim(),
  };
}

/** Split a guide body's "### Question?" items under "## Interview questions" into FAQ pairs. */
export function guideFaq(body: string): { question: string; answer: string }[] {
  const section = body.match(/##\s+Interview questions\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!section) return [];
  const out: { question: string; answer: string }[] = [];
  const parts = section[1].split(/\n###\s+/);
  for (const part of parts) {
    const [first, ...rest] = part.replace(/^###\s+/, "").split("\n");
    const answer = rest.join("\n").trim();
    if (first.trim() && answer) out.push({ question: first.trim(), answer });
  }
  return out;
}
