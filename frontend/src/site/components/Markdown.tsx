import { marked, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { sendTo } from "../lib/handoff";
import { slugifyHeading } from "../lib/learning";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const KEYWORDS = new Set(
  ("select from where and or not in is null as on join left right full outer inner cross natural using group by having order asc desc limit offset " +
    "union all intersect except distinct case when then else end with recursive over partition rows range groups between preceding following unbounded current row " +
    "insert into values update set delete returning create table view index temp temporary drop alter add column constraint primary key foreign references unique check default " +
    "exists any some like ilike similar to lateral filter within window begin commit rollback savepoint explain analyze true false interval date timestamp cast coalesce nullif " +
    "count sum avg min max row_number rank dense_rank lag lead first_value last_value nth_value ntile extract date_trunc string_agg array_agg conflict do nothing nulls first last fetch only")
    .split(/\s+/),
);

/** Tiny SQL highlighter: comments, strings, numbers, keywords. Output is escaped. */
export function highlightSql(code: string): string {
  return code.replace(
    /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g,
    (_m, comment, str, num, word, other) => {
      if (comment) return `<span class="tok-c">${esc(comment)}</span>`;
      if (str) return `<span class="tok-s">${esc(str)}</span>`;
      if (num) return `<span class="tok-n">${num}</span>`;
      if (word) return KEYWORDS.has(word.toLowerCase()) ? `<span class="tok-k">${word}</span>` : word;
      return esc(other);
    },
  );
}

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }: Tokens.Code) {
      if (lang === "mermaid") {
        return `<div class="mermaid-block"><pre><code class="language-mermaid">${esc(text)}</code></pre></div>`;
      }
      const isSql = lang === "sql" || lang === "sql-syntax";
      const body = isSql ? highlightSql(text) : esc(text);
      const actions = `<div class="code-actions"><button type="button" data-copy>Copy</button>${
        lang === "sql" ? `<button type="button" data-run>Run in playground</button>` : ""
      }</div>`;
      return `<div class="code-block">${actions}<pre tabindex="0"><code class="language-${esc(lang || "text")}">${body}</code></pre></div>`;
    },
    heading({ tokens, depth, text }: Tokens.Heading) {
      const inner = this.parser.parseInline(tokens);
      return depth === 2 || depth === 3 ? `<h${depth} id="${slugifyHeading(text)}">${inner}</h${depth}>` : `<h${depth}>${inner}</h${depth}>`;
    },
  },
});

/** Sanitize rendered HTML before setting dangerouslySetInnerHTML. Safe on SSR. */
export function sanitizeHtml(html: string): string {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const purify = (DOMPurify as any).sanitize ? DOMPurify : (DOMPurify as any)(window);
    return purify.sanitize(html, {
      ADD_ATTR: ["target", "tabindex", "data-copy", "data-run"],
    });
  }
  return html;
}

/** Inline Markdown (code spans, bold) inside an existing element. */
export function InlineMarkdown({ source }: { source: string }) {
  const html = useMemo(() => sanitizeHtml(marked.parseInline(source, { async: false }) as string), [source]);
  return <span className="prose-site" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Renders Markdown from content files or user inputs, with copy/run buttons on code. */
export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMemo(
    () => sanitizeHtml((marked.parse(source, { async: false }) as string).replace(/<table>/g, '<table tabindex="0">')),
    [source],
  );
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && html.includes("mermaid-block")) void import("../lib/mermaid").then((m) => m.renderMermaidIn(ref.current!));
  }, [html]);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn) return;
    const code = btn.closest(".code-block")?.querySelector("code")?.textContent ?? "";
    if (btn.hasAttribute("data-copy")) {
      void navigator.clipboard?.writeText(code).then(() => {
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = "Copy"), 1200);
      });
    } else if (btn.hasAttribute("data-run")) {
      sendTo({ tool: "playground", a: code });
      navigate("/playground");
    }
  }

  return <div ref={ref} className={`prose-site ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
