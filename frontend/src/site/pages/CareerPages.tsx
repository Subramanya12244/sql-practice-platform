import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, CalendarRange, CheckCircle2, Circle, Download, FolderGit2, MessageSquareText, Printer, Share2, UserRound } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, EmptyState, PageHeader, ProgressBar } from "../components/ui";
import { Seo } from "../lib/seo";
import { recordAnswer, setPlan, setPortfolioInfo, today, useProgress } from "../lib/progress";
import {
  COMPANY_TYPES, ROLE_PATHS, answerQueue, hoursNeeded, interviewQA, isDone, keyTerms, nextAnswerState, planItems,
  portfolioMarkdown, schedule, termCoverage, type AnswerCard, type AnswerRating, type PlanSettings, type Portfolio, type RoleId,
} from "../lib/career";
import { getProjectProgress, projectStatus } from "../lib/projects";
import { getRuns, runDatasets } from "../lib/dataQuality";
import { NOTE_CATEGORIES, loadAllNotes } from "../lib/learning";
import { topicScores } from "../lib/insights";
import { SITE_URL } from "../lib/seo";
import { useAuth } from "../lib/auth";
import { ResumeProjects } from "../components/ResumeProjects";
import { PlannerWeek } from "../components/PlannerWeek";
import type { PageData } from "../types";

const card = "rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel";
const btn = "inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const btn2 = "inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink hover:bg-surface-soft";
const input = "rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink";

/** Browser-only values (localStorage, today's date) appear after mount so prerendered HTML matches. */
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function completedProjects(data: PageData): Set<string> {
  const done = new Set<string>();
  for (const p of data.projectTasks ?? []) if (projectStatus({ tasks: p.tasks }, getProjectProgress(p.slug)) === "Completed") done.add(p.slug);
  return done;
}

// ── Hub ─────────────────────────────────────────────────────────────────
const TOOLS = [
  { to: "/career/planner", icon: CalendarRange, title: "Study planner", text: "Pick a role, a deadline and weekly hours. Get a week-by-week plan that ticks itself off as you learn." },
  { to: "/career/companies", icon: Briefcase, title: "Prep by company type", text: "What interviews at product companies, startups, services firms, banks and retailers tend to focus on, and what to practise." },
  { to: "/career/answers", icon: MessageSquareText, title: "Answer practice", text: "Say or type your answer to real interview questions, then compare it with a model answer and rate yourself." },
  { to: "/portfolio", icon: UserRound, title: "Portfolio", text: "A summary of your verified practice, projects and checks that you can print or export as Markdown." },
];

export function CareerPage() {
  return (
    <Container>
      <Seo title="Career prep for data roles" description="Study planner, interview prep by company type, answer practice and an evidence-based portfolio for data analyst and data engineer roles." path="/career" />
      <PageHeader eyebrow="Career" title="Get ready for data interviews" intro="Plan your study, prepare for the kind of company you're targeting, practise answers out loud, and show what you've done." />
      <ul className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <li key={t.to} className={card}>
            <Link to={t.to} className="flex items-center gap-2 font-display text-lg font-bold text-ink hover:underline"><t.icon className="h-5 w-5 text-accent" aria-hidden /> {t.title}</Link>
            <p className="mt-1 text-sm text-ink-muted">{t.text}</p>
          </li>
        ))}
      </ul>
    </Container>
  );
}

// ── Planner ─────────────────────────────────────────────────────────────
const KIND_LABEL = { note: "Read", question: "Solve", scenario: "Scenario", python: "Python", project: "Project", mock: "Mock" } as const;

