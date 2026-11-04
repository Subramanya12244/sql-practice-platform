import { useEffect, useId, useRef, useState } from "react";

// Mermaid is large and only needed on project pages, so it is loaded on demand.
async function loadMermaid() {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
    themeVariables: {
      background: "#151b23",
      primaryColor: "#1c242e",
      primaryBorderColor: "#2a3544",
      primaryTextColor: "#e6edf3",
      lineColor: "#3ecf8e",
    },
  });
  return mermaid;
}

export function ErDiagram({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const rawId = useId();
  const id = `er-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    if (!source.trim()) return;

    loadMermaid()
      .then((mermaid) => mermaid.render(id, source))
      .then(({ svg }) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [source, id]);

  if (!source.trim()) {
    return (
      <p className="text-sm text-ink-faint">
        No diagram available for this project.
      </p>
    );
  }

  if (error) {
    return (
      <div>
        <p className="mb-2 text-sm text-warn">Could not render the diagram.</p>
        <pre className="overflow-auto rounded bg-surface-overlay p-3 text-xs text-ink-muted">
          {source}
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} className="overflow-auto [&_svg]:mx-auto" />;
}
