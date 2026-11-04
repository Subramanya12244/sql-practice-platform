import { GitBranch, GitCommitHorizontal, Layers, FileWarning } from "lucide-react";
import { GitCommitGraph } from "./GitCommitGraph";
import type { GitRepoState } from "../../types/git";

interface Props {
  state: GitRepoState | null;
}

function ChangeList({
  title,
  items,
  empty,
}: {
  title: string;
  items: { path: string; status: string }[];
  empty: string;
}) {
  return (
    <div>
      <p className="section-label">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-ink-faint">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((c) => (
            <li key={`${c.status}-${c.path}`} className="flex items-center gap-2 font-mono text-xs">
              <span
                className={
                  c.status === "A"
                    ? "text-success"
                    : c.status === "D"
                      ? "text-danger"
                      : "text-warn"
                }
              >
                {c.status}
              </span>
              <span className="truncate text-ink">{c.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hasRepoShape(state: GitRepoState | null | undefined): state is GitRepoState {
  return Boolean(state && (state.initialized != null || state.head || state.repo_name));
}

export function GitRepoPanel({ state }: Props) {
  if (!hasRepoShape(state)) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-ink-faint">
        Select a scenario to inspect repository state.
      </div>
    );
  }

  const staged = state.staged ?? [];
  const workingTree = state.working_tree ?? [];
  const untracked = state.untracked ?? [];
  const branches = state.branches ?? {};
  const remotes = state.remotes ?? {};
  const stash = state.stash ?? [];
  const commits = state.commits ?? [];

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4">
        <p className="section-label mb-1">Repository</p>
        <h2 className="font-display text-sm font-semibold text-ink">
          {state.repo_name || "repository"}
        </h2>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-surface-border bg-surface-overlay/50 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
            <GitBranch className="h-3 w-3" /> Branch
          </div>
          <p className="truncate font-mono text-xs text-ink">
            {state.detached ? "(detached)" : state.current_branch || "—"}
          </p>
        </div>
        <div className="rounded-xl border border-surface-border bg-surface-overlay/50 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
            <GitCommitHorizontal className="h-3 w-3" /> HEAD
          </div>
          <p className="truncate font-mono text-xs text-accent">{state.head || "—"}</p>
        </div>
      </div>

      <div className="mb-4 space-y-4">
        <ChangeList title="Staging area" items={staged} empty="Nothing staged" />
        <ChangeList title="Working tree" items={workingTree} empty="Clean working tree" />
        <div>
          <p className="section-label">Untracked</p>
          {untracked.length === 0 ? (
            <p className="text-xs text-ink-faint">None</p>
          ) : (
            <ul className="space-y-1">
              {untracked.map((p) => (
                <li key={p} className="flex items-center gap-2 font-mono text-xs text-ink-muted">
                  <FileWarning className="h-3 w-3 text-warn" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mb-4">
        <p className="section-label flex items-center gap-1.5">
          <Layers className="h-3 w-3" /> Branches
        </p>
        <ul className="space-y-1">
          {Object.entries(branches).map(([name, tip]) => (
            <li key={name} className="flex items-center justify-between gap-2 font-mono text-xs">
              <span className={name === state.current_branch ? "text-accent" : "text-ink"}>
                {name === state.current_branch ? `* ${name}` : name}
              </span>
              <span className="text-ink-faint">{tip}</span>
            </li>
          ))}
        </ul>
      </div>

      {Object.keys(remotes).length > 0 && (
        <div className="mb-4">
          <p className="section-label">Remotes</p>
          <ul className="space-y-1">
            {Object.entries(remotes).map(([name, url]) => (
              <li key={name} className="truncate font-mono text-[11px] text-ink-muted">
                <span className="text-ink">{name}</span> · {url}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stash.length > 0 && (
        <div className="mb-4">
          <p className="section-label">Stash</p>
          <ul className="space-y-1 text-xs text-ink-muted">
            {stash.map((s, i) => (
              <li key={i} className="font-mono">
                {`stash@{${i}}`}: {s.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="section-label">Commit graph</p>
        <GitCommitGraph
          commits={commits}
          branches={branches}
          head={state.head || ""}
          currentBranch={state.current_branch}
        />
      </div>
    </div>
  );
}
