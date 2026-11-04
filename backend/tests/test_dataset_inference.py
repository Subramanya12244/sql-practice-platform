"""Tests for schema inference from uploaded dataset files."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from app.services.dataset_inference import (
    analyze_files,
    generate_create_table,
    generate_er_diagram,
    generate_schema_sql,
    infer_column,
    sanitize_identifier,
)


@pytest.fixture
def dataset(tmp_path: Path) -> Path:
    customers = pd.DataFrame(
        {
            "customer_id": [1, 2, 3],
            "Company Name": ["Acme", "Globex", "Initech"],
            "signup_date": ["2021-01-05", "2021-06-14", "2022-03-02"],
            "is_active": ["true", "false", "true"],
        }
    )
    orders = pd.DataFrame(
        {
            "order_id": [10, 11, 12, 13],
            "customer_id": [1, 1, 2, 3],
            "total_amount": [10.5, 22.25, 3.0, 99.99],
            "notes": [None, "rush", None, None],
        }
    )
    customers.to_csv(tmp_path / "customers.csv", index=False)
    orders.to_csv(tmp_path / "orders.csv", index=False)
    return tmp_path


class TestSanitizeIdentifier:
    def test_lowercases_and_underscores(self):
        assert sanitize_identifier("Company Name") == "company_name"

    def test_strips_special_characters(self):
        assert sanitize_identifier("Total ($)") == "total"

    def test_prefixes_leading_digit(self):
        assert sanitize_identifier("2021 Sales", fallback="col").startswith("col_")

    def test_avoids_reserved_words(self):
        assert sanitize_identifier("order") == "order_col"

    def test_empty_falls_back(self):
        assert sanitize_identifier("!!!", fallback="col") == "col"


class TestInferColumn:
    def test_integer_column(self):
        spec = infer_column("customer_id", pd.Series([1, 2, 3]))
        assert spec.pg_type == "INTEGER"
        assert spec.nullable is False

    def test_bigint_for_large_values(self):
        spec = infer_column("big", pd.Series([5_000_000_000, 1]))
        assert spec.pg_type == "BIGINT"

    def test_numeric_for_decimals(self):
        spec = infer_column("amount", pd.Series([1.5, 2.25]))
        assert spec.pg_type == "NUMERIC"

    def test_numeric_strings_are_detected(self):
        spec = infer_column("amount", pd.Series(["1.5", "2.25", "3.75"]))
        assert spec.pg_type == "NUMERIC"
        assert spec.inferred_from == "numeric strings"

    def test_dates_become_timestamp(self):
        spec = infer_column("d", pd.Series(["2021-01-05", "2022-03-02"]))
        assert spec.pg_type == "TIMESTAMP"

    def test_boolean_like_strings(self):
        spec = infer_column("flag", pd.Series(["true", "false", "true"]))
        assert spec.pg_type == "BOOLEAN"

    def test_text_gets_varchar(self):
        spec = infer_column("name", pd.Series(["Acme", "Globex"]))
        assert spec.pg_type.startswith("VARCHAR")

    def test_long_text_gets_text(self):
        spec = infer_column("blob", pd.Series(["x" * 300]))
        assert spec.pg_type == "TEXT"

    def test_nulls_make_column_nullable(self):
        spec = infer_column("notes", pd.Series(["a", None]))
        assert spec.nullable is True
        assert spec.null_count == 1

    def test_original_name_preserved(self):
        spec = infer_column("Company Name", pd.Series(["Acme"]))
        assert spec.name == "company_name"
        assert spec.original_name == "Company Name"


class TestAnalyzeFiles:
    def test_reads_all_tables(self, dataset: Path):
        tables = analyze_files(sorted(dataset.glob("*.csv")))
        assert {t.table_name for t in tables} == {"customers", "orders"}

    def test_detects_primary_keys(self, dataset: Path):
        tables = {t.table_name: t for t in analyze_files(sorted(dataset.glob("*.csv")))}
        assert tables["customers"].primary_key == ["customer_id"]
        assert tables["orders"].primary_key == ["order_id"]

    def test_detects_foreign_key(self, dataset: Path):
        tables = {t.table_name: t for t in analyze_files(sorted(dataset.glob("*.csv")))}
        fks = tables["orders"].foreign_keys
        assert len(fks) == 1
        assert fks[0].column == "customer_id"
        assert fks[0].references_table == "customers"
        assert fks[0].confidence == "high"

    def test_does_not_self_reference(self, dataset: Path):
        tables = {t.table_name: t for t in analyze_files(sorted(dataset.glob("*.csv")))}
        assert tables["customers"].foreign_keys == []

    def test_row_counts(self, dataset: Path):
        tables = {t.table_name: t for t in analyze_files(sorted(dataset.glob("*.csv")))}
        assert tables["customers"].row_count == 3
        assert tables["orders"].row_count == 4

    def test_orphan_values_block_foreign_key(self, tmp_path: Path):
        pd.DataFrame({"customer_id": [1, 2]}).to_csv(
            tmp_path / "customers.csv", index=False
        )
        pd.DataFrame(
            {"order_id": [1, 2], "customer_id": [1, 99]}
        ).to_csv(tmp_path / "orders.csv", index=False)
        tables = {t.table_name: t for t in analyze_files(sorted(tmp_path.glob("*.csv")))}
        assert tables["orders"].foreign_keys == []

    def test_json_array_file(self, tmp_path: Path):
        (tmp_path / "people.json").write_text(
            json.dumps([{"person_id": 1, "name": "Ada"}, {"person_id": 2, "name": "Bob"}])
        )
        tables = analyze_files([tmp_path / "people.json"])
        assert tables[0].table_name == "people"
        assert tables[0].row_count == 2

    def test_json_object_of_tables(self, tmp_path: Path):
        (tmp_path / "db.json").write_text(
            json.dumps(
                {
                    "authors": [{"author_id": 1, "name": "Ada"}],
                    "books": [{"book_id": 1, "author_id": 1}],
                }
            )
        )
        tables = {t.table_name for t in analyze_files([tmp_path / "db.json"])}
        assert tables == {"authors", "books"}

    def test_duplicate_table_names_are_suffixed(self, tmp_path: Path):
        nested = tmp_path / "sub"
        nested.mkdir()
        pd.DataFrame({"a": [1]}).to_csv(tmp_path / "data.csv", index=False)
        pd.DataFrame({"a": [1]}).to_csv(nested / "data.csv", index=False)
        tables = analyze_files([tmp_path / "data.csv", nested / "data.csv"])
        assert [t.table_name for t in tables] == ["data", "data_2"]


class TestDdlGeneration:
    def test_create_table_has_primary_key(self, dataset: Path):
        tables = {t.table_name: t for t in analyze_files(sorted(dataset.glob("*.csv")))}
        ddl = generate_create_table(tables["customers"])
        assert 'CREATE TABLE "customers"' in ddl
        assert 'PRIMARY KEY ("customer_id")' in ddl

    def test_schema_sql_includes_foreign_key(self, dataset: Path):
        sql = generate_schema_sql(analyze_files(sorted(dataset.glob("*.csv"))))
        assert "ADD CONSTRAINT" in sql
        assert 'REFERENCES "customers"' in sql

    def test_er_diagram_is_mermaid(self, dataset: Path):
        diagram = generate_er_diagram(analyze_files(sorted(dataset.glob("*.csv"))))
        assert diagram.startswith("erDiagram")
        assert "customer_id PK" in diagram
        assert "customers ||--o{ orders" in diagram
