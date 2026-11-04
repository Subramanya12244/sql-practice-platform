"""In-memory Git repository state for sandboxed practice.

This is a **simulator**, not a wrapper around host `git`. Commands mutate an
isolated Python state object. No filesystem or network access.
"""

from __future__ import annotations

import copy
import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set


def _short_hash(payload: str) -> str:
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:7]


@dataclass
class Commit:
    hash: str
    message: str
    parents: List[str] = field(default_factory=list)
    tree: Dict[str, str] = field(default_factory=dict)  # path -> content

    def to_dict(self) -> Dict[str, Any]:
        return {
            "hash": self.hash,
            "message": self.message,
            "parents": list(self.parents),
            "tree": dict(self.tree),
        }


@dataclass
class StashEntry:
    message: str
    working_tree: Dict[str, str]
    index: Dict[str, str]
    untracked: Set[str]
    base_head: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "message": self.message,
            "base_head": self.base_head,
            "paths": sorted(set(self.working_tree) | set(self.index) | self.untracked),
        }


@dataclass
class GitState:
    """Full simulated repository state."""

    repo_name: str = "practice-repo"
    initialized: bool = True
    current_branch: str = "main"
    head: str = ""
    commits: Dict[str, Commit] = field(default_factory=dict)
    branches: Dict[str, str] = field(default_factory=dict)
    # Full working tree file contents (committed + local edits)
    files: Dict[str, str] = field(default_factory=dict)
    # Staged snapshot path -> content
    index: Dict[str, str] = field(default_factory=dict)
    untracked: Set[str] = field(default_factory=set)
    remotes: Dict[str, str] = field(default_factory=dict)
    tracking: Dict[str, str] = field(default_factory=dict)
    stash: List[StashEntry] = field(default_factory=list)
    detached: bool = False
    merge_in_progress: bool = False
    rebase_in_progress: bool = False
    last_output: str = ""

    def clone(self) -> "GitState":
        return copy.deepcopy(self)

    def head_commit(self) -> Optional[Commit]:
        return self.commits.get(self.head) if self.head else None

    def head_tree(self) -> Dict[str, str]:
        c = self.head_commit()
        return dict(c.tree) if c else {}

    def working_tree_changes(self) -> List[Dict[str, str]]:
        """Changes in working tree vs HEAD that are not staged-only."""
        head = self.head_tree()
        changes: List[Dict[str, str]] = []
        tracked_paths = set(head) | set(self.index) | {
            p for p in self.files if p not in self.untracked
        }
        for path in sorted(tracked_paths):
            if path in self.untracked:
                continue
            wt = self.files.get(path)
            committed = head.get(path)
            staged = self.index.get(path)
            # Compare working tree to index if staged, else to HEAD
            baseline = staged if path in self.index else committed
            if wt is None and baseline is not None:
                changes.append({"path": path, "status": "D"})
            elif wt is not None and baseline is None:
                # New file tracked via add then modified? treat as modified if staged
                if path in self.index and wt != staged:
                    changes.append({"path": path, "status": "M"})
            elif wt is not None and baseline is not None and wt != baseline:
                changes.append({"path": path, "status": "M"})
        return changes

    def staged_changes(self) -> List[Dict[str, str]]:
        head = self.head_tree()
        changes: List[Dict[str, str]] = []
        for path in sorted(set(self.index) | set(head)):
            staged = self.index.get(path)
            committed = head.get(path)
            if staged is None and path in self.index:
                # explicitly staged deletion represented by missing? we use sentinel
                continue
            if path in self.index:
                if committed is None:
                    changes.append({"path": path, "status": "A"})
                elif staged != committed:
                    if staged == "__DELETED__":
                        changes.append({"path": path, "status": "D"})
                    else:
                        changes.append({"path": path, "status": "M"})
            # staged deletion: path in head but marked deleted in index
        # Handle deletions marked with __DELETED__
        for path, content in list(self.index.items()):
            if content == "__DELETED__" and path in head:
                if not any(c["path"] == path for c in changes):
                    changes.append({"path": path, "status": "D"})
        return changes

    def public_view(self) -> Dict[str, Any]:
        """Learner-facing repository snapshot (no full file bodies)."""
        commits_list = []
        for h, c in self.commits.items():
            commits_list.append(
                {
                    "hash": c.hash,
                    "message": c.message,
                    "parents": list(c.parents),
                }
            )
        # topological-ish: by insertion order is fine for small graphs
        return {
            "repo_name": self.repo_name,
            "initialized": self.initialized,
            "current_branch": None if self.detached else self.current_branch,
            "head": self.head,
            "detached": self.detached,
            "branches": dict(self.branches),
            "working_tree": self.working_tree_changes(),
            "staged": self.staged_changes(),
            "untracked": sorted(self.untracked),
            "remotes": dict(self.remotes),
            "tracking": dict(self.tracking),
            "stash": [s.to_dict() for s in self.stash],
            "commits": commits_list,
            "merge_in_progress": self.merge_in_progress,
            "rebase_in_progress": self.rebase_in_progress,
            "files": sorted(self.files.keys()),
        }

    def comparable_snapshot(self) -> Dict[str, Any]:
        """Normalized state used by the evaluator (ignores cosmetic fields)."""
        return {
            "current_branch": None if self.detached else self.current_branch,
            "head": self.head,
            "detached": self.detached,
            "branches": dict(sorted(self.branches.items())),
            "working_tree": self.working_tree_changes(),
            "staged": self.staged_changes(),
            "untracked": sorted(self.untracked),
            "remotes": dict(sorted(self.remotes.items())),
            "tracking": dict(sorted(self.tracking.items())),
            "stash_count": len(self.stash),
            "merge_in_progress": self.merge_in_progress,
            "rebase_in_progress": self.rebase_in_progress,
            "commit_messages": {
                h: c.message for h, c in sorted(self.commits.items())
            },
            "branch_tips": dict(sorted(self.branches.items())),
        }


