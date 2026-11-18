import { Markdown } from "../../components/Markdown";
import { Chip, Difficulty } from "../../components/ui";
import type { ExerciseDef } from "../types";
import { DOMAIN_LABEL } from "../registry";

/** The statement and everything the learner may read before solving. No hints and no solution here. */
export function ProblemPanel({ exercise: ex, compact = false }: { exercise: ExerciseDef; compact?: boolean }) {
  return (
    <div className="space-y-3 text-sm" data-testid="workspace-problem">
      <div className="flex flex-wrap items-center gap-1.5">
        <Difficulty level={ex.difficulty} />
        <Chip>{DOMAIN_LABEL[ex.domain]}</Chip>
        <Chip>{ex.topicLabel ?? ex.topic}</Chip>
        {ex.minutes ? <Chip>{ex.minutes} min</Chip> : null}
      </div>
      <h3 className="font-display text-lg text-ink">{ex.title}</h3>
      {ex.businessContext && <Markdown source={ex.businessContext} className="text-ink-muted" />}
      <Markdown source={ex.statement} />
      {!compact && ex.objectives.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Objectives</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{ex.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}
      {ex.realWorld && !compact && <p className="text-xs text-ink-muted"><span className="font-medium text-ink">In practice:</span> {ex.realWorld}</p>}
      {ex.constraints && ex.constraints.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Constraints</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{ex.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      {ex.dataset && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Data: {ex.dataset.label}</p>
          {ex.dataset.note && <p className="mt-1 text-ink-muted">{ex.dataset.note}</p>}
          {ex.dataset.tables?.map((t) => (
            <p key={t.name} className="mt-1 text-xs text-ink-muted"><code className="font-mono text-ink">{t.name}</code>({t.columns.map((c) => c.name).join(", ")})</p>
          ))}
        </div>
      )}
      {ex.expectedOutput && !compact && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Expected output</p>
          <Markdown source={ex.expectedOutput} />
        </div>
      )}
      {ex.rubric && ex.rubric.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">A good answer</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{ex.rubric.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {ex.validation.kind === "none" && <p className="rounded-lg bg-surface-soft p-2 text-xs text-ink-muted">This exercise is not graded. Run it and compare with what you expect.</p>}
    </div>
  );
}
