# Workspace content audit (Agent 5: curriculum, exercises and content integration)

Date: 2026-11-18 (phase 1 audit; phase 2 results are in section 12). Branch `feature/dataforge-guide` at `471fc05` plus uncommitted workspace work. Everything below was read from the real files or produced by running the real tests in this worktree. The earlier reports (`DAILY_LEARNING_CONTENT_COVERAGE.md`, `DAILY_LEARNING_AUTHORING_MANIFEST.jsonl`, `DAILY_LEARNING_INTEGRATION_REPORT.md`) were treated as claims to check, not as evidence.

Regenerate the per-lesson table in section 3 with `cd frontend && node scripts/daily-audit.mjs --results <vitest.json> --write-doc` (the vitest JSON comes from `DAILY_PYTHON=<venv python> npx vitest run src/test/siteDaily.test.ts --reporter=json --outputFile=<file>`).

## 1. Verdict

| Question | Answer, with evidence |
| --- | --- |
| Are 270 of 270 lessons authored? | Yes. 540 files in `frontend/src/site/content/daily/days/` (270 `.md` + 270 `.json`), one pair per curriculum entry, nothing extra, no pair half-present. All 270 have the 8 required sections and all JSON keys. |
| Do all 270 validate? | Yes, in a clean environment. Full run with a venv and the test PATH fix: 4939 tests, 4937 passed, 0 failed, 2 skipped. The earlier "18 failures" were environment, not content (section 2). |
| Missing / incomplete lessons | 0 missing, 0 incomplete. |
| Routes | Common core d001 to d090 (90), Data Analyst a091 to a180 (90), Data Engineer e091 to e180 (90). 270 unique ids, no duplicates, day numbers contiguous inside each route, 29 phases contiguous and on the right route. |
| Manifest | 270 lines, 270 unique ids, none missing, none extra, every `files` entry equals `<id>.md`, `<id>.json` and exists. 260 `validated` strings carry a pass count; after subtracting the 6 shared tests that every `DAILY_DAYS` run includes, every one of those counts equals the number of per-day tests that exist today. The 10 original entries only say "passed". No duplicates, no stale claim found. |
| Real content defects in lessons | None found that a test or script can prove. Advisories (not defects) are listed in section 4. |
| Real content defect elsewhere | SQL question 19 is graded against the wrong query (section 4.1). Not edited: its data is not generated from `questions/` (section 4.1). |

Before and after: nothing in lesson content changed, so the lesson counts did not move. Before this work the existing test command reported 22 failing tests on a machine with no scientific Python; after fixing the environment (a venv and a test PATH fix, section 2) the full run has 0 failures. Authored+validated: 270. Failing: 0. Incomplete: 0. Missing: 0. The only thing that moved is the count of days we can prove (we can now prove all 270 from one command).

## 2. Validation run, honestly

Command (from `frontend/`): `DAILY_PYTHON=<venv>/bin/python TZ=UTC npx vitest run src/test/siteDaily.test.ts --maxConcurrency=3`.
Venv: Python 3.14.6 with `content/daily/requirements.txt` installed (numpy 2.5.5, pandas 2.3.3, scipy, statsmodels, matplotlib, seaborn, plotly, requests, sqlalchemy, pytest, openpyxl, pydantic).

First run (before any change): 4939 tests, 4915 passed, 22 failed, 2 skipped. All 22 failures had one of two environmental causes. None is a content defect.

| Cause | Tests | Days | Evidence |
| --- | --- | --- | --- |
| `bash run` examples call `python`, but the test's bash `PATH` was hard-coded to `<repo>/.venv-daily/bin:/usr/bin:/bin:...`. That folder does not exist in this worktree and macOS has no `python` command, only `python3`. | 18 | d022, d061, d062, e138, e156, e178, a179 | `bash: python: command not found` (exit 127) in each. |
| Timeouts at 90 s under machine load (about ten other processes running): the heavy example and exercise in one dashboard lesson. | 4 | a142 | `Test timed out in 90000ms`. The same four tests pass in 3 s to 12 s when run alone. |

Without any venv (default `python3`) the same suite fails on `ModuleNotFoundError: No module named 'numpy'` (12 of the first 17 failures in a two-day probe of d061 and d063) plus the `python: command not found` cases, which reproduces the earlier session's "numpy/pandas or python/pytest" failures.

Fix made (test environment only, no assertion weakened): in `siteDaily.test.ts` the bash `PATH` now starts with the folder of `DAILY_PYTHON` when that variable is a path, then the old entries. With the venv on the path, `python` resolves to the same interpreter the Python tests use. Re-running the eight affected days: 146 passed, 2 skipped, 0 failed.

Final full run after the fix: `siteDaily.test.ts` with the venv and the PATH fix: 4939 tests, 4937 passed, 0 failed, 2 skipped (the skipped ones are `DAILY_REQUIRE_ALL`, which was checked by file listing instead, and a `skipIf` guard that only fires when Python is missing). All 270 lessons: 270 validated, 0 failing.

What the suite does not prove (it cannot): real Pyodide and 32-bit behaviour (`scripts/daily-browser-verify.mjs` is the browser check; not run here, no browser run was requested), the 71 `python local` and 45 `bash run` examples run only on this machine's CPython and shell, not in a learner's environment, and prose accuracy of tool claims (Power BI, Airflow, Spark) is not machine-checked.

## 3. Per-lesson table

Columns: Understand = theory words with code fences removed (phase-and-kind median in brackets; "shallow" means under 60% of that median, none are); Run/local/bash = runnable examples; G+I = guided + independent exercises; Graded/written; Debug = exercises whose title says fix, debug, bug, broken, repair or faulty; Checks = knowledge-check questions; Links = links to existing DataForge content; Hints 3x = every guided exercise has exactly 3 hints; Workspace = primary workspace domain from `lib/visual/dailyVisual.ts` (section 7); Status = missing, incomplete, failing, validated.

Every lesson in the table has: both files, the 8 required sections (Objectives, Understand, Syntax and key functions, Learn by example, Real-world applications, Daily review with Key takeaways, Common mistakes and Revision notes, Revision task, Next-day preparation), a curriculum entry with every field filled, at least 3 worked examples, at least 3 guided and 3 independent exercises, 5 or 6 knowledge checks, at least 2 DataForge links, and a time budget within 10 minutes of the planned minutes. The prerequisite check is in section 5.

