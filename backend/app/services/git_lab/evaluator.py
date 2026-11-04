"""Compare simulated Git states and produce learner feedback."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from app.services.git_lab.executor import CommandResult, execute_command
from app.services.git_lab.state import GitState, state_from_dict


def _set_of_paths(items: List[Dict[str, str]]) -> Set[tuple]:
    return {(i.get("path"), i.get("status")) for i in items}


def compare_states(actual: Dict[str, Any], expected: Dict[str, Any]) -> List[str]:
    """Return human-readable mismatch reasons (empty if match)."""
    mismatches: List[str] = []

    def check(key: str, label: str) -> None:
        if key not in expected:
            return
        if actual.get(key) != expected.get(key):
            mismatches.append(
                f"{label}: expected `{expected.get(key)}`, got `{actual.get(key)}`"
            )

    check("current_branch", "Current branch")
    check("head", "HEAD")
    check("detached", "Detached HEAD")
    check("stash_count", "Stash entries")
    check("merge_in_progress", "Merge in progress")
    check("rebase_in_progress", "Rebase in progress")

    if "branches" in expected:
        exp_b = expected["branches"]
        act_b = actual.get("branches") or {}
        if set(exp_b.keys()) != set(act_b.keys()):
            mismatches.append(
                f"Branches: expected {sorted(exp_b)}, got {sorted(act_b)}"
            )
        else:
            for name, tip in exp_b.items():
                # Allow matching by message if tip is a message marker
                if isinstance(tip, str) and tip.startswith("message:"):
                    msg = tip[len("message:") :]
                    # resolved via commit_messages on actual
                    continue
                if act_b.get(name) != tip and tip not in ("*", "any"):
                    # soft: if expected tip is unknown hash placeholder, skip
                    if tip and tip != act_b.get(name):
                        # Only hard-fail when expected looks like a real hash we know
                        if len(str(tip)) == 7 and tip in (actual.get("commit_messages") or {}):
                            if act_b.get(name) != tip:
                                mismatches.append(
                                    f"Branch `{name}` points to unexpected commit"
                                )

    if "working_tree" in expected:
        if _set_of_paths(actual.get("working_tree") or []) != _set_of_paths(
            expected["working_tree"]
        ):
            mismatches.append(
                "Working tree changes do not match the expected state"
            )

    if "staged" in expected:
        if _set_of_paths(actual.get("staged") or []) != _set_of_paths(expected["staged"]):
            mismatches.append("Staging area does not match the expected state")

    if "untracked" in expected:
        if sorted(actual.get("untracked") or []) != sorted(expected["untracked"]):
            mismatches.append(
                f"Untracked files: expected {sorted(expected['untracked'])}, "
                f"got {sorted(actual.get('untracked') or [])}"
            )

    if "remotes" in expected:
        if dict(sorted((actual.get("remotes") or {}).items())) != dict(
            sorted(expected["remotes"].items())
        ):
            mismatches.append("Remotes do not match the expected configuration")

    if "branch_exists" in expected:
        for name in expected["branch_exists"]:
            if name not in (actual.get("branches") or {}):
                mismatches.append(f"Expected branch `{name}` to exist")

    if "branch_missing" in expected:
        for name in expected["branch_missing"]:
            if name in (actual.get("branches") or {}):
                mismatches.append(f"Expected branch `{name}` to be deleted")

    if "head_message_contains" in expected:
        msgs = actual.get("commit_messages") or {}
        head = actual.get("head")
        msg = msgs.get(head, "")
        needle = expected["head_message_contains"]
        if needle not in msg:
            mismatches.append(f"HEAD commit message should contain `{needle}`")

    if "commit_count_min" in expected:
        count = len(actual.get("commit_messages") or {})
        if count < int(expected["commit_count_min"]):
            mismatches.append(
                f"Expected at least {expected['commit_count_min']} commits, found {count}"
            )

    return mismatches


def evaluate_command(
    initial_state: Dict[str, Any],
    command: str,
    expected_state: Dict[str, Any],
    accepted_solutions: Optional[List[str]] = None,
    explanation: str = "",
    hints: Optional[List[str]] = None,
    hint_index: int = 0,
) -> Dict[str, Any]:
    """Run command from initial state and evaluate against expected_state."""
    state = state_from_dict(initial_state)
    result: CommandResult = execute_command(state, command)

    if not result.ok:
        return {
            "correct": False,
            "result": result.error or "Command failed",
            "output": result.error or "",
            "state": result.state.public_view(),
            "state_changes": [],
            "feedback": (
                f"The command could not be executed: {result.error}\n\n"
                "Check spelling, flags, and that paths/branch names exist in this scenario."
            ),
            "explanation": None,
            "next_hint": _next_hint(hints, hint_index),
            "concept_tip": "Git rejects invalid commands before changing repository state.",
        }

    actual = result.state.comparable_snapshot()
    # Merge flexible expected keys onto a comparable baseline
    expected_cmp = _normalize_expected(expected_state, actual)
    mismatches = compare_states(actual, expected_cmp)

    # Fallback: accept exact accepted_solutions (normalized whitespace)
    if mismatches and accepted_solutions:
        normalized = " ".join(command.split())
        for sol in accepted_solutions:
            if " ".join(sol.split()) == normalized:
                mismatches = []
                break

    if not mismatches:
        return {
            "correct": True,
            "result": "Correct",
            "output": result.output,
            "state": result.state.public_view(),
            "state_changes": _diff_summary(state_from_dict(initial_state), result.state),
            "feedback": "Nice work — the repository is in the expected state.",
            "explanation": explanation or None,
            "next_hint": None,
            "concept_tip": None,
        }

    return {
        "correct": False,
        "result": "Incorrect",
        "output": result.output,
        "state": result.state.public_view(),
        "state_changes": _diff_summary(state_from_dict(initial_state), result.state),
        "feedback": _incorrect_feedback(command, result.output, mismatches),
        "explanation": None,
        "next_hint": _next_hint(hints, hint_index),
        "concept_tip": "Compare the staging area, working tree, and branch tip after your command.",
    }


def _normalize_expected(expected: Dict[str, Any], actual: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(expected)
    # If expected omits head, don't compare head hash (unstable across seeds)
    if "head" not in expected:
        out.pop("head", None)
    # Soft branch tip matching: if expected branches use null tips, only check names
    if "branches" in expected:
        soft = {}
        for name, tip in expected["branches"].items():
            if tip in (None, "*", "any"):
                soft[name] = actual.get("branches", {}).get(name, tip)
            else:
                soft[name] = tip
        out["branches"] = soft
    return out


def _next_hint(hints: Optional[List[str]], hint_index: int) -> Optional[str]:
    if not hints:
        return None
    if hint_index < len(hints):
        return hints[hint_index]
    return None


def _diff_summary(before: GitState, after: GitState) -> List[str]:
    changes: List[str] = []
    b, a = before.comparable_snapshot(), after.comparable_snapshot()
    if b.get("current_branch") != a.get("current_branch"):
        changes.append(
            f"Branch: {b.get('current_branch')} → {a.get('current_branch')}"
        )
    if b.get("head") != a.get("head"):
        changes.append(f"HEAD: {b.get('head')} → {a.get('head')}")
    if b.get("staged") != a.get("staged"):
        changes.append("Staging area changed")
    if b.get("working_tree") != a.get("working_tree"):
        changes.append("Working tree changed")
    if b.get("untracked") != a.get("untracked"):
        changes.append("Untracked files changed")
    if b.get("branches") != a.get("branches"):
        changes.append("Branch list/tips changed")
    if b.get("stash_count") != a.get("stash_count"):
        changes.append("Stash changed")
    return changes


def _incorrect_feedback(command: str, output: str, mismatches: List[str]) -> str:
    parts = [
        f"Your command ran: `{command}`",
    ]
    if output:
        parts.append(f"Git reported:\n{output}")
    parts.append("But the repository state still doesn't match the task:")
    parts.extend(f"• {m}" for m in mismatches)
    parts.append(
        "Inspect the repository panel on the right, then adjust your command. "
        "Multiple valid approaches may exist — focus on the resulting state."
    )
    return "\n\n".join(parts)
