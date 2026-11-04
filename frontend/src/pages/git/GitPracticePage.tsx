import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  RotateCcw,
  Shuffle,
  Upload,
  XCircle,
} from "lucide-react";
import { api } from "../../services/api";
import { useToast } from "../../components/Toast";
import { DifficultyBadge, StatusBadge } from "../../components/Badges";
import { GitTerminal } from "../../components/git/GitTerminal";
import { GitRepoPanel } from "../../components/git/GitRepoPanel";
import type { GitAttemptResult, GitRepoState } from "../../types/git";

const STRATEGIES = [
  { id: "smart", label: "Smart" },
  { id: "sequential", label: "Sequential" },
  { id: "random", label: "Random" },
  { id: "incorrect", label: "Review incorrect" },
  { id: "review", label: "Review solved" },
];

const TYPES = [
  "",
  "command",
  "multiple_choice",
  "output_interpretation",
  "state_prediction",
  "debugging",
  "scenario",
  "multi_step",
  "command_comparison",
  "repository_state",
  "terminal",
];

export function GitPracticePage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<GitAttemptResult | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [repoState, setRepoState] = useState<GitRepoState | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [strategy, setStrategy] = useState(searchParams.get("mode") || "smart");

  const topic = searchParams.get("topic") || "";
  const difficulty = searchParams.get("difficulty") || "";
  const status = searchParams.get("status") || "";
  const exerciseType = searchParams.get("type") || "";
  const search = searchParams.get("q") || "";

  const topics = useQuery({ queryKey: ["git-topics"], queryFn: api.getGitTopics });
  const questions = useQuery({
    queryKey: ["git-questions", topic, difficulty, status, exerciseType, search],
    queryFn: () =>
      api.getGitQuestions({
        topic: topic || undefined,
        difficulty: difficulty || undefined,
        status: status || undefined,
        exercise_type: exerciseType || undefined,
        search: search || undefined,
      }),
  });

  const selectedId = id ? Number(id) : undefined;
  const question = useQuery({
    queryKey: ["git-question", selectedId],
    queryFn: () => api.getGitQuestion(selectedId!),
    enabled: Number.isFinite(selectedId),
  });

  useEffect(() => {
    const rs = question.data?.repository_state;
    // Empty `{}` is truthy in JS but has no repo fields — treat as no scenario.
    const usable =
      rs &&
      (rs.initialized != null || Boolean(rs.head) || Boolean(rs.repo_name));
    setRepoState(usable ? rs : null);
    setFeedback(null);
    setHintText(null);
    setTextAnswer("");
  }, [question.data?.id]);

  useEffect(() => {
    if (id || !questions.data?.length) return;
    // Auto-pick via strategy when landing on /git
    void api
      .gitSelect({
        strategy,
        topic: topic || undefined,
        difficulty: difficulty || undefined,
      })
      .then((pick) => {
        if (pick) navigate(`/git/${pick.id}?${searchParams.toString()}`, { replace: true });
        else navigate(`/git/${questions.data[0].id}?${searchParams.toString()}`, { replace: true });
      });
  }, [id, questions.data, strategy, topic, difficulty, navigate, searchParams]);

  const grouped = useMemo(() => {
    const map = new Map<string, NonNullable<typeof questions.data>>();
    for (const t of topics.data ?? []) map.set(t.slug, []);
    for (const q of questions.data ?? []) {
      const list = map.get(q.topic_slug) ?? [];
      list.push(q);
      map.set(q.topic_slug, list);
    }
    return map;
  }, [topics.data, questions.data]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const runMut = useMutation({
    mutationFn: (command: string) =>
      api.gitExecute({ question_id: selectedId!, command }),
    onSuccess: (data) => setRepoState(data.state),
  });

  const attemptMut = useMutation({
    mutationFn: (command: string) =>
      api.gitAttempt({ question_id: selectedId!, command }),
    onSuccess: (data) => {
      setFeedback(data);
      if (data.state && Object.keys(data.state).length) setRepoState(data.state);
      void qc.invalidateQueries({ queryKey: ["git-questions"] });
      void qc.invalidateQueries({ queryKey: ["git-topics"] });
      void qc.invalidateQueries({ queryKey: ["git-progress"] });
      void qc.invalidateQueries({ queryKey: ["git-question", selectedId] });
      toast.push(
        data.correct ? "Correct!" : "Not quite — check feedback",
        data.correct ? "success" : "error",
      );
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const hintMut = useMutation({
    mutationFn: () => api.gitHint(selectedId!),
    onSuccess: (data) => {
      setHintText(data.solution ? `${data.hint}\n\nSolution: ${data.solution}` : data.hint);
      void qc.invalidateQueries({ queryKey: ["git-question", selectedId] });
      void qc.invalidateQueries({ queryKey: ["git-progress"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const resetMut = useMutation({
    mutationFn: () => api.gitReset(selectedId!),
    onSuccess: (data) => {
      setRepoState(data.state);
      setFeedback(null);
      setHintText(null);
      toast.push("Scenario reset", "info");
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const nextMut = useMutation({
    mutationFn: () =>
      api.gitSelect({
        strategy,
        topic: topic || undefined,
        difficulty: difficulty || undefined,
        after_id: selectedId,
      }),
    onSuccess: (pick) => {
      if (!pick) {
        toast.push("No matching questions for this mode", "info");
        return;
      }
      navigate(`/git/${pick.id}?${searchParams.toString()}`);
    },
  });

  const q = question.data;
  const etype = q?.exercise_type || q?.mode || "command";
  const showTerminal = [
    "command",
    "scenario",
    "repository_state",
    "terminal",
    "multi_step",
    "debugging",
  ].includes(etype);
  const showChoices = etype === "multiple_choice" && (q?.choices?.length ?? 0) > 0;
  const showTextAnswer = !showTerminal || ["output_interpretation", "state_prediction", "command_comparison"].includes(etype);

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-surface-border bg-surface-raised/90 lg:flex xl:w-80">
        <div className="space-y-2 border-b border-surface-border px-3 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
              Question deck
            </h2>
            <span className="text-[10px] text-ink-faint">{questions.data?.length ?? 0} shown</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <Link to="/git/import" className="btn-ghost px-2 py-1 text-[11px]">
              <Upload className="h-3 w-3" /> Import
            </Link>
            <Link to="/git/progress" className="btn-ghost px-2 py-1 text-[11px]">
              Progress
            </Link>
          </div>
          <select
            className="field-input py-1.5 text-xs"
            value={topic}
            onChange={(e) => setFilter("topic", e.target.value)}
          >
            <option value="">All modules</option>
            {(topics.data ?? []).map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.title} ({t.question_count})
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-1.5">
            <select
              className="field-input py-1.5 text-xs"
              value={difficulty}
              onChange={(e) => setFilter("difficulty", e.target.value)}
            >
              <option value="">Difficulty</option>
              {["Easy", "Medium", "Hard", "Expert"].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              className="field-input py-1.5 text-xs"
              value={status}
              onChange={(e) => setFilter("status", e.target.value)}
            >
              <option value="">Status</option>
              <option value="not_attempted">Not attempted</option>
              <option value="incorrect">Incorrect</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In progress</option>
            </select>
          </div>
          <select
            className="field-input py-1.5 text-xs"
            value={exerciseType}
            onChange={(e) => setFilter("type", e.target.value)}
          >
            <option value="">All types</option>
            {TYPES.filter(Boolean).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            className="field-input py-1.5 text-xs"
            placeholder="Search…"
            value={search}
            onChange={(e) => setFilter("q", e.target.value)}
          />
          <div className="flex gap-1">
            <select
              className="field-input flex-1 py-1.5 text-xs"
              value={strategy}
              onChange={(e) => {
                setStrategy(e.target.value);
                setFilter("mode", e.target.value);
              }}
            >
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary px-2"
              title="Next by mode"
              onClick={() => nextMut.mutate()}
            >
              <Shuffle className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          {(topics.data ?? [])
            .filter((t) => !topic || t.slug === topic)
            .map((t) => {
              const items = grouped.get(t.slug) ?? [];
              if (!items.length && topic) return null;
              if (!items.length) return null;
              return (
                <div key={t.slug} className="mb-3">
                  <div className="mb-1 flex items-center justify-between px-2">
                    <p className="truncate text-[11px] font-medium text-ink">{t.title}</p>
                    <span className="shrink-0 text-[10px] text-ink-faint">
                      {t.solved_count}/{t.question_count}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(`/git/${item.id}?${searchParams.toString()}`)}
                        className={`nav-link w-full ${
                          item.id === selectedId ? "nav-link-active" : "nav-link-idle"
                        }`}
                      >
                        <span className="w-7 shrink-0 font-mono text-[10px] text-ink-faint">
                          {item.question_number}
                        </span>
                        <span className="truncate text-left text-xs">{item.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          {!questions.data?.length && (
            <p className="p-3 text-center text-xs text-ink-faint">
              No questions match. Import a Markdown bank to grow the deck.
            </p>
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <PanelGroup direction="horizontal" className="min-h-0 flex-1">
          <Panel defaultSize={58} minSize={40}>
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 border-b border-surface-border p-4 sm:p-5">
                {question.isLoading || !q ? (
                  <div className="h-24 animate-pulse rounded-xl bg-surface-overlay/80" />
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-faint">
                        {q.stable_id || `G${q.question_number}`}
                      </span>
                      <DifficultyBadge level={q.difficulty} />
                      <StatusBadge status={q.status} />
                      <span className="badge bg-hover/5 text-ink-faint">
                        {q.exercise_type || q.mode}
                      </span>
                      <span className="badge bg-accent-dim text-accent">{q.topic}</span>
                    </div>
                    <h1 className="font-display text-lg font-semibold text-ink sm:text-xl">
                      {q.title}
                    </h1>
                    {q.scenario && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{q.scenario}</p>
                    )}
                    <div className="mt-3 rounded-xl border border-accent/20 bg-accent-dim/40 px-3 py-2.5 text-sm text-ink">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-accent">
                        Task
                      </span>
                      <p className="mt-1">{q.task}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => hintMut.mutate()}
                        disabled={hintMut.isPending}
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                        Hint
                      </button>
                      {showTerminal && (
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => resetMut.mutate()}
                          disabled={resetMut.isPending}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reset repo
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => nextMut.mutate()}
                      >
                        <Shuffle className="h-3.5 w-3.5" />
                        Next
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
                {showChoices && (
                  <div className="space-y-2">
                    {(q?.choices ?? []).map((c) => (
                      <button
                        key={c.key || c.text}
                        type="button"
                        className="flex w-full items-start gap-3 rounded-xl border border-surface-border bg-surface-overlay/50 px-3 py-2.5 text-left text-sm transition hover:border-accent/40 hover:bg-accent-dim/30"
                        onClick={() => attemptMut.mutate(c.key || c.text || "")}
                      >
                        <span className="font-mono text-accent">{c.key}</span>
                        <span className="text-ink">{c.text}</span>
                      </button>
                    ))}
                  </div>
                )}

                {showTextAnswer && !showChoices && (
                  <div className="panel p-3">
                    <label className="section-label">Your answer</label>
                    <textarea
                      className="field-input min-h-[88px] font-mono text-xs"
                      value={textAnswer}
                      onChange={(e) => setTextAnswer(e.target.value)}
                      placeholder="Type the Git command or short answer…"
                    />
                    <button
                      type="button"
                      className="btn-primary mt-2"
                      disabled={!textAnswer.trim() || attemptMut.isPending}
                      onClick={() => attemptMut.mutate(textAnswer)}
                    >
                      Submit answer
                    </button>
                  </div>
                )}

                {showTerminal && (
                  <div className="h-[min(420px,50vh)] min-h-[280px]">
                    <GitTerminal
                      disabled={!q}
                      running={runMut.isPending}
                      submitting={attemptMut.isPending}
                      onRun={async (command) => {
                        const res = await runMut.mutateAsync(command);
                        return { ok: res.ok, output: res.output, error: res.error };
                      }}
                      onSubmit={(command) => attemptMut.mutate(command)}
                    />
                  </div>
                )}
              </div>

              {(feedback || hintText) && (
                <div className="shrink-0 space-y-2 border-t border-surface-border p-4">
                  {hintText && (
                    <div className="rounded-xl border border-warn/25 bg-warn-dim px-3 py-2.5 text-sm text-ink">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-warn">
                        <Lightbulb className="h-3.5 w-3.5" /> Hint
                      </div>
                      <p className="whitespace-pre-wrap text-ink-muted">{hintText}</p>
                    </div>
                  )}
                  {feedback && (
                    <div
                      className={`rounded-xl border px-3 py-2.5 text-sm ${
                        feedback.correct
                          ? "border-success/25 bg-success-dim"
                          : "border-danger/25 bg-danger-dim"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        {feedback.correct ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-danger" />
                        )}
                        <span className={feedback.correct ? "text-success" : "text-danger"}>
                          {feedback.result}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-ink-muted">{feedback.feedback}</p>
                      {feedback.explanation && (
                        <p className="mt-2 whitespace-pre-wrap border-t border-surface-border pt-2 text-ink-muted">
                          {feedback.explanation}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-1.5 bg-surface-border transition hover:bg-accent/50" />

          <Panel defaultSize={42} minSize={28}>
            <div className="h-full border-l border-surface-border bg-surface-raised/50">
              <GitRepoPanel state={repoState} />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