<!-- LESSON TABLE START -->
| Id | Kind | Understand (median) | Run/local/bash | G+I | Graded/written | Debug | Checks | Links | Hints 3x | Workspace | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| d001 | l | 995 (877.5) | 5/0/0 | 4+3 | 7/0 | 1 | 5 | 2 | yes | python | validated (19 passed) |
| d002 | l | 915 (877.5) | 5/0/0 | 4+3 | 7/0 |  | 6 | 2 | yes | python | validated (19 passed) |
| d003 | l | 941 (877.5) | 5/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | python | validated (19 passed) |
| d004 | l | 937 (877.5) | 6/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | python | validated (20 passed) |
| d005 | l | 870 (877.5) | 6/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | python | validated (20 passed) |
| d006 | l | 937 (877.5) | 5/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | python | validated (19 passed) |
| d007 | l | 818 (877.5) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | python | validated (19 passed) |
| d008 | l | 826 (877.5) | 6/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | python | validated (20 passed) |
| d009 | l | 873 (877.5) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | python | validated (19 passed) |
| d010 | l | 781 (877.5) | 6/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | python | validated (20 passed) |
| d011 | l | 820 (877.5) | 6/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | python | validated (20 passed) |
| d012 | l | 882 (877.5) | 6/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | python | validated (20 passed) |
| d013 | l | 846 (877.5) | 6/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | python | validated (20 passed) |
| d014 | l | 913 (877.5) | 6/0/0 | 4+3 | 7/0 |  | 5 | 6 | yes | python | validated (20 passed) |
| d015 | p | 479 (479) | 6/0/0 | 4+3 | 7/0 |  | 5 | 8 | yes | python | validated (20 passed) |
| d016 | l | 870 (812) | 6/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | python | validated (20 passed) |
| d017 | l | 844 (812) | 6/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | python | validated (20 passed) |
| d018 | l | 881 (812) | 6/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | python | validated (20 passed) |
| d019 | l | 916 (812) | 6/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | python | validated (20 passed) |
| d020 | l | 802 (812) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | python | validated (20 passed) |
| d021 | l | 812 (812) | 6/0/0 | 4+3 | 7/0 |  | 6 | 6 | yes | python | validated (20 passed) |
| d022 | l | 838 (812) | 2/2/2 | 4+3 | 6/1 |  | 6 | 4 | yes | python | validated (19 passed) |
| d023 | l | 751 (812) | 5/1/0 | 4+3 | 7/0 |  | 6 | 5 | yes | python | validated (20 passed) |
| d024 | l | 790 (812) | 6/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | python | validated (20 passed) |
| d025 | l | 717 (812) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | python | validated (20 passed) |
| d026 | l | 791 (812) | 6/0/0 | 4+3 | 7/0 |  | 6 | 6 | yes | python | validated (20 passed) |
| d027 | l | 772 (812) | 6/0/0 | 4+3 | 7/0 |  | 6 | 7 | yes | python | validated (20 passed) |
| d028 | l | 769 (812) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | python | validated (20 passed) |
| d029 | l | 991 (812) | 1/0/5 | 4+3 | 5/2 |  | 6 | 5 | yes | python | validated (18 passed) |
| d030 | l | 1018 (812) | 1/0/5 | 4+3 | 5/2 |  | 6 | 4 | yes | python | validated (18 passed) |
| d031 | l | 887 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | sql | validated (20 passed) |
| d032 | l | 840 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | sql | validated (20 passed) |
| d033 | l | 809 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | sql | validated (20 passed) |
| d034 | l | 921 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | sql | validated (20 passed) |
| d035 | l | 979 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | sql | validated (20 passed) |
| d036 | l | 762 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | sql | validated (20 passed) |
| d037 | l | 780 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 6 | yes | sql | validated (20 passed) |
| d038 | l | 772 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 8 | yes | sql | validated (20 passed) |
| d039 | l | 730 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 6 | yes | sql | validated (20 passed) |
| d040 | l | 844 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | sql | validated (20 passed) |
| d041 | l | 787 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 7 | yes | sql | validated (20 passed) |
| d042 | l | 814 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 7 | yes | sql | validated (20 passed) |
| d043 | l | 924 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 7 | yes | sql | validated (20 passed) |
| d044 | l | 840 (827) | 6/0/0 | 4+3 | 7/0 |  | 6 | 6 | yes | sql | validated (20 passed) |
| d045 | c | 801 (801) | 6/0/0 | 4+3 | 7/0 |  | 6 | 7 | yes | sql | validated (20 passed) |
| d046 | l | 817 (777) | 6/0/0 | 4+3 | 7/0 |  | 6 | 6 | yes | sql | validated (20 passed) |
| d047 | l | 831 (777) | 6/0/0 | 4+3 | 7/0 |  | 6 | 8 | yes | sql | validated (20 passed) |
| d048 | l | 857 (777) | 6/0/0 | 4+3 | 7/0 | 1 | 6 | 7 | yes | sql | validated (20 passed) |
| d049 | l | 700 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | sql | validated (20 passed) |
| d050 | l | 662 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 9 | yes | sql | validated (20 passed) |
| d051 | l | 675 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 6 | yes | sql | validated (20 passed) |
| d052 | l | 742 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 8 | yes | sql | validated (20 passed) |
| d053 | l | 744 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 6 | yes | sql | validated (20 passed) |
| d054 | l | 810 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 8 | yes | sql | validated (20 passed) |
| d055 | l | 699 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 10 | yes | sql | validated (20 passed) |
| d056 | l | 739 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 6 | yes | sql | validated (20 passed) |
| d057 | l | 861 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | sql | validated (20 passed) |
| d058 | l | 953 (777) | 4/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | sql | validated (18 passed) |
| d059 | l | 860 (777) | 6/0/0 | 4+3 | 7/0 |  | 5 | 7 | yes | sql | validated (20 passed) |
| d060 | c | 692 (692) | 6/0/0 | 4+3 | 7/0 |  | 5 | 8 | yes | sql | validated (20 passed) |
| d061 | l | 761 (765) | 1/0/5 | 4+3 | 6/1 | 1 | 5 | 5 | yes | python | validated (19 passed) |
| d062 | l | 769 (765) | 1/0/5 | 4+3 | 6/1 |  | 5 | 5 | yes | python | validated (19 passed) |
| d063 | l | 1196 (1062) | 5/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | numpy | validated (19 passed) |
| d064 | l | 1035 (1062) | 5/0/0 | 4+3 | 7/0 |  | 6 | 2 | yes | numpy | validated (19 passed) |
| d065 | l | 1089 (1062) | 5/0/0 | 3+3 | 6/0 |  | 6 | 2 | yes | numpy | validated (18 passed) |
| d066 | l | 952 (1062) | 6/0/0 | 4+3 | 7/0 |  | 6 | 2 | yes | numpy | validated (20 passed) |
| d067 | p | 589 (589) | 4/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | numpy | validated (18 passed) |
| d068 | l | 1006 (967) | 5/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | pandas | validated (19 passed) |
| d069 | l | 1069 (967) | 5/1/0 | 4+3 | 6/1 |  | 6 | 4 | yes | pandas | validated (19 passed) |
| d070 | l | 967 (967) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | pandas | validated (19 passed) |
| d071 | l | 1003 (967) | 5/0/0 | 4+3 | 7/0 | 1 | 6 | 3 | yes | pandas | validated (19 passed) |
| d072 | l | 969 (967) | 6/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | pandas | validated (20 passed) |
| d073 | l | 984 (967) | 5/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | pandas | validated (19 passed) |
| d074 | l | 1027 (967) | 5/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | pandas | validated (19 passed) |
| d075 | l | 1038 (967) | 5/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | pandas | validated (19 passed) |
| d076 | l | 1030 (967) | 5/0/0 | 4+3 | 7/0 |  | 6 | 3 | yes | pandas | validated (19 passed) |
| d077 | l | 857 (967) | 4/0/0 | 4+3 | 7/0 |  | 5 | 2 | yes | pandas | validated (18 passed) |
| d078 | l | 873 (967) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | pandas | validated (19 passed) |
| d079 | l | 743 (967) | 5/0/0 | 4+3 | 7/0 |  | 5 | 4 | yes | pandas | validated (19 passed) |
| d080 | l | 779 (967) | 5/0/0 | 4+3 | 7/0 |  | 5 | 4 | yes | pandas | validated (19 passed) |
| d081 | l | 826 (967) | 5/0/0 | 4+3 | 7/0 |  | 5 | 4 | yes | pandas | validated (19 passed) |
| d082 | l | 756 (967) | 4/0/0 | 4+3 | 7/0 |  | 5 | 2 | yes | pandas | validated (18 passed) |
| d083 | l | 747 (967) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | pandas | validated (19 passed) |
| d084 | l | 887 (967) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | pandas | validated (19 passed) |
| d085 | p | 469 (469) | 5/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | pandas | validated (19 passed) |
| d086 | l | 940 (973) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | pandas | validated (19 passed) |
| d087 | l | 987 (973) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | pandas | validated (19 passed) |
| d088 | l | 989 (973) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | python | validated (19 passed) |
| d089 | l | 959 (973) | 5/0/0 | 4+3 | 7/0 |  | 5 | 3 | yes | numpy | validated (19 passed) |
| d090 | c | 1202 (1202) | 6/0/0 | 4+3 | 6/1 |  | 5 | 3 | yes | python | validated (19 passed) |
| a091 | l | 1087 (970) | 4/1/0 | 4+3 | 5/2 |  | 5 | 4 | yes | pandas | validated (17 passed) |
| a092 | l | 1050 (970) | 5/0/0 | 4+3 | 5/2 | 1 | 5 | 5 | yes | pandas | validated (17 passed) |
| a093 | l | 877 (970) | 5/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | pandas | validated (17 passed) |
| a094 | l | 878 (970) | 6/0/0 | 4+3 | 5/2 |  | 5 | 7 | yes | pandas | validated (18 passed) |
| a095 | l | 816 (970) | 5/0/0 | 4+3 | 5/2 |  | 5 | 8 | yes | pandas | validated (17 passed) |
| a096 | l | 1005 (970) | 5/0/0 | 4+3 | 5/2 |  | 5 | 8 | yes | pandas | validated (17 passed) |
| a097 | l | 922 (970) | 4/1/0 | 4+3 | 5/2 |  | 5 | 8 | yes | pandas | validated (17 passed) |
| a098 | l | 1086 (970) | 5/0/0 | 4+3 | 5/2 | 1 | 5 | 8 | yes | pandas | validated (17 passed) |
| a099 | l | 970 (970) | 5/0/0 | 4+3 | 5/2 |  | 5 | 9 | yes | pandas | validated (17 passed) |
| a100 | p | 643 (643) | 3/1/0 | 4+3 | 5/2 |  | 5 | 8 | yes | pandas | validated (16 passed) |
| a101 | l | 963 (972) | 5/0/0 | 4+3 | 6/1 |  | 5 | 4 | yes | pandas | validated (18 passed) |
| a102 | l | 972 (972) | 6/0/0 | 4+3 | 6/1 |  | 5 | 4 | yes | numpy | validated (19 passed) |
| a103 | l | 1078 (972) | 5/0/0 | 4+3 | 6/1 |  | 5 | 4 | yes | numpy | validated (18 passed) |
| a104 | l | 1029 (972) | 6/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | pandas | validated (20 passed) |
| a105 | l | 929 (972) | 6/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | numpy | validated (20 passed) |
| a106 | l | 991 (925) | 5/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | pandas | validated (19 passed) |
| a107 | l | 902 (925) | 6/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | pandas | validated (20 passed) |
| a108 | l | 938 (925) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | pandas | validated (20 passed) |
| a109 | l | 944 (925) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | pandas | validated (20 passed) |
| a110 | l | 861 (925) | 6/0/0 | 4+3 | 7/0 |  | 6 | 5 | yes | pandas | validated (20 passed) |
| a111 | l | 925 (925) | 6/0/0 | 4+3 | 7/0 |  | 6 | 4 | yes | pandas | validated (20 passed) |
| a112 | l | 871 (925) | 6/0/0 | 4+3 | 6/1 |  | 6 | 4 | yes | pandas | validated (19 passed) |
| a113 | p | 388 (388) | 5/0/0 | 4+3 | 6/1 |  | 5 | 5 | yes | pandas | validated (18 passed) |
| a114 | l | 913 (749) | 3/1/0 | 4+3 | 5/2 |  | 5 | 4 | yes | python | validated (16 passed) |
| a115 | l | 727 (749) | 1/3/0 | 4+3 | 5/2 |  | 5 | 4 | yes | pandas | validated (16 passed) |
| a116 | l | 738 (749) | 1/4/0 | 4+3 | 5/2 |  | 5 | 5 | yes | pandas | validated (17 passed) |
| a117 | l | 728 (749) | 1/4/0 | 4+3 | 5/2 |  | 5 | 5 | yes | pandas | validated (17 passed) |
| a118 | l | 732 (749) | 1/4/0 | 4+3 | 5/2 |  | 5 | 5 | yes | pandas | validated (17 passed) |
| a119 | l | 749 (749) | 1/4/0 | 4+3 | 5/2 |  | 5 | 4 | yes | pandas | validated (17 passed) |
| a120 | l | 757 (749) | 1/4/0 | 4+3 | 5/2 |  | 5 | 5 | yes | pandas | validated (17 passed) |
| a121 | l | 767 (749) | 1/4/0 | 4+3 | 5/2 |  | 5 | 7 | yes | pandas | validated (17 passed) |
| a122 | l | 781 (749) | 2/3/0 | 4+3 | 5/2 |  | 5 | 4 | yes | python | validated (17 passed) |
| a123 | p | 485 (485) | 2/2/0 | 4+3 | 5/2 |  | 5 | 5 | yes | pandas | validated (16 passed) |
| a124 | l | 837 (837) | 4/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | pandas | validated (16 passed) |
| a125 | l | 980 (837) | 5/0/0 | 4+3 | 5/2 |  | 5 | 7 | yes | pandas | validated (17 passed) |
| a126 | l | 810 (837) | 5/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | pandas | validated (17 passed) |
| a127 | l | 889 (837) | 5/0/0 | 4+3 | 5/2 |  | 5 | 8 | yes | pandas | validated (17 passed) |
| a128 | l | 962 (837) | 4/0/0 | 4+3 | 5/2 |  | 5 | 7 | yes | pandas | validated (16 passed) |
| a129 | l | 1021 (837) | 5/0/0 | 4+3 | 5/2 |  | 5 | 7 | yes | pandas | validated (17 passed) |
| a130 | l | 784 (837) | 5/0/0 | 4+3 | 6/1 |  | 5 | 7 | yes | pandas | validated (18 passed) |
| a131 | l | 853 (837) | 5/0/0 | 4+3 | 6/1 |  | 5 | 11 | yes | pandas | validated (18 passed) |
| a132 | l | 764 (837) | 5/0/0 | 4+3 | 6/1 |  | 5 | 9 | yes | pandas | validated (18 passed) |
| a133 | l | 801 (837) | 5/0/0 | 4+3 | 5/2 |  | 5 | 5 | yes | pandas | validated (17 passed) |
| a134 | l | 824 (837) | 4/0/0 | 4+3 | 6/1 |  | 5 | 3 | yes | python | validated (17 passed) |
| a135 | l | 945 (837) | 5/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | pandas | validated (17 passed) |
| a136 | l | 834 (837) | 5/0/0 | 4+3 | 6/1 |  | 5 | 5 | yes | pandas | validated (18 passed) |
| a137 | p | 340 (340) | 4/0/0 | 4+3 | 5/2 | 1 | 5 | 7 | yes | pandas | validated (16 passed) |
| a138 | l | 810 (786.5) | 5/0/0 | 4+3 | 5/2 |  | 5 | 7 | yes | pandas | validated (17 passed) |
| a139 | l | 773 (786.5) | 4/1/0 | 4+3 | 5/2 |  | 5 | 3 | yes | python | validated (17 passed) |
| a140 | l | 783 (786.5) | 5/0/0 | 4+3 | 5/2 | 1 | 5 | 9 | yes | pandas | validated (17 passed) |
| a141 | l | 790 (786.5) | 5/0/0 | 4+3 | 5/2 |  | 5 | 5 | yes | pandas | validated (17 passed) |
| a142 | p | 343 (343) | 4/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | pandas | validated (16 passed) |
| a143 | l | 882 (820) | 5/0/0 | 4+3 | 5/2 |  | 5 | 8 | yes | pandas | validated (17 passed) |
| a144 | l | 880 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 7 | yes | sql | validated (17 passed) |
| a145 | l | 723 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | sql | validated (17 passed) |
| a146 | l | 817 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | sql | validated (17 passed) |
| a147 | l | 749 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 7 | yes | sql | validated (17 passed) |
| a148 | l | 820 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 7 | yes | python | validated (17 passed) |
| a149 | l | 868 (820) | 5/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | sql | validated (18 passed) |
| a150 | l | 861 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 7 | yes | sql | validated (17 passed) |
| a151 | l | 817 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | python | validated (17 passed) |
| a152 | l | 877 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | python | validated (17 passed) |
| a153 | l | 788 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | sql | validated (17 passed) |
| a154 | l | 723 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 9 | yes | sql | validated (17 passed) |
| a155 | l | 871 (820) | 4/0/0 | 4+3 | 6/1 |  | 5 | 7 | yes | python | validated (17 passed) |
| a156 | p | 682 (682) | 4/0/0 | 4+3 | 6/1 |  | 5 | 9 | yes | sql | validated (17 passed) |
| a157 | l | 911 (877) | 5/1/0 | 4+3 | 6/1 | 1 | 5 | 8 | yes | python | validated (19 passed) |
| a158 | l | 839 (877) | 5/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | pandas | validated (18 passed) |
| a159 | l | 815 (877) | 5/0/0 | 4+3 | 6/1 |  | 5 | 5 | yes | pandas | validated (18 passed) |
| a160 | l | 1050 (877) | 5/1/0 | 4+3 | 6/1 |  | 5 | 7 | yes | pandas | validated (19 passed) |
| a161 | l | 853 (877) | 6/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | pandas | validated (19 passed) |
| a162 | l | 871 (877) | 6/0/0 | 4+3 | 7/0 |  | 5 | 7 | yes | pandas | validated (20 passed) |
| a163 | l | 1008 (877) | 5/1/0 | 4+3 | 6/1 |  | 5 | 7 | yes | python | validated (19 passed) |
| a164 | l | 877 (877) | 6/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | pandas | validated (19 passed) |
| a165 | l | 928 (877) | 5/1/0 | 4+3 | 6/1 |  | 5 | 7 | yes | python | validated (19 passed) |
| a166 | p | 450 (450) | 5/0/0 | 4+3 | 5/2 |  | 5 | 11 | yes | pandas | validated (17 passed) |
| a167 | l | 749 (785) | 6/0/0 | 4+3 | 5/2 |  | 5 | 13 | yes | sql | validated (18 passed) |
| a168 | l | 821 (785) | 6/0/0 | 4+3 | 5/2 |  | 5 | 7 | yes | pandas | validated (18 passed) |
| a169 | l | 848 (785) | 5/0/0 | 4+3 | 5/2 |  | 5 | 5 | yes | python | validated (17 passed) |
| a170 | l | 733 (785) | 5/0/0 | 4+3 | 5/2 |  | 5 | 13 | yes | pandas | validated (17 passed) |
| a171 | c | 665 (665) | 5/0/0 | 4+3 | 5/2 |  | 5 | 7 | yes | python | validated (17 passed) |
| a172 | c | 651 (548) | 3/0/0 | 3+3 | 5/1 | 1 | 5 | 7 | yes | pandas | validated (15 passed) |
| a173 | c | 511 (548) | 3/0/1 | 3+3 | 5/1 |  | 5 | 6 | yes | pandas | validated (16 passed) |
| a174 | c | 475 (548) | 3/0/0 | 3+3 | 5/1 |  | 5 | 7 | yes | pandas | validated (15 passed) |
| a175 | c | 523 (548) | 4/0/0 | 3+3 | 5/1 |  | 5 | 7 | yes | pandas | validated (16 passed) |
| a176 | c | 570 (548) | 4/0/0 | 3+3 | 5/1 |  | 5 | 7 | yes | pandas | validated (16 passed) |
| a177 | c | 519 (548) | 2/2/0 | 3+3 | 5/1 |  | 5 | 3 | yes | pandas | validated (16 passed) |
| a178 | c | 562 (548) | 3/0/0 | 3+3 | 5/1 |  | 5 | 4 | yes | pandas | validated (15 passed) |
| a179 | c | 548 (548) | 1/0/2 | 3+3 | 5/1 |  | 5 | 5 | yes | python | validated (15 passed) |
| a180 | c | 635 (548) | 3/0/0 | 3+3 | 5/1 |  | 5 | 5 | yes | python | validated (15 passed) |
| e091 | l | 1028 (899.5) | 5/1/0 | 4+3 | 7/0 |  | 5 | 4 | yes | python | validated (20 passed) |
| e092 | l | 973 (899.5) | 6/0/0 | 4+3 | 7/0 |  | 5 | 6 | yes | sql | validated (20 passed) |
| e093 | l | 905 (899.5) | 6/0/0 | 4+3 | 7/0 | 1 | 5 | 7 | yes | pandas | validated (20 passed) |
| e094 | l | 894 (899.5) | 6/0/0 | 4+3 | 7/0 |  | 5 | 6 | yes | python | validated (20 passed) |
| e095 | p | 737 (741) | 7/0/0 | 4+3 | 7/0 |  | 5 | 9 | yes | python | validated (21 passed) |
| e096 | l | 983 (899.5) | 2/2/0 | 4+3 | 6/1 | 1 | 5 | 5 | yes | pandas | validated (17 passed) |
| e097 | l | 884 (899.5) | 3/1/0 | 4+3 | 6/1 | 1 | 5 | 5 | yes | pandas | validated (17 passed) |
| e098 | l | 793 (899.5) | 3/1/0 | 4+3 | 6/1 |  | 5 | 6 | yes | pandas | validated (17 passed) |
| e099 | l | 838 (899.5) | 4/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (17 passed) |
| e100 | p | 745 (741) | 4/1/0 | 4+3 | 6/1 |  | 5 | 7 | yes | python | validated (18 passed) |
| e101 | l | 759 (832.5) | 3/1/0 | 4+3 | 6/1 |  | 5 | 4 | yes | python | validated (17 passed) |
| e102 | l | 899 (832.5) | 3/1/0 | 4+3 | 6/1 |  | 5 | 4 | yes | python | validated (17 passed) |
| e103 | l | 748 (832.5) | 2/2/0 | 4+3 | 6/1 |  | 5 | 4 | yes | python | validated (17 passed) |
| e104 | l | 826 (832.5) | 4/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (17 passed) |
| e105 | l | 926 (832.5) | 3/1/0 | 4+3 | 6/1 |  | 5 | 5 | yes | python | validated (17 passed) |
| e106 | l | 840 (832.5) | 3/1/0 | 4+3 | 6/1 |  | 5 | 5 | yes | python | validated (17 passed) |
| e107 | l | 843 (832.5) | 4/1/0 | 4+3 | 6/1 |  | 5 | 5 | yes | python | validated (18 passed) |
| e108 | l | 814 (832.5) | 3/1/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (17 passed) |
| e109 | l | 749 (832.5) | 4/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | pandas | validated (17 passed) |
| e110 | l | 839 (832.5) | 4/1/0 | 4+3 | 6/1 |  | 5 | 7 | yes | python | validated (18 passed) |
| e111 | l | 798 (832.5) | 3/1/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (17 passed) |
| e112 | l | 851 (832.5) | 6/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | sql | validated (19 passed) |
| e113 | p | 606 (606) | 4/1/0 | 3+3 | 5/1 |  | 5 | 6 | yes | python | validated (17 passed) |
| e114 | l | 730 (755) | 5/0/0 | 4+3 | 6/1 |  | 5 | 5 | yes | python | validated (18 passed) |
| e115 | l | 758 (755) | 5/0/0 | 3+3 | 5/1 |  | 5 | 5 | yes | pandas | validated (17 passed) |
| e116 | l | 788 (755) | 5/0/0 | 4+3 | 6/1 |  | 5 | 5 | yes | pandas | validated (18 passed) |
| e117 | l | 755 (755) | 5/0/0 | 4+3 | 7/0 |  | 5 | 9 | yes | python | validated (19 passed) |
| e118 | l | 742 (755) | 1/4/0 | 4+3 | 6/1 |  | 5 | 5 | yes | python | validated (18 passed) |
| e119 | p | 452 (452) | 4/1/0 | 3+3 | 5/1 |  | 5 | 6 | yes | pandas | validated (17 passed) |
| e120 | l | 732 (771) | 5/0/0 | 3+3 | 5/1 |  | 5 | 6 | yes | python | validated (17 passed) |
| e121 | l | 726 (771) | 5/0/0 | 3+3 | 5/1 |  | 5 | 6 | yes | python | validated (17 passed) |
| e122 | l | 744 (771) | 5/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (18 passed) |
| e123 | l | 834 (771) | 5/0/0 | 4+3 | 6/1 |  | 5 | 5 | yes | python | validated (18 passed) |
| e124 | l | 815 (771) | 5/0/0 | 3+3 | 5/1 |  | 5 | 6 | yes | python | validated (17 passed) |
| e125 | l | 790 (771) | 5/0/0 | 4+3 | 6/1 |  | 5 | 7 | yes | python | validated (18 passed) |
| e126 | l | 737 (771) | 5/0/0 | 4+3 | 6/1 |  | 5 | 9 | yes | python | validated (18 passed) |
| e127 | l | 771 (771) | 5/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (18 passed) |
| e128 | l | 864 (771) | 5/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (18 passed) |
| e129 | l | 811 (771) | 5/0/0 | 4+3 | 6/1 |  | 5 | 7 | yes | python | validated (18 passed) |
| e130 | l | 725 (771) | 5/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (18 passed) |
| e131 | p | 465 (465) | 4/0/0 | 3+3 | 5/1 |  | 5 | 7 | yes | python | validated (16 passed) |
| e132 | l | 952 (866) | 6/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | pandas | validated (19 passed) |
| e133 | l | 809 (866) | 5/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | pandas | validated (18 passed) |
| e134 | l | 818 (866) | 5/1/0 | 4+3 | 6/1 |  | 5 | 5 | yes | pandas | validated (19 passed) |
| e135 | l | 866 (866) | 6/0/0 | 4+3 | 6/1 |  | 5 | 9 | yes | sql | validated (19 passed) |
| e136 | l | 950 (866) | 5/0/0 | 4+3 | 7/0 |  | 5 | 4 | yes | python | validated (19 passed) |
| e137 | l | 911 (866) | 5/0/0 | 4+3 | 7/0 |  | 5 | 4 | yes | python | validated (19 passed) |
| e138 | l | 857 (866) | 2/0/3 | 4+3 | 6/1 |  | 5 | 5 | yes | python | validated (18 passed) |
| e139 | l | 861 (866) | 5/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | python | validated (19 passed) |
| e140 | l | 942 (866) | 3/0/2 | 4+3 | 5/2 |  | 5 | 4 | yes | python | validated (17 passed) |
| e141 | p | 527 (527) | 3/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | python | validated (17 passed) |
| e142 | l | 992 (903) | 5/0/0 | 4+3 | 7/0 |  | 5 | 5 | yes | sql | validated (19 passed) |
| e143 | l | 1035 (903) | 6/0/0 | 4+3 | 7/0 |  | 5 | 6 | yes | sql | validated (20 passed) |
| e144 | l | 918 (903) | 5/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | sql | validated (18 passed) |
| e145 | l | 910 (903) | 5/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | sql | validated (18 passed) |
| e146 | l | 824 (903) | 6/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | sql | validated (19 passed) |
| e147 | l | 896 (903) | 5/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | sql | validated (18 passed) |
| e148 | l | 854 (903) | 5/0/0 | 4+3 | 6/1 |  | 5 | 7 | yes | sql | validated (18 passed) |
| e149 | l | 955 (903) | 6/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | sql | validated (19 passed) |
| e150 | l | 798 (903) | 6/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | sql | validated (19 passed) |
| e151 | l | 870 (903) | 6/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | sql | validated (19 passed) |
| e152 | p | 569 (569) | 5/0/0 | 3+3 | 5/1 |  | 5 | 5 | yes | sql | validated (17 passed) |
| e153 | l | 816 (798) | 1/0/4 | 3+3 | 5/1 |  | 5 | 3 | yes | python | validated (17 passed) |
| e154 | l | 838 (798) | 1/0/5 | 3+3 | 5/1 |  | 5 | 3 | yes | python | validated (18 passed) |
| e155 | l | 780 (798) | 4/0/0 | 4+3 | 5/2 |  | 5 | 3 | yes | python | validated (16 passed) |
| e156 | l | 744 (798) | 2/0/2 | 3+3 | 5/1 |  | 5 | 3 | yes | python | validated (16 passed) |
| e157 | l | 750 (750) | 4/0/0 | 4+3 | 5/2 |  | 5 | 5 | yes | python | validated (16 passed) |
| e158 | l | 712 (750) | 4/0/0 | 4+3 | 5/2 |  | 5 | 5 | yes | python | validated (16 passed) |
| e159 | l | 718 (750) | 4/0/0 | 4+3 | 5/2 |  | 5 | 5 | yes | python | validated (16 passed) |
| e160 | l | 917 (750) | 6/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | python | validated (18 passed) |
| e161 | l | 898 (750) | 6/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | python | validated (18 passed) |
| e162 | p | 320 (320) | 4/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | python | validated (16 passed) |
| e163 | l | 745 (860) | 6/0/0 | 4+3 | 5/2 |  | 5 | 7 | yes | python | validated (18 passed) |
| e164 | l | 827 (860) | 10/0/0 | 4+3 | 5/2 | 1 | 5 | 7 | yes | pandas | validated (22 passed) |
| e165 | l | 860 (860) | 8/0/0 | 4+3 | 5/2 |  | 5 | 10 | yes | sql | validated (20 passed) |
| e166 | l | 1003 (860) | 5/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | sql | validated (17 passed) |
| e167 | l | 1036 (860) | 6/0/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (19 passed) |
| e168 | p | 636 (636) | 6/0/0 | 4+3 | 6/1 |  | 5 | 9 | yes | python | validated (19 passed) |
| e169 | l | 867 (886) | 5/0/0 | 4+3 | 6/1 |  | 5 | 13 | yes | sql | validated (18 passed) |
| e170 | l | 905 (886) | 5/0/0 | 4+3 | 6/1 |  | 5 | 10 | yes | python | validated (18 passed) |
| e171 | l | 886 (886) | 5/0/0 | 4+3 | 6/1 |  | 5 | 10 | yes | sql | validated (18 passed) |
| e172 | c | 731 (731) | 5/0/0 | 4+3 | 6/1 |  | 5 | 10 | yes | python | validated (18 passed) |
| e173 | c | 656 (613.5) | 4/0/0 | 4+3 | 5/2 |  | 5 | 6 | yes | python | validated (16 passed) |
| e174 | c | 613 (613.5) | 4/1/0 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (18 passed) |
| e175 | c | 613 (613.5) | 5/0/0 | 4+3 | 6/1 | 1 | 5 | 8 | yes | python | validated (18 passed) |
| e176 | c | 603 (613.5) | 5/0/0 | 4+3 | 6/1 |  | 5 | 8 | yes | python | validated (18 passed) |
| e177 | c | 612 (613.5) | 5/0/0 | 4+3 | 6/1 |  | 5 | 12 | yes | python | validated (18 passed) |
| e178 | c | 654 (613.5) | 4/0/1 | 4+3 | 6/1 |  | 5 | 7 | yes | python | validated (18 passed) |
| e179 | c | 614 (613.5) | 2/0/3 | 4+3 | 6/1 |  | 5 | 6 | yes | python | validated (18 passed) |
| e180 | c | 652 (613.5) | 5/0/0 | 4+3 | 5/2 |  | 5 | 9 | yes | python | validated (17 passed) |
<!-- LESSON TABLE END -->

