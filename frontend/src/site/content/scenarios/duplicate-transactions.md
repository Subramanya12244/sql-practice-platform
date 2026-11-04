---
title: Reverse duplicate bank postings
slug: duplicate-transactions
dataset: banking
difficulty: Medium
description: Identify transactions posted twice to the same account at the same time for the same amount, keeping the first posting.
orderBy: transaction_id
notes: [row-number, partition-by, self-join]
patterns: [find-duplicates, remove-duplicates]
---

## Business context
Operations found that a batch job re-sent some card transactions, so a few customers were debited or credited twice. They need the exact transaction ids to reverse, plus the id of the posting that should be kept.

## Problem
Transactions are duplicates when `account_id`, `txn_time`, `direction` and `amount` are all identical. In each duplicate group keep the lowest `transaction_id` and list every other one.

## Available data
- `transactions`: `transaction_id`, `account_id`, `txn_time`, `txn_type`, `direction` (`C`/`D`), `amount`, `description`

## Expected outcome
Operations posts a reversing entry for each listed `transaction_id`.

## Success criteria
- Output columns, exactly: `transaction_id`, `account_id`, `txn_time`, `direction`, `amount`, `kept_transaction_id`
- One row per transaction to reverse; the kept (lowest id) posting is not listed.
- Sort by `transaction_id`.

```solution
SELECT transaction_id, account_id, txn_time, direction, amount, kept_transaction_id
FROM (
  SELECT t.*,
         ROW_NUMBER() OVER (PARTITION BY account_id, txn_time, direction, amount ORDER BY transaction_id) AS rn,
         MIN(transaction_id) OVER (PARTITION BY account_id, txn_time, direction, amount) AS kept_transaction_id
  FROM transactions t
) x
WHERE rn > 1
ORDER BY transaction_id;
```

```alternative
SELECT d.transaction_id, d.account_id, d.txn_time, d.direction, d.amount,
       MIN(k.transaction_id) AS kept_transaction_id
FROM transactions d
JOIN transactions k
  ON k.account_id = d.account_id AND k.txn_time = d.txn_time
 AND k.direction = d.direction AND k.amount = d.amount
 AND k.transaction_id < d.transaction_id
GROUP BY d.transaction_id, d.account_id, d.txn_time, d.direction, d.amount
ORDER BY d.transaction_id;
```

## Explanation
`ROW_NUMBER` over the duplicate key numbers each copy; everything after the first is a duplicate, and `MIN(...) OVER` names the survivor. The self-join finds, for each posting, any identical posting with a smaller id; if one exists the row is a duplicate and the smallest such id is the keeper. Including `direction` matters: a debit and a credit of the same amount at the same moment are a legitimate transfer pair, not a duplicate.

## Follow-up questions
### How would you delete them instead?
`DELETE FROM transactions t USING (...) x WHERE t.transaction_id = x.transaction_id` with the solution as `x`; in banking you would post reversals rather than delete history.
### What is the net balance impact per account?
Sum `CASE direction WHEN 'C' THEN amount ELSE -amount END` over the duplicate rows grouped by `account_id`.
