import type { Question, QuestionSummary, Topic } from "../types";

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
