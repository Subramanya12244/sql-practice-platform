import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Markdown } from "../components/Markdown";
import { guideFaq } from "../lib/frontmatter";
import { NOTE_CATEGORIES, loadAllNotes } from "../lib/learning";
import { TRACKS } from "../lib/tracks";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, Difficulty, PageHeader } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { reviewCard, today, useProgress } from "../lib/progress";
import type { QuestionSummary } from "../types";

type Mode = "due" | "traps" | "all";

interface ConceptCard {
  key: string;
  front: string;
  back: string;
  note: { slug: string; title: string };
}

/** Decks: SQL questions (default), SQL concept cards, or one per data engineering track. */
const DECKS = [
  { id: "questions", label: "SQL questions" },
  { id: "sql-concepts", label: "SQL concepts" },
  ...TRACKS.map((t) => ({ id: t.id, label: t.title })),
];

function DeckTabs({ deck }: { deck: string }) {
  const navigate = useNavigate();
  return (
    <div className="mb-6 flex flex-wrap gap-1.5" role="tablist" aria-label="Deck">
      {DECKS.map((d) => (
        <button key={d.id} type="button" role="tab" aria-selected={deck === d.id} onClick={() => navigate(d.id === "questions" ? "/flashcards" : `/flashcards?deck=${d.id}`)}
          className={`rounded-full px-3 py-1.5 text-sm ${deck === d.id ? "bg-accent text-white" : "border border-surface-border text-ink-muted hover:text-ink"}`}>
          {d.label}
        </button>
      ))}
    </div>
  );
}

