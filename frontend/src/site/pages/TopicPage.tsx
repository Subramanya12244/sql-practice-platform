import { Link } from "react-router-dom";
import { usePage } from "../SiteApp";
import { Container, PageHeader, QuestionCard } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { useProgress } from "../lib/progress";

export function TopicPage() {
  const { data, params } = usePage();
  const progress = useProgress();
  const topic = data.topics.find((t) => t.slug === params.slug)!;
  const questions = data.index.filter((q) => q.topic === topic.slug);
  const concepts = [...new Set(questions.flatMap((q) => q.concepts))].slice(0, 12);
  const i = data.topics.indexOf(topic);
  const next = data.topics[i + 1];

  return (
    <Container>
      <Seo
        title={`${topic.label} SQL Practice Questions`}
        description={`${questions.length} ${topic.label} SQL interview questions on the Northwind database, with explanations, common traps and graded solutions. Practice free in your browser.`}
        path={`/topics/${topic.slug}`}
        jsonLd={[
          breadcrumbs([
            { name: "Home", path: "/" },
            { name: "Questions", path: "/questions" },
            { name: topic.label, path: `/topics/${topic.slug}` },
          ]),
        ]}
      />
      <PageHeader
        eyebrow={`Topic ${i + 1} of ${data.topics.length}`}
        title={`${topic.label} practice questions`}
        intro={`${questions.length} questions. Concepts covered: ${concepts.join(", ")}.`}
      />
      <div data-help="topic-questions" className="grid gap-3 sm:grid-cols-2">
        {questions.map((q) => <QuestionCard key={q.slug} q={q} solved={!!progress.questions[q.number]?.solvedAt} />)}
      </div>
      {next && (
        <p className="mt-10 text-sm text-ink-muted">
          Next topic: <Link to={`/topics/${next.slug}`} className="font-medium text-accent hover:underline">{next.label}</Link>
        </p>
      )}
    </Container>
  );
}
