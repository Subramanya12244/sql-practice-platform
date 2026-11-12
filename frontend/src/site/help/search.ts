import type { GlossaryEntry, HelpSection } from "./types";

/** Local help search: no network, no AI. A small ranked matcher over everything the help content says. */

export type HelpCategory = "features" | "concepts" | "buttons" | "workflows" | "errors" | "tutorials";
export const CATEGORY_LABEL: Record<HelpCategory, string> = {
  features: "Features", concepts: "Concepts", buttons: "Buttons", workflows: "Workflows", errors: "Common errors", tutorials: "Tutorials",
};

export interface HelpDoc {
  /** Unique across all docs. */
  key: string;
  category: HelpCategory;
  title: string;
  text: string;
  keywords: string;
  sectionId: string;
  sectionTitle: string;
  /** Anchor inside the section's help: "control-<n>", "topic-<id>", "block-<id>". Empty for sections and unassigned terms. */
  anchor: string;
  /** Set for glossary terms that belong to no section: expanded in place. */
  inline?: boolean;
}

export interface HelpHit { doc: HelpDoc; score: number }

const strip = (s: string) => s.replace(/[`*_]/g, "");

export function buildDocs(sections: HelpSection[], glossary: GlossaryEntry[]): HelpDoc[] {
  const docs: HelpDoc[] = [];
  const titleOf = new Map(sections.map((s) => [s.id, s.title]));
  for (const s of sections) {
    const base = { sectionId: s.id, sectionTitle: s.title };
    docs.push({ ...base, key: `s:${s.id}`, category: "features", title: s.title, text: `${s.blurb} ${s.overview.what} ${s.overview.why} ${s.overview.when} ${s.canDo.join(" ")}`, keywords: s.keywords.join(" "), anchor: "" });
    docs.push({ ...base, key: `h:${s.id}`, category: "workflows", title: `How to use ${s.title}`, text: s.howTo.join(" "), keywords: s.keywords.join(" "), anchor: "block-how" });
    s.controls.forEach((c, i) => docs.push({ ...base, key: `c:${s.id}:${i}`, category: "buttons", title: c.name, text: `${c.what} ${c.tip ?? ""}`, keywords: "", anchor: `control-${i}` }));
    s.mistakes.forEach((m, i) => docs.push({ ...base, key: `m:${s.id}:${i}`, category: "errors", title: m.mistake, text: m.fix, keywords: "", anchor: "block-mistakes" }));
    if (s.example) docs.push({ ...base, key: `e:${s.id}`, category: "tutorials", title: `Example: ${s.example.title}`, text: `${s.example.explains} ${s.example.expected}`, keywords: s.example.language, anchor: "block-example" });
    if (s.tour) docs.push({ ...base, key: `t:${s.id}`, category: "tutorials", title: s.tour.title, text: s.tour.steps.map((x) => `${x.title} ${x.body}`).join(" "), keywords: "guided tour walkthrough start tour", anchor: "block-tour" });
    for (const t of s.topics) {
      const category: HelpCategory = t.kind === "error" ? "errors" : t.kind === "workflow" ? "workflows" : t.kind === "tutorial" ? "tutorials" : "concepts";
      docs.push({ ...base, key: `p:${s.id}:${t.id}`, category, title: t.title, text: `${t.body} ${(t.steps ?? []).join(" ")}`, keywords: (t.keywords ?? []).join(" "), anchor: `topic-${t.id}` });
    }
  }
  for (const g of glossary) {
    const owner = g.section && titleOf.has(g.section) ? g.section : "";
    docs.push({ key: `g:${g.id}`, category: "concepts", title: g.term, text: `${g.short} ${g.more ?? ""}`, keywords: (g.keywords ?? []).join(" "), sectionId: owner, sectionTitle: owner ? titleOf.get(owner)! : "Glossary", anchor: owner ? `term-${g.id}` : "", inline: !owner });
  }
  return docs;
}

/** Common alternative words a learner might type. */
const SYNONYMS: Record<string, string[]> = {
  btn: ["button"], bug: ["error"], exception: ["error"], fail: ["error"], failing: ["error"], wrong: ["error", "mistake"],
  start: ["begin", "tour"], begin: ["start"], delete: ["remove", "clear"], remove: ["delete", "clear"], clear: ["reset"],
  undo: ["reset"], restart: ["reset", "replay"], retry: ["retries"], paginate: ["pagination", "cursor"], join: ["joins"],
  dataframe: ["pandas"], array: ["numpy"], chart: ["visualization", "plot", "graph"], graph: ["chart"],
};

export const normalise = (s: string) => strip(s).toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => normalise(s).split(/[\s-]+/).filter((t) => t.length > 0);

/** Does any word in `hay` start with (or equal) `t`? Short tokens (<3) must match whole words. */
function wordHit(hayWords: string[], t: string): boolean {
  return hayWords.some((w) => (t.length < 3 ? w === t : w.startsWith(t) || (t.length >= 4 && w.length >= 5 && w.includes(t))));
}

export function searchDocs(docs: HelpDoc[], query: string, opts: { category?: HelpCategory | "all"; limit?: number; sectionId?: string } = {}): HelpHit[] {
  const q = normalise(query);
  if (!q) return [];
  const qt = tokens(q);
  const out: HelpHit[] = [];
  for (const doc of docs) {
    if (opts.category && opts.category !== "all" && doc.category !== opts.category) continue;
    const title = normalise(doc.title);
    const titleWords = tokens(doc.title);
    const kwWords = tokens(doc.keywords);
    const textWords = tokens(doc.text);
    let score = 0;
    let ok = true;
    for (const t of qt) {
      const alts = [t, ...(SYNONYMS[t] ?? [])];
      let best = 0;
      for (const a of alts) {
        const w = a === t ? 1 : 0.6;
        if (wordHit(titleWords, a)) best = Math.max(best, 10 * w);
        else if (wordHit(kwWords, a)) best = Math.max(best, 7 * w);
        else if (wordHit(textWords, a)) best = Math.max(best, 2 * w);
      }
      if (best === 0) { ok = false; break; }
      score += best;
    }
    if (!ok) continue;
    if (title === q) score += 40;
    else if (title.startsWith(q)) score += 20;
    else if (title.includes(q)) score += 12;
    else if (normalise(doc.keywords).includes(q)) score += 8;
    if (doc.category === "features") score += 1;
    if (opts.sectionId && doc.sectionId === opts.sectionId) score += 3;
    out.push({ doc, score });
  }
  return out.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title)).slice(0, opts.limit ?? 30);
}
