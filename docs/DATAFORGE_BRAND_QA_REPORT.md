# DataForge brand identity: final visual QA and release readiness

Reviewed on branch `feature/brand-identity`. Starting point: commits `4be7ca3`, `8734682`, `66b14fe` on top of `471fc05` (what production ran before this work). Nothing in this report is carried over from earlier reports: every number below was produced in this review.

"Local" means the production build served from `frontend/dist-site/` by a static server on this machine. "Production" means https://dataforge.dataforge-learn.workers.dev. The two are kept apart throughout.

## 1. Branch and commit verification

- Branch: `feature/brand-identity`. The three brand commits were present and the tree was clean except the two known untracked files (`.venv-daily`, `docs/VISUAL_V2_AGENT_BRIEF.md`). Neither was staged or changed.
- `origin/main` was `471fc05`, so the branch is a plain fast-forward of it.
- Auth, Supabase, progress, curriculum and backend code: unchanged since `471fc05`. `git diff 471fc05 --name-only` lists only brand files, and the only auth file in it is `AuthPages.tsx`, where the diff is the two logo lines.

## 2. Screenshot review

Reviewed in `docs/images/brand/`: desktop and mobile navigation (light and dark), Learn Hub, Dashboard, Projects Lab, the logo-variants sheet, the favicon and app-icon sheet, and the Open Graph card.

The ten questions:

| # | Question | Finding |
|---|---|---|
| 1 | Distinctive and intentional? | Yes. A solid anvil silhouette with a horn and cut rows is not a common mark in data or SaaS branding. |
| 2 | Communicates DataForge rather than a generic anvil? | Partly. "Forge" reads at once. "Rows of a table" is not obvious from the shape alone; it is carried by the cuts and the documentation. That is acceptable for a mark, but it is the weakest part of the story. |
| 3 | Cuts visible at small sizes? | At 32 px, clearly. At 16 px the 3-unit cuts are about 0.75 px, so they show as faint lighter lines, not gaps. A unit test enforces this. |
| 4 | Silhouette at 16 and 32 px? | Recognisable at 32. At 16 it is roughly 16 x 12 px (the mark is wider than tall): it reads as a flared stack, and the anvil is less obvious. Normal for a favicon. |
| 5 | Negative space and proportions? | Balanced. The face, waist and base keep a steady rhythm and the horn gives the one intentional asymmetry. |
| 6 | Wordmark alignment? | Correct. The capital height is centred on the mark's centre; the mark is taller than the capitals, which is standard for a lockup. |
| 7 | Horizontal and symbol variants consistent? | Yes. They share one path; the variants sheet shows no drift. |
| 8 | Light and dark equal? | Yes. Wordmark 16.8:1 (light) and 16.0:1 (dark), sampled from rendered pixels; mark 5.18:1 and 7.49:1, computed from the token colours against the surface. |
| 9 | Ember restrained? | Yes. It appears only in the heated variant and the social-card rule; it is not used in the app UI. |
| 10 | Too large in the header? | No. The lockup is 157 x 34 px in a 67 px header and the wordmark is at the scale of the nav text. |

Other observations, none changed:
- The blue mark sits next to the teal interactive accent in the header. This is the documented trade-off, and it reads as intended.
- On the sign-in and sign-up pages the header lockup and the card lockup both show at tablet and desktop widths. The old identity did the same, so it was left alone.
- On the default social card the lockup is small relative to 1200 px. It is readable at link-preview size.

Conclusion: the mark is strong enough to keep. No redesign.

## 3. Responsive and visual QA (local, Chromium)

Method: 7 routes (`/`, `/learn`, `/dashboard`, `/projects-lab`, `/daily`, `/login`, `/signup`) at 320, 360, 390, 768, 1024 and 1440 px, in light and dark, 84 page measurements. For each: horizontal overflow, logo size and aspect ratio against its viewBox, geometry against the viewBox (clipping), logo inside the header, failed requests, console errors, broken images, header layout shift.

