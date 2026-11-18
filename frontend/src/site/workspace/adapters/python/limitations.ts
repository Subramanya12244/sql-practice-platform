// Kept in its own light module so the trace views can show the adapter's list without importing the runner or the grader.
/** Shown to the learner as "Not supported here". Each line is something the tracer or runner really does not do. */
export const PYTHON_LIMITATIONS: readonly string[] = [
  "The step view is a supported-subset line tracer built on Python's sys.settrace. It is a replay of one recorded run, not a full CPython debugger: no breakpoints, no editing values while it runs, no stopping inside the standard library or C extensions (a library call is a single step).",
  "Step over, step into and step out are computed from the recorded call depth. Step back is possible because the whole run is recorded.",
  "Long loops are sampled: the first and last iterations and some checkpoints are recorded in full and the rest are summarised. Stepping is disabled across a gap because the skipped steps were not recorded; line, call and loop counts stay exact unless tracing stopped early (event or time budget), when they are lower bounds.",
  "Threads, multiprocessing and asyncio are not traced: code that uses them gets no step view. Only your own single file is traced; code in other files is not stepped.",
  "input() reads the stdin this exercise provides. Without stdin the program stops with EOFError, and the trace ends there.",
  "Branch and loop views read if, elif, else, while and for statements written on their own lines. One-line compound statements, conditional expressions (a if c else b), and/or short-circuits, match statements and conditions inside comprehensions are not shown as branches.",
  "A branch outcome is read from the next executed line. When that line was not recorded, the outcome is shown as unknown, never guessed.",
  "Values are shortened (12 items per list or dict, 80 characters) and a trace holds at most 1,500 recorded steps. The trace lives in the page only.",
  "A traced run executes your code once more under the tracer (with a 25 second limit), so a program with side effects such as printing runs again; nothing is stored.",
  "Python runs in your browser (Pyodide, Python 3.13) with a 10 second limit per run. Network, sockets and browser access are blocked, and only the standard library and packages Pyodide provides (such as numpy and pandas) can be imported.",
];
