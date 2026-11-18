# Unified Exercise Workspace: regression report (phase 2)

Date: 2026-11-18. Worktree `sql-practice-platform-guide`, branch `feature/dataforge-guide`, base `471fc05`. All runs are against the working tree as of the run, on one machine (macOS, system Chrome, Playwright Firefox and WebKit). Environment for Python tests: the repo venv `../sql-practice-platform-integration/.venv-daily` (`DAILY_PYTHON` set and its `bin` first on `PATH`).

## Static checks

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint src` | clean (`e2e/` is not covered by the ESLint config) |

## Unit and integration (Vitest, `TZ=UTC`, `--maxConcurrency=2`)

| Run | Result |
| --- | --- |
| Full suite | 151 files, 8,054 passed, 0 failed, 10 skipped |
| `siteDaily` alone (270 lessons executed in real Python and PGlite) | 4,939 tests, 4,937 passed, 0 failed, 2 skipped (a `DAILY_REQUIRE_ALL` check and a missing-Python guard) |
| New workspace suites | Core 67 (sources 34, UI 33), SQL adapter, visualizer, safety (policy 164, database 157) and question integrity (23), Python (195 plus 30 new), data (322 plus 11), Daily parity (16) and adapters (6), links (40), enrichment (95) |

Phase-1 failures re-verified, not dismissed:

- 3 `siteVisualInterview` failures: environment only. The test ignored `DAILY_PYTHON` and fell back to a `python3` without pandas. Fixed in the test (it now honours `DAILY_PYTHON`); 59 of 59 pass.
- 4 timeouts (`a166` x3, `a176` equivalence): load only. They pass alone and in the full run above.

## Build

`npm run build:site`: exit 0, 1,139 pages prerendered (1,114 in the sitemap). `npm run check:prerender`: no failed Suspense boundaries. The built pages were served by a Cloudflare-style static server (directory to `index.html`, missing path to `404.html`), not by `vite preview`, so hydration was exercised on the real prerendered HTML.

## Browser (Playwright, serial, `--retries=0`)

First matrix on the prerendered build, 20 spec files, desktop and mobile Chromium: 342 passed, 26 skipped, 22 failed. Every failure was analysed from its real output:

| Failure | Cause | Fix |
| --- | --- | --- |
| `visual-workspace` (many), React #418/#425 | A real product bug the dev server cannot show: `/workspace?e=...` and `/visual/data?preset=...` read the query string on the first client render, but the prerendered HTML has none, so hydration mismatched. | `WorkspacePage`, `usePreset` and the visual pages now read the query string after mount; the tool content is keyed on it. |
| `help-tours` | The spec imports `/src/...`, which only the Vite dev server serves. | Run on the dev server: 43 passed, 1 skipped (includes `help.spec`). |
| `visual-workspace` merge keys | Test expected `keys 4`; the page correctly says `Left only: 2 rows: keys 2, 4`. | Test corrected. |
| `visual-workspace` and `daily-workspace`, "page error: Canceled" | Monaco rejects an internal promise with `Canceled` when an editor is disposed (touch viewport). Not an app error. | Specs ignore exactly that message. |
| `daily-workspace` mobile SQL (d031) | Test race: on a phone a tab switch remounts Monaco, and a `setValue` in the first milliseconds is lost because the change handler is not attached yet (a person cannot type that fast). Reproduced with a script. | The helper waits for the editor to draw its text. |
| `daily-workspace` pandas desktop, groupby `[data-group-view]` | Load timeouts in a 45-minute run. | Pass alone (7 to 10 s). |

After the fixes the previously failing tests were re-run: 13 of 14 passed on the first isolated run; the fourteenth (mobile SQL d031) is the race above and passes after the helper fix (desktop and mobile, 2 of 2).

Cross-engine run (`E2E_ENGINES=firefox,webkit`, `visual.spec`, `visual-engines.spec`, `workspace.spec`, all six projects): 243 passed, 9 failed. WebKit desktop and mobile: no failures. Firefox:

- 7 `firefox-mobile` `workspace.spec` failures: the spec decided "phone layout" from Playwright's `isMobile`, which Firefox does not support. The spec now uses the viewport width.
- 2 `firefox-desktop` failures (`visual-engines` equivalence with real Pyodide, `visual.spec` Python Time Machine exception): Pyodide did not finish within 150 s on Firefox.

Re-run of exactly those Firefox cases (`firefox-desktop` and `firefox-mobile`, `workspace.spec`, the equivalence and scale tests, the Python Time Machine exception test): 30 of 30 passed (4.8 min, real Pyodide). The two desktop failures were load timeouts in a 47-minute run; the seven mobile failures were the spec.

## Not run

- Live Supabase sync (no staging project); `prod-smoke.spec` (needs production); `sync.spec`.
- The Content-Security-Policy in `_headers` is not applied by the local static server.
- A real phone or desktop Safari.

## Known limitations

See `WORKSPACE_INTEGRATION_REPORT.md` and `WORKSPACE_SQL_SAFETY.md`.
