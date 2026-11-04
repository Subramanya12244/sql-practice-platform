"""Result-set comparison for answer evaluation.

Compares user query results against reference query results without
revealing the reference SQL.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional, Sequence, Tuple


@dataclass
class ComparisonResult:
    match: bool
    message: str
    feedback: List[str] = field(default_factory=list)
    your_row_count: int = 0
    expected_row_count: int = 0


def _normalize_value(value: Any) -> Any:
    """Normalize values for stable comparison."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, float):
        # Round to reduce floating-point noise
        return round(value, 6)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple)):
        return tuple(_normalize_value(v) for v in value)
    return value


def _normalize_row(row: Sequence[Any]) -> Tuple[Any, ...]:
    return tuple(_normalize_value(v) for v in row)


def _normalize_columns(columns: Sequence[str]) -> List[str]:
    return [c.strip().lower() for c in columns]


def compare_results(
    user_columns: Sequence[str],
    user_rows: Sequence[Sequence[Any]],
    expected_columns: Sequence[str],
    expected_rows: Sequence[Sequence[Any]],
    sort_required: bool = False,
) -> ComparisonResult:
    """Compare two result sets.

    When sort_required is False, comparison is order-independent
    (rows are sorted before comparison). Column order must still match
    by normalized name.
    """
    your_count = len(user_rows)
    expected_count = len(expected_rows)
    feedback: List[str] = []

    u_cols = _normalize_columns(user_columns)
    e_cols = _normalize_columns(expected_columns)

    if u_cols != e_cols:
        feedback.append("Check your column names and column order.")
        feedback.append(f"Your columns: {', '.join(user_columns) or '(none)'}")
        feedback.append(f"Expected columns: {', '.join(expected_columns)}")
        return ComparisonResult(
            match=False,
            message="Your query runs successfully, but the result does not match the expected result.",
            feedback=feedback,
            your_row_count=your_count,
            expected_row_count=expected_count,
        )

    if your_count != expected_count:
        feedback.append(f"Your query returned: {your_count} rows")
        feedback.append(f"Expected result: {expected_count} rows")
        feedback.append("Check:")
        feedback.append("• Your filtering conditions")
        feedback.append("• Your grouping logic")
        feedback.append("• Whether duplicate rows are being preserved")
        return ComparisonResult(
            match=False,
            message="Your query runs successfully, but the result does not match the expected result.",
            feedback=feedback,
            your_row_count=your_count,
            expected_row_count=expected_count,
        )

    norm_user = [_normalize_row(r) for r in user_rows]
    norm_expected = [_normalize_row(r) for r in expected_rows]

    if not sort_required:
        # Order-independent: sort both sets
        try:
            norm_user_sorted = sorted(norm_user)
            norm_expected_sorted = sorted(norm_expected)
        except TypeError:
            # Mixed types that can't sort — fall back to multiset via counters
            from collections import Counter

            if Counter(norm_user) != Counter(norm_expected):
                feedback.append("Row values do not match (order-independent comparison).")
                feedback.append("Check:")
                feedback.append("• Your filtering conditions")
                feedback.append("• Your joins and aggregations")
                feedback.append("• NULL handling and data types")
                return ComparisonResult(
                    match=False,
                    message="Your query runs successfully, but the result does not match the expected result.",
                    feedback=feedback,
                    your_row_count=your_count,
                    expected_row_count=expected_count,
                )
            return ComparisonResult(
                match=True,
                message="Correct! Your query produces the expected result.",
                your_row_count=your_count,
                expected_row_count=expected_count,
            )

        if norm_user_sorted != norm_expected_sorted:
            feedback.append("Row values do not match.")
            feedback.append("Check:")
            feedback.append("• Your filtering conditions")
            feedback.append("• Your grouping logic")
            feedback.append("• Whether duplicate rows are being preserved")
            return ComparisonResult(
                match=False,
                message="Your query runs successfully, but the result does not match the expected result.",
                feedback=feedback,
                your_row_count=your_count,
                expected_row_count=expected_count,
            )
    else:
        # Order matters
        if norm_user != norm_expected:
            feedback.append("Results differ — ordering may be required.")
            feedback.append("Check:")
            feedback.append("• Your ORDER BY clause")
            feedback.append("• Your filtering and grouping logic")
            feedback.append("• Column values and sort direction")
            return ComparisonResult(
                match=False,
                message="Your query runs successfully, but the result does not match the expected result.",
                feedback=feedback,
                your_row_count=your_count,
                expected_row_count=expected_count,
            )

    return ComparisonResult(
        match=True,
        message="Correct! Your query produces the expected result.",
        your_row_count=your_count,
        expected_row_count=expected_count,
    )
