/** Guided data-quality exercises. See guided.ts for how they are validated. */
import type { GuidedExercise } from "./guided";

export const DQ_SETUP = String.raw`CREATE TABLE raw_customers (customer_id integer, name text, email text, country text, signup_date text);
INSERT INTO raw_customers VALUES
 (1,'Asha Rao','asha@example.com','IN','2026-01-05'),
 (2,'Ben Cole',NULL,'US','2026-01-06'),
 (3,'Chen Wei','chen@example','CN','2026-13-45'),
 (4,'  ',NULL,'USA','2026-02-01'),
 (5,'Dana Fox','dana@example.com','United States','not a date'),
 (6,'Eli Park','eli@example.com','IN','2026-02-10'),
 (6,'Eli Park','eli@example.com','IN','2026-02-10'),
 (7,'Faye Kim','faye@example.com',NULL,'2026-03-01'),
 (7,'Faye K.','faye@example.com','KR','2026-03-02');
CREATE TABLE raw_orders (order_id integer, customer_id integer, amount numeric, status text, order_date date);
INSERT INTO raw_orders VALUES
 (1,1,120.50,'shipped','2026-01-10'),
 (2,2,-15.00,'shipped','2026-01-11'),
 (3,1,99999.00,'Shipped','2026-01-12'),
 (4,6,42.00,'PENDING ','2026-01-13'),
 (5,999,30.00,'cancelled','2026-01-14'),
 (6,7,0,'shipped','2026-01-15'),
 (7,3,18.25,'Cancelled','2026-01-16');`;

const TABLES = ["raw_customers(customer_id, name, email, country, signup_date as text)", "raw_orders(order_id, customer_id, amount, status, order_date)"];
const sqlTask = (id: string, title: string, instructions: string, check: string, solution: string, starter: string) =>
  ({ id, title, type: "sql" as const, instructions, starter, solution, check });
const ids = (table: string, expected: number[], what: string) =>
  `SELECT COALESCE((SELECT array_agg(DISTINCT customer_id ORDER BY customer_id) FROM ${table}), ARRAY[]::integer[]) = ARRAY[${expected.join(",")}] AS ok, '${what}' AS message`;
const oids = (table: string, expected: number[], what: string) => ids(table, expected, what).replace(/customer_id/g, "order_id");

const base = { inputs: TABLES, setup: DQ_SETUP };

