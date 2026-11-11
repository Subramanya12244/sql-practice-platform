# Daily Learning content specification

Content lives in `frontend/src/site/content/daily/`. Loaders: `frontend/src/site/lib/daily.ts`. Checks: `frontend/src/test/siteDaily.test.ts`.
Run the checks with `cd frontend && DAILY_DAYS=d006..d018 npx vitest run src/test/siteDaily.test.ts --maxConcurrency=8`.
`DAILY_DAYS` takes day ids or ranges in curriculum order (`d006..d018,a091`). Leave it unset to check every authored day.
Local examples need the virtual environment `.venv-daily` at the repository root: `python3 -m venv .venv-daily && .venv-daily/bin/pip install -r frontend/src/site/content/daily/requirements.txt`.

## Files

| File | Holds |
|---|---|
| `curriculum.json` | Programme, paths, phases and every day's metadata. The only place to add or rename a day. |
| `days/<id>.md` | One authored lesson: theory, syntax, runnable examples, review. |
| `days/<id>.json` | Time budget, guided and independent exercises, knowledge check, reuse links. |

`<id>` is the day id from `curriculum.json`: `d001`–`d090` for the common core, `a091`–`a180` for the analyst path, `e091`–`e180` for the engineer path.
A day counts as authored only when both files exist. Any other day shows as "content coming" with its topics and prerequisites. Never add placeholder lesson files.

## Lesson file: `days/<id>.md`

No frontmatter. Title, phase, topics, prerequisites and duration come from `curriculum.json`. Use exactly these `##` headings, in this order:

1. `## Objectives`: 3 to 5 bullets, each starting with a verb and describing something the learner can do at the end of the day.
2. `## Understand`: the theory. Explain the idea in plain language first, then the details. Use `###` subsections. Include a short "why it matters" and the common misconception where there is one.
3. `## Syntax and key functions`: a compact reference. Show each syntax form in a fenced block and explain each part. Use a table for functions and what they return.
4. `## Learn by example`: three to six worked examples (see below), each with a `### Example N: title` heading and a short explanation of what the code does and why.
5. `## Real-world applications`: two to four concrete uses in data work, each tied to something in this day's content.
6. `## Daily review`: three subsections: `### Key takeaways`, `### Common mistakes`, `### Revision notes`.
7. `## Revision task`: one task the learner does on a later day without looking at the lesson. State what to produce and how to check it.
8. `## Next-day preparation`: what the next day covers and one small thing to try or read first.

Do not write exercises, hints or quiz questions in the markdown. They live in the JSON file.
Write for a beginner. Define each term when first used. Do not describe features that are not in this day. No filler and no motivational padding.

### Runnable examples

An example is a fenced block tagged `python run`, `sql run`, `python local` or `bash run`, then an optional `stdin` block, then a mandatory `output` block with the exact expected output.

| Tag | Tests run it | Browser runs it | Use for |
|---|---|---|---|
| `python run` | yes | yes | Standard library, `numpy`, `pandas`, `scipy`, `statsmodels`, `sqlite3` |
| `sql run` | yes | yes | Northwind queries |
| `python local` | yes | no (shown read-only with the verified output) | `matplotlib`, `seaborn`, `plotly`, `requests`, `sqlalchemy`, `openpyxl`, `pytest`, `pydantic`, anything using sockets, threads or the file system beyond a temp folder |
| `bash run` | yes | no (shown read-only) | Git and Linux commands, running `pytest`, small scripts |

A day with any `python local` or `bash run` example must set `environment` in its JSON file (see below).

````markdown
### Example 2: Joining first and last name

Explanation of the idea.

```python run
first = "Ada"
last = "Lovelace"
print(first + " " + last)
```

```output
Ada Lovelace
```
````

