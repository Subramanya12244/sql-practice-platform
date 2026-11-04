import { describe, expect, it } from "vitest";
import { formatStandardSql } from "../utils/formatSql";

describe("formatStandardSql", () => {
  it("formats UNION queries in river style", () => {
    const input =
      "SELECT c.city, c.country FROM customers c UNION SELECT s.city, s.country FROM suppliers s UNION SELECT e.city, e.country FROM employees e;";
    expect(formatStandardSql(input)).toBe(
      [
        "SELECT c.city,",
        "       c.country",
        "FROM customers c",
        "",
        "UNION",
        "",
        "SELECT s.city,",
        "       s.country",
        "FROM suppliers s",
        "",
        "UNION",
        "",
        "SELECT e.city,",
        "       e.country",
        "FROM employees e;",
      ].join("\n"),
    );
  });

  it("keeps JOIN clauses readable", () => {
    const out = formatStandardSql(
      "select o.order_id, c.company_name from orders o join customers c on c.customer_id = o.customer_id where o.freight > 100;",
    );
    expect(out).toContain("SELECT o.order_id,");
    expect(out).toContain("       c.company_name");
    expect(out).toContain("FROM orders o");
    expect(out).toContain("JOIN customers c");
  });
});
