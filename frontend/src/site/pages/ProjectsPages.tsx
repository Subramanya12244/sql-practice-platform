import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleDashed, FlaskConical, Loader2, Play, Send } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { SampleTable } from "../components/SampleTable";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { LevelBadge } from "../components/LearnUi";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { registerDataset, runQuery } from "../lib/browserDb";
import { runPython } from "../lib/pyRunner";
import { runPythonTask, runSqlTask, type Task, type TaskResult } from "../lib/tasks";
import { getProjectProgress, isRepoUrl, projectStatus, saveProjectProgress, type Project, type ProjectProgress, type ProjectStatus } from "../lib/projects";
import type { ExecuteResult } from "../../types";

const CodeEditor = lazy(() => import("../components/CodeEditor"));

const STATUS_TONE: Record<ProjectStatus, string> = {
  "Not started": "bg-surface-soft text-ink-muted",
  "In progress": "bg-accent-dim text-accent",
  Submitted: "bg-warn-dim text-warn",
  "Under evaluation": "bg-warn-dim text-warn",
  Completed: "bg-success-dim text-success",
};
function StatusChip({ s }: { s: ProjectStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[s]}`}>{s}</span>;
}

export function ProjectsIndexPage() {
  const { data } = usePage();
  const all = data.projects ?? [];
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({});
  const [mine, setMine] = useState(false);
  useEffect(() => {
    setStatuses(Object.fromEntries((data.projectTasks ?? []).map((p) => [p.slug, projectStatus({ tasks: p.tasks }, getProjectProgress(p.slug))])));
  }, [data.projectTasks]);
  const shown = mine ? all.filter((p) => (statuses[p.slug] ?? "Not started") !== "Not started") : all;

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
      <div className="mb-4 flex gap-2 text-sm" role="tablist">
        <button type="button" role="tab" aria-selected={!mine} onClick={() => setMine(false)} className={`rounded-lg px-3 py-1.5 ${!mine ? "bg-accent text-white" : "border border-surface-border text-ink-muted"}`}>Project library</button>
        <button type="button" role="tab" aria-selected={mine} onClick={() => setMine(true)} className={`rounded-lg px-3 py-1.5 ${mine ? "bg-accent text-white" : "border border-surface-border text-ink-muted"}`}>My projects</button>
      </div>
      {mine && !shown.length && <p className="text-sm text-ink-muted">Start a task in any project and it will show up here.</p>}
      {["Beginner", "Intermediate", "Advanced"].map((level) => {
        const group = shown.filter((p) => p.level === level);
        if (!group.length) return null;
        return (
          <section key={level} className="mb-8">
            <h2 className="font-display text-xl font-bold text-ink">{level}</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((p) => (
                <li key={p.slug}>
                  <Link to={`/projects-lab/${p.slug}`} className="flex h-full flex-col rounded-card border border-surface-border bg-surface-raised p-4 hover:border-accent/40">
                    <span className="flex items-start justify-between gap-2"><span className="font-semibold text-ink">{p.title}</span><StatusChip s={statuses[p.slug] ?? "Not started"} /></span>
                    <span className="mt-1 text-sm text-ink-muted">{p.description}</span>
                    <span className="mt-auto pt-2 text-xs text-ink-faint">{p.technologies.join(" · ")} · {p.automated} auto-checked, {p.manual} manual step{p.manual === 1 ? "" : "s"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Container>
  );
}

function TaskPanel({ task, project, progress, onChange, mounted }: {
  task: Task;
  project: Project;
  progress: ProjectProgress;
  onChange: (p: ProjectProgress) => void;
  mounted: boolean;
}) {
  const saved = progress.tasks[task.id];
  const [code, setCode] = useState(saved?.code ?? ("starter" in task ? task.starter : ""));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TaskResult | null>(saved ? { ok: saved.passed, message: saved.message ?? (saved.passed ? "Check passed." : "") } : null);
  const [preview, setPreview] = useState<ExecuteResult | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  const record = (r: TaskResult) => {
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
    <section className="my-6 rounded-card border border-surface-border bg-surface-raised p-4" aria-labelledby={`task-${task.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`task-${task.id}`} className="flex items-center gap-2 font-semibold text-ink">
          {task.type === "checklist" ? <CircleDashed className="h-4 w-4 text-ink-faint" aria-hidden /> : result?.ok ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <FlaskConical className="h-4 w-4 text-accent" aria-hidden />}
          {task.title}
        </h3>
        <span className="text-[11px] uppercase tracking-wider text-ink-faint">{task.type === "sql" ? `SQL · ${project.dataset}` : task.type === "python" ? "Python" : "Manual step"}</span>
      </div>
      <Markdown source={task.instructions} className="mt-2 text-sm" />
      {task.type === "checklist" ? (
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
      ) : (
        <div className="mt-3 space-y-2">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-[200px]" />}>
              <CodeEditor value={code} onChange={setCode} onRun={check} height={200} label={task.title} language={task.type} />
            </Suspense>
          ) : <Skeleton className="h-[200px]" />}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={run} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-sm disabled:opacity-60"><Play className="h-4 w-4" aria-hidden /> Run</button>
            <button type="button" onClick={check} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />} Check
            </button>
            <details className="text-xs text-ink-faint">
              <summary className="cursor-pointer py-1.5">Show a solution</summary>
              <Markdown source={"```" + (task.type === "sql" ? "sql-syntax" : "python-syntax") + "\n" + task.solution + "\n```"} />
            </details>
          </div>
          {result && <p role="status" className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.ok ? "✅ " : "❌ "}{result.message}</p>}
          {preview && (preview.success ? <SampleTable caption={`Result of the last statement (${preview.row_count ?? preview.rows.length} rows; rolled back)`} columns={preview.columns} rows={preview.rows} /> : <p className="text-sm text-danger">{preview.message}</p>)}
          {output && <pre className="max-h-48 overflow-auto rounded bg-surface-soft p-2 font-mono text-xs text-ink">{output}</pre>}
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
    setProgress(p);
    saveProjectProgress(project.slug, p, submitted);
  };
  const status = projectStatus(project, progress);
  const automated = project.tasks.filter((t) => t.type !== "checklist");
  const passed = automated.filter((t) => progress.tasks[t.id]?.passed).length;
  const parts = useMemo(() => project.body.split(/<!--task:([^>]+)-->/), [project.body]);
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
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint"><Link to="/projects-lab" className="hover:text-ink">Projects lab</Link></nav>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{project.title}</h1>
        <LevelBadge level={project.level} />
        <StatusChip s={status} />
      </div>
      <p className="mt-1 text-ink-muted">{project.description}</p>
      <p className="mt-2 text-sm text-ink-muted">
        {project.technologies.join(" · ")} · about {Math.round(project.minutes / 60 * 10) / 10} h · dataset <Link to={`/playground?db=${project.dataset}`} className="text-accent hover:underline">{project.dataset}</Link>
        {prereqs.length > 0 && <> · before you start: {prereqs.map((n, i) => <span key={n.slug}><Link to={`/notes/${n.slug}`} className="text-accent hover:underline">{n.title}</Link>{i < prereqs.length - 1 ? ", " : ""}</span>)}</>}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-soft" aria-label={`${passed} of ${automated.length} automated checks passed`}>
        <div className="h-full bg-success" style={{ width: `${automated.length ? (100 * passed) / automated.length : 0}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-faint">{passed}/{automated.length} automated checks passed · progress is saved in this browser</p>

      <article className="mt-6 max-w-4xl">
        {parts.map((part, i) =>
          i % 2 === 0 ? (
            <Markdown key={i} source={part} />
          ) : (
            (() => {
              const task = project.tasks.find((t) => t.id === part);
              return task ? <TaskPanel key={part} task={task} project={project} progress={progress} onChange={update} mounted={mounted} /> : null;
            })()
          ),
        )}
      </article>

      <section className="mt-10 max-w-4xl rounded-card border border-surface-border bg-surface-raised p-5" aria-labelledby="submit">
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
      </section>
    </Container>
  );
}