Rules:
- The output block is checked by the test suite. Python code runs with `python3 -I`, `stdin` (when given) is fed to `input()`. SQL runs on the browser copy of Northwind (PGlite, PostgreSQL 16). An example fails the suite if the output differs.
- Python output compares stdout line by line, ignoring trailing spaces and trailing blank lines.
- SQL output is the result as text: first line the column names, then one line per row, cells joined with ` | `. NULL is written `NULL`. Dates are written `YYYY-MM-DD`. Always `ORDER BY` and `LIMIT` so the rows are stable. Keep outputs to 10 rows or fewer. Never write numbers you did not get from a run.
- Examples tagged `python run` must work in the browser Python (Pyodide 0.29, Python 3.13, numpy 2.2, pandas 2.3) as well as in CPython. The tests reject imports the browser cannot load. Examples: no network, no `input()` without a `stdin` block, no files unless the code creates them, no third-party packages.
- Code in other fences (` ```python `, ` ```sql-syntax `, ` ```text `, ` ```dax `, ` ```excel `, ` ```yaml `) is shown but not run. Use `sql-syntax` for templates with placeholders. Every untagged ` ```python ` fence must still parse; tag a deliberate template or error demonstration ` ```python nocheck `.
- **Output stability.** Output must not depend on the date, the time zone, the machine, dictionary ordering you did not sort, random numbers you did not seed, floating-point noise you did not round, or library versions beyond the pinned ones. Seed random generators (`random.seed(7)`, `np.random.default_rng(7)`). Round floats. Sort anything unordered. For `matplotlib`, `seaborn` and `plotly`, print properties of the figure (titles, labels, data behind the marks, counts of bars), never image bytes. Use `matplotlib.use("Agg")`.
- **Platform-dependent numbers.** The browser Python is 32-bit (WebAssembly), so NumPy's default integer is `int32` there and `int64` on most desktops, and `itemsize`, `nbytes` and `np.dtype(int)` differ accordingly. Never print a default-integer dtype name, `itemsize` or `nbytes` of an array whose dtype you did not set. Set the dtype explicitly (`dtype=np.int64`) when the width is the point, or teach the difference openly. Pandas integers built from Python lists are `int64` on both. `daily-browser-verify.mjs` catches these.
- **Self-contained data.** Examples and exercises create their own small datasets in the code (lists, dicts, `io.StringIO` CSV text, a `sqlite3` in-memory database, a temp folder). They never read a file that is not created by the code.
- **Calling an API.** Browser examples call a small stand-in function that returns canned JSON (explain that this replaces the network). `python local` examples may start a throwaway `http.server` on `127.0.0.1` in a thread and call it with `requests`. Never call a real remote service.
- **Tools without a runtime here** (Excel, Power Query, DAX, Power BI, Airflow, Spark, Docker): show the formulas or code in untagged fences, and re-derive every number you quote with a `python run` or `sql run` example that computes the same result (for example the pandas equivalent of `SUMIFS`), so no number is unverified. Airflow and PySpark code appears in untagged ` ```python ` fences (syntax-checked). Explain what to install and how to run it in `environment.note`. Give a reproducible alternative: a pure-Python or pandas version of the exercise that is graded in the browser.
- Use PostgreSQL 16 syntax. Use only tables and columns that exist in `frontend/public/data/northwind.sql`. The data is small and synthetic: see `docs/CONTENT_SPEC.md` for the quirks (for example, `region`, `phone` and `address` are empty).

## Exercise file: `days/<id>.json`

```json
{
  "id": "d001",
  "time": { "theory": 25, "examples": 20, "guided": 25, "independent": 45, "review": 15 },
  "links": { "notes": ["python-fundamentals"], "questions": [], "pyExercises": ["cart-line-total"], "projects": [], "mindmaps": ["python-track"], "patterns": [] },
  "guided": [
    {
      "id": "g1",
      "title": "Print a greeting",
      "kind": "python",
      "prompt": "Markdown instructions: what to do and what the output must look like.",
      "starter": "# Your code here\n",
      "solution": "print(\"Hello\")\n",
      "expected": "Hello",
      "hints": ["Gentle nudge.", "More specific.", "Almost the answer."]
    }
  ],
  "independent": [ { "id": "i1", "title": "…", "kind": "python", "prompt": "…", "starter": "…", "solution": "…", "expected": "…" } ],
  "environment": { "packages": ["matplotlib", "seaborn"], "note": "Only for days with local or bash examples: what to install and run on your own computer, and what the browser cannot do." },
  "checks": [
    { "id": "c1", "question": "…", "options": ["A", "B", "C", "D"], "answer": 1, "explanation": "Why B is right and why the others are not." }
  ]
}
```

Rules:
- `time` values are minutes. They sum to the day's `minutes` in `curriculum.json` within 10 minutes. Shape the split to the day: more theory on concept-heavy days, more independent practice on project days.
- 3 to 4 guided exercises, each with 3 hints (gentlest first, the last almost gives the answer). 2 to 3 independent exercises with no `hints`. Independent exercises must be harder than guided ones and combine ideas. One independent exercise per day may set `"required": false` (a stretch task).
- `kind: "written"`: for work the browser cannot grade (a chart, a spreadsheet formula, a dashboard, a shell session). Give `prompt`, a `starter` (placeholder text shown in the answer box), `solution` (a model answer in Markdown, at least a paragraph or a worked answer) and `rubric` (2 to 5 checks the learner ticks against the model answer). Written exercises are self-assessed. Every day needs at least 2 auto-graded exercises (`python` or `sql`), or 1 when the day has an `environment` note. Do not use `written` just to avoid writing a graded exercise.
- `kind: "python"`: graded in the browser, so only browser-safe imports. `expected` is the exact stdout of a correct program, `stdin` is optional input. Make the task precise enough that the expected output is the only reasonable result. The `starter` must NOT already produce `expected`.
- `kind: "sql"`: the learner's query is graded by comparing its result with the result of `solution`. Set `"ordered": true` only when row order is part of the task. The task text must name the exact columns and aliases expected, in order. The `starter` must NOT already return the solution's result.
- Day 1 to 5 style days (no database): use Python exercises only. SQL days: use SQL exercises only.
- 4 to 6 `checks`, multiple choice with 3 to 4 options. Test understanding, not recall of wording: include "what does this code print" questions, and wrong options that match real misconceptions. `explanation` says why the right answer is right and why the common wrong answer is wrong.
- `links`: only things that exist. `notes` are slugs under `content/notes/*/`, `pyExercises` are slugs under `content/python/`, `projects` are slugs in `content/tracks.json` `projects`, `mindmaps` are file names under `content/mindmaps/` without `.json`, `patterns` are slugs under `content/patterns/`, `questions` are question numbers from `frontend/public/data/index.json`. Link by reference; never copy their content. Prefer 2 to 5 links total that really help with this day's topic.
- Existing Python exercises (`content/python/`) all ask the learner to write a function. Link them only from Day 14 (functions) onward, and only when the exercise needs nothing taught later than the linking day.

## Phase 1 authoring rules for the remaining days

- Cover exactly the topics listed for the day in `curriculum.json`. Teach no topic that is listed for a later day, and do not assume one that is not listed for the day itself or an earlier day on the same route (common days, then the day's path).
- `Next-day preparation` must name the next day's topic (the test checks that a keyword of the next day's title appears). The last day of each route is exempt.
- Project, checkpoint and capstone days: shorter `Understand` (at least 250 words) and more independent practice (`time.independent` of 60 or more). A project day builds one small, complete, self-contained result in steps; a capstone day builds one stage of the capstone project defined for that route (all capstone days on a route use the same project, introduced on its first day, with data created in code).
- Write each file as soon as it is done and run the checks for your range before starting the next day. Do not leave a day with only one of its two files.
- Do not repeat paragraphs from other days. Cross-reference the earlier day instead ("on Day 36 you used COUNT").

## Completion and mastery (computed, not stored in content)

A day is complete when the learner has: viewed the theory; passed every required guided exercise; attempted every required independent exercise; scored at least 60% on the knowledge check.
Mastery is separate: check score of at least 80%, every independent exercise passed, and the revision task marked done.
Examples run in the browser are tracked but optional.

## Quality bar

- Technically accurate. Every output was produced by running the code, not written from memory.
- Each day teaches a real, new skill at beginner level. No filler sections, no repeated text between days.
- Exercises build on the day's examples, and independent exercises combine them.
- Reuse existing notes, questions and exercises by reference.
