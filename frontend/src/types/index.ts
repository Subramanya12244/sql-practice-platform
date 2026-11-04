export type QuestionStatus = "not_started" | "in_progress" | "solved";

export interface QuestionSummary {
  id: number;
  question_number: number;
  title: string;
  difficulty: string;
  topic: string;
  subtopic?: string | null;
  status: QuestionStatus;
  github_status?: string;
  has_md?: boolean;
  has_sql?: boolean;
  folder_category?: string | null;
}

export interface Question {
  id: number;
  question_number: number;
  title: string;
  description: string;
  business_problem: string;
  requirements: string[];
  difficulty: string;
  topic: string;
  subtopic?: string | null;
  tables_used: string[];
  expected_columns: string[];
  sort_required: boolean;
  starter_sql: string;
  status: QuestionStatus;
  attempt_count: number;
  objective?: string;
  expected_output?: string;
  concepts_used?: string[];
  why_this_approach?: string;
  common_mistakes?: string[];
  interview_followups?: Array<string | { question: string; answer?: string }>;
  learning_outcomes?: string[];
  folder_category?: string | null;
  related_question_numbers?: number[];
  github_md_path?: string | null;
  has_reference_query?: boolean;
  suggested_difficulty?: string | null;
  suggested_topic?: string | null;
}

export interface ExecuteResult {
  success: boolean;
  execution_time_ms?: number | null;
  row_count?: number | null;
  columns: string[];
  rows: unknown[][];
  error_type?: string | null;
  message?: string | null;
  truncated?: boolean;
}

export type RunScope = "all" | "selection";
export type ResultTarget = "same" | "new";

export interface SubmitResult {
  correct: boolean;
  message: string;
  execution_time_ms?: number | null;
  your_row_count?: number | null;
  expected_row_count?: number | null;
  feedback: string[];
  attempt_number?: number | null;
  consecutive_correct?: number | null;
  suggested_difficulty?: string | null;
  level_changed: boolean;
  /** Sample of rows only in your result / only in the expected one (public site). */
  diff?: { columns: string[]; missing: unknown[][]; extra: unknown[][]; missingCount: number; extraCount: number } | null;
}

export interface ResultTab {
  id: string;
  title: string;
  sql: string;
  scope: RunScope;
  result: ExecuteResult | null;
  submitResult?: SubmitResult | null;
}

export interface AttemptHistoryItem {
  attempt_number: number;
  is_correct: boolean;
  sql: string;
  execution_time_ms?: number | null;
  row_count?: number | null;
  created_at: string;
}

export interface TopicStats {
  topic: string;
  total: number;
  solved: number;
  accuracy: number;
}

export interface DifficultyStats {
  difficulty: string;
  total: number;
  solved: number;
}

export interface Progress {
  total_questions: number;
  solved: number;
  remaining?: number;
  in_progress: number;
  not_started: number;
  accuracy: number;
  average_score?: number | null;
  avg_attempts_per_question?: number | null;
  current_level: string;
  current_streak: number;
  best_streak: number;
  consecutive_correct: number;
  by_topic: TopicStats[];
  by_difficulty: DifficultyStats[];
  solved_over_time: { date: string; count: number }[];
  avg_execution_time_ms?: number | null;
  weak_concepts?: { name: string; mistake_count: number; kind: string }[];
  recent_mistakes?: {
    category: string;
    description: string;
    correction?: string | null;
    question_number: number;
    question_title: string;
    created_at?: string | null;
  }[];
  repository?: RepositoryProgress | null;
  questions_attempted?: number;
  questions_solved_correctly?: number;
  solved_from_repo?: number;
  solved_in_practice?: number;
}

export interface RepositoryProgress {
  total_questions: number;
  documented: number;
  incomplete: number;
  missing_from_repo: number;
  app_only: number;
  by_category: { category: string; count: number }[];
  by_difficulty: { difficulty: string; count: number }[];
  missing_md: number[];
  missing_sql: number[];
  next_question_number: number;
  max_question_number?: number | null;
  repository: string;
}

export interface ProjectColumn {
  name: string;
  original_name: string;
  pg_type: string;
  nullable: boolean;
  inferred_from: string;
  sample?: string | null;
  distinct_count: number;
  null_count: number;
}

export interface ProjectForeignKey {
  column: string;
  references_table: string;
  references_column: string;
  confidence: "high" | "medium";
  reason: string;
}

export interface ProjectTableInfo {
  table_name: string;
  source_file?: string | null;
  row_count: number;
  source_row_count: number;
  imported_rows?: number | null;
  row_count_matches?: boolean | null;
  columns: ProjectColumn[];
  primary_key: string[];
  foreign_keys: ProjectForeignKey[];
}

export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string;
  database_name: string;
  source_type: string;
  status: "creating" | "ready" | "error";
  table_count: number;
  row_count: number;
  is_default: boolean;
  error_message?: string | null;
  created_at?: string | null;
}

export interface ProjectDetail extends Project {
  folder_path?: string | null;
  er_diagram?: string | null;
  tables: ProjectTableInfo[];
  question_count: number;
}

export interface ProjectCreateResult {
  success: boolean;
  message: string;
  project: Project;
  tables: ProjectTableInfo[];
  schema_sql: string;
  er_diagram: string;
  warnings: string[];
}

