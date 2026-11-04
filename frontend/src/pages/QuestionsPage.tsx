import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../services/api";
import { DifficultyBadge, StatusBadge } from "../components/Badges";
import { useToast } from "../components/Toast";

const STATUS_CHIPS = [
  { value: "", label: "All" },
  { value: "not_started", label: "Unsolved" },
  { value: "in_progress", label: "In progress" },
  { value: "solved", label: "Solved" },
];

export function QuestionsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [difficulty, setDifficulty] = useState("");
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["questions", difficulty, topic, status, search],
    queryFn: () =>
      api.getQuestions({
        difficulty: difficulty || undefined,
        topic: topic || undefined,
        status: status || undefined,
        search: search || undefined,
      }),
  });

  const topics = useQuery({ queryKey: ["topics"], queryFn: api.getTopics });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteQuestion(id),
    onSuccess: (res) => {
      toast.push(res.message, "success");
      void qc.invalidateQueries({ queryKey: ["questions"] });
      void qc.invalidateQueries({ queryKey: ["progress"] });
      void qc.invalidateQueries({ queryKey: ["topics"] });
      void qc.invalidateQueries({ queryKey: ["next-question-number"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const counts = useMemo(() => {
    const all = data?.questions ?? [];
    return {
      total: data?.total ?? 0,
      unsolved: all.filter((q) => q.status !== "solved").length,
      solved: all.filter((q) => q.status === "solved").length,
    };
  }, [data]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl animate-fade-in px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="page-title">Questions</h1>
            <p className="page-subtitle">
              {counts.total} total · {counts.unsolved} remaining · {counts.solved} solved
            </p>
          </div>
          <Link to="/questions/new" className="btn-primary">
            <Plus className="h-3.5 w-3.5" />
            Add question
          </Link>
        </div>

        <div className="mb-6 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or problem…"
              className="field-input pl-11"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {STATUS_CHIPS.map((chip) => (
              <button
                key={chip.value || "all"}
                type="button"
                className={`chip ${status === chip.value ? "chip-active" : ""}`}
                onClick={() => setStatus(chip.value)}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="field-input w-auto min-w-[150px]"
            >
              <option value="">All difficulties</option>
              {["Beginner", "Intermediate", "Advanced", "Senior", "Expert"].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="field-input w-auto min-w-[170px]"
            >
              <option value="">All topics</option>
              {topics.data?.topics.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-card bg-surface-overlay/80" />
            ))}
          </div>
        )}

        {!isLoading && data?.questions.length === 0 && (
          <div className="rounded-card border border-dashed border-surface-border px-6 py-20 text-center">
            <p className="text-ink-muted">No questions match your filters.</p>
            <button
              type="button"
              className="btn-secondary mt-4"
              onClick={() => {
                setSearch("");
                setDifficulty("");
                setTopic("");
                setStatus("");
              }}
            >
              Clear filters
            </button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data?.questions.map((q) => (
            <div key={q.id} className="card-hover group relative flex flex-col !p-4">
              <Link
                to={`/questions/${q.question_number}`}
                className="absolute inset-0 rounded-card"
                aria-label={`Open Q${q.question_number}`}
              />
              <div className="relative z-10 mb-3 flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-ink-faint">Q{q.question_number}</span>
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={q.status} />
                  <button
                    type="button"
                    className="btn-ghost px-1.5 py-1 text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-danger"
                    title={`Delete Q${q.question_number}`}
                    disabled={remove.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (
                        !window.confirm(
                          `Delete Q${q.question_number} — ${q.title}?\n\nThis removes it from the app (attempts included). Repo .md/.sql files are not deleted.`,
                        )
                      ) {
                        return;
                      }
                      remove.mutate(q.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <h2 className="relative z-10 mb-4 line-clamp-2 text-[15px] font-medium leading-snug text-ink">
                <Link to={`/questions/${q.question_number}`} className="hover:text-accent">
                  {q.title}
                </Link>
              </h2>
              <div className="relative z-10 mt-auto flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <DifficultyBadge level={q.difficulty} />
                  <span className="truncate text-[11px] text-ink-faint">{q.topic}</span>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-accent opacity-0 transition group-hover:opacity-100">
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
