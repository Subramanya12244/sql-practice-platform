import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, ChevronDown, CircleHelp, Copy, Play, RotateCcw, X } from "lucide-react";
import { useHelp, type OpenHelpOptions } from "./context";
import { findExampleListener, onExampleListenersChange, setPendingExample } from "./exampleBridge";
import { resetAllHelpProgress, resetTour, tourDone, useHelpProgress } from "./progress";
import { CATEGORY_LABEL, buildDocs, searchDocs, type HelpCategory, type HelpDoc } from "./search";
import type { HelpExample, HelpSection } from "./types";

type Registry = typeof import("./registry");

/** `code` spans only: help text never contains markup. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/g).map((p, i) => (p.startsWith("`") && p.endsWith("`") ? <code key={i} className="rounded bg-surface-overlay px-1 py-0.5 font-mono text-[0.85em] text-ink">{p.slice(1, -1)}</code> : <span key={i}>{p}</span>))}</>;
}

const isMobile = () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 767px)").matches;
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Which accordion block holds an anchor. */
const blockOf = (anchor: string) => (anchor.startsWith("control-") ? "controls" : anchor.startsWith("topic-") || anchor.startsWith("term-") ? "more" : anchor.replace(/^block-/, ""));

function Block({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section data-anchor={`block-${id}`} className="border-t border-surface-border">
      <h3>
        <button type="button" id={`help-h-${id}`} aria-expanded={open} aria-controls={`help-b-${id}`} onClick={onToggle}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 py-2 text-left text-sm font-semibold text-ink hover:text-accent">
          {title}
          <ChevronDown className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-fast motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </h3>
      <div id={`help-b-${id}`} role="region" aria-labelledby={`help-h-${id}`} hidden={!open} className="pb-4 text-sm leading-relaxed text-ink-muted">{open && children}</div>
    </section>
  );
}

const HOST: Record<"sql" | "etl", string> = { sql: "/playground", etl: "/etl-builder" };