### 3.1 Totals from the real files

| Measure | Common (90) | Analyst (90) | Engineer (90) | All 270 |
| --- | --- | --- | --- | --- |
| Runnable examples in browser and tests (`python run`, `sql run`) | 479 | 388 | 412 | 1279 |
| `python local` examples (tests only) | 4 | 43 | 24 | 71 |
| `bash run` examples (tests only) | 22 | 3 | 20 | 45 |
| Guided exercises | 359 | 351 | 349 | 1059 |
| Independent exercises | 270 | 270 | 270 | 810 |
| Auto-graded exercises | 620 | 499 | 527 | 1646 |
| Written (self-assessed) exercises | 9 | 122 | 92 | 223 |
| Knowledge-check questions | 497 | 459 | 450 | 1406 |
| Lessons with an environment note | 7 | 44 | 39 | 90 |
| Lessons with an explicit debug/fix exercise (title match) | 4 | 6 | 5 | 15 |

These match `DAILY_LEARNING_CONTENT_COVERAGE.md` (which `node scripts/daily-coverage.mjs` regenerates and which was confirmed current: 1279, 71, 45, 1059, 810, 1646, 223, 1406).

Exercise kinds: 1259 Python, 387 SQL, 223 written. Only 15 exercises across 15 lessons are explicitly a debugging or repair task (d001, d048, d061, d071, a092, a098, a137, a140, a157, a172, e093, e096, e097, e164, e175); 255 lessons have none. The "Common mistakes" section exists in all 270 lessons, so debugging is taught in prose but rarely practised.

