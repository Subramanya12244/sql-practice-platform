import { marked } from "marked";
import { useMemo } from "react";

marked.setOptions({ gfm: true, breaks: false });

/** Inline Markdown (code spans, bold) inside an existing element. */
export function InlineMarkdown({ source }: { source: string }) {
  const html = useMemo(() => marked.parseInline(source, { async: false }) as string, [source]);
  return <span className="prose-site" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Renders trusted Markdown from this repo's own content files. */
export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMemo(() => marked.parse(source, { async: false }) as string, [source]);
  return <div className={`prose-site ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