export function PlannerPage() {
  const { data } = usePage();
  const progress = useProgress();
  const mounted = useMounted();
  const day = mounted ? today() : "2000-01-01";
  const saved = progress.plan;
  const [draft, setDraft] = useState<PlanSettings>({ role: "data-analyst", start: "2000-01-01", weeks: 8, hoursPerWeek: 6 });
  useEffect(() => {
    if (mounted) setDraft(saved ?? { role: "data-analyst", start: today(), weeks: 8, hoursPerWeek: 6 });
  }, [mounted, saved]);

  const src = {
    notes: data.notes ?? [], index: data.index, sets: data.planSets ?? [], scenarios: data.scenarios ?? [],
    exercises: data.exercises ?? [], projects: data.projects ?? [],
  };
  const plan = saved ?? draft;
  const items = useMemo(() => planItems(plan.role, src), [plan.role, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = useMemo(() => schedule(items, plan), [items, plan]);
  const ctx = useMemo(() => ({
    progress,
    completedProjects: mounted ? completedProjects(data) : new Set<string>(),
    mocksSinceStart: (progress.mocks ?? []).filter((m) => m.date.slice(0, 10) >= plan.start).length,
  }), [progress, mounted, data, plan.start]);

  let mockOrdinal = 0;
  const status = weeks.map((w) => w.items.map((i) => isDone(i, ctx, i.kind === "mock" ? mockOrdinal++ : 0)));
  const doneCount = status.flat().filter(Boolean).length;
  const currentWeek = Math.max(0, Math.floor((Date.parse(day) - Date.parse(plan.start)) / (7 * 86_400_000)));
  const expected = weeks.slice(0, Math.min(currentWeek, weeks.length)).reduce((s, w) => s + w.items.length, 0);
  const need = hoursNeeded(items, plan.weeks);
  const role = ROLE_PATHS.find((r) => r.id === plan.role)!;
  // Per-stage completion for the roadmap, in the role's stage order.
  const stages = role.stages.map((st) => {
    const flat = weeks.flatMap((w, wi) => w.items.map((it, ii) => ({ it, done: status[wi][ii] }))).filter((x) => x.it.stage === st.title);
    return { title: st.title, total: flat.length, done: flat.filter((x) => x.done).length };
  });

  return (
    <Container>
      <Seo title="Study planner for data roles" description="A week-by-week study plan for data analyst, data engineer and analytics engineer interviews, built from notes, questions, scenarios and projects." path="/career/planner" />
      <PageHeader eyebrow="Career" title="Study planner" intro="Choose a role and how much time you have. Items tick off automatically when you read the note, solve the question or pass the project checks." />

      <form className={`${card} grid gap-3 sm:grid-cols-5 sm:items-end`} onSubmit={(e) => { e.preventDefault(); setPlan(draft); }}>
        <label className="text-sm text-ink-muted sm:col-span-2">Role
          <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as RoleId })} className={`${input} mt-1 w-full`}>
            {ROLE_PATHS.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </label>
        <label className="text-sm text-ink-muted">Start
          <input type="date" value={draft.start} onChange={(e) => e.target.value && setDraft({ ...draft, start: e.target.value })} className={`${input} mt-1 w-full`} />
        </label>
        <label className="text-sm text-ink-muted">Weeks
          <input type="number" min={1} max={52} value={draft.weeks} onChange={(e) => setDraft({ ...draft, weeks: Math.max(1, Math.min(52, Number(e.target.value) || 1)) })} className={`${input} mt-1 w-full`} />
        </label>
        <label className="text-sm text-ink-muted">Hours / week
          <input type="number" min={1} max={60} step={0.5} value={draft.hoursPerWeek} onChange={(e) => setDraft({ ...draft, hoursPerWeek: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} className={`${input} mt-1 w-full`} />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-5">
          <button type="submit" className={btn}>{saved ? "Update plan" : "Save plan"}</button>
          {saved && <button type="button" className={btn2} onClick={() => setPlan(undefined)}>Clear plan</button>}
          <p className="text-sm text-ink-muted">{role.summary}</p>
        </div>
      </form>

      {mounted && <PlannerWeek plan={saved} />}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className={card}><p className="text-xs uppercase tracking-wider text-ink-faint">Done</p><p className="mt-1 font-display text-2xl font-bold text-ink">{mounted ? `${doneCount}/${items.length}` : "—"}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wider text-ink-faint">Weeks at this pace</p><p className="mt-1 font-display text-2xl font-bold text-ink">{weeks.length}</p>
          <p className="text-xs text-ink-muted">{weeks.length > plan.weeks ? `Over your ${plan.weeks}-week target. About ${need} h/week would fit it.` : `Fits your ${plan.weeks}-week target.`}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wider text-ink-faint">Pace</p><p className="mt-1 font-display text-2xl font-bold text-ink">{!saved || !mounted ? "—" : doneCount >= expected ? "On track" : "Behind"}</p>
          {saved && mounted && <p className="text-xs text-ink-muted">Week {Math.min(currentWeek + 1, weeks.length)} of {weeks.length}; {expected} items were due by now.</p>}</div>
      </div>

      <section aria-labelledby="roadmap" className={`${card} mt-4`}>
        <h2 id="roadmap" className="font-display text-lg font-bold text-ink">{role.title} roadmap</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-5">
          {stages.map((st, i) => {
            const complete = st.total > 0 && st.done === st.total;
            return (
              <li key={st.title} className="relative rounded-lg border border-surface-border bg-surface-overlay p-3">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${complete ? "bg-success text-white" : st.done ? "bg-accent text-white" : "bg-surface-soft text-ink-muted"}`} aria-hidden>
                  {complete ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </span>
                <p className="mt-2 text-sm font-semibold text-ink">{st.title}</p>
                <p className="text-xs text-ink-faint">{mounted ? `${st.done}/${st.total}` : `0/${st.total}`} items</p>
                <ProgressBar className="mt-2" value={mounted ? st.done : 0} max={st.total || 1} label={`${st.title} progress`} tone={complete ? "success" : "accent"} />
              </li>
            );
          })}
        </ol>
      </section>

      <ol className="mt-6 space-y-4">
        {weeks.map((w, wi) => (
          <li key={w.index} className={`${card} min-w-0 ${saved && mounted && wi === currentWeek ? "ring-2 ring-accent" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-ink">Week {w.index + 1} <span className="text-sm font-normal text-ink-faint">· from {w.start}</span></h2>
              <span className="text-xs text-ink-faint">{Math.round(w.minutes / 6) / 10} h · {[...new Set(w.items.map((i) => i.stage))].join(", ")}</span>
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {w.items.map((i, ii) => (
                <li key={`${i.kind}:${i.ref}`} className="flex min-w-0 items-center gap-2 text-sm">
                  {mounted && status[wi][ii] ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Done" /> : <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-label="Not done" />}
                  <span className="w-16 shrink-0 text-xs text-ink-faint">{KIND_LABEL[i.kind]}</span>
                  <Link to={i.path} className="truncate text-ink hover:underline">{i.title}</Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Container>
  );
}

// ── Company types ───────────────────────────────────────────────────────
export function CompanyPrepPage() {
  const { data, params } = usePage();
  const id = params.id;
  const list = id ? COMPANY_TYPES.filter((c) => c.id === id) : COMPANY_TYPES;
  const noteBy = (cat: string) => (data.notes ?? []).filter((n) => n.category === cat).slice(0, 4);
  const catLabel = (c: string) => NOTE_CATEGORIES.find((x) => x.slug === c)?.label ?? c;
  const one = id ? list[0] : null;
  return (
    <Container>
      <Seo
        title={one ? `${one.title}: data interview prep` : "Data interview prep by company type"}
        description={one ? `${one.emphasis} Practice plan with SQL notes, questions, scenarios and projects.` : "How data interviews differ at product companies, startups, services firms, banks and retailers, and what to practise for each."}
        path={one ? `/career/companies/${one.id}` : "/career/companies"}
      />
      <PageHeader eyebrow="Career" title={one ? one.title : "Prep by company type"} intro="Interview formats vary by company and team. This is general guidance built from common formats, not any company's actual questions." />
      {id && <Link to="/career/companies" className="text-sm text-accent underline">All company types</Link>}
      <div className="mt-4 space-y-6">
        {list.map((c) => (
          <section key={c.id} className={card} aria-labelledby={`ct-${c.id}`}>
            <h2 id={`ct-${c.id}`} className="font-display text-xl font-bold text-ink">{id ? "Focus" : <Link to={`/career/companies/${c.id}`} className="hover:underline">{c.title}</Link>}</h2>
            <p className="mt-1 text-sm text-ink">{c.emphasis}</p>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Typical rounds</h3>
                <ol className="mt-1 list-decimal pl-5 text-sm text-ink-muted">{c.rounds.map((r) => <li key={r}>{r}</li>)}</ol>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Study</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {c.categories.map((cat) => (
                    <li key={cat}><span className="text-ink-muted">{catLabel(cat)}:</span>{" "}
                      {noteBy(cat).map((n, i) => <span key={n.slug}>{i ? ", " : ""}<Link to={`/notes/${n.slug}`} className="text-accent hover:underline">{n.title}</Link></span>)}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Practise</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  <li><Link to={`/interview/${c.set}`} className="text-accent hover:underline">{data.sets?.find((s) => s.slug === c.set)?.title ?? "Interview set"}</Link></li>
                  {c.scenarios.map((s) => <li key={s}><Link to={`/scenarios/${s}`} className="text-accent hover:underline">{data.scenarios?.find((x) => x.slug === s)?.title ?? s}</Link></li>)}
                  {c.projects.map((p) => <li key={p}><Link to={`/projects-lab/${p}`} className="text-accent hover:underline">Project: {data.projects?.find((x) => x.slug === p)?.title ?? p}</Link></li>)}
                  <li><Link to="/mock-interview" className="text-accent hover:underline">Timed mock interview</Link></li>
                </ul>
              </div>
            </div>
          </section>
        ))}
      </div>
    </Container>
  );
}

// ── Answer practice ─────────────────────────────────────────────────────
const DRAFT = (k: string) => `sqlp.answer.${k}`;
const readDraft = (k: string) => { try { return localStorage.getItem(DRAFT(k)) ?? ""; } catch { return ""; } };
const writeDraft = (k: string, v: string) => { try { localStorage.setItem(DRAFT(k), v.slice(0, 4000)); } catch { /* ignore */ } };

export function AnswerPracticePage() {
  const progress = useProgress();
  const mounted = useMounted();
  const [cards, setCards] = useState<AnswerCard[] | null>(null);
  const [track, setTrack] = useState("");
  const [cur, setCur] = useState<AnswerCard | null>(null);
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    void loadAllNotes().then((ns) => setCards(ns.flatMap(interviewQA)));
  }, []);
  const pool = useMemo(() => (cards ?? []).filter((c) => !track || c.category === track), [cards, track]);
  const queue = useMemo(() => (mounted ? answerQueue(pool, progress.answers ?? {}, today()) : []), [pool, progress.answers, mounted]);
  const pick = (c: AnswerCard | undefined) => {
    setCur(c ?? null);
    setText(c ? readDraft(c.key) : "");
    setShown(false);
  };
  useEffect(() => {
    if (!cur && queue.length) pick(queue[0]);
  }, [queue, cur]);

  const rate = (r: AnswerRating) => {
    if (!cur) return;
    recordAnswer(cur.key, nextAnswerState(progress.answers?.[cur.key], r, today()));
    const next = queue.find((c) => c.key !== cur.key);
    pick(next);
  };
  const terms = cur ? keyTerms(cur.answer) : [];
  const cover = termCoverage(text, terms);
  const practiced = Object.keys(progress.answers ?? {}).length;

  return (
    <Container>
      <Seo title="Interview answer practice" description="Practise answering SQL and data engineering interview questions, then compare with a model answer and track what to revisit." path="/career/answers" />
      <PageHeader eyebrow="Career" title="Answer practice" intro="Answer in your own words first, out loud or typed. Then reveal the model answer, check the key terms, and rate yourself honestly. Questions you miss come back sooner." />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select aria-label="Track" value={track} onChange={(e) => { setTrack(e.target.value); setCur(null); }} className={input}>
          <option value="">All tracks</option>
          {NOTE_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
        </select>
        <span className="text-ink-muted">{cards ? `${pool.length} questions · ${mounted ? practiced : 0} practised · ${queue.filter((c) => progress.answers?.[c.key]).length} due` : "Loading questions…"}</span>
      </div>

      {cur ? (
        <section className={`${card} mt-4`} aria-label="Question">
          <p className="text-xs text-ink-faint">From <Link to={`/notes/${cur.note}`} className="underline">{cur.noteTitle}</Link></p>
          <h2 className="mt-1 font-display text-xl font-bold text-ink">{cur.question}</h2>
          <label htmlFor="my-answer" className="sr-only">Your answer</label>
          <textarea id="my-answer" rows={5} value={text} maxLength={4000} placeholder="Your answer…" onChange={(e) => { setText(e.target.value); writeDraft(cur.key, e.target.value); }} className={`${input} mt-3 w-full`} />
          {!shown ? (
            <div className="mt-2 flex gap-2">
              <button type="button" className={btn} onClick={() => setShown(true)}>Show model answer</button>
              <button type="button" className={btn2} onClick={() => pick(queue.find((c) => c.key !== cur.key))}>Skip</button>
            </div>
          ) : (
            <>
              <div className="mt-4 rounded-lg border border-surface-border bg-surface p-3 text-sm text-ink whitespace-pre-wrap">{cur.answer}</div>
              {terms.length > 0 && (
                <div className="mt-3 text-sm">
                  <p className="text-ink-muted">Key terms in the model answer (a study aid, not a grade; different wording can still be right):</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {cover.map((c) => <li key={c.term} className={`rounded-full px-2 py-0.5 font-mono text-xs ${c.hit ? "bg-success-dim text-success" : "bg-surface-soft text-ink-muted"}`}>{c.hit ? "✓ " : ""}{c.term}</li>)}
                  </ul>
                </div>
              )}
              <p className="mt-4 text-sm font-semibold text-ink">How did you do?</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white" onClick={() => rate("missed")}>Missed it</button>
                <button type="button" className="rounded-lg bg-warn px-3 py-1.5 text-sm font-semibold text-white" onClick={() => rate("partly")}>Partly</button>
                <button type="button" className="rounded-lg bg-success px-3 py-1.5 text-sm font-semibold text-white" onClick={() => rate("nailed")}>Nailed it</button>
              </div>
            </>
          )}
        </section>
      ) : cards && <p className="mt-4 text-ink-muted">Nothing due in this track. Come back later or pick another track.</p>}
    </Container>
  );
}

// ── Portfolio ───────────────────────────────────────────────────────────
export function buildPortfolio(data: PageData, progress: ReturnType<typeof useProgress>, browser: boolean): Portfolio {
  const qs = Object.values(progress.questions);
  const solvedHere = qs.filter((q) => q.solvedAt && q.practiced);
  const notes = data.notes ?? [];
  const groups = NOTE_CATEGORIES.filter((c) => c.group === "de");
  const projects = (data.projectTasks ?? []).map((pt) => {
    const meta = data.projects?.find((p) => p.slug === pt.slug);
    const p = browser ? getProjectProgress(pt.slug) : { tasks: {}, checklist: {} };
    const automated = pt.tasks.filter((t) => t.type !== "checklist");
    return {
      slug: pt.slug, title: meta?.title ?? pt.slug, status: projectStatus({ tasks: pt.tasks }, p),
      passed: automated.filter((t) => p.tasks[t.id]?.passed).length, automated: automated.length,
      repo: p.submission?.url, reviewerApproved: p.submission?.review?.status === "Completed",
    };
  }).filter((p) => p.status !== "Not started");
  const mocks = progress.mocks ?? [];
  const best = mocks.reduce<(typeof mocks)[number] | null>((b, m) => (!b || m.solved / m.total > b.solved / b.total ? m : b), null);
  const answers = Object.values(progress.answers ?? {});
  return {
    name: progress.portfolio?.name ?? "",
    headline: progress.portfolio?.headline ?? "",
    sql: {
      independent: solvedHere.filter((q) => !q.assisted).length,
      assisted: solvedHere.filter((q) => q.assisted).length,
      imported: qs.filter((q) => q.solvedAt && !q.practiced).length,
      total: data.index.length,
      practicedDays: progress.activeDays.length,
    },
    topics: topicScores(data.index, data.topics, progress).map((t) => ({ label: t.label, solved: t.solved, total: t.total })),
    tracks: [
      { title: "SQL", read: notes.filter((n) => NOTE_CATEGORIES.find((c) => c.slug === n.category)?.group === "sql" && progress.read?.[n.slug]).length, total: notes.filter((n) => NOTE_CATEGORIES.find((c) => c.slug === n.category)?.group === "sql").length },
      ...groups.map((g) => ({ title: g.label, read: notes.filter((n) => n.category === g.slug && progress.read?.[n.slug]).length, total: notes.filter((n) => n.category === g.slug).length })),
    ],
    projects,
    python: Object.keys(progress.lessons ?? {}).filter((k) => k.startsWith("py:")).length,
    scenarios: Object.keys(progress.lessons ?? {}).filter((k) => k.startsWith("scenario:")).length,
    mocks: { count: mocks.length, best: best ? `${best.solved}/${best.total}` : null },
    quality: browser ? runDatasets().map((d) => ({ dataset: d, score: Math.max(...getRuns(d).map((r) => r.score ?? 0)) })).filter((q) => q.score > 0) : [],
    answers: { practiced: answers.length, nailed: answers.filter((a) => a.rating === "nailed").length },
  };
}

/** Public link to the opt-in profile, which lists reviewer-approved projects (migration 005). */
function ShareLink() {
  const { enabled, profile } = useAuth();
  const [copied, setCopied] = useState(false);
  if (!enabled || !profile) return null;
  if (!profile.public_profile) return <Link to="/account" className="self-center text-sm text-accent underline">Make your profile public to get a share link</Link>;
  const url = `${SITE_URL}/profile?u=${encodeURIComponent(profile.username)}`;
  return (
    <button type="button" className={btn2} onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>
      <Share2 className="h-4 w-4" aria-hidden /> {copied ? "Link copied" : "Copy share link"}
    </button>
  );
}

export function PortfolioPage() {
  const { data } = usePage();
  const progress = useProgress();
  const mounted = useMounted();
  const pf = buildPortfolio(data, progress, mounted);
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  useEffect(() => {
    setName(progress.portfolio?.name ?? "");
    setHeadline(progress.portfolio?.headline ?? "");
  }, [progress.portfolio]);

  const download = () => {
    const md = portfolioMarkdown(pf, SITE_URL);
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "portfolio.md" });
    a.click();
    URL.revokeObjectURL(url);
  };
  const stat = (label: string, value: string | number, note?: string) => (
    <div className={card}><p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p><p className="mt-1 font-display text-2xl font-bold text-ink">{mounted ? value : "—"}</p>{note && <p className="text-xs text-ink-muted">{note}</p>}</div>
  );

  return (
    <Container>
      <Seo title="Portfolio" description="Your verified practice record: SQL solves, projects, checks and interview practice." path="/portfolio" noindex />
      <PageHeader eyebrow="Career" title={pf.name || "Your portfolio"} intro={pf.headline || "Built only from what you've done here. Solves imported from another history are listed separately, and projects show whether a reviewer approved them."} />

      <form className={`${card} grid gap-3 print:hidden sm:grid-cols-[1fr_2fr_auto] sm:items-end`} onSubmit={(e) => { e.preventDefault(); setPortfolioInfo({ name, headline }); }}>
        <label className="text-sm text-ink-muted">Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={`${input} mt-1 w-full`} /></label>
        <label className="text-sm text-ink-muted">Headline<input value={headline} maxLength={200} placeholder="e.g. Aspiring data engineer, SQL and Python" onChange={(e) => setHeadline(e.target.value)} className={`${input} mt-1 w-full`} /></label>
        <button type="submit" className={btn2}>Save</button>
      </form>
      <div className="mt-3 flex gap-2 print:hidden">
        <button type="button" className={btn} onClick={download} disabled={!mounted}><Download className="h-4 w-4" aria-hidden /> Export Markdown</button>
        <button type="button" className={btn2} onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print / save PDF</button>
        <ShareLink />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("SQL solved independently", pf.sql.independent, `${pf.sql.assisted} more with hints`)}
        {stat("Projects completed", pf.projects.filter((p) => p.status === "Completed").length, `${pf.projects.filter((p) => p.reviewerApproved).length} reviewer approved`)}
        {stat("Mock interviews", pf.mocks.count, pf.mocks.best ? `best ${pf.mocks.best}` : undefined)}
        {stat("Answers practised", pf.answers.practiced, `${pf.answers.nailed} self-rated complete`)}
      </div>
      {mounted && pf.sql.imported > 0 && <p className="mt-2 text-xs text-ink-faint">{pf.sql.imported} questions are marked solved from an imported history and aren't counted above.</p>}

      <p className="mt-6 text-sm"><Link to="/portfolio/export" className="font-semibold text-accent hover:underline">Export your work</Link> <span className="text-ink-muted">· a ZIP or a private GitHub repository of your solutions and project write-ups</span></p>
      <h2 className="mt-8 font-display text-xl font-bold text-ink">Projects</h2>
      {mounted && pf.projects.length ? (
        <ul className="mt-2 space-y-2">
          {pf.projects.map((p) => (
            <li key={p.slug} className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link to={`/projects-lab/${p.slug}`} className="font-semibold text-ink hover:underline">{p.title}</Link>
                <span className="text-xs text-ink-muted">{p.status}{p.reviewerApproved ? " · reviewer approved" : ""} · {p.passed}/{p.automated} checks</span>
              </div>
              {p.repo && <a href={p.repo} className="mt-1 block break-all text-sm text-accent underline" target="_blank" rel="noopener noreferrer nofollow">{p.repo}</a>}
            </li>
          ))}
        </ul>
      ) : <div className="mt-2"><EmptyState icon={FolderGit2} title="No projects yet" action={<Link to="/projects-lab" className="text-sm font-medium text-accent hover:underline">Open the Projects Lab</Link>}>Projects you start appear here with their checks, repository link and reviewer approval.</EmptyState></div>}

      {mounted && <ResumeProjects />}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="font-display text-xl font-bold text-ink">SQL by topic</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {pf.topics.map((t) => (
              <li key={t.label} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-ink-muted">{t.label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-soft" aria-hidden><span className="block h-full bg-accent" style={{ width: `${mounted && t.total ? (t.solved / t.total) * 100 : 0}%` }} /></span>
                <span className="w-12 text-right font-mono text-xs text-ink">{mounted ? t.solved : 0}/{t.total}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="font-display text-xl font-bold text-ink">Learning tracks</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {pf.tracks.map((t) => <li key={t.title} className="flex justify-between"><span className="text-ink-muted">{t.title}</span><span className="font-mono text-xs text-ink">{mounted ? t.read : 0}/{t.total} read</span></li>)}
          </ul>
          <h2 className="mt-6 font-display text-xl font-bold text-ink">Other evidence</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            <li>{mounted ? pf.python : 0} Python exercises passed</li>
            <li>{mounted ? pf.scenarios : 0} business scenarios solved</li>
            {pf.quality.map((q) => <li key={q.dataset}>Data quality on {q.dataset}: best {q.score}%</li>)}
          </ul>
        </section>
      </div>
    </Container>
  );
}

