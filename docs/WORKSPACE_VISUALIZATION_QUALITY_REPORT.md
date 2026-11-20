# Visualization quality: Python, Pandas and NumPy teach through animation

Started 2026-11-19 on branch `feature/dataforge-guide` at `f9196e7` (equal to `origin/main`, deployed). Local work only: nothing is committed, pushed, merged or deployed by this task. SQL Query Cinema is the quality benchmark and is not changed.

## 1. Gaps found (baseline, from the live pages and the code)

Evidence: screenshots of the three example programs from the brief on the deployed build, and a read of `PythonTraceVisualizer`, `PyTracePanels`, `DataStageViewer`, `ArrayView`, `BroadcastView` and `QueryCinema`.

| Domain | What the learner got | What was missing against the brief and against Query Cinema |
| --- | --- | --- |
| Python | One recorded line per step, with a single machine sentence ("About to run line 4: for price in prices:. Since the previous step: total is now 0."), a variable table, the call stack and a step table. | No calculation (`0 + 100 = 100`); the current list element is not marked during a loop; output appears only as text; no "what / changed / why / remember"; the sentence says what is *about* to run but never what the line *did*. |
| Pandas | One static stage per operation: input table, condition table and output table shown together, with KEPT / REMOVED labels. | A filter is one step, not the sequence the brief asks for (input, condition per row, classification, filtering, result); nothing moves; groupby, merge and missing values are tables, not transitions; no why or remember. |
| NumPy | One static stage per statement; a broadcasting table and the two operand arrays. | No shapes-then-alignment-then-expansion sequence; element-wise results are not shown cell by cell; matrix multiplication and axis reductions show a rule, not the row-by-column work. |
| All | Three different layouts of explanation. | No shared four-part explanation; no consistent step counter tying code, picture and text to one state. |

Query Cinema's recipe, which the new work follows: a rail of stages with exact counts, the clause marked in the code, a canvas where the real rows move in beats (before, evaluate, after), four short answers, and one player. It draws from a script built once from recorded data, so stepping never re-runs anything.

## 2. Shared layer (coordinator)

