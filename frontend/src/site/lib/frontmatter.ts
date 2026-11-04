import type { ConceptGuide, Lesson, LessonSegment } from "../types";

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

/** "unit_price DESC, p.product_name" → sort keys matched against result column names. */
export function parseOrderBy(spec: string): { column: string; desc: boolean }[] | null {
  const keys = spec
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      const [col, dir] = k.split(/\s+/);
      return { column: col.split(".").pop()!.toLowerCase(), desc: /^desc$/i.test(dir ?? "") };
    });
  return keys.length ? keys : null;
}

/** A lesson is a guide whose body may contain ```exercise blocks (prompt/orderBy, `---`, solution SQL). */
export function parseLesson(raw: string, fallbackSlug: string): Lesson {
  const g = parseGuide(raw, fallbackSlug);
  const meta = raw.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
  const field = (k: string) => meta.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1].trim() ?? "";
  const segments: LessonSegment[] = [];
  const re = /```exercise\s*\n([\s\S]*?)\n---\s*\n([\s\S]*?)\n```/g;
  let last = 0;
  let index = 0;
  for (let m; (m = re.exec(g.body)); ) {
    if (m.index > last) segments.push({ kind: "md", text: g.body.slice(last, m.index) });
    const head = m[1];
    const prompt = head.match(/^prompt:\s*([\s\S]*?)(?=^\w+:|$(?![\s\S]))/m)?.[1].trim() ?? "";
    const orderBy = head.match(/^orderBy:\s*(.+)$/m)?.[1];
    segments.push({ kind: "exercise", exercise: { index: index++, prompt, solution: m[2].trim(), orderBy: orderBy ? parseOrderBy(orderBy) : null } });
    last = m.index + m[0].length;
  }
  if (last < g.body.length) segments.push({ kind: "md", text: g.body.slice(last) });
  return {
    slug: g.slug,
    title: g.title,
    order: Number(field("order")) || 0,
    level: field("level") || "Beginner",
    description: g.description,
    related: g.related,
    segments: segments.filter((s) => s.kind === "exercise" || s.text.trim()),
  };
}