export function ExampleBlock({ ex, onCloseOnMobile }: { ex: HelpExample; onCloseOnMobile: () => void }) {
  const navigate = useNavigate();
  const listener = useSyncExternalStore(onExampleListenersChange, () => (ex.target === "none" ? undefined : findExampleListener(ex.target)), () => undefined);
  const [state, setState] = useState<"idle" | "confirm" | "loaded" | "sent" | "failed">("idle");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setState("idle"); setCopied(false); }, [ex.id]);

  const load = () => { listener!.load(ex); setState("loaded"); onCloseOnMobile(); };
  const send = async () => {
    try {
      let to: string | undefined = ex.target === "sql" || ex.target === "etl" ? HOST[ex.target] : undefined;
      if (ex.target === "python") {
        const idx = await (await import("../lib/pyExercises")).loadExerciseIndex();
        const pick = idx.find((e) => e.difficulty === "Easy") ?? idx[0];
        to = pick && `/practice/python/${pick.slug}`;
      }
      if (!to) { setState("failed"); return; }
      setPendingExample(ex);
      setState("sent");
      onCloseOnMobile();
      navigate(to);
    } catch { setState("failed"); }
  };
  const tryIt = () => {
    if (!listener) void send();
    else if (listener.isDirty()) setState("confirm");
    else load();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(ex.code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };
  const where = listener ? `Loads into ${listener.label}.` : ex.target === "sql" ? "Opens the SQL playground with this query." : ex.target === "python" ? "Opens an easy Python exercise and adds this as a new file." : ex.target === "etl" ? "Opens the ETL builder with this setup." : "";

  return (
    <div>
      <p className="font-semibold text-ink">{ex.title}</p>
      <p className="mt-1"><Rich text={ex.explains} /></p>
      <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-surface-border bg-surface-overlay p-3 font-mono text-xs leading-relaxed text-ink" tabIndex={0} aria-label={`Example code: ${ex.title}`}><code>{ex.code.trim()}</code></pre>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Expected result</p>
      <p className="mt-0.5 text-ink"><Rich text={ex.expected} /></p>
      {ex.expectedRows && (
        <div className="mt-2 overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-overlay text-ink-muted"><tr>{ex.expectedRows.columns.map((c) => <th key={c} className="px-2 py-1 font-semibold">{c}</th>)}</tr></thead>
            <tbody>{ex.expectedRows.rows.map((r, i) => <tr key={i} className="border-t border-surface-border">{r.map((v, j) => <td key={j} className="px-2 py-1 font-mono text-ink">{v === null ? "NULL" : String(v)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {ex.expectedStdout !== undefined && <pre className="mt-2 overflow-auto rounded-lg border border-surface-border bg-surface-overlay p-2 font-mono text-xs text-ink" aria-label="Expected output">{ex.expectedStdout.trim() || "(no output)"}</pre>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ex.target !== "none" && state !== "confirm" && (
          <button type="button" onClick={tryIt} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent hover:brightness-110"><Play className="h-3.5 w-3.5" aria-hidden /> Try example</button>
        )}
        <button type="button" onClick={copy} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-surface-border px-3 text-sm text-ink-muted hover:text-ink">
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      {where && state === "idle" && <p className="mt-2 text-xs text-ink-faint">{where} Nothing runs until you press Run.</p>}
      {state === "confirm" && listener && (
        <div role="alertdialog" aria-label="Replace editor contents?" className="mt-3 rounded-lg border border-warn/40 bg-warn-dim p-3 text-ink">
          <p>This replaces what is currently in {listener.label}. Replace it with the example?</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={load} className="min-h-[36px] rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent hover:brightness-110">Replace</button>
            <button type="button" autoFocus onClick={() => setState("idle")} className="min-h-[36px] rounded-lg border border-surface-border px-3 text-sm text-ink-muted hover:text-ink">Keep my code</button>
          </div>
        </div>
      )}
      <p role="status" className="mt-2 text-sm text-success">
        {state === "loaded" && `Loaded into ${listener?.label ?? "the editor"}. Press Run (Ctrl/Cmd + Enter) and compare with the expected result above.`}
        {state === "sent" && "Opening the page. The example loads when the editor is ready."}
      </p>
      {state === "failed" && <p role="alert" className="mt-2 text-sm text-danger">Could not open an editor for this example. Use Copy code instead.</p>}
    </div>
  );
}

function SectionView({ s, current, registry, anchor, onCloseOnMobile }: { s: HelpSection; current: boolean; registry: Registry; anchor: string; onCloseOnMobile: () => void }) {
  const help = useHelp();
  const progress = useHelpProgress();
  const terms = useMemo(() => registry.GLOSSARY.filter((g) => g.section === s.id), [registry, s.id]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["overview", ...(anchor ? [blockOf(anchor)] : [])]));
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);

  // A new section or anchor: reset the accordion and scroll to the anchored item.
  useEffect(() => {
    setOpen(new Set(["overview", ...(anchor ? [blockOf(anchor)] : [])]));
    setOpenTopics(anchor.startsWith("topic-") || anchor.startsWith("term-") ? new Set([anchor]) : new Set());
  }, [s.id, anchor]);
  useEffect(() => {
    if (!anchor) { root.current?.parentElement?.scrollTo?.({ top: 0 }); return; }
    const t = window.setTimeout(() => {
      const el = root.current?.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`);
      el?.scrollIntoView?.({ block: "center", behavior: reduced() ? "auto" : "smooth" });
      el?.classList.add("help-flash");
      window.setTimeout(() => el?.classList.remove("help-flash"), 1600);
    }, 60);
    return () => window.clearTimeout(t);
  }, [s.id, anchor]);

  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleTopic = (id: string) => setOpenTopics((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const done = s.tour ? tourDone(progress, s.tour.id) : false;
  const kindLabel = { concept: "Concept", error: "Common error", workflow: "Workflow", tutorial: "Tutorial" } as const;

  return (
    <div ref={root} data-help-section={s.id}>
      <p className="text-sm leading-relaxed text-ink-muted">{s.blurb}</p>
      {!current && <p className="mt-2 rounded-lg bg-surface-overlay px-3 py-2 text-xs text-ink-muted">This help is for <span className="font-semibold text-ink">{s.title}</span>, not the page you are on. <Link to={s.home} onClick={onCloseOnMobile} className="font-semibold text-accent hover:underline">Open it</Link></p>}
      {s.tour && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => help.startTour(s.id)} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent hover:brightness-110">
            {done ? <RotateCcw className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />} {done ? "Restart tour" : "Start tour"}
          </button>
          <span className="text-xs text-ink-faint">{done ? "You finished this tour." : `${s.tour.steps.length} steps`}</span>
        </div>
      )}

      <div className="mt-3">
        <Block id="overview" title="Overview" open={open.has("overview")} onToggle={() => toggle("overview")}>
          <dl className="space-y-2">
            {([["What it is", s.overview.what], ["Why it exists", s.overview.why], ["When to use it", s.overview.when]] as const).map(([k, v]) => <div key={k}><dt className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{k}</dt><dd className="text-ink"><Rich text={v} /></dd></div>)}
          </dl>
        </Block>
        <Block id="can" title="What can I do here?" open={open.has("can")} onToggle={() => toggle("can")}>
          <ul className="list-disc space-y-1 pl-5">{s.canDo.map((x) => <li key={x}><Rich text={x} /></li>)}</ul>
        </Block>
        <Block id="how" title="How to use this section" open={open.has("how")} onToggle={() => toggle("how")}>
          <ol className="list-decimal space-y-1.5 pl-5">{s.howTo.map((x) => <li key={x}><Rich text={x} /></li>)}</ol>
        </Block>
        <Block id="controls" title="What each control does" open={open.has("controls")} onToggle={() => toggle("controls")}>
          <dl className="space-y-3">
            {s.controls.map((c, i) => (
              <div key={c.name} data-anchor={`control-${i}`} className="rounded-lg">
                <dt className="font-semibold text-ink">{c.name}</dt>
                <dd><Rich text={c.what} />{c.tip && <span className="mt-0.5 block text-ink-faint"><span className="font-semibold">Tip: </span><Rich text={c.tip} /></span>}</dd>
              </div>
            ))}
          </dl>
        </Block>
        {s.example && <Block id="example" title="Practical example" open={open.has("example")} onToggle={() => toggle("example")}><ExampleBlock ex={s.example} onCloseOnMobile={onCloseOnMobile} /></Block>}
        <Block id="mistakes" title="Common mistakes" open={open.has("mistakes")} onToggle={() => toggle("mistakes")}>
          <ul className="space-y-2.5">{s.mistakes.map((m) => <li key={m.mistake}><p className="font-medium text-ink"><Rich text={m.mistake} /></p><p><span className="font-semibold text-success">Fix: </span><Rich text={m.fix} /></p></li>)}</ul>
        </Block>
        <Block id="tips" title="Tips and shortcuts" open={open.has("tips")} onToggle={() => toggle("tips")}>
          <ul className="list-disc space-y-1 pl-5">{s.tips.map((x) => <li key={x}><Rich text={x} /></li>)}</ul>
        </Block>
        <Block id="more" title={`Concepts, errors and how-tos (${s.topics.length + terms.length})`} open={open.has("more")} onToggle={() => toggle("more")}>
          <ul className="space-y-2">
            {s.topics.map((t) => {
              const a = `topic-${t.id}`;
              return (
                <li key={t.id} data-anchor={a} className="rounded-lg border border-surface-border">
                  <button type="button" aria-expanded={openTopics.has(a)} onClick={() => toggleTopic(a)} className="flex min-h-[40px] w-full items-center gap-2 px-3 py-2 text-left">
                    <span className="rounded bg-accent-dim px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">{kindLabel[t.kind]}</span>
                    <span className="font-medium text-ink">{t.title}</span>
                    <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-ink-faint transition-transform motion-reduce:transition-none ${openTopics.has(a) ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {openTopics.has(a) && <div className="border-t border-surface-border px-3 py-2"><p><Rich text={t.body} /></p>{t.steps && <ol className="mt-2 list-decimal space-y-1 pl-5">{t.steps.map((x) => <li key={x}><Rich text={x} /></li>)}</ol>}</div>}
                </li>
              );
            })}
            {terms.map((g) => {
              const a = `term-${g.id}`;
              return (
                <li key={g.id} data-anchor={a} className="rounded-lg border border-surface-border">
                  <button type="button" aria-expanded={openTopics.has(a)} onClick={() => toggleTopic(a)} className="flex min-h-[40px] w-full items-center gap-2 px-3 py-2 text-left">
                    <span className="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-muted">Term</span>
                    <span className="font-medium text-ink">{g.term}</span>
                    <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-ink-faint transition-transform motion-reduce:transition-none ${openTopics.has(a) ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {openTopics.has(a) && <div className="border-t border-surface-border px-3 py-2"><p><Rich text={g.short} /></p>{g.more && <p className="mt-1.5"><Rich text={g.more} /></p>}</div>}
                </li>
              );
            })}
          </ul>
        </Block>
        <Block id="related" title="Related sections" open={open.has("related")} onToggle={() => toggle("related")}>
          <ul className="space-y-1.5">{s.related.map((l) => <li key={l.to}><Link to={l.to} onClick={onCloseOnMobile} className="font-medium text-accent hover:underline">{l.label}</Link>{l.why && <span> · {l.why}</span>}</li>)}</ul>
        </Block>
        {s.tour && (
          <Block id="tour" title="Guided walkthrough" open={open.has("tour")} onToggle={() => toggle("tour")}>
            <p>{s.tour.title}. One element is highlighted at a time; you can go back, skip, and restart whenever you like.</p>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5">{s.tour.steps.map((st) => <li key={st.id}>{st.title}</li>)}</ol>
            <button type="button" onClick={() => help.startTour(s.id)} className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-surface-border px-3 text-sm font-medium text-ink hover:border-accent/40"><Play className="h-3.5 w-3.5" aria-hidden /> {done ? "Restart tour" : "Start tour"}</button>
          </Block>
        )}
      </div>

      <section aria-labelledby="help-next" className="mt-5 rounded-card border border-surface-border bg-surface-overlay/50 p-3">
        <h3 id="help-next" className="text-sm font-semibold text-ink">Next steps</h3>
        <ul className="mt-2 space-y-2">
          {s.recommendations.map((l) => (
            <li key={l.to}>
              <Link to={l.to} onClick={onCloseOnMobile} className="group flex items-start gap-2 text-sm">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                <span><span className="font-medium text-ink group-hover:text-accent">{l.label}</span>{l.why && <span className="block text-ink-muted">{l.why}</span>}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Center({ registry, query, category, onCategory, onPick, onOpenSection }: {
  registry: Registry; query: string; category: HelpCategory | "all"; onCategory: (c: HelpCategory | "all") => void;
  onPick: (d: HelpDoc) => void; onOpenSection: (id: string) => void;
}) {
  const help = useHelp();
  const progress = useHelpProgress();
  const docs = useMemo(() => buildDocs(registry.SECTIONS, registry.GLOSSARY), [registry]);
  const hits = useMemo(() => searchDocs(docs, query, { category }), [docs, query, category]);
  const [inline, setInline] = useState<string | null>(null);
  const glossary = useMemo(() => new Map(registry.GLOSSARY.map((g) => [`g:${g.id}`, g])), [registry]);
  const cats: (HelpCategory | "all")[] = ["all", "features", "concepts", "buttons", "workflows", "errors", "tutorials"];
  const searching = query.trim().length > 0;

  return (
    <div>
      {searching && (
        <>
          <div role="group" aria-label="Filter results" className="flex flex-wrap gap-1.5">
            {cats.map((c) => <button key={c} type="button" aria-pressed={category === c} onClick={() => onCategory(c)} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${category === c ? "border-accent bg-accent-dim text-accent" : "border-surface-border text-ink-muted hover:text-ink"}`}>{c === "all" ? "All" : CATEGORY_LABEL[c]}</button>)}
          </div>
          <p role="status" className="mt-3 text-xs text-ink-faint">{hits.length ? `${hits.length} result${hits.length > 1 ? "s" : ""}` : `No help found for “${query}”. Try a shorter word, like the name of a button or an error.`}</p>
          <ul className="mt-2 space-y-1.5" aria-label="Help search results">
            {hits.map(({ doc }) => (
              <li key={doc.key}>
                <button type="button" onClick={() => (doc.inline ? setInline(inline === doc.key ? null : doc.key) : onPick(doc))} className="w-full rounded-lg border border-surface-border px-3 py-2 text-left hover:border-accent/40">
                  <span className="flex items-center gap-2"><span className="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-muted">{CATEGORY_LABEL[doc.category].replace(/s$/, "")}</span><span className="font-medium text-ink">{doc.title}</span></span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">{doc.text.replace(/[`*]/g, "")}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-faint">{doc.sectionTitle}</span>
                </button>
                {inline === doc.key && glossary.get(doc.key) && <p className="mx-1 mt-1 rounded-lg bg-surface-overlay p-2 text-sm text-ink">{glossary.get(doc.key)!.short} {glossary.get(doc.key)!.more}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      {!searching && (
        <>
          <h3 className="text-sm font-semibold text-ink">Help for every section</h3>
          <ul className="mt-2 grid gap-1.5">
            {registry.SECTIONS.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpenSection(s.id)} className="w-full rounded-lg border border-surface-border px-3 py-2 text-left hover:border-accent/40">
                  <span className="flex items-center gap-2 font-medium text-ink">{s.title}{s.tour && tourDone(progress, s.tour.id) && <Check className="h-3.5 w-3.5 text-success" aria-label="Tour finished" />}</span>
                  <span className="block text-xs text-ink-muted">{s.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
          <h3 className="mt-5 text-sm font-semibold text-ink">Tours</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => help.replayWelcome()} className="min-h-[36px] rounded-lg border border-surface-border px-3 text-sm text-ink-muted hover:text-ink">Replay welcome tour</button>
            <button type="button" onClick={() => { resetAllHelpProgress(); }} className="min-h-[36px] rounded-lg border border-surface-border px-3 text-sm text-ink-muted hover:text-ink">Forget finished tours</button>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {registry.SECTIONS.filter((s) => s.tour).map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="text-ink">{s.tour!.title}</span>
                <span className="text-xs text-ink-faint">{progress.tours[s.tour!.id] ? (progress.tours[s.tour!.id].status === "done" ? "finished" : "skipped") : "not started"}</span>
                <button type="button" onClick={() => { if (progress.tours[s.tour!.id]) resetTour(s.tour!.id); help.startTour(s.id); }} className="ml-auto text-xs font-semibold text-accent hover:underline">{progress.tours[s.tour!.id] ? "Restart" : "Start"}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function HelpPanel({ registry, pathname, options, onClose }: { registry: Registry | null; pathname: string; options: OpenHelpOptions; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [entered, setEntered] = useState(false);
  const [view, setView] = useState<"section" | "center">(options.view ?? "section");
  const [pick, setPick] = useState<string | null>(options.sectionId ?? null);
  const [anchor, setAnchor] = useState(options.topicId ?? "");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<HelpCategory | "all">("all");
  const mobile = isMobile();

  useEffect(() => { const r = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(r); }, []);
  useEffect(() => { if (options.search) input.current?.focus(); else panel.current?.focus({ preventScroll: true }); }, [options.search]);
  useEffect(() => {
    // Opened again from elsewhere (tooltip, button) while already open.
    if (options.sectionId) { setPick(options.sectionId); setView("section"); setQuery(""); }
    setAnchor(options.topicId ?? "");
  }, [options.sectionId, options.topicId]);

  const here = useMemo(() => (registry ? registry.sectionsForPath(pathname) : []), [registry, pathname]);
  const activeId = pick ?? here[0]?.id;
  // The page changed under an open drawer: follow it.
  useEffect(() => { if (!options.sectionId) setPick(null); }, [pathname, options.sectionId]);
  const active = registry && activeId ? registry.getSection(activeId) : undefined;

  const closeOnMobile = useCallback(() => { if (isMobile()) onClose(); }, [onClose]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); if (query) setQuery(""); else onClose(); return; }
    if (e.key === "Tab" && isMobile() && panel.current) {
      const f = Array.from(panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, [tabindex]:not([tabindex='-1'])")).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  // Esc from the page (focus on body) closes too; never from an editor.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && (document.activeElement === document.body || document.activeElement === null) && !document.querySelector("[data-guided-tour]")) onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const openSection = (id: string, a = "") => { setPick(id); setAnchor(a); setView("section"); setQuery(""); };
  const showCenter = view === "center" || query.trim().length > 0;

  return (
    <>
      {mobile && <div className="fixed inset-0 z-[44] bg-black/40 md:hidden" onClick={onClose} aria-hidden />}
      <div
        ref={panel}
        role="dialog"
        aria-modal={mobile}
        aria-labelledby="help-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-help-panel=""
        className={`fixed inset-x-0 bottom-0 z-[45] flex max-h-[88vh] flex-col rounded-t-2xl border-t border-surface-border bg-surface-raised shadow-soft outline-none transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none md:inset-x-auto md:bottom-0 md:right-0 md:top-16 md:max-h-none md:w-[440px] md:rounded-none md:border-l md:border-t-0 ${entered ? "translate-y-0 opacity-100 md:translate-x-0" : "translate-y-full opacity-0 md:translate-x-full md:translate-y-0"}`}
      >
        <div className="border-b border-surface-border px-4 pb-3 pt-3">
          <div className="flex items-center gap-2">
            <CircleHelp className="h-5 w-5 text-accent" aria-hidden />
            <h2 id="help-title" className="font-display text-base font-bold text-ink">{showCenter ? "Help Center" : active?.title ?? "Help"}</h2>
            <button type="button" onClick={() => { setView(view === "center" ? "section" : "center"); setQuery(""); }} className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink">{showCenter ? "Back to this page" : "Help Center"}</button>
            <button type="button" onClick={onClose} aria-label="Close help" className="rounded-lg p-1.5 text-ink-faint hover:text-ink"><X className="h-4 w-4" aria-hidden /></button>
          </div>
          <label className="mt-2 block">
            <span className="sr-only">Search help</span>
            <input ref={input} type="search" value={query} onChange={(e) => { setQuery(e.target.value); if (registry === null) return; }} placeholder="Search help: features, buttons, errors…" aria-label="Search help"
              className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent" />
          </label>
          {!showCenter && here.length > 1 && (
            <div role="tablist" aria-label="Sections on this page" className="mt-2 flex flex-wrap gap-1">
              {here.map((s) => <button key={s.id} type="button" role="tab" aria-selected={s.id === activeId} onClick={() => openSection(s.id)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${s.id === activeId ? "bg-accent-dim text-accent" : "text-ink-muted hover:text-ink"}`}>{s.title}</button>)}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {!registry && <p role="status" className="text-sm text-ink-muted">Loading help…</p>}
          {registry && showCenter && <Center registry={registry} query={query} category={category} onCategory={setCategory} onPick={(d) => openSection(d.sectionId, d.anchor)} onOpenSection={(id) => openSection(id)} />}
          {registry && !showCenter && active && <SectionView s={active} current={here.some((s) => s.id === active.id)} registry={registry} anchor={anchor} onCloseOnMobile={closeOnMobile} />}
        </div>
      </div>
    </>
  );
}