def state_from_dict(data: Dict[str, Any]) -> GitState:
    """Hydrate a GitState from question seed / expected_state JSON."""
    state = GitState(
        repo_name=data.get("repo_name", "practice-repo"),
        initialized=data.get("initialized", True),
        current_branch=data.get("current_branch") or "main",
        head=data.get("head") or "",
        detached=bool(data.get("detached", False)),
        remotes=dict(data.get("remotes") or {}),
        tracking=dict(data.get("tracking") or {}),
        merge_in_progress=bool(data.get("merge_in_progress", False)),
        rebase_in_progress=bool(data.get("rebase_in_progress", False)),
    )

    commits_raw = data.get("commits") or []
    if isinstance(commits_raw, dict):
        for h, c in commits_raw.items():
            state.commits[h] = Commit(
                hash=h,
                message=c.get("message", ""),
                parents=list(c.get("parents") or []),
                tree=dict(c.get("tree") or {}),
            )
    else:
        for c in commits_raw:
            h = c["hash"]
            state.commits[h] = Commit(
                hash=h,
                message=c.get("message", ""),
                parents=list(c.get("parents") or []),
                tree=dict(c.get("tree") or {}),
            )

    state.branches = dict(data.get("branches") or {})
    if not state.head and state.current_branch in state.branches:
        state.head = state.branches[state.current_branch]

    # File contents: prefer explicit files map; else rebuild from HEAD tree + overlays
    files = dict(data.get("files") or {})
    if not files and state.head in state.commits:
        files = dict(state.commits[state.head].tree)

    # Apply working_tree change overlays: {path, status, content?}
    for change in data.get("working_tree") or []:
        path = change["path"]
        status = change.get("status", "M")
        if status == "D":
            files.pop(path, None)
        else:
            content = change.get("content")
            if content is None:
                content = files.get(path, f"# modified {path}\n")
                if status == "M" and path in files:
                    content = files[path] + "\n# local change\n"
            files[path] = content

    state.files = files

    # Index from staged entries
    head_tree = state.head_tree()
    index: Dict[str, str] = dict(head_tree)  # start clean then apply staged
    # Default: index matches HEAD (clean staging). Rebuild from staged list.
    index = dict(head_tree)
    for change in data.get("staged") or []:
        path = change["path"]
        status = change.get("status", "M")
        if status == "D":
            index[path] = "__DELETED__"
        elif status == "A":
            index[path] = change.get("content") or state.files.get(path, f"# new {path}\n")
            if path not in state.files:
                state.files[path] = index[path]
        else:
            index[path] = change.get("content") or state.files.get(
                path, head_tree.get(path, f"# staged {path}\n")
            )
            if path in state.files and "content" not in change:
                # keep working tree content; staged gets working content
                index[path] = state.files[path]

    # If no staged listed, index should match HEAD for clean state
    if not data.get("staged"):
        index = dict(head_tree)
    state.index = index

    state.untracked = set(data.get("untracked") or [])
    for path in state.untracked:
        if path not in state.files:
            state.files[path] = f"# untracked {path}\n"

    for s in data.get("stash") or []:
        state.stash.append(
            StashEntry(
                message=s.get("message", "WIP"),
                working_tree=dict(s.get("working_tree") or {}),
                index=dict(s.get("index") or {}),
                untracked=set(s.get("untracked") or []),
                base_head=s.get("base_head") or state.head,
            )
        )

    return state


def make_initial_commit(
    message: str = "Initial commit",
    files: Optional[Dict[str, str]] = None,
    branch: str = "main",
) -> GitState:
    files = files or {"README.md": "# Practice Repo\n"}
    h = _short_hash(message + "|".join(sorted(files.keys())))
    commit = Commit(hash=h, message=message, parents=[], tree=dict(files))
    return GitState(
        initialized=True,
        current_branch=branch,
        head=h,
        commits={h: commit},
        branches={branch: h},
        files=dict(files),
        index=dict(files),
        untracked=set(),
    )


_SAFE_PATH = re.compile(r"^[A-Za-z0-9_./@+-]+$")


def is_safe_path(path: str) -> bool:
    if not path or path.startswith("-"):
        return False
    if ".." in path or path.startswith("/") or path.startswith("~"):
        return False
    return bool(_SAFE_PATH.match(path))
