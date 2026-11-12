/**
 * DataForge Guide: content schema. Help is plain local data (no network, no AI service).
 * Every route, slug and control named here must exist; `validate.ts` and the tests check that.
 */

/** Lucide icon names the help UI can show (kept small so the bundle stays small). */
export type HelpIcon =
  | "database" | "code" | "table" | "workflow" | "calendar" | "folder" | "notebook" | "chart" | "eye" | "compass" | "layers" | "globe" | "cpu";

export interface HelpLink {
  label: string;
  /** A real route or content path, e.g. "/questions/q25-x" or "/notes/left-join". */
  to: string;
  /** One short reason to follow the link. */
  why?: string;
}

export interface HelpControl {
  /** The label the learner sees on screen. */
  name: string;
  what: string;
  /** When to use it, or a gotcha. */
  tip?: string;
}

export interface HelpMistake {
  mistake: string;
  fix: string;
}

/** Where "Try Example" sends the code. */
export type ExampleTarget = "sql" | "python" | "etl" | "none";

export interface HelpExample {
  id: string;
  title: string;
  target: ExampleTarget;
  language: "sql" | "python" | "text";
  code: string;
  /** SQL: dataset id the code was verified on ("northwind", ...). */
  dataset?: string;
  /** What the example demonstrates, in plain words. */
  explains: string;
  /** Human-readable expected result. For `sql` and `python` examples it is checked by tests against the real engine. */
  expected: string;
  /** SQL: verified first rows (columns + rows as printed). */
  expectedRows?: { columns: string[]; rows: (string | number | null)[][] };
  /** Python: verified stdout. */
  expectedStdout?: string;
}

export interface TourStep {
  id: string;
  title: string;
  /** What this element is for. */
  body: string;
  /** How to interact with it. */
  how?: string;
  /**
   * CSS selector(s); the first one that matches a visible element is highlighted.
   * Prefer `[data-help="..."]`. With no match the step shows centred and says the element is not on screen.
   */
  target?: string | string[];
  /** Concrete page this step lives on (overrides the tour's `route`). The tour goes there itself when the element is not on the current page. */
  route?: string;
}

export interface HelpTour {
  id: string;
  title: string;
  /** Default page for every step: a real concrete path, e.g. "/questions/q01-product-revenue". Leave out when the section is one page. */
  route?: string;
  steps: TourStep[];
}

/** A searchable extra entry: a concept, a common error, a workflow or a tutorial. */
export interface HelpTopic {
  id: string;
  kind: "concept" | "error" | "workflow" | "tutorial";
  title: string;
  body: string;
  /** Ordered steps (workflows and tutorials). */
  steps?: string[];
  /** Extra search words: synonyms, error codes, misspellings. */
  keywords?: string[];
}

export interface HelpSection {
  /** kebab-case, unique, e.g. "sql-practice". */
  id: string;
  title: string;
  /** One line shown in lists and search. */
  blurb: string;
  icon: HelpIcon;
  /** react-router path patterns this section's pages use, e.g. "/questions/:slug". */
  routes: string[];
  /**
   * Set only when `routes` live on another branch that is not merged here yet (name the branch).
   * Route and link checks are skipped for such a section, and a tripwire test fails once the routes exist, so this flag gets removed.
   */
  pending?: string;
  /** Where "open this section" sends the learner (one of `routes`, no params). */
  home: string;
  keywords: string[];
  /** 1. Overview */
  overview: { what: string; why: string; when: string };
  /** 2. What can I do here? */
  canDo: string[];
  /** 3. How to use this section (ordered). */
  howTo: string[];
  /** 4. Important controls, as labelled on screen. */
  controls: HelpControl[];
  /** 5. Practical example. */
  example?: HelpExample;
  /** 6. Common mistakes. */
  mistakes: HelpMistake[];
  /** 7. Tips and shortcuts. */
  tips: string[];
  /** 8. Related sections. */
  related: HelpLink[];
  /** Bottom of the panel: next steps into real content. */
  recommendations: HelpLink[];
  /** 9. Guided walkthrough. */
  tour?: HelpTour;
  /** Searchable concepts, errors, workflows, tutorials. */
  topics: HelpTopic[];
}

/** A short, beginner-friendly explanation shown by `<HelpTooltip id="..."/>`. */
export interface GlossaryEntry {
  id: string;
  term: string;
  /** 1-3 sentences, plain words, no jargon you did not explain. */
  short: string;
  /** Optional second paragraph or tiny example. */
  more?: string;
  /** Section to open for the full story. */
  section?: string;
  keywords?: string[];
}

export interface HelpContentModule {
  sections: HelpSection[];
  glossary: GlossaryEntry[];
}
