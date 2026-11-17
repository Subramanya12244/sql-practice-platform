# Motion, icons and Projects Lab: report

Branch `feature/motion-icons-projects`, based on `origin/main` `881491e`, which is what production served when this work started. The UX redesign (PR #9), the Learn hub and Daily Learning were already in production, so nothing approved was missing from it. Screenshots are in `docs/images/motion-projects/`.

## 1. Why the interface felt slow

Measured first, on the production build, in Chrome with the CPU slowed 4 times to stand in for a mid-range phone. Frame rate was never the problem: the 95th-percentile frame time was 16.7 to 16.8 ms on every page, desktop and throttled mobile. The slowness was time and waste:

| Cause | Evidence |
| --- | --- |
| Lists took most of a second to finish arriving | `.stagger` was a 420 ms entrance plus up to 405 ms of delay: the last card of `/daily` finished at 825 ms, `/` at 645 ms, `/learn` and `/dashboard` at 555 ms |
| Scroll reveal of 520 ms, and hidden until it fired | `.reveal-in` transition |
| Card hover of 220 ms, on `transition-all` | Measured on `/learn`; 33 components used `transition-all`, which also animates properties that were never meant to move |
| Progress replayed on every page load | Bars started at 0 (server HTML) and filled over 420 to 700 ms when stored progress arrived; the ring used 700 ms |
| `CountUp` re-rendered React about 40 times for one number | `setState` on every animation frame for 700 ms |
| Two decorative loops that never stopped | The Daily banner animated `background-position` for ever and the current-day marker animated `box-shadow` for ever (both repaint every frame); the home pipeline dot pulsed for ever |
| A layout jump | `/career/planner` shifted by 0.132 (rated "needs improvement" above 0.1; 0.096 on the phone profile) because a 492 px block appeared after mount |
| Two large blur filters on the dashboard banner | `blur-3xl` on two 240 to 290 px blobs |

Not changed because they are not the cause: JavaScript animation libraries (there are none), SVG filters (there are none) and static SVG ids (the logo id was fixed in the redesign). Long JavaScript tasks (up to 1.3 s on `/dq-exercises` at 4x CPU) come from Monaco starting up, not animation; a CPU profile attributes about 170 ms of self time to the editor. That is listed under limitations.

## 2. Motion system

One set of numbers, in three places kept equal by a test (`siteMotion.test.ts`): `lib/motion.ts`, Tailwind `duration-*`, and `--motion-*` in `site.css`.

| Token | Time | Used for |
| --- | ---: | --- |
| instant | 100 ms | press feedback |
| fast | 140 ms | hover and focus colour, chips, small toggles |
| base | 180 ms | card lift, dropdowns, accordions, tab highlight, page transition |
| enter | 220 ms | content arriving: lists, reveal, modals |
| slow | 280 ms | progress fills and other complex changes |

What changed:

- Entrance: 220 ms, stagger 30 ms steps capped at 150 ms, 8 px travel. A list now finishes in at most 370 ms.
- Scroll reveal: 220 ms, and it starts 120 px before the section is on screen so a fast scroll never lands on blank space.
- Nothing loops. The data-flow line and the Daily marker ring run four and three passes and stop, and both now use `transform` and `opacity` only. The loading skeleton is the only infinite animation. The Daily banner gradient and the float and pan keyframes are gone.
- Progress: the value read from storage right after load snaps into place; only a change you cause while on the page animates (`useSettled`). Segment delays are capped.
- `CountUp` writes to the text node and finishes in 400 ms; React renders once.
- Buttons and interactive cards list the properties they transition (`transition-all` went from 33 uses to 5, the five that animate size or position). Press feedback is 100 ms.
- Tabs get a highlight that slides to the selected tab (transform and width; the first placement is instant). Without JavaScript the selected tab keeps its own background.
- `Disclosure` is a real button with `aria-expanded` and `aria-controls`, a turning chevron and an animated panel; closed content stays in the HTML (hidden and inert). It replaces `<details>` for the learning path modules and the project task roadmap.
- Page transition: 180 ms, opacity and 3 px of travel.
- Reduced motion: the global rule also zeroes animation and transition delays now. A test found a 120 ms delay that survived it.
- The planner block's space is reserved until it mounts.

## 3. Icons and SVG

- New `Icon` and `IconTile` (`components/Icon.tsx`): Lucide glyphs at five sizes (inline 15, button 17, nav 19, card 22, feature 32 px), one stroke family (1.9 down to 1.5, lighter as the icon grows), `currentColor`, `aria-hidden` unless a `label` is given. Used by the sidebar, the Projects Lab and every replaced glyph; the other 90 files that use Lucide directly keep their `h-4 w-4` classes (see limitations).
- Emoji and tick glyphs used as interface icons replaced with icons in: Study Notes presets, Python workspace test mark, Python and SQL history lists, note "Marked as read" and read ticks, mind map solved ticks, dashboard missions, project check results.
- `ProgressRing` gets a `viewBox`. Dashboard banner blur blobs became radial gradients.
- Audit results: no static SVG ids remain, no SVG filters, every other inline SVG has a `viewBox` except one computed overlay in the row-flow visual. Glyphs inside the visual labs' SVG text and in the share-image canvas were left alone (tests depend on them, and a canvas cannot draw an icon component).

## 4. Projects Lab

12 projects, 92 tasks (85 checked automatically, 7 manual), all counted from the content.

- Library: one compact totals strip; search; level chips with counts; technology and status filters, all kept in the address; an empty state with Clear filters; My projects tab (and its sliding highlight).
- Cards: one icon per project, level colours (beginner green, intermediate blue, advanced violet), a status chip with an icon, technology tags, checks passed, and the next task ("Start with" or "Next"). They lift on hover, press in on click, show a focus ring, and the whole card is the link. The card height stayed about 250 px.
- Project page: icon header, animated progress bar, a collapsible Task roadmap that lists every task with its real state (passed, not passing yet, not run, manual), marks the next task and jumps to it, and result banners that say "Check passed" or "Check did not pass" in words, show the check's own message unchanged, and offer the next task after a pass.
- Not changed: the check logic, `projectStatus`, the completion rule (a project is Completed only when its checks pass; a test confirms passing all but one check does not complete it) and the project content.

## 5. Tests and results

| Check | Result |
| --- | --- |
| `tsc -b`, `eslint src` | clean |
| New unit tests: `siteMotion` 11, `siteProjectsLab` 13, `siteIconAndMotionUi` 16 | 40 passed |
| Full Vitest (`TZ=UTC`, 4 workers) | 123 files, 6,982 passed, 10 skipped, 0 failed |
| Backend (`pytest backend/tests`), Python-block check | 104 passed; 96 blocks, 173 tasks, 0 failures |
| `build:site`, `check:prerender` | 1,138 pages; no failed Suspense boundaries |
| New browser specs (`projects-lab`, `motion`) with the learn hub specs, desktop and mobile, against the built site | 73 passed, 9 skipped (one viewport only), 0 failed |
| Every Playwright spec except the production-only and dev-server-only ones, desktop and mobile, no retries | 372 tests: 334 passed, 28 skipped, 10 failed (below) |
| `help-tours.spec` (reads the Guide registry from the Vite dev server) | passed |

The 10 failures in the full browser run, each re-run on its own afterwards:

- Seven passed when re-run alone: `smoke` Python infinite-loop test and the Python assessment loop test (desktop), `a11y-basics` ETL builder structure, `help` welcome card, the phone topic-page sweep, the filtered-library back/forward test and the `motion` entrance test (mobile). They were timeouts during a run of 1.2 hours (Chrome could not even open a page in one of them), not defects.
- One was a real, pre-existing race in a test: `visual-engines` "Keyboard: Space, arrows, Home and End" (desktop and mobile) read the step total right after clicking a scenario tab, while the player still showed the previous scenario's "of 12". It fails the same way on production, so it predates this work. I fixed the test to read the total once it has settled (assertions unchanged); it passes on the built site and on production.
- The filtered-library test also failed on desktop once in the run and passes alone, so it is counted among the seven.

Specific checks that the new specs make: card hover moves the card and its transition is 140 to 200 ms; chips and buttons respond in 100 to 160 ms; a pressed button changes at once; the tab highlight moves; accordions work from the keyboard; entrances finish within 400 ms on ten routes and nothing loops 1.5 s later; reduced motion zeroes the stagger and parks nothing below the fold; progress read from storage is not animated; a real SQL check against PostgreSQL fails with the starter code, passes with the project's own solution, updates the roadmap and the card, and survives a refresh.

## 6. Performance, before and after

Same script, same machine, production build served by a static server. Entrance time is the time for single-pass animations to finish after the page hydrates. "Before" is `881491e`, "after" is this branch.

| Route | Entrance before | Entrance after | Layout shift before | after |
| --- | ---: | ---: | ---: | ---: |
| `/` | 645 ms | 370 ms | 0 | 0 |
| `/learn` | 555 ms | 310 ms | 0 | 0 |
| `/dashboard` | 555 ms | 310 ms | 0.024 | 0.024 |
| `/daily` | 825 ms | 370 ms | 0.02 | 0.022 |
| `/career/planner` | none | 180 ms (page fade) | **0.132** | **0** (phone profile 0.096 to 0) |
| `/projects-lab` | none | 310 ms (cards now arrive) | 0 | 0 |
| `/etl-builder`, `/dag-simulator`, `/schema-designer`, `/dq-exercises` | none | 180 ms (sidebar marker) | 0 to 0.009 | unchanged |

- Infinite animations after load: 5 to 0 on `/`, 3 to 0 on `/daily`. Animated properties that are not compositor-only: `background-position` and `box-shadow` removed; only `background-color` transitions remain (cheap).
- Card hover transition: 220 ms to 180 ms. Hover starts within 12 ms.
- Route change on the sidebar (CPU slowed 2x): content visible in 60 to 390 ms before and after (the first includes loading a lazy chunk); animations finished: `/learn` 662 to 412 ms, `/dashboard` second visit 645 to 380 ms. `/projects-lab` went from 294 to 363 ms because its cards now fade in. `/daily` reads 2,779 ms because the three rings on today's marker are still running (they are limited cues, not entrances; the entrance part is 370 ms).
- Frame times: about 100 frames sampled per page during a scripted scroll and pointer sweep. Every page except `/daily` stayed at a 95th percentile of 16.7 to 16.8 ms, on desktop and at 4x CPU. Long-task counts and times were unchanged (0.1 to 0.5 s per page at 4x).
- **Not resolved: `/daily` desktop.** In that sweep the 95th percentile frame interval was 33 ms after the change against 16.8 ms before (2 to 4 dropped frames of about 100, instead of 1). Two things I checked: main-thread work during the sweep was equal or lower on the new build (task time 150 to 165 ms against 160 to 227 ms, style recalculations 62 against 85, layout and script the same), and the long-animation-frame entries were the same single frame on both. Turning all transitions inside the page off removes the difference, but no single property list, element class, animation, banner gradient or backdrop filter I tried accounts for it, and it is larger when another application is using the GPU. I could not find the cause, so I do not claim 60 FPS for that page. Every other page measured held its frame interval.

## 7. Limitations

- `/daily` frame interval under a scripted hover sweep (section 6) is unexplained.
- Most of the 90 other files that use Lucide icons still set `h-4 w-4` directly. The shared `Icon` is used where this work touched, not everywhere.
- Long tasks on `/dq-exercises` and the other lab pages come from Monaco starting up. Starting the editor later was not attempted.
- The scroll reveal on the home page still hides below-the-fold sections until they are near the viewport (with 120 px of lead).
- Firefox and WebKit were not run. Live Supabase sync was not tested; this work does not touch it.
- The full browser run had ten failures; nine are accounted for by timeouts that passed alone and one was a pre-existing test race (section 5). A second complete run was not done.
- The production smoke test (section 9 of the task) and its results are in the release notes of the final report, not here, because they happen after deployment.
