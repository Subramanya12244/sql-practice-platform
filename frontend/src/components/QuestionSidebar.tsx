import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { QuestionSummary } from "../types";
import { DifficultyBadge } from "./Badges";

interface Props {
  questions: QuestionSummary[];
  selectedId?: number;
  loading?: boolean;
  difficulty: string;
  topic: string;
  status: string;
  search: string;
  topics: string[];
  onDifficulty: (v: string) => void;
  onTopic: (v: string) => void;
  onStatus: (v: string) => void;
  onSearch: (v: string) => void;
}

const STATUS_CHIPS = [
  { value: "", label: "All" },
  { value: "not_started", label: "Open" },
  { value: "solved", label: "Done" },
];

export function QuestionSidebar({
  questions,
  selectedId,
  loading,
  difficulty,
  topic,
  status,
  search,
  topics,
  onDifficulty,
  onTopic,
  onStatus,
  onSearch,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-r border-surface-border bg-surface-raised/90 py-3">
        <button
          type="button"
          className="btn-ghost px-2"
          onClick={() => setCollapsed(false)}
          title="Show question list"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-surface-border bg-surface-raised/90 backdrop-blur-sm lg:w-72">
      <div className="flex items-center justify-between border-b border-surface-border px-3.5 py-3">
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
            Questions
          </h2>
          <p className="text-[11px] text-ink-faint">{questions.length} shown</p>
        </div>
        <button
          type="button"
          className="btn-ghost px-2"
          onClick={() => setCollapsed(true)}
          title="Hide list"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 border-b border-surface-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search…"
            className="field-input py-1.5 pl-8 text-xs"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value || "all"}
              type="button"
              className={`chip px-2.5 py-1 ${status === chip.value ? "chip-active" : ""}`}
              onClick={() => onStatus(chip.value)}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <select
          value={difficulty}
          onChange={(e) => onDifficulty(e.target.value)}
          className="field-input py-1.5 text-xs"
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
          onChange={(e) => onTopic(e.target.value)}
          className="field-input py-1.5 text-xs"
        >
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-overlay/80" />
            ))}
          </div>
        )}
        {!loading && questions.length === 0 && (
          <p className="p-4 text-center text-sm text-ink-faint">No questions match.</p>
        )}
        <ul className="space-y-0.5 p-2">
          {questions.map((q) => {
            const active = selectedId === q.id || selectedId === q.question_number;
            return (
              <li key={q.id}>
                <Link
                  to={`/questions/${q.question_number}`}
                  className={`flex items-start gap-2 rounded-xl px-2.5 py-2.5 transition duration-fast ${
                    active
                      ? "bg-accent-dim text-ink ring-1 ring-accent/25"
                      : "hover:bg-hover/5"
                  }`}
                >
                  <span className="w-8 shrink-0 pt-0.5 font-mono text-[11px] text-ink-faint">
                    Q{q.question_number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm text-ink">{q.title}</p>
                      {q.status === "solved" && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <DifficultyBadge level={q.difficulty} />
                      <span className="truncate text-[10px] text-ink-faint">{q.topic}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
