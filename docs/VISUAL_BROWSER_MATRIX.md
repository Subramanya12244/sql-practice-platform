# Visual Learning Engine V2: browser matrix, execution equivalence and Supabase sync

Written 2026-11-12 by the browsers-and-equivalence agent. Everything below was run on that date unless it says "not run". Nothing was committed, pushed or deployed.

Environment: macOS (Darwin 25.6, arm64), Node 26.12, Playwright 1.49.1, system Google Chrome 157 for the Chromium projects, Playwright Firefox 132.0 (build v1466) and Playwright WebKit 18.2 (build 2104), Pyodide 0.29.5 from jsDelivr, CPython 3.14.6 in `.venv-daily` (the brief says 3.13; the venv has 3.14.6, with pandas 2.3.3 and numpy 2.5.4).

## 1. Cross-browser results

Specs: `frontend/e2e/visual.spec.ts` (the V1 specs, 6 tests, kept and passing) and `frontend/e2e/visual-engines.spec.ts` (25 tests, one per row of the "Test group" column). One run = both files, retries 1, 1 worker, real Pyodide and pandas downloads (nothing mocked).

### Result per engine

| Engine (version) | Project | Viewport | Tests | Passed | Expected-fail | Failed | Skipped | Flaky (passed on retry) | Date | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chrome 157 (system) | `desktop` | 1440x900 | 31 | 29 | 2 | 0 | 0 | 0 | 2026-11-12 | 179 s |
| Chrome 157 (system) | `mobile` | 390x844, touch, mobile emulation | 31 | 29 | 2 | 0 | 0 | 0 | 2026-11-12 | 168 s |
| Firefox 132.0 | `firefox-desktop` | 1440x900 | 31 | 29 | 2 | 0 | 0 | 0 | 2026-11-12 | 377 s |
| Firefox 132.0 | `firefox-mobile` | 390x844, touch (no mobile emulation) | 31 | 29 | 2 | 0 | 0 | 0 | 2026-11-12 | 212 s |
| WebKit 18.2 (not Safari) | `webkit-desktop` | 1440x900 | 31 | 29 | 2 | 0 | 0 | 0 | 2026-11-12 | 175 s |
| WebKit 18.2 (not Safari) | `webkit-mobile` | iPhone 13 profile, 390x664, touch | 31 | 29 | 2 | 0 | 0 | 0 | 2026-11-12 | 167 s |

Totals: 186 test runs, 174 passed, 12 expected-fail, 0 failed, 0 skipped, 0 flaky. The runs used the three engines in parallel on one machine, so the durations are indicative only. An earlier run of the same specs had two real failures that were test mistakes (WebKit page error on an aborted navigation; selectors made ambiguous by the new Help text), fixed before the runs above (section 2, B3 and B4).

"Expected-fail" are the two browser equivalence tests marked `test.fail` (see section 3.3): Playwright counts them as passed because the product difference they describe is still there.

### Result per test group and engine

All groups pass in all six projects unless a cell says otherwise.

| Test group | Tests | Chrome desktop / mobile | Firefox desktop / mobile | WebKit desktop / mobile | Notes |
| --- | --- | --- | --- | --- | --- |
| SQL Query Cinema (V1 spec + new) | 2 | pass / pass | pass / pass | pass / pass | |
| Python tracing in real Pyodide (2 V1 + 2 new) | 4 | pass / pass | pass / pass | pass / pass | first Pyodide load about 5 to 10 s here (CDN) |
| Pandas visualization (real pandas; 1 V1 + 1 new) | 2 | pass / pass | pass / pass | pass / pass | |
| NumPy visualization | 1 | pass / pass | pass / pass | pass / pass | |
| API Studio | 1 | pass / pass | pass / pass | pass / pass | |
| ETL Playback | 1 | pass / pass | pass / pass | pass / pass | |
| Chart Explorer | 1 | pass / pass | pass / pass | pass / pass | |
| New pages: Tree, Graph, Excel, Linux, Git, Stats, Business, Interview | 8 | pass / pass | pass / pass | pass / pass | all eight pages were real (none was a placeholder) at the time of the final runs |
| Responsive layout (no horizontal scroll, playback bar fits) | 2 | pass / pass | pass / pass | pass / pass | |
| Keyboard (Space, arrows, Home, End) | 2 | pass / pass | pass / pass | pass / pass | |
| Reduced motion | 2 | pass / pass | pass / pass | pass / pass | |
| Equivalence in the browser | 3 | 1 pass, 2 expected-fail / same | same / same | same / same | the 2 expected-fail are open product differences B1 and B2 |
| V1 `visual.spec.ts`, remaining tests (hub; API, ETL and charts together) | 2 | pass / pass | pass / pass | pass / pass | |