export interface ValidateSolutionResult {
  success: boolean;
  message: string;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  execution_time_ms?: number | null;
  truncated: boolean;
  error_type?: string | null;
}

export interface QuestionCreateRequest {
  title: string;
  topic: string;
  difficulty: string;
  business_problem: string;
  tables_used: string[];
  expected_output?: string;
  expected_columns?: string[];
  requirements?: string[];
  objective?: string;
  subtopic?: string | null;
  folder_category?: string | null;
  concepts_used?: string[];
  starter_sql?: string;
  hints?: string[];
  sort_required?: boolean;
  why_this_approach?: string;
  common_mistakes?: string[];
  interview_followups?: unknown[];
  learning_outcomes?: string[];
  related_question_numbers?: number[];
  reference_query?: string | null;
  question_number?: number | null;
  project_id?: number | null;
}

export interface QuestionCreateResult {
  success: boolean;
  question_id: number;
  question_number: number;
  title: string;
  status: string;
  message: string;
  shifted_from_number?: number | null;
  shifted_question_number?: number | null;
  shifted_title?: string | null;
}

export interface MarkdownParseResult {
  success: boolean;
  message: string;
  title: string;
  topic: string;
  difficulty: string;
  business_problem: string;
  objective: string;
  tables_used: string[];
  expected_output: string;
  expected_columns: string[];
  requirements: string[];
  concepts_used: string[];
  common_mistakes: string[];
  why_this_approach: string;
  interview_followups: unknown[];
  learning_outcomes: string[];
  folder_category?: string | null;
  subtopic?: string | null;
  question_number?: number | null;
  reference_query: string;
  related_question_numbers: number[];
  fields_found: string[];
}

export interface GitHubSyncResult {
  success: boolean;
  message: string;
  questions_synced: number;
  source: string;
  new: number;
  modified: number;
  deleted: number;
  unchanged: number;
  auto_solved: number;
  total_in_repo: number;
  next_question_number?: number | null;
  new_question_numbers: number[];
  modified_question_numbers: number[];
  deleted_question_numbers: number[];
  new_categories: string[];
  difficulty_changes: { question_number: number; from: string; to: string }[];
  incomplete_files: { question_number: number; missing_md: boolean; missing_sql: boolean }[];
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
}

export interface TableSchema {
  table_name: string;
  columns: ColumnInfo[];
}

export interface TopicItem {
  name: string;
  question_count: number;
}

// ---------------------------------------------------------------------------
// ChatGPT Import
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  conversation_id: string;
  title: string;
  relevance_score: number;
  message_count: number;
  sql_block_count: number;
  q_range_min?: number | null;
  q_range_max?: number | null;
  match_reasons: string[];
}

export interface ScanResult {
  conversations: ConversationSummary[];
  total_found: number;
}

export interface PreviewAttempt {
  attempt_number: number;
  sql: string;
  is_correct?: boolean | null;
  score_text?: string | null;
  approach_notes?: string | null;
  feedback_count: number;
  mistake_count: number;
}

export interface PreviewQuestion {
  question_number: number;
  question_number_source: string;
  title?: string | null;
  business_problem?: string | null;
  requirements: string[];
  tables_used: string[];
  difficulty?: string | null;
  topic?: string | null;
  suggested_difficulty?: string | null;
  suggested_topic?: string | null;
  attempts: PreviewAttempt[];
  feedback_count: number;
  mistake_count: number;
  concept_count: number;
  score_text?: string | null;
  exists_in_db: boolean;
  db_question_id?: number | null;
}

export interface PreviewResult {
  conversation_id: string;
  conversation_title: string;
  start_question: number;
  end_question?: number | null;
  questions: PreviewQuestion[];
  total_questions: number;
  total_attempts: number;
  total_feedback: number;
  total_mistakes: number;
  total_scores: number;
  total_concepts: number;
}

export interface QuestionImportAction {
  question_number: number;
  action: "import" | "skip" | "update";
  title?: string;
  difficulty?: string;
  topic?: string;
}

export interface ImportSummary {
  questions_new: number;
  questions_updated: number;
  questions_skipped: number;
  attempts_imported: number;
  feedback_imported: number;
  mistakes_imported: number;
  concepts_imported: number;
  import_id: number;
}

// ---------------------------------------------------------------------------
// Imported attempts (historical ChatGPT data)
// ---------------------------------------------------------------------------

export interface ImportedFeedback {
  feedback_type: string;
  feedback_text: string;
}

export interface ImportedMistakeItem {
  category: string;
  description: string;
  correction?: string | null;
}

export interface ImportedAttempt {
  id: number;
  attempt_number: number;
  sql: string;
  is_correct?: boolean | null;
  score?: number | null;
  score_max?: number | null;
  score_text?: string | null;
  approach_notes?: string | null;
  source: "chatgpt";
  created_at?: string | null;
  feedbacks: ImportedFeedback[];
  mistakes: ImportedMistakeItem[];
}

// ---------------------------------------------------------------------------
// Mistakes
// ---------------------------------------------------------------------------

export interface MistakeEntry {
  category: string;
  description: string;
  correction?: string | null;
  question_number: number;
  question_title: string;
  created_at?: string | null;
}

// ---------------------------------------------------------------------------
// Concepts
// ---------------------------------------------------------------------------

export interface ConceptEntry {
  id: number;
  name: string;
  description?: string | null;
  question_count: number;
}