| Result | Value |
|---|---|
| Logo aspect ratio equals its viewBox | all 84 |
| Clipped geometry | 0 |
| Failed requests (4xx or network) | 0 |
| Console errors | 0 |
| Broken images | 0 |
| Header layout shift | 0 |
| Header logo at 320 px | mark only, 31.9 x 22.8 px |
| Header logo at 360 px and up | lockup, 157.25 x 34 px |
| Header height | 67 px at every width |
| Horizontal overflow | 0 everywhere except `/projects-lab` at 1024 px (2 px) |

Zoom and text scaling, emulated (viewport halved or quartered for 200% and 400% zoom; root font size raised for text scaling). Real browser zoom was not used.

| Case | Overflow |
|---|---|
| 200% zoom (720 px viewport) | 0 |
| 400% zoom (360 px viewport) | 0 |
| Text 150% at 1024 | 54 px |
| Text 200% at 1440 | 54 px |
| Text 200% at 390 | 79 px |

The overflow cases are not caused by the logo or the header. The overflowing elements are a badge in the Projects Lab cards and cards on the Learn Hub. **Production, with the old branding, shows the same overflow** (2 px, 54 px, 54 px, and 122 px at 390), so these are existing issues. They were not changed.

## 4. Browser testing

Playwright, existing configuration, system Chrome, and the Playwright Firefox and WebKit builds that were already installed. All six projects ran.

Brand spec (`e2e/brand.spec.ts`, now 12 tests per project):

| Project | Result |
|---|---|
| Chromium desktop, Chromium mobile | pass |
| Firefox desktop, Firefox mobile (touch viewport, not mobile emulation) | pass |
| WebKit desktop, WebKit mobile (iPhone 13 profile) | pass |

On the final build, after both fixes: Chromium desktop and mobile 24 of 24 (inside the regression run below) and Firefox and WebKit 48 of 48 (12 tests in each of 4 projects). Earlier, the 11-test version passed 66 of 66 across the six projects, and the share-card test passed 6 of 6 on its own.

**Layout-shift caveat.** The layout-shift API exists only in Chromium. In Firefox and WebKit the e2e shift test therefore proves nothing. To cover them, a separate script measured the header logo rectangle with web fonts blocked and with fonts loaded, before and after hydration: the rectangle was identical (157.25 x 34, header 67 px) in Chromium, Firefox (desktop and 390 px) and WebKit (desktop and iPhone 13).

Regression specs on Firefox and WebKit (a11y-basics, ux-redesign, learn-hub, help-mobile; 4 projects): **191 passed, 8 failed, 1 flaky, 16 skipped.** Failures:

| Project | Failing test |
|---|---|
| firefox-mobile | learn-hub: Learning hub is in the Learn group; ux-redesign: six categories and the header trail |
| webkit-desktop | a11y-basics: skip link is the first stop; a11y-basics: focus ring is visible; learn-hub: library usable from keyboard |
| webkit-mobile | help-mobile: Help button and bottom sheet; help-mobile: tour card docks; ux-redesign: labs never scroll sideways |

Flaky (passed on retry): firefox-mobile learn-hub "unknown id is a not-found page".

**All eight failures reproduce on production's pre-brand build (`471fc05`)**, same projects and same tests: 8 failed, 10 passed. They are existing Firefox and WebKit gaps and not regressions from this work. No assertion was changed to hide them. They remain open.

## 5. Accessibility

No axe tooling is installed and none was added. The audit used the accessibility tree, real Tab traversal, computed styles and pixel-sampled contrast.

| Check | Result |
|---|---|
| Header logo | `aria-hidden` graphic inside a link named "DataForge home" |
| Footer logo | one image named "DataForge" |
| Auth pages | one named image in the card, one in the footer, one hidden graphic in the header; no named logo sits inside a named link |
| Tab order | skip link, then the logo link, then search |
| Focus ring on the logo link | 2 px solid, 2 px offset: teal `rgb(12,104,97)` (light), `rgb(45,212,191)` (dark) |
| Contrast, light | wordmark 16.8:1 (rendered pixels); mark 5.18:1 (computed from the token) |
| Contrast, dark | wordmark 16.0:1 (rendered pixels); mark 7.49:1 (computed from the token) |
| Reduced motion | no animation touches the logo; the logo never animates |
| Forced colours | see defect 1 |