### How the engines were set up and what that means

- Chromium means the system Google Chrome 157 (`channel: "chrome"`, as before). The bundled Playwright Chromium was not installed. Results therefore describe Chrome, not Playwright's Chromium build.
- Firefox 132.0 and WebKit 18.2 are the builds that ship with Playwright 1.49.1. WebKit is not Safari: it is the WebKit engine without Apple's browser shell, so Safari-only behaviour (for example its private-mode storage limits, ITP, or its newest CSS) is **not** covered. "WebKit passed" is not "Safari verified".
- `webkit-mobile` uses Playwright's real `iPhone 13` profile (390x664, touch, iOS user agent). `desktop`/`mobile` keep their names and settings. `firefox-mobile` is a 390x844 touch viewport only: Playwright cannot emulate mobile (`isMobile`) in Firefox, so it tests the small-screen layout in Gecko, not phone behaviour.
- Real phones, real Safari on iOS and Android browsers were **not** tested.
- **The Playwright installer hangs here.** `npx playwright install firefox webkit` downloaded both archives and then stalled forever while extracting (Playwright 1.49's unzip step with Node 26.12; the folder stayed at 852 KB for 7 minutes, twice). The same official archives were unzipped by hand into `~/Library/Caches/ms-playwright/{firefox-1466,webkit-2104}` and marked with `INSTALLATION_COMPLETE`; both engines were then launched and ran the tests above. On a machine with an older Node (or `npm i -D @playwright/test@latest`) the normal `npx playwright install firefox webkit` should work.

### How to run

```
npx playwright install firefox webkit                         # once
npx playwright test                                           # desktop + mobile (Chromium) only, as before
E2E_ENGINES=firefox npx playwright test --project=firefox-desktop --project=firefox-mobile
E2E_ENGINES=webkit  npx playwright test --project=webkit-desktop  --project=webkit-mobile
E2E_ENGINES=all     npx playwright test e2e/visual.spec.ts e2e/visual-engines.spec.ts
EQUIV_STRICT=1 npx playwright test e2e/visual-engines.spec.ts -g "KNOWN DIFFERENCE"   # show the two browser differences without test.fail
```

Why opt-in: each engine is a separate download and the visual specs load Pyodide and pandas (about 5 to 10 minutes per engine pair here), so all three by default would about triple a run. With `E2E_ENGINES` unset the Firefox and WebKit projects do not exist, so `npm run e2e` and the existing project names (`desktop`, `mobile`) behave exactly as before. `package.json` is not in this agent's files; suggested scripts for the main agent: `"e2e:firefox": "E2E_ENGINES=firefox playwright test --project=firefox-desktop --project=firefox-mobile"` and `"e2e:webkit": "E2E_ENGINES=webkit playwright test --project=webkit-desktop --project=webkit-mobile"`. CI does not run e2e today, so no workflow change is needed.

### What each test group asserts

| Group | What the test does |
| --- | --- |
| SQL Query Cinema | Visualize the default query, the playback bar appears, Next step moves to step 2, row-flow is drawn; the UNION preset shows the set-operation view and its column-compatibility section (the player is stepped until the view appears). |
| Python tracing (real Pyodide) | "Loop and total": a real trace, step 1 of N, End shows "The program finished", output contains `8`, memory-model tab. Second test: the Exception preset ends with "Stopped by IndexError". |
| Pandas visualization | "Filter and sort": real DataFrame tables on the "Tables and arrays" tab, shape text. |
| NumPy visualization | "NumPy broadcasting": array tables with `dtype int`. |
| API Studio | Pick the 404 scenario, step, no horizontal scroll. |
| ETL Playback | Inject `load-always-fails`, the dead letter is shown (visible element, not the closed Help), step. |
| Chart Explorer | Pie by month, advice list mentions slices. |
| New pages (8) | For tree, graph, excel, linux, git, stats, business, interview: heading present, Help opens ("What it does.", Controls), one interaction (tree: insert a node and the drawn tree label changes; graph: Next step, switching algorithm restarts the player; excel: type `=2+3` and the grid cell shows value 5; git: run `git status`; stats: switch distribution; business: switch period type and the KPI tiles change; linux and interview: the page responds to the first control), no horizontal scroll. A page that still shows "is being built" is skipped with that reason; none was skipped in the final runs. |
| Responsive layout | No horizontal scroll on the hub and all 13 visual pages; the playback bar fits the viewport. |
| Keyboard | Space plays and pauses (it advances by itself, then holds when paused), ArrowRight/ArrowLeft, Home, End on the playback bar; the speed `<select>` is not hijacked by the arrow keys. |
| Reduced motion | `page.emulateMedia({ reducedMotion: "reduce" })`: the row-flow reports `data-reduced=true`, shows the static Before/After boards, has no Replay button, no running animation (`document.getAnimations()`), no CSS animation and no transition longer than 1 ms inside the row boards. Then the same stage under `no-preference`: identical explanation sentence and identical set of drawn rows. Second test: the player does not auto-play and the Graph Explorer SVG is static. |
| Equivalence (browser) | See section 3.3. |

## 2. Product findings from the browser work

| # | Finding | Evidence | Owner |
| --- | --- | --- | --- |
| B1 | **Tracing changes `__name__` for the program.** The normal run (`pyodide.worker.ts`) executes the code in a plain `dict`, where `__name__` is `builtins`; the tracer runs it with `__name__ == "__main__"`. `if __name__ == "__main__":` blocks therefore do not run in the normal run but do run in the trace. | Playwright, Chromium, practice page "Run Script" then "Explain your solution": console printed `name is builtins`, trace output `name is __main__` (EQUIV_STRICT run). | `pyodide.worker.ts` / `pyTrace.ts` (main agent) |
| B2 | **A program that uses `sys` without importing it runs in the normal run but fails in the trace.** The worker's setup code (`GUARD`, `MODULE_CLEANUP`, `SETUP_DIR`) runs in the same namespace as the learner's code, so `sys`, `importlib` and a few `_x` names are pre-defined there. The tracer's clean namespace does not have them. | Same run: console printed `major 3`; the trace printed nothing (NameError). | same |
| B3 | Existing V1 tests broke when the Help block and the "Recorded step N of M" line were added: `getByText("Step 1 of")` matched two elements and `getByText(/dead-lettered/).first()` matched hidden Help text. Fixed in `visual.spec.ts` (status role, visible element). | Chromium desktop run before the fix. | fixed here |
| B4 | WebKit reports an interrupted script load as a page error `[object Event]` when a test navigates away from a page that is still loading its lazy editor (reproduced in the all-pages navigation test only; not reproduced in isolation or after waiting for network idle). Treated as a test artifact, not a product bug; not proven either way. | WebKit desktop and mobile, "Responsive layout" before `waitForLoadState("networkidle")` was added. | none |

## 3. Execution equivalence (visual explanation must not change what the learner gets)

Files: `src/test/siteVisualEquivalencePython.test.ts` (real CPython, pandas, NumPy, curriculum), `siteVisualEquivalenceSql.test.ts` (PGlite, grader), `siteVisualEquivalenceUi.test.tsx` (jsdom, Daily Learning grading), and the browser group in `e2e/visual-engines.spec.ts`.

### 3.1 Python (real CPython, not Pyodide)

Mode A is `python -s -c <code>` (plus an exec harness with the tracer's namespace, for the globals dump). Mode B is the program from `buildTraceProgram(code)` run as a file with a globals dump appended by the test (the tracer is not edited). Compared: stdout, stderr, exit status (a trace's error mapped to the exit code the plain run gave), exception type and message, and the `repr` of every non-dunder learner global (addresses removed), with a fixed hash seed, fixed seeds, fixed stdin.

| Corpus | Programs | Result |
| --- | --- | --- |
| Hand-written (loops, recursion incl. depth 900 and RecursionError, generators, classes, closures, mutation/aliasing, caught and uncaught exceptions, SyntaxError, `input()` and stdin EOF, `sys.exit(0/3/"msg"/None)`, stderr and warnings and logging, 70k-character output, `print` with end/sep/flush, trace budget exceeded, tiny budgets, seeded random, file I/O, tracebacks, ExceptionGroup) | 43 | all equivalent |
| Curriculum: 60 lessons spread evenly over the common core (20), analyst (20) and engineer (20) paths, browser-runnable `python run` examples plus the Python exercise solutions (at most 6 per lesson) | 343 | all equivalent (run `EQUIV_LESSONS=all` for every lesson, `EQUIV_DAYS=a126,e129` for chosen ones) |
| pandas and NumPy (filter, groupby, merge, pivot, melt, dtype conversion, missing values, duplicates, concat, in-place mutation and aliasing, SettingWithCopy warning, broadcasting, masks, reshape, views vs copies, seeded random, KeyError/ValueError/reshape/broadcast errors, overflow) | 17 | all equivalent, including dtypes, the exception, and DataFrame state after tracing |

Differences found, and pinned by tests (they pass today and are written to fail loudly when someone fixes the product):

| # | Difference | Status |
| --- | --- | --- |
| P1 | `__del__`, `weakref` and `sys.getrefcount` behaved differently under the tracer (it kept a reference to everything it recorded, so `del x` did not free the object, and a printing `__del__` wrote after the trace line, which made `parseTrace` return null for the whole trace). | **Fixed** by the tracer agent during this work; the tests now assert strict equivalence (including an object still alive at the end of the program). |
| P2 | A class with a logging `__getattr__` and `__slots__` is asked for `__dict__` by the tracer, so the log shows extra entries. | Open. |
| P3 | `sys.stdout.buffer`, `.reconfigure()`, `.name`, `.mode` raise `AttributeError` under the tracer (`encoding`, `errors`, `writelines`, `fileno`, `isatty`, `flush`, `writable` match). A global holding `sys.stdout` holds the capture object (inherent). | Open (partly inherent). |
| B1, B2 | See section 2 (browser only). | Open. |
| fixed during this work | A learner's code containing `$$`, `$&`, `$'` or a backtick pattern was rewritten by `buildTraceProgram` (e120 had one: the traced program was invalid, no trace). User `__repr__` methods with side effects were called by the tracer (they printed, counted). The tracer's stdout lacked `encoding`. | Fixed by the tracer agent during the run; the tests now assert strict equivalence for them. |

Not covered: timing, memory use, and Pyodide-specific behaviour other than the two browser tests. A program that calls `sys.settrace` itself, or reads `sys.gettrace()`, cannot be equivalent by nature. If a program writes more than 20000 characters to stderr or stdout in the worker, the worker stops collecting output; whether that can drop the trace line in the browser was not tested.

### 3.2 SQL and grading

PGlite with Northwind; 22 queries (joins, three-way join, aggregates, windows, CTE and chained CTEs, subqueries, DISTINCT, UNION, INTERSECT, EXCEPT, UNION ALL, NULL cases, empty result, more rows than the sample, an erroring query). For each: `visualize()`'s final columns, row count and first 20 rows equal the normal result; every table's contents (count and checksum) and every sequence are unchanged afterwards, also for a data-modifying CTE (DELETE ... RETURNING, INSERT ... RETURNING) that the visualiser re-runs. The grader `submit(...)` (what `submitQuery` calls, with the hidden-rows check) returns the identical verdict, message and feedback before and after visualising, for 7 attempts (correct, rewritten correct, wrong result, wrong order, hard-coded value failing the hidden test, syntax error, empty). Result: all equal. `browserDb.submitQuery` itself needs a Web Worker and was not called; the function under it was.

### 3.3 UI grading and the browser

- jsdom, real Daily Learning lesson d001, guided exercise 1: session A never opens "Explain visually"; session B opens it and runs real traces (in real CPython) before and between the checks. Verdict text after each check, the code sent to grading, `Progress.daily`, the Mistake Notebook entries, active days, revision, solve sessions, and stored study time (40 s in both) are identical; nothing from the trace reaches storage. Opening the block without running a trace changes nothing and calls no runner.
- Browser (Playwright, real Pyodide, Python practice page): the same printed output with and without tracing for an ordinary program (passes in all engines). B1 and B2 above are the two programs where it is not equal; they are `test.fail` in all six projects.

## 4. Supabase sync

### What exists

`lib/supabase.ts` (lazy client, enabled only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set), `lib/auth.tsx` (`startSync` on sign-in: read `progress`, `profiles.state`, `mock_sessions`; `mergeProgress`; push merged rows and `profiles.state`; then a sink mirrors every change), `lib/account.ts` (merge), `dailyProgress.ts`/`dailyStudy.ts`/`solveSessions.ts`/`mistakes.ts` (merge helpers), `lib/dataSync.ts` (visualisation history, project progress, data-quality; separate tables), `supabase/migrations/001-012` (repo root `supabase/`, not `frontend/supabase/`), `e2e/sync.spec.ts` (skipped unless `E2E_SYNC=1`), `docs/SUPABASE_TEST_PLAN.md`.

**Is a staging project configured or available? No.** There is no env file with Supabase values in the working tree (only `.env.site.example`, with empty values), no `SUPABASE_STAGING_*` variables in the environment, and no staging project is named in any doc. `docs/SUPABASE_TEST_PLAN.md` recommends "a separate free Supabase project" but none exists in the repo. The only Supabase project the repo knows about is production (`VITE_SUPABASE_*` repository variables used by the deploy workflow). It was not used. No account was created anywhere. No secret was read, printed or copied.

Study time lives inside `Progress.daily.days[id].study` and is pushed as part of `profiles.state.daily`. Visual Learning V2 stores nothing that syncs: its only persisted value is the reduced-motion preference in `localStorage` (`lib/visual/motion.ts`), per browser. Traces live in memory. A test scans `lib/visual` and `components/visual` for storage, sync and network use and checks `account.ts` and `auth.tsx` never mention visual or trace data.

### Verified at unit level (always runs, no network)

`siteSupabaseSyncMerge.test.ts` (32 tests):
- study sessions: two devices add up, same id counted once, later end wins, tie broken by larger active time, cap drops the oldest, idempotent, commutative, associative (seeded random data, 150 cases per law);
- lesson records and Daily Learning state: pass kept from either device, earliest completion kept, best check score kept with the latest `last`, drafts (this device wins), path and start date;
- solve sessions (dedupe by id, "solved" beats "abandoned" on a tie) and Mistake Notebook merge by ref (larger counts, earliest solve, "understood" only if newer than the last failure);
- `mergeProgress` for a device with local progress signing in; order-independence; idempotence;
- a simulated server with two devices: offline edits on both, A pushes, B pulls and pushes, A pulls: both identical and equal to the server, no duplicate session ids, nothing lost, a further sync changes nothing; same session extended on one device; exercise passed on A and failed on B.

`siteSupabaseSyncApp.test.tsx` (5 tests): the real `AuthProvider` against an in-memory fake Supabase client: the keys pushed in `profiles.state` (and that nothing from Visual Learning is in it), a study session finished while signed in is mirrored once, the two-device sequence end to end through `auth.tsx`'s own sync code, an unreachable server leaves local progress untouched.

Properties that the tests show are **not** guaranteed (stated plainly):
- **S1 (risk, `auth.tsx` `startSync`)**: if reading the account fails (for example a statement timeout or a policy error on SELECT) but writing works, `startSync` ignores the read error, merges the device with nothing, and pushes that state over `profiles.state`. Data that exists only in the account (another device's lessons and study time) is overwritten. Pinned in `siteSupabaseSyncApp.test.tsx` ("KNOWN RISK"). A guard on `error` from the three reads would remove it. Not a `profiles` row-level security issue; it needs a partial failure.
- **S2 (by design)**: failures counted separately on two devices merge to the larger count, not the sum (3 and 2 give 3, not 5), which is what keeps a re-sync idempotent. The notebook can undercount.
- **S3 (cosmetic)**: sessions with the same end time keep their arrival order, so two devices may list them in a different order.
- Code drafts (`Progress.daily...drafts`, capped at 6000 characters per exercise) and the last SQL per question (`qmeta.lastSql`, 8000 characters) are synced. That is existing behaviour, not part of V2.

### Not verified (needs a live staging project)

Everything that involves real Supabase: sign-up, login, password reset, session restore from a real token, row-level security for `progress` and `profiles`, the `touch_last_seen` and `email_for_username` functions, triggers (`handle_new_user`, `guard_profile_update`), the realtime or retry behaviour of the supabase-js client, rate limits, email confirmation, and the real offline-then-reconnect behaviour of the browser. `e2e/sync.spec.ts` (full UI, two browser contexts) has **not** been run. **No claim of live sync is made.**

`siteSupabaseSyncLive.test.ts` is written and ready, env-gated, and was **not run** against anything. It is skipped with the message `[supabase live] SKIPPED: set SUPABASE_STAGING_URL and SUPABASE_STAGING_ANON_KEY ...`. When enabled it does: sign-up of one throwaway address (`dfsync<random>@example.com`), sign-out and sign-in, a second client restoring the session from the same storage, a study-time and progress round trip from device A to a fresh device B, a two-client offline-edits-then-merge sequence, and offline-then-reconnect (a fetch that fails while "offline"), using the real merge functions and a copy of `startSync`'s pull-merge-push (a test checks that its key list matches `auth.tsx`). It refuses a service-role key (decoded from the JWT) and a URL equal to `VITE_SUPABASE_URL`.

Prerequisites to run it:
1. A **separate staging Supabase project** (not production) with `supabase/migrations/001`-`012` applied.
2. Auth > Providers > Email: **"Confirm email" disabled** on that project. A throwaway `@example.com` address cannot confirm mail; with confirmation on, sign-up returns no session and the tests stop with that explanation.
3. `SUPABASE_STAGING_URL` and `SUPABASE_STAGING_ANON_KEY` (the **anon** key only; never the service-role key) in the shell:
   `SUPABASE_STAGING_URL=https://<ref>.supabase.co SUPABASE_STAGING_ANON_KEY=<anon> TZ=UTC npx vitest run src/test/siteSupabaseSyncLive`
4. Cleanup: the test deletes its own `progress` rows and resets `profiles.state`, then signs out. **It cannot delete the account**: the public API has no delete (no delete policy on `profiles`, no self-delete function in the migrations), so removing the user needs admin rights (dashboard Auth > Users, or an admin key from your own shell). The test prints the username to delete.

For the full UI check use `E2E_SYNC=1 VITE_SUPABASE_URL=<staging> VITE_SUPABASE_ANON_KEY=<staging anon> npx playwright test e2e/sync.spec.ts` against the same staging project (see `docs/SUPABASE_TEST_PLAN.md`).
