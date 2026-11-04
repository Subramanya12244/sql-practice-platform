"""Backend tests — validation, comparison, API smoke tests."""

from __future__ import annotations

from app.utils.difficulty import map_legacy_difficulty, next_difficulty, previous_difficulty
from app.utils.result_compare import compare_results
from app.utils.sql_validator import validate_sql


class TestSqlValidator:
    def test_allows_select(self):
        r = validate_sql("SELECT * FROM customers")
        assert r.ok

    def test_allows_with_cte(self):
        r = validate_sql("WITH c AS (SELECT 1 AS x) SELECT * FROM c")
        assert r.ok

    def test_allows_union(self):
        r = validate_sql("SELECT country FROM customers UNION SELECT country FROM suppliers")
        assert r.ok

    def test_rejects_drop(self):
        r = validate_sql("DROP TABLE customers")
        assert not r.ok
        assert r.error_type == "FORBIDDEN"

    def test_rejects_insert(self):
        r = validate_sql("INSERT INTO customers (customer_id, company_name) VALUES ('X', 'Y')")
        assert not r.ok

    def test_rejects_delete(self):
        r = validate_sql("DELETE FROM customers")
        assert not r.ok

    def test_rejects_update(self):
        r = validate_sql("UPDATE customers SET country = 'X'")
        assert not r.ok

    def test_rejects_multiple_statements(self):
        r = validate_sql("SELECT 1; DROP TABLE customers;")
        assert not r.ok
        assert "Multiple" in (r.error or "")

    def test_rejects_truncate(self):
        r = validate_sql("TRUNCATE customers")
        assert not r.ok

    def test_rejects_empty(self):
        r = validate_sql("   ")
        assert not r.ok


class TestResultCompare:
    def test_exact_match_ordered(self):
        r = compare_results(
            ["country", "cnt"],
            [["USA", 10], ["UK", 5]],
            ["country", "cnt"],
            [["USA", 10], ["UK", 5]],
            sort_required=True,
        )
        assert r.match

    def test_order_independent(self):
        r = compare_results(
            ["a"],
            [[2], [1]],
            ["a"],
            [[1], [2]],
            sort_required=False,
        )
        assert r.match

    def test_order_required_fails_on_shuffle(self):
        r = compare_results(
            ["a"],
            [[2], [1]],
            ["a"],
            [[1], [2]],
            sort_required=True,
        )
        assert not r.match

    def test_row_count_mismatch(self):
        r = compare_results(["a"], [[1], [2]], ["a"], [[1]], sort_required=False)
        assert not r.match
        assert r.your_row_count == 2
        assert r.expected_row_count == 1

    def test_column_mismatch(self):
        r = compare_results(["a"], [[1]], ["b"], [[1]], sort_required=False)
        assert not r.match

    def test_null_handling(self):
        r = compare_results(
            ["a"],
            [[None], [1]],
            ["a"],
            [[1], [None]],
            sort_required=False,
        )
        assert r.match

    def test_decimal_normalization(self):
        from decimal import Decimal

        r = compare_results(
            ["price"],
            [[Decimal("10.50")]],
            ["price"],
            [[10.5]],
            sort_required=False,
        )
        assert r.match


class TestDifficulty:
    def test_progression(self):
        assert next_difficulty("Advanced") == "Senior"
        assert previous_difficulty("Senior") == "Advanced"
        assert next_difficulty("Expert") == "Expert"

    def test_legacy_map(self):
        assert map_legacy_difficulty("Medium") == "Intermediate"
        assert map_legacy_difficulty("Hard") == "Advanced"
