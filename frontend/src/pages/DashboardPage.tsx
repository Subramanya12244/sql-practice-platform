import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../services/api";
import { useChartTheme } from "../hooks/useChartTheme";

function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string | number;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="card !p-4">
      <p className="section-label mb-0">{label}</p>
      <p className={`stat-value mt-2 text-2xl ${accent ?? "text-ink"}`}>{value}</p>
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{hint}</p>}
    </div>
  );
}

export function DashboardPage() {
  const chart = useChartTheme();
  const { data, isLoading } = useQuery({
    queryKey: ["progress"],
    queryFn: api.getProgress,
  });

  const [tab, setTab] = useState<"practice" | "repo">("practice");

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 p-8 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-card bg-surface-overlay/80" />
        ))}
      </div>
    );
  }

  const repo = data.repository;
  const tooltipStyle = {
    background: chart.tooltipBg,
    border: `1px solid ${chart.tooltipBorder}`,
    borderRadius: 12,
    color: chart.tick,
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl animate-fade-in px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="page-title">Progress</h1>
      <p className="page-subtitle mb-6">
        GitHub is the source of truth for documentation. The app database tracks practice
        attempts, scores, and mistakes separately.
      </p>

      <div className="mb-8 flex flex-wrap gap-2">
        <button
          type="button"
          className={`chip ${tab === "practice" ? "chip-active" : ""}`}
          onClick={() => setTab("practice")}
        >
          Practice Progress
        </button>
        <button
          type="button"
          className={`chip ${tab === "repo" ? "chip-active" : ""}`}
          onClick={() => setTab("repo")}
        >
          Repository Progress
        </button>
      </div>

      {tab === "practice" && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Solved"
              value={`${data.solved} / ${data.total_questions}`}
              accent="text-accent"
            />
            <Stat label="Unsolved" value={data.remaining ?? data.not_started} accent="text-warn" />
            <Stat
              label="Imported from GitHub"
              value={data.solved_from_repo ?? 0}
              hint="Documented in your repo (.md + .sql)"
            />
            <Stat
              label="Solved in Editor"
              value={data.solved_in_practice ?? 0}
              hint="Submitted and verified here"
            />
            <Stat label="Questions Attempted" value={data.questions_attempted ?? 0} />
            <Stat label="Accuracy" value={`${data.accuracy}%`} accent="text-sky-600 dark:text-sky-300" />
            <Stat
              label="Average Score"
              value={data.average_score != null ? data.average_score : "—"}
            />
            <Stat
              label="Avg Attempts / Q"
              value={
                data.avg_attempts_per_question != null ? data.avg_attempts_per_question : "—"
              }
            />
            <Stat label="Current Level" value={data.current_level} />
            <Stat label="Current Streak" value={data.current_streak} accent="text-warn" />
          </div>

          {(data.weak_concepts?.length || data.recent_mistakes?.length) ? (
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <div className="panel rounded-lg p-4">
                <h2 className="mb-3 text-sm font-semibold text-ink">Weak SQL Concepts</h2>
                {!data.weak_concepts?.length ? (
                  <p className="text-sm text-ink-faint">
                    Import ChatGPT history to surface recurring mistake categories.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.weak_concepts.map((c) => (
                      <li key={c.name} className="flex items-center justify-between text-sm">
                        <span className="text-ink">{c.name}</span>
                        <span className="font-mono text-rose-400">{c.mistake_count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="panel rounded-lg p-4">
                <h2 className="mb-3 text-sm font-semibold text-ink">Recurring Mistakes</h2>
                {!data.recent_mistakes?.length ? (
                  <p className="text-sm text-ink-faint">No mistakes recorded yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.recent_mistakes.slice(0, 5).map((m, i) => (
                      <li
                        key={i}
                        className="border-b border-surface-border pb-2 text-sm last:border-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-rose-400">
                            {m.category.replace(/_/g, " ")}
                          </span>
                          <a
                            href={`/questions/${m.question_number}`}
                            className="font-mono text-xs text-accent hover:underline"
                          >
                            Q{m.question_number}
                          </a>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-ink-muted">{m.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="panel rounded-lg p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Solved by Topic</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.by_topic}>
                    <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="topic"
                      tick={{ fill: chart.tick, fontSize: 10 }}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={70}
                    />
                    <YAxis tick={{ fill: chart.tick, fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="solved" fill={chart.barSuccess} name="Solved" />
                    <Bar dataKey="total" fill={chart.barMuted} name="Total" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel rounded-lg p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Difficulty Progress</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.by_difficulty}>
                    <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="difficulty" tick={{ fill: chart.tick, fontSize: 11 }} />
                    <YAxis tick={{ fill: chart.tick, fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="solved" fill={chart.barSuccess} name="Solved" />
                    <Bar dataKey="total" fill={chart.barMuted} name="Total" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel rounded-lg p-4 lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold text-ink">Solved Over Time</h2>
              <div className="h-64">
                {data.solved_over_time.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-ink-faint">
                    Solve questions to see your timeline.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.solved_over_time}>
                      <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: chart.tick, fontSize: 11 }} />
                      <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="count" stroke={chart.line} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "repo" && (
        <>
          {!repo ? (
            <p className="text-sm text-ink-muted">
              Click <strong>Sync GitHub</strong> in the header to load repository progress.
            </p>
          ) : (
            <>
              <p className="mb-4 text-xs text-ink-faint">
                Source: {repo.repository} · Next available Q:{" "}
                <span className="font-mono text-accent">Q{repo.next_question_number}</span>
              </p>
              <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Total Questions" value={repo.total_questions} />
                <Stat label="Documented (md+sql)" value={repo.documented} accent="text-accent" />
                <Stat label="Incomplete Files" value={repo.incomplete} accent="text-warn" />
                <Stat label="App-only / Missing" value={repo.app_only + repo.missing_from_repo} />
              </div>

              {(repo.missing_md.length > 0 || repo.missing_sql.length > 0) && (
                <div className="mb-6 panel rounded-lg p-4 text-sm">
                  <h2 className="mb-2 font-semibold text-ink">Missing Files</h2>
                  {repo.missing_md.length > 0 && (
                    <p className="text-ink-muted">
                      Missing .md:{" "}
                      <span className="font-mono text-warn">
                        {repo.missing_md.map((n) => `Q${n}`).join(", ")}
                      </span>
                    </p>
                  )}
                  {repo.missing_sql.length > 0 && (
                    <p className="mt-1 text-ink-muted">
                      Missing .sql:{" "}
                      <span className="font-mono text-warn">
                        {repo.missing_sql.map((n) => `Q${n}`).join(", ")}
                      </span>
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="panel rounded-lg p-4">
                  <h2 className="mb-3 text-sm font-semibold text-ink">By Category</h2>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={repo.by_category}>
                        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="category"
                          tick={{ fill: chart.tick, fontSize: 9 }}
                          interval={0}
                          angle={-30}
                          textAnchor="end"
                          height={90}
                        />
                        <YAxis tick={{ fill: chart.tick, fontSize: 11 }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" fill={chart.barSuccess} name="Questions" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="panel rounded-lg p-4">
                  <h2 className="mb-3 text-sm font-semibold text-ink">By Difficulty</h2>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={repo.by_difficulty}>
                        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                        <XAxis dataKey="difficulty" tick={{ fill: chart.tick, fontSize: 11 }} />
                        <YAxis tick={{ fill: chart.tick, fontSize: 11 }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" fill={chart.barAccent} name="Questions" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
      </div>
    </div>
  );
}
