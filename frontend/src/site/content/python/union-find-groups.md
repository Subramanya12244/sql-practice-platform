---
id: PY-129
title: Group Connected Accounts With Union-Find
slug: union-find-groups
difficulty: Hard
category: dsa
skill: deduplication
description: Merge records that share any identifier.
topic: python-oop
concepts: disjoint set union, path compression, union by size
time: O(N * a(N)) plus O(N log N) sorting
space: O(N)
minutes: 25
---

## Scenario

A CRM has duplicate customer accounts created through different sign-ups, each listing one or more email addresses. Accounts that share any email belong to the same person and must be merged.

## Problem

Each account is a list of email addresses. Accounts sharing any email belong to the same person. Return the merged groups as sorted lists of unique emails, with the groups sorted by their first email.

## Objective

Merge accounts that share any email into groups of sorted unique emails, with groups sorted by first email.

## Input format

A list of lists of strings.

## Output format

A list of sorted lists.

## Constraints

- Up to 10 000 emails; near-linear time

## Examples

```
merge_accounts([['a', 'b'], ['b', 'c'], ['d']])  ->  [['a', 'b', 'c'], ['d']]
```

## Hints

- Union every email in an account with the account's first email.
- find() with path compression keeps trees flat.

## Why it matters

Entity resolution across sources is a common master-data problem, and union-find handles transitive matches efficiently where naive pairwise comparison does not scale.

```task
{
  "id": "union-find-groups",
  "title": "Group Connected Accounts With Union-Find",
  "type": "python",
  "instructions": "Each account is a list of email addresses. Accounts sharing any email belong to the same person. Return the merged groups as sorted lists of unique emails, with the groups sorted by their first email.",
  "starter": "def merge_accounts(accounts: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def merge_accounts(accounts: list) -> list:\n    parent, size = {}, {}\n\n    def find(x):\n        parent.setdefault(x, x)\n        size.setdefault(x, 1)\n        root = x\n        while parent[root] != root:\n            root = parent[root]\n        while parent[x] != root:\n            parent[x], x = root, parent[x]\n        return root\n\n    def union(a, b):\n        ra, rb = find(a), find(b)\n        if ra == rb:\n            return\n        if size[ra] < size[rb]:\n            ra, rb = rb, ra\n        parent[rb] = ra\n        size[ra] += size[rb]\n\n    for acc in accounts:\n        for e in acc:\n            find(e)\n            union(acc[0], e)\n    groups = {}\n    for e in parent:\n        groups.setdefault(find(e), set()).add(e)\n    return sorted(sorted(g) for g in groups.values())\n",
  "tests": "assert merge_accounts([['a', 'b'], ['b', 'c'], ['d']]) == [['a', 'b', 'c'], ['d']]\n",
  "hidden": "assert merge_accounts([]) == []\nassert merge_accounts([['x', 'x']]) == [['x']]\nassert merge_accounts([['a'], ['b'], ['a', 'b']]) == [['a', 'b']]\nchain = [[f'e{i}', f'e{i + 1}'] for i in range(9999)]\nassert len(merge_accounts(chain)) == 1 and len(merge_accounts(chain)[0]) == 10000\n",
  "explanation": "Union-find answers 'are these connected?' in nearly constant time. Path compression and union by size keep the trees shallow, so even a long chain of 10 000 linked accounts stays fast."
}
```