### 3.2 Shallow lessons

Threshold: Understand words under 60% of the median for the same phase and kind (lesson versus project, checkpoint or capstone). Result: 0 lessons. The lowest ratios are d079 and d083 (0.77) and d082 (0.78). In absolute terms the shortest are the projects e162 (320 words), a137 (340), a142 (343) and a113 (388); the test's own floor for project days is 250. Median Understand words across all lessons is 826, minimum 320, maximum 1202.

## 4. Defects and advisories

### 4.1 Confirmed defect outside the lessons: SQL question 19

`frontend/public/data/q/q19-customers-above-average-revenue-using-cte.json` has the right title, objective, tables and sample output ("customers above average revenue"), but its `solution` and `referenceQuery` are the recursive employee-reporting-chain query of Q197 (`WITH RECURSIVE chain ... FROM employees`). `mySolution` is the correct customers query. Detected by checking every question's reference query against its declared `tables` (only Q19 fails: it reads `employees`, declares `customers, orders, order_details`). Effect: `submit()` grades against `referenceQuery`, so a correct answer to Q19 can never match; the Daily lesson d046 links to Q19.

Not edited. The coordination rule allows edits to `frontend/public/data/q/**` only when the data is generated from `questions/` and the generator is rerun. It is not: `scripts/build_public_data.py` builds it from the sibling `northwind-sql-practice` repository, which is not in this checkout, and `questions/questions.json` is stale (89 questions against 150). Proposed fix for whoever owns the source: set `solution` and `referenceQuery` of Q19 to its `mySolution`, then rerun the generator from the corrected source markdown. Interface request raised.

### 4.2 Expected-output samples in the SQL question bank are illustrative

