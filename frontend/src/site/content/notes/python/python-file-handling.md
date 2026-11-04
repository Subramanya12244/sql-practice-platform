---
title: File handling
slug: python-file-handling
category: python
difficulty: Beginner
description: Read and write files in Python with open, with, pathlib and encodings; stream large files, write atomically and manage temp directories.
prerequisites: [python-fundamentals, python-loops]
related: [python-csv-json, python-exceptions, etl-extraction]
questions: []
patterns: []
guides: []
projects: [csv-to-postgres-etl, python-data-cleaning]
minutes: 8
version: 1
---

## Introduction

Most pipelines start or end with a file: a CSV drop from a vendor, a JSON export, a log, a Parquet file in object storage. Reading and writing them safely is basic, but mistakes here corrupt data.

## Definition

`open(path, mode, encoding=...)` returns a file object. The `with` statement closes it automatically. `pathlib.Path` represents file system paths and offers helpers such as `read_text`, `glob` and `mkdir`.

## Why it matters

- Wrong encodings turn names into mojibake.
- Files left open leak handles; partially written files get picked up by downstream jobs.
- Reading a 20 GB file with `read()` crashes the worker.

## How it works

1. `open` asks the OS for a handle in a mode: `r` read, `w` write (truncate), `a` append, `x` create-only, plus `b` for binary.
2. Text mode decodes bytes using `encoding` and translates newlines.
3. Iterating over the file yields one line at a time, buffered.
4. Leaving the `with` block flushes and closes the file, even on error.

## Syntax and configuration

```python-syntax
with open(path, "r", encoding="utf-8") as f:
    for line in f:              # streaming, constant memory
        ...

with open(path, "w", encoding="utf-8", newline="") as f:
    f.write("text\n")

from pathlib import Path
p = Path("data") / "raw" / "orders.csv"
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text("...", encoding="utf-8")
for f in Path("data").glob("*.csv"): ...
p.suffix, p.stem, p.name, p.exists(), p.stat().st_size
```

## Examples

All examples work inside a temporary directory so they leave no files behind.

```python
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as tmp:
    base = Path(tmp)
    path = base / "raw" / "customers.txt"
    path.parent.mkdir(parents=True)

    with open(path, "w", encoding="utf-8") as f:
        f.write("ALFKI,Alfreds Futterkiste\n")
        f.write("BLAUS,Blauer See Delikatessen\n")

    with open(path, "a", encoding="utf-8") as f:
        f.write("MÈRE,Mère Paillarde\n")

    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, start=1):
            print(number, line.rstrip("\n"))

    print(path.name, path.suffix, path.stat().st_size, "bytes")
    print([p.name for p in base.rglob("*.txt")])
```

Binary mode and encodings:

```python
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as tmp:
    p = Path(tmp) / "latin1.txt"
    p.write_bytes("café".encode("latin-1"))
    print(p.read_bytes())                                  # b'caf\xe9'
    print(p.read_text(encoding="latin-1"))                 # café
    print(p.read_text(encoding="utf-8", errors="replace")) # caf�
```

## Architecture

Write to a temporary file, then rename it into place, so readers never see half a file.

```mermaid
flowchart LR
    job["Writer job"] --> tmpfile["orders.csv.tmp"]
    tmpfile -->|"os.replace"| final["orders.csv"]
    final --> reader["Downstream reader"]
```

## Practical example

Stream a large log, keep only error lines, and publish the output atomically.

```python
import os
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as tmp:
    src = Path(tmp) / "app.log"
    with open(src, "w", encoding="utf-8") as f:
        for i in range(10_000):
            level = "ERROR" if i % 1000 == 0 else "INFO"
            f.write(f"2024-01-01T00:00:{i % 60:02d} {level} event={i}\n")

    out = Path(tmp) / "errors.log"
    part = out.with_suffix(".log.tmp")
    count = 0
    with open(src, encoding="utf-8") as fin, open(part, "w", encoding="utf-8") as fout:
        for line in fin:                       # one line in memory at a time
            if " ERROR " in line:
                fout.write(line)
                count += 1
    os.replace(part, out)                      # atomic on the same file system

    print(count, "errors;", sorted(p.name for p in Path(tmp).iterdir()))
```

## Exercises

1. Which mode creates a file but fails if it already exists?

<details><summary>Answer</summary>

`"x"`. It raises `FileExistsError`, which protects against overwriting an earlier run's output.

</details>

2. How do you count lines in a 10 GB file without loading it?

<details><summary>Answer</summary>

`with open(p, encoding="utf-8") as f: n = sum(1 for _ in f)`. Iteration streams the file.

</details>

3. Why pass `newline=""` when writing CSV files?

<details><summary>Answer</summary>

The `csv` module writes its own line endings. Without `newline=""`, Windows adds an extra `\r` and you get blank rows.

</details>

## Common mistakes

- Not specifying `encoding`; the default depends on the platform.
- Using `f.read()` or `readlines()` on huge files.
- Opening with `"w"` when you meant `"a"`, truncating yesterday's data.
- Building paths with string concatenation instead of `Path` or `os.path.join`.
- Writing outputs in place, so a crash leaves a partial file that downstream jobs load.

## Performance and best practices

- Iterate line by line, or read fixed-size chunks with `f.read(1 << 20)` for binary data.
- Always use `with`.
- Write to a temp name and `os.replace` it into place.
- Use `tempfile.TemporaryDirectory()` in tests and scratch steps.
- For columnar analytics files, prefer Parquet through pandas or pyarrow over CSV.

## Interview questions

### Why use with open(...) instead of open and close?

The context manager closes the file even when an exception is raised, so handles do not leak and buffers are flushed.

### How do you process a file larger than memory?

Stream it: iterate over lines, read chunks, or use `pandas.read_csv(..., chunksize=N)` and process each piece.

### How do you avoid downstream jobs reading a half-written file?

Write to a temporary file in the same directory, then `os.replace` it to the final name. The rename is atomic on one file system. Alternatively, write a `_SUCCESS` marker after the data.

### What is the difference between text and binary mode?

Text mode decodes bytes to `str` with an encoding and translates newlines. Binary mode returns raw `bytes`, which you need for images, compressed files and exact byte handling.

## Quick revision

- `with open(p, mode, encoding="utf-8")` always.
- Modes: `r`, `w` (truncate), `a`, `x`, plus `b` for binary.
- Iterate lines to stream big files.
- `pathlib.Path` for joins, globbing and metadata.
- Atomic publish: write temp, then `os.replace`.
- `tempfile` for scratch space.
