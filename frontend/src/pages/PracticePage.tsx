import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ArrowRight, BookmarkPlus, Database, List } from "lucide-react";
import { api } from "../services/api";
import { QuestionSidebar } from "../components/QuestionSidebar";
import { QuestionPanel } from "../components/QuestionPanel";
import { SqlEditor, type RunRequest } from "../components/SqlEditor";
import { ResultsPanel } from "../components/ResultsPanel";
import { AttemptHistory } from "../components/AttemptHistory";
import { useToast } from "../components/Toast";
import { useProject } from "../contexts/ProjectContext";
import type { ResultTab, ResultTarget, RunScope, SubmitResult } from "../types";

const MAX_RESULT_TABS = 10;

function nextTabId() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function tabTitle(scope: RunScope, index: number) {
  return scope === "selection" ? `Selection ${index}` : `Result ${index}`;
}

export function PracticePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { activeProjectId, activeProject } = useProject();

  const [difficulty, setDifficulty] = useState("");
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [sql, setSql] = useState("");
  const [resultTabs, setResultTabs] = useState<ResultTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [showNext, setShowNext] = useState(false);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [resultTarget, setResultTarget] = useState<ResultTarget>("same");
  const resultsPanelRef = useRef<ImperativePanelHandle>(null);
  const tabCounterRef = useRef(0);
  const pendingRunRef = useRef<{
    tabId: string;
    sql: string;
    scope: RunScope;
  } | null>(null);

  const questionsQuery = useQuery({
    queryKey: ["questions", difficulty, topic, status, search],
    queryFn: () =>
      api.getQuestions({
        difficulty: difficulty || undefined,
        topic: topic || undefined,
        status: status || undefined,
        search: search || undefined,
      }),
  });

  const topicsQuery = useQuery({
    queryKey: ["topics"],
    queryFn: api.getTopics,
  });

  const questionId = id ? Number(id) : questionsQuery.data?.questions[0]?.question_number;

  const questionQuery = useQuery({
    queryKey: ["question", questionId],
    queryFn: () => api.getQuestion(questionId!),
    enabled: Number.isFinite(questionId),
  });

  const schemaQuery = useQuery({
    queryKey: ["schema", questionQuery.data?.tables_used, activeProjectId],
    queryFn: () =>
      api.getSchema(
        activeProjectId ? undefined : questionQuery.data?.tables_used,
        activeProjectId,
      ),
    enabled: !!questionQuery.data,
    retry: 1,
  });

  const attemptsQuery = useQuery({
    queryKey: ["attempts", questionQuery.data?.id],
    queryFn: () => api.getAttempts(questionQuery.data!.id),
    enabled: !!questionQuery.data?.id,
  });

  useEffect(() => {
    if (!id && questionsQuery.data?.questions.length) {
      navigate(`/questions/${questionsQuery.data.questions[0].question_number}`, {
        replace: true,
      });
    }
  }, [id, questionsQuery.data, navigate]);

  useEffect(() => {
    if (!questionQuery.data) return;
    setResultTabs([]);
    setActiveTabId(null);
    setSubmitResult(null);
    setShowNext(false);
    setResultsCollapsed(false);
    tabCounterRef.current = 0;
    resultsPanelRef.current?.expand();
    const last = attemptsQuery.data?.attempts?.slice(-1)[0]?.sql;
    setSql(last || questionQuery.data.starter_sql || "");
  }, [questionQuery.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const expandResults = () => {
    resultsPanelRef.current?.expand();
    setResultsCollapsed(false);
  };

  const toggleResults = () => {
    const panel = resultsPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setResultsCollapsed(false);
    } else {
      panel.collapse();
      setResultsCollapsed(true);
    }
  };

  const applyExecuteResult = useCallback(
    (data: Awaited<ReturnType<typeof api.executeQuery>>) => {
      const pending = pendingRunRef.current;
      if (!pending) return;
      pendingRunRef.current = null;

      setResultTabs((prev) => {
        const exists = prev.some((tab) => tab.id === pending.tabId);
        if (!exists) {
          return [
            ...prev,
            {
              id: pending.tabId,
              title: tabTitle(pending.scope, tabCounterRef.current),
              sql: pending.sql,
              scope: pending.scope,
              result: data,
              submitResult: null,
            },
          ].slice(-MAX_RESULT_TABS);
        }
        return prev.map((tab) =>
          tab.id === pending.tabId
            ? {
                ...tab,
                sql: pending.sql,
                scope: pending.scope,
                result: data,
                submitResult: null,
              }
            : tab,
        );
      });
      setActiveTabId(pending.tabId);
      setSubmitResult(null);
      expandResults();
      if (!data.success) toast.push(data.message ?? "Query failed", "error");
    },
    [toast],
  );

  const runMutation = useMutation({
    mutationFn: (request: RunRequest) =>
      api.executeQuery(request.sql, questionQuery.data?.id, activeProjectId),
    onSuccess: applyExecuteResult,
    onError: (e: Error) => {
      pendingRunRef.current = null;
      toast.push(e.message, "error");
    },
  });

  const handleRun = (request: RunRequest) => {
    const sqlToRun = request.sql.trim();
    if (!sqlToRun) {
      toast.push("Nothing to run", "info");
      return;
    }

    const createNew =
      resultTarget === "new" || resultTabs.length === 0 || !activeTabId;
    let tabId = activeTabId;

    if (createNew) {
      tabCounterRef.current += 1;
      tabId = nextTabId();
      const placeholder: ResultTab = {
        id: tabId,
        title: tabTitle(request.scope, tabCounterRef.current),
        sql: request.sql,
        scope: request.scope,
        result: null,
        submitResult: null,
      };
      setResultTabs((prev) => {
        const merged = [...prev, placeholder];
        return merged.length > MAX_RESULT_TABS
          ? merged.slice(merged.length - MAX_RESULT_TABS)
          : merged;
      });
      setActiveTabId(tabId);
    }

    pendingRunRef.current = {
      tabId: tabId!,
      sql: request.sql,
      scope: request.scope,
    };

    runMutation.mutate(request);
  };

  const closeTab = (idToClose: string) => {
    setResultTabs((prev) => {
      const next = prev.filter((t) => t.id !== idToClose);
      if (activeTabId === idToClose) {
        setActiveTabId(next[next.length - 1]?.id ?? null);
      }
      return next;
    });
  };

  const submitMutation = useMutation({
    mutationFn: () => api.submit(questionQuery.data!.id, sql),
    onSuccess: (data) => {
      setSubmitResult(data);
      setResultTabs((prev) => {
        if (!activeTabId) {
          tabCounterRef.current += 1;
          const idNew = nextTabId();
          setActiveTabId(idNew);
          return [
            ...prev,
            {
              id: idNew,
              title: `Submit ${tabCounterRef.current}`,
              sql,
              scope: "all" as RunScope,
              result: null,
              submitResult: data,
            },
          ];
        }
        return prev.map((tab) =>
          tab.id === activeTabId ? { ...tab, submitResult: data } : tab,
        );
      });
      setShowNext(data.correct);
      expandResults();
      void qc.invalidateQueries({ queryKey: ["questions"] });
      void qc.invalidateQueries({ queryKey: ["progress"] });
      void qc.invalidateQueries({ queryKey: ["attempts"] });
      void qc.invalidateQueries({ queryKey: ["question", questionId] });
      toast.push(
        data.correct ? "Correct!" : "Not quite — keep iterating.",
        data.correct ? "success" : "error",
      );
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const saveReference = useMutation({
    mutationFn: () => api.setReferenceQuery(questionQuery.data!.id, sql),
    onSuccess: (data) => {
      toast.push(data.message, "success");
      void qc.invalidateQueries({ queryKey: ["question", questionId] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const topicNames = useMemo(
    () => topicsQuery.data?.topics.map((t) => t.name) ?? [],
    [topicsQuery.data],
  );

  const nextQuestion = useMemo(() => {
    const list = questionsQuery.data?.questions ?? [];
    if (!questionQuery.data) return null;
    const idx = list.findIndex(
      (q) => q.question_number === questionQuery.data.question_number,
    );
    return idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  }, [questionsQuery.data, questionQuery.data]);

  return (
    <div className="flex h-full min-h-0">
      <QuestionSidebar
        questions={questionsQuery.data?.questions ?? []}
        selectedId={questionQuery.data?.question_number}
        loading={questionsQuery.isLoading}
        difficulty={difficulty}
        topic={topic}
        status={status}
        search={search}
        topics={topicNames}
        onDifficulty={setDifficulty}
        onTopic={setTopic}
        onStatus={setStatus}
        onSearch={setSearch}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {questionQuery.data && !questionQuery.data.has_reference_query && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs text-ink-muted">
            <p>
              <span className="font-medium text-accent">No reference yet</span>
              {" — "}
              you can still <span className="text-ink">Submit</span>. The first
              successful submit is saved as the hidden grading reference
              automatically. Optional: save the editor SQL as reference without
              submitting.
            </p>
            <button
              type="button"
              className="btn-secondary shrink-0"
              disabled={!sql.trim() || saveReference.isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    "Save the current editor SQL as the grading reference for this question?",
                  )
                ) {
                  return;
                }
                saveReference.mutate();
              }}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              {saveReference.isPending ? "Saving…" : "Save as reference"}
            </button>
          </div>
        )}
        {activeProject && (
          <div className="flex items-center gap-2 border-b border-accent/20 bg-accent-dim/40 px-4 py-2 text-xs text-ink-muted">
            <Database className="h-3.5 w-3.5 text-accent" />
            Running against{" "}
            <span className="font-medium text-ink">{activeProject.name}</span>
            <span className="text-ink-faint">· {activeProject.database_name}</span>
          </div>
        )}
        {questionQuery.isLoading && (
          <div className="flex h-full items-center justify-center text-ink-faint">
            Loading question…
          </div>
        )}
        {questionQuery.isError && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8">
            <p className="text-danger">Question not found.</p>
            <Link to="/questions" className="btn-secondary">
              Browse questions
            </Link>
          </div>
        )}
        {questionQuery.data && (
          <>
            <PanelGroup direction="vertical" className="min-h-0 flex-1">
              <Panel defaultSize={42} minSize={20}>
                <PanelGroup direction="horizontal" className="h-full">
                  <Panel defaultSize={42} minSize={25}>
                    <QuestionPanel
                      question={questionQuery.data}
                      schemas={schemaQuery.data?.tables ?? []}
                      attemptPanel={
                        <AttemptHistory attempts={attemptsQuery.data?.attempts ?? []} />
                      }
                    />
                  </Panel>
                  <PanelResizeHandle className="w-1.5 bg-surface-border transition hover:bg-accent/50" />
                  <Panel defaultSize={58} minSize={30}>
                    <SqlEditor
                      value={sql}
                      onChange={setSql}
                      onRun={handleRun}
                      onSubmit={() => submitMutation.mutate()}
                      running={runMutation.isPending}
                      submitting={submitMutation.isPending}
                      starterSql={questionQuery.data.starter_sql}
                      schemas={schemaQuery.data?.tables ?? []}
                      resultTarget={resultTarget}
                      onResultTargetChange={setResultTarget}
                      submitLabel={
                        questionQuery.data.has_reference_query
                          ? "Submit"
                          : "Submit & set reference"
                      }
                    />
                  </Panel>
                </PanelGroup>
              </Panel>
              <PanelResizeHandle className="h-1.5 bg-surface-border transition hover:bg-accent/50" />
              <Panel
                ref={resultsPanelRef}
                id="results"
                defaultSize={58}
                minSize={18}
                collapsible
                collapsedSize={6}
                onCollapse={() => setResultsCollapsed(true)}
                onExpand={() => setResultsCollapsed(false)}
              >
                <ResultsPanel
                  tabs={resultTabs}
                  activeTabId={activeTabId}
                  onSelectTab={setActiveTabId}
                  onCloseTab={closeTab}
                  submitResult={submitResult}
                  loading={runMutation.isPending || submitMutation.isPending}
                  collapsed={resultsCollapsed}
                  onToggleCollapse={toggleResults}
                />
              </Panel>
            </PanelGroup>

            {showNext && (
              <div className="flex items-center justify-between gap-3 border-t border-accent/20 bg-accent-dim px-4 py-2.5">
                <p className="text-sm text-accent">
                  Nice work
                  {submitResult?.level_changed
                    ? ` — level up to ${submitResult.suggested_difficulty}!`
                    : "."}{" "}
                  Ready for the next challenge?
                </p>
                <div className="flex gap-2">
                  <Link to="/questions" className="btn-secondary">
                    <List className="h-3.5 w-3.5" />
                    Choose Question
                  </Link>
                  {nextQuestion && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        setShowNext(false);
                        navigate(`/questions/${nextQuestion.question_number}`);
                      }}
                    >
                      Continue
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
