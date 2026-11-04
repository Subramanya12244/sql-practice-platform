"""Smoke test: provision a throwaway project from CSVs, query it, drop it.

Run with the backend virtualenv active:
    python scripts/smoke_project_upload.py
"""

from __future__ import annotations

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.session import AppSessionLocal  # noqa: E402
from app.services.project_service import ProjectService  # noqa: E402
from app.services.query_executor import QueryExecutor  # noqa: E402

PROJECT_NAME = "Smoke Test Sales"


def write_fixtures(root: Path) -> list[Path]:
    pd.DataFrame(
        {
            "customer_id": [1, 2, 3],
            "Company Name": ["Acme", "Globex", "Initech"],
            "signup_date": ["2021-01-05", "2021-06-14", "2022-03-02"],
            "is_active": ["true", "false", "true"],
        }
    ).to_csv(root / "customers.csv", index=False)

    pd.DataFrame(
        {
            "product_id": [100, 101],
            "product_name": ["Widget", "Gadget"],
            "unit_price": [9.99, 24.50],
        }
    ).to_csv(root / "products.csv", index=False)

    pd.DataFrame(
        {
            "order_id": [10, 11, 12, 13],
            "customer_id": [1, 1, 2, 3],
            "product_id": [100, 101, 100, 101],
            "quantity": [2, 1, 5, 3],
            "order_date": ["2022-01-01", "2022-01-15", "2022-02-01", "2022-03-09"],
        }
    ).to_csv(root / "orders.csv", index=False)

    return sorted(root.glob("*.csv"))


async def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="sqlp-smoke-"))
    files = write_fixtures(tmp)
    failures: list[str] = []
    project_id = None

    async with AppSessionLocal() as session:
        service = ProjectService(session)
        existing = await service.get_project_by_slug("smoke_test_sales")
        if existing:
            await service.delete_project(existing.id)
            await session.commit()

        try:
            result = await service.create_from_upload(
                name=PROJECT_NAME,
                description="Temporary fixture project.",
                saved_files=files,
            )
            await session.commit()
            project = result["project"]
            project_id = project.id

            print(f"database      : {project.database_name}")
            print(f"tables        : {project.table_count}")
            print(f"rows imported : {project.row_count}")
            for table in result["tables"]:
                pk = table["primary_key"] or "-"
                fks = [
                    f"{fk['column']}->{fk['references_table']}.{fk['references_column']}"
                    f" ({fk['confidence']})"
                    for fk in table["foreign_keys"]
                ]
                print(
                    f"  {table['table_name']:<12} rows={table['imported_rows']:<4}"
                    f" pk={pk} fk={fks or '-'} match={table['row_count_matches']}"
                )
            if result["warnings"]:
                print("warnings:", result["warnings"])

            if project.table_count != 3:
                failures.append(f"expected 3 tables, got {project.table_count}")
            if project.row_count != 9:
                failures.append(f"expected 9 rows, got {project.row_count}")

            fk_pairs = {
                (t["table_name"], fk["references_table"])
                for t in result["tables"]
                for fk in t["foreign_keys"]
            }
            for expected in [("orders", "customers"), ("orders", "products")]:
                if expected not in fk_pairs:
                    failures.append(f"missing foreign key {expected}")

            # The editor path: read-only role querying the new database.
            url = service.readonly_url(project.database_name)
            query = await QueryExecutor(url).execute(
                "SELECT c.company_name, SUM(o.quantity) AS units "
                "FROM customers c JOIN orders o ON o.customer_id = c.customer_id "
                "GROUP BY c.company_name ORDER BY units DESC"
            )
            print(f"\nread-only query success={query.success} rows={query.row_count}")
            if query.success:
                print("  columns:", query.columns)
                for row in query.rows:
                    print("  ", row)
            else:
                failures.append(f"read-only query failed: {query.message}")

            write = await QueryExecutor(url).execute("DROP TABLE customers")
            print(f"write blocked : {not write.success} ({write.error_type})")
            if write.success:
                failures.append("DROP TABLE was not blocked")

        finally:
            if project_id is not None:
                await service.delete_project(project_id)
                await session.commit()
                print("\ncleaned up throwaway project and database")
            shutil.rmtree(tmp, ignore_errors=True)
            root = service.projects_root() / "smoke_test_sales"
            shutil.rmtree(root, ignore_errors=True)

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(" -", f)
        return 1
    print("\nall smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