135 of 150 `expectedOutput` fields say the sample values are illustrative. A heuristic comparison of the last sample table in each against the real result of `referenceQuery` on the Northwind database (run in PGlite) found: all shown rows appear in the real output for 55 questions, some or none do for 93, 2 could not be compared (Q190 and Q191 are multi-statement), 10 have a different column list from the sample. The heuristic takes only the last table of a multi-table description and rounds numbers, so treat 93 as an upper bound; it still shows the sample must not be presented as an expected result. The workspace should display the description of the columns and, if it shows rows, compute them from `referenceQuery`.

### 4.3 Advisory: forward links from lessons to SQL questions

14 link instances (7 common-core lessons) point at a practice question whose reference solution uses a SQL idea taught later in the programme. They are links to optional practice, every one of these lessons has other links, and nothing breaks, so they were not edited. A curation pass could swap them for same-topic questions that need only earlier ideas.

| Lesson | Question | Later idea used (day taught) |
| --- | --- | --- |
| d033 | Q170 | CASE (38) |
| d037 | Q192 | JOIN (40) |
| d037 | Q193 | CTE (46), subquery (43), JOIN (40) |
| d038 | Q182 | JOIN (40), LEFT JOIN (41) |
| d039 | Q160 | JOIN (40) |
| d043 | Q6 | CTE (46) |
| d044 | Q184, Q185, Q187 | CTE wrapping `RETURNING` (46) |
| d046 | Q19 | recursive CTE (54) and set operator (47): the Q19 defect above, disappears when it is fixed |

Python exercise links were checked the same way (numpy needs Day 63, pandas Day 68): no common-core lesson links a Python exercise that needs a later library.

### 4.4 Advisory: "Day N" signposts that look forward

131 mentions of a later day number (for example "Day 108 returns to that") in the prose of lessons, outside the Next-day section. They are signposts, not uses of untaught ideas. The authoring brief says to avoid "covered on Day N", so they are a style deviation only.

### 4.5 No filler found

No `TODO`, `TBD`, `FIXME` or lorem text in lesson prose or JSON (the only matches are the word in code of e179's README linter). No paragraph of 140 or more characters (code fences removed) is repeated across any two lessons; the suite checks this for the Understand section only, this search covered all sections.

## 5. Prerequisites

All 270 are valid: every id exists, is on the common route or the lesson's own route, and has a smaller day number (checked by the suite and again by `scripts/daily-audit.mjs`). Shape: 1 lesson (d001) has none, 256 have exactly one, 13 have two. Duplicate prerequisite ids: none.

The chain is structural: 250 lessons list their immediate predecessor on the route (d001 has no predecessor). The 19 that do not are the starts of a phase, and each points to a sensible earlier day: a101, a106, a114, a124, a138, a143, a157, a167, a172, e101, e114, e120, e132, e142, e153, e157, e163, e169, e173 (for example a124 Power BI depends on a099 Power Query plus d090; e157 Airflow depends on e131, the incremental ETL project; e153 Linux depends on d030 Git plus d090). Limits of this check: it proves ordering, not that each lesson's prerequisite list covers every idea the lesson uses; prerequisites are a chain, not a concept graph, so a branch lesson lists its predecessor (a158 lists only a157), not every earlier day whose ideas it reuses. The five titles shared by an analyst and an engineer lesson (a158/e115, a159/e116, a167/e169, a171/e172, a180/e180) are deliberate parallel lessons with different content, not duplicates.

## 6. Duplicate and near-duplicate questions

Method: 2169 exercises (1869 Daily guided and independent, 150 Python library, 150 SQL bank). (1) Prompts reduced to word 3-grams after masking numbers and code spans, compared by Jaccard similarity (0.6 or more). (2) Solutions with identifiers, strings and numbers masked, compared for equality when 70 or more characters long. (3) Same title and kind. (4) Sequence similarity for each candidate pair. Same prompt with only renamed variables did not appear; what exists is below.

| Group | Members | Judgement |
| --- | --- | --- |
| Same task, different style | a167/g1 (interview anti-join), e169/g1 (same task, LEFT JOIN style), Q28 Customers with no orders | Real near-duplicate (solution similarity 0.76 to 0.79). Spiral review across the interview days and the SQL bank, but a learner who did Q28 meets it a third time. |
| Same task | d041/g1 Products nobody ordered and Q29 Products never ordered | Real near-duplicate (solution similarity 0.92). |
| Same task | Q29 and Q30 (prompt similarity 1.0) | Real in the SQL bank: "join key filter" variant of the same question. |
| Parallel templates | d058/i3, d059/g1, d059/g3, d059/i1: each says "create an index X, `SET LOCAL enable_seqscan = off`, return the EXPLAIN plan of query Y" | Deliberate template with different index and query. |
| Same data, next step | d056/g3 and g4 (funnel steps then LAG), e110/g1 and g2 (upsert then DO NOTHING), e144/g2 and g4 (two facts joins) | Deliberate sequences. |
| Same idea, restated in a later project | e110/g1 and e126/g1 (upsert, solution 0.54), e094/g3 and e176/g3 (PostgreSQL upsert), e112/g4 and e119/g2 (moving average) | Spiral practice, different wording and data. |
| Same title only | a095/g1 and a168/g2 "SUMIFS replica"; a105/g4 and a169/g2 "Two-proportion z-test"; a113/g1, a166/g1 and e141/g2 "Row accounting"; e129/g1 and e160/g2 "Backoff delays"; e161/g3 and `log-level-counts`; e165/g2 and Q147 "Latest order per customer"; d066/g3 and `running-totals`; d032/i3 and Q164 | Title collision with different prompts and code (prompt similarity under 0.45). Not duplicates. |

Within the Python library no two exercises share a prompt or a normalised solution. Between Daily and the Python library the only overlaps are the title collisions above.

## 7. Exercise metadata against the target checklist

Three formats exist: the SQL question JSON (150 files in `frontend/public/data/q/`), the Python exercise markdown (150 files in `content/python/`: front matter, sections and a `task` JSON block) and the Daily lesson JSON (1869 exercises). Counts are over files that carry a non-empty value.

| Checklist item | SQL question JSON (150) | Python md (150) | Daily JSON (1869 exercises) |
| --- | --- | --- | --- |
| Difficulty | 150 (`difficulty`: Easy 50, Medium 60, Hard 37, plus Expert 2 and Advanced 1, three values off the 3-level scale) | 150 (Easy 50, Medium 60, Hard 40) | 0 per exercise. Only lesson `kind`, phase level and guided versus independent; 253 exercises carry `required: false` (stretch) |
| Topic and subtopic | 150 `topic` (16 slugs) and `category` | 150 `topic` (19 slugs), `category` (6), `skill` | 0 per exercise. Lesson `topics` in `curriculum.json` |
| Learning objectives | 150 single `objective` sentence | 150 `## Objective` | 0 per exercise. Lesson `## Objectives` (3 or more bullets, 270 lessons) |
| Business context | 150 `problem` | 150 `## Scenario` | 0 as a field; the prompt sometimes carries it |
| Expected output | 150 `expectedOutput` (markdown column table plus a sample, 133 labelled illustrative and not verified, section 4.2) | 150 `## Examples` and `## Output format`, free text | 1259 Python `expected` (exact stdout). SQL: none stored, the solution's result is the expectation (387). Written: none |
| Starter code | 0 (no field) | 150 (`starter`) | 1869 (`starter`; written ones carry a scaffold) |
| Test cases | 0 explicit: graded by comparing the learner's result set with `referenceQuery`, `sortRequired`, `orderBy` (150) | 150 `tests` (visible asserts) and 150 `hidden` | 0 explicit. Python: output equals `expected` (1259). SQL: result equals the solution's, `ordered` on 354 of 387. No hidden tests; 8 exercises use `stdin` |
| Concepts | 150 `concepts` (list) | 150 `concepts` (comma text) | 0 per exercise |
| Common mistakes | 150 `pitfalls` (avg 3.4), 17 with `myMistakes`, 150 `watchOutFor` | 0 | 0 per exercise. Lesson `### Common mistakes` in 270 lessons |
| Progressive hints (target 5 levels) | 0 hints. `approach` (numbered steps) and `watchOutFor` could seed levels 2 and 4 | 150 with 2 hints (124) or 3 (26) | Guided: exactly 3 hints on 1059 (the suite enforces 3). Independent: none by rule (810). No format has 5 |
| Debugging explanation | 0 (`pitfalls` is the nearest) | 0 | 0. 15 exercises are repair tasks but have no explanation field |
| Solution explanation | 150 `why` and `approach` | 150 `explanation` | 0 per exercise (code only). Written: model answer plus 2 to 5 rubric items (223) |
| Alternative solutions | 0. `mySolution` differs from `solution` on 23 but is the author's first attempt, not labelled an alternative | 0 | 0 |
| Complexity | 0 | 150 (`time`, `space`) | 0 |
| Interview relevance | 0 (every note has an "Interview questions" section, the questions do not) | 150 `## Why it matters` (practical rather than interview-specific) | 0 per exercise. Lesson `### Real-world applications` (270); 9 interview-phase lessons |
| Related exercises | 62 `related` (question numbers) | 0 | 0 per exercise. Lesson `links` (all 270, 2 to 13 each) |
| Next recommended concept | 150 `followups` (avg 3.8 follow-up questions) are the nearest; no explicit next | 0 | 0 per exercise. Lesson `## Next-day preparation` (270) |

Reading: the SQL bank and Python library are rich in explanation and weak in hints; the Daily exercises are the opposite (hints and graded code, little explanation). No existing format has 5 hint levels, a debugging explanation or alternative solutions. Agent 1's converters should therefore derive levels 1 to 4 from what exists (Daily: 3 hints plus the lesson's Common mistakes; SQL: `watchOutFor`, `approach`, `why`; Python: `Hints` plus `explanation`) and leave missing levels empty, as `types.ts` already allows. Level 5 is the stored solution. Anything beyond that would be invented content, so it was not generated.

Daily exercise supply per workspace domain (from the real kinds and solution imports): 387 SQL, 674 plain Python, 522 pandas, 63 NumPy, 223 written (no workspace). The Python library has only 3 pandas and 1 NumPy exercise (4 files import either), so the pandas and NumPy workspace has almost no standalone library exercises; its supply is the Daily lessons.

## 8. Learning-path coverage

Paths and their sources are in `lib/learnPaths.ts`: SQL Developer = phases `sql-fundamentals`, `sql-advanced` (d031 to d060) plus the 18-lesson SQL course; Python for Data = phases d001 to d085; Data Analyst = 90 common-core days plus the 90 analyst days; Data Engineer = 90 common-core days plus the 90 engineer days. Resources: 167 theory notes in 15 categories, 150 Python exercises, 150 SQL questions, 16 scenarios, 12 projects, patterns, mind maps. Lesson body mentions below mean a lesson that uses a term 3 or more times; they are a heuristic.

