"""Markdown parser + import validation tests."""

from __future__ import annotations

from pathlib import Path

from app.services.git_lab.markdown_parser import parse_git_markdown


SAMPLE = """
# Module: Staging

## Exercise: 001

### Title
Stage a single file

### Type
command

### Difficulty
Easy

### Concepts
git add, staging area

### Scenario
Two files modified.

### Task
Stage only app.py.

### Expected Answer

git add app.py

### Explanation
Selective staging.

### Hint
Use git add with a path.
"""


def test_parse_basic_exercise():
    result = parse_git_markdown(SAMPLE, filename="test.md")
    assert result.raw_exercise_count == 1
    ex = result.exercises[0]
    assert ex.stable_id == "staging:001"
    assert ex.title == "Stage a single file"
    assert ex.exercise_type == "command"
    assert ex.difficulty == "Easy"
    assert "git add app.py" in ex.accepted_solutions
    assert not ex.errors


def test_parse_starter_bank_file():
    path = Path(__file__).resolve().parents[2] / "questions" / "git" / "starter_bank.md"
    # repo layout: backend/tests -> parents[2] is sql-practice-platform? 
    # __file__ = backend/tests/test_git_markdown.py
    # parents[0]=tests, [1]=backend, [2]=sql-practice-platform
    if not path.is_file():
        path = Path(__file__).resolve().parents[3] / "questions" / "git" / "starter_bank.md"
    assert path.is_file(), path
    text = path.read_text(encoding="utf-8")
    result = parse_git_markdown(text, filename="starter_bank.md")
    assert result.raw_exercise_count >= 20
    assert result.raw_module_count >= 8
    errored = [e for e in result.exercises if e.errors]
    assert len(errored) == 0, errored[0].errors if errored else None


def test_missing_task_is_error():
    bad = """
# Module: Commits

## Exercise: 009

### Title
Something

### Type
command

### Difficulty
Easy

### Expected Answer
git status
"""
    result = parse_git_markdown(bad)
    assert result.exercises[0].errors
    assert any("task" in e.lower() for e in result.exercises[0].errors)


def test_parse_data_engineering_bank_format():
    sample = """
## Module: Stash & Temporary Work

### Exercise: 107

**Title:** Temporarily save uncommitted work with stash.
**Type:** command
**Difficulty:** Easy
**Concepts:** stash

#### Scenario
You are working in a Git repository.

#### Task
Temporarily save uncommitted work with stash.

#### Expected Outcome
The repository should be in the state requested by the task, with no unintended files, branches, commits, or history changes.

#### Hint 1
Think about shelving local work.

#### Explanation
git stash shelves local modifications.
"""
    result = parse_git_markdown(sample)
    assert result.raw_exercise_count == 1
    ex = result.exercises[0]
    assert ex.module_slug == "stash"
    assert ex.title.startswith("Temporarily save")
    assert not ex.errors
    assert any("git stash" in s for s in ex.accepted_solutions)
