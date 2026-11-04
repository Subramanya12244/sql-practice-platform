"""Unit tests for the Git Practice Lab state simulator + evaluator."""

from __future__ import annotations

from app.services.git_lab.evaluator import evaluate_command
from app.services.git_lab.executor import execute_command
from app.services.git_lab.state import state_from_dict


BASE = {
    "repo_name": "demo",
    "current_branch": "main",
    "head": "a100001",
    "branches": {"main": "a100001"},
    "commits": [
        {
            "hash": "a100001",
            "message": "Initial commit",
            "parents": [],
            "tree": {
                "app.py": "print('hello')\n",
                "config.py": "DEBUG = False\n",
            },
        }
    ],
    "working_tree": [
        {"path": "app.py", "status": "M", "content": "print('hello')\nprint('world')\n"},
        {"path": "config.py", "status": "M", "content": "DEBUG = True\n"},
    ],
    "staged": [],
    "untracked": [],
}


def test_git_add_single_file():
    result = evaluate_command(
        BASE,
        "git add app.py",
        {
            "current_branch": "main",
            "staged": [{"path": "app.py", "status": "M"}],
            "working_tree": [{"path": "config.py", "status": "M"}],
            "untracked": [],
        },
        accepted_solutions=["git add app.py"],
    )
    assert result["correct"] is True


def test_rejects_shell_operators():
    state = state_from_dict(BASE)
    out = execute_command(state, "git status && rm -rf /")
    assert out.ok is False
    assert "Shell operators" in (out.error or "")


def test_restore_discards_one_file():
    initial = {
        "repo_name": "data-engineering-project",
        "current_branch": "feature/customer-analysis",
        "head": "d400001",
        "branches": {
            "main": "d400000",
            "feature/customer-analysis": "d400001",
        },
        "commits": [
            {
                "hash": "d400000",
                "message": "Base",
                "parents": [],
                "tree": {
                    "src/customer.py": "customers = []\n",
                    "src/orders.py": "orders = []\n",
                },
            },
            {
                "hash": "d400001",
                "message": "Add customer analysis",
                "parents": ["d400000"],
                "tree": {
                    "src/customer.py": "customers = []\n",
                    "src/orders.py": "orders = []\n",
                },
            },
        ],
        "working_tree": [
            {"path": "src/customer.py", "status": "M", "content": "customers = [1]\n"},
            {"path": "src/orders.py", "status": "M", "content": "orders = [1]\n"},
        ],
        "staged": [],
        "untracked": ["notes.txt"],
    }
    result = evaluate_command(
        initial,
        "git restore src/orders.py",
        {
            "current_branch": "feature/customer-analysis",
            "working_tree": [{"path": "src/customer.py", "status": "M"}],
            "staged": [],
            "untracked": ["notes.txt"],
        },
    )
    assert result["correct"] is True


def test_switch_create_branch():
    initial = {
        "current_branch": "main",
        "head": "f600001",
        "branches": {"main": "f600001"},
        "commits": [
            {
                "hash": "f600001",
                "message": "Init",
                "parents": [],
                "tree": {"README.md": "# Web\n"},
            }
        ],
        "working_tree": [],
        "staged": [],
        "untracked": [],
    }
    result = evaluate_command(
        initial,
        "git switch -c feature/login",
        {
            "current_branch": "feature/login",
            "branch_exists": ["feature/login", "main"],
            "working_tree": [],
            "staged": [],
        },
    )
    assert result["correct"] is True