### 8.1 SQL Developer

| Topic | Lessons | Practice and notes | Workspace |
| --- | --- | --- | --- |
| SELECT, WHERE, ORDER BY, NULL | d031 to d035 | course lessons 01 to 04; notes `fundamentals` (10) | sql |
| Aggregation, GROUP BY, HAVING | d036, d037 | notes `aggregations` (9); questions `aggregations` 6, `group-by-having` 5 | sql |
| CASE, string, date functions | d038, d039 | questions `case-conditional` 8, `string-functions` 9, `date-time` 13 | sql |
| Joins (inner, outer, self, cross) | d040 to d042 | notes `joins` (9); questions on joins 53 | sql (join preset) |
| Subqueries, EXISTS | d043, d048 | notes `subqueries` (4); `correlated-subqueries` 8 | sql |
| INSERT, UPDATE, DELETE, DDL, constraints | d044, d045, d060 | questions `dml-ddl` 8 | sql |
| CTEs, recursive CTEs | d046, d054 | notes `ctes` (4); questions `cte` 7 | sql |
| Set operators | d047 | notes `set-operators` (4); questions 13 | sql (setops) |
| Window functions | d049 to d053 | notes `window-functions` (13); questions 14 | sql |
| Dedup, gaps and islands, cohorts | d055, d056 | scenarios (16) | sql |
| Indexes, EXPLAIN, optimisation | d057 to d059 | notes `advanced-sql` (12); no SQL question practises plans | sql (plan) |
| Transactions, views | d060 | course lesson 18 | sql |

Real gaps (no lesson, no practice): stored functions, procedures and triggers (0 lessons, 3 body mentions of "trigger"); transaction isolation levels and locking (0); LATERAL joins (0); materialized views (3 body mentions, no lesson); temporary tables (1 mention); JSON and array operators in SQL (JSON is taught from Python only); PIVOT and `crosstab` (partial, in a few lessons); roles and GRANT (only file permissions in d029). The SQL bank has no plan-reading questions although d057 to d059 teach them.

### 8.2 Python for Data

| Topic | Lessons | Practice and notes |
| --- | --- | --- |
| Syntax, types, strings, control flow, collections, functions | d001 to d018 | 21 `python` notes; library `python-collections` 34, `python-functions` 10, `python-fundamentals` 4 and others |
| Files, CSV, JSON, dates, modules, venv | d019 to d023 | library `python-file-handling` 12, `python-csv-json` 12, `python-modules-packages` 4 |
| OOP, dataclasses, iterators, generators, decorators, context managers, regex | d024 to d028 | library `python-oop` 14, `python-regex` 5 |
| Command line, Git | d029, d030 | |
| Testing with pytest | d061, d062 | tests only; `bash run` examples |
| NumPy | d063 to d067 | library has 1 `python-numpy` exercise |
| pandas | d068 to d085 | library has 3 `python-pandas` exercises |
| Statistics foundations | d086 to d090 | scipy used by 44 Daily exercises |

Real gaps: type hints (0 lessons), `asyncio` and threading (0), `argparse` or a CLI (9 body mentions, no lesson), pydantic (1 mention, listed in requirements only), packaging beyond venv and pip. The Python library is data-engineering flavoured (`etl` 25, `processing` 32, `files` 21, `dsa` 25) with almost no pandas or NumPy exercises.

### 8.3 Data Analyst

| Topic | Lessons | Notes on running it |
| --- | --- | --- |
| Excel formulas, lookups, PivotTables, Power Query | a091 to a100 (10) | No Excel runtime. Each is a pandas replica plus 20 written exercises. Excel Lab visual exists |
| Statistics, hypothesis tests, A/B | a101 to a105 | scipy in 44 and statsmodels in 7 solution imports |
| EDA | a106 to a113 | pandas |
| Charts: matplotlib, seaborn, plotly | a114 to a123 | 8 Python and 42 pandas graded exercises; `python local` for plotting |
| Power BI model, DAX, dashboards | a124 to a137 (14) | No Power BI runtime. pandas and SQL replicas of every DAX idea, 23 written exercises. All 14 are flagged "generic fit" in `dailyVisual` |
| Storytelling, dashboards, KPIs | a138 to a142 | |
| Business analytics (RFM, churn, funnel, forecast, pricing) | a143 to a156 | 34 SQL, 40 Python |
| SQL and Python for analysts | a157 to a166 | |
| Interview prep and capstone | a167 to a180 | |

Real gaps: Tableau, Looker and Google Sheets (0 mentions); machine learning basics such as clustering or scikit-learn (0); survey analysis (1 mention); forecasting and time series only one lesson each (a152, e112); A/B testing one lesson (a105). Power BI and DAX content exists (14 lessons) but cannot run in the browser, which is a runtime gap rather than a content gap.

### 8.4 Data Engineer

| Topic | Lessons | Notes |
| --- | --- | --- |
| CSV and Excel ingestion into PostgreSQL | e091 to e100 | `sqlite3` stand-in for PostgreSQL in the Python exercises (122 exercises use `sqlite3`) |
| REST APIs | e101 to e113 | no network; a seeded stand-in API |
| SQL plus Python analytics | e114 to e119 | |
| ETL, incremental loading, CDC, upsert | e120 to e131 | notes `etl` (15), `airflow` (14) |
| Data quality | e132 to e141 | |
| Warehousing, star schema, SCD | e142 to e152 | notes `warehousing` (13); 58 SQL graded exercises |
| Linux, shell, cron, Docker, project layout | e153 to e156 (plus d029) | `bash run` tests only; Docker has one lesson (e155); Linux Lab visual exists |
| Airflow | e157 to e162 | 14 notes, DAG simulator; DAGs shown as code and run as pure Python; Airflow itself never runs |
| Spark | e163 to e168 | 15 notes; PySpark shown as code, pandas and SQL stand-ins; Spark never runs |
| Interview prep and capstone | e169 to e180 | |

Real gaps (a note or project exists, but no lesson): dbt (11 notes and the `dbt-analytics-project` project, 0 lessons); cloud (13 notes covering AWS, GCP, Azure, IAM, object storage, warehouses, cost; 0 lessons and only 7 body mentions of S3 or AWS); streaming and Kafka (1 note, 0 lessons); data lakes and lakehouse formats (1 note, Parquet in one lesson, Delta or Iceberg 0). No dedicated note and no lesson: Terraform (one bullet in each of the AWS and Azure overview notes recommends it, nothing teaches it; section 12.4), Kubernetes, CI/CD pipelines beyond Git (e179), data catalog, lineage and governance, ingestion tools such as Airbyte or Fivetran, Great Expectations (1 Python exercise mention).

The four tools named in the brief: Power BI (14 lessons, no runtime), Airflow (6 lessons plus 14 notes, simulated), Spark (6 lessons plus 15 notes, stand-ins), Linux (d029 and e153 to e156, tests-only shell). None needs a new lesson; each needs an honest runtime limitation, which `environment` notes and the generic-fit labels already state. No duplicate lessons were created.

## 9. Workspace integration map

Implemented in `frontend/src/site/lib/visual/dailyVisual.ts` (additive; the existing 216-to-270 aid mapping is unchanged), generated and checked by `frontend/scripts/daily-workspace-map.mjs`, tested by `frontend/src/test/siteVisualCoverageWorkspace.test.ts`.

API (pure, no imports):

| Export | Returns |
| --- | --- |
| `workspaceDomainOfExercise(kind, solutionCode)` | `"sql"`, `"python"`, `"pandas"`, `"numpy"` or `null` (written). SQL kind gives sql. Python: imports pandas gives pandas, else imports only numpy gives numpy, else python |
| `exerciseWorkspaceDomain(dayId, exerciseId)` | Domain of one exercise (`"g1"`, `"i2"`), `null` for written, `undefined` for an unknown id. Reads the generated `WORKSPACE_EXERCISES` table |
| `lessonWorkspace(dayId, title, topics)` | `{ primary, domains, graded, written, presets }`: the lesson's main domain and counts per domain |
| `exerciseWorkspace(dayId, exerciseId, title, topics)` | `{ domain, presets, packages }` or `null` for a written exercise |
| `workspacePresetsFor(domain, text)` | Starting visualization presets, from title and topics |
| `extraPackagesOf(solution)`, `WORKSPACE_EXTRA_PACKAGES` | scipy or statsmodels imports, 51 exercises in 11 lessons |

Preset ids (opaque strings that name what the real engines can show; the adapter ignores any it lacks): sql `stages`, `join`, `setops`, `plan`, `compare`; python `trace`, `variables`, `callStack`; pandas `beforeAfter`, `merge`, `groupby`, `reshape`; numpy `shapes`, `broadcast`. They fit `ExerciseDef.visualization.presets`.

Graded exercises per domain: 387 sql, 674 python, 522 pandas, 63 numpy; 223 written have no workspace. By phase (graded exercises, then lessons by primary domain):

