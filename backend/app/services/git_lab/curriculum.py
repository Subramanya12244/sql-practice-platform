"""Canonical Git Practice Lab curriculum modules (unlimited exercises each)."""

from __future__ import annotations

from typing import Dict, List, TypedDict


class ModuleDef(TypedDict):
    slug: str
    title: str
    description: str
    sort_order: int


GIT_MODULES: List[ModuleDef] = [
    {
        "slug": "version-control-basics",
        "title": "Git & Version Control Basics",
        "description": "Why version control exists and how Git fits the mental model.",
        "sort_order": 1,
    },
    {
        "slug": "init-config",
        "title": "Repository Initialization & Configuration",
        "description": "git init, identity, and local configuration.",
        "sort_order": 2,
    },
    {
        "slug": "working-tree",
        "title": "Working Tree",
        "description": "Tracked vs untracked files and the working directory.",
        "sort_order": 3,
    },
    {
        "slug": "git-status",
        "title": "git status",
        "description": "Inspect branch, staging, and working-tree state.",
        "sort_order": 4,
    },
    {
        "slug": "staging",
        "title": "Staging",
        "description": "Selective staging with git add and the index.",
        "sort_order": 5,
    },
    {
        "slug": "commits",
        "title": "Commits",
        "description": "Creating snapshots with clear messages.",
        "sort_order": 6,
    },
    {
        "slug": "git-log",
        "title": "git log & History",
        "description": "Reading commit history and ancestry.",
        "sort_order": 7,
    },
    {
        "slug": "git-diff",
        "title": "git diff",
        "description": "Compare working tree, index, and commits.",
        "sort_order": 8,
    },
    {
        "slug": "branches",
        "title": "Branches",
        "description": "Create, list, and delete branches.",
        "sort_order": 9,
    },
    {
        "slug": "switch-checkout",
        "title": "git switch / checkout",
        "description": "Move HEAD between branches and commits.",
        "sort_order": 10,
    },
    {
        "slug": "merging",
        "title": "Merging",
        "description": "Fast-forward and merge commits.",
        "sort_order": 11,
    },
    {
        "slug": "merge-conflicts",
        "title": "Merge Conflicts",
        "description": "Understand and resolve conflicting changes.",
        "sort_order": 12,
    },
    {
        "slug": "remotes",
        "title": "Remote Repositories",
        "description": "Remotes, URLs, and remote-tracking refs.",
        "sort_order": 13,
    },
    {
        "slug": "fetch-pull-push",
        "title": "Fetch / Pull / Push",
        "description": "Sync local and remote histories safely.",
        "sort_order": 14,
    },
    {
        "slug": "undoing",
        "title": "Undoing Changes",
        "description": "Safe recovery patterns across Git areas.",
        "sort_order": 15,
    },
    {
        "slug": "reset-restore-revert",
        "title": "Reset / Restore / Revert",
        "description": "Choose the right undo tool for the situation.",
        "sort_order": 16,
    },
    {
        "slug": "stash",
        "title": "Stash",
        "description": "Temporarily shelve work in progress.",
        "sort_order": 17,
    },
    {
        "slug": "rebase",
        "title": "Rebase",
        "description": "Replay commits onto another tip.",
        "sort_order": 18,
    },
    {
        "slug": "interactive-rebase",
        "title": "Interactive Rebase",
        "description": "Squash, reorder, and edit local history.",
        "sort_order": 19,
    },
    {
        "slug": "cherry-pick",
        "title": "Cherry-pick",
        "description": "Apply individual commits onto another branch.",
        "sort_order": 20,
    },
    {
        "slug": "reflog-recovery",
        "title": "Reflog & Recovery",
        "description": "Recover commits that seem lost.",
        "sort_order": 21,
    },
    {
        "slug": "gitignore",
        "title": ".gitignore",
        "description": "Exclude build artifacts and secrets from tracking.",
        "sort_order": 22,
    },
    {
        "slug": "tags",
        "title": "Tags",
        "description": "Annotate releases and important points in history.",
        "sort_order": 23,
    },
    {
        "slug": "workflows",
        "title": "Git Workflows",
        "description": "Feature branches, PRs, and team collaboration patterns.",
        "sort_order": 24,
    },
    {
        "slug": "troubleshooting",
        "title": "Real-world Git Troubleshooting",
        "description": "Practical incident-style scenarios developers hit daily.",
        "sort_order": 25,
    },
]

