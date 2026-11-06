/**
 * Runtime content management (migration 010). The question bank ships with the site; admins can
 * disable a question or change its title/difficulty without a rebuild, and publish extra SQL
 * questions. Loaded once per page view and applied on top of the built-in content. If accounts
 * are off or the migration isn't applied, nothing changes.
 */
import { useEffect, useState } from "react";
import { accountsEnabled, getSupabase } from "./supabase";
import type { Question, QuestionSummary } from "../types";

export interface Override { kind: "sql" | "python"; ref: string; disabled: boolean; title: string | null; difficulty: string | null; note: string | null; version: number; updated_at: string }
export interface CustomQuestion {
  id: string; slug: string; title: string; difficulty: string; topic: string; concepts: string[]; scenario: string; problem: string; objective: string;
  expected_output: string; hints: string[]; explanation: string; reference_query: string; sort_required: boolean; published: boolean; version: number; updated_at: string;
}
export const overrideKey = (kind: "sql" | "python", ref: string | number) => `${kind}:${ref}`;

let cache: Promise<{ overrides: Map<string, Override>; custom: CustomQuestion[] }> | null = null;
export function loadContent(force = false) {
  if (force) cache = null;
  cache ??= (async () => {
    if (!accountsEnabled) return { overrides: new Map(), custom: [] };
    try {
      const sb = await getSupabase();
      const [o, c] = await Promise.all([
        sb.from("question_overrides").select("kind, ref, disabled, title, difficulty, note, version, updated_at"),
        sb.from("custom_questions").select("*").order("created_at"),
      ]);
      return {
        overrides: new Map(((o.data ?? []) as Override[]).map((x) => [overrideKey(x.kind, x.ref), x])),
        custom: o.error && c.error ? [] : ((c.data ?? []) as CustomQuestion[]),
      };
    } catch {
      return { overrides: new Map(), custom: [] };
    }
  })();
  return cache;
}

/** Overrides and published custom questions, after hydration (the prerendered page shows built-in content). */
export function useContent() {
  const [state, setState] = useState<{ overrides: Map<string, Override>; custom: CustomQuestion[]; ready: boolean }>({ overrides: new Map(), custom: [], ready: false });
  useEffect(() => { let alive = true; void loadContent().then((r) => alive && setState({ ...r, ready: true })); return () => { alive = false; }; }, []);
  return state;
}

/** Built-in question with an admin override applied (title, difficulty); undefined when disabled. */
export function applyOverride<T extends { title: string; difficulty: string }>(item: T, o: Override | undefined): T | undefined {
  if (!o) return item;
  if (o.disabled) return undefined;
  return { ...item, title: o.title || item.title, difficulty: o.difficulty || item.difficulty };
}

/** A stable question number for a custom question (100000+), so progress and history work unchanged. */
export function customNumber(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 0x01000193) >>> 0;
  return 100000 + (h % 900000);
}

/** A custom question as the practice panel's Question shape (graded against Northwind like any other). */
export function customToQuestion(c: CustomQuestion): Question {
  const summary: QuestionSummary = {
    number: customNumber(c.slug), slug: c.slug, title: c.title, topic: c.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-"), topicLabel: c.topic,
    difficulty: c.difficulty, concepts: c.concepts, hadMistakes: false, watchOutFor: "", takeaway: "",
  };
  return {
    ...summary, category: c.topic, outcome: "", problem: [c.scenario, c.problem].filter(Boolean).join("\n\n"), objective: c.objective, tables: [],
    expectedOutput: c.expected_output, approach: c.hints.map((h, i) => `${i + 1}. ${h}`).join("\n"), mySolution: "", myMistakes: [],
    solution: c.reference_query, referenceQuery: c.reference_query, sortRequired: c.sort_required, orderBy: null, why: c.explanation, pitfalls: [], followups: [], related: [],
  };
}
