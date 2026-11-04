import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../services/api";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card !p-4">
      <p className="section-label mb-0">{label}</p>
      <p className="stat-value mt-2 text-2xl">{value}</p>
      {hint && <p className="mt-1.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

export function GitProgressPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["git-progress"],
    queryFn: api.getGitProgress,
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 p-8 md:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-card bg-surface-overlay/80" />
        ))}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl animate-fade-in px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Git Progress</h1>
            <p className="page-subtitle">
              Skill tracking across the full question bank
              {data.total_questions != null ? ` (${data.total_questions} exercises)` : ""}.
              Totals update automatically as you import Markdown.
            </p>
          </div>
          <Link to="/git" className="btn-primary">
            Continue practicing
          </Link>
        </div>

        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Git skill score" value={`${data.skill_score}%`} />
          <Stat
            label="Problems solved"
            value={`${data.solved_count} / ${data.total_questions}`}
          />
          <Stat label="Accuracy" value={`${data.accuracy}%`} />
          <Stat label="Current streak" value={data.current_streak} />
          <Stat label="Average attempts" value={data.average_attempts} />
          <Stat label="Hints used" value={data.hints_used} />
        </div>

        <div className="panel p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Topic mastery</h2>
          <div className="space-y-4">
            {(data.topic_mastery ?? []).map((t) => (
              <div key={t.slug}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-ink">{t.title}</span>
                  <span className="text-xs text-ink-faint">
                    {t.solved}/{t.total} · {t.percent}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-hover/10">
                  <div
                    className="h-full rounded-full transition-all duration-base"
                    style={{
                      width: `${t.percent}%`,
                      background: "linear-gradient(90deg, rgb(var(--color-accent)), rgb(var(--color-accent-muted)))",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
