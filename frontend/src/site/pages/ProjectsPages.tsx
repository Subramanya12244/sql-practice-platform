import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleDashed, FileText, FlaskConical, Loader2, Play, Scale, Send, FolderGit2, ListChecks, ArrowDown } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { SampleTable } from "../components/SampleTable";
import { Button, Card, Container, Disclosure, EmptyState, PageHeader, ProgressBar, Skeleton, Tabs } from "../components/ui";
import { Icon, IconTile } from "../components/Icon";
import { ProjectCard, ProjectFilters, ResultBanner, StatusChip, TaskRoadmap, projectIcon, LEVEL_TONE } from "../components/projects/ProjectUi";
import { LEVELS, NO_PROJECT_FILTER, filterProjects, isFinished, taskState, isProjectFiltered, libraryTotals, nextTask, projectFilterFromSearch, projectFilterToSearch, statusGroup, summarise, technologyOptions, type Level, type ProjectProgressSummary, type ProjectTasks, type StatusGroup, type TaskRef } from "../lib/projectsLab";
import { useUrlFilter } from "../lib/useUrlFilter";
import { LevelBadge } from "../components/LearnUi";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { registerDataset, runQuery } from "../lib/browserDb";
import { runPython } from "../lib/pyRunner";
import { runPythonTask, runSqlTask, type Task, type TaskResult, type PythonTask } from "../lib/tasks";
import { getProjectProgress, isRepoUrl, projectStatus, saveProjectProgress, type Project, type ProjectProgress } from "../lib/projects";
import type { ExecuteResult } from "../../types";
import { track } from "../lib/activity";
import { ProjectCelebration } from "../components/ProjectCelebration";
import { PythonWorkspace } from "../components/PythonWorkspace";
import { HelpTooltip } from "../help/HelpTooltip";
import { LinkedExerciseList } from "../components/learn/WorkspacePractice";
import { exercisesForTask } from "../lib/workspaceLinks";

const CodeEditor = lazy(() => import("../components/CodeEditor"));

