import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ProvenanceBadge } from "./Playback";
import { CATEGORIES, CATEGORY_LABEL, QUESTIONS, byCategory, questionById, type Category, type FollowUp, type Question, type Snippet } from "../../lib/visual/interview";

const btn = "inline-flex min-h-8 items-center justify-center rounded-lg border border-surface-border px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 disabled:opacity-40";
const primaryBtn = "inline-flex min-h-8 items-center justify-center rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 disabled:opacity-40";
const sel = "w-full rounded-md border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink";

const STAGES = ["Question", "Hints", "Approach", "Example answer", "Follow-ups", "Self-check"] as const;

// The only thing remembered is which question and category were last open, in this browser. Nothing about the learner.
const UI_KEY = "sqlp.visual.interview.ui";
function readUi(): { id?: string; category?: string } {
  try { const v = JSON.parse(localStorage.getItem(UI_KEY) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function writeUi(v: { id: string; category: string }) {
  try { localStorage.setItem(UI_KEY, JSON.stringify(v)); } catch { /* the choice just will not be remembered */ }
}

function SnippetView({ s }: { s: Snippet }) {
  const e = s.expect;
  return (
    <figure className="space-y-1.5">
      <figcaption className="text-xs font-semibold text-ink">{s.title} <span className="font-normal uppercase text-ink-faint">({s.lang})</span></figcaption>
      {s.setup && <pre tabIndex={0} aria-label={`${s.title}: setup`} className="overflow-x-auto rounded-lg border border-surface-border bg-surface-soft p-2 font-mono text-xs text-ink-muted">{s.setup}</pre>}
      <pre tabIndex={0} aria-label={`${s.title}: code`} className="overflow-x-auto rounded-lg border border-surface-border bg-surface p-2 font-mono text-xs text-ink"><code>{s.code}</code></pre>
      {e.stdout !== undefined && (
        <div><p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Output (checked by running the code)</p>
          <pre tabIndex={0} aria-label={`${s.title}: output`} className="overflow-x-auto rounded-lg bg-surface-soft p-2 font-mono text-xs text-ink">{e.stdout}</pre></div>
      )}
      {e.rows && e.columns && (
        <div><p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Result (checked on PostgreSQL)</p>
          <div className="overflow-x-auto rounded-lg border border-surface-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-soft text-ink-muted"><tr>{e.columns.map((c) => <th key={c} scope="col" className="px-2 py-1 font-mono font-semibold">{c}</th>)}</tr></thead>
              <tbody>{e.rows.map((r, i) => <tr key={i} className="border-t border-surface-border">{r.map((c, j) => <td key={j} className="px-2 py-1 font-mono text-ink">{c === null ? <span className="text-ink-faint">NULL</span> : String(c)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </figure>
  );
}

function FollowUpItem({ f, n }: { f: FollowUp; n: number }) {
  const [hint, setHint] = useState(false), [answer, setAnswer] = useState(false);
  return (
    <li className="space-y-1.5 rounded-lg border border-surface-border p-3">
      <p className="text-sm font-medium text-ink"><span className="text-ink-faint">Follow-up {n}.</span> {f.q}</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={btn} aria-expanded={hint} onClick={() => setHint(true)} disabled={hint}>{hint ? "Hint shown" : `Show hint for follow-up ${n}`}</button>
        <button type="button" className={btn} aria-expanded={answer} onClick={() => setAnswer(true)} disabled={answer}>{answer ? "Answer shown" : `Show answer to follow-up ${n}`}</button>
      </div>
      {hint && <p className="rounded-md bg-accent-dim p-2 text-sm text-ink"><span className="font-semibold">Hint: </span>{f.hint}</p>}
      {answer && (
        <div className="space-y-2 rounded-md bg-surface-soft p-2 text-sm text-ink">
          <p>{f.answer}</p>
          {f.snippet && <SnippetView s={f.snippet} />}
        </div>
      )}
    </li>
  );
}

function Walk({ q }: { q: Question }) {
  const [stage, setStage] = useState(0);
  const [hints, setHints] = useState(0);
  const [answer, setAnswer] = useState(false);
  const [checked, setChecked] = useState<boolean[]>(() => q.rubric.map(() => false));
  const done = checked.filter(Boolean).length;
  const go = (n: number) => setStage(Math.max(0, Math.min(STAGES.length - 1, n)));
  return (
    <div className="space-y-3">
      <nav aria-label="Stages">
        <ol className="flex flex-wrap gap-1.5">
          {STAGES.map((s, i) => (
            <li key={s}>
              <button type="button" onClick={() => go(i)} aria-current={stage === i ? "step" : undefined}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${stage === i ? "bg-accent text-white" : i < stage ? "bg-accent-dim text-accent" : "bg-surface-soft text-ink-muted hover:text-ink"}`}><span aria-hidden>{i + 1}. </span>{s}</button>
            </li>
          ))}
        </ol>
      </nav>
      <p role="status" aria-live="polite" className="text-xs text-ink-muted" data-testid="interview-stage">Stage {stage + 1} of {STAGES.length}: {STAGES[stage]}</p>

      <section aria-label={`${STAGES[stage]} stage`} className="space-y-3 rounded-xl border border-surface-border bg-surface-raised p-4">
        {stage === 0 && (
          <>
            <blockquote className="whitespace-pre-line border-l-4 border-accent pl-3 text-sm text-ink">{q.prompt}</blockquote>
            <div>
              <h3 className="text-sm font-semibold text-ink">Questions you could ask the interviewer</h3>
              <p className="text-xs text-ink-muted">Ask these aloud before you write anything. Clarifying is part of the answer.</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">{q.clarify.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
            <p className="text-xs text-ink-faint">Suggested time for a first attempt: {q.minutes} minutes. Try the question yourself before you open the hints.</p>
          </>
        )}
        {stage === 1 && (
          <>
            <h3 className="text-sm font-semibold text-ink">Hints, one at a time</h3>
            <p className="text-xs text-ink-muted">The first hint names the idea. None of them gives the answer. {hints} of {q.hints.length} shown.</p>
            {hints > 0 && <ol className="space-y-1.5" aria-label="Revealed hints">{q.hints.slice(0, hints).map((h, i) => <li key={i} className="rounded-md bg-accent-dim p-2 text-sm text-ink"><span className="font-semibold">Hint {i + 1}. </span>{h}</li>)}</ol>}
            <button type="button" className={primaryBtn} disabled={hints >= q.hints.length} onClick={() => setHints(hints + 1)}>{hints >= q.hints.length ? "No more hints" : `Reveal hint ${hints + 1}`}</button>
          </>
        )}
        {stage === 2 && (
          <>
            <h3 className="text-sm font-semibold text-ink">An approach you can follow</h3>
            <p className="text-xs text-ink-muted">The outline says how to work through it, not what to write.</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">{q.approach.map((a) => <li key={a}>{a}</li>)}</ol>
          </>
        )}
        {stage === 3 && (
          <>
            <h3 className="text-sm font-semibold text-ink">Example answer</h3>
            {!answer ? (
              <div className="space-y-2">
                <p className="text-sm text-ink-muted">Try it yourself first. When you are ready, open an example to compare with.</p>
                <button type="button" className={primaryBtn} onClick={() => setAnswer(true)}>Show the example answer</button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="rounded-md border border-warn/50 bg-warn-dim p-2 text-xs font-semibold text-ink" role="note">One good answer, not the only one.</p>
                <p className="text-sm text-ink">{q.answer.text}</p>
                {q.answer.snippets.map((s) => <SnippetView key={s.title} s={s} />)}
                {q.answer.snippets.length > 0 && <p className="text-[11px] text-ink-faint">The outputs above were checked by running the code (Python) or the query (PostgreSQL); this page does not run anything.</p>}
                <div>
                  <h4 className="text-sm font-semibold text-ink">Common pitfalls</h4>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">{q.pitfalls.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
                {q.link && <p className="text-sm text-ink-muted">See it in action: <Link className="font-semibold text-accent underline-offset-2 hover:underline" to={q.link.to}>{q.link.label}</Link></p>}
              </div>
            )}
          </>
        )}
        {stage === 4 && (
          <>
            <h3 className="text-sm font-semibold text-ink">Follow-up questions</h3>
            <p className="text-xs text-ink-muted">Interviewers push on your answer. Think first, then use the hint, then the answer.</p>
            <ol className="space-y-2">{q.followUps.map((f, i) => <FollowUpItem key={f.q} f={f} n={i + 1} />)}</ol>
          </>
        )}
        {stage === 5 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">Self-assessment</legend>
            <p className="text-xs text-ink-muted">Tick what you really did in your own attempt. Nothing is saved or sent anywhere.</p>
            {q.rubric.map((r, i) => (
              <label key={r} className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-1" checked={checked[i]} onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))} />
                <span>{r}</span>
              </label>
            ))}
            <p role="status" aria-live="polite" className="text-sm font-medium text-ink" data-testid="interview-score">
              {done} of {q.rubric.length} ticked. {done === q.rubric.length ? "Strong: try the stretch follow-ups or a timed mock." : done >= Math.ceil(q.rubric.length / 2) ? "Good start: look at the unticked items and redo the question using the approach outline." : "Re-read the approach outline, then redo the question from a blank page."}
            </p>
          </fieldset>
        )}
      </section>

      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className={btn} onClick={() => go(stage - 1)} disabled={stage === 0}>Previous stage</button>
        <button type="button" className={primaryBtn} onClick={() => go(stage + 1)} disabled={stage === STAGES.length - 1}>Next stage</button>
      </div>
    </div>
  );
}

/** Walk through one interview question at a time: clarify, hints, approach, an example answer on request, follow-ups, self-check. */
export function InterviewLab({ preset }: { preset?: string }) {
  const fromPreset = questionById(preset);
  const [category, setCategory] = useState<Category | "all">("all");
  const [id, setId] = useState<string>(fromPreset?.id ?? QUESTIONS[0].id);
  // Restore the last open question once, after mount (reading storage during render would differ between server and browser).
  useEffect(() => {
    if (fromPreset) return;
    const ui = readUi();
    const q = questionById(ui.id);
    if (q) { setId(q.id); setCategory(CATEGORIES.includes(ui.category as Category) && ui.category === q.category ? q.category : "all"); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => byCategory(category), [category]);
  const q = questionById(id) ?? list[0];
  useEffect(() => { writeUi({ id: q.id, category }); }, [q.id, category]);
  const index = list.findIndex((x) => x.id === q.id);
  const choose = (next: string) => setId(next);
  const changeCategory = (c: Category | "all") => { setCategory(c); const l = byCategory(c); if (!l.some((x) => x.id === q.id)) setId(l[0].id); };
  return (
    <section aria-label="Interview walkthrough" className="space-y-3">
      <p className="text-sm text-ink-muted"><ProvenanceBadge p="conceptual" /> Worked interview questions with hints, example answers and follow-ups. Where code appears, its stated output was checked by running it; this page runs nothing and stores nothing about you.</p>
      <div className="grid gap-2 sm:grid-cols-[14rem_1fr]">
        <label className="text-xs font-semibold text-ink">Topic
          <select className={`${sel} mt-0.5 font-normal`} value={category} onChange={(e) => changeCategory(e.target.value as Category | "all")}>
            <option value="all">All topics ({QUESTIONS.length})</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]} ({byCategory(c).length})</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink">Question
          <select className={`${sel} mt-0.5 font-normal`} value={q.id} onChange={(e) => choose(e.target.value)}>
            {list.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-ink">{q.title}</h2>
        <span className="rounded-full bg-accent-dim px-2 py-0.5 text-[11px] font-semibold text-accent">{CATEGORY_LABEL[q.category]}</span>
        <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{q.level}</span>
        <span className="ml-auto flex gap-1.5">
          <button type="button" className={btn} onClick={() => choose(list[index - 1].id)} disabled={index <= 0}>Previous question</button>
          <button type="button" className={btn} onClick={() => choose(list[index + 1].id)} disabled={index < 0 || index >= list.length - 1}>Next question</button>
        </span>
      </div>
      <Walk key={q.id} q={q} />
    </section>
  );
}