/** Cards built from the "Interview questions" of every note in a deck; same Leitner schedule. */
function ConceptDeck({ deck }: { deck: string }) {
  const progress = useProgress();
  const [cards, setCards] = useState<ConceptCard[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [onlyDue, setOnlyDue] = useState(true);

  useEffect(() => {
    setCards(null);
    setDone(new Set());
    const sqlCats = new Set(NOTE_CATEGORIES.filter((c) => c.group === "sql").map((c) => c.slug));
    loadAllNotes().then((notes) =>
      setCards(
        notes
          .filter((n) => (deck === "sql-concepts" ? sqlCats.has(n.category) : n.category === deck))
          .flatMap((n) => guideFaq(n.body).map((f, i) => ({ key: `n:${n.slug}#${i}`, front: f.question, back: f.answer, note: { slug: n.slug, title: n.title } }))),
      ),
    );
  }, [deck]);

  const now = today();
  const pool = (cards ?? []).filter((c) => !onlyDue || (progress.cards[c.key]?.due ?? "") <= now);
  const remaining = pool.filter((c) => !done.has(c.key)).sort((a, b) => (progress.cards[a.key]?.box ?? 0) - (progress.cards[b.key]?.box ?? 0));
  const card = remaining[0];
  const answer = (knewIt: boolean) => {
    if (!card) return;
    reviewCard(card.key, knewIt);
    setDone((d) => new Set(d).add(card.key));
    setFlipped(false);
  };

  if (!cards) return <p className="text-sm text-ink-muted">Loading cards…</p>;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-ink-muted"><input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Due only</label>
        <span className="text-ink-muted" aria-live="polite">{remaining.length} of {pool.length} left · {cards.length} cards in this deck</span>
      </div>
      {card ? (
        <div className="rounded-card border border-surface-border bg-surface-raised p-6 shadow-panel">
          <p className="text-xs text-ink-faint">From <Link to={`/notes/${card.note.slug}`} className="text-accent hover:underline">{card.note.title}</Link></p>
          <p className="mt-2 font-display text-xl font-bold text-ink">{card.front}</p>
          {flipped ? (
            <>
              <Markdown source={card.back} className="mt-4 text-sm" />
              <div className="mt-5 flex gap-3">
                <button type="button" onClick={() => answer(false)} className="rounded-lg border border-surface-border px-4 py-2 text-sm text-ink">Needs revision</button>
                <button type="button" onClick={() => answer(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">I knew it</button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setFlipped(true)} className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">Show answer</button>
          )}
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-surface-border p-10 text-center">
          <p className="font-semibold text-ink">{pool.length ? "Session complete." : cards.length ? "Nothing due right now." : "No cards in this deck yet."}</p>
          {cards.length > 0 && <button type="button" onClick={() => { setOnlyDue(false); setDone(new Set()); }} className="mt-3 text-sm font-medium text-accent hover:underline">Review all cards</button>}
        </div>
      )}
    </>
  );
}

export function FlashcardsPage() {
  const { search } = useLocation();
  const [deck, setDeck] = useState("questions");
  // Read ?deck= after hydration (the prerendered page has no query string).
  useEffect(() => {
    const want = new URLSearchParams(search).get("deck") ?? "questions";
    setDeck(DECKS.some((d) => d.id === want) ? want : "questions");
  }, [search]);
  if (deck !== "questions") {
    const label = DECKS.find((d) => d.id === deck)?.label ?? deck;
    return (
      <Container>
        <Seo title="Flashcards" description="Spaced-repetition flashcards." path="/flashcards" noindex />
        <PageHeader eyebrow="Revise" title={`${label} flashcards`} intro="Built from the interview questions in each note. Cards you miss come back tomorrow; cards you know move further out." />
        <DeckTabs deck={deck} />
        <ConceptDeck deck={deck} />
      </Container>
    );
  }
  return <QuestionFlashcards />;
}

function QuestionFlashcards() {
  const { data } = usePage();
  const progress = useProgress();
  const [mode, setMode] = useState<Mode>("due");
  const [topic, setTopic] = useState("all");
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());

  const deck = useMemo(() => {
    const now = today();
    let cards = data.index.filter((q) => topic === "all" || q.topic === topic);
    if (mode === "traps") cards = cards.filter((q) => q.hadMistakes);
    if (mode === "due") cards = cards.filter((q) => (progress.cards[q.number]?.due ?? "") <= now);
    // Traps first, then the lowest Leitner box, then question order.
    return [...cards].sort(
      (a, b) =>
        Number(b.hadMistakes) - Number(a.hadMistakes) ||
        (progress.cards[a.number]?.box ?? 0) - (progress.cards[b.number]?.box ?? 0) ||
        a.number - b.number,
    );
  }, [data.index, mode, topic, progress.cards]);

  const remaining = deck.filter((q) => !done.has(q.number));
  const card = remaining[0];

  useEffect(() => {
    setDone(new Set());
    setFlipped(false);
  }, [mode, topic]);

  const answer = useCallback(
    (knewIt: boolean) => {
      if (!card) return;
      reviewCard(card.number, knewIt);
      setDone((d) => new Set(d).add(card.number));
      setFlipped(false);
    },
    [card],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, select, textarea")) return;
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && e.key === "1") answer(false);
      else if (flipped && e.key === "2") answer(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, answer]);

  const mastered = Object.values(progress.cards).filter((c) => c.box >= 4).length;

  return (
    <Container>
      <Seo
        title="SQL Interview Flashcards — Spaced Repetition Revision"
        description={`Revise ${data.index.length} SQL interview questions with flashcards: the approach, the trap and the key takeaway for each, with spaced repetition. Free, no sign-up.`}
        path="/flashcards"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Flashcards", path: "/flashcards" }])]}
      />
      <PageHeader
        eyebrow="Revise"
        title="SQL flashcards"
        intro="Recall the approach before you flip. Cards you miss come back tomorrow; cards you know move further out. Questions with real recorded mistakes come first."
      />
      <DeckTabs deck="questions" />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["due", "traps", "all"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-lg px-3 py-2 text-sm ${mode === m ? "bg-accent-dim font-semibold text-accent" : "text-ink-muted hover:bg-hover/5"}`}
          >
            {m === "due" ? "Due today" : m === "traps" ? "Traps only" : "All cards"}
          </button>
        ))}
        <label className="ml-auto text-sm text-ink-muted">
          <span className="sr-only">Topic</span>
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink"
          >
            <option value="all">All topics</option>
            {data.topics.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <p className="mb-3 text-sm text-ink-muted" aria-live="polite">
        {remaining.length} of {deck.length} left in this session · {mastered} mastered overall
      </p>

      {card ? (
        <FlashCard card={card} flipped={flipped} onFlip={() => setFlipped((f) => !f)} onAnswer={answer} />
      ) : (
        <div className="rounded-card border border-dashed border-surface-border p-10 text-center">
          <p className="font-semibold text-ink">{deck.length ? "Session complete." : "Nothing due right now."}</p>
          <p className="mt-1 text-sm text-ink-muted">Come back tomorrow, or switch to “All cards”.</p>
          <button type="button" onClick={() => setDone(new Set())} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            <RotateCcw className="h-4 w-4" aria-hidden /> Go through these again
          </button>
        </div>
      )}

      <section className="mt-16" aria-labelledby="all-cards">
        <h2 id="all-cards" className="font-display text-xl font-bold text-ink">All {data.index.length} cards</h2>
        <div className="mt-4 divide-y divide-surface-border rounded-card border border-surface-border">
          {data.index.map((q) => (
            <details key={q.slug} className="group px-4 py-3">
              <summary className="flex cursor-pointer items-center gap-2 text-sm">
                <span className="font-mono text-ink-faint">Q{q.number}</span>
                <span className="font-medium text-ink">{q.title}</span>
                {q.hadMistakes && <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-label="Recorded mistake" />}
              </summary>
              <CardBack q={q} />
            </details>
          ))}
        </div>
      </section>
    </Container>
  );
}

function CardBack({ q }: { q: QuestionSummary }) {
  return (
    <dl className="mt-3 space-y-3 text-sm">
      {q.answerShort && (
        <div>
          <dt className="font-semibold text-ink">Approach</dt>
          <dd className="mt-0.5 text-ink-muted">{q.answerShort}</dd>
        </div>
      )}
      <div>
        <dt className="font-semibold text-ink">Watch out for</dt>
        <dd className="mt-0.5 text-ink-muted">{q.watchOutFor}</dd>
      </div>
      {q.mistakeShort && (
        <div>
          <dt className="font-semibold text-warn">Mistake made</dt>
          <dd className="mt-0.5 text-ink-muted">{q.mistakeShort}</dd>
        </div>
      )}
      <div>
        <dt className="font-semibold text-ink">Takeaway</dt>
        <dd className="mt-0.5 text-ink-muted">{q.takeaway}</dd>
      </div>
    </dl>
  );
}

function FlashCard({
  card,
  flipped,
  onFlip,
  onAnswer,
}: {
  card: QuestionSummary;
  flipped: boolean;
  onFlip: () => void;
  onAnswer: (knewIt: boolean) => void;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="min-h-[320px] rounded-card border border-surface-border bg-surface-raised p-6 shadow-soft sm:p-8">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <span className="font-mono">Q{card.number}</span> · {card.topicLabel}
          <span className="ml-auto"><Difficulty level={card.difficulty} /></span>
        </div>
        <h2 className="mt-3 font-display text-2xl font-bold text-ink">{card.title}</h2>
        <p className="mt-3 text-ink-muted">{card.problemShort}</p>
        {!flipped ? (
          <p className="mt-8 text-sm font-medium text-ink">How would you solve it, and what is the trap?</p>
        ) : (
          <div className="mt-6 border-t border-surface-border pt-4"><CardBack q={card} /></div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        {!flipped ? (
          <button type="button" onClick={onFlip} className="rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-glow">
            Show answer <kbd className="ml-2 rounded bg-white/20 px-1.5 text-xs">Space</kbd>
          </button>
        ) : (
          <>
            <button type="button" onClick={() => onAnswer(false)} className="rounded-xl border border-danger/40 bg-danger-dim px-5 py-3 font-semibold text-danger">
              Again <kbd className="ml-1 text-xs opacity-70">1</kbd>
            </button>
            <button type="button" onClick={() => onAnswer(true)} className="rounded-xl border border-success/40 bg-success-dim px-5 py-3 font-semibold text-success">
              Got it <kbd className="ml-1 text-xs opacity-70">2</kbd>
            </button>
          </>
        )}
        <Link to={`/questions/${card.slug}`} className="text-sm text-accent hover:underline">Practice this question</Link>
      </div>
    </div>
  );
}
