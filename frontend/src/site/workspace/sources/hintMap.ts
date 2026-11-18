/**
 * Shared, pure helpers for turning authored hint lists into the five-level ladder. Level 5 is the solution and is never built here.
 */
import type { Hint, HintLevel } from "../types";

const norm = (s: string) => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").replace(/\s*([(),;=<>+\-*/])\s*/g, "$1").replace(/;+$/, "").trim();

/**
 * Does this hint contain the whole solution? Some authored last hints are "the answer is X". Those belong to level 5 (on request),
 * so they are dropped from levels 1 to 4. Whitespace, backticks, case and the trailing semicolon are ignored.
 */
export function leaksSolution(hint: string, solution: string | undefined): boolean {
  const s = norm(solution ?? "");
  if (s.length < 12) return false;
  return norm(hint).includes(s);
}

const lines = (items: string[]) => (items.length === 1 ? items[0] : items.map((h) => `- ${h}`).join("\n"));

/**
 * Authored hints, gentlest first, spread over levels 2 to 4:
 * one hint: level 2; two: levels 2 and 4; three or more: first at 2, the middle ones together at 3, the last at 4.
 */
export function distributeHints(authored: string[], solution?: string): Hint[] {
  const h = authored.map((x) => x.trim()).filter((x) => x && !leaksSolution(x, solution));
  const out: Hint[] = [];
  const add = (level: HintLevel, title: string, body: string) => out.push({ level, title, body });
  if (h.length === 0) return out;
  add(2, "Approach", h[0]);
  if (h.length >= 3) add(3, "Partial structure", lines(h.slice(1, -1)));
  if (h.length >= 2) add(4, "Detailed hint", h[h.length - 1]);
  return out;
}

/** Level 1: which ideas the exercise needs. */
export function conceptHint(concepts: string[], fallback: string): Hint {
  const list = concepts.slice(0, 5);
  return { level: 1, title: "Concept", body: list.length ? `This exercise practises ${list.map((c) => `**${c}**`).join(", ")}.` : fallback };
}

/** Ladder in order, with level 1 first. Levels with no content are simply absent. */
export const ladder = (hints: Hint[]): Hint[] => [...hints].sort((a, b) => a.level - b.level);
