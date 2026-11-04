---
title: Loan customers with no deposit account
slug: loans-without-accounts
dataset: banking
difficulty: Easy
description: Find customers who hold loans but have no bank account, a cross-sell gap and a KYC data-quality check.
notes: [left-join, exists-not-exists, except]
patterns: [anti-join, customers-without-orders, missing-records]
---

## Business context
The retail banking team wants to cross-sell current accounts to borrowers. Compliance also wants to know about these customers, because loan repayments normally come from an account held at the bank.

## Problem
List every customer who has at least one loan (any status) but no account of any kind, open or closed, with their number of loans and total principal.

## Available data
- `customers`: `customer_id`, `first_name`, `last_name`
- `accounts`: `account_id`, `customer_id`, `status`
- `loans`: `loan_id`, `customer_id`, `principal`, `status`

## Expected outcome
Relationship managers call each customer with an account-opening offer; compliance checks how repayments are collected.

## Success criteria
- Output columns, exactly: `customer_id`, `customer_name`, `loan_count`, `total_principal`
- `customer_name` = `first_name || ' ' || last_name`.
- A customer with any account row (even closed) is excluded.
- `total_principal` rounded with `ROUND(x::numeric, 2)`.

```solution
SELECT c.customer_id, c.first_name || ' ' || c.last_name AS customer_name,
       COUNT(*) AS loan_count, ROUND(SUM(l.principal)::numeric, 2) AS total_principal
FROM customers c
JOIN loans l ON l.customer_id = c.customer_id
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.customer_id = c.customer_id)
GROUP BY c.customer_id, c.first_name, c.last_name;
```

```alternative
SELECT c.customer_id, c.first_name || ' ' || c.last_name AS customer_name,
       COUNT(*) AS loan_count, ROUND(SUM(l.principal)::numeric, 2) AS total_principal
FROM loans l
JOIN customers c ON c.customer_id = l.customer_id
LEFT JOIN (SELECT DISTINCT customer_id FROM accounts) a ON a.customer_id = l.customer_id
WHERE a.customer_id IS NULL
GROUP BY c.customer_id, c.first_name, c.last_name;
```

```alternative
WITH gap AS (
  SELECT customer_id FROM loans
  EXCEPT
  SELECT customer_id FROM accounts
)
SELECT c.customer_id, c.first_name || ' ' || c.last_name AS customer_name,
       COUNT(*) AS loan_count, ROUND(SUM(l.principal)::numeric, 2) AS total_principal
FROM gap g
JOIN customers c ON c.customer_id = g.customer_id
JOIN loans l ON l.customer_id = g.customer_id
GROUP BY c.customer_id, c.first_name, c.last_name;
```

## Explanation
Three classic anti-join shapes: `NOT EXISTS`, `LEFT JOIN ... IS NULL` and `EXCEPT` on the key. In the LEFT JOIN version the accounts side is deduplicated first; joining raw accounts would not change this result (non-matching rows only) but would multiply loan rows for customers who do have accounts if the filter were ever changed. `EXCEPT` works on keys only, so loan details are joined back afterwards.

## Follow-up questions
### What about customers with only closed accounts?
Change the subquery to `a.status <> 'closed'` to treat them as having no active account.
### Could duplicate customer records hide an account?
Yes: customer 201 duplicates customer 10. A real check would match on name and date of birth too.
