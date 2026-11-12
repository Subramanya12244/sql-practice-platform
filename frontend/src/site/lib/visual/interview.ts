/**
 * Interview Walkthrough content. A question bank for data analyst and data engineer interviews: each question has the prompt,
 * questions to ask the interviewer, hints that give the concept and never the answer, an approach outline, one example answer,
 * pitfalls, follow-up questions and a self-assessment rubric.
 *
 * Every code snippet carries the output it is claimed to produce (`expect`). The tests run every Python snippet with real
 * Python and every SQL snippet on PostgreSQL (PGlite, with the Northwind data), and compare. Nothing in the app runs them.
 */
export type Category = "sql" | "python" | "pandas" | "etl" | "stats" | "case" | "behavioural" | "git";
export type Level = "warm-up" | "core" | "stretch";
export type Cell = string | number | boolean | null;

export interface Snippet {
  lang: "sql" | "python";
  title: string;
  /** SQL only: statements that create the data the snippet works on (run first, rolled back afterwards). */
  setup?: string;
  code: string;
  /** Python: the exact stdout. SQL: the rows of the last statement. */
  expect: { stdout?: string; columns?: string[]; rows?: Cell[][] };
}

export interface FollowUp { q: string; hint: string; answer: string; snippet?: Snippet }

export interface Question {
  id: string;
  category: Category;
  level: Level;
  title: string;
  prompt: string;
  /** Minutes to allow for a first attempt. */
  minutes: number;
  clarify: string[];
  /** Revealed one at a time. The first names the concept; none gives the answer. */
  hints: string[];
  /** Words and names that define the answer. Hints must not contain them. */
  withheld: string[];
  approach: string[];
  answer: { text: string; snippets: Snippet[] };
  pitfalls: string[];
  followUps: FollowUp[];
  rubric: string[];
  link?: { to: string; label: string };
}