export const DQ_EXERCISES: GuidedExercise[] = [
  {
    ...base, id: "dq-incomplete", title: "Find incomplete customers", level: "Beginner", dimension: "Completeness",
    context: "Marketing wants to email every customer, but some records have no email or a blank name.",
    requirements: ["Create a table incomplete_customers with one column, customer_id.", "Include each customer whose email is missing (NULL) or whose name is blank."],
    expected: "A table of customer ids, each listed once.", constraints: ["Do not change raw_customers."], criteria: ["The set of ids matches exactly: nothing missing, nothing extra."],
    explanation: "Completeness asks whether the values you need are present. A blank string ('  ') looks filled in but carries no information, so check trim(name) as well as IS NULL. DISTINCT keeps a customer listed once even if several rows are incomplete.",
    hints: ["NULL needs IS NULL, not = NULL.", "trim(name) = '' catches names that are only spaces."],
    task: sqlTask("dq-incomplete", "Find incomplete customers", "Create incomplete_customers(customer_id).", ids("incomplete_customers", [2, 4], "Expected customers 2 and 4 (email missing, or name blank)."),
      "CREATE TABLE incomplete_customers AS SELECT DISTINCT customer_id FROM raw_customers WHERE email IS NULL OR trim(name) = '';", "-- Create incomplete_customers here\n"),
  },
  {
    ...base, id: "dq-fill-country", title: "Fill in missing countries", level: "Beginner", dimension: "Completeness",
    context: "A report groups customers by country, and rows with no country disappear from it.",
    requirements: ["Create customers_filled(customer_id, country) with every customer row.", "Replace a missing country with the text 'UNKNOWN'."],
    expected: "All 9 rows, with no NULL country.", constraints: ["Keep every row, including repeats; deduplication is a different exercise."], criteria: ["9 rows", "no NULL country", "exactly one 'UNKNOWN'"],
    explanation: "Filling a gap with an explicit marker keeps the row and makes the gap visible instead of silent. COALESCE(country, 'UNKNOWN') does it in one expression. Never invent a plausible value: 'UNKNOWN' is honest, a guessed country is not.",
    hints: ["COALESCE returns its first non-NULL argument."],
    profile: { before: { table: "raw_customers", columns: ["customer_id", "country"] }, after: { table: "customers_filled", columns: ["customer_id", "country"] } },
    task: sqlTask("dq-fill-country", "Fill in missing countries", "Create customers_filled.", "SELECT (SELECT COUNT(*) FROM customers_filled) = 9 AND (SELECT COUNT(*) FROM customers_filled WHERE country IS NULL) = 0 AND (SELECT COUNT(*) FROM customers_filled WHERE country = 'UNKNOWN') = 1 AS ok, 'Expected 9 rows, no NULL country, and exactly one UNKNOWN.' AS message",
      "CREATE TABLE customers_filled AS SELECT customer_id, COALESCE(country, 'UNKNOWN') AS country FROM raw_customers;", "-- Create customers_filled here\n"),
  },
  {
    ...base, id: "dq-suspect-orders", title: "Flag impossible order amounts", level: "Beginner", dimension: "Accuracy",
    context: "Finance noticed totals that look wrong. Business rule: an order amount must be above 0 and at most 10,000.",
    requirements: ["Create suspect_orders(order_id) listing every order that breaks the rule."],
    expected: "The ids of orders with an amount of 0 or less, or above 10,000.", constraints: ["Do not delete anything from raw_orders; only report."], criteria: ["Exact set of order ids"],
    explanation: "Accuracy checks values against what the business knows is possible. A negative amount, a zero and an amount of 99,999 are all valid numbers that are wrong. Flag them for review rather than deleting: someone must decide if it is a refund, a typo or fraud.",
    hints: ["Two conditions joined with OR."],
    task: sqlTask("dq-suspect-orders", "Flag impossible order amounts", "Create suspect_orders(order_id).", oids("suspect_orders", [2, 3, 6], "Expected orders 2, 3 and 6 (amount <= 0 or > 10000)."),
      "CREATE TABLE suspect_orders AS SELECT order_id FROM raw_orders WHERE amount <= 0 OR amount > 10000;", "-- Create suspect_orders here\n"),
  },
  {
    ...base, id: "dq-fix-dates", title: "Convert text dates safely", level: "Intermediate", dimension: "Accuracy",
    context: "signup_date was loaded as text. Some values are not real dates ('2026-13-45', 'not a date'), and casting them directly would crash the load.",
    requirements: ["Create clean_dates(customer_id, signup_date) with a real date column.", "Valid ISO dates (YYYY-MM-DD) become dates; anything else becomes NULL."],
    expected: "9 rows; two dates are NULL (customers 3 and 5).", constraints: ["The cast must not fail on bad values."], criteria: ["9 rows", "exactly 2 NULL dates", "good dates are kept"],
    explanation: "Casting text to a date fails on the first bad value and aborts the whole load. Test the shape first with a regular expression that also limits month and day, cast only when it matches, and let the rest become NULL so they can be reported and fixed at the source.",
    hints: ["CASE WHEN col ~ 'pattern' THEN col::date END", "Limit the month to 01-12 and the day to 01-31 in the pattern."],
    task: sqlTask("dq-fix-dates", "Convert text dates safely", "Create clean_dates.", "SELECT (SELECT COUNT(*) FROM clean_dates) = 9 AND (SELECT COUNT(*) FROM clean_dates WHERE signup_date IS NULL) = 2 AND (SELECT MIN(signup_date) FROM clean_dates) = DATE '2026-01-05' AS ok, 'Expected 9 rows, 2 NULL dates, earliest date 2026-01-05.' AS message",
      String.raw`CREATE TABLE clean_dates AS SELECT customer_id, CASE WHEN signup_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' THEN signup_date::date END AS signup_date FROM raw_customers;`, "-- Create clean_dates here\n"),
  },
  {
    ...base, id: "dq-std-country", title: "Standardize country codes", level: "Intermediate", dimension: "Consistency",
    context: "The same country is written three ways: 'US', 'USA' and 'United States'. Reports split them into separate groups.",
    requirements: ["Create std_countries(customer_id, country) with every row.", "Write the United States as 'US' everywhere; leave other codes and NULLs as they are."],
    expected: "9 rows. The distinct non-NULL countries are CN, IN, KR, US.", constraints: ["Do not invent countries for NULLs."], criteria: ["9 rows", "distinct countries are exactly CN, IN, KR, US"],
    explanation: "Consistency means the same fact is written the same way everywhere. A mapping (CASE or a lookup table) collapses variants into one canonical value. Keep NULL as NULL: standardizing is not the same as filling gaps.",
    hints: ["CASE WHEN country IN ('USA','United States') THEN 'US' ELSE country END"],
    profile: { before: { table: "raw_customers", columns: ["customer_id", "country"] }, after: { table: "std_countries", columns: ["customer_id", "country"] } },
    task: sqlTask("dq-std-country", "Standardize country codes", "Create std_countries.", "SELECT (SELECT COUNT(*) FROM std_countries) = 9 AND (SELECT array_agg(DISTINCT country ORDER BY country) FROM std_countries WHERE country IS NOT NULL) = ARRAY['CN','IN','KR','US'] AS ok, 'Expected 9 rows and the distinct countries CN, IN, KR, US.' AS message",
      "CREATE TABLE std_countries AS SELECT customer_id, CASE WHEN country IN ('USA','United States') THEN 'US' ELSE country END AS country FROM raw_customers;", "-- Create std_countries here\n"),
  },
  {
    ...base, id: "dq-std-status", title: "Standardize order status", level: "Beginner", dimension: "Consistency",
    context: "Statuses arrive as 'Shipped', 'SHIPPED', 'PENDING ' (with a trailing space) and 'cancelled'.",
    requirements: ["Create std_status(order_id, status) for every order.", "Lowercase the status and trim spaces."],
    expected: "7 rows and exactly three distinct statuses: cancelled, pending, shipped.", constraints: ["Do not change raw_orders."], criteria: ["7 rows", "three distinct statuses"],
    explanation: "Trailing spaces and case differences make equal values look different, which breaks GROUP BY, joins and filters. Normalizing with lower(trim(...)) is the cheapest consistency fix and is safe to apply to any free-text category.",
    hints: ["lower() and trim() can be combined."],
    task: sqlTask("dq-std-status", "Standardize order status", "Create std_status.", "SELECT (SELECT COUNT(*) FROM std_status) = 7 AND (SELECT array_agg(DISTINCT status ORDER BY status) FROM std_status) = ARRAY['cancelled','pending','shipped'] AS ok, 'Expected 7 rows with statuses cancelled, pending, shipped.' AS message",
      "CREATE TABLE std_status AS SELECT order_id, lower(trim(status)) AS status FROM raw_orders;", "-- Create std_status here\n"),
  },
  {
    ...base, id: "dq-find-dups", title: "Find duplicate customers", level: "Beginner", dimension: "Uniqueness",
    context: "customer_id should identify one customer, but some ids appear on more than one row.",
    requirements: ["Create dup_customers(customer_id) listing each id that appears more than once, once."],
    expected: "The ids 6 and 7.", constraints: ["Use grouping, not a manual list."], criteria: ["Exact set of duplicate ids"],
    explanation: "GROUP BY the key and keep groups with HAVING COUNT(*) > 1. Note the two kinds of duplicate here: id 6 is an exact repeat, while id 7 appears twice with different details. The second kind needs a decision about which row wins.",
    hints: ["GROUP BY customer_id HAVING COUNT(*) > 1"],
    task: sqlTask("dq-find-dups", "Find duplicate customers", "Create dup_customers.", ids("dup_customers", [6, 7], "Expected ids 6 and 7."),
      "CREATE TABLE dup_customers AS SELECT customer_id FROM raw_customers GROUP BY customer_id HAVING COUNT(*) > 1;", "-- Create dup_customers here\n"),
  },
  {
    ...base, id: "dq-dedupe", title: "Keep one row per customer", level: "Intermediate", dimension: "Uniqueness",
    context: "Customer 7 appears twice with different details. The earlier signup is the real record.",
    requirements: ["Create unique_customers with all five columns and exactly one row per customer_id.", "When an id repeats, keep the row with the earliest signup_date."],
    expected: "7 rows. Customer 7 is 'Faye Kim'.", constraints: ["Keep all original columns."], criteria: ["7 rows", "customer 7 is the earlier row"],
    explanation: "DISTINCT ON (key) with an ORDER BY keeps the first row for each key in that order, so the ORDER BY states your rule for which duplicate wins. ROW_NUMBER() OVER (PARTITION BY key ORDER BY ...) = 1 does the same and works in every database.",
    hints: ["DISTINCT ON (customer_id) ... ORDER BY customer_id, signup_date"],
    profile: { before: { table: "raw_customers", columns: ["customer_id", "name", "email", "country", "signup_date"] }, after: { table: "unique_customers", columns: ["customer_id", "name", "email", "country", "signup_date"] } },
    task: sqlTask("dq-dedupe", "Keep one row per customer", "Create unique_customers.", "SELECT (SELECT COUNT(*) FROM unique_customers) = 7 AND (SELECT COUNT(DISTINCT customer_id) FROM unique_customers) = 7 AND (SELECT name FROM unique_customers WHERE customer_id = 7) = 'Faye Kim' AS ok, 'Expected 7 rows, one per id, and customer 7 should be Faye Kim.' AS message",
      "CREATE TABLE unique_customers AS SELECT DISTINCT ON (customer_id) * FROM raw_customers ORDER BY customer_id, signup_date;", "-- Create unique_customers here\n"),
  },
  {
    ...base, id: "dq-bad-emails", title: "Find invalid emails", level: "Beginner", dimension: "Validity",
    context: "Bounce rates are high. A valid email has text, an @, text, a dot and text, with no spaces.",
    requirements: ["Create bad_emails(customer_id) for customers who have an email that does not match that shape.", "Missing emails are a completeness problem, so leave them out."],
    expected: "The single id 3.", constraints: ["Use a pattern match."], criteria: ["Exact set of ids"],
    explanation: "Validity checks that a value has the right form. A regular expression is a cheap first filter; it cannot prove an address exists, only that it is well formed. Skip NULLs here: a missing email is incomplete, not invalid.",
    hints: [String.raw`email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'`],
    task: sqlTask("dq-bad-emails", "Find invalid emails", "Create bad_emails.", ids("bad_emails", [3], "Expected only customer 3 (chen@example has no dot after the at sign)."),
      String.raw`CREATE TABLE bad_emails AS SELECT customer_id FROM raw_customers WHERE email IS NOT NULL AND email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';`, "-- Create bad_emails here\n"),
  },
  {
    ...base, id: "dq-orphans", title: "Find orders with no customer", level: "Beginner", dimension: "Validity",
    context: "Every order must belong to a customer that exists. Some orders point at customers that are not in the customer list.",
    requirements: ["Create orphan_orders(order_id) for orders whose customer_id is not in raw_customers."],
    expected: "The single order 5 (customer 999).", constraints: ["Use NOT EXISTS or a LEFT JOIN, not NOT IN."], criteria: ["Exact set of order ids"],
    explanation: "This is referential integrity: a foreign key must point at a real row. NOT EXISTS is the safe way to ask 'has no match'; NOT IN returns nothing at all if the subquery contains a NULL.",
    hints: ["LEFT JOIN raw_customers c ON ... WHERE c.customer_id IS NULL"],
    task: sqlTask("dq-orphans", "Find orders with no customer", "Create orphan_orders.", oids("orphan_orders", [5], "Expected only order 5 (customer 999 does not exist)."),
      "CREATE TABLE orphan_orders AS SELECT o.order_id FROM raw_orders o WHERE NOT EXISTS (SELECT 1 FROM raw_customers c WHERE c.customer_id = o.customer_id);", "-- Create orphan_orders here\n"),
  },
  {
    id: "dq-py-null-counts", title: "Count missing values in Python", level: "Beginner", dimension: "Completeness",
    context: "You receive records as a list of dictionaries and need to know how many values are missing in each field before loading them.",
    requirements: ["Write null_counts(rows) returning a dict {field: how many rows have None or a blank/space-only string for it}."],
    inputs: ["rows: a list of dictionaries with the same keys"], expected: "One entry per field, counting missing values.", constraints: ["Standard library only.", "An empty list returns {}."], criteria: ["Visible and hidden tests pass"],
    explanation: "Profiling comes before cleaning: count what is wrong before you decide how to fix it. A value counts as missing when it is None or only whitespace; 0 and False are real values and must not be counted.",
    hints: ["Treat 0 as present: test `is None` and, for strings, `.strip() == ''`."], setup: "",
    task: {
      id: "dq-py-null-counts", title: "Count missing values in Python", type: "python", instructions: "Write null_counts(rows).",
      starter: "def null_counts(rows):\n    raise NotImplementedError\n",
      solution: "def null_counts(rows):\n    out = {}\n    for r in rows:\n        for k, v in r.items():\n            out.setdefault(k, 0)\n            if v is None or (isinstance(v, str) and v.strip() == ''):\n                out[k] += 1\n    return out\n",
      tests: "assert null_counts([]) == {}\nassert null_counts([{'a': 1, 'b': None}, {'a': '', 'b': 2}]) == {'a': 1, 'b': 1}\nassert null_counts([{'a': 0, 'b': False}]) == {'a': 0, 'b': 0}",
      hidden: "assert null_counts([{'a': '  '}, {'a': None}, {'a': 'x'}]) == {'a': 2}\nassert null_counts([{'a': 1}, {'a': 2}]) == {'a': 0}",
    },
  },
  {
    id: "dq-py-dedupe", title: "Remove duplicate records in Python", level: "Intermediate", dimension: "Uniqueness",
    context: "Records arrive from two exports with overlapping rows. The first occurrence of each key is the one to keep.",
    requirements: ["Write dedupe(rows, key) returning a new list with the first row for each value of row[key], in the original order."],
    inputs: ["rows: a list of dictionaries", "key: the field that identifies a record"], expected: "No repeated key; the input list is not changed.", constraints: ["Standard library only.", "Do not modify the input list."], criteria: ["Visible and hidden tests pass"],
    explanation: "A set of seen keys gives an O(n) pass that keeps order. Sorting first would be slower and would lose the 'first occurrence' meaning. Returning a new list keeps callers safe from surprise changes.",
    hints: ["Keep a set of keys you have already seen."], setup: "",
    task: {
      id: "dq-py-dedupe", title: "Remove duplicate records in Python", type: "python", instructions: "Write dedupe(rows, key).",
      starter: "def dedupe(rows, key):\n    raise NotImplementedError\n",
      solution: "def dedupe(rows, key):\n    seen = set()\n    out = []\n    for r in rows:\n        k = r[key]\n        if k not in seen:\n            seen.add(k)\n            out.append(r)\n    return out\n",
      tests: "rows = [{'id': 1, 'v': 'a'}, {'id': 2, 'v': 'b'}, {'id': 1, 'v': 'c'}]\nassert dedupe(rows, 'id') == [{'id': 1, 'v': 'a'}, {'id': 2, 'v': 'b'}]\nassert len(rows) == 3\nassert dedupe([], 'id') == []",
      hidden: "assert dedupe([{'k': 'x'}, {'k': 'x'}, {'k': 'x'}], 'k') == [{'k': 'x'}]\nassert [r['k'] for r in dedupe([{'k': 3}, {'k': 1}, {'k': 3}, {'k': 2}], 'k')] == [3, 1, 2]",
    },
  },
];
