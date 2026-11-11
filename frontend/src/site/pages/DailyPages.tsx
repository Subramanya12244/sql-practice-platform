import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Clock, ExternalLink, Layers } from "lucide-react";
import { usePage } from "../SiteApp";
import { Badge, Button, Card, Container, PageHeader, ProgressBar } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { LearningCalendar, PathPanel, ProgrammeOverview, RevisionPanel, Roadmap, StatusIcon, TodayCard } from "../components/daily/DailyDashboard";
import { CompletePanel, ExampleRunner, ExerciseRunner, KnowledgeCheck } from "../components/daily/LessonUi";
import { PATHS, PHASE_BY_ID, dayHref, findDay, neighbours, prerequisitesOf, type BranchId, type DayMeta, type PathId } from "../lib/daily";
import { STATUS_LABEL, completionOf, dayStatus, isDone, type DayRecord } from "../lib/dailyProgress";
import { updateDay } from "../lib/progress";
import { track } from "../lib/activity";
import { useDaily, useMounted, useToday, type DailyView } from "../lib/useDaily";
import type { ResolvedLink } from "../lib/dailyLinks";

// ── Dashboard ────────────────────────────────────────────────────────────
export function DailyPage() {
  const view = useDaily();
  const [preview, setPreview] = useState<BranchId | undefined>();
  const jsonLd = [
    breadcrumbs([{ name: "Home", path: "/" }, { name: "Daily Learning", path: "/daily" }]),
    {
      "@context": "https://schema.org", "@type": "Course", name: "DataForge Daily Learning: a 180-day data programme",
      description: "A guided day-by-day programme from Python and SQL to analytics and data engineering, with runnable examples, exercises and checks.",
      url: canonical("/daily"), provider: { "@type": "Organization", name: "DataForge", sameAs: canonical("/") }, isAccessibleForFree: true,
    },
  ];
  return (
    <Container>
      <Seo title="Daily Learning: a 180-day data programme" description="Follow a structured 180-day path from Python and SQL to data analytics and data engineering. Daily theory, runnable examples, exercises and knowledge checks." path="/daily" jsonLd={jsonLd} />
      <PageHeader eyebrow="Daily Learning" title="Your 180-day learning programme"
        intro="One guided session a day, about two hours: understand, learn by example, practise, check, review. Start at Day 1 and follow the path until you can do SQL, Python, analytics and data engineering work on your own." />
      <div className="space-y-8 pb-16">
        <TodayCard view={view} />
        <ProgrammeOverview view={view} />
        <PathPanel view={view} preview={preview} onPreview={setPreview} />
        <RevisionPanel view={view} />
        <Roadmap view={view} previewPath={preview} />
        <LearningCalendar view={view} />
      </div>
    </Container>
  );
}

// ── Lesson ───────────────────────────────────────────────────────────────
type StepId = "understand" | "examples" | "guided" | "independent" | "check" | "review" | "complete";
const STEPS: { id: StepId; label: string; short: string }[] = [
  { id: "understand", label: "Understand", short: "Understand" },
  { id: "examples", label: "Learn by example", short: "Examples" },
  { id: "guided", label: "Guided practice", short: "Guided" },
  { id: "independent", label: "Independent practice", short: "Independent" },
  { id: "check", label: "Knowledge check", short: "Check" },
  { id: "review", label: "Daily review", short: "Review" },
  { id: "complete", label: "Complete day", short: "Complete" },
];

