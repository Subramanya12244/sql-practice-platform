/** Lazy mermaid renderer for ```mermaid blocks in Markdown content (browser only). */
let loaded: Promise<typeof import("mermaid").default> | null = null;
let theme: string | null = null;
let seq = 0;

async function getMermaid() {
  loaded ??= import("mermaid").then((m) => m.default);
  const mermaid = await loaded;
  const want = document.documentElement.classList.contains("dark") ? "dark" : "neutral";
  if (theme !== want) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: want, flowchart: { useMaxWidth: true } });
    theme = want;
  }
  return mermaid;
}

/** Replace every unrendered `.mermaid-block` under `root` with its SVG. Failures keep the source visible. */
export async function renderMermaidIn(root: HTMLElement) {
  const blocks = [...root.querySelectorAll<HTMLElement>(".mermaid-block:not([data-rendered])")];
  if (!blocks.length) return;
  const mermaid = await getMermaid();
  for (const el of blocks) {
    el.dataset.rendered = "1";
    const src = el.querySelector("code")?.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mmd-${++seq}`, src);
      const fig = document.createElement("div");
      fig.className = "mermaid-svg";
      fig.innerHTML = svg;
      fig.setAttribute("role", "img");
      fig.setAttribute("aria-label", "Diagram");
      el.prepend(fig);
      // Keep the diagram source for screen readers, as plain text (a hidden <pre> is a scroll region).
      const desc = document.createElement("div");
      desc.className = "sr-only";
      desc.id = `mmd-src-${seq}`;
      desc.textContent = src;
      el.querySelector("pre")?.replaceWith(desc);
      fig.setAttribute("aria-describedby", desc.id);
    } catch {
      el.dataset.error = "1"; // leave the text source as the fallback
    }
  }
}
