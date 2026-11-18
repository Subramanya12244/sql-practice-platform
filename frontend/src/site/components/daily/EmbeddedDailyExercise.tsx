import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Eye, PanelsTopLeft } from "lucide-react";
import { Badge, Button, Card } from "../ui";
import { Markdown } from "../Markdown";
import { WorkspaceLink } from "../WorkspaceLink";
import type { Exercise } from "../../lib/daily";
import type { DayRecord } from "../../lib/dailyProgress";
import { SOLUTION_LOCKED_NOTE, canRevealSolution, type DailyKind } from "../../lib/dailyExercise";
import { EmbeddedExercise } from "../../workspace/EmbeddedExercise";
import { createDailyPort, dailyKindOf, sqlWorkspaceRunnable, type EmbedDecision } from "../../workspace/dailyPort";
import { availableLevels } from "../../workspace/hints";
import { resolveAdapter, type Resolution } from "../../workspace/registry";
import { enrichExercise } from "../../workspace/sources/enrichment";
import type { ExerciseDef } from "../../workspace/types";
import { useDraftSaver } from "./useDraftSaver";

const fence = (lang: string, code: string) => `\`\`\`${lang}\n${code}\n\`\`\``;

/**
 * What the lesson's own policy leaves to the workspace. The workspace keeps its five-level ladder for hints, but two Daily rules stay:
 *  - independent exercises have no hints (the lesson says so), so any hint a content layer adds is not shown there;
 *  - the solution is not part of the workspace ladder here. The lesson unlocks it after a pass, two checks that did not pass, or
 *    every hint, and showing it never records anything, so the lesson shows it itself (below the workspace) under that rule.
 * Grading data (`validation`, `starterCode`) is untouched.
 */
export function dailyWorkspaceExercise(def: ExerciseDef, guided: boolean): ExerciseDef {
  return { ...def, hints: guided ? def.hints : [], solution: def.solution ? { ...def.solution, code: "" } : undefined };
}

/**
 * A graded Daily exercise shown as the unified exercise workspace, inside the lesson. The workspace owns the prompt, editor, Run,
 * Submit, hints and visualization; this card owns what only a lesson knows: its status badge, the saved-work note, the expected
 * output, and the solution policy. Progress goes through `createDailyPort`, which calls the same store functions the in-page runner
 * calls, so the lesson's completion, mastery, resume and Mistake Notebook records are the same whichever screen was used.
 *
 * Until the learner opens it, only the prompt shows, so a lesson with several exercises stays light (no editor, no engine). An
 * exercise that already has saved work or a result opens straight away. If the domain's engine cannot load (or, for SQL, its safety checker cannot accept the
 * exercise's own reference answer), `fallback` (the in-page runner) is shown instead.
 */
