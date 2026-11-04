import { useMemo } from "react";

export interface GitCommitNode {
  hash: string;
  message: string;
  parents: string[];
}

interface Props {
  commits: GitCommitNode[];
  branches: Record<string, string>;
  head: string;
  currentBranch: string | null;
}

/** Compact ASCII-ish commit graph for the repo state panel. */
export function GitCommitGraph({ commits, branches, head, currentBranch }: Props) {
  const rows = useMemo(() => {
    const byHash = new Map(commits.map((c) => [c.hash, c]));
    const labels = new Map<string, string[]>();
    Object.entries(branches).forEach(([name, tip]) => {
      const list = labels.get(tip) ?? [];
      list.push(name);
      labels.set(tip, list);
    });

    // Prefer walking from HEAD
    const ordered: GitCommitNode[] = [];
    const seen = new Set<string>();
    const queue = head ? [head] : [];
    while (queue.length) {
      const h = queue.shift()!;
      if (seen.has(h)) continue;
      seen.add(h);
      const node = byHash.get(h);
      if (!node) continue;
      ordered.push(node);
      queue.push(...node.parents);
    }
    commits.forEach((c) => {
      if (!seen.has(c.hash)) ordered.push(c);
    });
    return ordered.slice(0, 12);
  }, [commits, branches, head]);

  if (!rows.length) {
    return <p className="text-xs text-ink-faint">No commits yet.</p>;
  }

  return (
    <div className="font-mono text-[11px] leading-relaxed text-ink-muted">
      {rows.map((c, i) => {
        const tags = [];
        if (c.hash === head) tags.push("HEAD");
        (Object.entries(branches).find(([, tip]) => tip === c.hash) &&
          Object.entries(branches)
            .filter(([, tip]) => tip === c.hash)
            .forEach(([name]) => tags.push(name)));
        const isCurrent = currentBranch && branches[currentBranch] === c.hash;
        return (
          <div key={c.hash} className="flex gap-2">
            <span className="w-3 shrink-0 text-ink-faint">{i === rows.length - 1 ? "○" : "●"}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={isCurrent ? "text-accent" : "text-ink"}>{c.hash}</span>
                {tags.map((t) => (
                  <span
                    key={t}
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      t === "HEAD" || t === currentBranch
                        ? "bg-accent-dim text-accent"
                        : "bg-hover/5 text-ink-faint"
                    }`}
                  >
                    {t}
                  </span>
                ))}
              </div>
              <p className="truncate text-ink-muted">{c.message}</p>
              {i < rows.length - 1 && <div className="ml-0.5 h-2 border-l border-surface-border" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
