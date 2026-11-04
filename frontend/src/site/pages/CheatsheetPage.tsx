import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { Container, PageHeader } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";

export function CheatsheetPage() {
  const { data } = usePage();
  const sheet = data.cheatsheet;
  return (
    <Container>
      <Seo
        title={sheet?.title ?? "SQL Cheat Sheet"}
        description={sheet?.description ?? "A one-page SQL reference for interviews."}
        path="/cheatsheet"
        type="article"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Cheat sheet", path: "/cheatsheet" }])]}
      />
      <PageHeader eyebrow="Reference" title={sheet?.title ?? "SQL cheat sheet"} intro={sheet?.description} />
      {sheet && <Markdown source={sheet.body} className="max-w-4xl" />}
      <button
        type="button"
        onClick={() => window.print()}
        className="mt-8 rounded-lg border border-surface-border bg-surface-raised px-4 py-2 text-sm font-medium text-ink hover:border-accent/40 print:hidden"
      >
        Print / save as PDF
      </button>
    </Container>
  );
}