export const CATEGORY_LABEL: Record<Category, string> = {
  sql: "SQL", python: "Python", pandas: "pandas", etl: "ETL and data engineering", stats: "Statistics and A/B testing", case: "Analytics cases", behavioural: "Behavioural and portfolio", git: "Git",
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

const SQL_VIS = { to: "/query-visualizer", label: "SQL Query Cinema" };
const PY_VIS = { to: "/visual/python", label: "Python Code Time Machine" };
const DATA_VIS = { to: "/visual/data", label: "Pandas and NumPy Studio" };
const ETL_VIS = { to: "/visual/etl", label: "ETL Pipeline Playback" };
const STATS_VIS = { to: "/visual/stats", label: "Statistics Lab" };
const BIZ_VIS = { to: "/visual/business", label: "Business Analytics Lab" };
const GIT_VIS = { to: "/visual/git", label: "Git Lab" };

const sql = (title: string, code: string, columns: string[], rows: Cell[][], setup?: string): Snippet => ({ lang: "sql", title, code, setup, expect: { columns, rows } });
const py = (title: string, code: string, stdout: string): Snippet => ({ lang: "python", title, code, expect: { stdout } });

export const QUESTIONS: Question[] = [
  // ── SQL ────────────────────────────────────────────────────────────────
  {
    id: "sql-left-join-zero", category: "sql", level: "warm-up", minutes: 8,
    title: "Customers who never ordered",
    prompt: "Using customers and orders, list the customers that have placed no orders, together with their order count (which is 0).",
    clarify: ["What identifies a customer, and can one customer have many orders?", "Should a customer with orders only in a particular period count as having none?", "Do you want the count column shown, or only the customer ids?"],
    hints: [
      "Concept: an outer join keeps every row from one side even when the other side has no match; unmatched columns come back as NULL.",
      "Decide which table must keep all of its rows, and which one is allowed to be missing.",
      "Think about which counting form ignores NULL, so an unmatched row counts as nothing rather than as one.",
    ],
    withheld: ["LEFT JOIN", "COUNT(o.order_id)", "HAVING"],
    approach: ["Restate the grain: one row per customer.", "Keep all customers, attach orders where they exist.", "Count a column from the orders side so that unmatched rows count zero.", "Keep the customers whose count is zero.", "Check the result against the opposite question: customers with at least one order should be the rest."],
    answer: {
      text: "Start from customers, LEFT JOIN orders on the key, group by customer and count a column from orders. COUNT of an orders column ignores NULLs, so a customer with no orders gets 0. Filter those with HAVING. On Northwind two customers have never ordered.",
      snippets: [sql("Customers with no orders (Northwind)", "SELECT c.customer_id, COUNT(o.order_id) AS orders\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nGROUP BY c.customer_id\nHAVING COUNT(o.order_id) = 0\nORDER BY c.customer_id;", ["customer_id", "orders"], [["FISSA", 0], ["PARIS", 0]])],
    },
    pitfalls: ["Using an inner join: customers without orders disappear, so the result is empty.", "COUNT(*) after the join: an unmatched customer still produces one row, so the count is 1, not 0.", "Putting a condition on the orders table in WHERE after a LEFT JOIN, which turns it back into an inner join."],
    followUps: [
      { q: "Write it again without a join.", hint: "Ask whether a matching row exists, for each customer.", answer: "Use NOT EXISTS with a correlated subquery. It returns the same customers and handles NULLs safely.", snippet: sql("Anti-join with NOT EXISTS", "SELECT c.customer_id\nFROM customers c\nWHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)\nORDER BY c.customer_id;", ["customer_id"], [["FISSA"], ["PARIS"]]) },
      { q: "How would you find customers who ordered in 1997 but not in 1998?", hint: "Put each year's condition where it keeps the outer join outer.", answer: "Aggregate or filter per customer: customers having an order in 1997 and NOT EXISTS an order in 1998. If the date filter is in the join condition it keeps the outer join intact; if it is in WHERE it removes the unmatched rows." },
    ],
    rubric: ["I stated the grain before writing SQL.", "My query keeps customers with no orders.", "I counted a column from the orders table, not COUNT(*).", "I can name a second way to write it.", "I checked the result with a sanity query."],
    link: SQL_VIS,
  },
  {
    id: "sql-join-fanout", category: "sql", level: "core", minutes: 10,
    title: "Totals that are too big after a join",
    prompt: "A report sums order totals per day, and after someone joined the order-items table to add item counts the revenue tripled. Explain why and show a correct query.",
    clarify: ["What is the grain of the orders table, and of the items table?", "Which numbers live at order level and which at item level?", "Is it acceptable to show item counts and revenue in one result?"],
    hints: [
      "Concept: a join returns one row for every matching pair, so a value stored once per order is repeated once per item.",
      "Compare the number of rows before and after the join for a single order.",
      "Fix it by bringing both sides to the same grain before they meet, or by summing at the grain where the number lives.",
    ],
    withheld: ["fan-out", "fan out", "pre-aggregate", "subquery"],
    approach: ["State the grain of each table.", "Show the symptom on one order: three items means the total is added three times.", "Aggregate the many side (items) to one row per order first.", "Join that to orders and sum order totals.", "Reconcile: the sum must equal the sum on the orders table alone."],
    answer: {
      text: "The join repeats each order row once per item, so a SUM over the order total counts it once per item: orders with three items count three times. Fix it by summing order totals from the orders table, and bring item counts in through a subquery that is already one row per order. Always reconcile against the order-level total.",
      snippets: [
        sql("The symptom: 350 instead of 150", "WITH orders(order_id, total) AS (VALUES (1, 100), (2, 50)),\n     items(order_id, sku) AS (VALUES (1, 'a'), (1, 'b'), (1, 'c'), (2, 'a'))\nSELECT SUM(o.total) AS wrong_total,\n       (SELECT SUM(total) FROM orders) AS right_total\nFROM orders o JOIN items i ON i.order_id = o.order_id;", ["wrong_total", "right_total"], [[350, 150]]),
        sql("Correct: items counted first", "WITH orders(order_id, total) AS (VALUES (1, 100), (2, 50)),\n     items(order_id, sku) AS (VALUES (1, 'a'), (1, 'b'), (1, 'c'), (2, 'a')),\n     item_counts AS (SELECT order_id, COUNT(*) AS n FROM items GROUP BY order_id)\nSELECT SUM(o.total) AS revenue, SUM(c.n) AS items\nFROM orders o JOIN item_counts c ON c.order_id = o.order_id;", ["revenue", "items"], [[150, 4]]),
      ],
    },
    pitfalls: ["Fixing the symptom with SUM(DISTINCT total): two different orders with the same total collapse into one.", "Not checking the row count before and after a join.", "Assuming a key is unique without testing it."],
    followUps: [
      { q: "Why is SUM(DISTINCT total) wrong?", hint: "Think of two different orders that happen to have the same total.", answer: "DISTINCT removes equal values, not repeated rows of the same order. Two orders of 100 would count as one 100, so the result is too small instead of too big." },
      { q: "How do you stop this happening again in a team?", hint: "Make the grain visible and test it.", answer: "Document the grain of each table, add a uniqueness test on the key, and add a reconciliation check that compares the report total with the source total." },
    ],
    rubric: ["I named the grain of each table.", "I explained the repeated rows in one sentence.", "My fix gives 150.", "I proposed a reconciliation check.", "I rejected SUM(DISTINCT) and said why."],
    link: SQL_VIS,
  },
  {
    id: "sql-not-in-null", category: "sql", level: "core", minutes: 8,
    title: "NOT IN returns nothing",
    prompt: "A query for customers with no orders uses NOT IN (SELECT customer_id FROM orders) and returns zero rows although such customers exist. Why, and how do you fix it?",
    clarify: ["Can orders.customer_id be NULL in this table?", "What does the business want for customers whose order has no customer id?", "Which database are we on? (The three-valued logic is standard SQL.)"],
    hints: [
      "Concept: a comparison with NULL is neither true nor false but unknown, and a row is kept only when the condition is true.",
      "Rewrite the NOT IN list as a chain of 'not equal' comparisons and ask what one unknown does to the whole chain.",
      "Look for a form of the filter that asks whether a matching row exists instead of comparing values.",
    ],
    withheld: ["NOT EXISTS", "three-valued"],
    approach: ["Reproduce on three rows with one NULL.", "Expand x NOT IN (1, NULL) into x <> 1 AND x <> NULL.", "Observe that x <> NULL is unknown, so the AND can never be true.", "Fix with NOT EXISTS, or filter the NULLs out of the subquery.", "Say which you prefer and why."],
    answer: {
      text: "If the list contains a NULL, x NOT IN (list) can never be true: for a value not in the list the comparison with the NULL is unknown, and unknown rows are filtered out. NOT EXISTS asks whether a matching row exists, so NULLs in the subquery do not matter. Prefer NOT EXISTS (or a LEFT JOIN with an IS NULL test).",
      snippets: [sql("NOT IN versus NOT EXISTS", "WITH customers(id) AS (VALUES (1), (2), (3)),\n     orders(customer_id) AS (VALUES (1), (NULL::int))\nSELECT\n  (SELECT COUNT(*) FROM customers WHERE id NOT IN (SELECT customer_id FROM orders)) AS not_in,\n  (SELECT COUNT(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)) AS not_exists;", ["not_in", "not_exists"], [[0, 2]])],
    },
    pitfalls: ["Concluding that no customer is missing because the query returned nothing.", "Adding WHERE customer_id IS NOT NULL to the outer query instead of the subquery.", "Believing NULL = NULL is true."],
    followUps: [
      { q: "Does the same problem affect IN?", hint: "Work out what x IN (1, NULL) gives when x is 1 and when x is 2.", answer: "With IN, a match makes the result true, so a NULL in the list is harmless for matching rows; for non-matching rows the result is unknown, which is filtered out anyway. IN gives the expected rows, NOT IN does not." },
      { q: "When is NOT IN safe?", hint: "Think about what you know about the column.", answer: "When the subquery column is declared NOT NULL, or you filter NULLs out inside the subquery, or the list is literal values." },
    ],
    rubric: ["I reproduced the problem on a tiny example.", "I explained why with the comparison chain.", "I gave a working fix.", "I know IN and NOT IN behave differently with NULL.", "I can say when NOT IN is safe."],
    link: SQL_VIS,
  },
  {
    id: "sql-dedupe-latest", category: "sql", level: "core", minutes: 12,
    title: "Deduplicate: keep the latest row per key",
    prompt: "A users table has several rows per email. Return one row per email, the one updated most recently, and then show how to delete the older ones.",
    clarify: ["What is the key: email, or email after lower-casing and trimming?", "If two rows have the same timestamp, which one wins?", "Is it a one-time cleanup or a rule for a recurring load?"],
    hints: [
      "Concept: a window function can number the rows inside each group without collapsing them.",
      "Choose the grouping and the order so that the row you want to keep is first in its group.",
      "Add a tie-break to the order so that the result is the same every time you run it.",
    ],
    withheld: ["ROW_NUMBER", "PARTITION BY"],
    approach: ["Define the key and the 'latest' column.", "Number rows within each key, newest first, with a tie-break.", "Keep number 1 in an outer query (a window cannot be filtered in WHERE).", "For deletion, delete the ids whose number is greater than 1.", "Verify: the row count equals the number of distinct keys."],
    answer: {
      text: "Use ROW_NUMBER() OVER (PARTITION BY email ORDER BY updated_at DESC, id DESC) in a subquery and keep rn = 1. The id in the order makes a tie deterministic. To delete, select the ids with rn > 1 in a subquery and delete those. Afterwards the count of rows should equal the count of distinct emails.",
      snippets: [sql("Latest row per email", "WITH users(id, email, updated_at) AS (VALUES\n  (1, 'a@x.com', DATE '2026-01-01'), (2, 'a@x.com', DATE '2026-03-01'),\n  (3, 'b@x.com', DATE '2026-02-01'), (4, 'a@x.com', DATE '2026-03-01'))\nSELECT id, email FROM (\n  SELECT id, email, ROW_NUMBER() OVER (PARTITION BY email ORDER BY updated_at DESC, id DESC) AS rn\n  FROM users\n) t\nWHERE rn = 1\nORDER BY email;", ["id", "email"], [[4, "a@x.com"], [3, "b@x.com"]])],
    },
    pitfalls: ["No tie-break: two rows with the same timestamp give a different winner on each run.", "Deduplicating before normalising case and spaces, so Ana and ana stay separate.", "Using DISTINCT, which only removes rows that are identical in every column."],
    followUps: [
      { q: "Now delete the older duplicates.", hint: "Delete by id, using the same numbering in a subquery.", answer: "Delete rows whose id is in the set of ids numbered above 1. After it only the newest row per email remains.", snippet: sql("Delete older duplicates", "DELETE FROM users WHERE id IN (\n  SELECT id FROM (\n    SELECT id, ROW_NUMBER() OVER (PARTITION BY email ORDER BY updated_at DESC, id DESC) AS rn FROM users\n  ) t WHERE rn > 1\n);\nSELECT id, email FROM users ORDER BY id;", ["id", "email"], [[3, "b@x.com"], [4, "a@x.com"]], "CREATE TEMP TABLE users AS SELECT * FROM (VALUES\n  (1, 'a@x.com', DATE '2026-01-01'), (2, 'a@x.com', DATE '2026-03-01'),\n  (3, 'b@x.com', DATE '2026-02-01'), (4, 'a@x.com', DATE '2026-03-01')) v(id, email, updated_at);") },
      { q: "How do you stop duplicates arriving again?", hint: "Think of a rule the database itself enforces.", answer: "Add a unique constraint on the key and load with an upsert, so a repeated or late row updates the existing one instead of adding another." },
    ],
    rubric: ["I defined the key and the order before coding.", "I kept the filter outside the window query.", "I added a tie-break.", "I could write the delete.", "I mentioned prevention (constraint or upsert)."],
    link: SQL_VIS,
  },
  {
    id: "sql-top-n-ties", category: "sql", level: "core", minutes: 10,
    title: "Top earner per department, with ties",
    prompt: "Return the highest-paid employee in each department. If two employees tie for the top, return both. Then change it to return exactly one per department.",
    clarify: ["Is the highest salary per department the target, or the top three?", "On a tie, do we want all tied employees or an arbitrary single one?", "Can a department have no employees, and should it appear?"],
    hints: [
      "Concept: ranking functions differ in what they do with equal values; one gives ties the same rank, another never repeats a number.",
      "Pick the ranking function whose behaviour on ties matches the wording of the question.",
      "For the 'exactly one' version, add a second sort key so that the choice between tied rows is deliberate.",
    ],
    withheld: ["RANK()", "ROW_NUMBER", "DENSE_RANK"],
    approach: ["Restate: partition by department, order by salary descending.", "Choose RANK for ties-kept, ROW_NUMBER for exactly-one.", "Filter the rank in an outer query.", "Test with a tie in the data.", "For exactly one, add a deterministic tie-break such as name."],
    answer: {
      text: "Partition by department, order by salary descending, and keep RANK() = 1: tied top earners both get rank 1 and both are returned. For exactly one per department use ROW_NUMBER with a tie-break column in the order, so the same person is chosen on every run. Always filter in an outer query because window functions cannot appear in WHERE.",
      snippets: [sql("Ties kept: RANK", "WITH emp(dept, name, salary) AS (VALUES ('A','ana',90),('A','ben',90),('A','cy',80),('B','dee',70))\nSELECT dept, name, salary FROM (\n  SELECT *, RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS rk FROM emp\n) t\nWHERE rk = 1\nORDER BY dept, name;", ["dept", "name", "salary"], [["A", "ana", 90], ["A", "ben", 90], ["B", "dee", 70]])],
    },
    pitfalls: ["Using ROW_NUMBER when the question says to keep ties, which silently drops one tied person.", "Using LIMIT 1, which returns one row overall rather than one per group.", "Putting the window function in WHERE, which is an error."],
    followUps: [
      { q: "Return exactly one employee per department.", hint: "Make the order total, so no two rows compare equal.", answer: "Use ROW_NUMBER with salary descending and name as a tie-break, then keep number 1.", snippet: sql("Exactly one: ROW_NUMBER with tie-break", "WITH emp(dept, name, salary) AS (VALUES ('A','ana',90),('A','ben',90),('A','cy',80),('B','dee',70))\nSELECT dept, name, salary FROM (\n  SELECT *, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC, name) AS rn FROM emp\n) t\nWHERE rn = 1\nORDER BY dept;", ["dept", "name", "salary"], [["A", "ana", 90], ["B", "dee", 70]]) },
      { q: "What would DENSE_RANK change if you asked for the top two salaries?", hint: "Think about whether a tie uses up a rank number.", answer: "DENSE_RANK does not skip numbers after a tie, so rank 2 is the second distinct salary. RANK skips: two people tied at rank 1 mean the next rank is 3, so a 'top two' filter would return no one at the second salary." },
    ],
    rubric: ["I asked what ties should do.", "I picked the right ranking function and said why.", "I filtered outside the window query.", "I tested with a tie.", "I can explain the difference between the three ranking functions."],
    link: SQL_VIS,
  },
  {
    id: "sql-lag-mom", category: "sql", level: "core", minutes: 10,
    title: "Month-over-month change",
    prompt: "Given monthly revenue, show each month with the percentage change from the previous month. The first month has no change.",
    clarify: ["Can a month be missing from the data, and what should happen then?", "Percentage of the previous month, or the absolute difference?", "Should the result be rounded, and to how many decimals?"],
    hints: [
      "Concept: a window function can read a value from a neighbouring row without a self-join.",
      "You need the previous row in time order, so the window needs an ordering but no grouping.",
      "Express the change relative to the earlier value, and think about what the first row receives.",
    ],
    withheld: ["LAG", "OVER (ORDER BY month)"],
    approach: ["Define the formula: (current - previous) / previous.", "Fetch the previous month with a window function ordered by month.", "Multiply by 100.0 to avoid integer division.", "Round for display.", "Check a month by hand, and decide how gaps are treated."],
    answer: {
      text: "Use LAG(revenue) OVER (ORDER BY month) to get the previous month's value, compute 100.0 * (revenue - previous) / previous and round. The first month gets NULL because there is no previous row, which is the honest answer. Note that LAG is the previous row, not the previous calendar month, so a missing month needs a calendar table.",
      snippets: [sql("Month-over-month with LAG", "WITH m(month, revenue) AS (VALUES (DATE '2026-01-01', 100), (DATE '2026-02-01', 120), (DATE '2026-03-01', 90))\nSELECT TO_CHAR(month, 'YYYY-MM') AS month, revenue,\n       ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month)) / LAG(revenue) OVER (ORDER BY month), 1) AS pct_change\nFROM m\nORDER BY month;", ["month", "revenue", "pct_change"], [["2026-01", 100, null], ["2026-02", 120, 20], ["2026-03", 90, -25]])],
    },
    pitfalls: ["Integer division: (120 - 100) / 100 is 0 unless one side is decimal.", "Filtering months in a CTE before LAG, so the first kept month loses its previous value.", "Assuming the previous row is the previous month when months can be missing."],
    followUps: [
      { q: "What if March has no row at all?", hint: "The window sees rows, not calendar months.", answer: "LAG would compare April with February. Generate the full list of months, left join the data, and decide whether a missing month means zero or unknown." },
      { q: "How would you compare with the same month last year?", hint: "Change how far back you look.", answer: "LAG with an offset of 12 on a complete monthly series, or a self-join on month minus one year. Both need the series to have no gaps." },
    ],
    rubric: ["I wrote the formula before the SQL.", "I avoided integer division.", "I said what the first row shows.", "I noticed the gap problem.", "I checked one value by hand."],
    link: SQL_VIS,
  },
  {
    id: "sql-null-traps", category: "sql", level: "warm-up", minutes: 8,
    title: "Counting and averaging with NULL",
    prompt: "A column has the values 10, 20 and NULL. What do COUNT(*), COUNT(x), AVG(x) and x = NULL return, and how would you get an average that treats missing as zero?",
    clarify: ["Does NULL mean unknown, or zero, in this column?", "Who reads the average, and what do they assume it includes?", "Is the average meant to be over all rows or only rows with a value?"],
    hints: [
      "Concept: NULL means unknown, and most aggregate functions skip unknown values.",
      "Count rows and count values are different questions; ask which function answers which.",
      "Test for missing with the dedicated predicate, never with an equality sign, and replace missing values before averaging if they should count as zero.",
    ],
    withheld: ["COALESCE", "IS NULL"],
    approach: ["Walk the three rows through each expression.", "COUNT(*) counts rows; COUNT(x) counts non-NULL values.", "AVG sums non-NULL values and divides by their count.", "An equality test with NULL is unknown, so it never matches.", "Replace NULL with 0 only if the business meaning allows it."],
    answer: {
      text: "COUNT(*) is 3 because it counts rows; COUNT(x) is 2 because NULL is skipped; AVG(x) is 15, the mean of 10 and 20, not 10. x = NULL is never true, so it matches nothing; IS NULL matches the one missing row. To treat missing as zero, wrap the column in COALESCE(x, 0) before averaging, which gives 10, but only do this when missing really means zero.",
      snippets: [sql("The NULL traps on three values", "WITH t(x) AS (VALUES (10), (20), (NULL::int))\nSELECT COUNT(*) AS count_star, COUNT(x) AS count_x, AVG(x) AS avg_x,\n       SUM(CASE WHEN x = NULL THEN 1 ELSE 0 END) AS eq_null,\n       SUM(CASE WHEN x IS NULL THEN 1 ELSE 0 END) AS is_null,\n       AVG(COALESCE(x, 0)) AS avg_zero_filled\nFROM t;", ["count_star", "count_x", "avg_x", "eq_null", "is_null", "avg_zero_filled"], [[3, 2, 15, 0, 1, 10]])],
    },
    pitfalls: ["Writing WHERE x = NULL and getting no rows.", "Reporting an average without saying that missing values are excluded.", "Replacing NULL with 0 when it means 'not measured', which drags averages down."],
    followUps: [
      { q: "What does SUM return over an empty set?", hint: "Think about whether there is anything to add.", answer: "NULL, not 0. COUNT returns 0 for an empty set, but SUM and AVG return NULL. Use COALESCE(SUM(x), 0) if a zero is wanted." },
      { q: "How does NULL behave in ORDER BY and GROUP BY?", hint: "One places them first or last; the other puts them together.", answer: "GROUP BY puts all NULLs in one group. ORDER BY places NULLs last in ascending order and first in descending order in PostgreSQL, and NULLS FIRST or NULLS LAST overrides it." },
    ],
    rubric: ["I got all four values right.", "I distinguished rows from values.", "I used IS NULL, not = NULL.", "I said when zero-filling is wrong.", "I knew SUM over nothing is NULL."],
    link: SQL_VIS,
  },
  {
    id: "sql-second-highest", category: "sql", level: "core", minutes: 10,
    title: "Second-highest salary",
    prompt: "Return the second-highest distinct salary. If there is no second value, return NULL rather than no row.",
    clarify: ["Distinct salaries, or the second row after sorting (which could equal the first)?", "What should happen with only one salary: NULL or an empty result?", "Is the same logic needed for the nth highest?"],
    hints: [
      "Concept: skipping rows after sorting can find a position, but only if duplicates are removed first.",
      "Think about how to make 'no row' turn into 'one row containing NULL'.",
      "A ranking that never leaves gaps after ties generalises this to any n.",
    ],
    withheld: ["OFFSET", "DENSE_RANK"],
    approach: ["Clarify distinct versus positional.", "Take the distinct values, sort descending.", "Skip the first and take one.", "Wrap in a scalar subquery so an empty result becomes NULL.", "Generalise with a ranking function."],
    answer: {
      text: "Select the distinct salaries in descending order, skip one row and take one, then wrap that in a scalar subquery: a scalar subquery with no rows evaluates to NULL, which meets the requirement. For the nth highest, rank distinct salaries with DENSE_RANK and keep rank n.",
      snippets: [sql("Second-highest distinct salary", "WITH emp(name, salary) AS (VALUES ('a',100),('b',200),('c',200),('d',150))\nSELECT (SELECT DISTINCT salary FROM emp ORDER BY salary DESC OFFSET 1 LIMIT 1) AS second_highest;", ["second_highest"], [[150]])],
    },
    pitfalls: ["Skipping one row without DISTINCT: with two top earners the 'second' is the same value as the first.", "Returning an empty result instead of NULL when there is no second value.", "Using MAX of salaries below the max without handling the single-salary case."],
    followUps: [
      { q: "Write the nth highest in one query.", hint: "Use a ranking that does not skip numbers after ties and filter on n.", answer: "Rank salaries with DENSE_RANK over salary descending and keep the rows with rank n; DISTINCT removes repeats of the same salary.", snippet: sql("Second highest with DENSE_RANK", "WITH emp(name, salary) AS (VALUES ('a',100),('b',200),('c',200),('d',150))\nSELECT DISTINCT salary FROM (\n  SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS r FROM emp\n) t\nWHERE r = 2;", ["salary"], [[150]]) },
      { q: "What does the scalar-subquery version return for a table with a single salary?", hint: "How many rows does the inner query produce?", answer: "The inner query returns no rows, and a scalar subquery with no rows is NULL, so the result is one row containing NULL." },
    ],
    rubric: ["I asked about duplicates and the empty case.", "I used distinct values.", "My result is NULL, not empty, when absent.", "I could generalise to n.", "I tested with a tie at the top."],
    link: SQL_VIS,
  },

  // ── Python ─────────────────────────────────────────────────────────────
  {
    id: "py-two-sum", category: "python", level: "warm-up", minutes: 10,
    title: "Two numbers that add up to a target",
    prompt: "Given a list of integers and a target, return the indexes of two different elements that add up to the target, or None. Aim for better than comparing every pair.",
    clarify: ["Is there always exactly one solution, or can there be none or several?", "May the same element be used twice?", "Can the list be large, and can values repeat or be negative?"],
    hints: [
      "Concept: a structure with constant-time lookup lets you ask 'have I already seen the partner of this number?' in one step.",
      "For each number, work out which value would complete the pair, and check for it before storing the current number.",
      "Store what you need to return an index, not only the value.",
    ],
    withheld: ["dict", "hash"],
    approach: ["State the brute force: every pair, quadratic time.", "Remember values and their indexes as you scan.", "For each element compute the needed partner and look it up.", "Check before storing so an element is not paired with itself.", "State the cost: one pass, linear time, linear extra memory."],
    answer: {
      text: "Scan once, keeping a dictionary from value to index. For each number compute need = target - number; if need is already in the dictionary, return its index and the current index; otherwise store the current number. Checking before storing stops an element pairing with itself, and duplicates such as [3, 3] still work. It runs in linear time with linear extra space.",
      snippets: [py("Two-sum in one pass", "def two_sum(nums, target):\n    seen = {}                      # value -> index\n    for i, n in enumerate(nums):\n        need = target - n\n        if need in seen:\n            return seen[need], i\n        seen[n] = i\n    return None\n\nprint(two_sum([2, 7, 11, 15], 9))\nprint(two_sum([3, 3], 6))\nprint(two_sum([1, 2], 10))\n", "(0, 1)\n(0, 1)\nNone")],
    },
    pitfalls: ["Storing the number before checking, so a single 3 pairs with itself for target 6.", "Returning values instead of indexes.", "Using list membership inside the loop, which silently makes it quadratic."],
    followUps: [
      { q: "What are the time and space costs, and what is the trade-off against sorting?", hint: "One approach buys speed with memory.", answer: "The dictionary version is linear time and linear space. Sorting needs no extra space for the search (two pointers) but costs n log n and loses the original indexes unless you keep them." },
      { q: "How do you return every pair, not just one?", hint: "Think about what to store for repeated values.", answer: "Store a list of indexes per value, or count occurrences, and collect each pair as you scan. Decide whether (i, j) and (j, i) are the same pair." },
    ],
    rubric: ["I stated the brute force first.", "I used a dictionary and checked before storing.", "I handled duplicates.", "I gave time and space cost.", "I ran my code on an edge case."],
    link: PY_VIS,
  },
  {
    id: "py-first-unique", category: "python", level: "warm-up", minutes: 8,
    title: "First non-repeating character",
    prompt: "Return the index of the first character in a string that appears exactly once, or -1 if there is none.",
    clarify: ["Is the comparison case sensitive?", "What should an empty string return?", "Could the string be very long?"],
    hints: [
      "Concept: counting occurrences first turns 'does it repeat?' into a lookup.",
      "Two passes are fine: one to count, one to find. Think about what order the second pass must use.",
      "The standard library has a type made for counting items.",
    ],
    withheld: ["Counter", "collections"],
    approach: ["Count how many times each character occurs.", "Walk the string in order.", "Return the first position whose count is 1.", "Return -1 when none qualifies.", "State the cost: two linear passes."],
    answer: {
      text: "Count characters with collections.Counter, then scan the string left to right and return the first index whose count is 1; return -1 if the scan finishes. Scanning the string, not the counter, is what guarantees 'first'. Time is linear and extra space is bounded by the alphabet size.",
      snippets: [py("First unique character", "from collections import Counter\n\ndef first_unique(s):\n    counts = Counter(s)\n    for i, ch in enumerate(s):\n        if counts[ch] == 1:\n            return i\n    return -1\n\nprint(first_unique(\"leetcode\"))\nprint(first_unique(\"loveleetcode\"))\nprint(first_unique(\"aabb\"))\n", "0\n2\n-1")],
    },
    pitfalls: ["Looping over the counter instead of the string, which loses the order.", "Using str.count inside the loop, which is quadratic.", "Forgetting the no-answer case."],
    followUps: [
      { q: "Can you do it in a single pass over a stream?", hint: "You need the order of first appearance and the counts.", answer: "Keep an ordered record of candidates and a count; when a character repeats, drop it from the candidates. The first remaining candidate is the answer at any moment." },
      { q: "How does the answer change for Unicode?", hint: "Think about what counts as one character.", answer: "Python strings are sequences of code points, so combining accents can make one visible character several items. Normalise the text first if visible characters are what matters." },
    ],
    rubric: ["I counted first, then scanned the string.", "I handled the no-answer case.", "I gave the cost.", "I tested at least two strings.", "I could discuss streaming or Unicode."],
    link: PY_VIS,
  },
  {
    id: "py-mutable-default", category: "python", level: "core", minutes: 8,
    title: "Read this code: the list that remembers",
    prompt: "What does this print, and why? Then fix it.\n\ndef add_item(item, bucket=[]):\n    bucket.append(item)\n    return bucket\n\nprint(add_item('a'))\nprint(add_item('b'))",
    clarify: ["Which Python version? (The behaviour is the same in every version.)", "Is the function meant to start with a fresh list on every call?", "Is anything else sharing the returned list?"],
    hints: [
      "Concept: a default argument value is an object. Ask when that object is created, and who else can see it.",
      "Ask which object the second call receives as its default.",
      "The usual fix uses a placeholder default and creates the real object inside the function.",
    ],
    withheld: ["None", "sentinel"],
    approach: ["Trace the first call: the default list is empty and gets 'a'.", "Trace the second call: the same list object is used again.", "State the rule: defaults are created once at definition.", "Fix with a sentinel default and create the list inside.", "Name the same trap for dictionaries and sets."],
    answer: {
      text: "It prints ['a'] and then ['a', 'b']. The default list is created once when the function is defined, so every call without an argument shares it. The fix is a sentinel default: use bucket=None, and inside write 'if bucket is None: bucket = []'. The same trap applies to dictionaries, sets and any mutable default.",
      snippets: [py("The trap and the fix", "def add_item(item, bucket=[]):\n    bucket.append(item)\n    return bucket\n\nprint(add_item(\"a\"))\nprint(add_item(\"b\"))\n\ndef add_item_fixed(item, bucket=None):\n    if bucket is None:\n        bucket = []\n    bucket.append(item)\n    return bucket\n\nprint(add_item_fixed(\"a\"))\nprint(add_item_fixed(\"b\"))\n", "['a']\n['a', 'b']\n['a']\n['b']")],
    },
    pitfalls: ["Predicting ['b'] for the second call.", "Fixing it with bucket = bucket or [], which also replaces a caller's empty list.", "Thinking it only affects lists."],
    followUps: [
      { q: "Is the shared default ever useful?", hint: "Think of a cache.", answer: "Occasionally as a deliberate cache, but it hides state; a module-level variable or functools.lru_cache says it more clearly." },
      { q: "Why is 'bucket = bucket or []' a worse fix?", hint: "What is an empty list when tested for truth?", answer: "An empty list is false, so a caller who passes their own empty list gets it replaced by a new one, and their list is never filled." },
    ],
    rubric: ["I predicted the output correctly.", "I explained when defaults are evaluated.", "My fix uses a sentinel and 'is None'.", "I named other mutable defaults.", "I traced it step by step rather than guessing."],
    link: PY_VIS,
  },
  {
    id: "py-generator-batches", category: "python", level: "core", minutes: 10,
    title: "Process a large file in batches",
    prompt: "Write a function that takes an iterable of rows and a size and yields lists of at most that size, without loading everything into memory. Then say what happens when you iterate it twice.",
    clarify: ["Should the last batch be shorter, or dropped?", "Is the source an iterator that can be read only once?", "What is the memory limit compared with the file size?"],
    hints: [
      "Concept: a function that produces values one at a time and pauses between them uses memory for one batch, not the whole input.",
      "Keep a small buffer, hand it out when it is full, and start a new one.",
      "Think about the leftover rows after the loop ends, and about whether the producer can be restarted.",
    ],
    withheld: ["yield", "generator"],
    approach: ["Restate the memory requirement.", "Accumulate rows into a buffer.", "When the buffer reaches the size, hand it out and reset it.", "After the loop, hand out any leftover rows.", "Explain that the result is single-use."],
    answer: {
      text: "Write a generator: append each row to a list, yield the list when its length reaches the size and start a new list, and after the loop yield the leftover rows if any. Only one batch is in memory at a time. A generator is exhausted after one pass, so a second loop over the same object sees nothing: create it again if you need another pass.",
      snippets: [py("Batches and exhaustion", "def batches(rows, size):\n    batch = []\n    for row in rows:\n        batch.append(row)\n        if len(batch) == size:\n            yield batch\n            batch = []\n    if batch:\n        yield batch\n\nfor b in batches(range(7), 3):\n    print(b)\n\ngen = batches(range(4), 2)\nprint(sum(len(b) for b in gen))\nprint(sum(len(b) for b in gen))\n", "[0, 1, 2]\n[3, 4, 5]\n[6]\n4\n0")],
    },
    pitfalls: ["Forgetting the final partial batch.", "Reusing the same list object after yielding it, so earlier batches change.", "Iterating a generator twice and expecting the same data."],
    followUps: [
      { q: "What does reusing the buffer, with clear(), break?", hint: "Think about who else holds the list you handed out.", answer: "The consumer may still hold the list, so clearing it empties their batch. Create a new list for each batch." },
      { q: "How does this look with the standard library?", hint: "There is a helper for slicing an iterator.", answer: "itertools.islice repeatedly taken from one iterator, or itertools.batched in Python 3.12 and later, give the same batches." },
    ],
    rubric: ["I kept only one batch in memory.", "I handled the leftover batch.", "I knew a generator is single-use.", "I avoided reusing the list object.", "I tested with a size that does not divide the length."],
    link: PY_VIS,
  },

  // ── pandas ─────────────────────────────────────────────────────────────
  {
    id: "pd-topn-group", category: "pandas", level: "core", minutes: 10,
    title: "Top two products per region",
    prompt: "A DataFrame has region, product and revenue. Return the two best products per region, with a deterministic result when revenues tie.",
    clarify: ["Top by revenue, and is a tie broken by product name?", "Should the result keep the original row order or be sorted?", "Do regions with fewer than two products still appear?"],
    hints: [
      "Concept: sorting first and then taking the first rows of each group gives a top-N per group.",
      "Include every column that decides ties in the sort, in the direction you want.",
      "A grouped object can give you the first n rows of every group.",
    ],
    withheld: ["groupby", "head(2)"],
    approach: ["Decide the order: revenue descending, then product ascending.", "Sort by region and that order.", "Group by region and take the first two rows of each group.", "Check a region with a tie.", "Mention the alternative with a rank column."],
    answer: {
      text: "Sort by region, revenue descending and product ascending, then group by region and take head(2). Sorting first makes the 'first two' the best two, and the product column makes ties deterministic. Regions with fewer than two rows return what they have.",
      snippets: [py("Top two per region", "import pandas as pd\n\nsales = pd.DataFrame({\n    \"region\": [\"N\", \"N\", \"N\", \"S\", \"S\", \"S\"],\n    \"product\": [\"a\", \"b\", \"c\", \"a\", \"b\", \"c\"],\n    \"revenue\": [100, 300, 200, 50, 50, 70],\n})\ntop2 = (sales.sort_values([\"region\", \"revenue\", \"product\"], ascending=[True, False, True])\n             .groupby(\"region\").head(2))\nprint(top2.to_string(index=False))\n", "region product  revenue\n     N       b      300\n     N       c      200\n     S       c       70\n     S       a       50")],
    },
    pitfalls: ["Calling head(2) on the whole frame, which gives two rows overall.", "No tie-break column, so the result depends on the input order.", "Using nlargest on the whole frame instead of per group."],
    followUps: [
      { q: "How would you add a rank column instead?", hint: "Rank within each group and then filter.", answer: "Use groupby('region')['revenue'].rank(method='first', ascending=False) to number the rows within each region, then filter rank <= 2. The method controls how ties are numbered." },
      { q: "What is the SQL equivalent?", hint: "It uses a window function.", answer: "A ROW_NUMBER over partition by region ordered by revenue descending and product, filtered to numbers up to 2 in an outer query." },
    ],
    rubric: ["I sorted before grouping.", "I included a tie-break.", "I checked a tied region.", "I knew the rank alternative.", "I can name the SQL equivalent."],
    link: DATA_VIS,
  },
  {
    id: "pd-merge-check", category: "pandas", level: "core", minutes: 10,
    title: "A merge that adds rows",
    prompt: "After merging orders with customers the row count went up, although it was a left merge. Find the cause, make pandas stop you next time, and count unmatched orders.",
    clarify: ["Is the customer key supposed to be unique in the customers table?", "Is an order with no customer an error, or normal?", "How much can the row count be allowed to change?"],
    hints: [
      "Concept: a merge produces every matching pair of rows, so repeated keys multiply rows.",
      "Count rows before and after, and look for repeated keys on the right side.",
      "pandas can assert the relationship between the two key columns, and can also tag where each row came from.",
    ],
    withheld: ["validate", "indicator"],
    approach: ["Compare row counts before and after.", "Check the right table's key for duplicates.", "Declare the expected relationship so a violation raises.", "Remove or resolve the duplicate keys.", "Tag unmatched rows and count them."],
    answer: {
      text: "The right table has a duplicate key, so each order for that customer matches twice and the row count grows. Use merge(..., validate='m:1') to make pandas raise a MergeError when the right key is not unique; fix the duplicates (drop_duplicates on the key, or resolve which record is right); then use indicator=True and count the rows marked left_only to find orders without a customer.",
      snippets: [py("Duplicate key, validate, indicator", "import pandas as pd\n\norders = pd.DataFrame({\"order_id\": [1, 2, 3, 4], \"cust\": [\"a\", \"b\", \"b\", \"z\"]})\ncustomers = pd.DataFrame({\"cust\": [\"a\", \"b\", \"b\"], \"name\": [\"Ann\", \"Bo\", \"Bo (dup)\"]})\nnaive = orders.merge(customers, on=\"cust\", how=\"left\")\nprint(len(orders), len(naive))\ntry:\n    orders.merge(customers, on=\"cust\", how=\"left\", validate=\"m:1\")\nexcept pd.errors.MergeError:\n    print(\"MergeError\")\nclean = customers.drop_duplicates(\"cust\")\nchecked = orders.merge(clean, on=\"cust\", how=\"left\", validate=\"m:1\", indicator=True)\nprint(len(checked), int((checked[\"_merge\"] == \"left_only\").sum()))\n", "4 6\nMergeError\n4 1")],
    },
    pitfalls: ["Calling drop_duplicates() on the result of the merge instead of fixing the key.", "Assuming a left merge cannot add rows.", "Not looking at which record of a duplicate pair is correct."],
    followUps: [
      { q: "What do the validate options mean?", hint: "Read them as left side then right side.", answer: "'1:1' both keys unique, 'm:1' the right key unique, '1:m' the left key unique, 'm:m' no check." },
      { q: "How do you find customers that have no orders?", hint: "Change which side is kept and look for unmatched rows.", answer: "Merge customers with orders using how='left' and indicator=True, then keep rows marked left_only; or use customers[~customers.cust.isin(orders.cust)]." },
    ],
    rubric: ["I compared row counts.", "I found the duplicate key.", "I used a declared relationship.", "I counted unmatched rows with the indicator.", "I did not just drop duplicates after the fact."],
    link: DATA_VIS,
  },
  {
    id: "pd-clean-order", category: "pandas", level: "core", minutes: 8,
    title: "Clean in the right order",
    prompt: "A customers file has 'Ana', 'ana ' and dates like 03/04/2026. How do you remove duplicates and parse the dates, and what goes wrong if you do the steps in a different order?",
    clarify: ["Is 03/04/2026 the third of April or the fourth of March?", "Are names the only key for a duplicate?", "How should unparseable dates be reported?"],
    hints: [
      "Concept: cleaning steps depend on each other, so normalising text must come before comparing it.",
      "Ask which rows look different only because of spaces or letter case.",
      "Never let the parser guess an ambiguous date: say which format the file uses.",
    ],
    withheld: ["strip", "format="],
    approach: ["Print row counts at each step.", "Normalise text: trim spaces and fix case.", "Remove duplicates on the normalised key.", "Parse dates with an explicit format.", "Handle bad values deliberately (errors='coerce' and report them)."],
    answer: {
      text: "Normalise first (str.strip().str.lower()), then drop duplicates on the normalised name, so 'Ana' and 'ana ' become one customer. Parse dates with an explicit format, for example format='%d/%m/%Y', so day and month cannot swap silently. Print row counts after each step so any surprise is visible.",
      snippets: [py("Normalise, then deduplicate, then parse", "import pandas as pd\n\ndf = pd.DataFrame({\"name\": [\"Ana\", \"ana \", \"Ben\", \"BEN\"], \"d\": [\"03/04/2026\"] * 2 + [\"05/06/2026\"] * 2})\nwrong = df.drop_duplicates(\"name\")\nright = df.assign(name=df[\"name\"].str.strip().str.lower()).drop_duplicates(\"name\")\nprint(len(wrong), len(right))\nprint(pd.to_datetime(df[\"d\"].iloc[0], format=\"%d/%m/%Y\").date())\n", "4 2\n2026-04-03")],
    },
    pitfalls: ["Deduplicating before normalising, which keeps variants of the same person.", "Letting to_datetime guess and swapping day and month with no error.", "Dropping bad rows silently instead of reporting how many."],
    followUps: [
      { q: "How do you handle values that do not parse?", hint: "Convert them to a marker and count them.", answer: "Use errors='coerce' to get NaT, count the NaT rows, write them to a rejects file or log, and decide whether to fix or drop them." },
      { q: "Why print the row count after each step?", hint: "Think about what a surprising number tells you.", answer: "Each step has an expected effect on row count; a number that differs from the expectation points straight at the step that misbehaved." },
    ],
    rubric: ["I normalised before deduplicating.", "I used an explicit date format.", "I handled bad dates on purpose.", "I printed counts as checks.", "I asked which date convention the file uses."],
    link: DATA_VIS,
  },

  // ── ETL and data engineering ───────────────────────────────────────────
  {
    id: "etl-idempotent-load", category: "etl", level: "core", minutes: 10,
    title: "Make a load safe to rerun",
    prompt: "Your nightly job appends rows to a table. It failed halfway and the on-call engineer reran it, creating duplicates. How do you make the load idempotent?",
    clarify: ["Is there a natural key that identifies a row?", "Is the load a whole table, or a time partition?", "What does the target database support: upsert, merge, partition overwrite?"],
    hints: [
      "Concept: an operation is idempotent when running it twice leaves the same result as running it once.",
      "Decide how a row is identified, so that a repeat can be recognised as the same row.",
      "Replace 'add' with an operation that writes by key, or replaces a whole slice of the data.",
    ],
    withheld: ["ON CONFLICT", "upsert", "overwrite"],
    approach: ["Define the key for a row.", "Write by key (insert or update) instead of appending.", "Alternatively replace the whole partition for the run date inside a transaction.", "Prove it: run twice and compare counts.", "Add a reconciliation check."],
    answer: {
      text: "Make the write keyed: insert new rows and update existing ones by primary key (an upsert, INSERT ... ON CONFLICT DO UPDATE in PostgreSQL), or delete and reload the whole partition for the run date in one transaction. Running the job twice then gives the same table as running it once. Prove it in a test by running the load twice and checking row counts, and keep a reconciliation count against the source.",
      snippets: [
        py("Append versus keyed write, run twice", "def load_append(target, batch):\n    target.extend(batch)\n\ndef load_upsert(target, batch):\n    for row in batch:\n        target[row[\"id\"]] = row\n\nbatch = [{\"id\": 1, \"v\": 10}, {\"id\": 2, \"v\": 20}]\nlog = []\ntable = {}\nfor _ in range(2):      # the job runs twice (a retry)\n    load_append(log, batch)\n    load_upsert(table, batch)\nprint(len(log), len(table))\n", "4 2"),
        sql("The same idea in PostgreSQL", "INSERT INTO target VALUES (1, 10), (2, 20)\nON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v;\nINSERT INTO target VALUES (1, 10), (2, 20)\nON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v;\nSELECT count(*) AS n, sum(v) AS total FROM target;", ["n", "total"], [[2, 30]], "CREATE TEMP TABLE target (id int PRIMARY KEY, v int);"),
      ],
    },
    pitfalls: ["Fixing duplicates with a nightly deduplication job instead of making the load safe.", "An upsert without a unique constraint on the key, which does not prevent duplicates.", "Deleting and reloading outside a transaction, which leaves a window with missing data."],
    followUps: [
      { q: "What if the source changes rows that were already loaded?", hint: "A keyed write needs a way to know which version is newer.", answer: "Update by key and carry an updated-at or version column; only overwrite when the incoming row is newer, so a replayed old record cannot undo a newer one." },
      { q: "How do you test idempotency?", hint: "Run it twice.", answer: "Run the load twice on the same input and assert the table is identical to a single run, including row count and a checksum of the values." },
    ],
    rubric: ["I defined the row key.", "I chose a keyed write or partition replace.", "I mentioned a transaction or a constraint.", "I proposed running it twice as a test.", "I added a reconciliation check."],
    link: ETL_VIS,
  },
  {
    id: "etl-incremental-watermark", category: "etl", level: "core", minutes: 10,
    title: "Incremental loads and the watermark",
    prompt: "Explain how an incremental load with a watermark works, then show a case where it silently loses a row and how to protect against that.",
    clarify: ["Is there a reliable updated-at column on the source, and who sets it?", "Can rows be updated or deleted at the source?", "How often does the job run, and how late can data arrive?"],
    hints: [
      "Concept: a watermark is a remembered position, such as the largest update time already loaded, so the next run only reads what is newer.",
      "Ask what happens to a row whose timestamp is older than the remembered position when it finally arrives.",
      "A safety margin on the starting point is only safe if loading the same row twice does no harm.",
    ],
    withheld: ["lookback", "look-back", "overlap"],
    approach: ["Describe: read rows newer than the watermark, load them, then advance the watermark.", "Show the failure: a late row older than the watermark is never read.", "Fix: start a little before the watermark.", "Make that safe with keyed writes.", "Add a periodic full reconciliation."],
    answer: {
      text: "Each run reads rows whose update time is greater than the stored watermark, loads them, and then moves the watermark to the largest time loaded. A row that arrives late with an older timestamp is never read, so it is silently lost. Protect against it by starting a safety margin before the watermark (a lookback of a day or two), which is safe only because the load is keyed and idempotent, and by reconciling counts against the source regularly.",
      snippets: [py("A late row slips past the watermark", "rows = [\n    {\"id\": 1, \"updated\": \"2026-03-01\"},\n    {\"id\": 2, \"updated\": \"2026-03-02\"},\n    {\"id\": 3, \"updated\": \"2026-03-03\"},\n]\n\ndef extract(rows, watermark):\n    new = [r for r in rows if r[\"updated\"] > watermark]\n    return new, max([r[\"updated\"] for r in new], default=watermark)\n\nnew, wm = extract(rows, \"2026-03-01\")\nprint([r[\"id\"] for r in new], wm)\nrows.append({\"id\": 4, \"updated\": \"2026-03-02\"})   # arrives late, older than the watermark\nnew, wm = extract(rows, wm)\nprint([r[\"id\"] for r in new], wm)\nprint([r[\"id\"] for r in extract(rows, \"2026-03-01\")[0]])   # start earlier: row 4 is found\n", "[2, 3] 2026-03-03\n[] 2026-03-03\n[2, 3, 4]")],
    },
    pitfalls: ["Advancing the watermark before the load has committed, so a failure skips rows.", "Using the job's run time instead of the source's update time.", "A lookback on a load that appends, which then duplicates rows."],
    followUps: [
      { q: "How are deletes at the source handled?", hint: "A query for newer rows cannot see rows that no longer exist.", answer: "Use soft deletes (a deleted flag with an update time), change data capture from the database log, or compare full key lists periodically." },
      { q: "When is a full reload better?", hint: "Think about size and correctness.", answer: "When the table is small, the source has no reliable update column, or correctness matters more than cost. A common pattern is incremental loads daily and a full reload weekly." },
    ],
    rubric: ["I described read, load, then advance.", "I showed a case where a row is lost.", "I proposed a margin and said why it needs idempotency.", "I mentioned deletes.", "I placed the watermark update after the commit."],
    link: ETL_VIS,
  },
  {
    id: "etl-late-data", category: "etl", level: "stretch", minutes: 12,
    title: "Late-arriving data in daily totals",
    prompt: "Daily revenue totals are computed each night. An order for Monday arrives on Wednesday. How do you keep the totals correct without double counting?",
    clarify: ["Which date defines the total: when the event happened or when it was processed?", "How late can data arrive, and is there a cut-off after which totals are final?", "Do consumers need to be told when a published number changes?"],
    hints: [
      "Concept: event time is when something happened; processing time is when your system saw it. Totals by day belong to the event day.",
      "Think about what the nightly job must recompute when old data arrives.",
      "Think about whether a rerun should add to what is stored, or take its place.",
    ],
    withheld: ["replace their totals", "late-arrival window"],
    approach: ["Separate event time from processing time.", "Group totals by event date.", "Define how far back the job re-reads (the late-arrival window).", "Rebuild affected days and replace their result.", "Decide how published numbers are versioned or announced."],
    answer: {
      text: "Aggregate by the date the event happened, not the date it was processed. When late rows arrive, recompute the affected days from the detail and replace their totals (an overwrite, not an addition), so a rerun gives the same answer. Choose a late-arrival window, such as seven days, after which totals are final, and tell consumers when a published day changes.",
      snippets: [py("Recomputing a day when a late row arrives", "from collections import defaultdict\n\nevents = [(\"2026-03-01\", 5), (\"2026-03-01\", 7), (\"2026-03-02\", 4)]   # (event_date, amount)\n\ndef daily_totals(events):\n    out = defaultdict(int)\n    for day, amount in events:\n        out[day] += amount\n    return dict(sorted(out.items()))\n\nprint(daily_totals(events))\nevents.append((\"2026-03-01\", 3))   # arrives on 03-03 but belongs to 03-01\nprint(daily_totals(events))\n", "{'2026-03-01': 12, '2026-03-02': 4}\n{'2026-03-01': 15, '2026-03-02': 4}")],
    },
    pitfalls: ["Adding the late amount to today's total, which misstates two days.", "Recomputing by adding to the stored total, so a rerun double counts.", "No cut-off, so history can change forever."],
    followUps: [
      { q: "What do you tell people who already used the old number?", hint: "Think about visibility, not only correctness.", answer: "Keep a revision history or a 'last updated' marker on the report, publish the change in the data catalogue or channel, and state the late-arrival window so users know when a number is final." },
      { q: "How is this different in a streaming system?", hint: "A stream has no nightly batch to rerun.", answer: "Streams use event-time windows with a watermark: a window stays open for a configured lateness, and later events either update the window or go to a side output for correction." },
    ],
    rubric: ["I used event time for the total.", "I replaced rather than added when recomputing.", "I set a late-arrival window.", "I thought about consumers.", "I could relate it to streaming."],
    link: ETL_VIS,
  },
  {
    id: "etl-pipeline-design", category: "etl", level: "stretch", minutes: 20,
    title: "Design a daily orders pipeline",
    prompt: "Design a pipeline that loads orders from an application database into an analytics warehouse every day, for dashboards that must be correct by 8 am.",
    clarify: ["How many orders per day, and how much history is needed?", "How fresh must the data be, and who consumes it?", "What happens if the pipeline is late or a day is wrong: who is told?"],
    hints: [
      "Concept: a design answer follows a fixed order: requirements, scale, architecture, data model, failure handling, monitoring, trade-offs.",
      "Estimate the volume with simple arithmetic before choosing technology.",
      "For each stage ask what happens when it fails, and whether a rerun is safe.",
    ],
    withheld: ["idempotent", "dead letter", "quarantine"],
    approach: ["Requirements: freshness by 8 am, accuracy, history.", "Scale: orders per day times bytes per order.", "Architecture: extract, stage raw, validate, transform, load, publish.", "Model: state the grain of the fact table and its keys.", "Failure: retries, quarantine for bad rows, keyed loads, backfills.", "Monitoring: row counts, freshness, owner and alert.", "Trade-offs: batch versus streaming, full versus incremental."],
    answer: {
      text: "Clarify freshness (by 8 am) and volume, estimate it (for example 100,000 orders a day at about 1 KB is about 100 MB a day, so one database is enough). Extract incrementally into a raw staging area that keeps the source rows, validate and quarantine bad rows with a reason, transform into a fact table at order-line grain, and load with keyed writes so a rerun is safe. Reconcile counts with the source, alert the owner when a run is late or counts differ, and support backfill by rerunning a date. Batch is enough because nobody needs data fresher than a day; say what would make you move to streaming.",
      snippets: [],
    },
    pitfalls: ["Naming tools before the requirements.", "Choosing streaming with no freshness requirement.", "A diagram with no failure handling, monitoring or owner."],
    followUps: [
      { q: "A source column changes type overnight. What happens?", hint: "Think about where you validate.", answer: "Validate schema at the boundary: the run fails or quarantines loudly at the extract or validate stage, an alert names the owner, and the raw layer keeps the data so it can be reprocessed after the fix." },
      { q: "How would you backfill six months?", hint: "A backfill is the same job for many dates.", answer: "Parameterise the job by date, run dates in controlled parallelism, use keyed loads so reruns are safe, throttle against the source, and reconcile each partition." },
    ],
    rubric: ["I asked about freshness and consumers first.", "I estimated the volume.", "I stated the grain.", "I covered failure, rerun and monitoring.", "I explained a trade-off."],
    link: ETL_VIS,
  },

  // ── Statistics and A/B testing ─────────────────────────────────────────
  {
    id: "stats-ab-test", category: "stats", level: "core", minutes: 12,
    title: "Is variant B really better?",
    prompt: "In an A/B test, A converted 120 of 2,400 visitors and B converted 156 of 2,400. Is the difference significant, and what would you report?",
    clarify: ["Was the split randomised, and was the sample size and duration fixed in advance?", "What is the primary metric, and is 5% the agreed significance level?", "Is there a cost to a wrong decision that changes how careful we should be?"],
    hints: [
      "Concept: compare the two rates and ask how surprising a gap this large would be if the variants were really the same.",
      "Under the 'no difference' assumption, combine both groups to estimate one common rate and its standard error.",
      "Report more than a yes or no: the size of the difference and a range for it.",
    ],
    withheld: ["z-test", "pooled", "two-proportion"],
    approach: ["State the hypotheses and the primary metric.", "Compute both conversion rates.", "Pool the groups for the standard error under no difference.", "Compute z and a two-sided p-value.", "Report the difference with an interval and what it means for the business."],
    answer: {
      text: "A converts at 5.0% and B at 6.5%. With a pooled rate of 5.75% the standard error of the difference is about 0.67 percentage points, so z is about 2.23 and the two-sided p-value about 0.026: below 0.05, so the difference is statistically significant if the test plan was fixed in advance. Report the difference (1.5 percentage points) with its confidence interval, not only the p-value, and say whether that size matters for the business.",
      snippets: [py("Two-proportion z-test", "from math import sqrt, erfc\n\ndef two_prop_z(x1, n1, x2, n2):\n    p1, p2 = x1 / n1, x2 / n2\n    p = (x1 + x2) / (n1 + n2)\n    se = sqrt(p * (1 - p) * (1 / n1 + 1 / n2))\n    z = (p2 - p1) / se\n    return p1, p2, z, erfc(abs(z) / sqrt(2))   # two-sided p-value\n\np1, p2, z, pv = two_prop_z(120, 2400, 156, 2400)\nprint(f\"{p1:.3f} {p2:.3f} z={z:.2f} p={pv:.4f}\")\n", "0.050 0.065 z=2.23 p=0.0256")],
    },
    pitfalls: ["Reading p = 0.026 as a 97.4% chance that B is better.", "Reporting significance without the size of the effect or an interval.", "Looking at the results every day and stopping when it first looks significant."],
    followUps: [
      { q: "Give a 95% interval for the difference.", hint: "Use each group's own variance, not a single shared rate.", answer: "Difference 0.015 plus or minus 1.96 times the unpooled standard error gives roughly 0.2 to 2.8 percentage points: the data are compatible with a small or a moderate gain.", snippet: py("Confidence interval for the difference", "from math import sqrt\n\np1, p2, n = 120 / 2400, 156 / 2400, 2400\ndiff = p2 - p1\nse = sqrt(p1 * (1 - p1) / n + p2 * (1 - p2) / n)\nprint(f\"{diff - 1.96 * se:.4f} {diff + 1.96 * se:.4f}\")\n", "0.0018 0.0282") },
      { q: "What if you tested ten metrics?", hint: "Each test has its own chance of a false alarm.", answer: "With ten independent tests at 5%, the chance of at least one false positive is about 40%. Name one primary metric in advance, or correct for multiple comparisons." },
    ],
    rubric: ["I stated the hypotheses.", "I pooled for the test and not for the interval.", "I interpreted the p-value correctly.", "I reported effect size and interval.", "I raised multiple comparisons or peeking."],
    link: STATS_VIS,
  },
  {
    id: "stats-peeking", category: "stats", level: "stretch", minutes: 10,
    title: "Stopping a test when it looks significant",
    prompt: "A colleague checks an A/B test every day and stops the first time p < 0.05. What is wrong with that?",
    clarify: ["Was a sample size or duration fixed before the test started?", "How many times was the result checked?", "Is there a real cost to a false positive?"],
    hints: [
      "Concept: each look at the data is another chance for random noise to cross the line.",
      "Compare the false-positive rate of one planned look with that of many looks at accumulating data.",
      "Designs that plan the looks in advance do exist, but they fix the rules before the test starts.",
    ],
    withheld: ["sequential design", "adjusted thresholds"],
    approach: ["State what 5% means: one planned look at a true null.", "Explain that repeated looks add chances.", "Quantify with a simulation of no real effect.", "Offer remedies: fixed sample size, or a sequential design with adjusted thresholds.", "Say what to report when a test was stopped early."],
    answer: {
      text: "A 5% false-positive rate holds for one analysis planned in advance. Checking repeatedly gives noise many chances to cross the line, so the real false-positive rate is much higher: about 14% in theory for five equally spaced looks at a null effect (a seeded simulation of 2,000 such tests gives 13%, against 4% when only the final look counts), and it keeps growing with more looks. Fix the sample size or duration in advance, or use a sequential design with adjusted thresholds that were chosen before the test, and report an early stop honestly.",
      snippets: [py("Simulation: no real effect, five looks", "import random\n\nrng = random.Random(7)\ntrials, looks, per_look = 2000, 5, 100\nany_hit = final_hit = 0\nfor _ in range(trials):\n    total, hit = 0.0, False\n    for k in range(1, looks + 1):\n        total += sum(rng.gauss(0, 1) for _ in range(per_look))\n        z = total / (k * per_look) ** 0.5\n        hit = hit or abs(z) > 1.96\n    any_hit += hit\n    final_hit += abs(z) > 1.96\nprint(round(any_hit / trials, 2), round(final_hit / trials, 2))\n", "0.13 0.04")],
    },
    pitfalls: ["Saying peeking only matters when the effect is small.", "Reporting the p-value from the stopping time as if it were planned.", "Extending a test that 'almost' reached significance."],
    followUps: [
      { q: "What do sequential tests do differently?", hint: "They plan the looks.", answer: "They fix the number and timing of looks in advance and use stricter thresholds at each look so the overall false-positive rate stays at the chosen level." },
      { q: "How can a team prevent the problem without statistics training?", hint: "Think process, not mathematics.", answer: "Write the plan before starting (metric, sample size, end date), have the dashboard hide significance until the end date, and review early stops." },
    ],
    rubric: ["I explained that each look is another chance.", "I gave a rough size of the inflation.", "I offered a fixed-sample or sequential fix.", "I mentioned pre-registration of the plan.", "I did not confuse the p-value with the probability of a true effect."],
    link: STATS_VIS,
  },
  {
    id: "stats-simpson", category: "stats", level: "core", minutes: 10,
    title: "Better in every group, worse overall",
    prompt: "Treatment A has a higher success rate than B for small stones and for large stones, yet B looks better overall. How can that be, and which number do you report?",
    clarify: ["Is the group (stone size) something that influences both who gets which treatment and the outcome?", "Was treatment assigned at random?", "What decision depends on the answer?"],
    hints: [
      "Concept: an overall rate is a weighted average of the group rates, and the weights can differ between the two treatments.",
      "Compare how many patients of each group each treatment received.",
      "Decide whether the group is a confounder before choosing between the pooled and the grouped result.",
    ],
    withheld: ["Simpson"],
    approach: ["Compute the rate per group and overall.", "Compare the group mix for each treatment.", "Explain the weighted average.", "Decide whether the group causes the treatment choice (a confounder).", "Report the grouped comparison when it is, and say why."],
    answer: {
      text: "This is Simpson's paradox. A is better in both groups (93.1% against 86.7% for small stones, 73.0% against 68.8% for large), but B is better overall (82.6% against 78.0%) because A was given mostly the hard, large-stone cases while B was given mostly the easy small-stone cases. The overall rate is a weighted average and the weights differ. Because stone size influences both which treatment was chosen and the outcome, the grouped comparison is the fair one: A is better.",
      snippets: [py("Rates per group and overall", "groups = {\"small stones\": {\"A\": (81, 87), \"B\": (234, 270)},\n          \"large stones\": {\"A\": (192, 263), \"B\": (55, 80)}}\nfor g, d in groups.items():\n    print(g, {k: round(s / n, 3) for k, (s, n) in d.items()})\ntot = {k: (sum(groups[g][k][0] for g in groups), sum(groups[g][k][1] for g in groups)) for k in \"AB\"}\nprint(\"overall\", {k: round(s / n, 3) for k, (s, n) in tot.items()})\n", "small stones {'A': 0.931, 'B': 0.867}\nlarge stones {'A': 0.73, 'B': 0.688}\noverall {'A': 0.78, 'B': 0.826}")],
    },
    pitfalls: ["Always trusting the grouped numbers, or always the pooled ones, without asking about cause.", "Not looking at the group sizes.", "Calling it a data error."],
    followUps: [
      { q: "When is the pooled number the right one?", hint: "Think about where the group sits in the causal story.", answer: "When the grouping variable is a result of the treatment (a mediator) rather than a cause of who receives it, adjusting for it would remove part of the effect, so the pooled number answers the question." },
      { q: "How does randomisation remove the problem?", hint: "Think about the group mix in each arm.", answer: "Random assignment makes the group mix similar in both arms, so the weights match and pooled and grouped results agree apart from chance." },
    ],
    rubric: ["I computed all three comparisons.", "I explained the different weights.", "I asked whether the group is a confounder.", "I said which number I would report and why.", "I connected it to randomisation."],
    link: STATS_VIS,
  },

  // ── Analytics cases ────────────────────────────────────────────────────
  {
    id: "case-metric-drop", category: "case", level: "core", minutes: 15,
    title: "Revenue dropped 20% this week. Why?",
    prompt: "Weekly revenue is down 20% against last week. Walk through how you would find out why.",
    clarify: ["Is the metric defined the same way as last week, and is the data complete (no late or missing feed)?", "Is the drop in all regions, products and platforms, or only some?", "Did anything change on our side: a release, a price change, a campaign ending?"],
    hints: [
      "Concept: before looking for causes, check the metric and the data pipeline, then split the metric into its factors.",
      "Write the metric as a product of simpler parts, and measure the change in each part.",
      "Once one part explains the drop, slice that part by segment to find where it is concentrated.",
    ],
    withheld: ["average order value", "conversion rate"],
    approach: ["Confirm the number: definition, completeness, time window.", "Decompose: revenue = visitors × conversion × order value.", "Measure each factor's change.", "Segment the factor that moved: channel, device, country, product.", "Form hypotheses (release, outage, campaign, season) and test them with data.", "Recommend an action and what you will monitor."],
    answer: {
      text: "First rule out a data problem: same definition, complete data. Then break revenue into visitors times conversion rate times average order value and compare each with last week. In the example visitors and order value are unchanged and conversion fell from 3.0% to 2.4%, which explains the whole drop of 48,000. Slice conversion by device, channel and country to find where, check what changed there (a release, a payment outage), and recommend a fix with a metric to confirm recovery.",
      snippets: [py("One factor at a time", "last = {\"visitors\": 100_000, \"conversion\": 0.030, \"aov\": 80.0}\nthis = {\"visitors\": 100_000, \"conversion\": 0.024, \"aov\": 80.0}\nrev = lambda d: d[\"visitors\"] * d[\"conversion\"] * d[\"aov\"]\nprint(round(rev(last)), round(rev(this)))\nfor k in last:\n    swapped = dict(last, **{k: this[k]})\n    print(k, round(rev(swapped) - rev(last)))\n", "240000 192000\nvisitors 0\nconversion -48000\naov 0")],
    },
    pitfalls: ["Jumping to a cause with a story and no data.", "Skipping the check that the number itself is right.", "Presenting the average without segmenting."],
    followUps: [
      { q: "The drop is only on mobile Safari. What next?", hint: "Look for what changed for that segment.", answer: "Check releases and error logs for that browser, compare funnel steps (cart, payment) for that segment, and reproduce the journey. Quantify the lost revenue to prioritise the fix." },
      { q: "How do you tell a real change from normal noise?", hint: "Compare with history.", answer: "Compare with the same week in earlier months and years and with the usual week-to-week variation; a 20% drop outside the normal range deserves an investigation, a 3% one may not." },
    ],
    rubric: ["I checked the data and definition first.", "I decomposed the metric.", "I segmented the factor that moved.", "I gave hypotheses I could test.", "I ended with a recommendation."],
    link: BIZ_VIS,
  },
  {
    id: "case-define-kpi", category: "case", level: "core", minutes: 12,
    title: "Define an active user",
    prompt: "The product team asks for 'monthly active users' as a headline KPI. How do you define the metric so that everyone agrees on it?",
    clarify: ["What is the product supposed to deliver, so what action means a user got value?", "Who will use the number: executives, marketing, product?", "Should it count accounts, people or devices?"],
    hints: [
      "Concept: a KPI definition has a unit, an action, a time window and exclusions, all written down.",
      "Choose an action that reflects value, not just a visit or login.",
      "Say what the number will be compared with, and which related measures guard against gaming it.",
    ],
    withheld: ["companion measures", "retention"],
    approach: ["Tie the metric to a goal.", "Pick the unit (person, account) and the qualifying action.", "Fix the window and the time zone.", "List exclusions (test accounts, bots, staff).", "Name companion metrics that stop the main one being gamed.", "Write it as a query or spec and get it signed off."],
    answer: {
      text: "Start from the goal: users who get value. Define an active user as a distinct person who completed a qualifying action (for example placed an order or used a core feature) at least once in a calendar month, in one time zone, excluding staff, test accounts and bots. Pick the unit explicitly (person rather than device), write it as a query, and pair it with companion measures such as retention and actions per active user so a login-spamming campaign cannot inflate it. Get product and marketing to sign the definition.",
      snippets: [],
    },
    pitfalls: ["Counting logins or page views as 'active'.", "Not saying the unit, window or time zone.", "A single number with no companion measure."],
    followUps: [
      { q: "Marketing wants a looser definition. What do you do?", hint: "Separate the questions the numbers answer.", answer: "Keep one official definition and publish the loose one under a different name (for example 'visitors'), so each number answers a different question and nobody compares them by mistake." },
      { q: "How do you check that the metric is computed correctly?", hint: "Reconcile it with something you trust.", answer: "Test the query on a small sample you can count by hand, compare with an independent source such as billing or logs, and add a data test that fails if the number moves unusually between runs." },
    ],
    rubric: ["I linked the metric to a goal.", "I defined unit, action, window and exclusions.", "I named a companion metric.", "I wrote or described the query.", "I handled disagreement on the definition."],
    link: BIZ_VIS,
  },
  {
    id: "case-feature-success", category: "case", level: "stretch", minutes: 15,
    title: "How do you know the new feature worked?",
    prompt: "A shop adds a 'save for later' button. How would you decide whether it was a success?",
    clarify: ["What is the business goal of the feature: more purchases, less abandoned carts, more return visits?", "Can we run an experiment, or only observe before and after?", "Who is the target user, and how long before the effect shows?"],
    hints: [
      "Concept: success needs a primary metric chosen in advance, plus measures that would show harm.",
      "Think about what the feature should change in behaviour, in the order the customer experiences it.",
      "Plan the comparison before launch: who sees it, for how long, and what size of change matters.",
    ],
    withheld: ["seven days", "ship, iterate or stop"],
    approach: ["State the goal and the hypothesis.", "Choose one primary metric and a few secondary ones.", "Add metrics that would show harm.", "Design the comparison: randomised if possible.", "Fix duration and sample size.", "Decide in advance what result leads to ship, iterate or stop."],
    answer: {
      text: "Say the goal (for example more completed purchases from people who hesitate) and the hypothesis. Choose one primary metric, such as purchase conversion within seven days of first seeing the button, with secondary measures like return visits and saved-then-bought rate, and watch for harm such as slower page loads or fewer immediate purchases. Run a randomised test with the duration and sample size fixed in advance, and decide beforehand what result means ship, iterate or stop. Then report the effect size with an interval, not only significance.",
      snippets: [],
    },
    pitfalls: ["Judging success by button clicks alone, which measures use and not value.", "Comparing before and after, which mixes in season and campaigns.", "Choosing the metric after seeing the results."],
    followUps: [
      { q: "You cannot randomise. What is the next best design?", hint: "Find a comparison that does not depend on time alone.", answer: "Use a staggered rollout or compare matched groups with a difference-in-differences design, and state clearly the assumption that the groups would have moved together without the feature." },
      { q: "Clicks went up but sales did not. What do you say?", hint: "Separate engagement from value.", answer: "The feature is used but may not change decisions. Look at the saved-then-bought rate and whether it replaced purchases that would have happened anyway, and recommend iterating or stopping rather than celebrating clicks." },
    ],
    rubric: ["I tied the feature to a goal.", "I chose one primary metric in advance.", "I included a harm measure.", "I proposed a sound comparison.", "I said what decision each result leads to."],
    link: BIZ_VIS,
  },

  // ── Behavioural and portfolio ──────────────────────────────────────────
  {
    id: "beh-project-result-first", category: "behavioural", level: "core", minutes: 10,
    title: "Tell me about a project you are proud of",
    prompt: "Describe an analysis or pipeline project from start to finish in about two minutes.",
    clarify: ["Which role does the interviewer care about: analyst, engineer, mixed?", "How technical is the audience?", "Is there a time limit for the answer?"],
    hints: [
      "Concept: a strong answer is organised so the listener knows the point early: the situation, your part, the action, and a result with a number.",
      "Choose a project where you made a decision, not only followed instructions.",
      "Finish with what you would do differently, which shows judgement.",
    ],
    withheld: ["open with the result", "two minutes"],
    approach: ["Situation in one sentence: the problem and who needed it.", "Your role and the decision you made.", "The actions, with the trade-off you weighed.", "The result with a number.", "What you learned or would change.", "Stop: leave room for questions."],
    answer: {
      text: "Open with the result so the listener knows where you are going, for example: 'I cut the weekly report from four hours to ten minutes and removed a recurring 3% revenue mismatch.' Then give the situation in a sentence, your role and the decision you made (for example loading by key so reruns are safe), the key actions and one trade-off, and close with what you would change, such as adding a reconciliation test earlier. Keep it near two minutes, and have the numbers ready.",
      snippets: [],
    },
    pitfalls: ["Describing the team's work and never saying what you did.", "A tour of tools with no result.", "No number, so the impact cannot be judged."],
    followUps: [
      { q: "What was the hardest decision?", hint: "Pick one with a real alternative.", answer: "Name two options, what you valued (correctness against speed, for example), why you chose one, and what you would watch to know if it was wrong." },
      { q: "What would you do differently?", hint: "Be specific and honest.", answer: "Name one concrete change that came from experience (an earlier test, a clearer definition, a conversation with the stakeholder sooner) rather than a vague 'communicate more'." },
    ],
    rubric: ["My first sentence stated the result.", "I said what I personally did.", "I gave a number.", "I named a trade-off.", "I kept it near two minutes."],
  },
  {
    id: "beh-portfolio-walkthrough", category: "behavioural", level: "stretch", minutes: 12,
    title: "Present your portfolio project",
    prompt: "You have 10 minutes to present your capstone project to a hiring manager. How do you structure it, and what does the repository need so it can be trusted?",
    clarify: ["Who is the audience: a manager, a senior engineer, a mixed panel?", "Will they open the repository, or only listen?", "How much time is for questions?"],
    hints: [
      "Concept: a portfolio project is judged on whether it can be understood quickly, run and trusted.",
      "Lead with the question the project answers and the result, then the evidence for it.",
      "List what a stranger needs in the repository: what it does, how to run it, how it was checked, and its limits.",
    ],
    withheld: ["README", "reproducib", "limitations"],
    approach: ["One sentence: the question and the result.", "The data and how it was cleaned (with counts).", "Design decisions and trade-offs.", "How correctness was checked: tests and reconciliation.", "Limitations stated honestly.", "What you would do next."],
    answer: {
      text: "Lead with the question and the result in one sentence, then show the data and the cleaning log with real counts, the design decisions with their reasons, and how you checked correctness (tests and a reconciliation of totals). State the limits honestly: a project that admits what it does not do is more believable. Make the repository match the talk: a README with what it does, how to run it in a few commands, how to test it, the design decisions and the limitations; a clean commit history with no secrets or data files; and numbers in the README that the code actually prints.",
      snippets: [],
    },
    pitfalls: ["A tour of every file instead of the question and the result.", "Numbers in the README that the code does not produce.", "Committing secrets, data files or one giant 'final' commit."],
    followUps: [
      { q: "What do you say when asked what is wrong with your project?", hint: "Prepare the answer before the interview.", answer: "Name two real limitations you already documented, explain why you accepted them and what you would change with more time. It shows you evaluate your own work." },
      { q: "How do you show the project can be reproduced?", hint: "Think about a fresh machine.", answer: "Pin dependencies, generate or document the data deterministically, give the exact commands in order, and run them on a clean checkout before the interview." },
    ],
    rubric: ["I led with the question and the result.", "I showed the checks, not only the output.", "I stated limits.", "My repository would pass the 'stranger test'.", "I prepared an answer about weaknesses."],
  },

  // ── Git ────────────────────────────────────────────────────────────────
  {
    id: "git-merge-vs-rebase", category: "git", level: "core", minutes: 10,
    title: "Merge or rebase?",
    prompt: "Your feature branch is behind main. You can merge main into it or rebase it onto main. What is the difference, and when would you use each?",
    clarify: ["Has the branch been pushed, and has anyone else based work on it?", "Does the team want a linear history or a record of merges?", "How many commits are on the branch, and could they conflict one by one?"],
    hints: [
      "Concept: one approach adds a commit that joins two histories; the other replays your commits on a new starting point.",
      "Ask what happens to the identifiers of your commits in each case.",
      "The deciding question is whether anyone else already has the commits you would be rewriting.",
    ],
    withheld: ["merge commit", "new ids", "never rebase", "force"],
    approach: ["Describe merge: keeps history as it happened, adds a merge commit, no rewriting.", "Describe rebase: replays each commit on the new base, producing new commits and a straight line.", "Say the cost of rebase: rewritten ids and conflicts per commit.", "State the rule: do not rewrite history that others already have.", "Say what the team convention is."],
    answer: {
      text: "A merge keeps both histories and adds a merge commit with two parents; nothing existing changes. A rebase replays your commits one by one on top of the new base, so the history is a straight line but every replayed commit has a new id, and you may resolve conflicts once per commit. Use a rebase to tidy a private, unpublished branch before review; use a merge for shared branches, because rewriting commits that others already have causes duplicated, diverging history. Follow the team's convention.",
      snippets: [],
    },
    pitfalls: ["Rebasing a branch other people have pulled.", "Believing a rebase moves commits: it creates copies and abandons the originals.", "Resolving the same conflict repeatedly instead of merging once."],
    followUps: [
      { q: "You rebased a pushed branch by mistake. What now?", hint: "Think about telling people and restoring the earlier state.", answer: "Tell the people who share the branch, and restore the old tip if nobody needs the rewrite (for example by resetting the branch to the commit recorded before the rebase). Force-pushing a rewritten shared branch should only be done by agreement." },
      { q: "What does a fast-forward merge do?", hint: "Think of one branch being a strict ancestor of the other.", answer: "If the target has no new commits, the branch pointer is simply moved forward: no merge commit is created and the history stays a line." },
    ],
    rubric: ["I explained merge and rebase correctly.", "I said that rebase creates new commits.", "I stated when each fits.", "I knew the shared-history rule.", "I could describe a fast-forward."],
    link: GIT_VIS,
  },
];

export const PRESETS = QUESTIONS.map((q) => ({ id: q.id, label: q.title }));

export const questionById = (id: string | undefined) => QUESTIONS.find((q) => q.id === id);
export const byCategory = (c: Category | "all") => (c === "all" ? QUESTIONS : QUESTIONS.filter((q) => q.category === c));

/** Plain-text lines of an answer (text and code), used to check that hints do not repeat them. */
export function answerLines(q: Question): string[] {
  return [q.answer.text, ...q.answer.snippets.flatMap((s) => s.code.split("\n")), ...q.followUps.flatMap((f) => [f.answer, ...(f.snippet?.code.split("\n") ?? [])])].map((l) => l.trim()).filter((l) => l.length >= 14);
}
