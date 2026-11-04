"""Parse and execute allowlisted Git commands against a simulated GitState.

Never shells out to the host. Arbitrary shell / network / path escape is rejected.
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass
from typing import List, Optional, Sequence, Set

from app.services.git_lab.state import (
    Commit,
    GitState,
    StashEntry,
    _short_hash,
    is_safe_path,
)

# Commands we teach / allow in the sandbox simulator
ALLOWED_BINARIES = {"git"}

ALLOWED_GIT_SUBCOMMANDS: Set[str] = {
    "init",
    "status",
    "add",
    "commit",
    "log",
    "diff",
    "branch",
    "switch",
    "checkout",
    "merge",
    "restore",
    "reset",
    "revert",
    "rm",
    "mv",
    "stash",
    "remote",
    "fetch",
    "pull",
    "push",
    "clone",
    "cherry-pick",
    "rebase",
    "reflog",
    "show",
    "config",
}


@dataclass
class CommandResult:
    ok: bool
    output: str
    state: GitState
    error: Optional[str] = None


class GitCommandError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def tokenize(command: str) -> List[str]:
    command = command.strip()
    if not command:
        raise GitCommandError("Empty command")
    if "\n" in command or "\r" in command:
        raise GitCommandError("Only a single command is allowed per submission")
    # Block shell metacharacters / chaining
    if re.search(r"[;&|`$<>]|&&|\|\|", command):
        raise GitCommandError(
            "Shell operators are not allowed. Enter a single git command."
        )
    try:
        parts = shlex.split(command)
    except ValueError as exc:
        raise GitCommandError(f"Could not parse command: {exc}") from exc
    if not parts:
        raise GitCommandError("Empty command")
    return parts


def execute_command(state: GitState, command: str) -> CommandResult:
    """Execute one allowlisted git command; returns new state + stdout."""
    new_state = state.clone()
    try:
        parts = tokenize(command)
        if parts[0] != "git":
            raise GitCommandError("Only `git …` commands are supported in this lab")
        if len(parts) < 2:
            raise GitCommandError("Missing git subcommand")
        sub = parts[1]
        if sub not in ALLOWED_GIT_SUBCOMMANDS:
            raise GitCommandError(
                f"`git {sub}` is not available in this practice sandbox yet"
            )
        output = _dispatch(new_state, sub, parts[2:])
        new_state.last_output = output
        return CommandResult(ok=True, output=output, state=new_state)
    except GitCommandError as exc:
        return CommandResult(
            ok=False, output="", state=state.clone(), error=exc.message
        )


def _dispatch(state: GitState, sub: str, args: Sequence[str]) -> str:
    if sub == "init":
        return _cmd_init(state, args)
    if sub == "status":
        return _cmd_status(state, args)
    if sub == "add":
        return _cmd_add(state, args)
    if sub == "commit":
        return _cmd_commit(state, args)
    if sub == "log":
        return _cmd_log(state, args)
    if sub == "diff":
        return _cmd_diff(state, args)
    if sub == "branch":
        return _cmd_branch(state, args)
    if sub in {"switch", "checkout"}:
        return _cmd_switch(state, args, checkout=(sub == "checkout"))
    if sub == "restore":
        return _cmd_restore(state, args)
    if sub == "reset":
        return _cmd_reset(state, args)
    if sub == "rm":
        return _cmd_rm(state, args)
    if sub == "mv":
        return _cmd_mv(state, args)
    if sub == "stash":
        return _cmd_stash(state, args)
    if sub == "merge":
        return _cmd_merge(state, args)
    if sub == "remote":
        return _cmd_remote(state, args)
    if sub == "revert":
        return _cmd_revert(state, args)
    if sub == "reflog":
        return _cmd_reflog(state, args)
    if sub in {"fetch", "pull", "push", "clone", "cherry-pick", "rebase", "show", "config"}:
        raise GitCommandError(
            f"`git {sub}` is recognized but this scenario uses the state simulator — "
            "try a fundamentals/branching command, or pick a matching advanced scenario."
        )
    raise GitCommandError(f"Unhandled subcommand: {sub}")


def _require_repo(state: GitState) -> None:
    if not state.initialized:
        raise GitCommandError("not a git repository (or any of the parent directories): .git")


def _cmd_init(state: GitState, args: Sequence[str]) -> str:
    if state.initialized and state.commits:
        return "Reinitialized existing Git repository"
    state.initialized = True
    if not state.current_branch:
        state.current_branch = "main"
    if "main" not in state.branches and not state.commits:
        state.branches["main"] = ""
        state.current_branch = "main"
        state.head = ""
        state.index = {}
        state.files = state.files or {}
    return "Initialized empty Git repository"


def _cmd_status(state: GitState, _args: Sequence[str]) -> str:
    _require_repo(state)
    lines = []
    if state.detached:
        lines.append(f"HEAD detached at {state.head}")
    else:
        lines.append(f"On branch {state.current_branch}")

    staged = state.staged_changes()
    wt = state.working_tree_changes()
    if staged:
        lines.append("Changes to be committed:")
        for c in staged:
            label = {"A": "new file", "M": "modified", "D": "deleted"}.get(
                c["status"], c["status"]
            )
            lines.append(f"  {label}:   {c['path']}")
    if wt:
        lines.append("Changes not staged for commit:")
        for c in wt:
            label = {"M": "modified", "D": "deleted"}.get(c["status"], c["status"])
            lines.append(f"  {label}:   {c['path']}")
    if state.untracked:
        lines.append("Untracked files:")
        for p in sorted(state.untracked):
            lines.append(f"  {p}")
    if not staged and not wt and not state.untracked:
        lines.append("nothing to commit, working tree clean")
    return "\n".join(lines)


def _cmd_add(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    if not args:
        raise GitCommandError("Nothing specified, nothing added.")
    paths = list(args)
    if paths == ["."] or paths == ["-A"] or paths == ["--all"]:
        paths = sorted(set(state.files) | state.untracked | set(state.head_tree()))
        # Also stage deletions of tracked files missing from working tree
        for p in list(state.head_tree()):
            if p not in state.files and p not in state.untracked:
                state.index[p] = "__DELETED__"
    for path in paths:
        if path in {".", "-A", "--all"}:
            continue
        if not is_safe_path(path):
            raise GitCommandError(f"invalid pathspec '{path}'")
        if path in state.untracked or path in state.files:
            if path not in state.files:
                raise GitCommandError(f"pathspec '{path}' did not match any files")
            state.index[path] = state.files[path]
            state.untracked.discard(path)
        elif path in state.head_tree() and path not in state.files:
            state.index[path] = "__DELETED__"
        else:
            raise GitCommandError(f"pathspec '{path}' did not match any files")
    return ""


def _parse_commit_message(args: Sequence[str]) -> str:
    if "-m" in args:
        i = list(args).index("-m")
        if i + 1 >= len(args):
            raise GitCommandError("error: switch `m' requires a value")
        return args[i + 1]
    raise GitCommandError("Please supply a commit message with -m")


def _cmd_commit(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    amend = "--amend" in args
    message = _parse_commit_message(args)

    staged = state.staged_changes()
    if not staged and not amend:
        raise GitCommandError("nothing to commit, working tree clean")

    # Build new tree from index (skip deletions)
    new_tree: dict[str, str] = {}
    for path, content in state.index.items():
        if content == "__DELETED__":
            continue
        new_tree[path] = content

    parents = [state.head] if state.head else []
    if amend and state.head:
        old = state.commits[state.head]
        parents = list(old.parents)
        # remove old commit from map if no other branch points only to it — keep simple
        message = message or old.message

    payload = message + "|" + "|".join(f"{k}:{v}" for k, v in sorted(new_tree.items()))
    h = _short_hash(payload + str(len(state.commits)))
    commit = Commit(hash=h, message=message, parents=parents, tree=new_tree)
    state.commits[h] = commit
    state.head = h
    if not state.detached:
        state.branches[state.current_branch] = h
    # Reset index to new HEAD
    state.index = dict(new_tree)
    return f"[{state.current_branch if not state.detached else 'detached HEAD'} {h}] {message}"


def _cmd_log(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    oneline = "--oneline" in args
    lines = []
    seen = set()
    stack = [state.head] if state.head else []
    while stack:
        h = stack.pop(0)
        if not h or h in seen:
            continue
        seen.add(h)
        c = state.commits.get(h)
        if not c:
            continue
        if oneline:
            lines.append(f"{c.hash} {c.message}")
        else:
            lines.append(f"commit {c.hash}")
            lines.append(f"    {c.message}")
            lines.append("")
        stack.extend(c.parents)
    return "\n".join(lines).rstrip() or "fatal: your current branch does not have any commits yet"


def _cmd_diff(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    staged = "--staged" in args or "--cached" in args
    changes = state.staged_changes() if staged else state.working_tree_changes()
    if not changes:
        return ""
    lines = []
    for c in changes:
        lines.append(f"diff -- git a/{c['path']} b/{c['path']}")
        lines.append(f"--- a/{c['path']}")
        lines.append(f"+++ b/{c['path']}")
        lines.append(f"(content {c['status']})")
    return "\n".join(lines)


def _cmd_branch(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    if not args:
        lines = []
        for name in sorted(state.branches):
            prefix = "* " if name == state.current_branch and not state.detached else "  "
            lines.append(f"{prefix}{name}")
        return "\n".join(lines)
    if args[0] in {"-d", "-D"}:
        if len(args) < 2:
            raise GitCommandError("branch name required")
        name = args[1]
        if name == state.current_branch:
            raise GitCommandError(f"Cannot delete branch '{name}' checked out at")
        if name not in state.branches:
            raise GitCommandError(f"branch '{name}' not found")
        del state.branches[name]
        return f"Deleted branch {name}"
    # create branch
    name = args[0]
    if not is_safe_path(name):
        raise GitCommandError(f"invalid branch name '{name}'")
    if name in state.branches:
        raise GitCommandError(f"A branch named '{name}' already exists")
    if not state.head:
        raise GitCommandError("cannot create branch without commits")
    state.branches[name] = state.head
    return ""


def _cmd_switch(state: GitState, args: Sequence[str], checkout: bool = False) -> str:
    _require_repo(state)
    create = False
    name = None
    i = 0
    while i < len(args):
        a = args[i]
        if a in {"-c", "-b"}:
            create = True
            i += 1
            if i >= len(args):
                raise GitCommandError("missing branch name")
            name = args[i]
        elif a.startswith("-"):
            raise GitCommandError(f"unsupported flag {a}")
        else:
            name = a
        i += 1
    if not name:
        raise GitCommandError("missing branch name")
    if not is_safe_path(name):
        raise GitCommandError(f"invalid branch name '{name}'")

    dirty = state.working_tree_changes() or state.staged_changes()
    # Allow switch with dirty tree only if trees compatible — keep strict for learning
    if dirty and name in state.branches and state.branches[name] != state.head:
        raise GitCommandError(
            "Your local changes would be overwritten by checkout.\n"
            "Commit, stash, or restore them first."
        )

    if create:
        if name in state.branches:
            raise GitCommandError(f"A branch named '{name}' already exists")
        state.branches[name] = state.head

    if name not in state.branches:
        raise GitCommandError(f"pathspec '{name}' did not match any file(s) known to git")

    target = state.branches[name]
    state.current_branch = name
    state.detached = False
    state.head = target
    tree = state.head_tree()
    # Reset working tree/index to target (discard uncommitted when switching targets)
    state.files = dict(tree)
    state.index = dict(tree)
    state.untracked = set()
    action = "Switched to a new branch" if create else "Switched to branch"
    return f"{action} '{name}'"


def _cmd_restore(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    staged = "--staged" in args
    paths = [a for a in args if not a.startswith("-")]
    if not paths:
        raise GitCommandError("you must specify path(s) to restore")
    head = state.head_tree()
    for path in paths:
        if not is_safe_path(path):
            raise GitCommandError(f"invalid path '{path}'")
        if staged:
            # unstage: reset index entry to HEAD
            if path in head:
                state.index[path] = head[path]
            else:
                state.index.pop(path, None)
        else:
            # restore working tree from index (or HEAD)
            if path in state.index and state.index[path] != "__DELETED__":
                state.files[path] = state.index[path]
            elif path in head:
                state.files[path] = head[path]
            else:
                state.files.pop(path, None)
            state.untracked.discard(path)
    return ""


def _cmd_reset(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    mode = "--mixed"
    target = None
    for a in args:
        if a in {"--soft", "--mixed", "--hard"}:
            mode = a
        elif not a.startswith("-"):
            target = a
    if target in {None, "HEAD"}:
        # unstage all / reset index to HEAD
        head = state.head_tree()
        if mode == "--soft":
            return ""  # soft reset to HEAD is no-op for tip
        state.index = dict(head)
        if mode == "--hard":
            state.files = dict(head)
            state.untracked = set()
        return ""
    # reset to commit (HEAD~1 style limited)
    if target == "HEAD~1" or target == "@~1":
        c = state.head_commit()
        if not c or not c.parents:
            raise GitCommandError("no commits to reset")
        new_head = c.parents[0]
    elif target in state.commits:
        new_head = target
    else:
        raise GitCommandError(f"unknown revision '{target}'")

    state.head = new_head
    if not state.detached:
        state.branches[state.current_branch] = new_head
    tree = state.head_tree()
    if mode == "--soft":
        pass  # keep index and working tree
    elif mode == "--mixed":
        state.index = dict(tree)
    else:  # hard
        state.index = dict(tree)
        state.files = dict(tree)
        state.untracked = set()
    return ""


def _cmd_rm(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    cached = "--cached" in args
    paths = [a for a in args if not a.startswith("-")]
    if not paths:
        raise GitCommandError("No pathspec given")
    for path in paths:
        if not is_safe_path(path):
            raise GitCommandError(f"invalid path '{path}'")
        if path not in state.head_tree() and path not in state.index:
            raise GitCommandError(f"pathspec '{path}' did not match any files")
        state.index[path] = "__DELETED__"
        if not cached:
            state.files.pop(path, None)
        state.untracked.discard(path)
    return f"rm '{paths[0]}'" if len(paths) == 1 else ""


def _cmd_mv(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    paths = [a for a in args if not a.startswith("-")]
    if len(paths) != 2:
        raise GitCommandError("usage: git mv <source> <destination>")
    src, dst = paths
    if not is_safe_path(src) or not is_safe_path(dst):
        raise GitCommandError("invalid path")
    if src not in state.files and src not in state.head_tree():
        raise GitCommandError(f"bad source {src}")
    content = state.files.get(src) or state.head_tree().get(src, "")
    state.files.pop(src, None)
    state.files[dst] = content
    state.index[src] = "__DELETED__"
    state.index[dst] = content
    state.untracked.discard(src)
    state.untracked.discard(dst)
    return ""


def _cmd_stash(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    action = args[0] if args else "push"
    if action in {"push", "save"} or not args:
        if not state.working_tree_changes() and not state.staged_changes() and not state.untracked:
            return "No local changes to save"
        entry = StashEntry(
            message="WIP on " + (state.current_branch or "HEAD"),
            working_tree={
                c["path"]: state.files.get(c["path"], "")
                for c in state.working_tree_changes()
            },
            index={
                c["path"]: state.index.get(c["path"], "")
                for c in state.staged_changes()
            },
            untracked=set(state.untracked),
            base_head=state.head,
        )
        state.stash.insert(0, entry)
        # clean working tree to HEAD
        tree = state.head_tree()
        state.files = dict(tree)
        state.index = dict(tree)
        state.untracked = set()
        return "Saved working directory and index state " + entry.message

    if action == "list":
        if not state.stash:
            return ""
        return "\n".join(
            f"stash@{{{i}}}: {s.message}" for i, s in enumerate(state.stash)
        )

    if action in {"pop", "apply"}:
        if not state.stash:
            raise GitCommandError("No stash entries found.")
        entry = state.stash[0]
        for path, content in entry.working_tree.items():
            state.files[path] = content
        for path, content in entry.index.items():
            state.index[path] = content
        state.untracked |= entry.untracked
        for path in entry.untracked:
            if path not in state.files:
                state.files[path] = f"# untracked {path}\n"
        if action == "pop":
            state.stash.pop(0)
        return "On branch " + (state.current_branch or "HEAD") + "\nDropped refs/stash@{0}"

    if action == "drop":
        if not state.stash:
            raise GitCommandError("No stash entries found.")
        state.stash.pop(0)
        return "Dropped refs/stash@{0}"

    raise GitCommandError(f"unknown stash subcommand '{action}'")


def _cmd_merge(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    if not args:
        raise GitCommandError("branch name required")
    name = args[0]
    if name not in state.branches:
        raise GitCommandError(f"merge: {name} - not something we can merge")
    their_hash = state.branches[name]
    if their_hash == state.head:
        return "Already up to date."
    # Fast-forward if HEAD is ancestor of theirs (simplified: head in their parents chain)
    their = state.commits[their_hash]
    ancestors = set()
    stack = list(their.parents)
    while stack:
        h = stack.pop()
        if h in ancestors:
            continue
        ancestors.add(h)
        if h in state.commits:
            stack.extend(state.commits[h].parents)
    if state.head in ancestors or not state.head:
        state.head = their_hash
        if not state.detached:
            state.branches[state.current_branch] = their_hash
        tree = state.head_tree()
        state.files = dict(tree)
        state.index = dict(tree)
        return f"Updating to {their_hash}\nFast-forward"

    # Merge commit
    our = state.head_commit()
    merged_tree = dict(our.tree if our else {})
    merged_tree.update(their.tree)
    msg = f"Merge branch '{name}'"
    h = _short_hash(msg + state.head + their_hash)
    commit = Commit(
        hash=h,
        message=msg,
        parents=[state.head, their_hash],
        tree=merged_tree,
    )
    state.commits[h] = commit
    state.head = h
    if not state.detached:
        state.branches[state.current_branch] = h
    state.files = dict(merged_tree)
    state.index = dict(merged_tree)
    return f"Merge made by the 'ort' strategy.\n{h} {msg}"


def _cmd_remote(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    if not args or args[0] == "-v":
        lines = []
        for name, url in sorted(state.remotes.items()):
            lines.append(f"{name}\t{url} (fetch)")
            lines.append(f"{name}\t{url} (push)")
        return "\n".join(lines)
    if args[0] == "add":
        if len(args) < 3:
            raise GitCommandError("usage: git remote add <name> <url>")
        name, url = args[1], args[2]
        state.remotes[name] = url
        return ""
    if args[0] == "remove" or args[0] == "rm":
        if len(args) < 2:
            raise GitCommandError("remote name required")
        state.remotes.pop(args[1], None)
        return ""
    raise GitCommandError(f"unknown remote subcommand '{args[0]}'")


def _cmd_revert(state: GitState, args: Sequence[str]) -> str:
    _require_repo(state)
    paths = [a for a in args if not a.startswith("-")]
    if not paths:
        raise GitCommandError("commit required")
    target = paths[0]
    if target not in state.commits:
        raise GitCommandError(f"bad revision '{target}'")
    # Simplified: create a revert commit restoring parent tree of target if single parent
    c = state.commits[target]
    if not c.parents:
        raise GitCommandError("cannot revert initial commit in this simulator")
    parent_tree = dict(state.commits[c.parents[0]].tree)
    msg = f'Revert "{c.message}"'
    h = _short_hash(msg + state.head)
    commit = Commit(hash=h, message=msg, parents=[state.head], tree=parent_tree)
    state.commits[h] = commit
    state.head = h
    if not state.detached:
        state.branches[state.current_branch] = h
    state.files = dict(parent_tree)
    state.index = dict(parent_tree)
    return f"[{state.current_branch} {h}] {msg}"


def _cmd_reflog(state: GitState, _args: Sequence[str]) -> str:
    _require_repo(state)
    # Simplified chronological list of commits reachable
    lines = []
    for i, (h, c) in enumerate(state.commits.items()):
        lines.append(f"{h} HEAD@{{{i}}}: commit: {c.message}")
    return "\n".join(reversed(lines))
