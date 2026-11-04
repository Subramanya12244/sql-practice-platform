"""Difficulty progression helpers."""

from __future__ import annotations

DIFFICULTY_ORDER = [
    "Beginner",
    "Intermediate",
    "Advanced",
    "Senior",
    "Expert",
]

STREAK_TO_INCREASE = 3
FAILS_TO_DECREASE = 5


def next_difficulty(current: str) -> str:
    try:
        idx = DIFFICULTY_ORDER.index(current)
    except ValueError:
        return "Intermediate"
    if idx >= len(DIFFICULTY_ORDER) - 1:
        return DIFFICULTY_ORDER[-1]
    return DIFFICULTY_ORDER[idx + 1]


def previous_difficulty(current: str) -> str:
    try:
        idx = DIFFICULTY_ORDER.index(current)
    except ValueError:
        return "Beginner"
    if idx <= 0:
        return DIFFICULTY_ORDER[0]
    return DIFFICULTY_ORDER[idx - 1]


def map_legacy_difficulty(raw: str) -> str:
    """Map Medium/Hard/Easy style labels to platform levels."""
    mapping = {
        "easy": "Beginner",
        "beginner": "Beginner",
        "medium": "Intermediate",
        "intermediate": "Intermediate",
        "hard": "Advanced",
        "advanced": "Advanced",
        "senior": "Senior",
        "expert": "Expert",
    }
    return mapping.get(raw.strip().lower(), raw.strip().title() or "Intermediate")