| Phase | Route | Days | sql | python | pandas | numpy | written | Lessons by primary domain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python-fundamentals | common | 15 | 0 | 105 | 0 | 0 | 0 | python 15 |
| python-intermediate | common | 15 | 0 | 100 | 0 | 0 | 5 | python 15 |
| sql-fundamentals | common | 15 | 105 | 0 | 0 | 0 | 0 | sql 15 |
| sql-advanced | common | 15 | 105 | 0 | 0 | 0 | 0 | sql 15 |
| python-testing | common | 2 | 0 | 12 | 0 | 0 | 2 | python 2 |
| numpy | common | 5 | 0 | 0 | 0 | 34 | 0 | numpy 5 |
| pandas | common | 18 | 0 | 0 | 125 | 0 | 1 | pandas 18 |
| statistics-foundations | common | 5 | 0 | 12 | 13 | 9 | 1 | pandas 2, python 2, numpy 1 |
| excel | analyst | 10 | 0 | 1 | 49 | 0 | 20 | pandas 10 |
| analyst-statistics | analyst | 5 | 0 | 4 | 11 | 17 | 3 | pandas 2, numpy 3 |
| eda | analyst | 8 | 0 | 1 | 53 | 0 | 2 | pandas 8 |
| visualisation | analyst | 10 | 0 | 8 | 42 | 0 | 20 | python 2, pandas 8 |
| power-bi | analyst | 14 | 0 | 14 | 61 | 0 | 23 | pandas 13, python 1 |
| storytelling | analyst | 5 | 0 | 10 | 15 | 0 | 10 | pandas 4, python 1 |
| business-analytics | analyst | 14 | 34 | 40 | 8 | 1 | 15 | sql 9, python 4, pandas 1 |
| analyst-data-prep | analyst | 10 | 9 | 18 | 33 | 0 | 10 | pandas 7, python 3 |
| analyst-interview | analyst | 5 | 5 | 9 | 9 | 2 | 10 | pandas 2, python 2, sql 1 |
| analyst-capstone | analyst | 9 | 0 | 13 | 32 | 0 | 9 | pandas 7, python 2 |
| ingestion-csv-excel | engineer | 10 | 9 | 31 | 25 | 0 | 5 | python 5, pandas 4, sql 1 |
| rest-api | engineer | 13 | 8 | 60 | 9 | 0 | 13 | python 11, pandas 1, sql 1 |
| sql-python-eng | engineer | 6 | 4 | 17 | 14 | 0 | 5 | python 3, pandas 3 |
| etl | engineer | 12 | 8 | 60 | 0 | 0 | 12 | python 12 |
| data-quality | engineer | 10 | 14 | 36 | 13 | 0 | 7 | python 6, pandas 3, sql 1 |
| warehousing | engineer | 11 | 58 | 9 | 0 | 0 | 9 | sql 11 |
| linux-tools | engineer | 4 | 0 | 20 | 0 | 0 | 5 | python 4 |
| airflow | engineer | 6 | 0 | 30 | 0 | 0 | 12 | python 6 |
| spark | engineer | 6 | 10 | 12 | 10 | 0 | 10 | python 3, sql 2, pandas 1 |
| engineer-interview | engineer | 4 | 10 | 14 | 0 | 0 | 4 | sql 2, python 2 |
| engineer-capstone | engineer | 8 | 8 | 38 | 0 | 0 | 10 | python 8 |

Lessons by primary domain: python 109, pandas 94, sql 58, numpy 9; 105 of the 270 mix two or more domains (for example a business-analytics lesson with SQL and pandas exercises), so launch per exercise, not per lesson, when the domain matters. Decisions that follow from the real content:

- Excel (a091 to a100) and Power BI (a124 to a137) lessons launch the pandas workspace, because the graded exercises are pandas replicas of the formula or DAX idea. The written exercises (20 and 23) have no workspace. The pandas visualizer shows the table before and after; it does not show Excel or DAX, and the UI should say so (dailyVisual already marks Power BI as a generic fit).
- Airflow (e157 to e162) and Spark (e163 to e168) launch plain Python or pandas, not a DAG or Spark visualizer. Airflow tasks are plain Python functions, Spark exercises use pandas and SQL stand-ins.
- ETL, REST API and ingestion lessons mostly use Python with `sqlite3` (122 exercises). That is the Python workspace, not the SQL one: SQL on PGlite is only for `kind: "sql"` exercises. The SQL workspace needs multi-statement blocks for the 117 SQL exercises that create their own tables first (99 of them in the engineer route); `ordered` is set on 354 of 387.
- 51 exercises in 11 lessons import scipy or statsmodels (the suite allows them in the browser). Agent 3's Python adapter must load those two Pyodide packages or hide Run for them; `exerciseWorkspace().packages` lists them.
- 71 `python local` and 45 `bash run` examples are lesson examples, not exercises. They are not workspace candidates (the browser cannot run them). Exercises are always browser-runnable: the suite requires browser-safe imports for every Python solution.
- 8 Python exercises read `stdin`; the adapter should support the existing `stdin` field of `python-stdout` validation.

## 10. Interface requests

Appended to `docs/WORKSPACE_COORDINATION.md`. In short: (1) coordinator or source owner: fix Q19; (2) Agent 1: use `exerciseWorkspace()` and `lessonWorkspace()` in the daily converter, derive hints as described in section 7 and do not show `expectedOutput` rows of the SQL bank as verified results; (3) Agent 3: scipy and statsmodels for 51 exercises, `stdin`; (4) Agent 2: multi-statement SQL blocks and the Daily `ordered` flag; (5) coordinator: `components/daily/*` can use `lessonWorkspace()` to offer "Open in workspace" per exercise.

## 11. What was changed in this task

| File | Change |
| --- | --- |
| `frontend/src/site/lib/visual/dailyVisual.ts` | Added the workspace domain section (types, classifier, generated table, lookups, presets). Nothing above it changed |
| `frontend/scripts/daily-workspace-map.mjs` (new) | Generates and checks the table in `dailyVisual.ts` from the real lesson JSON |
| `frontend/scripts/daily-audit.mjs` (new) | Per-lesson audit and the table in section 3; reads a vitest JSON report for status |
| `frontend/src/test/siteVisualCoverageWorkspace.test.ts` (new) | 11 tests: classifier, table equals the real JSON for all 1869 exercises, extra packages, script `--check`, lesson-level data, presets |
| `frontend/src/test/siteDaily.test.ts` | Bash `PATH` starts with the folder of `DAILY_PYTHON`. No assertion changed |
| `docs/WORKSPACE_CONTENT_AUDIT.md`, `docs/WORKSPACE_COORDINATION.md` | This file; interface requests appended |

No lesson file, no `curriculum.json` entry and no manifest line changed: the audit found no lesson defect, and the manifest is accurate, so no lesson was re-validated for the manifest.

## 12. Phase 2 (2026-11-18): enrichment content, re-verification, path coverage

Phase 2 rule: authoring teaching content for all 1,946 graded exercises (150 SQL bank, 150 Python library, 1,646 Daily graded) is not feasible with quality, so a hand-written, executed and validated subset was authored and the rest is left alone and reported as not enriched. Nothing in this section was generated from a template.

### 12.1 Re-verification of the 270 lessons and the converters

| Check | Result (real run in this worktree) |
| --- | --- |
| 270 lessons, unique ids | `curriculum.json` 270 entries, 270 unique ids; 540 files (270 `.md`, 270 `.json`) |
| Manifest | `DAILY_LEARNING_AUTHORING_MANIFEST.jsonl`: 270 lines, 270 unique ids, 0 missing, 0 extra, every `files` entry equals `<id>.md` and `<id>.json` and both exist |
| Exercise ids | 1,869 exercises (1,059 guided `g1..`, 810 independent `i1..`), 1,869 unique `daily:<day>#<id>` refs, all match `^[gi]\d+$`. Converters accept all graded ones (`siteWorkspaceCoreSources`) |
| Domain mapping | `node scripts/daily-workspace-map.mjs --check`: "workspace table is current: 270 lessons, 51 exercises with extra packages". `siteVisualCoverageWorkspace` also compares the generated table with the real JSON for all 1,869 exercises |
| Coverage report | `node scripts/daily-coverage.mjs` regenerates `DAILY_LEARNING_CONTENT_COVERAGE.md`: 270/270 lessons |
| `siteDaily.test.ts` alone, `--maxConcurrency=2`, venv Python 3.14 (numpy 2.5.4, pandas 2.3.3) | Full run on a machine under heavy load (load average 6 to 36, other agents running whole suites): 4,939 tests, 4,929 passed, 8 failed, 2 skipped. All 8 failures were `Test timed out in 90000ms` (d075 x2, d081 x2, d087 x2, e102 x2: pandas and requests-heavy examples). Re-run alone for d075, d081, d087, e102, a166 and a176 only: 115 tests, 113 passed, 0 failed, 2 skipped (the two skips are `DAILY_REQUIRE_ALL` and the `skipIf` guard). They are load timeouts, not content defects. **Final full run after the hint edits and the enrichment work, same command, quieter machine: 4,939 tests, 4,937 passed, 0 failed, 2 skipped** (the per-lesson table in section 3 was regenerated from this run) |
| Phase 1's 4 timeouts (a166 x3, a176 equivalence) | a166 passes inside the run above (0 failures). a176 equivalence is in `siteVisualEquivalencePython`; run alone with the venv and `--maxConcurrency=2`: 145 tests, 145 passed, 0 failed (it was a load timeout in phase 1) |
| Phase 1's 3 `siteVisualInterview` failures | Reproduced as environment: without the venv on `PATH` (`TZ=UTC npx vitest run src/test/siteVisualInterview.test.ts`) 3 failed, 56 passed, all `ModuleNotFoundError: No module named 'pandas'` (`pd-topn-group`, `pd-merge-check`, `pd-clean-order`). With `PATH=$V/bin:$PATH DAILY_PYTHON=$V/bin/python`: 59 passed, 0 failed. The test falls back to bare `python3` because this worktree has no `<repo>/.venv-daily`; it does not read `DAILY_PYTHON`. No assertion was weakened |

### 12.2 The 17 Daily hints that were the complete answer

Found with the same normalisation as `leaksSolution` (case, backticks, whitespace and the final semicolon ignored; solution of 12 or more characters). All 17 were hint 3 of a guided exercise, and the lesson ladder showed it (the workspace already dropped it from levels 1 to 4). Each was replaced in place by a non-answer check-your-result nudge, with the hint count left at 3 (the suite requires exactly 3 for guided exercises) and hints 1 and 2 untouched. After the edit the same scan finds 0 leaks, and a safety check at edit time refused any replacement that contained the solution.

| Exercise | Old hint 3 | New hint 3 (summary) |
| --- | --- | --- |
| d001#g1, d001#g2 | the whole `print(...)` line | compare the output character by character; the sum belongs outside the quotes, `print` adds the space |
| d031#g1, g2, g4 | the whole SELECT | check the headings, five rows and three columns, only `orders` keys |
| d032#g1, g2 | the whole SELECT | check the headings and one formatted row |
| d034#g4 | the whole SELECT | compare the row count with the stated 21 |
| d036#g1, g4 | the whole SELECT | check shapes and that `unshipped` is no longer 0 |
| d047#g1, g3, g4 | the whole set-operator query | check counts, both-table membership, which query comes first |
| d054#g1 | the whole recursive CTE | check eight rows and the recursion condition |
| d058#g1, g3, g4 | the whole EXPLAIN statement | look for the Sort node, `actual rows=`, an aggregate node |

Edited files: `frontend/src/site/content/daily/days/{d001,d031,d032,d034,d036,d047,d054,d058}.json` (17 lines). Verification: see 12.5.

### 12.3 Enrichment content authored (`content/workspace/enrichment/*.json`)

Files: `sql-bank-1.json` (20), `sql-bank-2.json` (22), `python-library-1.json` (13), `python-library-2.json` (18), `daily-numpy-1.json` (7), `daily-pandas-1.json` (7), `daily-pandas-2.json` (7), `daily-pandas-3.json` (10), `daily-mixed-4.json` (14). Total 118 items, 472 hints (levels 1 to 4 for every item), 362 debugging notes, 70 executed alternatives (one each on 70 items), 118 realWorld and commonMistakes, 13 interviewRelevance, 5 complexity entries. The placeholder `_empty.json` was deleted.