function Resources({ links }: { links: ResolvedLink[] }) {
  if (!links.length) return null;
  return (
    <Card>
      <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink"><BookOpen className="h-4 w-4 text-accent" aria-hidden /> Related lessons and practice in DataForge</h3>
      <p className="mt-1 text-sm text-ink-muted">These existing pages teach and practise today's topic. Your progress there counts too.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {links.map((l) => (
          <li key={l.path}>
            <Link to={l.path} className="group flex items-center justify-between gap-2 rounded-xl border border-surface-border bg-surface-soft/50 px-3 py-2 text-sm transition-all duration-fast ease-out hover:-translate-y-px hover:border-accent/40">
              <span className="min-w-0"><span className="block text-[11px] uppercase tracking-wide text-ink-faint">{l.kind}</span><span className="block truncate font-medium text-ink group-hover:text-accent">{l.title}</span></span>
              <ExternalLink className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DayHeader({ day, view, children }: { day: DayMeta; view: DailyView; children?: React.ReactNode }) {
  const today = useToday() ?? "";
  const rec = view.state.days[day.id];
  const status = dayStatus(rec, view.revisions[`day:${day.id}`], today);
  const phase = PHASE_BY_ID.get(day.phase);
  const pathTitle = day.path === "common" ? "Common core" : PATHS.find((p) => p.id === day.path)?.title;
  return (
    <header className="pb-4 pt-8 sm:pt-12">
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-ink-faint">
        <Link className="hover:text-accent" to="/daily">Daily Learning</Link><span aria-hidden>/</span><span>{phase?.title}</span>
      </nav>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">Day {day.day} of 180 · {pathTitle}</p>
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{day.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-1"><StatusIcon status={status} /> {STATUS_LABEL[status]}</span>
        <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden /> about {Math.round((day.minutes / 60) * 10) / 10} h</span>
        <span className="inline-flex items-center gap-1"><Layers className="h-4 w-4" aria-hidden /> {phase?.title}</span>
        {day.kind !== "lesson" && <Badge tone="secondary">{day.kind}</Badge>}
      </div>
      {children}
    </header>
  );
}

function Prerequisites({ day, view }: { day: DayMeta; view: DailyView }) {
  const pre = prerequisitesOf(day);
  if (!pre.length) return null;
  const unmet = pre.filter((p) => !isDone(view.state, p.id));
  return (
    <Card className={unmet.length ? "border-warn/40 bg-warn-dim" : ""}>
      <h3 className="text-sm font-semibold text-ink">Prerequisites</h3>
      <ul className="mt-2 flex flex-wrap gap-2 text-sm">
        {pre.map((p) => {
          const ok = isDone(view.state, p.id);
          return <li key={p.id}><Link to={dayHref(p)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors duration-fast hover:border-accent ${ok ? "border-success/40 text-success" : "border-warn/50 text-ink"}`}>{ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : null} Day {p.day}: {p.title}</Link></li>;
        })}
      </ul>
      {unmet.length > 0 && <p className="mt-2 text-xs text-ink-muted">Earlier day{unmet.length > 1 ? "s" : ""} not finished yet. You can continue; this day will be easier once {unmet.length > 1 ? "they are" : "it is"} done.</p>}
    </Card>
  );
}

function PrevNext({ day, view }: { day: DayMeta; view: DailyView }) {
  const { prev, next } = neighbours(day, view.path);
  return (
    <nav aria-label="Previous and next day" className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border pt-4 text-sm">
      {prev ? <Link to={dayHref(prev)} className="inline-flex items-center gap-1 font-medium text-ink-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden /> Day {prev.day}: {prev.title}</Link> : <span />}
      {next ? <Link to={dayHref(next)} className="inline-flex items-center gap-1 font-medium text-ink-muted hover:text-accent">Day {next.day}: {next.title} <ArrowRight className="h-4 w-4" aria-hidden /></Link> : <span />}
    </nav>
  );
}

/** Routes: /daily/day/:n (common days) and /daily/:path/day/:n (analyst or engineer). */
export function DailyLessonPage() {
  const { data, params } = usePage();
  const path = (params.path ?? "common") as PathId;
  const day = findDay(path, Number(params.n));
  if (!day) return null;
  return <LessonForDay day={day} content={data.dailyContent ?? null} links={data.dailyLinks ?? []} />;
}

function LessonForDay({ day, content, links }: { day: DayMeta; content: NonNullable<ReturnType<typeof usePage>["data"]["dailyContent"]> | null; links: ResolvedLink[] }) {
  const view = useDaily();
  const mounted = useMounted();
  const rec: DayRecord | undefined = view.state.days[day.id];
  const [step, setStep] = useState<StepId>("understand");
  const { next } = neighbours(day, view.path);
  const seo = (
    <Seo title={`Day ${day.day}: ${day.title}`} description={`Daily Learning day ${day.day} of 180: ${day.topics.join(", ")}.`} path={dayHref(day)} noindex={!content}
      jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Daily Learning", path: "/daily" }, { name: `Day ${day.day}`, path: dayHref(day) }])]} />
  );

  // Opening a day is recorded as a visit, never as progress.
  useEffect(() => {
    if (content) track("lesson_opened", `daily:${day.id}`);
  }, [day.id, content]);

  if (!content) {
    return (
      <Container>
        {seo}
        <DayHeader day={day} view={view} />
        <div className="space-y-4 pb-16">
          <Card className="border-accent/30">
            <h2 className="font-display text-lg font-bold text-ink">This lesson is being prepared</h2>
            <p className="mt-1 text-sm text-ink-muted">Each lesson is written, run and checked before it is published, so there are no placeholder lessons. When it is ready it appears here with theory, runnable examples, exercises and a knowledge check.</p>
            <h3 className="mt-4 text-sm font-semibold text-ink">Topics this day covers</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">{day.topics.map((t) => <li key={t}>{t}</li>)}</ul>
          </Card>
          <Prerequisites day={day} view={view} />
          <Resources links={links} />
          <PrevNext day={day} view={view} />
        </div>
      </Container>
    );
  }

  const completion = completionOf(rec, content);
  const done: Record<StepId, boolean> = {
    understand: !!rec?.theory,
    examples: content.examples.filter((b) => b.kind === "example").every((b) => b.kind === "example" && rec?.examples?.includes(b.id)),
    guided: completion.guided.done === completion.guided.total,
    independent: completion.independent.attempted === completion.independent.total,
    check: completion.check.ok,
    review: !!rec?.revised,
    complete: !!rec?.completedAt,
  };
  const finished = STEPS.filter((s) => s.id !== "complete" && done[s.id]).length;
  const index = STEPS.findIndex((s) => s.id === step);
  const go = (id: StepId) => { setStep(id); if (typeof window !== "undefined") document.getElementById("lesson-top")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); };
  const s = content.sections;
  const t = content.time;

  return (
    <Container>
      {seo}
      <DayHeader day={day} view={view} />
      <div className="space-y-5 pb-16">
        <Prerequisites day={day} view={view} />
        <div id="lesson-top" className="scroll-mt-20">
          <div className="flex items-center justify-between gap-3 text-xs text-ink-muted"><span>Step {index + 1} of {STEPS.length}</span><span>{finished} of {STEPS.length - 1} activities done</span></div>
          <ProgressBar className="mt-1.5" value={finished} max={STEPS.length - 1} label="Day activities done" tone="success" />
          <ol className="mt-3 flex gap-1.5 overflow-x-auto pb-1" aria-label="Lesson steps">
            {STEPS.map((st, i) => (
              <li key={st.id}>
                <button type="button" onClick={() => go(st.id)} aria-current={st.id === step ? "step" : undefined}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-fast ease-out active:scale-[0.98] ${st.id === step ? "border-accent bg-accent-dim text-accent" : "border-surface-border text-ink-muted hover:border-accent/40 hover:text-ink"}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold transition-colors duration-base ${done[st.id] ? "bg-success text-on-accent" : st.id === step ? "bg-accent text-on-accent" : "bg-surface-soft text-ink-faint"}`}>{done[st.id] ? "✓" : i + 1}</span>
                  <span className="hidden sm:inline">{st.label}</span><span className="sm:hidden">{st.short}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div key={step} className="df-step space-y-5">
          {step === "understand" && (
            <>
              <Card>
                <h2 className="font-display text-lg font-bold text-ink">Today's plan</h2>
                <p className="mt-1 text-sm text-ink-muted">About {day.minutes} minutes: theory {t.theory}, examples {t.examples}, guided practice {t.guided}, independent practice {t.independent}, check and review {t.review}.</p>
                <h3 className="mt-3 text-sm font-semibold text-ink">Objectives</h3>
                <div className="text-sm"><Markdown source={s["Objectives"]} /></div>
              </Card>
              {content.environment && (
                <Card className="border-secondary/40"><h3 className="text-sm font-semibold text-ink">Run on your computer</h3><p className="mt-1 text-sm text-ink-muted">{content.environment.note}</p>{content.environment.packages.length > 0 && <p className="mt-1 text-xs text-ink-faint">Install: <code>pip install {content.environment.packages.join(" ")}</code></p>}</Card>
              )}
              <Card><h2 className="mb-2 font-display text-lg font-bold text-ink">Understand</h2><Markdown source={s["Understand"]} /></Card>
              <Card><h2 className="mb-2 font-display text-lg font-bold text-ink">Syntax and key functions</h2><Markdown source={s["Syntax and key functions"]} /></Card>
              <Resources links={links} />
              <TheoryRead dayId={day.id} read={!!rec?.theory} onNext={() => go("examples")} />
            </>
          )}
          {step === "examples" && (
            <>
              <Card><h2 className="mb-1 font-display text-lg font-bold text-ink">Learn by example</h2><p className="text-sm text-ink-muted">Run each example, change it, and run it again. Each example shows its expected output so you can check your understanding.</p></Card>
              {mounted ? content.examples.map((b, i) => b.kind === "text" ? <Card key={i}><Markdown source={b.md} /></Card> : <ExampleRunner key={b.id} dayId={day.id} ex={b} done={!!rec?.examples?.includes(b.id)} />)
                : content.examples.map((b, i) => b.kind === "text" ? <Card key={i}><Markdown source={b.md} /></Card> : <Card key={b.id}><h4 className="font-semibold text-ink">{b.title}</h4><Markdown source={`\`\`\`${b.lang}\n${b.code}\n\`\`\``} /><Markdown source={`\`\`\`text\n${b.output}\n\`\`\``} /></Card>)}
            </>
          )}
          {step === "guided" && (
            <>
              <Card><h2 className="mb-1 font-display text-lg font-bold text-ink">Guided practice</h2><p className="text-sm text-ink-muted">Step-by-step exercises with progressive hints. Pass every required exercise to complete the day. Your code is saved as you type, so you can stop and continue later.</p></Card>
              {mounted ? content.guided.map((e, i) => <ExerciseRunner key={e.id} dayId={day.id} ex={e} guided rec={rec} index={i} />) : <Card><p className="text-sm text-ink-muted">Loading the editor…</p></Card>}
            </>
          )}
          {step === "independent" && (
            <>
              <Card><h2 className="mb-1 font-display text-lg font-bold text-ink">Independent practice</h2><p className="text-sm text-ink-muted">No hints. Combine what you learned today. Attempt every required exercise; passing them all counts toward mastery.</p></Card>
              {mounted ? content.independent.map((e, i) => <ExerciseRunner key={e.id} dayId={day.id} ex={e} guided={false} rec={rec} index={i} />) : <Card><p className="text-sm text-ink-muted">Loading the editor…</p></Card>}
            </>
          )}
          {step === "check" && (
            <>
              <Card><h2 className="mb-1 font-display text-lg font-bold text-ink">Knowledge check</h2><p className="text-sm text-ink-muted">{content.checks.length} questions. You need 60% to complete the day and 80% for mastery. You can retake it; your best score is kept.</p></Card>
              <KnowledgeCheck dayId={day.id} checks={content.checks} rec={rec} />
            </>
          )}
          {step === "review" && (
            <>
              <Card><h2 className="mb-2 font-display text-lg font-bold text-ink">Daily review</h2><Markdown source={s["Daily review"]} /></Card>
              <Card><h2 className="mb-2 font-display text-lg font-bold text-ink">Real-world applications</h2><Markdown source={s["Real-world applications"]} /></Card>
              <Card>
                <h2 className="mb-2 font-display text-lg font-bold text-ink">Revision task</h2>
                <Markdown source={s["Revision task"]} />
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" checked={!!rec?.revised} onChange={(e) => updateDay(day.id, (r) => ({ ...r, revised: e.target.checked ? new Date().toISOString() : undefined }), e.target.checked)} /> I have done the revision task
                </label>
              </Card>
              <Card><h2 className="mb-2 font-display text-lg font-bold text-ink">Next-day preparation</h2><Markdown source={s["Next-day preparation"]} />{next && <p className="mt-2 text-sm text-ink-muted">Next: <Link className="text-accent hover:underline" to={dayHref(next)}>Day {next.day}: {next.title}</Link></p>}</Card>
            </>
          )}
          {step === "complete" && <CompletePanel dayId={day.id} extras={content} rec={rec} nextHref={next ? dayHref(next) : undefined} nextLabel={next ? `Continue to Day ${next.day}` : undefined} />}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => index > 0 && go(STEPS[index - 1].id)} disabled={index === 0} className="inline-flex min-h-[42px] items-center gap-1 rounded-xl px-3 text-sm font-medium text-ink-muted transition-colors duration-fast hover:text-ink disabled:opacity-40"><ArrowLeft className="h-4 w-4" aria-hidden /> Back</button>
          {index < STEPS.length - 1 && <Button variant="secondary" onClick={() => go(STEPS[index + 1].id)}>Next: {STEPS[index + 1].label} <ArrowRight className="h-4 w-4" aria-hidden /></Button>}
        </div>
        <PrevNext day={day} view={view} />
        <p className="text-center text-xs text-ink-faint">Progress saves automatically on this device and syncs to your account when you are signed in.</p>
      </div>
    </Container>
  );
}

/** Marks the theory as read when the end of it scrolls into view (or on request). */
function TheoryRead({ dayId, read, onNext }: { dayId: string; read: boolean; onNext: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (read || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { updateDay(dayId, (r) => ({ ...r, theory: new Date().toISOString() })); io.disconnect(); } }, { threshold: 1 });
    io.observe(el);
    return () => io.disconnect();
  }, [dayId, read]);
  return (
    <div ref={end} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-surface-border bg-surface-raised p-4">
      <p className="flex items-center gap-2 text-sm text-ink-muted">{read ? <><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Theory read.</> : "Reaching the end of the theory marks it as read."}</p>
      <div className="flex gap-2">
        {!read && <button type="button" onClick={() => updateDay(dayId, (r) => ({ ...r, theory: new Date().toISOString() }))} className="min-h-[36px] rounded-xl border border-surface-border px-3 text-sm font-medium text-ink hover:border-accent/40">Mark as read</button>}
        <button type="button" onClick={onNext} className="inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-accent px-3 text-sm font-semibold text-on-accent hover:brightness-110">Go to examples <ArrowRight className="h-4 w-4" aria-hidden /></button>
      </div>
    </div>
  );
}
