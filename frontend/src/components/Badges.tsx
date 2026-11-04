const DIFFICULTY_COLORS: Record<string, string> = {
  Easy: "bg-success-dim text-success",
  Beginner: "bg-success-dim text-success",
  Medium: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Intermediate: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Hard: "bg-warn-dim text-warn",
  Advanced: "bg-warn-dim text-warn",
  Senior: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  Expert: "bg-danger-dim text-danger",
};

export function DifficultyBadge({ level }: { level: string }) {
  return (
    <span className={`badge ${DIFFICULTY_COLORS[level] ?? "bg-surface-overlay text-ink-muted"}`}>
      {level}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "solved") {
    return <span className="badge bg-success-dim text-success">Solved</span>;
  }
  if (status === "in_progress") {
    return <span className="badge bg-warn-dim text-warn">In progress</span>;
  }
  if (status === "incorrect") {
    return <span className="badge bg-danger-dim text-danger">Incorrect</span>;
  }
  return <span className="badge bg-hover/5 text-ink-faint">Not started</span>;
}