## 6. Favicon and app-icon validation

Script read the real files in `frontend/public/` (PNG decoded from scratch, ICO parsed, SVG rendered):

| Asset | Result |
|---|---|
| favicon-16 / 32 / 48 | exact size, RGBA, transparent corners; the mark touches both side edges at 16 px (the design leaves about 0.5 px there) |
| `favicon.ico` | 3 entries 16, 32, 48; each embedded PNG decodes at its declared size; length matches |
| `favicon.svg` | valid, 253 bytes, `prefers-color-scheme` rule with both blues; light render is `#2D5BFF` |
| icon-192, icon-512 | exact size, rounded tile with transparent corners, mark 64% of the tile, centred |
| icon-maskable-512 | exact size, all four corners opaque; the farthest mark corner is 30.8% of the tile from the centre, inside the 40% safe-zone circle |
| apple-touch-icon | 180 x 180, full bleed, mark centred |
| `og-image.png` | 1200 x 630 |
| 10 SVG files | all render; no image, script, filter or gradient |
| Manifest | all 4 icons exist; PNG sizes match what the manifest declares |
| `site.html` and the built `index.html` | every icon and manifest link resolves to a file |
| Stale branding | no old indigo or gradient colour in `src`, `public` or the built head, apart from the two items in defect 2 and legacy, unrelated hits (the old local app's `--bg`, a Git visual's branch colour) |

Not done: no real iOS or Android device was available, so no home-screen or real mask check.

## 7. Authentication and Supabase

- Sign-in and sign-up pages render correctly at all six widths in both themes, with no overflow, console error or failed request. The logo loads.
- Auth logic is unchanged (section 1).
- **Live authentication is unverified.** The only configured Supabase environment is the production project. There is no separate test project, and the instructions rule out production credentials. No sign-in was attempted.

## 8. Production comparison (read-only, before deployment)

Fetched with `curl` and a read-only browser load. Nothing was uploaded.

| Item | Production before deploy | This branch |
|---|---|---|
| Header logo | old (no `fill-brand` path in the DOM) | anvil lockup |
| `favicon.svg` | 610 B, indigo gradient tile with a database cylinder and arrow | 253 B, flat anvil, scheme-aware |
| Icon links in the page head | `favicon.svg`, apple-touch, manifest | adds 32 and 16 px PNG and `.ico` |
| `/favicon.ico`, `/brand/*`, `/icon-maskable-512.png` | 404 | present |
| Manifest | theme `#4f46e5`, background `#09090b`, two icons, no maskable | theme and background `#070B14`, four icons incl. maskable |
| `og-image.png` | 49 KB, light card, gradient icon tile | 37 KB, flat ink card with the lockup |
| `og:image` tag | `.../og-image.png` | same URL, new image |

So production served the previous branding, including the database-cylinder style the brief rejected.

## 9. Performance

| Item | Result |
|---|---|
| Logo SVG files | lockups 5.5 KB each; marks 219 to 246 B; favicon 253 B |
| PNG icons vs production | icon-192 2.6 KB (was 14 KB); icon-512 7.4 KB (was 44 KB); og-image 37 KB (was 49 KB) |
| Code cost | the outlined wordmark is 5.2 KB of path data in the 3.0 MB shared site bundle (880 KB gzipped); the component is a few lines |
| Logo requests | none (inline SVG) |
| Fonts | the logo does not use the web font, so it cannot shift when the font loads |
| Animation | none |
| Prerender | 1138 pages, `check:prerender` clean, four builds |
| Header layout shift | 0 in all 84 Chromium measurements |

## 10. Defects found and fixed

