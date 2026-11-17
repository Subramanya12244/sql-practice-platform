import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Circle, Clock, Compass, Layers, Play } from "lucide-react";
import { usePage } from "../SiteApp";
import { Badge, ButtonLink, Card, Container, EmptyState, ErrorState, ProgressBar, SectionHeader, SegmentedProgress } from "../components/ui";
import { BookmarkButton, LevelBadge, Minutes } from "../components/LearnUi";
import { LearnHero } from "../components/learn/LearnHero";
import { PathCards, pathProgressLabel } from "../components/learn/PathCards";
import { TopicLibrary, useTopicFilter } from "../components/learn/TopicLibrary";
import { CurriculumRoadmap } from "../components/learn/CurriculumRoadmap";
import { PracticeProjects, ResourceShelf } from "../components/learn/PracticeResources";
import { SUBJECT_STYLE, StatusPill, SubjectIcon, TopicDuration, useLearnModel } from "../components/learn/shared";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { LEARN_PATHS, hoursLabel, pathById, pathModel, type PathModel } from "../lib/learnPaths";
import { NO_FILTER, SUBJECT_LABEL, topicEyebrow, topicProgress, type TopicFilter } from "../lib/learnTopics";
import { NOTE_CATEGORIES } from "../lib/learning";
import { dayHref } from "../lib/daily";
import { isDone } from "../lib/dailyProgress";
import { NotFoundPage } from "./NotFoundPage";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── /learn ───────────────────────────────────────────────────────────────
export function LearnHubPage() {
  const { hub, ctx, view, mounted } = useLearnModel();
  const { data } = usePage();
  const [filter, setFilter] = useTopicFilter();

  const search = (q: string) => {
    const next: TopicFilter = { ...NO_FILTER, q };
    setFilter(next);
    const el = document.getElementById("topics");
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  };

  const jsonLd = [
    breadcrumbs([{ name: "Home", path: "/" }, { name: "Learn", path: "/learn" }]),
    {
      "@context": "https://schema.org", "@type": "ItemList", name: "DataForge learning paths",
      itemListElement: LEARN_PATHS.map((p, i) => ({ "@type": "ListItem", position: i + 1, name: p.title, url: canonical(`/learn/path/${p.id}`) })),
    },
  ];

  return (
    <Container className="pb-16 pt-8 sm:pt-12">
      <Seo
        title="Learn SQL, Python, Data Analytics and Data Engineering"
        description="Four free learning paths with real lessons and exercises, a searchable topic library, a 180-day curriculum and guided projects. Everything runs in your browser."
        path="/learn"
        jsonLd={jsonLd}
      />
      {!hub || !ctx ? (
        <ErrorState title="The learning hub could not be loaded" onRetry={() => window.location.reload()}>Check your connection and try again. Your progress is not affected.</ErrorState>
      ) : (
        <div className="space-y-14">
          <LearnHero hub={hub} view={view} mounted={mounted} onSearch={search} />
          <PathCards ctx={ctx} />
          <TopicLibrary topics={hub.topics} filter={filter} setFilter={setFilter} progress={view.progress} daily={view.state} />
          <CurriculumRoadmap daily={view.state} />
          <PracticeProjects hub={hub} progress={view.progress} index={data.index} mounted={mounted} projectProgress={ctx.projectProgress} />
          <ResourceShelf hub={hub} progress={view.progress} mounted={mounted} />
        </div>
      )}
    </Container>
  );
}

// ── /learn/path/:id ──────────────────────────────────────────────────────
function NextCard({ m }: { m: PathModel }) {
  const n = m.next;
  if (!n) return null;
  const label = n.kind === "project" ? "Start the final project" : m.started ? "Continue" : "Start";
  return (
    <Card aria-label="Recommended next lesson" pad="md" data-help="path-next">
      <p className="text-label uppercase text-accent">{n.kind === "project" ? "Next: final project" : "Recommended next lesson"}</p>
      <p className="mt-1 text-xs text-ink-faint">{n.detail}</p>
      <h2 className="mt-0.5 font-display text-h3 text-ink">{n.title}</h2>
      <p className="mt-2 text-xs text-ink-muted">{n.reason}</p>
      <ButtonLink to={n.to} className="mt-4"><Play className="h-4 w-4" aria-hidden /> {label}</ButtonLink>
    </Card>
  );
}