export function EmbeddedDailyExercise({ dayId, ex, guided, rec, index, decision, fallback }: {
  dayId: string; ex: Exercise; guided: boolean; rec: DayRecord | undefined; index: number; decision: EmbedDecision; fallback: ReactNode;
}) {
  const base = decision.def!;
  const kind: DailyKind = dailyKindOf(base);
  const saved = rec?.drafts?.[ex.id];
  const passed = !!rec?.passed?.includes(ex.id);
  const attempted = passed || !!rec?.attempted?.includes(ex.id);

  // Restore: reload keeps the draft, exactly as the in-page runner did.
  const initial = useRef(saved ?? ex.starter).current;
  const restored = useRef(saved !== undefined && saved !== ex.starter).current;
  const [code, setCode] = useState(initial);
  useDraftSaver(dayId, ex.id, code, initial);

  const [open, setOpen] = useState(restored || attempted);
  const [fails, setFails] = useState(0);
  const [hintMax, setHintMax] = useState(0);
  const [solution, setSolution] = useState(false);
  const port = useMemo(() => createDailyPort({ onFail: () => setFails((n) => n + 1), onHint: (_e, level) => setHintMax((m) => Math.max(m, level)) }), []);

  // Teaching content layered on by id (hints, debugging notes). It never touches grading; the base exercise works without it.
  const [enriched, setEnriched] = useState<ExerciseDef | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    enrichExercise(base).then((e) => { if (alive) setEnriched(e); }, () => undefined);
    return () => { alive = false; };
  }, [open, base]);
  const def = useMemo(() => dailyWorkspaceExercise(enriched ?? base, guided), [enriched, base, guided]);

  // The engine for this domain. Same cache the workspace uses, so nothing loads twice.
  const [engine, setEngine] = useState<Resolution | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const r = await resolveAdapter(def.domain);
      // SQL: the workspace is only worth showing if its safety checker accepts the exercise's own reference answer.
      const sql = r.status === "ready" && def.domain === "sql" ? await sqlWorkspaceRunnable(base) : { ok: true, reason: undefined };
      if (alive) setEngine(sql.ok ? r : { status: "missing", reason: sql.reason ?? "The SQL checker cannot run this exercise." });
    })();
    return () => { alive = false; };
  }, [open, def.domain, base]);

  const levels = availableLevels(def);
  const hintsTotal = levels.length ? Math.max(...levels) : 0;
  const canReveal = canRevealSolution({ passed, fails, guided, hintsOpened: hintMax, hintsTotal });

  if (open && engine?.status === "missing") return <>{fallback}</>;

  const label = `${guided ? "Guided" : "Independent"} ${index + 1}`;
  const status = (
    <span className="flex items-center gap-1.5">
      {ex.required === false && <Badge>Optional stretch</Badge>}
      {passed ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden /> Passed</Badge> : attempted ? <Badge tone="accent">Attempted</Badge> : <Badge>Not started</Badge>}
    </span>
  );

  return (
    <Card className="min-w-0 space-y-3" aria-label={`Exercise ${index + 1}: ${ex.title}`}>
      <div data-testid="daily-embedded-exercise" data-exercise-id={def.id} className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-ink"><span className="text-ink-faint">{label}.</span> {open ? "" : ex.title}</h4>
        {status}
      </div>
      {!open && (
        <>
          <Markdown source={ex.prompt} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => setOpen(true)}><PanelsTopLeft className="h-4 w-4" aria-hidden /> Open the exercise</Button>
            <WorkspaceLink id={def.id} />
          </div>
        </>
      )}
      {open && (
        <>
          {!engine ? <p role="status" className="text-sm text-ink-muted">Loading the editor…</p> : (
            <div className="min-w-0">
              <EmbeddedExercise exercise={def} mode="compact" progress={port} initialCode={initial} onCodeChange={setCode} adapter={engine.status === "ready" ? engine.adapter : undefined} Visualizer={engine.status === "ready" ? engine.Visualizer : undefined} />
            </div>
          )}
          {restored && code === initial && <p className="text-xs text-ink-faint">Your saved work was restored.</p>}
          {kind === "python" && ex.expected !== undefined && (
            <details className="text-sm"><summary className="cursor-pointer text-ink-muted hover:text-ink">Expected output</summary><div className="mt-2"><Markdown source={fence("text", ex.expected)} /></div></details>
          )}
          <div className="text-sm">
            {canReveal ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setSolution((v) => !v)} aria-expanded={solution}><Eye className="h-4 w-4" aria-hidden /> {solution ? "Hide" : "Show"} a solution</Button>
                {solution && <div className="mt-2"><Markdown source={fence(kind === "sql" ? "sql" : "python", ex.solution)} /><p className="text-xs text-ink-faint">Looking at the solution does not pass the exercise. Type your own version and check it.</p></div>}
              </>
            ) : <p className="text-xs text-ink-faint">{SOLUTION_LOCKED_NOTE(guided)}</p>}
          </div>
          <WorkspaceLink id={def.id} />
        </>
      )}
    </Card>
  );
}
