---
title: Word Frequency Top-N
slug: word-frequency-top-n
difficulty: Easy
description: Count words in text and return the top N, breaking ties alphabetically.
topic: python-collections
minutes: 15
---

## Problem

Write `def top_words(text: str, n: int) -> list` returning a list of `(word, count)` tuples for the
`n` most frequent words. Words are lowercase runs of letters `a-z` (apostrophes and digits split words).
Sort by count descending, then word ascending. Empty or `None` text returns `[]`.

## Examples

```
top_words("the cat and the hat", 2)  ->  [("the", 2), ("and", 1)]
top_words("", 3)  ->  []
```

## Hints

- `re.findall(r'[a-z]+', text.lower())` tokenises.
- `collections.Counter` counts; sort with key `(-count, word)`.

```task
{
  "id": "word-frequency-top-n",
  "title": "Word Frequency Top-N",
  "type": "python",
  "instructions": "Write `def top_words(text: str, n: int) -> list` returning a list of `(word, count)` tuples for the\n`n` most frequent words. Words are lowercase runs of letters `a-z` (apostrophes and digits split words).\nSort by count descending, then word ascending. Empty or `None` text returns `[]`.",
  "starter": "def top_words(text: str, n: int) -> list:\n    raise NotImplementedError\n",
  "solution": "import re\nfrom collections import Counter\n\ndef top_words(text: str, n: int) -> list:\n    if not text:\n        return []\n    counts = Counter(re.findall(r\"[a-z]+\", text.lower()))\n    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]\n",
  "tests": "assert top_words(\"the cat and the hat\", 2) == [(\"the\", 2), (\"and\", 1)]\nassert top_words(\"\", 3) == []\nassert top_words(None, 3) == []\nassert top_words(\"b a c b a\", 2) == [(\"a\", 2), (\"b\", 2)]\nassert top_words(\"Hello, HELLO world!\", 5) == [(\"hello\", 2), (\"world\", 1)]\nassert top_words(\"x\", 0) == []\n"
}
```
