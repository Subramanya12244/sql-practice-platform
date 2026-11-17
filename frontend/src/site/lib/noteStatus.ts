import type { Progress } from "./progress";

/** A note counts as learned when it is read and at least half its linked questions are solved. Opening a note never counts. */
export function noteStatus(n: { slug: string; questions: number[] }, p: Pick<Progress, "read" | "questions">): "new" | "read" | "learned" {
  if (!p.read?.[n.slug]) return "new";
  const solved = n.questions.filter((q) => p.questions[q]?.solvedAt).length;
  return !n.questions.length || solved * 2 >= n.questions.length ? "learned" : "read";
}
