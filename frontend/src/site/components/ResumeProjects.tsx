import { useEffect, useState } from "react";
import { Check, Copy, FileText, RotateCcw } from "lucide-react";
import { loadAllProjects, getProjectProgress } from "../lib/projects";
import { buildResumeEntry, readEdits, saveEdit, type ResumeEntry } from "../lib/resume";
import { Card, EmptyState, ErrorState, SectionHeader, Skeleton } from "./ui";

/** Resume-ready descriptions for projects with passed checks. Built only from evidence; always editable. */
export function ResumeProjects() {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; entries: ResumeEntry[] }>({ status: "loading", entries: [] });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setEdits(readEdits());
    loadAllProjects()
      .then((ps) => setState({ status: "ready", entries: ps.flatMap((p) => { const e = buildResumeEntry(p, getProjectProgress(p.slug)); return e ? [e] : []; }) }))
      .catch(() => setState({ status: "error", entries: [] }));
  }, []);

  const change = (slug: string, text: string) => { setEdits((e) => ({ ...e, [slug]: text })); saveEdit(slug, text); };
  const reset = (slug: string) => { setEdits(({ [slug]: _gone, ...rest }) => rest); saveEdit(slug, null); };
  const copy = async (slug: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(slug); window.setTimeout(() => setCopied((c) => (c === slug ? null : c)), 2000); } catch { /* clipboard blocked: the text is selectable */ }
  };

  return (
    <section aria-labelledby="resume-heading" className="mt-8">
      <SectionHeader id="resume-heading" title="Resume bullets" description="Written from your passed checks only. Nothing is added that you have not done, and no numbers are made up. Edit freely; edits stay on this device." />
      {state.status === "loading" ? <Skeleton className="h-32" />
        : state.status === "error" ? <ErrorState title="Could not load your projects">Reload the page to try again.</ErrorState>
          : !state.entries.length ? (
            <EmptyState icon={FileText} title="No project evidence yet">Pass an automated check in a <a href="/projects-lab" className="text-accent hover:underline">guided project</a> and a resume description appears here.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {state.entries.map((e) => {
                const value = edits[e.slug] ?? e.text;
                const edited = edits[e.slug] !== undefined;
                return (
                  <li key={e.slug}><Card pad="md">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-ink">{e.title}</h3>
                      <span className="text-xs text-ink-muted">{e.evidence.automatedPassed}/{e.evidence.automatedTotal} automated checks{e.evidence.reviewApproved ? " · reviewer approved" : ""}</span>
                    </div>
                    <label className="mt-2 block text-xs text-ink-muted">Description (editable)
                      <textarea value={value} onChange={(ev) => change(e.slug, ev.target.value)} rows={Math.min(14, value.split("\n").length + 1)} className="mt-1 w-full rounded-lg border border-surface-border bg-surface p-2 font-mono text-xs text-ink" />
                    </label>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => void copy(e.slug, value)} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-2.5 py-1 text-xs font-medium text-ink hover:border-accent">
                        {copied === e.slug ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied === e.slug ? "Copied" : "Copy"}
                      </button>
                      {edited && <button type="button" onClick={() => reset(e.slug)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-ink-muted hover:text-ink"><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset to generated</button>}
                    </div>
                    <details className="mt-2 text-xs text-ink-muted">
                      <summary className="cursor-pointer">What this is based on</summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        <li>{e.evidence.automatedPassed} of {e.evidence.automatedTotal} automated checks passed in this browser (SQL checked on PostgreSQL, Python by tests).</li>
                        {e.evidence.manualTotal > 0 && <li>{e.evidence.manualChecked} of {e.evidence.manualTotal} manual steps ticked. These are self-reported and not used in the text above.</li>}
                        <li>Technologies in the text: {e.demonstrated.length ? e.demonstrated.join(", ") : "none exercised by a passed check"}.</li>
                        {e.covered.length > 0 && <li>Covered in the project but not verified by a check, so left out: {e.covered.join(", ")}.</li>}
                      </ul>
                    </details>
                  </Card></li>
                );
              })}
            </ul>
          )}
    </section>
  );
}
