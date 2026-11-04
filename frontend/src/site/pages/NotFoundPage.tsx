import { Link } from "react-router-dom";
import { Container } from "../components/ui";
import { Seo } from "../lib/seo";

export function NotFoundPage() {
  return (
    <Container className="py-24 text-center">
      <Seo title="Page not found" description="This page does not exist." path="/404" noindex />
      <p className="font-mono text-sm text-accent">ERROR: relation "this_page" does not exist</p>
      <h1 className="mt-3 font-display text-3xl font-bold text-ink">Page not found</h1>
      <p className="mt-3 text-ink-muted">The page may have moved. Try the question list instead.</p>
      <Link to="/questions" className="mt-6 inline-block rounded-xl bg-accent px-5 py-3 font-semibold text-white">Browse questions</Link>
    </Container>
  );
}
