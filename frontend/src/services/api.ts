import type {
  AttemptHistoryItem,
  ConceptEntry,
  ExecuteResult,
  ImportedAttempt,
  ImportSummary,
  MarkdownParseResult,
  MistakeEntry,
  PreviewResult,
  Progress,
  Project,
  ProjectCreateResult,
  ProjectDetail,
  Question,
  QuestionCreateRequest,
  QuestionCreateResult,
  QuestionImportAction,
  QuestionSummary,
  ScanResult,
  SubmitResult,
  TableSchema,
  TopicItem,
  ValidateSolutionResult,
} from "../types";
import type {
  GitAttemptResult,
  GitImportHistoryItem,
  GitImportPreview,
  GitProgress,
  GitQuestionDetail,
  GitQuestionSummary,
  GitRepoState,
  GitTopic,
} from "../types/git";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(formatApiError(body, res.status));
  }
  return res.json() as Promise<T>;
}

function formatApiError(body: unknown, status: number): string {
  if (!body || typeof body !== "object") {
    return `Request failed: ${status}`;
  }
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const err = item as { loc?: unknown[]; msg?: string; type?: string };
        const field = Array.isArray(err.loc)
          ? err.loc.filter((x) => x !== "body").join(".")
          : "";
        const msg = err.msg || "Invalid value";
        return field ? `${field}: ${msg}` : msg;
      }
      return String(item);
    });
    return parts.filter(Boolean).join(" · ") || `Request failed: ${status}`;
  }
  if (detail != null) return String(detail);
  return `Request failed: ${status}`;
}

export interface QuestionFilters {
  difficulty?: string;
  topic?: string;
  status?: string;
  search?: string;
}