Two finished items are parked in `content/workspace/pending/` (outside the loader's glob): `sql:q01-product-revenue` and `py:cart-line-total`. They are the first SQL question and the first Python exercise, and `siteWorkspaceCoreSources` asserts `loadExerciseById(...)` equals the plain converter output for exactly those two, which an enriched exercise can never satisfy (the test predates enrichment). With them parked `siteWorkspaceCore` is 67 of 67. When that test compares against `loadBaseExerciseById` instead, move the two files into `enrichment/`.

Coverage of the exercise supply (enriched / available): SQL bank 42 / 150 (28%); Python library 31 / 150 (21%); Daily graded 45 / 1,646 (2.7%): sql 6 / 387, python 4 / 674, pandas 24 / 522, numpy 11 / 63. All graded exercises: 118 / 1,946 (6.1%). **93.9% of exercises have no enrichment**: they keep the converter's hints (Daily 3 for guided, none for independent; SQL concept, approach, skeleton, detail; Python 2 or 3 authored hints) and have no debugging notes in the workspace.

By source and topic (enriched / total in the topic):

| Source | Topics |
| --- | --- |
| SQL bank (42) | aggregations 2/6, group-by-having 4/5, left-join 4/16, right-join 1/10, full-outer-join 1/8, self-join 3/11, cross-join 1/8, correlated-subqueries 4/8, cte 2/7, window-functions 8/14, case-conditional 3/8, date-time 5/13, set-operators 4/13. Not touched: category-product-analytics, string-functions, dml-ddl (these need a data-changing policy, so no alternative could be run read-only) |
| Python library (31) | fundamentals 21, advanced 5, dsa 3, processing 2 (types, control flow, functions, collections, errors, decorators, generators, context managers) |
| Daily (45) | days d012 to d017 (control flow, functions, lambdas), d036 to d055 (SQL aggregates, joins, subqueries, windows), d063 to d067 (NumPy), d068 to d085 (pandas), a104 (statistics, outer product) |

Debugging notes by category (each at least 3; the test enforces it). SQL (bank 42 + Daily 6): filter 24, join 23, null 18, grouping 12, aggregation 28, window 21, syntax 18, performance 6. Python family: types 46, control-flow 27, runtime 19, filtering 15, variables 15, syntax 14, missing-data 13, indexing 12, shape 10, functions 9, transformation 8, grouping 7, axis 6, broadcasting 4, matmul 4, join 3.

Section 7 checklist after enrichment (exercises that now carry the item, of the format total; before enrichment every cell in these rows was 0 except where section 7 says otherwise):

| Checklist item | SQL bank (150) | Python library (150) | Daily graded (1,646) |
| --- | --- | --- | --- |
| Progressive hints, 4 authored levels (level 5 stays the stored solution) | 42 | 31 | 45 (before: 3 hints on guided, none on independent) |
| Debugging explanation | 42 (a repair task was 0) | 31 | 45 |
| Alternative solution with trade-off, executed | 22 | 16 | 32 |
| Constraints, real-world context, common mistakes | 42 | 31 | 45 (Daily had none per exercise) |
| Complexity | 0 new | 5 new on top of 150 `time` and `space` fields | 0 |
| Interview relevance | 6 new (before: follow-up questions only) | 7 new (before: `## Why it matters`, practical rather than interview-specific) | 0 |

Honest note on `matmul`: **no exercise in the Python library or in the 1,869 Daily exercises needs a matrix product** (`grep` for `matmul`, `.dot(` and ` @ `: 0 hits; `np.outer` appears in 4 places, all in a104). The 4 matmul notes attach to the exercises where learners really confuse element-wise, outer and dot products (d065#i1, d065#i2, a104#g3 twice). This is a curriculum gap for NumPy linear algebra (section 12.4), not something to fake with an extra lesson.

How the content was made trustworthy:

- Every item was written for its exercise from its starter, solution, tests or expected output, and the real error messages quoted in debugging notes were reproduced in the venv (for example `ValueError: Unable to parse string "free" at position 2`, `Series.isin() takes 2 positional arguments but 3 were given`, `cannot do slice indexing on Index with these indexers [1] of type int`). Three symptoms that were first written from memory were wrong when executed (two float-sum cases and a `-20.0` percent change) and were corrected before the tests were run.
- Alternatives are only given where a genuinely different valid approach exists, with the real trade-off in `note` (CTE vs subquery vs window, JOIN vs NOT EXISTS vs NOT IN, DISTINCT ON vs ROW_NUMBER, FILTER vs CASE, transform vs merge, map vs merge, vectorised vs loop, broadcasting vs tile).
- `frontend/src/test/siteWorkspaceEnrichment.test.ts` (95 tests) checks, on the real exercises: file schema and ids, duplicate ids across and inside files, ids that do not exist, `enrichmentProblems` empty for every item, complete items (hints 1 to 4, at least 2 debugging notes, constraints, realWorld, commonMistakes, no empty text), categories from the exercise's own domain list, no solution in hint or fix, no hint, cause, symptom or realWorld text reused across exercises, merge never changing `validation`, `starterCode` or `solution.code`, negative controls for the validator, and the coverage report with minimum counts and a minimum of 3 notes per category. It then **executes every alternative**: SQL alternatives on real PGlite through `submit(db, alt, referenceQuery, orderMatters, orderBy, HIDDEN_ROWS)` (the same grader and hidden-row check as the SQL page), Python library alternatives against the exercise's visible plus hidden tests in CPython, Daily Python, pandas and NumPy alternatives against the exercise's exact expected output (`sameOutput`). 22 + 3 SQL (bank, Daily), 16 + 29 Python (library, Daily) alternatives, 70 in total, all matched. When the interpreter lacks numpy and pandas the Python alternatives skip with a printed reason, and `ENRICH_REQUIRE_PYTHON=1` turns that into a failure.

### 12.4 Path coverage: dbt, cloud data engineering, Kafka and streaming, Terraform, Python, SQL

Evidence is from `grep` over the 270 lessons (`daily/days/*.md`), the 167 notes, 12 projects, 16 scenarios, concepts, patterns, mind maps, tracks and `lib/learnPaths.ts`. Whole-word, case-insensitive counts unless stated.

| Topic | What exists | Verdict |
| --- | --- | --- |
| dbt | Track `dbt` in `tracks.json`; 11 notes in `notes/dbt` (fundamentals, models, sources, seeds, snapshots, tests, documentation, jinja, macros, incremental models, deployment), about 10,200 words; project `dbt-analytics-project` (about 2,450 words) and a dbt step in `data-validation-pipeline`; `dbt` is in the Data Engineer path's `noteCategories` (`learnPaths.ts` line 111). Lessons: 3 mention it in passing (d046, e157, e180); no lesson and no exercise. dbt cannot run in the browser | **Adequate at reading level, no practice.** No new lesson: SQL models are the same SQL taught in d031 to d060, and Jinja and macros need a dbt runtime the workspace does not have. Gap: no executable dbt-style exercise (a Python/SQL simulation of ref(), tests and incremental models would be a new feature, not a lesson) |
| Cloud data engineering | Track `cloud`; 13 notes in `notes/cloud` (AWS, Azure, GCP overviews, IAM, object storage, data lakes, data warehouses, compute, networking, security, monitoring, orchestration, cost), about 13,400 words, plus `mindmaps/cloud-track.json`. In the Data Engineer path. Lessons: only d067 and e142 name a cloud product twice or more; 0 lessons | **Adequate at reading level, no practice.** No runtime, so no executable exercise is possible; no lesson added. Gap: no hands-on scenario (IAM policy reading, cost estimate) |
| Kafka and streaming | One note, `etl/etl-streaming-fundamentals` (907 words; a Kafka-sourced Spark Structured Streaming snippet, windows, late events), Kafka appears 7 times in 5 notes, 0 times in lessons. Streaming is mentioned in 7 lessons (d019, d026, d084, e123, e127, e170, e171) only in the sense of iterators, chunked reads or an interview question. Python library `watermark-tumbling-windows` practises event-time windows without a broker | **Real gap.** One note and one Python exercise are not a path. Not filled: Kafka cannot run in the browser and the instructions forbid inflating lesson counts. Recommended: a short streaming track (topics, partitions, consumer groups, offsets, delivery guarantees) as notes first |
| Terraform and infrastructure as code | The AWS and Azure overview notes each carry one bullet recommending IaC (CloudFormation, CDK, Terraform); nothing else in the content | **Real gap**, not a lesson topic for a browser platform. Document as out of scope or add a reading note later |
| Data lake formats (Delta, Iceberg, lakehouse) | 4 notes mention them (`cloud-data-lakes`, `cloud-object-storage`, `dwh-architecture`, `cloud-aws-overview`), Parquet is taught in e142 and e167 to e168 (19 mentions in e167) | Partly covered (columnar formats yes, table formats no) |
| Python | d001 to d030 (30 lessons: syntax, types, strings, control flow, collections, functions, comprehensions, files, CSV and JSON, dates, modules, OOP, iterators, generators, decorators, context managers, regex, CLI, Git), d061 to d062 (pytest), d063 to d085 (NumPy, pandas), 150 library exercises, 21 notes. Now 31 library exercises and 4 plain-Python Daily exercises (plus 35 pandas and NumPy ones) carry enrichment | **Strong.** Known gaps from section 8.2 stand: type hints, asyncio, packaging beyond venv |
| SQL | d031 to d060 (30 lessons), 18-lesson course, 150 questions, notes in 6 categories. 42 questions and 6 Daily exercises now carry enrichment (all 8 SQL debugging categories) | **Strong.** Known gaps from section 8.1 stand: stored routines, locks and isolation, LATERAL, plan-reading practice |

Nothing was added to the 270-day structure.

### 12.5 Phase 2 verification commands

Run from `frontend/` with `V=/Users/subramanyaacharya/Downloads/project/sql-practice-platform-integration/.venv-daily`: `PATH=$V/bin:$PATH DAILY_PYTHON=$V/bin/python TZ=UTC npx vitest run src/test/siteWorkspaceEnrichment`, then `siteDaily.test.ts --maxConcurrency=2`, `siteVisualCoverage`, `siteWorkspaceCore`, `node scripts/daily-coverage.mjs`, `node scripts/daily-workspace-map.mjs --check`, `npx tsc --noEmit`. Results are in the final report of the task.
