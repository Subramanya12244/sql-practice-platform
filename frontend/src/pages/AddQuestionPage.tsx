import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Play,
  Plus,
  Upload,
} from "lucide-react";
import { api } from "../services/api";
import { useToast } from "../components/Toast";
import { useProject } from "../contexts/ProjectContext";
import type { MarkdownParseResult, ValidateSolutionResult } from "../types";

const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced", "Senior", "Expert"];

function splitList(value: string): string[] {
  return value
    .split(/[\n,;/|]+|\s+/)
    .map((v) => v.trim().replace(/^[`'"]+|[`'"]+$/g, ""))
    .filter((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v));
}

function joinList(values: string[]): string {
  return values.join("\n");
}

function splitLines(value: string): string[] {
  return value
    .split(/\n|;/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function Field({
  label,
  hint,
  children,
  required,
  error,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
  error?: string | null;
}) {
  return (
    <label className="block">
      <span className="section-label mb-0">
        {label}
        {required && <span className="ml-1 text-warn">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {error ? (
        <span className="mt-1 flex items-center gap-1 text-[11px] text-danger">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span>
      )}
    </label>
  );
}

const inputClass = "field-input";

export function AddQuestionPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeProjectId, activeProject } = useProject();
  const mdInputRef = useRef<HTMLInputElement>(null);
  const sqlInputRef = useRef<HTMLInputElement>(null);

  const nextNumber = useQuery({
    queryKey: ["next-question-number"],
    queryFn: api.nextQuestionNumber,
  });
  const topics = useQuery({ queryKey: ["topics"], queryFn: api.getTopics });

  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [useCustomTopic, setUseCustomTopic] = useState(false);
  const [difficulty, setDifficulty] = useState("Intermediate");
  const [businessProblem, setBusinessProblem] = useState("");
  const [objective, setObjective] = useState("");
  const [tables, setTables] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [expectedColumns, setExpectedColumns] = useState("");
  const [requirements, setRequirements] = useState("");
  const [concepts, setConcepts] = useState("");
  const [whyApproach, setWhyApproach] = useState("");
  const [commonMistakes, setCommonMistakes] = useState("");
  const [learningOutcomes, setLearningOutcomes] = useState("");
  const [folderCategory, setFolderCategory] = useState("");
  const [questionNumber, setQuestionNumber] = useState<number | null>(null);
  const [interviewFollowups, setInterviewFollowups] = useState<unknown[]>([]);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [sortRequired, setSortRequired] = useState(false);
  const [validation, setValidation] = useState<ValidateSolutionResult | null>(null);
  const [pasteMd, setPasteMd] = useState("");
  const [parsedSummary, setParsedSummary] = useState<string | null>(null);
  const [sqlFile, setSqlFile] = useState<File | null>(null);

  const [showValidation, setShowValidation] = useState(false);

  const existingTopics = topics.data?.topics.map((t) => t.name) ?? [];
  const resolvedTopic = useCustomTopic ? customTopic.trim() : topic.trim();

  const blockingReasons = [
    title.trim().length < 3 ? "Title needs at least 3 characters" : null,
    resolvedTopic.length === 0
      ? useCustomTopic
        ? "Enter a new topic name"
        : "Choose a topic (or add a new one)"
      : null,
    businessProblem.trim().length < 5
      ? "Business problem needs at least 5 characters"
      : null,
  ].filter((r): r is string => Boolean(r));

  function applyParsed(data: MarkdownParseResult) {
    if (data.title) setTitle(data.title);
    if (data.difficulty) setDifficulty(data.difficulty);
    if (data.business_problem) setBusinessProblem(data.business_problem);
    if (data.objective) setObjective(data.objective);
    if (data.tables_used?.length) setTables(data.tables_used.join(", "));
    if (data.expected_output) setExpectedOutput(data.expected_output);
    if (data.expected_columns?.length) setExpectedColumns(data.expected_columns.join(", "));
    if (data.requirements?.length) setRequirements(joinList(data.requirements));
    if (data.concepts_used?.length) setConcepts(data.concepts_used.join(", "));
    if (data.why_this_approach) setWhyApproach(data.why_this_approach);
    if (data.common_mistakes?.length) setCommonMistakes(joinList(data.common_mistakes));
    if (data.learning_outcomes?.length) setLearningOutcomes(joinList(data.learning_outcomes));
    if (data.folder_category) setFolderCategory(data.folder_category);
    if (data.question_number != null) setQuestionNumber(data.question_number);
    if (data.interview_followups?.length) setInterviewFollowups(data.interview_followups);
    if (data.reference_query) {
      setReferenceQuery(data.reference_query);
      setValidation(null);
    }

    const parsedTopic = (data.topic || "").trim();
    if (parsedTopic) {
      if (existingTopics.includes(parsedTopic)) {
        setUseCustomTopic(false);
        setCustomTopic("");
        setTopic(parsedTopic);
      } else {
        setUseCustomTopic(true);
        setTopic("");
        setCustomTopic(parsedTopic);
      }
    }

    setParsedSummary(
      `${data.message} Found: ${data.fields_found.join(", ") || "nothing"}`,
    );
    toast.push(data.message, data.success ? "success" : "error");
  }

  const parseUpload = useMutation({
    mutationFn: (mdFile: File) => api.parseMarkdownUpload(mdFile, sqlFile),
    onSuccess: applyParsed,
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const parsePaste = useMutation({
    mutationFn: () => api.parseMarkdown(pasteMd),
    onSuccess: applyParsed,
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const validate = useMutation({
    mutationFn: () => api.validateSolution(referenceQuery, activeProjectId),
    onSuccess: (data) => {
      setValidation(data);
      if (!data.success) toast.push(data.message || "Query failed", "error");
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const create = useMutation({
    mutationFn: api.createQuestion,
    onSuccess: (data) => {
      toast.push(data.message, "success");
      void qc.invalidateQueries({ queryKey: ["questions"] });
      void qc.invalidateQueries({ queryKey: ["progress"] });
      void qc.invalidateQueries({ queryKey: ["topics"] });
      navigate(`/questions/${data.question_number}`);
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const canSubmit = blockingReasons.length === 0 && !create.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowValidation(true);
    if (blockingReasons.length > 0) {
      toast.push(
        `Can't create yet: ${blockingReasons[0]}${
          blockingReasons.length > 1
            ? ` (+${blockingReasons.length - 1} more)`
            : ""
        }`,
        "error",
      );
      return;
    }
    create.mutate({
      title: title.trim(),
      topic: resolvedTopic,
      difficulty,
      business_problem: businessProblem.trim(),
      objective: objective.trim(),
      tables_used: splitList(tables),
      expected_output: expectedOutput.trim(),
      expected_columns: splitList(expectedColumns),
      requirements: splitLines(requirements),
      concepts_used: splitList(concepts),
      why_this_approach: whyApproach.trim(),
      common_mistakes: splitLines(commonMistakes),
      learning_outcomes: splitLines(learningOutcomes),
      interview_followups: interviewFollowups,
      folder_category: folderCategory.trim() || null,
      related_question_numbers: [],
      reference_query: referenceQuery.trim() || null,
      question_number: questionNumber,
      sort_required: sortRequired,
      project_id: activeProjectId,
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl animate-fade-in px-4 py-8">
      <div className="mb-6">
        <h1 className="page-title">Add Question</h1>
        <p className="page-subtitle">
          Upload a <span className="font-mono text-ink">.md</span> in your Northwind
          practice format and the form fills itself — or fill it in by hand. New
          questions start <span className="text-warn">unsolved</span>
          {nextNumber.data
            ? ` (markdown Q# is always used when present; next free is Q${nextNumber.data.next_question_number} if the file has no number)`
            : ""}
          . If the markdown number already exists, that older question is moved to the
          next free number so the new one keeps the markdown number.
        </p>
      </div>

      <section className="panel mb-4 space-y-3 rounded-lg p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <FileText className="h-4 w-4 text-accent" />
          Import from Markdown
        </h2>
        <p className="text-xs text-ink-faint">
          Accepts your repo format: title, Category, Difficulty, Problem Statement,
          Objective, Tables Used, Expected Output, Concepts, Approaches, Common Mistakes,
          Interview Follow-ups, Learning Outcomes. Optional companion{" "}
          <span className="font-mono">.sql</span> becomes the reference solution.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={mdInputRef}
            type="file"
            accept=".md,.markdown,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) parseUpload.mutate(file);
            }}
          />
          <input
            ref={sqlInputRef}
            type="file"
            accept=".sql"
            className="hidden"
            onChange={(e) => setSqlFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={parseUpload.isPending}
            onClick={() => mdInputRef.current?.click()}
          >
            {parseUpload.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Upload .md
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => sqlInputRef.current?.click()}
          >
            {sqlFile ? `SQL: ${sqlFile.name}` : "Optional .sql"}
          </button>
        </div>

        <Field label="Or paste markdown">
          <textarea
            className={`${inputClass} min-h-28 resize-y font-mono text-xs`}
            value={pasteMd}
            onChange={(e) => setPasteMd(e.target.value)}
            placeholder={"# Q92. Customers With No Orders\n\n**Category:** LEFT JOIN\n**Difficulty:** Intermediate\n\n## Problem Statement\n..."}
          />
        </Field>
        <button
          type="button"
          className="btn-secondary"
          disabled={pasteMd.trim().length < 10 || parsePaste.isPending}
          onClick={() => parsePaste.mutate()}
        >
          {parsePaste.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
          Extract fields
        </button>

        {parsedSummary && (
          <p className="rounded border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
            {parsedSummary}
          </p>
        )}
      </section>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="panel space-y-4 rounded-lg p-4">
          <Field
            label="Title"
            required
            error={
              showValidation && title.trim().length < 3
                ? "At least 3 characters required"
                : null
            }
          >
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Customers With No Orders"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Topic"
              required
              hint="SQL concept this question belongs to — pick an existing one or add a new topic."
              error={
                showValidation && resolvedTopic.length === 0
                  ? useCustomTopic
                    ? "Enter a new topic name"
                    : "Select a topic or add a new one"
                  : null
              }
            >
              <select
                className={inputClass}
                value={useCustomTopic ? "__new__" : topic}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setUseCustomTopic(true);
                    setTopic("");
                  } else {
                    setUseCustomTopic(false);
                    setCustomTopic("");
                    setTopic(e.target.value);
                  }
                }}
                required={!useCustomTopic}
              >
                <option value="" disabled>
                  Select a topic…
                </option>
                {existingTopics.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value="__new__">+ Add new topic…</option>
              </select>
              {useCustomTopic && (
                <input
                  className={`${inputClass} mt-2`}
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  placeholder="e.g. WINDOW FUNCTIONS, HAVING, FULL OUTER JOIN"
                  required
                  autoFocus
                />
              )}
            </Field>

            <Field label="Difficulty">
              <select
                className={inputClass}
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {questionNumber != null && (
            <p className="rounded border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
              Markdown question number{" "}
              <span className="font-mono text-ink">Q{questionNumber}</span> will be
              used. If that number is already taken, the existing question is shifted
              to the next free slot.
            </p>
          )}

          <Field
            label="Problem Statement"
            required
            error={
              showValidation && businessProblem.trim().length < 5
                ? "At least 5 characters required"
                : null
            }
          >
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              value={businessProblem}
              onChange={(e) => setBusinessProblem(e.target.value)}
              placeholder="Find every customer who has never placed an order."
            />
          </Field>

          <Field label="Objective" hint="Optional — what the question teaches.">
            <textarea
              className={`${inputClass} min-h-16 resize-y`}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </Field>
        </div>

        <div className="panel space-y-4 rounded-lg p-4">
          <Field label="Tables Used" hint="Comma or newline separated.">
            <input
              className={inputClass}
              value={tables}
              onChange={(e) => setTables(e.target.value)}
              placeholder="customers, orders"
            />
          </Field>

          <Field label="Expected Columns" hint="Comma or newline separated.">
            <input
              className={inputClass}
              value={expectedColumns}
              onChange={(e) => setExpectedColumns(e.target.value)}
              placeholder="customer_id, company_name"
            />
          </Field>

          <Field label="Expected Output">
            <textarea
              className={`${inputClass} min-h-16 resize-y`}
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
              placeholder="One row per customer with zero orders, sorted by company name."
            />
          </Field>

          <Field label="Requirements" hint="One per line.">
            <textarea
              className={`${inputClass} min-h-16 resize-y`}
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
            />
          </Field>

          <Field label="Concepts" hint="Comma separated.">
            <input
              className={inputClass}
              value={concepts}
              onChange={(e) => setConcepts(e.target.value)}
              placeholder="LEFT JOIN, NULL handling"
            />
          </Field>

          <Field label="Why This Approach">
            <textarea
              className={`${inputClass} min-h-16 resize-y`}
              value={whyApproach}
              onChange={(e) => setWhyApproach(e.target.value)}
            />
          </Field>

          <Field label="Common Mistakes" hint="One per line.">
            <textarea
              className={`${inputClass} min-h-16 resize-y`}
              value={commonMistakes}
              onChange={(e) => setCommonMistakes(e.target.value)}
            />
          </Field>

          <Field label="Learning Outcomes" hint="One per line.">
            <textarea
              className={`${inputClass} min-h-16 resize-y`}
              value={learningOutcomes}
              onChange={(e) => setLearningOutcomes(e.target.value)}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={sortRequired}
              onChange={(e) => setSortRequired(e.target.checked)}
            />
            Row order matters when checking my answer
          </label>
        </div>

        <div className="panel space-y-2 rounded-lg p-4">
          <Field
            label="Reference SQL"
            hint={`Optional. Runs against ${activeProject ? activeProject.name : "Northwind"}. If set, Submit grades by comparing result sets. You can add it later via Document.`}
          >
            <textarea
              className={`${inputClass} min-h-32 resize-y font-mono text-xs`}
              value={referenceQuery}
              onChange={(e) => {
                setReferenceQuery(e.target.value);
                setValidation(null);
              }}
              placeholder={"SELECT c.customer_id, c.company_name\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nWHERE o.order_id IS NULL;"}
            />
          </Field>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-secondary"
              disabled={!referenceQuery.trim() || validate.isPending}
              onClick={() => validate.mutate()}
            >
              {validate.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Test solution
            </button>
            {!referenceQuery.trim() && (
              <span className="text-[11px] text-ink-faint">
                Optional — without it you can still practice, but Submit can&apos;t
                auto-grade until a reference is added.
              </span>
            )}
          </div>

          {validation && (
            <div
              className={`mt-2 rounded border p-3 text-xs ${
                validation.success
                  ? "border-accent/40 bg-accent/10"
                  : "border-rose-900/50 bg-rose-900/20"
              }`}
            >
              <p
                className={`mb-2 flex items-center gap-2 font-medium ${
                  validation.success ? "text-accent" : "text-rose-400"
                }`}
              >
                {validation.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                {validation.success
                  ? `Returned ${validation.row_count} rows in ${validation.execution_time_ms ?? 0} ms`
                  : validation.message}
              </p>

              {validation.success && validation.columns.length > 0 && (
                <div className="max-h-60 overflow-auto">
                  <table className="w-full text-left">
                    <thead className="text-ink-faint">
                      <tr>
                        {validation.columns.map((c) => (
                          <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="font-mono text-ink-muted">
                      {validation.rows.slice(0, 25).map((row, i) => (
                        <tr key={i} className="border-t border-surface-border">
                          {row.map((cell, j) => (
                            <td key={j} className="whitespace-nowrap px-2 py-1">
                              {cell === null ? (
                                <span className="text-ink-faint">NULL</span>
                              ) : (
                                String(cell)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {validation.row_count > 25 && (
                    <p className="mt-1 text-ink-faint">
                      Showing the first 25 of {validation.row_count} rows.
                    </p>
                  )}
                </div>
              )}

              {validation.success && (
                <button
                  type="button"
                  className="mt-2 text-ink-faint underline hover:text-ink"
                  onClick={() =>
                    setExpectedColumns(validation.columns.join(", "))
                  }
                >
                  Use these columns as the expected columns
                </button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {blockingReasons.length > 0 && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-3 text-sm text-warn">
              <p className="mb-1 flex items-center gap-2 font-medium text-ink">
                <AlertCircle className="h-4 w-4 text-warn" />
                Can&apos;t create yet — fix these:
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-ink-muted">
                {blockingReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="btn-primary"
              disabled={create.isPending}
              title={
                blockingReasons.length
                  ? blockingReasons.join(" · ")
                  : "Create question"
              }
            >
              {create.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create Question
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate("/questions")}
            >
              Cancel
            </button>
            {!canSubmit && !create.isPending && (
              <span className="text-xs text-ink-faint">
                {blockingReasons.length} required field
                {blockingReasons.length === 1 ? "" : "s"} missing
              </span>
            )}
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}