**Defect 1. Forced colours (Windows High Contrast): the mark could lose contrast.**
Evidence: with forced colours on a light canvas and the site's default theme (dark), the mark stayed `rgb(124,155,255)` on a white canvas, about 2.7:1, while the wordmark followed the system colour. Before and after screenshots: `docs/images/brand/qa-forced-colors-before-fix.png` and `qa-forced-colors-after-fix.png`.
Fix: the mark paths take `forced-colors:fill-current`, so the mark and wordmark share the system text colour. Tests: forced colours on a light and a dark canvas, on all six browser projects. The test fails on the pre-fix build and passes after.

**Defect 2. The Share button still produced the old identity.**
Evidence: `ShareButton.tsx` drew an indigo gradient card (`#1e1b4b` to `#4338ca`) with the site name as plain text. It appears on the Progress and Question pages.
Fix: the card is the flat ink card with the blue rule and the lockup (`docs/images/brand/qa-share-card.png`). Test: the PNG the button produces is captured and its pixels checked (rule, three flat sample points, mark colour). The test fails on the old build (the rule pixel was `44,38,125`) and passes on the new one on all six projects.

Both are in commit `301d86f`.

**Defect 3. The 150 per-question social cards typed the brand name as system-font text.**
Found after the first deployment, from a screenshot of the live card next to the live question page: the card had the mark alone at the top right and "DataForge" as plain text in whatever font the build machine had (Arial-style on CI), so it did not match the header lockup. It was missed in this review because the review looked at the default card and the mark, not the typed text on the per-question cards.
Fix: `scripts/build-site.mjs` now draws the same outlined lockup as the header and the default card, top-left, with "SQL practice · Q#" on the right. A unit test checks that the card template draws the outlined wordmark and has no typed brand name. The rebuilt card was inspected (Q1) and 150 images were generated. This fix was made after the first deployment (`d5a27d0`), in a second commit.

**Not fixed, existing, unrelated:** the 2 px overflow on `/projects-lab` at 1024 px, the large-text overflow on Learn Hub and Projects Lab cards, and the eight Firefox and WebKit regression failures. All were reproduced on production's old build.

## 11. Checks run

| Check | Result |
|---|---|
| `npx tsc -b` | no errors (run after each change) |
| `npm run lint` | no errors |
| Vitest, full suite, after defect 1 | 125 files, 7006 passed, 10 skipped (the earlier baseline was the same) |
| Brand unit tests | 24 pass (16 asset, 8 component) |
| `npm run build:site` and `check:prerender` | 1138 pages, no failed Suspense boundaries (four builds) |
| Brand e2e, six projects | all pass (see section 4) |
| Chromium regression (a11y, UX redesign, Learn Hub, Projects Lab, motion, smoke, help; desktop and mobile) | 246 passed, 18 skipped, 0 failed (264 tests; includes the 12 brand tests per project; run on the final build, after both fixes) |
| Firefox and WebKit regression | 191 passed, 8 failed (all existing), 1 flaky, 16 skipped |

## 12. Limitations

- Firefox and WebKit have 8 existing regression failures that were left as they were. The brand work did not cause them.
- No real iOS or Android device, so home-screen icons, masks and link-preview rendering on real platforms are unchecked.
- Live sign-in unverified (no test Supabase project).
- Zoom was emulated, not done with real browser zoom.
- The share-card test captures the PNG; it does not check how a particular app renders the shared image.
- Browsers cache favicons for a long time. After a deploy some visitors may keep the old tab icon for days.
- Full-suite Vitest was run after defect 1, before defect 2; defect 2 has no Vitest coverage (browser test only), and `tsc` and lint were re-run after it.

## 13. Release recommendation

READY WITH KNOWN LIMITATIONS: see sections 4 and 12. No blocking defect. The two defects found were fixed and are covered by tests.

Production status and post-deploy verification: see section 14.

## 14. Deployment

This file is committed before the deployment it describes, so it records no live result. The deployment and the live checks are reported separately, in the hand-off message. Until a live check is reported, everything above is local, apart from section 8.
