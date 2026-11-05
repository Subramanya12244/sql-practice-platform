---
id: PY-035
title: Extract Error Messages From Log
slug: extract-error-messages-from-log
difficulty: Easy
category: files
skill: parsing
description: Read an app log file and return the messages of ERROR lines.
topic: python-file-handling
concepts: file reading, string split, filtering
time: O(n)
space: O(k)
minutes: 6
---

## Scenario

On-call engineers want a quick list of error messages from yesterday's application log without opening the whole file.

## Problem

Lines look like '2024-05-01 10:00:00 ERROR Payment failed'. Write `error_messages(path)` returning the message part (everything after the level) of lines whose level is exactly 'ERROR', in file order. Skip lines with fewer than 4 parts.

## Objective

Read the log file and return the message text of every line whose level is exactly ERROR.

## Input format

A file path.

## Output format

A list of strings.

## Constraints

- Level is the 3rd whitespace-separated token

## Examples

```
'2024-05-01 10:00:00 ERROR Payment failed'  ->  ['Payment failed']
```

## Hints

- line.split(maxsplit=3) gives date, time, level, message.
- Ignore short lines.

## Why it matters

Log parsing is a daily task for data and platform engineers. Splitting with a max count keeps messages that contain spaces intact.

```task
{
  "id": "extract-error-messages-from-log",
  "title": "Extract Error Messages From Log",
  "type": "python",
  "instructions": "Lines look like '2024-05-01 10:00:00 ERROR Payment failed'. Write `error_messages(path)` returning the message part (everything after the level) of lines whose level is exactly 'ERROR', in file order. Skip lines with fewer than 4 parts.",
  "starter": "def error_messages(path):\n    raise NotImplementedError\n",
  "solution": "def error_messages(path):\n    out = []\n    with open(path) as f:\n        for line in f:\n            parts = line.split(maxsplit=3)\n            if len(parts) == 4 and parts[2] == 'ERROR':\n                out.append(parts[3].rstrip())\n    return out\n",
  "tests": "with open('app.log', 'w') as f:\n    f.write('2024-05-01 10:00:00 INFO Started\\n2024-05-01 10:00:01 ERROR Payment failed\\n')\nassert error_messages('app.log') == ['Payment failed']\n",
  "hidden": "open('e.log', 'w').close()\nassert error_messages('e.log') == []\nwith open('f.log', 'w') as f:\n    f.write('bad\\n2024-05-01 10:00:00 ERROR\\n2024-05-01 10:00:02 ERRORS x\\n2024-05-01 10:00:03 ERROR a  b\\n')\nassert error_messages('f.log') == ['a  b']\n",
  "explanation": "split with maxsplit=3 separates the first three tokens and keeps the message whole. Requiring exactly four parts and an exact level match skips malformed and look-alike lines."
}
```