export function ProjectsIndexPage() {
  const { data } = usePage();
  const all = data.projects ?? [];
  const lists = (data.projectTasks ?? []) as unknown as ProjectTasks[];
  const [summaries, setSummaries] = useState<Record<string, ProjectProgressSummary>>({});
  const [mine, setMine] = useState(false);
  const [filter, setFilter] = useUrlFilter(NO_PROJECT_FILTER, projectFilterFromSearch, projectFilterToSearch);
  // Progress lives in this browser, so it is read after mount: the prerendered page is the neutral library.
  useEffect(() => {
    setSummaries(Object.fromEntries(lists.map((l) => {
      const progress = getProjectProgress(l.slug);
      return [l.slug, summarise(l.tasks, progress, projectStatus({ tasks: l.tasks as never }, progress))];
    })));
  }, [data.projectTasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupOf = (slug: string): StatusGroup => statusGroup(summaries[slug]?.status ?? "Not started");
  const done = all.filter((p) => groupOf(p.slug) === "completed").length;
  const active = all.filter((p) => groupOf(p.slug) === "in-progress").length;
  const techs = useMemo(() => technologyOptions(all), [all]);
  const totals = useMemo(() => libraryTotals(all), [all]);
  const levelCounts = Object.fromEntries(LEVELS.map((l) => [l, all.filter((p) => p.level === l).length])) as Record<Level, number>;
  const statusCounts: Record<StatusGroup, number> = { "not-started": all.length - active - done, "in-progress": active, completed: done };
  const pool = mine ? all.filter((p) => groupOf(p.slug) !== "not-started") : all;
  const shown = filterProjects(pool, groupOf, filter);
  const filtered = isProjectFiltered(filter);

  return (
    <Container>
      <Seo
        title="Data Engineering Projects — ETL, Warehousing, Airflow, Spark, dbt"
        description="Hands-on data engineering projects with automated checks: ETL to PostgreSQL, data cleaning, star schemas, incremental loads, validation, Airflow, PySpark and dbt."
        path="/projects-lab"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Projects lab", path: "/projects-lab" }])]}
      />
      <PageHeader
        eyebrow="Projects"
        title="Projects lab"
        intro="Build real pipelines step by step. SQL steps are checked against a real PostgreSQL database and Python steps run tests in a sandbox — a project is only Completed when its checks pass."
      />
      <Card pad="sm" data-help="projects-stats" className="mb-5">
        <dl className="grid grid-cols-3 divide-x divide-surface-border text-center">
          <div className="px-2"><dt className="text-label uppercase text-ink-faint">Projects</dt><dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{totals.projects}</dd><dd className="text-xs text-ink-muted">{totals.tasks} tasks · {totals.automated} auto-checked</dd></div>
          <div className="px-2"><dt className="text-label uppercase text-ink-faint">In progress</dt><dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{active}</dd><dd className="text-xs text-ink-muted">Started, not yet completed</dd></div>
          <div className="px-2"><dt className="text-label uppercase text-ink-faint">Completed</dt><dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{done}</dd><dd className="text-xs text-ink-muted">All checks passed or approved</dd></div>
        </dl>
      </Card>
      <div data-help="projects-tabs" className="mb-4">
        <Tabs label="Projects view" value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")} tabs={[{ id: "all", label: "Project library" }, { id: "mine", label: `My projects${active + done ? ` (${active + done})` : ""}` }]} />
      </div>
      <ProjectFilters filter={filter} setFilter={setFilter} techs={techs} levelCounts={levelCounts} statusCounts={statusCounts} shown={shown.length} total={pool.length} />
      {mine && !pool.length && <EmptyState icon={FolderGit2} title="No projects started yet" action={<Button variant="secondary" onClick={() => setMine(false)}>Browse the library</Button>}>Start any task in a project and it shows up here with its progress.</EmptyState>}
      {!shown.length && pool.length > 0 && (
        <EmptyState icon={FolderGit2} title="No projects match these filters" action={<Button variant="secondary" onClick={() => setFilter(NO_PROJECT_FILTER)}>Clear filters</Button>}>
          Try a shorter search, another technology or level, or remove the status filter.
        </EmptyState>
      )}
      {LEVELS.map((level) => {
        const group = shown.filter((p) => p.level === level);
        if (!group.length) return null;
        return (
          <section key={level} data-help="projects-level" className="mb-8" aria-labelledby={`lvl-${level}`}>
            <h2 id={`lvl-${level}`} className="flex items-center gap-2 font-display text-xl font-bold text-ink">{level}<span className="text-sm font-medium tabular-nums text-ink-faint">{group.length}</span></h2>
            <ul className="stagger mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((p) => <li key={p.slug}><ProjectCard p={p} summary={summaries[p.slug]} /></li>)}
            </ul>
          </section>
        );
      })}
      {filtered && shown.length > 0 && <p className="sr-only">Filters are applied.</p>}
    </Container>
  );
}

function TaskPanel({ task, project, progress, onChange, mounted, next }: {
  task: Task;
  project: Project;
  progress: ProjectProgress;
  onChange: (p: ProjectProgress) => void;
  mounted: boolean;
  /** The task to do after this one, offered on a pass. */
  next?: TaskRef | null;
}) {
  const saved = progress.tasks[task.id];
  const [code, setCode] = useState(saved?.code ?? ("starter" in task ? task.starter : ""));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TaskResult | null>(saved ? { ok: saved.passed, message: saved.message ?? (saved.passed ? "Check passed." : "") } : null);
  const [preview, setPreview] = useState<ExecuteResult | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  // A result read back from storage is shown as it was; only one that arrives while you are here animates.
  const [fresh, setFresh] = useState(false);

  const record = (r: TaskResult) => {
    setFresh(true);
    setResult(r);
    onChange({ ...progress, tasks: { ...progress.tasks, [task.id]: { passed: r.ok, code, at: new Date().toISOString(), message: r.message } } });
  };

  async function check() {
    setBusy(true);
    try {
      if (task.type === "sql") record(await runSqlTask(task, code, (sql) => runQuery(sql, project.dataset)));
      else if (task.type === "python") {
        const r = await runPythonTask(task, code, runPython);
        setOutput(r.output ?? null);
        record(r);
      }
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    try {
      if (task.type === "sql") setPreview(await runQuery(code, project.dataset));
      else if (task.type === "python") {
        const r = await runPython(code);
        setOutput([r.stdout, r.error].filter(Boolean).join("\n") || "(no output)");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`my-6 scroll-mt-20 rounded-card border bg-surface-raised p-4 transition-colors duration-base ${result ? (result.ok ? "border-success/40" : "border-danger/30") : "border-surface-border"}`} aria-labelledby={`task-${task.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`task-${task.id}`} className="flex items-center gap-2 font-semibold text-ink">
          {task.type === "checklist" ? <Icon icon={CircleDashed} size="button" className="text-ink-faint" /> : task.type === "decision" ? (result?.ok ? <Icon icon={CheckCircle2} size="button" className="text-success" /> : <Icon icon={Scale} size="button" className="text-accent" />) : result?.ok ? <Icon icon={CheckCircle2} size="button" className="text-success" /> : <Icon icon={FlaskConical} size="button" className="text-accent" />}
          {task.title}
        </h3>
        <span className="text-[11px] uppercase tracking-wider text-ink-faint">{task.type === "sql" ? `SQL · ${project.dataset}` : task.type === "python" ? "Python" : task.type === "decision" ? "Design decision" : "Manual step"}</span>
      </div>
      <Markdown source={task.instructions} className="mt-2 text-sm" />
      {(task.type === "sql" || task.type === "python") && <LinkedExerciseList items={exercisesForTask(project.slug, task.id)} />}
      {task.type === "decision" ? (
        <DecisionBlock task={task} result={result} onAnswer={(ok) => record({ ok, message: ok ? "Good choice." : "Not the best fit here: read why below." })} />
      ) : task.type === "checklist" ? (
        <ul className="mt-2 space-y-1 text-sm">
          {task.items.map((item, i) => (
            <li key={i}>
              <label className="flex items-start gap-2 text-ink">
                <input type="checkbox" className="mt-1" checked={Boolean(progress.checklist[task.id]?.[i])} onChange={(e) => {
                  const ticks = [...(progress.checklist[task.id] ?? task.items.map(() => false))];
                  ticks[i] = e.target.checked;
                  onChange({ ...progress, checklist: { ...progress.checklist, [task.id]: ticks } });
                }} />
                <span><Markdown source={item} /></span>
              </label>
            </li>
          ))}
          <li className="text-xs text-ink-faint">Manual steps can't be verified in the browser; they're reviewed when you submit.</li>
        </ul>
      ) : task.type === "python" ? (
        <div className="mt-3">
          <PythonWorkspace
            slug={`proj-${project.slug}-${task.id}`}
            title={task.title}
            task={task as PythonTask}
            mode="project"
            height={380}
            onCheckResult={(r) => {
              record({ ok: r.ok, message: r.message });
              if (r.output) setOutput(r.output);
            }}
          />
          {result && <ResultBanner ok={result.ok} message={result.message} fresh={fresh} nextTitle={next?.title} nextHref={next ? `#task-${next.id}` : undefined} />}
          <details className="mt-2 text-xs text-ink-faint">
            <summary className="cursor-pointer py-1">Show a solution</summary>
            <Markdown source={"```python-syntax\n" + task.solution + "\n```"} />
          </details>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-[200px]" />}>
              <CodeEditor value={code} onChange={setCode} onRun={check} height={200} label={task.title} language={task.type} />
            </Suspense>
          ) : <Skeleton className="h-[200px]" />}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={run} disabled={busy}><Icon icon={Play} size="button" /> Run</Button>
            <Button size="sm" onClick={check} disabled={busy} aria-busy={busy}>
              {busy ? <Icon icon={Loader2} size="button" className="animate-spin" /> : <Icon icon={FlaskConical} size="button" />} Check
            </Button>
            <span className="hidden items-center self-center text-xs text-ink-faint sm:inline-flex">Ctrl or ⌘ + Enter checks your answer</span>
            <details className="text-xs text-ink-faint">
              <summary className="cursor-pointer py-1.5">Show a solution</summary>
              <Markdown source={"```sql-syntax\n" + task.solution + "\n```"} />
            </details>
          </div>
          {result && <ResultBanner ok={result.ok} message={result.message} fresh={fresh} nextTitle={next?.title} nextHref={next ? `#task-${next.id}` : undefined} />}
          {preview && (preview.success ? <SampleTable caption={`Result of the last statement (${preview.row_count ?? preview.rows.length} rows; rolled back)`} columns={preview.columns} rows={preview.rows} /> : <p className="text-sm text-danger">{preview.message}</p>)}
          {output && <pre tabIndex={0} className="max-h-48 overflow-auto rounded bg-surface-soft p-2 font-mono text-xs text-ink">{output}</pre>}
        </div>
      )}
    </section>
  );
}

export function ProjectPage() {
  const { data } = usePage();
  const project = data.project!;
  const path = `/projects-lab/${project.slug}`;
  const [mounted, setMounted] = useState(false);
  const [progress, setProgress] = useState<ProjectProgress>({ tasks: {}, checklist: {} });
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (project.dataset !== "northwind") registerDataset({ id: project.dataset, url: `/data/datasets/${project.dataset}.sql` });
    const p = getProjectProgress(project.slug);
    setProgress(p);
    setUrl(p.submission?.url ?? "");
    setNotes(p.submission?.notes ?? "");
    setMounted(true);
  }, [project.slug, project.dataset]);

  const update = (p: ProjectProgress, submitted = false) => {
    const before = projectStatus(project, progress);
    const after = projectStatus(project, p);
    if (before === "Not started" && after !== "Not started") track("project_started", project.slug);
    if (after === "Completed" && before !== "Completed") track("project_completed", project.slug);
    setProgress(p);
    saveProjectProgress(project.slug, p, submitted);
  };
  const status = projectStatus(project, progress);
  const automated = project.tasks.filter((t) => t.type !== "checklist");
  const passed = automated.filter((t) => progress.tasks[t.id]?.passed).length;
  const parts = useMemo(() => project.body.split(/<!--task:([^>]+)-->/), [project.body]);
  const taskRefs: TaskRef[] = useMemo(() => project.tasks.map((t) => ({ id: t.id, type: t.type, title: t.title })), [project.tasks]);
  const upNext = nextTask(taskRefs, progress);
  const finished = taskRefs.filter((t) => isFinished(taskState(t, progress))).length;
  /** The first task after this one that is not finished yet, offered when this one passes. */
  const after = (id: string): TaskRef | null => {
    const i = taskRefs.findIndex((t) => t.id === id);
    return taskRefs.slice(i + 1).find((t) => !isFinished(taskState(t, progress))) ?? null;
  };
  const prereqs = project.prerequisites.map((s) => data.notes?.find((n) => n.slug === s)).filter((x) => x !== undefined);

  function submit() {
    if (url && !isRepoUrl(url)) return setErr("Use an https link to a GitHub, GitLab or Bitbucket repository.");
    setErr(null);
    update({ ...progress, submission: { url: url || undefined, notes: notes.trim() || undefined, at: new Date().toISOString() } }, true);
  }

  return (
    <Container className="pt-6">
      <Seo
        title={`${project.title} — Data Engineering Project`}
        description={project.description}
        path={path}
        type="article"
        jsonLd={[
          breadcrumbs([{ name: "Home", path: "/" }, { name: "Projects lab", path: "/projects-lab" }, { name: project.title, path }]),
          { "@context": "https://schema.org", "@type": "LearningResource", name: project.title, description: project.description, url: canonical(path), learningResourceType: "Project", educationalLevel: project.level, teaches: project.technologies },
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint"><Link to="/projects-lab" className="transition-colors duration-fast hover:text-ink">Projects lab</Link></nav>
      <header className="mt-3 flex items-start gap-4">
        <IconTile icon={projectIcon(project.slug)} tone={LEVEL_TONE[project.level as Level] ?? "info"} size="feature" className="hidden !p-3.5 sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{project.title}</h1>
            <LevelBadge level={project.level} />
            <StatusChip s={status} />
            <Link
              to="/study-notes"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-fast hover:border-accent hover:text-accent"
              title="Export notes and study guide as PDF"
            >
              <Icon icon={FileText} size="inline" /> Export Notes (PDF)
            </Link>
          </div>
          <p className="mt-1 text-ink-muted">{project.description}</p>
          <p className="mt-2 text-sm text-ink-muted">
            {project.technologies.join(" · ")} · about {Math.round(project.minutes / 60 * 10) / 10} h · dataset <Link to={`/playground?db=${project.dataset}`} className="text-accent hover:underline">{project.dataset}</Link>
            {prereqs.length > 0 && <> · before you start: {prereqs.map((n, i) => <span key={n.slug}><Link to={`/notes/${n.slug}`} className="text-accent hover:underline">{n.title}</Link>{i < prereqs.length - 1 ? ", " : ""}</span>)}</>}
          </p>
        </div>
      </header>
      <div data-help="project-progress" className="mt-4">
        <ProgressBar value={passed} max={automated.length || 1} label={`${passed} of ${automated.length} automated checks passed`} tone={status === "Completed" ? "success" : "accent"} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-ink-muted">
          <strong className="text-ink">{passed}/{automated.length}</strong> automated checks passed <HelpTooltip id="validation-check" label="How are my answers graded automatically?" /> ·{" "}
          <strong className="text-ink">{project.tasks.length - automated.length}</strong> manual review requirements
        </span>
        {upNext && passed > 0 && passed < automated.length && (
          <a
            href={`#task-${upNext.id}`}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 font-semibold text-on-accent transition-[filter,transform] duration-fast hover:brightness-110 active:scale-[0.98] active:duration-instant"
          >
            Resume task: {upNext.title} <Icon icon={ArrowDown} size="inline" />
          </a>
        )}
      </div>

      <Disclosure defaultOpen className="mt-4" header={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-2 font-semibold text-ink"><Icon icon={ListChecks} size="button" className="text-accent" />Task roadmap</span>
          <span className="text-xs text-ink-muted tabular-nums">{finished} of {project.tasks.length} steps done{upNext ? ` · next: ${upNext.title}` : ""}</span>
        </span>
      }>
        <TaskRoadmap tasks={taskRefs} progress={progress} nextId={upNext?.id} />
      </Disclosure>

      <div data-help="project-flow" className="mt-4 rounded-lg border border-surface-border bg-surface-raised p-3.5 text-xs">
        <p className="font-semibold uppercase tracking-wider text-ink-faint text-[10px]">Pipeline Architecture & Validation Flow</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-ink">
          <span className="rounded bg-surface-soft px-2 py-1 font-mono">Dataset: {project.dataset}</span>
          <span className="text-ink-faint">→</span>
          <span className="rounded bg-accent-dim px-2 py-1 text-accent font-medium">{project.technologies.slice(0, 2).join(" + ")} Pipeline</span>
          <span className="text-ink-faint">→</span>
          <span className="rounded bg-surface-soft px-2 py-1 font-mono">{automated.length} Automated Checks</span>
          <span className="text-ink-faint">→</span>
          <span className="rounded bg-success-dim px-2 py-1 text-success font-medium">Production Deliverable</span>
        </div>
      </div>

      {mounted && (
        <ProjectCelebration
          projectSlug={project.slug}
          projectTitle={project.title}
          completed={status === "Completed" || (automated.length > 0 && passed === automated.length)}
          passedCount={passed}
          totalCount={automated.length}
        />
      )}

      <article data-help="project-tasks" className="mt-6 max-w-4xl">
        {parts.map((part, i) =>
          i % 2 === 0 ? (
            <Markdown key={i} source={part} />
          ) : (
            (() => {
              const task = project.tasks.find((t) => t.id === part);
              // Remount once saved progress has loaded: the panel seeds its result and code from it on first render.
              return task ? <TaskPanel key={`${part}:${mounted}`} task={task} project={project} progress={progress} onChange={update} mounted={mounted} next={after(task.id)} /> : null;
            })()
          ),
        )}
      </article>

      <section data-help="project-submit" className="mt-10 max-w-4xl rounded-card border border-surface-border bg-surface-raised p-5" aria-labelledby="submit">
        <h2 id="submit" className="font-display text-lg font-bold text-ink">Submit your project</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {status === "Completed"
            ? "Every automated check passes — this project is complete."
            : "Submitting records your work. A project becomes Completed only when its automated checks pass; manual steps stay Under evaluation until reviewed."}
        </p>
        <label className="mt-3 block text-sm text-ink">
          Repository link (optional)
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/project" className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm" />
        </label>
        <label className="mt-3 block text-sm text-ink">
          Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm" />
        </label>
        {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
        <button type="button" onClick={submit} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"><Send className="h-4 w-4" aria-hidden /> {progress.submission ? "Update submission" : "Submit"}</button>
        {progress.submission && <p className="mt-2 text-xs text-ink-faint">Submitted {new Date(progress.submission.at).toLocaleString()}.</p>}
        {progress.submission?.review?.comment && (
          <p className="mt-2 rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink">
            <span className="font-semibold">Reviewer ({progress.submission.review.status}):</span> {progress.submission.review.comment}
          </p>
        )}
      </section>
    </Container>
  );
}

/** Pick one option; after answering, every option shows why it is or isn't the right call. */
function DecisionBlock({ task, result, onAnswer }: { task: import("../lib/tasks").DecisionTask; result: { ok: boolean } | null | undefined; onAnswer: (ok: boolean) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  return (
    <div className="mt-3 space-y-2">
      <fieldset className="space-y-1.5" disabled={answered}>
        <legend className="sr-only">{task.title}</legend>
        {task.options.map((o, i) => {
          const right = i === task.answer;
          const tone = !answered ? "border-surface-border hover:border-accent/40" : right ? "border-success/50 bg-success-dim" : i === picked ? "border-danger/50 bg-danger-dim" : "border-surface-border opacity-80";
          return (
            <label key={i} className={`block rounded-lg border p-2.5 text-sm ${tone}`}>
              <span className="flex items-start gap-2">
                <input type="radio" name={`d-${task.id}`} className="mt-1" checked={picked === i} onChange={() => { setPicked(i); onAnswer(i === task.answer); }} />
                <span className="text-ink"><Markdown source={o} className="inline" /></span>
              </span>
              {answered && <span className={`mt-1 block pl-6 text-xs ${right ? "text-success" : "text-ink-muted"}`}>{right ? "Best fit: " : ""}{task.why[i]}</span>}
            </label>
          );
        })}
      </fieldset>
      {answered && <button type="button" className="text-xs text-ink-muted underline hover:text-ink" onClick={() => setPicked(null)}>Try again</button>}
      {!answered && result?.ok && <p className="text-xs text-success">Answered correctly before.</p>}
    </div>
  );
}
