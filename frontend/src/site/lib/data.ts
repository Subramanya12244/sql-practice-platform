import type { Question, QuestionSummary, SchemaTable, Topic } from "../types";

type JsonFetcher = (path: string) => Promise<unknown>;

let fetcher: JsonFetcher = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
};

/** The prerender script swaps in a filesystem reader. */
export function setJsonFetcher(next: JsonFetcher) {
  fetcher = next;
  cache.clear();
}

const cache = new Map<string, Promise<unknown>>();

export function getJSON<T>(path: string): Promise<T> {
  let hit = cache.get(path);
  if (!hit) {
    hit = fetcher(path).catch((err) => {
      cache.delete(path);
      throw err;
    });
    cache.set(path, hit);
  }
  return hit as Promise<T>;
}

export const loadIndex = () => getJSON<QuestionSummary[]>("/data/index.json");
export const loadTopics = () => getJSON<Topic[]>("/data/topics.json");
export const loadQuestion = (slug: string) => getJSON<Question>(`/data/q/${slug}.json`);
export const loadSchema = () => getJSON<SchemaTable[]>("/data/schema.json");

/** Mermaid erDiagram source for the given tables (all tables when omitted). */
export function erDiagramSource(schema: SchemaTable[], only?: string[]): string {
  const keep = new Set(only?.length ? only : schema.map((t) => t.name));
  const tables = schema.filter((t) => keep.has(t.name));
  const lines = ["erDiagram"];
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.fk && keep.has(c.fk.table)) lines.push(`  ${c.fk.table} ||--o{ ${t.name} : "${c.name}"`);
    }
  }
  for (const t of tables) {
    lines.push(`  ${t.name} {`);
    for (const c of t.columns) {
      const key = [c.pk && "PK", c.fk && "FK"].filter(Boolean).join(",");
      lines.push(`    ${c.type.replace(/\(.*\)/, "")} ${c.name}${key ? ` ${key}` : ""}`);
    }
    lines.push("  }");
  }
  return lines.join("\n");
}
