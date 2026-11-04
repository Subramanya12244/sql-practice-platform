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
  /** Authored practice question the repo owner hasn't attempted yet. */
  isNew?: boolean;
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
  /** Editor starting text; defaults to a template built from tables. */
  starter?: string;
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

export interface InterviewSet {
  slug: string;
  title: string;
  description: string;
  questions: string[];
  body: string;
}

export interface LessonExercise {
  index: number;
  prompt: string;
  solution: string;
  orderBy: { column: string; desc: boolean }[] | null;
}

export type LessonSegment = { kind: "md"; text: string } | { kind: "exercise"; exercise: LessonExercise };

export interface Lesson {
  slug: string;
  title: string;
  order: number;
  level: string;
  description: string;
  related: string[];
  segments: LessonSegment[];
}

export type LessonSummary = Pick<Lesson, "slug" | "title" | "order" | "level" | "description"> & { exercises: number };

export interface SchemaColumn {
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  fk: { table: string; column: string } | null;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

/** Data a page needs to render; serialized into the HTML for hydration. */
export interface PageData {
  index: QuestionSummary[];
  topics: Topic[];
  question?: Question;
  guide?: ConceptGuide;
  guides?: Pick<ConceptGuide, "slug" | "title" | "description">[];
  cheatsheet?: ConceptGuide;
  schema?: SchemaTable[];
  lesson?: Lesson;
  lessons?: LessonSummary[];
  set?: InterviewSet;
  sets?: Pick<InterviewSet, "slug" | "title" | "description">[];
  note?: import("./lib/learning").Note;
  notes?: import("./lib/learning").NoteMeta[];
  pattern?: import("./lib/learning").Pattern;
  patterns?: import("./lib/learning").PatternMeta[];
  shortcuts?: import("./lib/learning").ShortcutCategory[];
  shortcutPage?: import("./lib/learning").MarkdownPage;
  mindmap?: import("./lib/learning").MindMap;
  mindmaps?: import("./lib/learning").MindMapMeta[];
  scenario?: import("./lib/scenarios").Scenario;
  scenarios?: import("./lib/scenarios").ScenarioMeta[];
  datasets?: import("./lib/datasets").DatasetInfo[];
  /** Mind maps that link to the current note/pattern. */
  relatedMaps?: import("./lib/learning").MindMapMeta[];
}
