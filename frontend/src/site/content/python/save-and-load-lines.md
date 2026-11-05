---
id: PY-057
title: Save And Load Lines
slug: save-and-load-lines
difficulty: Easy
category: files
skill: ingestion
description: Write lines to a file and read them back.
topic: python-file-handling
concepts: with open, write, read, encoding
time: O(n)
space: O(n)
minutes: 8
---

## Scenario

A pipeline saves the list of processed batch IDs to a checkpoint file and reloads it on the next run. IDs may contain non-ASCII characters, so the encoding must be explicit.

## Problem

Write `save_lines(path, lines)` that writes each string on its own line (UTF-8) and `load_lines(path)` that returns them as a list without newline characters.

## Objective

Write each string on its own UTF-8 line and read them back as a list without newline characters.

## Input format

A file path and a list of strings.

## Output format

`load_lines` returns a list of str.

## Constraints

- Use `with` so files are closed
- Non-ASCII text must round-trip

## Examples

```
save_lines(p, ['a', 'b']); load_lines(p)  ->  ['a', 'b']
```

## Hints

- `'\n'.join(lines)` or write each line with '\n'.
- `f.read().splitlines()` drops the newlines.

## Why it matters

Reading and writing files with context managers and explicit encodings prevents leaked handles and platform-dependent encoding bugs.

```task
{
  "id": "save-and-load-lines",
  "title": "Save And Load Lines",
  "type": "python",
  "instructions": "Write `save_lines(path, lines)` that writes each string on its own line (UTF-8) and `load_lines(path)` that returns them as a list without newline characters.",
  "starter": "def save_lines(path: str, lines: list) -> None:\n    raise NotImplementedError\n\n\ndef load_lines(path: str) -> list:\n    raise NotImplementedError\n",
  "solution": "def save_lines(path: str, lines: list) -> None:\n    with open(path, 'w', encoding='utf-8') as f:\n        for line in lines:\n            f.write(line + '\\n')\n\n\ndef load_lines(path: str) -> list:\n    with open(path, encoding='utf-8') as f:\n        return f.read().splitlines()\n",
  "tests": "import os, tempfile\np = os.path.join(tempfile.mkdtemp(), 'x.txt')\nsave_lines(p, ['a', 'b'])\nassert load_lines(p) == ['a', 'b']\n",
  "hidden": "import os, tempfile\np = os.path.join(tempfile.mkdtemp(), 'y.txt')\nsave_lines(p, [])\nassert load_lines(p) == []\nsave_lines(p, ['café', '数据', ''])\nassert load_lines(p) == ['café', '数据', '']\nsave_lines(p, ['new'])\nassert load_lines(p) == ['new']\n",
  "explanation": "`with open(...)` closes the file even if an error occurs. Mode 'w' truncates, so saving again replaces the old content. An explicit UTF-8 encoding makes non-ASCII text round-trip on every platform."
}
```
