import { Link } from "react-router-dom";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { Container, QuestionCard } from "../components/ui";
import { Seo, breadcrumbs, canonical, faqPage } from "../lib/seo";
import { guideFaq } from "../lib/frontmatter";
import { useProgress } from "../lib/progress";

export function GuidePage() {
  const { data } = usePage();
  const g = data.guide!;
  const progress = useProgress();
  const path = `/concepts/${g.slug}`;
  const questions = g.questions.map((n) => data.index.find((q) => q.number === n)).filter(Boolean);
  const related = g.related.map((s) => data.guides?.find((x) => x.slug === s)).filter(Boolean);
  const faq = guideFaq(g.body);

  const jsonLd: object[] = [
    breadcrumbs([
      { name: "Home", path: "/" },
      { name: "Concepts", path: "/concepts" },
      { name: g.title, path },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: g.title,
      description: g.description,
      url: canonical(path),
      keywords: g.keywords.join(", "),
      proficiencyLevel: "Beginner",
      inLanguage: "en",
    },
  ];
  if (faq.length) jsonLd.push(faqPage(faq));

  return (
    <Container className="pt-6">
      <Seo title={g.title} description={g.description} path={path} type="article" jsonLd={jsonLd} />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint">
        <Link to="/concepts" className="hover:text-ink">Concepts</Link>
      </nav>
      <div className="mt-3 grid gap-10 lg:grid-cols-[minmax(0,1fr)_260px]">
        <article className="min-w-0 max-w-3xl">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{g.title}</h1>
          <Markdown source={g.body} className="mt-6" />
          {questions.length > 0 && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {questions.map((q) => q && <QuestionCard key={q.slug} q={q} solved={!!progress.questions[q.number]?.solvedAt} />)}
            </div>
          )}
        </article>
        {related.length > 0 && (
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Related concepts</p>
            <ul className="mt-3 space-y-2 text-sm">
              {related.map((r) => r && (
                <li key={r.slug}><Link to={`/concepts/${r.slug}`} className="text-accent hover:underline">{r.title}</Link></li>
              ))}
            </ul>
            <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-ink-faint">Quick reference</p>
            <Link to="/cheatsheet" className="mt-2 block text-sm text-accent hover:underline">SQL cheat sheet</Link>
          </aside>
        )}
      </div>
    </Container>
  );
}
