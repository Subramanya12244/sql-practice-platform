import { createContext, useContext, useEffect } from "react";

export const SITE_URL = (import.meta.env.VITE_SITE_URL || "https://dataforge.dataforge-learn.workers.dev").replace(/\/$/, "");
import { BRAND } from "../../brand";

export const SITE_NAME = BRAND.name;

export interface HeadData {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  noindex?: boolean;
  jsonLd?: object[];
  /** Site-relative social preview image; defaults to the generic card. */
  image?: string;
}

/** During prerender, pages write their head data here; the script injects it into the HTML. */
export const HeadCollector = createContext<{ head?: HeadData } | null>(null);

export function fullTitle(title: string) {
  return title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
}

export function canonical(path: string) {
  return `${SITE_URL}${path === "/" ? "/" : path.replace(/\/$/, "")}`;
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Serialize head data to tags for the static HTML. */
export function renderHeadTags(h: HeadData): string {
  const title = fullTitle(h.title);
  const url = canonical(h.path);
  const tags = [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(h.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    h.noindex ? `<meta name="robots" content="noindex" />` : "",
    `<meta property="og:type" content="${h.type ?? "website"}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(h.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE_URL}${h.image ?? "/og-image.png"}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(h.description)}" />`,
    ...(h.jsonLd ?? []).map(
      (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`,
    ),
  ];
  return tags.filter(Boolean).join("\n    ");
}

function setMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

export function Seo(props: HeadData) {
  const collector = useContext(HeadCollector);
  if (collector) collector.head = props;
  const jsonLdKey = JSON.stringify(props.jsonLd ?? []);

  useEffect(() => {
    const title = fullTitle(props.title);
    document.title = title;
    setMeta("name", "description", props.description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", props.description);
    setMeta("property", "og:url", canonical(props.path));
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", props.description);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical(props.path);
    document.head.querySelectorAll('script[type="application/ld+json"]').forEach((s) => s.remove());
    for (const obj of JSON.parse(jsonLdKey) as object[]) {
      const s = document.createElement("script");
      s.type = "application/ld+json";
      s.text = JSON.stringify(obj);
      document.head.appendChild(s);
    }
  }, [props.title, props.description, props.path, jsonLdKey]);

  return null;
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: canonical(it.path),
    })),
  };
}

export function faqPage(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: stripMarkdown(f.answer) },
    })),
  };
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clip(text: string, max = 158): string {
  const t = stripMarkdown(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}