# Map legacy curriculum slugs → new module slugs
LEGACY_TOPIC_MAP: Dict[str, str] = {
    "fundamentals": "git-status",
    "branching": "branches",
    "remotes": "remotes",
    "undoing": "reset-restore-revert",
    "stash": "stash",
    "rebase": "rebase",
    "cherry-pick": "cherry-pick",
    "recovery": "reflog-recovery",
    "real-world": "troubleshooting",
}

VALID_DIFFICULTIES = {"Easy", "Medium", "Hard", "Expert"}
DIFFICULTY_ALIASES = {
    "easy": "Easy",
    "beginner": "Easy",
    "medium": "Medium",
    "intermediate": "Medium",
    "hard": "Hard",
    "advanced": "Hard",
    "senior": "Hard",
    "expert": "Expert",
}

VALID_TYPES = {
    "command",
    "multiple_choice",
    "output_interpretation",
    "state_prediction",
    "debugging",
    "scenario",
    "multi_step",
    "command_comparison",
    "repository_state",
    "terminal",
}

TYPE_ALIASES = {
    "mcq": "multiple_choice",
    "multiple-choice": "multiple_choice",
    "output": "output_interpretation",
    "predict": "state_prediction",
    "debug": "debugging",
    "multi-step": "multi_step",
    "comparison": "command_comparison",
    "repo": "repository_state",
    "repo_state": "repository_state",
}


def normalize_difficulty(raw: str | None) -> str:
    if not raw:
        return "Easy"
    key = raw.strip().lower()
    return DIFFICULTY_ALIASES.get(key, raw.strip().title() if raw.strip().title() in VALID_DIFFICULTIES else "Easy")


def normalize_type(raw: str | None) -> str:
    if not raw:
        return "command"
    key = raw.strip().lower().replace(" ", "_")
    mapped = TYPE_ALIASES.get(key, key)
    return mapped if mapped in VALID_TYPES else "command"


def slugify_module(title: str) -> str:
    import re

    s = title.lower().strip()
    s = re.sub(r"^module:\s*", "", s)
    # Exact match against canonical curriculum titles / slugs
    for m in GIT_MODULES:
        if m["title"].lower() == s or m["slug"] == s:
            return m["slug"]
    # Known short aliases from markdown headings (before fuzzy match)
    aliases = {
        "git status": "git-status",
        "staging": "staging",
        "commits": "commits",
        "branches": "branches",
        "stash": "stash",
        "merging": "merging",
        "git diff": "git-diff",
        "git log & history": "git-log",
        "git log and history": "git-log",
        "remote repositories": "remotes",
        "fetch / pull / push": "fetch-pull-push",
        "reset / restore / revert": "reset-restore-revert",
        "real-world git troubleshooting": "troubleshooting",
        "git & version control basics": "version-control-basics",
        ".gitignore": "gitignore",
        # Data-engineering 150 bank modules
        "git foundations & mental model": "version-control-basics",
        "git foundations and mental model": "version-control-basics",
        "repository setup & configuration": "init-config",
        "repository setup and configuration": "init-config",
        "working tree, staging & diff": "staging",
        "working tree, staging and diff": "staging",
        "commits & history": "commits",
        "commits and history": "commits",
        "branches & switching": "branches",
        "branches and switching": "branches",
        "merging & conflict resolution": "merge-conflicts",
        "merging and conflict resolution": "merge-conflicts",
        "fetch, pull, push & collaboration": "fetch-pull-push",
        "fetch, pull, push and collaboration": "fetch-pull-push",
        "undo, reset, restore & revert": "reset-restore-revert",
        "undo, reset, restore and revert": "reset-restore-revert",
        "stash & temporary work": "stash",
        "stash and temporary work": "stash",
        "rebase & clean history": "rebase",
        "rebase and clean history": "rebase",
        "cherry-pick, reflog & recovery": "reflog-recovery",
        "cherry-pick, reflog and recovery": "reflog-recovery",
        "tags, releases & .gitignore": "tags",
        "tags, releases and .gitignore": "tags",
        "data engineering git workflows": "workflows",
    }
    if s in aliases:
        return aliases[s]
    for m in GIT_MODULES:
        t = m["title"].lower()
        if s in t or t in s or m["slug"].replace("-", " ") in s:
            return m["slug"]
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "general"