function CourseSection({ m, passed }: { m: PathModel; passed: Record<string, string> | undefined }) {
  const c = m.course;
  if (!c) return null;
  const levels = ["Beginner", "Intermediate", "Advanced"];
  return (
    <section data-help="learn-roadmap" aria-labelledby="course-heading" className="scroll-mt-20">
      <SectionHeader id="course-heading" title="Quick start: the free SQL course"
        description={<>{plural(c.lessons.length, "lesson")} with {plural(c.totalEx, "graded exercise")}, in order. It starts from SELECT and needs nothing else. {c.doneEx > 0 && `You have passed ${c.doneEx} of ${c.totalEx}.`}</>} />
      {c.doneEx > 0 && <ProgressBar value={c.doneEx} max={c.totalEx || 1} label="SQL course exercises passed" className="mb-4 max-w-md" />}
      {levels.map((level) => {
        const group = c.lessons.filter((l) => l.level === level);
        if (!group.length) return null;
        return (
          <div key={level} className="mt-4">
            <h3 className="font-display text-h3 text-ink">{level}</h3>
            <ol className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((l) => (
                <li key={l.slug}><CourseLesson l={l} passed={passed} /></li>
              ))}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

function CourseLesson({ l, passed }: { l: { slug: string; title: string; order: number; description: string; exercises: number }; passed: Record<string, string> | undefined }) {
  let done = 0;
  for (let i = 0; i < l.exercises; i++) if (passed?.[`${l.slug}#${i}`]) done++;
  const complete = l.exercises > 0 && done === l.exercises;
  return (
    <Link to={`/learn/${l.slug}`} className="flex h-full flex-col rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition-all duration-base ease-out hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow active:scale-[0.99]">
      <span className="flex items-center justify-between text-xs text-ink-faint">
        <span>Lesson {l.order}</span>
        <span className={complete ? "inline-flex items-center gap-1 text-success" : ""}>{complete && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}{done}/{l.exercises} exercises</span>
      </span>
      <span className="mt-1 font-semibold text-ink">{l.title}</span>
      <span className="mt-1 flex-1 text-sm text-ink-muted">{l.description}</span>
      {l.exercises > 0 && <SegmentedProgress className="mt-3" done={done} total={l.exercises} label={`${l.title}: ${done} of ${l.exercises} exercises passed`} />}
    </Link>
  );
}

export function LearnPathPage() {
  const { params, data } = usePage();
  const { hub, ctx, view, mounted } = useLearnModel();
  const def = pathById(params.id ?? "");
  const m = useMemo(() => (def && ctx ? pathModel(def, ctx) : null), [def, ctx]);
  if (!def || !hub || !ctx || !m) return <NotFoundPage />;

  const sqlSolved = data.index.filter((q) => view.progress.questions[q.number]?.solvedAt).length;
  const pyPassed = Object.keys(view.progress.lessons ?? {}).filter((k) => k.startsWith("py:")).length;
  const path = `/learn/path/${def.id}`;
  const subject = SUBJECT_STYLE[def.subject];
  const jsonLd = [
    breadcrumbs([{ name: "Home", path: "/" }, { name: "Learn", path: "/learn" }, { name: def.title, path }]),
    {
      "@context": "https://schema.org", "@type": "Course", name: def.id === "sql-developer" ? "Learn SQL from scratch" : `${def.title} learning path`,
      description: def.tagline, url: canonical(path), isAccessibleForFree: true,
      provider: { "@type": "Organization", name: "DataForge", sameAs: canonical("/") },
      ...(def.id === "sql-developer" ? { hasCourseInstance: { "@type": "CourseInstance", courseMode: "online", courseWorkload: "PT10H" }, syllabusSections: hub.lessons.map((l) => ({ "@type": "Syllabus", name: l.title, url: canonical(`/learn/${l.slug}`) })) } : {}),
    },
  ];
  const seoTitle = def.id === "sql-developer" ? "Learn SQL: Free Interactive SQL Course and Path with Exercises" : `${def.title} Learning Path: Lessons, Practice and Final Project`;

  return (
    <Container className="pb-16 pt-8 sm:pt-12">
      <Seo title={seoTitle} description={`${def.tagline} ${m.lessons} lessons, about ${hoursLabel(m.minutes)} planned, notes, practice and a final project.`} path={path} jsonLd={jsonLd} />
      <Link to="/learn" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden /> All learning paths</Link>

      <header className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        <div>
          <div className="flex items-center gap-3"><SubjectIcon subject={def.subject} /><p className={`text-label uppercase ${subject.text}`}>Learning path{m.levelLabel ? ` · ${m.levelLabel}` : ""}</p></div>
          <h1 className="mt-3 font-display text-h1 text-ink">{def.title}</h1>
          <p className="mt-2 max-w-2xl text-lead text-ink-muted">{def.tagline}</p>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-muted" aria-label="Path size">
            <li className="inline-flex items-center gap-1.5"><Layers className="h-4 w-4" aria-hidden />{plural(m.lessons, "lesson")}</li>
            <li className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" aria-hidden />{hoursLabel(m.minutes)} planned{m.done > 0 && `, ${hoursLabel(m.remainingMinutes)} left`}</li>
            {m.levelLabel && <li className="inline-flex items-center gap-1.5"><Compass className="h-4 w-4" aria-hidden />{m.levelLabel}</li>}
          </ul>
          <div className="mt-5 max-w-xl">
            <div className="mb-1 flex justify-between text-xs text-ink-muted"><span>{pathProgressLabel(m)}</span><span className="tabular-nums">{m.percent}%</span></div>
            <ProgressBar value={m.done} max={m.lessons || 1} label={`${def.title}: ${pathProgressLabel(m)}`} />
            {m.mastered > 0 && <p className="mt-1.5 text-xs text-ink-muted">{plural(m.mastered, "lesson")} mastered: knowledge check 80% or more, independent exercises passed, revision done.</p>}
          </div>
        </div>
        <NextCard m={m} />
      </header>

      <div className="mt-12 space-y-12">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card as="section" aria-labelledby="objectives-heading" data-help="path-objectives">
            <h2 id="objectives-heading" className="font-display text-h2 text-ink">What you will learn</h2>
            <ul className="mt-3 space-y-2">
              {def.objectives.map((o) => <li key={o} className="flex gap-2 text-sm text-ink-muted"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />{o}</li>)}
            </ul>
          </Card>
          <Card as="section" aria-labelledby="prereq-heading">
            <h2 id="prereq-heading" className="font-display text-h2 text-ink">Before you start</h2>
            <ul className="mt-3 space-y-2">
              {def.prerequisites.map((o) => <li key={o} className="flex gap-2 text-sm text-ink-muted"><Circle className="mt-1.5 h-2 w-2 shrink-0 fill-current text-ink-faint" aria-hidden />{o}</li>)}
            </ul>
            {m.core && (
              <div className="mt-4 rounded-lg border border-surface-border bg-surface-overlay p-3">
                <div className="mb-1 flex justify-between text-xs text-ink-muted"><span>Common core</span><span className="tabular-nums">{m.core.done} of {m.core.total} lessons completed</span></div>
                <ProgressBar value={m.core.done} max={m.core.total || 1} label={`Common core: ${m.core.done} of ${m.core.total} lessons completed`} tone={m.core.done === m.core.total ? "success" : "accent"} />
                <Link to="/daily/day/1" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">Open the common core <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
              </div>
            )}
          </Card>
        </div>

        <section aria-labelledby="modules-heading" data-help="path-modules">
          <SectionHeader id="modules-heading" title="Modules and lessons" description={`${plural(m.stages.length, "module")}, in order. Open a module to see its lessons. A lesson counts when you complete it, not when you open it.`} />
          <ol className="space-y-3">
            {m.stages.map((s, i) => (
              <li key={s.id}>
                <details className="group rounded-card border border-surface-border bg-surface-raised shadow-panel open:border-accent/30">
                  <summary className="relative flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 p-4 pr-11 [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="absolute right-4 top-4 h-4 w-4 text-ink-faint transition-transform duration-fast group-open:rotate-180" aria-hidden />
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-dim text-xs font-semibold text-accent tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{s.title}</span>
                      <span className="block text-xs text-ink-muted">{s.summary}</span>
                    </span>
                    <span className="flex w-full items-center gap-3 sm:w-56">
                      <ProgressBar className="flex-1" value={s.done} max={s.days.length} label={`${s.title}: ${s.done} of ${s.days.length} lessons completed`} tone={s.done === s.days.length ? "success" : "accent"} />
                      <span className="text-xs tabular-nums text-ink-muted">{s.done}/{s.days.length}</span>
                    </span>
                  </summary>
                  <ol className="border-t border-surface-border px-4 py-2">
                    {s.days.map((d) => {
                      const done = isDone(view.state, d.id);
                      return (
                        <li key={d.id}>
                          <Link to={dayHref(d)} className="flex items-center gap-3 rounded-lg px-1 py-2 text-sm hover:bg-hover/5">
                            {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Completed" /> : <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-label="Not completed" />}
                            <span className="w-14 shrink-0 text-xs text-ink-faint tabular-nums">Day {d.day}</span>
                            <span className="min-w-0 flex-1 truncate text-ink">{d.title}</span>
                            <span className="shrink-0 text-xs text-ink-faint">{d.minutes} min</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </details>
              </li>
            ))}
          </ol>
        </section>

        <CourseSection m={m} passed={view.progress.lessons} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card as="section" aria-labelledby="notes-heading" data-help="path-notes">
            <h2 id="notes-heading" className="font-display text-h2 text-ink">Notes for this path</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Theory you can read alongside the lessons. Marked as read by you.</p>
            <ul className="mt-3 space-y-3">
              {m.notes.map((n) => {
                const cat = NOTE_CATEGORIES.find((c) => c.slug === n.category);
                return (
                  <li key={n.category}>
                    <Link to={cat?.group === "de" ? `/data-engineering#${n.category}` : `/notes#cat-${n.category}`} className="block text-sm hover:text-accent">
                      <span className="flex justify-between gap-2"><span className="font-medium text-ink">{n.label}</span><span className="text-xs tabular-nums text-ink-muted">{n.read}/{n.total} read</span></span>
                    </Link>
                    <ProgressBar className="mt-1.5" value={n.read} max={n.total} label={`${n.label} notes read: ${n.read} of ${n.total}`} />
                  </li>
                );
              })}
            </ul>
            <Link to={`/learn?subject=${def.subject}#topics`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">Browse all {SUBJECT_LABEL[def.subject]} topics <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </Card>

          <Card as="section" aria-labelledby="practice-heading" data-help="path-practice">
            <h2 id="practice-heading" className="font-display text-h2 text-ink">Practical exercises</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Practice that goes with this path.</p>
            <ul className="mt-3 space-y-2">
              {def.practice.map((p) => (
                <li key={p.to}>
                  <Link to={p.to} className="group flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2.5 transition-colors duration-fast hover:border-accent/40">
                    <span className="min-w-0"><span className="block text-sm font-medium text-ink group-hover:text-accent">{p.label}</span><span className="block text-xs text-ink-muted">{p.desc}</span></span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                      {p.to === "/questions" ? (mounted ? `${sqlSolved} of ${data.index.length} solved` : `${data.index.length} questions`) : p.to === "/practice/python" ? (mounted ? `${pyPassed} of ${hub.counts.exercises} passed` : `${hub.counts.exercises} problems`) : p.to === "/scenarios" ? `${hub.counts.scenarios} scenarios` : <ArrowRight className="h-4 w-4" aria-hidden />}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {m.project && (
          <section aria-labelledby="project-heading" data-help="path-project">
            <SectionHeader id="project-heading" title="Final project" description="Apply the whole path to one guided project. Its tasks are checked automatically." />
            <Card pad="md" className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 max-w-2xl">
                <p className="flex flex-wrap items-center gap-2"><LevelBadge level={m.project.meta.level} /><Minutes n={m.project.meta.minutes} />{mounted && m.project.status !== "Not started" && <Badge tone={m.project.status === "Completed" ? "success" : "info"}>{m.project.status}</Badge>}</p>
                <h3 className="mt-2 font-display text-h3 text-ink">{m.project.meta.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{m.project.meta.description}</p>
                <p className="mt-1 text-xs text-ink-faint">{m.project.meta.technologies.join(" · ")}</p>
              </div>
              <ButtonLink to={`/projects-lab/${m.project.meta.slug}`} variant="secondary">Open project <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>
            </Card>
          </section>
        )}
      </div>
    </Container>
  );
}

// ── /learn/topic/:slug ───────────────────────────────────────────────────
function Section({ id, title, children, help }: { id: string; title: string; children: React.ReactNode; help?: string }) {
  return (
    <Card as="section" aria-labelledby={id} data-help={help}>
      <h2 id={id} className="font-display text-h3 text-ink">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </Card>
  );
}

/** A short labelled list of links in two columns, so a topic with many patterns or maps does not become a long scroll. */
function ResourceGroup({ title, items }: { title: string; items: { key: string; to: string; label: string; note?: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-label uppercase text-ink-faint">{title} <span className="tabular-nums">({items.length})</span></p>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.key}>
            <Link to={i.to} className="group flex h-full items-center justify-between gap-2 rounded-lg border border-surface-border px-3 py-1.5 text-sm transition-colors duration-fast hover:border-accent/40">
              <span className="min-w-0 truncate font-medium text-ink group-hover:text-accent">{i.label}</span>
              {i.note && <span className="shrink-0 text-[11px] text-ink-faint">{i.note}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const linkRow = "group flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2 text-sm transition-colors duration-fast hover:border-accent/40";

export function LearnTopicPage() {
  const { data } = usePage();
  const { view, mounted } = useLearnModel();
  const b = data.learnTopic;
  if (!b) return <NotFoundPage />;
  const t = b.topic;
  const { progress } = view;
  const st = topicProgress({ id: t.id, kind: t.kind, questions: t.questions, days: b.daily.flatMap((d) => d.days) }, progress, view.state);
  const solved = b.questions.filter((q) => progress.questions[q.number]?.solvedAt).length;
  const passed = b.exercises.filter((e) => progress.lessons?.[`py:${e.slug}`]).length;
  const path = `/learn/topic/${t.id}`;
  const parts = [t.kind === "note" ? "the note" : `${plural(b.daily.reduce((s, d) => s + d.lessons, 0), "Daily lesson")}`, b.questions.length + b.exercises.length > 0 && plural(b.questions.length + b.exercises.length, "practice problem"), b.patterns.length > 0 && plural(b.patterns.length, "pattern"), b.maps.length > 0 && plural(b.maps.length, "mind map"), b.projects.length > 0 && plural(b.projects.length, "project")].filter(Boolean);
  const hasLearn = t.kind === "note" || b.guides.length + b.maps.length + b.patterns.length > 0;
  const practiceEmpty = b.questions.length + b.exercises.length === 0;
  const startTo = t.kind === "note" ? `/notes/${t.id}` : b.daily[0]?.href ?? "/daily";

  return (
    <Container className="pb-16 pt-8 sm:pt-12">
      <Seo
        title={`${t.title}: notes, practice and projects`}
        description={`Everything DataForge has on ${t.title} in one place: ${parts.join(", ")}.`}
        path={path}
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Learn", path: "/learn" }, { name: t.title, path }])]}
      />
      <Link to={`/learn?subject=${t.subject}#topics`} className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden /> All {SUBJECT_LABEL[t.subject]} topics</Link>

      <header className="mt-4 max-w-3xl">
        <p className={`text-label uppercase ${SUBJECT_STYLE[t.subject].text}`}>{topicEyebrow(t.subject, t.categoryLabel)}</p>
        <h1 className="mt-2 font-display text-h1 text-ink">{t.title}</h1>
        <p className="mt-2 text-lead text-ink-muted">{t.description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <LevelBadge level={t.level} />{t.kind === "module" ? <TopicDuration minutes={t.minutes} /> : <Minutes n={t.minutes} />}
          {mounted ? <span className="inline-flex items-center gap-2"><StatusPill status={st.status} label={st.label} /><span className="text-xs text-ink-muted">{st.detail}</span></span> : <span className="text-xs text-ink-faint">Progress loads in your browser</span>}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <ButtonLink to={startTo}><Play className="h-4 w-4" aria-hidden /> {t.kind === "note" ? "Read the note" : "Start the first lesson"}</ButtonLink>
          {t.kind === "note" && <BookmarkButton itemKey={`note:${t.id}`} label="note" />}
        </div>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <div className="space-y-4">
          {hasLearn && (
            <Section id="learn-heading" title="Learn" help="topic-learn">
              {t.kind === "note" && <Link to={`/notes/${t.id}`} className={linkRow}><span><span className="block font-medium text-ink group-hover:text-accent">Theory note: {t.title}</span><span className="block text-xs text-ink-muted">Definition, how it works, examples, common mistakes and a quick revision</span></span><ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /></Link>}
              <ResourceGroup title="Concept guides" items={b.guides.map((g) => ({ key: g.slug, to: `/concepts/${g.slug}`, label: g.title }))} />
              <ResourceGroup title="Patterns" items={b.patterns.map((p) => ({ key: p.slug, to: `/patterns/${p.slug}`, label: p.title, note: p.difficulty }))} />
              <ResourceGroup title="Mind maps" items={b.maps.map((mm) => ({ key: mm.slug, to: `/mindmaps/${mm.slug}`, label: mm.title }))} />
            </Section>
          )}

          {t.visual.length > 0 && (
            <Section id="see-heading" title="See it run" help="topic-visual">
              {t.visual.map((v) => <Link key={v.to} to={v.to} className={linkRow}><span className="font-medium text-ink group-hover:text-accent">{v.label}</span><ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /></Link>)}
            </Section>
          )}

          <Section id="practice-heading" title="Practice" help="topic-practice">
            {practiceEmpty ? (
              <EmptyState title="No graded practice is linked to this topic yet">{t.subject === "sql" ? <>Try the <Link to="/questions" className="text-accent underline">SQL practice set</Link> or a related topic.</> : t.subject === "python" ? <>Try the <Link to="/practice/python" className="text-accent underline">Python practice set</Link> or a related topic.</> : <>The Daily lessons for this topic include exercises, and the <Link to="/projects-lab" className="text-accent underline">guided projects</Link> apply it.</>}</EmptyState>
            ) : (
              <>
                {b.questions.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex justify-between text-xs text-ink-muted"><span className="font-semibold uppercase tracking-wider text-ink-faint">SQL questions</span><span className="tabular-nums">{mounted ? `${solved} of ${b.questions.length} solved` : plural(b.questions.length, "question")}</span></p>
                    <ul className="space-y-1.5">
                      {b.questions.map((q) => (
                        <li key={q.number}><Link to={`/questions/${q.slug}`} className={linkRow}>
                          <span className="flex min-w-0 items-center gap-2">{progress.questions[q.number]?.solvedAt ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Solved" /> : <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-label="Not solved" />}<span className="truncate font-medium text-ink group-hover:text-accent">{q.title}</span></span>
                          <span className="shrink-0 text-xs text-ink-faint">Q{q.number} · {q.difficulty}</span>
                        </Link></li>
                      ))}
                    </ul>
                  </div>
                )}
                {b.exercises.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex justify-between text-xs text-ink-muted"><span className="font-semibold uppercase tracking-wider text-ink-faint">Python problems</span><span className="tabular-nums">{mounted ? `${passed} of ${b.exercises.length} passed` : plural(b.exercises.length, "problem")}</span></p>
                    <ul className="space-y-1.5">
                      {b.exercises.map((e) => (
                        <li key={e.slug}><Link to={`/practice/python/${e.slug}`} className={linkRow}>
                          <span className="flex min-w-0 items-center gap-2">{progress.lessons?.[`py:${e.slug}`] ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Passed" /> : <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-label="Not passed" />}<span className="truncate font-medium text-ink group-hover:text-accent">{e.title}</span></span>
                          <span className="shrink-0 text-xs text-ink-faint">{e.code} · {e.difficulty}</span>
                        </Link></li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Section>

          {b.interview && (
            <Section id="interview-heading" title="Interview questions" help="topic-interview">
              <Link to={b.interview.href} className={linkRow}><span className="font-medium text-ink group-hover:text-accent">{b.interview.label}</span><ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /></Link>
              {b.interview.sets.map((s) => <Link key={s.slug} to={`/interview/${s.slug}`} className={linkRow}><span><span className="block font-medium text-ink group-hover:text-accent">{s.title}</span><span className="block text-xs text-ink-muted">{plural(s.shared, "question")} on this topic</span></span><ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /></Link>)}
            </Section>
          )}

          {b.projects.length > 0 && (
            <Section id="projects-heading" title="Projects that use it" help="topic-projects">
              {b.projects.map((p) => <Link key={p.slug} to={`/projects-lab/${p.slug}`} className={linkRow}><span className="min-w-0"><span className="block truncate font-medium text-ink group-hover:text-accent">{p.title}</span><span className="block text-xs text-ink-faint">{p.level} · {p.minutes} min</span></span><ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /></Link>)}
            </Section>
          )}
        </div>

        <aside className="space-y-4" aria-label="Learning order">
          {(b.prerequisites.length > 0 || b.unlocks.length > 0 || b.related.length > 0) && (
            <Card as="section" aria-labelledby="order-heading" data-help="topic-order">
              <h2 id="order-heading" className="font-display text-h3 text-ink">Learning order</h2>
              {([["Read first", b.prerequisites], ["Leads to", b.unlocks], ["Related", b.related]] as const).map(([label, refs]) => refs.length > 0 && (
                <div key={label} className="mt-3">
                  <p className="text-label uppercase text-ink-faint">{label}</p>
                  <ul className="mt-1.5 space-y-1">
                    {refs.map((r) => (
                      <li key={r.id}><Link to={`/learn/topic/${r.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-hover/5">
                        <span className="flex min-w-0 items-center gap-2">{r.kind === "note" && progress.read?.[r.id] ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Read" /> : <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-label="Not read" />}<span className="truncate text-ink">{r.title}</span></span>
                        <LevelBadge level={r.level} />
                      </Link></li>
                    ))}
                  </ul>
                </div>
              ))}
            </Card>
          )}
          {b.daily.length > 0 && (
            <Card as="section" aria-labelledby="daily-heading" data-help="topic-daily">
              <h2 id="daily-heading" className="font-display text-h3 text-ink">In Daily Learning</h2>
              <p className="mt-0.5 text-xs text-ink-muted">Phases of the 180-day plan that teach this topic.</p>
              <ul className="mt-3 space-y-2">
                {b.daily.map((d) => {
                  const done = d.days.filter((id) => isDone(view.state, id)).length;
                  return (
                    <li key={d.id}>
                      <Link to={d.href} className="group block rounded-lg border border-surface-border px-3 py-2 transition-colors duration-fast hover:border-accent/40">
                        <span className="block text-sm font-medium text-ink group-hover:text-accent">{d.title}</span>
                        <span className="block text-xs text-ink-faint">Days {d.firstDay} to {d.lastDay} · {plural(d.lessons, "lesson")} · {hoursLabel(d.minutes)}</span>
                        <ProgressBar className="mt-2" value={done} max={d.lessons} label={`${d.title}: ${done} of ${d.lessons} lessons completed`} />
                        <span className="mt-1 block text-xs text-ink-muted">{done} of {d.lessons} completed</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </Container>
  );
}
