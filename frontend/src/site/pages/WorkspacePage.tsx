import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Container, PageHeader } from "../components/ui";
import { Seo } from "../lib/seo";
import { EmbeddedExercise } from "../workspace";
import { exerciseWorkspaceDomain, WORKSPACE_EXERCISES, type WorkspaceDomain } from "../lib/visual/dailyVisual";
import { workspaceUrl } from "../components/WorkspaceLink";

const DOMAIN_LABEL: Record<WorkspaceDomain, string> = { sql: "SQL", python: "Python", pandas: "Pandas", numpy: "NumPy" };

/** The first graded Daily exercise of a domain, taken from the generated lesson map (no hand-picked ids). */
function firstDaily(domain: WorkspaceDomain): string | null {
  for (const day of Object.keys(WORKSPACE_EXERCISES).sort()) {
    for (const prefix of ["g", "i"]) {
      for (let n = 1; n <= 6; n++) {
        if (exerciseWorkspaceDomain(day, `${prefix}${n}`) === domain) return `daily:${day}#${prefix}${n}`;
      }
    }
  }
  return null;
}

export function WorkspacePage() {
  const [params] = useSearchParams();
  // The prerendered page has no query string. Reading it on the first client render would not match that markup (React #418),
  // so the body waits for mount; until then both sides render the same empty placeholder.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const id = mounted ? params.get("e")?.trim() || "" : "";
  const starters = useMemo(() => {
    const list: { id: string; label: string; note: string }[] = [
      { id: "sql:q01-product-revenue", label: "SQL: product revenue", note: "Run a query, see it clause by clause, then check it." },
      { id: "py:cart-line-total", label: "Python: cart line total", note: "Run code, step through it line by line, then check it." },
    ];
    const pandas = firstDaily("pandas");
    const numpy = firstDaily("numpy");
    if (pandas) list.push({ id: pandas, label: "Pandas: a Daily Learning exercise", note: "See the DataFrame before and after each step." });
    if (numpy) list.push({ id: numpy, label: "NumPy: a Daily Learning exercise", note: "See shapes, axes and broadcasting from your real run." });
    return list;
  }, []);

  return (
    <Container wide>
      <Seo title="Exercise workspace" description="Solve one exercise with your code, its real run, a step-by-step view, hints and checks in one place." path="/workspace" noindex />
      {!mounted ? (
        <div className="min-h-[24rem] py-4" aria-busy="true" data-testid="workspace-pending" />
      ) : id ? (
        <div className="min-w-0 py-4" data-testid="workspace-page">
          <EmbeddedExercise exerciseId={id} mode="full" defer={false} />
        </div>
      ) : (
        <>
          <PageHeader eyebrow="Practice" title="Exercise workspace" intro="One place to read the problem, write code, run it, see what happens inside, and check your answer. Open any exercise from its page with Open in workspace, or start with one of these." />
          <ul className="grid gap-3 pb-10 sm:grid-cols-2" aria-label="Starter exercises">
            {starters.map((s) => (
              <li key={s.id} className="rounded-xl border border-surface-border bg-surface-raised p-4">
                <Link to={workspaceUrl(s.id)} className="font-semibold text-accent hover:underline">{s.label}</Link>
                <p className="mt-1 text-sm text-ink-muted">{s.note}</p>
                <p className="mt-1 text-xs text-ink-faint">{DOMAIN_LABEL[s.id.startsWith("sql:") ? "sql" : s.id.startsWith("py:") ? "python" : (exerciseWorkspaceDomain(s.id.slice(6, 10), s.id.slice(11)) ?? "python")]}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Container>
  );
}
