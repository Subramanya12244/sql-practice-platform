export type GitQuestionStatus = "not_started" | "in_progress" | "solved" | "incorrect";

export interface GitTopic {
  id: number;
  slug: string;
  title: string;
  description: string;
  sort_order: number;
  question_count: number;
  solved_count: number;
}

export interface GitQuestionSummary {
  id: number;
  stable_id?: string;
  question_number: number;
  title: string;
  topic: string;
  topic_slug: string;
  difficulty: string;
  mode: string;
  exercise_type?: string;
  concepts: string[];
  tags?: string[];
  status: GitQuestionStatus;
  attempt_count: number;
  hints_used: number;
}

export interface GitFileChange {
  path: string;
  status: string;
}

export interface GitRepoState {
  repo_name: string;
  initialized: boolean;
  current_branch: string | null;
  head: string;
  detached: boolean;
  branches: Record<string, string>;
  working_tree: GitFileChange[];
  staged: GitFileChange[];
  untracked: string[];
  remotes: Record<string, string>;
  tracking: Record<string, string>;
  stash: Array<{ message: string; base_head?: string; paths?: string[] }>;
  commits: Array<{ hash: string; message: string; parents: string[] }>;
  merge_in_progress: boolean;
  rebase_in_progress: boolean;
  files?: string[];
}

export interface GitQuestionDetail extends GitQuestionSummary {
  scenario: string;
  objective: string;
  task: string;
  repository_state: GitRepoState | null;
  allowed_commands: string[];
  hints_available: number;
  common_mistakes: string[];
  choices?: Array<{ key?: string; text?: string }>;
}

export interface GitAttemptResult {
  correct: boolean;
  result: string;
  output: string;
  state: GitRepoState;
  state_changes: string[];
  feedback: string;
  explanation?: string | null;
  next_hint?: string | null;
  concept_tip?: string | null;
  status: string;
  attempt_count: number;
}

export interface GitProgress {
  skill_score: number;
  solved_count: number;
  total_questions: number;
  accuracy: number;
  attempt_count: number;
  hints_used: number;
  current_streak: number;
  best_streak: number;
  average_attempts: number;
  topic_mastery: Array<{
    slug: string;
    title: string;
    total: number;
    solved: number;
    percent: number;
  }>;
  module_count?: number;
  modules_with_content?: number;
}

export interface GitImportIssue {
  level: string;
  message: string;
}

export interface GitImportExercise {
  stable_id: string;
  exercise_code: string;
  module_title: string;
  module_slug: string;
  title: string;
  exercise_type: string;
  difficulty: string;
  task: string;
  issues?: GitImportIssue[];
  is_duplicate?: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface GitImportPreview {
  preview_id: string;
  filename: string;
  modules: Array<{ title: string; slug: string }>;
  exercises: GitImportExercise[];
  counts: {
    total: number;
    modules: number;
    valid: number;
    warnings: number;
    errors: number;
    duplicates: number;
  };
  by_difficulty: Record<string, number>;
  by_type: Record<string, number>;
}

export interface GitImportHistoryItem {
  id: number;
  filename: string;
  imported_at?: string | null;
  total_questions: number;
  imported_count: number;
  skipped_count: number;
  failed_count: number;
  duplicate_count: number;
  warning_count?: number;
  modules_touched: string[];
  status: string;
}