- `lib/visual/story.ts`: `StepStory { what, changed, why, remember }`, `storyProblems` (the guard every test runs: all four parts present, at most 280 characters, no placeholder or broken text), `clip`, `plural`.
- `components/visual/StoryPanel.tsx`: the same four cards in every domain. The "what" card is the screen-reader live region (no hidden duplicate); only its text is re-keyed to replay the short entrance animation (`.df-step`, silenced by the site's reduced-motion rule).
- `lib/visual/dataBeats.ts`: beats for Pandas and NumPy. A stage (one operation) becomes one or more beats (one idea each). `model.steps` equals the number of beats, so the workspace player, the code highlight, the story and the picture share one index. Builders (`pandasBeats.ts`, `numpyBeats.ts`) return `DataBeat[]` or `null` (generic beat). The generic beat has a real four-part story built only from the stage's measured analysis, so every step has all four sections even before a dedicated sequence exists.
- `workspace/visualizers/data/DataStageViewer.tsx` steps beats; the full stage (code, shapes, every table) stays in a collapsed "Code, shapes and every table for this stage" block. `DataStudio` maps a step to its stage for the code highlight.
- Tests: `siteStoryCore.test.tsx` (9).

## 3. Rules every sequence follows

1. A beat or step is a pure function of the recorded data and the index: Previous, Next and Reset restore exactly the same state, and nothing runs again.
2. If the data needed for a beat was not recorded (sampled trace, truncated window, unsupported expression), the beat is not produced or is labelled as sampled. Nothing is estimated.
3. Animation moves, fades or recolours the data that changed; durations come from `MOTION` / `EASE` (`lib/motion.ts`), only transform, opacity and colour change, nothing loops, never `transition: all`. Reduced motion shows the same information as static before/after states.
4. Every displayed value is checked against the runtime result by a test.

(Sections for Python, Pandas, NumPy, tests and evidence are appended below as they are completed.)

## 4. Python

Files: `lib/visual/pyStory.ts` (pure), `components/visual/PyScene.tsx` (picture), `workspace/visualizers/python/PyInspector.tsx` and `PythonTraceVisualizer.tsx` (workspace), `components/visual/PythonTimeMachine.tsx` (the same block in `/visual/python`). Python's tracer, the adapter and the shared player are unchanged: nothing runs again, no new engine, no new dependency.

### 4.1 Before and after (the exact definition)

The tracer records `line` events, so recorded step `i` is the state BEFORE its line runs. What that line DID is read from the next recorded step in the same frame, as a pure function of `(trace, i)` (`lineEffect` in `pyStory.ts`):

- `next(i)` is the first recorded step `k > i` whose call depth is `<=` the depth of step `i`. Steps in between are deeper: they are the calls the line made.
- The effect is **known** only when the steps are adjacent: no gap (`t.gaps`), no break in the event numbers (`seq`), no synthetic `end` step between `i` and `k`, and `depth(k) == depth(i)`.
- The effect is then the variables, in every frame of the stack, whose recorded value index differs between step `i` and step `k` (new / changed / removed; "in place" when the same list or dict object has new contents), the calls made in between (real arguments from the `call` step, the real return value from the `return` step, or the exception), and the text written to stdout between the two `out` offsets.
- Otherwise the status is `sampled` (a gap), `last`, `left` (the function ended without a recorded next line) or `raised` (the next step is an exception). The story then says that what the line did is not shown. It never describes a change or a calculation it cannot see.

### 4.2 Calculations

`0 + 100 = 100` is shown only when all three hold: (1) the statement is `name op= operand` or `name = operand (op operand)*`, every operand a variable name or a number or string literal, operators of one precedence level (`a + b * c` is refused); (2) each variable operand resolves to a recorded value in the frame before the line ran (the running function first, then the main program's globals); (3) the arithmetic done on those recorded values equals the recorded value of the target at `next(i)`, kind included (`4 / 2` is `2.0`, not `2`). Integers use `BigInt`, floats use doubles, `//` and `%` follow Python's sign rules, string `+` and `*` are read. If any check fails the story says "total went from 0 to 999" with no formula (the test corrupts a recorded value to prove it). Not read, on purpose: calls (`len(xs)`), indexing, attribute access, comprehensions, f-strings, mixed precedence, anything with parentheses. They still get the real before and after values.

### 4.3 What each story kind says, and the real data behind it

| Step | what / changed (data used) | why / remember |
| --- | --- | --- |
| Assignment, new name | `total = 0`: the name is bound; "total is created: 0 (int)", for containers "a list of 3 items, [100, 200, 300]" (new value from `next(i)`) | right side first, then the name is bound; a variable exists from the moment it is assigned |
| Assignment or `+=` with a verified calculation | the formula and "total went from 0 to 100" (operands from step `i`, result from `next(i)`); a write to a global from a function says "(global)" | `x += y` is `x = x + y`; reads, calculates, rebinds |
| Assignment, no formula | "x went from A to B" or "is created", or "changes in place: [1] → [1, 2]" | rebinding vs changing in place |
| `for` header | "Loop check 2", the item taken (loop variable at the first body step), "item 1 of 3 in prices" only when `items[index]` equals the recorded loop variable, "Iteration 2 of 3" (tracer's exact loop count); at the end "no items left, ends after 3 iterations, continues at line 5" | the loop variable is reassigned each pass; after a loop it keeps the last item |
| `while` header | the real operands (`n = 3`), True or False and the next executed line | check before every pass |
| `if` / `elif` | operands, outcome and which branch ran, all read from the next executed line (`took`: body, elif, else or skipped) | only one branch of a chain runs |
| Loop body | "Iteration k of n:" prefix, the list with the current element marked | |
| Call event | callee, call site (statement in the caller), arguments mapped to parameters (`x → a = 3`; "verified" when the argument's recorded value equals the parameter), stack growing from depth d to d+1 | each call has its own frame; parameters are new names |
| Line that calls | "add(a=3, b=3) returned 6", then the stored result | |
| Return / yield | the real return value, the locals discarded (from the frame), the caller's line, the stack shrinking | locals disappear, only the value returns |
| `print` | the new text from the `out` offsets; when the arguments are names or simple expressions and the text matches, "total is 600, so print wrote 600" plus the history of the variable (`0 → 100 → 300 → 600`, from consecutive recorded steps, only when the trace has no gaps) | print shows, the variable keeps |
| Exception | type, message, line and code line, the values held (frame at that step), the fate (caught by a handler at line N, propagates, uncaught) read from the steps that follow; why and remember come from `pyDiagnose` when it has a diagnosis | |
| Program end | final values, whole output; with an error, "ended because ... was not handled" | |
| Sampled | "Not shown. The tracer sampled this stretch..." | nothing is estimated |

Scene fields for drawing (`PyScene`): statement, `calc` (operands, symbols, result, formula), `loop` (variable, iteration, whole-run count, list items, verified index, state), `branch`, `call`, `ret`, `output` (total, added), `error`, `scope`, `stack`, `changes`, `effect`, `sampled`.

### 4.4 UI

Order in the workspace's Visualization tab: (1) the line strip: the statement, the calculation as chips (`0 + 100 = 100`), and "After this line: total `0` → `100`", with the calls the line made; (2) the picture for the step: the list with the current item marked, a call (argument chip → `a = 3` parameter chip, the stack with the new frame), a return value chip, a condition with its True or False chip, the output with the new text marked, an error box; (3) the shared StoryPanel (step counter, four answers, the "what" card is the live region); then the existing step controls, source pane, sampled notice, variable inspector, call stack, output, error diagnosis; the branch and loop panel is a collapsed section; the machine sentence and jump buttons stay at the bottom. The inspector rows tint and show "was 0 → 100" for the previous line's change and a dashed "this line: 0 → 100" chip for what the marked line is about to set. The source pane now scrolls only itself (it used `scrollIntoView`, which scrolled the story out of the box). `/visual/python` (`TraceViewer`) shows the same block above its own panels.

Motion: parts that arrive pop in with the site's `df-cell` (transform and opacity, staggered by `STAGGER`), the current list item changes colour and scale with a transition built from `MOTION.base` and `EASE.out` (`transition-[background-color,border-color,opacity,transform]`, never `transition: all`), inspector rows use `transition-colors`. Nothing loops. With `reducedMotion` none of these classes is rendered: the same chips and the same "before → after" values are shown statically, the item is still marked (border, fill and the word "now"). The heavy children (`PyStoryBlock`, the strip, each scene part, `PyInspector`, each row, the source pane) are `React.memo` with primitive or stable props.

### 4.5 Deliberately not shown

- No calculation for calls, indexing, mixed precedence, comprehensions or f-strings, and none when the arithmetic does not reproduce the recorded value.
- No list position when the iterable is not a plain variable holding a list, tuple or deque (`range(...)`, `enumerate(xs)`, a call), or when `items[index]` differs from the recorded loop variable. The item value is still shown.
- No "what the line did" at a gap, at the last step or when a function ended without a recorded next line.
- No value history of a variable when the trace is sampled or stopped early.
- Argument-to-parameter arrows are drawn from the call site text and are marked "argument text only" when the argument value could not be checked; `*args`, `**kwargs` and calls the source scan cannot find show the parameters only.
- Conditions inside one-line statements, comprehensions, `and` / `or` short circuits and `match` have no branch story (the tracer records no step for them; unchanged from before).

### 4.6 Tests

- `siteStoryPython.test.ts` (58, node, real CPython traces): the brief's example (formulas exactly `0 + 100 = 100`, `100 + 200 = 300`, `300 + 300 = 600`; loop index 0, 1, 2 at headers and body steps and none at the end; the output step reports `600` with `0 → 100 → 300 → 600`; every displayed before, after, operand, result, list item and output equals the recorded value; a corrupted recorded value removes the formula); what is and is not a calculation (floats, `//`, `%`, strings, mixed precedence, calls); call and return (arguments, return value, locals, depth); if / elif / else for three inputs and an if without else; while loop; scope (global write from a function, locals); exceptions (raising line, error scene, diagnosis, uncaught, caught); a sampled trace and two hand-made gaps (no calculation, "Not shown"); purity (300 random Next, Previous, jump, Reset, Last moves on two programs equal the canonical story; trace not mutated; out-of-range clamped); `storyProblems` on every step of 16 programs and a sampled trace.
- `siteStoryPythonUi.test.tsx` (15, jsdom): stepping changes the code highlight, the inspector row and the story together on all 11 steps; the calculation chips and the inspector chips; the list's current element; Previous and Reset restore exactly; the live region is the "what" card and the only one; the story comes before the code and the table; reduced motion renders the same text and values and none of this task's animation classes; call, return, condition, error and sampled pictures; `TraceViewer` shows the same story.
- `e2e/story-python.spec.ts` (desktop and 390 x 844): see section 4.8.

### 4.7 Limitations

- `StoryPanel` (shared) always renders its `df-step` entrance class, which only the OS-level `prefers-reduced-motion` rule silences. A learner who turns on the in-app "Reduce motion" switch still gets that one short slide of the story text. Everything this task adds follows the switch. Interface request: give `StoryPanel` a `reduced` prop.
- Stepping uses the workspace player's step index, which is the recorded step. The picture of a call or return step does not draw a connection line to the caller's line; it names it.
- Calculation text is built from the statement's source text with a small expression reader, not from Python's AST (no new engine). Anything it cannot read falls back to the plain before and after values.
- Value history for `print` needs a trace without gaps.
- Firefox and WebKit were not run.

## NumPy

Files: `lib/visual/numpyBeats.ts` (pure beat builders), `components/visual/NumpyBeatView.tsx` and `NumpyParts.tsx` (pictures). Tests: `siteStoryNumpy.test.ts`, `siteStoryNumpyUi.test.tsx`, `e2e/story-numpy.spec.ts`.

### Which operations have a sequence

| Operation | Beats (in order) | Data each beat uses |
| --- | --- | --- |
| Element-wise ops `+ - * / // % ** & \| ^`, comparisons, and the matching ufuncs (`np.add`, `np.greater`, `np.maximum` ...), two operands, at least one array | Arrays, Shapes, Align shapes, Stretch, Calculate, Result (Stretch is left out when no operand changes shape; Calculate is left out for a ufunc with no calculator, such as `np.hypot`) | input `nd` windows and scalar snapshots; the broadcast table (`an.nd.broadcast`); output window and dtype |
| Failing broadcast | Arrays, Shapes, Conflict (the conflicting axis marked), NumPy's error | the broadcast table's conflicts; the real error type and message, verbatim. No Stretch, Calculate or Result |
| Matrix multiplication `@`, `np.matmul`, `np.dot` (1-D and 2-D) | Arrays, Rule, one beat per output cell (at most `MATMUL_CELL_CAP` = 6, labelled "Sampled" when the result has more), Result | the matmul plan (`an.nd.matmul`); the row of A, column of B and result windows |
| Failing matmul | Arrays, Inner sizes differ, NumPy's error | the plan's inner sizes; the real error text |
| Axis reductions `sum prod mean min max std var median any all` (+ `amin`, `amax`), `axis` 0/1/None, `keepdims`, 1-D and 2-D | Array, Axis, Groups, Result | `an.nd.reduce` (axis, keepdims, predicted shape); input and output windows. Cells are coloured by the output element they feed; Groups lists the real values of each output element |
| Indexing, slicing, boolean masks, fancy (list) indexing, single elements | Array, [Mask], Selection, Result | `pos.sel` (which input cells), `pos.src` (the input position of every output cell), the mask snapshot in `argSnaps`, `view` (view or copy) |
| `reshape`, `ravel`, `flatten`, `squeeze`, `transpose`, `.T`, `swapaxes`, `moveaxis` (1-D and 2-D) | Array, Regroup or Swap axes, Result | `pos.src` (the source position of every output cell), `view` |

Generic beat (the stage's measured story, no sequence): array creation, `astype`, along-axis ops (`cumsum`, `sort`, `flip`), `concatenate`/`stack`, `where`, unary ufuncs (`np.sqrt`), `argmin`/`argmax`, in-place changes, reductions with `ddof`/`where`/`initial`, arrays with 3 or more dimensions, matmul with batch dimensions, and a failure that is not a broadcast or matmul-shape error.

### How the pictures teach

- Grids of the real cells, each with its position (axis headers, `title="A[0, 0] = 1"`); a window of a bigger array says "window: the first 10 x 10 cells of the real (14, 12) array" while story numbers stay exact.
- Alignment table: one column per axis, pairs appear from the last axis to the first (stagger `MOTION.fast`, at most 4 steps); "added" for a missing leading axis, "stretch" and "no match" in words as well as colour.
- Stretch: the repeated cells appear with `df-pop` and a capped stagger (30 ms, 6 items); originals are outlined, repeats dashed and tagged "copy".
- Calculate: each result cell shows `1 + 10` over `= 11`. Matmul: the row of A and the column of B are tinted, the products are listed `0 x 0 + 1 x 2 + 2 x 4 = 10`, finished cells stay filled. Reductions: input cells are coloured per output element, then one card per output element lists its values. Indexing: picked cells highlighted, the result tags `<-[1, 0]` give the source position. Reshape/transpose: both grids tinted by source row, tags `->[c, r]` and `<-[r, c]`.
- Reduced motion: no animation style is set at all; the same grids, tags and text. The picture is keyed by beat, so the entrance replays only when the step changes. Nothing loops, no `transition: all`, tokens only (light and dark), grids scroll inside their box at 390 px.

### Verification of every displayed number

Each beat recomputes what it draws from the recorded windows and compares it with the recorded result: exact for integer and boolean results; for floats within the 1e-6 relative rounding the probe applies when it records a cell (`round(x, 6)`). A disagreement makes the beat carry `ok: false` and the problems, and the picture shows "Consistency check failed" with no calculation (tests corrupt a recorded cell to prove it). A calculation that cannot be done honestly (an unparsable cell, integer overflow, an operand outside the window) is not shown. Selections and moves are checked against `pos` and the input window the same way.

### Tests

- `siteStoryNumpy.test.ts` (53 tests, real CPython + numpy): the brief's example (six beats, shapes, alignment pairs, stretched grids equal to `np.broadcast_to`, nine calculations equal to the real result), eight other operators and shapes, invalid broadcast with NumPy's real error, consistency failure, matmul (every cell's row, column, products and sum; cap and sample label; 1-D; invalid), seven axis cases checked lane by lane against numpy, indexing/slicing/masks against `argwhere`, reshape/transpose positions against `np.arange(n).reshape(..)`, windows, NaN, purity, `storyProblems` on every beat, and `model.steps === buildDataBeats().length` through the adapter.
- `siteStoryNumpyUi.test.tsx` (13 tests, jsdom): picture, story and counter agree at each beat; one live region, the "what" card; Previous and Restart restore identical DOM; reduced motion has no animation and the same text; failing stages; matmul, axis, indexing, reshape and window pictures.
- `e2e/story-numpy.spec.ts`: the brief's example on desktop and 390 x 844, Previous/Restart/Play/Pause, an invalid broadcast opening on the failing stage, no horizontal overflow, screenshots with `STORY_SHOTS=1` in `docs/images/viz-quality/numpy/`.
- Changed existing e2e: `visual-workspace.spec.ts` "invalid matmul shows the inner-dimension rule..." used `page.locator("[data-matmul-valid='false']")`; the NumPy picture and the collapsed stage details now both carry that marker, so it targets `:visible` (same intent: the learner sees the marker).
- Changed existing assertion: `siteWorkspaceDataUi.test.tsx` "numpy: broadcasting stage shows the table..." started at step 3, which was the stage `a + b` and is now its reshape beat; it now starts at that stage's first beat (`firstBeat`), same intent.

### Limitations

- 3-D and larger arrays, batch matmul and along-axis ops use the generic beat. Only the first window of an array is recorded (12 values for 1-D, 10 x 10 for 2-D), so large inputs are drawn as a window; a reduction whose group is larger than the window has no Groups beat, and a matmul whose inner size exceeds the window has no per-cell beats.
- Floats are recorded rounded to 6 decimals, so a shown formula uses the rounded operands; agreement is checked within that rounding. Integer overflow and integer division by zero are not calculated (the beat is left out rather than guessed).
- Operand names are `A` and `B`; the original expressions appear next to the label only when the code is a simple `x op y` or `np.f(x, y)`.
- Firefox and WebKit were not run.

### Visualization interface requests

None required. To remove the window limits the probe would have to record larger windows or per-axis samples (Agent D's `dataProbeProgram.ts`).

### 4.8 Browser evidence

`e2e/story-python.spec.ts` opens `/workspace?e=py:cart-line-total`, waits for the Monaco `.view-lines` text, sets the brief's code with `window.monaco`, presses Visualize and plays the 11 steps with the workspace Next button. At every step it asserts together: the highlighted source line, the step counter, the "what" answer (and that there is exactly one live region), the calculation chips (`data-formula`), the inspector value of `total`, the list's current element and the loop state, the new output text, that the story and picture sit above the code, and no horizontal scroll. Then Previous back to step 1 compares a snapshot (line, story text, calculation, inspector text) with what Next showed, and Restart returns to step 1. A second test presses Play, waits for the step to advance, presses Pause and checks it stays put. Both run on `desktop` (1440 x 900) and `mobile` (390 x 844). The Monaco "Canceled" page error is ignored, as in the other specs. With `STORY_SHOTS=1` it saves one screenshot of the whole visualization per step to `docs/images/viz-quality/python/NN-<slug>.png` (and `-mobile.png` from the mobile project).

### 4.9 Results and changed tests

Run on 2026-11-19 against my own build (`vite build`, served on port 5201) and the venv CPython. `siteStoryPython.test.ts` 58 of 58, `siteStoryPythonUi.test.tsx` 15 of 15; together with `siteStoryCore`, `siteWorkspacePython*`, `siteWorkspaceVisual*`, `siteVisualUi`, `siteVisualPyTrace`, `siteVisualEquivalencePython`, `siteVisualEquivalenceUi` and `siteVisualTraceScale`: 558 of 559 pass; the one failure is `siteWorkspaceVisualData.test.tsx` ("Stage 13 of 13", the Pandas steps, another agent's files). Browser: `story-python.spec.ts` 2 of 2 on desktop and 2 of 2 on mobile; `workspace.spec.ts` Python 4 of 4 (desktop and mobile); `visual-workspace.spec.ts` Python tests 5 of 5 on mobile and 5 of 5 on desktop; `visual.spec.ts` 10 of 12 (both Python Time Machine tests pass on both projects; the 2 failures are the Pandas studio test at `/visual/data`, which waits for a table named "Current value" after pressing End; it exercises the data tab and not Python stories. I did not run it on a clean baseline, so the cause (most likely the Pandas stage work moving that table into a collapsed block) is not proven).

One existing test changed: `siteWorkspacePythonUi.test.tsx`, "reduced motion: no transition classes and no smooth scrolling". It spied on `Element.prototype.scrollIntoView`; the source pane now scrolls only itself with `scrollTo`, so the spy is on `scrollTo`. The intent (smooth with motion, `auto` without, no `transition-colors` without motion) is unchanged. No e2e selector changed.

## Pandas

Agent D. The brief's example, `df[df["salary"] > 50000]`, is now five beats in this order: the input DataFrame (all four rows), the condition evaluated for every row (`30000 > 50000` with a True/False chip each), the rows classified (kept / removed), the filtering (removed rows fade and stay, kept rows travel into the result lane) and the real result DataFrame with one reason per row. The other operations below follow the same idea: one beat per idea, each with the four-part story, each built only from what the stage already recorded.

### Operations with a sequence

| Operation | Beats | Data each beat uses |
| --- | --- | --- |
| `df[<bool mask>]`, `.loc[mask]` | 5: input rows, condition, classify, filter, result | input window; `argSnaps[0]` (the mask); `rows.shownKept`; `cond` (new, see below) for the operands; exact counts from `StageAnalysis` |
| `query`, `drop(labels)` | 4: input, classify, filter/drop, result | `rows.shownKept`, argument text |
| `dropna` | 5: input, mark NaN cells, apply the rule, drop, result | NaN positions of the input window; `how`/`subset`/`thresh` from the call; the rule must predict the real kept rows or no beat is built |
| `drop_duplicates` | 4: input, compare (which row repeats which), remove, result | row values of the window, `subset`/`keep`; the prediction must equal `rows.shownKept` |
| `sort_values`, `sort_index` | 4: current order, read the key, reorder (rows move), result | input and output windows matched by index label; the direction is stated only if the output really is in that order |
| `df[["a","b"]]`, `df["a"]`, `drop(columns=)` | 3: all columns, pick or mark columns, result | `colNames` in/out, input window |
| `a + b`, `df["x"] > 5` | 3: operands, row by row, result | operand snapshots (series or scalar) aligned by label, output series |
| `df["c"] = expr`, `assign()` | 3: before, calculate each row (operand columns next to the new values), after | before and after grids, `diffGrids`; operand columns are the existing columns the code names |
| `fillna`, `ffill`, `bfill`, `interpolate` | 3: find the gaps, apply the rule (`NaN → value` in each gap), result | NaN positions before, values after; unfilled gaps stay marked |
| `isna`, `isnull`, `notna`, `notnull` | 3: input, test every cell, result | NaN positions, output booleans |
| `groupby(key)` | 3: input, find the groups (a colour per key), rows move into groups | group snapshots (`groups[i].snap.index` identify the member rows), `ngroups`, `srcRows`, `inGroups` |
| `<groups>.sum()/mean()/count()/min()/max()/median()/std()/var()/nunique()/first()/last()/prod()/size()`, `agg('sum')` | 3: the groups, the calculation per group (`sum(1, 3) = 4`), result | group member values, the real output cell of each group |
| `merge`, `join`, `pd.merge` | 4: two tables, match the keys (links, unmatched marked), keep rows by `how`, result with origin | `MergeInfo` (matched keys with left x right counts, leftShown/rightShown, origin counts), key cells of the windows |

An in-place call (`df.dropna(inplace=True)`) is recognised from its statement and uses the same beats. Operations without a sequence keep the generic beat with its measured story: `head`/`tail`/`sample`, `rename`, `reset_index`/`set_index`, `astype`, `pivot`/`melt`/`stack`, `apply`/`map`, `.str`/`.dt`, rolling, `concat`, a column selection on a GroupBy, a mask stored in a variable (its own compare stage has beats; the later filter shows the mask only), label slices, `agg` with a dict or a list, `how='cross'`. The full list is in the header of `lib/visual/pandasBeats.ts`.

### Rules the beats follow

- A beat refuses to exist when a check against the real result fails; that stage then uses the generic beat. Examples: the `dropna` rule must predict the real kept rows; the `drop_duplicates` rule must predict `shownKept`; the mask must equal the kept rows; the parts of a compound condition must combine to the real mask; a sort direction must hold in the output; merge links must agree with the real matched/unmatched flags. A test tampers with the recorded row flow and checks the beats disappear.
- The picture holds copies of the real cells and flags in its beat's view; nothing is computed while stepping. Building the beats twice gives equal output and does not change the stage (tested), so Previous, Next and Reset restore the same state.
- Windows: 12 rows x 10 columns and 6 groups x 5 rows. A sampled picture says so ("Sampled: the picture draws the first 12 of 40 rows ...") and the lane counts and every number in the stories are the exact ones from the analysis.
- Every story passes `storyProblems(..., { allowNaN: true })`, and `beatsOf` refuses a beat whose story would not.

### Pictures and animation

`PandasFlowBoard.tsx` (rows as cards in two lanes), `PandasPictures.tsx` (grid with column/cell tones, per-row calculation table with chips, groups that collapse into their aggregate, the real result table), `PandasBeatView.tsx` (entry: a plain function returning an element, no hooks, one stable key per stage so the board stays mounted between beats).

- Cards move by `transform`, fade by `opacity`, change colour by `transition-colors`; durations from `MOTION`, easing from `EASE`, a stagger of 30 ms capped at 6 cards (`STAGGER`); never `transition: all`; nothing loops. Rows are identified by index label plus their values and are `React.memo` with stable keys, so stepping re-renders only the cards whose position or tone changed.
- Chips that arrive (verdicts, calculated results, new cells) use the existing `df-cell` pop, which the site's reduced-motion rule silences; with reduced motion the class is not added at all.
- Reduced motion: no transition style on any card. A beat in which rows move is drawn as two static boards, Before and After, with the same classes and words (kept, removed, no match ...). Colour is never the only signal: every tone has a glyph and a word, and the legend names them.
- 390 px: the two-lane board keeps a 172 px minimum per lane and scrolls inside its own container; the page does not scroll sideways (asserted at every step on a phone). Tokens only (`success`, `danger`, `warn`, `info`, `accent`, surfaces), so light and dark follow the theme.
- The live region is the story's "what" card; the pictures contain no live region.

### Probe change (additive)

`DataStage.cond` (`lib/visual/dataframe.ts`) and `_cond` in `dataProbeProgram.ts`: for `df[<condition>]` the probe also records each comparison of the condition with its two operands and its own True/False column, so the condition beat can show `30000 > 50000`. Only call-free expressions (plus a few safe methods such as `mean()`) are evaluated a second time, so nothing with a side effect runs twice. `_opnd` records a numpy scalar as its Python value (`53750.0`, not `np.float64(53750.0)`). Every existing field and consistency check is unchanged; `siteWorkspaceDataProbe.test.ts` still passes (59 tests).

### Tests

- `siteStoryPandas.test.ts` (33 tests, real CPython + pandas, a second independent run computes the truth): the brief's filter (exactly 5 beats in order, verdicts `[false, true, false, true]`, kept B and D, removed A and C, result equal to the real DataFrame, story numbers equal to the runtime); compound `&` condition and a `mean()` threshold; a stored mask; sort (permutation equals the real order, direction, `sort_index`, already sorted, in place); select, drop columns; calculation per row (Series x Series, Series x scalar, comparison); new column and `assign`; groupby membership equals `g.groups`; every aggregate equals the real result (`sum`, `mean`, `count`) and a sampled group list; merge inner/left/right/outer (matched keys, unmatched rows, row count, origin counts, links = real key pairs, which unmatched rows stay), repeated keys multiply, `join`; dropna (NaN positions, rule, tampering refuses), fillna/ffill (NaN positions and filled values), isna, drop_duplicates (which row duplicates which, `keep='last'`), drop and query; more than 12 rows (labelled sampled, exact numbers, rows sorted beyond the window marked, not invented); generic fallbacks; every story passes the guard; purity; the adapter's `steps` equals the number of beats.
- `siteStoryPandasUi.test.tsx` (9 tests, jsdom): the picture and the story change together on each of the five steps; Previous and Next restore identical pictures and stories; the live region is the "what" card and the picture has none; reduced motion draws two static boards and no transition or `df-cell`; with motion the transitions are transform/opacity only; merge links and tones; groupby colours, header cards, calculation lines and result; select/fill pictures with words; a sampled input.
- `e2e/story-pandas.spec.ts`: the brief's code is set through `window.monaco` on `/visual/data` (after the editor's `.view-lines` text has rendered), Explain visually, and at each of the six steps the highlighted source line, the picture, the four-part story, the `data-step-key` and the step counter agree; the kept card really ends to the right of the removed one and the removed one is faded; Previous restores exactly what Next showed; Restart; Play then Pause; a groupby + sum + merge program; the same five beats in the exercise workspace with its own player; no horizontal overflow. Desktop and 390 x 844. With `STORY_SHOTS=1` it writes one screenshot per step to `docs/images/viz-quality/pandas/NN-<slug>[-mobile].png`.
- Existing assertions changed (the beat count legitimately changed the step count; intent kept): `siteWorkspaceDataAdapter.test.ts` (`steps` is `buildDataBeats(d).length`, still at least the stage count); `siteWorkspaceDataUi.test.tsx` merge test (reads the stage's full panel inside the collapsed details block of the merge beats instead of the first step); `siteWorkspaceVisualData.test.tsx` (the last step belongs to "Stage K of K" instead of step count = stage count; a result table named `Result` also counts); `e2e/visual-workspace.spec.ts` (`goToStage` goes by the stage heading, the merge and filter-and-sort tests open the details block that holds the stage's full panel); `e2e/visual.spec.ts` (table name may be `Result`).

### What is not shown, and why

- Operands of a condition that contains a call other than the safe few, or a condition stored in a variable: the probe did not record them, so the beat shows the real True/False column only.
- Rows beyond the 12 x 10 window and groups beyond 6: counted exactly, not drawn.
- `agg` with several functions, named aggregation, `transform`, window and resample operations, pivot, melt, concat: generic beat. Merge on the index with `left_index`/`right_index` (not `join`) draws tones but no key links; `how='cross'` and keys that are not in the drawn columns fall back.
- Float cells are recorded rounded to 6 decimals, so a drawn operand can be a rounded value; the result is the real recorded one.

### Limitations

- Firefox and WebKit were not run. Light theme: the pictures use the site tokens only, no light-theme screenshot was taken (the shots are in the dark theme).
- Keys are compared as the recorded text (clipped to 18 characters), so two different long keys that agree in their first 17 characters would be linked; the link check against the real matched/unmatched flags removes the links if that disagrees.
- A multi-key `ascending=[True, False]` states no direction; `sort_values(key=...)` is described as "the sort key".
- `DataStudio` still labels its timeline with the stage titles (`analyses.map(...)`), which no longer line up with the beats; requested from the coordinator below.

### Visualization interface requests

See the bottom of `docs/WORKSPACE_COORDINATION.md` ("Agent D (Pandas)"): the `DataStudio` timeline labels; the collapsed details block; the additive `DataStage.cond`.

---

## 5. Coordinator verification (2026-11-19 and 2026-11-20)

All runs are against the working tree on `feature/dataforge-guide` (base `f9196e7`, uncommitted). Python tests used the repo venv (`DAILY_PYTHON`, venv `bin` on `PATH`). Browser runs used a Cloudflare-style static server over the prerendered `dist-site`, so hydration was exercised on the real HTML.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint src` | clean |
| Full Vitest (`--maxConcurrency=2`) | 160 files: 159 passed, 8,256 tests passed, 10 skipped. 13 `siteDaily` execution tests timed out while the agents' browser runs had the machine at load average 18. |
| `siteDaily` alone, same settings | 4,937 passed, 0 failed, 2 skipped |
| New suites | shared core 9; Python 58 + 15; NumPy 53 + 13; Pandas 33 + 9 |
| `npm run build:site` + `check:prerender` | 1,139 pages, no failed Suspense boundaries |
| Browser, Chromium desktop and mobile (390x844), prerendered build, serial: `story-python`, `story-pandas`, `story-numpy`, `workspace`, `visual-workspace`, `visual`, `daily-workspace`, `query-cinema`, `smoke`, `lesson-workspace`, `a11y-basics`, `motion` | 212 passed, 12 skipped (self-skipping specs), 0 failed |
| Browser, Firefox and WebKit, desktop and mobile, the three story specs | 34 passed, 2 failed on first run (`story-python`, Firefox mobile: the spec chose the phone layout from `isMobile`, which Firefox does not set). The spec now uses the viewport width; re-run: 4 of 4 passed (Firefox desktop and mobile). |

Query Cinema and the SQL adapter are unchanged; the `query-cinema` spec passes.

### Existing tests changed (intent kept)

- `siteWorkspacePythonUi`: spy on `scrollTo` instead of `scrollIntoView` (the source pane now scrolls only itself).
- `siteWorkspaceDataAdapter`, `siteWorkspaceDataUi`, `siteWorkspaceVisualData`: step counts are beats, not stages; the full stage panel is read from its details block.
- `e2e/visual-workspace.spec.ts`, `e2e/visual.spec.ts`: `goToStage` goes by the stage heading; the table may be named `Result`; the invalid-matmul marker uses `:visible`.
- Shared fixes made by the coordinator from agent requests: `StoryPanel` takes `reduced` (the in-page "Reduce motion" switch now also stops the story's entrance slide), `storyProblems` accepts a real `nan` or `inf` value when asked, `DataStudio` timeline labels follow beats.

### Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Python learners watch code execute and variables change | Prices/total example: `0 + 100 = 100`, `100 + 200 = 300`, `300 + 300 = 600`, current list item highlighted, output step explains 600. 58 + 15 tests on real CPython traces; 22 screenshots in `docs/images/viz-quality/python/`. |
| Pandas learners watch records transform | Salary filter is exactly five beats (input, condition per row, classification, rows move, result); also sort, select, calculated column, groupby and aggregation, merge, missing values, drop duplicates. 33 + 9 tests; 12 screenshots in `docs/images/viz-quality/pandas/`. |
| NumPy learners watch dimensions align and arithmetic unfold | (3,1)+(3,) is exactly six beats; matmul per output cell; axis lanes; indexing, reshape, transpose; invalid broadcast and matmul name the conflict. 53 + 13 tests; 16 screenshots in `docs/images/viz-quality/numpy/`. |
| Explanations stay synchronized with every step | Each domain's UI tests assert code highlight, picture, inspector and the four-part story agree at every step; the "what" card is the single live region. |
| Learners control and inspect execution | Shared workspace player (Play, Pause, Next, Previous, Reset, speed, step counter); Previous and Reset restore the identical state (purity tests over hundreds of random moves). |
| Displayed values match the runtime | Python: a corrupted recorded value removes the formula. Pandas: beats are compared with a second independent CPython run and refuse to exist when the data does not back them. NumPy: every cell calculation is recomputed from the operand windows and compared with the real result; one corrupted cell shows a visible consistency failure. |
| Reduced motion, mobile, themes | Reduced motion shows the same information as static states (tested in each domain). 390 px browser runs pass in all three. Dark screenshots for every step; light-theme screenshots of Python step 6, the Pandas result beat and the NumPy calculate beat in `docs/images/viz-quality/light/`. A light-theme mobile screenshot was not taken. |

### Not done or not proven

- Firefox and WebKit ran only the three story specs, not the whole matrix.
- Light theme was checked by eye on three screenshots, not by a contrast tool.
- Windows are limited by the probe (12 rows by 10 columns, 6 groups, 10x10 array window); the pictures say so and the numbers in stories stay exact.
- Dedicated sequences exist for the operations listed in sections 4 and the Pandas and NumPy sections; everything else (for example pivot, melt, concat, rolling, 3-D arrays) uses the generic beat with a real four-part story.
- Python formulas are limited to simple one-precedence-level expressions of recorded names and literals; no formula for calls, indexing or comprehensions.
- Nothing was committed, pushed, merged or deployed.

## 6. SQL visualizer in the workspace: back to the original (2026-11-20)

Request: the SQL visualizer in the exercise workspace should be the previous version, because the wrapped panel did not look good there. The workspace's SQL Visualize now renders the original `VizView` (the Query Cinema with its rail of stages, rows moving between stages, its own player and its logical, structure and plan tabs), the same component `/query-visualizer` and the question page use. Nothing in Query Cinema itself changed.

- `workspace/visualizers/sql/ClassicSqlVisualizer.tsx` (new) renders `VizView` for the statement the learner ran; `LazySqlVisualizer.tsx` now exports it. The wrapper (`SqlVisualizer` with the detail panels and host-driven player) is still in the folder and still tested, but is not what the learner sees.
- The visualizer is marked `standalone`. `VisualizationPanel` then adds no second player, provenance badge, notes, motion switch or height-limited box, so there is one set of controls.
- Like the question page, the original view runs its own read-only EXPLAIN and row-trace queries for the statement (rolled back); it never changes data.
- Tests: `siteWorkspaceCoreUi` gained a panel test for standalone visualizers (no panel player, no panel badge, no height limit); `siteWorkspaceSqlVisualizer` "the lazy component..." now asserts the export is standalone and loads the original view. Browser (prerendered build): `workspace`, `daily-workspace`, `query-cinema`, `smoke`, `workspace-discovery`: 110 passed, 2 skipped, 0 failed.
- Not available in the workspace SQL view any more: the wrapper's extra Details tab (CTE, subquery, window, group and NULL panels), its own plan tab with measured actuals, and the compare tab. They remain in code and tests if you want any of them back as an option.