export const api = {
  getQuestions(filters: QuestionFilters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const qs = params.toString();
    return request<{ questions: QuestionSummary[]; total: number }>(
      `/api/questions${qs ? `?${qs}` : ""}`,
    );
  },

  getQuestion(id: number | string) {
    return request<Question>(`/api/questions/${id}`);
  },

  createQuestion(payload: QuestionCreateRequest) {
    return request<QuestionCreateResult>("/api/questions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  deleteQuestion(questionId: number) {
    return request<{
      success: boolean;
      question_id: number;
      question_number: number;
      title: string;
      message: string;
    }>(`/api/questions/${questionId}`, {
      method: "DELETE",
    });
  },

  setReferenceQuery(questionId: number, sql: string) {
    return request<{
      success: boolean;
      question_number: number;
      message: string;
      has_reference_query: boolean;
    }>(`/api/questions/${questionId}/reference`, {
      method: "PUT",
      body: JSON.stringify({ sql }),
    });
  },

  parseMarkdown(markdown: string, filename?: string) {
    return request<MarkdownParseResult>("/api/questions/parse-markdown", {
      method: "POST",
      body: JSON.stringify({ markdown, filename: filename ?? null }),
    });
  },

  async parseMarkdownUpload(mdFile: File, sqlFile?: File | null) {
    const form = new FormData();
    form.append("file", mdFile);
    if (sqlFile) form.append("sql_file", sqlFile);
    const res = await fetch(`${API_BASE}/api/questions/parse-markdown/upload`, {
      method: "POST",
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail ?? `Parse failed: ${res.status}`);
    return body as MarkdownParseResult;
  },

  executeQuery(sql: string, questionId?: number, projectId?: number | null) {
    return request<ExecuteResult>("/api/query/execute", {
      method: "POST",
      body: JSON.stringify({
        sql,
        question_id: questionId ?? null,
        project_id: projectId ?? null,
      }),
    });
  },

  submit(questionId: number, sql: string) {
    return request<SubmitResult>(`/api/questions/${questionId}/submit`, {
      method: "POST",
      body: JSON.stringify({ sql }),
    });
  },

  getAttempts(questionId: number) {
    return request<{ attempts: AttemptHistoryItem[]; total: number }>(
      `/api/questions/${questionId}/attempts`,
    );
  },

  getProgress() {
    return request<Progress>("/api/progress");
  },

  getTopics() {
    return request<{ topics: TopicItem[] }>("/api/topics");
  },

  getSchema(tables?: string[], projectId?: number | null) {
    const params = new URLSearchParams();
    if (tables && tables.length) params.set("tables", tables.join(","));
    if (projectId != null) params.set("project_id", String(projectId));
    const qs = params.toString();
    return request<{ tables: TableSchema[] }>(`/api/schema${qs ? `?${qs}` : ""}`);
  },

  listProjects() {
    return request<{ projects: Project[]; total: number }>("/api/projects");
  },

  getProject(id: number) {
    return request<ProjectDetail>(`/api/projects/${id}`);
  },

  createProject(name: string, description: string, files: File[]) {
    const form = new FormData();
    form.append("name", name);
    form.append("description", description);
    files.forEach((f) => form.append("files", f));
    // Let the browser set the multipart boundary itself.
    return fetch(`${API_BASE}/api/projects`, { method: "POST", body: form }).then(
      async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.detail ?? `Upload failed: ${res.status}`);
        return body as ProjectCreateResult;
      },
    );
  },

  deleteProject(id: number) {
    return request<{ success: boolean; message: string }>(`/api/projects/${id}`, {
      method: "DELETE",
    });
  },

  validateSolution(sql: string, projectId?: number | null) {
    return request<ValidateSolutionResult>("/api/projects/validate-solution", {
      method: "POST",
      body: JSON.stringify({ sql, project_id: projectId ?? null }),
    });
  },

  syncGithub() {
    return request<import("../types").GitHubSyncResult>("/api/github/sync", {
      method: "POST",
    });
  },

  getRepositoryProgress() {
    return request<import("../types").RepositoryProgress>("/api/progress/repository");
  },

  nextQuestionNumber() {
    return request<{ next_question_number: number; max_existing?: number | null }>(
      "/api/github/next-number",
    );
  },

  previewGithubDocs(questionNumber: number) {
    return request<{
      question_number: number;
      md_path: string;
      sql_path: string;
      markdown: string;
      sql: string;
      will_push: boolean;
      message: string;
    }>(`/api/github/docs/${questionNumber}/preview`);
  },

  confirmGithubDocs(
    questionNumber: number,
    pushToGithub = true,
    content?: { markdown?: string; sql?: string },
  ) {
    return request<{
      success: boolean;
      message: string;
      md_path: string;
      sql_path: string;
      pushed: boolean;
    }>("/api/github/docs/confirm", {
      method: "POST",
      body: JSON.stringify({
        question_number: questionNumber,
        push_to_github: pushToGithub,
        markdown: content?.markdown,
        sql: content?.sql,
      }),
    });
  },

  // ---------------------------------------------------------------------------
  // ChatGPT Import
  // ---------------------------------------------------------------------------

  async scanChatGPT(file: File): Promise<ScanResult> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/import/chatgpt/scan", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? `Scan failed: ${res.status}`);
    }
    return res.json() as Promise<ScanResult>;
  },

  async previewChatGPT(
    conversationId: string,
    startQuestion: number,
    file?: File,
  ): Promise<PreviewResult> {
    const form = new FormData();
    form.append("conversation_id", conversationId);
    form.append("start_question", String(startQuestion));
    if (file) form.append("file", file);
    const res = await fetch("/api/import/chatgpt/preview", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? `Preview failed: ${res.status}`);
    }
    return res.json() as Promise<PreviewResult>;
  },

  confirmChatGPT(
    conversationId: string,
    startQuestion: number,
    questions: QuestionImportAction[],
  ): Promise<ImportSummary> {
    return request<ImportSummary>("/api/import/chatgpt/confirm", {
      method: "POST",
      body: JSON.stringify({
        conversation_id: conversationId,
        start_question: startQuestion,
        questions,
      }),
    });
  },

  getImportedAttempts(questionId: number): Promise<{ attempts: ImportedAttempt[]; total: number }> {
    return request(`/api/questions/${questionId}/imported-attempts`);
  },

  getMistakes(): Promise<{ mistakes: MistakeEntry[]; total: number }> {
    return request("/api/mistakes");
  },

  getConcepts(): Promise<{ concepts: ConceptEntry[]; total: number }> {
    return request("/api/concepts");
  },

  // ------------------------------------------------------------------
  // Git Practice Lab
  // ------------------------------------------------------------------

  getGitTopics(): Promise<GitTopic[]> {
    return request("/api/git/topics");
  },

  getGitQuestions(filters: {
    topic?: string;
    difficulty?: string;
    status?: string;
    search?: string;
    exercise_type?: string;
    tag?: string;
  } = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const qs = params.toString();
    return request<GitQuestionSummary[]>(`/api/git/questions${qs ? `?${qs}` : ""}`);
  },

  getGitQuestion(id: number): Promise<GitQuestionDetail> {
    return request(`/api/git/questions/${id}`);
  },

  gitExecute(body: {
    question_id: number;
    command: string;
    reset?: boolean;
  }): Promise<{ ok: boolean; output: string; error?: string | null; state: GitRepoState }> {
    return request("/api/git/execute", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  gitAttempt(body: {
    question_id: number;
    command: string;
    hint_index?: number;
  }): Promise<GitAttemptResult> {
    return request("/api/git/attempt", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  gitHint(questionId: number): Promise<{
    hint_index: number;
    hint: string;
    hints_remaining: number;
    solution?: string | null;
  }> {
    return request(`/api/git/questions/${questionId}/hint`, { method: "POST" });
  },

  gitReset(questionId: number): Promise<{ ok: boolean; state: GitRepoState; message: string }> {
    return request(`/api/git/questions/${questionId}/reset`, { method: "POST" });
  },

  getGitProgress(): Promise<GitProgress> {
    return request("/api/git/progress");
  },

  gitSelect(body: {
    strategy?: string;
    topic?: string;
    difficulty?: string;
    after_id?: number;
  }): Promise<GitQuestionSummary | null> {
    return request("/api/git/select", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  gitImportPreview(file: File): Promise<GitImportPreview> {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${API_BASE}/api/git/import/preview`, {
      method: "POST",
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(formatApiError(body, res.status));
      }
      return res.json();
    });
  },

  gitImportConfirm(body: {
    preview_id: string;
    skip_duplicates?: boolean;
    import_valid_only?: boolean;
  }) {
    return request<{
      import_id: number;
      filename: string;
      total_questions: number;
      imported: number;
      skipped: number;
      failed: number;
      duplicates: number;
      modules_touched: string[];
    }>("/api/git/import/confirm", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getGitImportHistory(): Promise<GitImportHistoryItem[]> {
    return request("/api/git/import/history");
  },
};
