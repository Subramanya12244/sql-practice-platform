/** Data shapes produced by scripts/build_public_data.py. */

export interface Followup {
  question: string;
  answer: string;
}

export interface QuestionSummary {
  number: number;
  slug: string;
  title: string;
  topic: string;
  topicLabel: string;
  difficulty: string;
  concepts: string[];
  hadMistakes: boolean;
  watchOutFor: string;
  takeaway: string;
  /** Short forms for flashcards and cards (index.json only). */
  problemShort?: string;
  answerShort?: string;
  mistakeShort?: string;
}

export interface Question extends QuestionSummary {
  category: string;
  outcome: string;
  problem: string;
  objective: string;
  tables: string[];
  expectedOutput: string;
  approach: string;
  mySolution: string;
  myMistakes: string[];
  solution: string;
  referenceQuery: string;
  sortRequired: boolean;
  /** Top-level ORDER BY keys of the reference query; null when not plain columns. */
  orderBy?: { column: string; desc: boolean }[] | null;
  why: string;
  pitfalls: string[];
  followups: Followup[];
  related: number[];
}

export interface Topic {
  slug: string;
  label: string;
  folder: string;
  questions: number[];
}

export interface ConceptGuide {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  questions: number[];
  related: string[];
  body: string;
}

/** Data a page needs to render; serialized into the HTML for hydration. */
export interface PageData {
  index: QuestionSummary[];
  topics: Topic[];
  question?: Question;
  guide?: ConceptGuide;
  guides?: Pick<ConceptGuide, "slug" | "title" | "description">[];
  cheatsheet?: ConceptGuide;
}
