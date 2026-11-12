import type { HelpContentModule } from "../types";

/** Python practice: the exercise workspace (/practice/python/:slug), the problem list and the timed assessment. */
const mod: HelpContentModule = {
  sections: [
    {
      id: "python-practice",
      title: "Python practice",
      blurb: "Write Python in your browser, run it, and get graded by tests. Nothing to install.",
      icon: "code",
      routes: ["/practice/python", "/practice/python/:slug", "/practice/python/assessment"],
      home: "/practice/python",
      keywords: ["python", "pyodide", "editor", "monaco", "run", "check tests", "stdin", "input", "output", "console", "hidden tests", "traceback", "error", "debug", "assessment", "timed", "stages", "difficulty", "complexity", "big o", "variables", "lists", "dictionaries", "loops", "solution.py", "main.py"],
      overview: {
        what: "150 Python problems about real data work: records, files, logs and pipelines. Each problem opens a small coding workspace with an editor, a Run button, a Check button and a console. Python runs inside your browser tab.",
        why: "Interviews and real jobs ask you to write code that gives the right answer on cases you have not seen. Hidden tests train that habit, and error messages teach you how to find your own mistakes.",
        when: "Use it after a Daily Learning Python day, or any time you want repetition. Start at Easy and Stage 1, then work up.",
      },
      canDo: [
        "Pick a problem from the list. Filter it by Difficulty, Curriculum stage, Category, skill or Status, or search by name.",
        "Write a function in the editor, run it with Run Script, and read what it printed.",
        "Press Check Tests to grade solution.py against the visible tests and then the hidden ones.",
        "Give your code input lines in the Stdin tab, so input() has something to read.",
        "Use several files (solution.py, main.py, your own) and import one from another.",
        "Read a clear error message, see the failing line marked in the editor, and fix it.",
        "Take the timed assessment: one Easy, one Medium and one Hard problem against the clock.",
      ],
      howTo: [
        "Open a problem and read the whole description first: the scenario, the Input format, the Output format and the Examples.",
        "Look at the starter code in solution.py. It already has the function name and arguments you must keep.",
        "Write your solution in solution.py. Use main.py to try small calls of your own.",
        "Press Run Script to see what the active file prints. Fix any error shown in the Output tab.",
        "Press Check Tests. The Tests tab tells you if you passed or what went wrong.",
        "If a test fails, read the message, compare it with the Examples, fix the code and check again.",
        "Stuck? Open Show hint one at a time. Look at Show a solution last.",
        "After you pass, read the Solution explanation and the expected complexity, then open the next problem.",
      ],
      controls: [
        { name: "Run Script", what: "Runs the file you are looking at, from top to bottom. Whatever it prints (or any error) appears in the Output tab. It does not grade anything.", tip: "Use it with main.py to try your function on your own inputs." },
        { name: "Check Tests", what: "Grades solution.py. It runs the visible tests first, then the hidden ones, and shows the verdict in the Tests tab. Passing marks the problem complete.", tip: "You can press it as often as you like. Ctrl/Cmd + Enter does the same from inside the editor." },
        { name: "Stop", what: "Appears while code runs. Stops the run at once, for example when a loop never ends." },
        { name: "Output", what: "The console tab. It shows what your code printed, then any error message, and \"(no output)\" if it printed nothing." },
        { name: "Tests", what: "The test verdict tab: All Tests Passed, or Tests Incomplete with the reason." },
        { name: "Stdin", what: "A box where you type the lines that input() will read when you press Run Script. Leave it empty if your code never calls input()." },
        { name: "Files", what: "The file list on the left of the editor. Click a name to open it as a tab. solution.py is the one that is graded.", tip: "Use the Hide file explorer button to give the editor more room. It starts hidden on phones." },
        { name: "New file", what: "The + beside Files. Type a name such as notes.py; \".py\" is added if you leave it out. You can have up to 20 files.", tip: "Hover over a file (not solution.py) to rename or delete it." },
        { name: "Reset starter", what: "Puts solution.py back to the original starter code. It asks first." },
        { name: "Reset workspace to default", what: "Puts every file back to how it began and restarts Python. It asks first, and your other files are lost." },
        { name: "Clear", what: "Empties the Output and Tests tabs. It does not touch your code." },
        { name: "Show hint", what: "Reveals the problem's hints one at a time, in order.", tip: "Try for a few minutes first. Your hint use is part of your solve history." },
        { name: "Show the tests", what: "Opens the visible tests as code, so you can see exactly what is asserted. Hidden tests are not shown." },
        { name: "Show a solution", what: "Reveals a model answer after you confirm. Keep it for last." },
        { name: "Start assessment", what: "On the assessment page. Picks one Easy, one Medium and one Hard problem and starts the clock for the time limit you chose." },
      ],
      example: {
        id: "py-word-count",
        title: "Count words with a dictionary",
        target: "python",
        language: "python",
        code: `# Count how many times each word appears.
text = "the cat sat on the mat the end"

counts = {}
for word in text.split():
    counts[word] = counts.get(word, 0) + 1

for word in sorted(counts):
    print(word, counts[word])

print("most common:", max(counts, key=counts.get))
`,
        explains: "A for loop visits every word. A dictionary (counts) remembers how many times each word was seen: counts.get(word, 0) gives 0 the first time, so adding 1 works. The same pattern solves many practice problems. Press Run Script and read the Output tab.",
        expected: "Each word with its count in alphabetical order, then the most common word.",
        expectedStdout: `cat 1
end 1
mat 1
on 1
sat 1
the 3
most common: the
`,
      },
      mistakes: [
        { mistake: "Using print() where the problem asks you to return a value.", fix: "Tests read what your function returns, not what it prints. End the function with return result." },
        { mistake: "Pressing Run Script and expecting a grade.", fix: "Run Script only runs the file. Press Check Tests to grade solution.py." },
        { mistake: "Changing the function name or arguments in the starter code.", fix: "Keep them exactly. The tests call the function by that name." },
        { mistake: "Writing code that only fits the examples.", fix: "Hidden tests try empty input, duplicates, ties and bad values. Think about those cases before you check." },
        { mistake: "Writing the solution in main.py or another tab.", fix: "Only solution.py is graded. Other files are for trying things out." },
        { mistake: "Using a list or dict as a default argument, like def f(x, seen=[]).", fix: "The same list is reused on every call. Use seen=None, then set seen = [] inside the function." },
        { mistake: "Reading a long error from the top.", fix: "Read the last line first: it names the error. Then look at the line number it points to." },
      ],
      tips: [
        "Ctrl/Cmd + Enter checks the tests from inside the editor (it runs the file on pages with no tests).",
        "The first run downloads Python (about 10 MB) and can take a few seconds. After that it is quick, and the download is cached.",
        "Code stops after 10 seconds. If it stops, look for a loop that never ends.",
        "Your files are saved in this browser as you type. Reloading the page keeps them.",
        "Add print() lines in your function to see values while you debug. Remove them when you are done.",
        "Work in stage order (1 to 14): each stage adds one new idea, and the Easy problems come first.",
        "Open the problem's Theory link or the notes listed below when a word in the problem is new to you.",
      ],
      related: [
        { label: "Daily Learning", to: "/daily", why: "Python from scratch, one lesson a day" },
        { label: "Timed Python assessment", to: "/practice/python/assessment", why: "Three problems against the clock" },
        { label: "Python notes", to: "/notes/python-fundamentals", why: "Short reading on the language itself" },
      ],
      recommendations: [
        { label: "Cart Line Total (Easy, for loop)", to: "/practice/python/cart-line-total", why: "A first loop: add up price times quantity" },
        { label: "Count Event Types (Easy, dictionary)", to: "/practice/python/count-event-types", why: "The counting-with-a-dict pattern from the example" },
        { label: "Running Totals (Easy, list)", to: "/practice/python/running-totals", why: "Build a new list while looping" },
        { label: "Price Lookup With Default (Easy, dictionary)", to: "/practice/python/price-lookup-default", why: "Avoid KeyError with dict.get" },
        { label: "Safe Division (Easy, error handling)", to: "/practice/python/safe-divide", why: "Catch ZeroDivisionError with try/except" },
        { label: "Exception-Safe Type Casting (Easy, error handling)", to: "/practice/python/safe-cast", why: "Turn text into numbers without crashing" },
        { label: "Timed Python assessment", to: "/practice/python/assessment", why: "Test yourself once the Easy problems feel comfortable" },
        { label: "Notes: Loops", to: "/notes/python-loops", why: "for, while, enumerate and zip" },
        { label: "Notes: Lists, tuples, sets and dictionaries", to: "/notes/python-collections", why: "Choosing the right container" },
        { label: "Notes: Exception handling", to: "/notes/python-exceptions", why: "try/except and the errors you will meet" },
        { label: "Day 2: Variables and data types", to: "/daily/day/2", why: "Start here if variables are new" },
        { label: "Day 11: for loops and range", to: "/daily/day/11", why: "A guided lesson on loops" },
        { label: "Day 21: Exceptions and logging", to: "/daily/day/21", why: "Handling errors on purpose" },
        { label: "NumPy z-score (Hard)", to: "/practice/python/numpy-vectorised-zscore", why: "The one problem that imports NumPy, for later" },
      ],
      tour: {
        id: "python-practice",
        route: "/practice/python/cart-line-total",
        title: "Solve a Python problem, step by step",
        steps: [
          { id: "read-problem", title: "1. Read the problem", body: "The left side holds the story, the task, the Input format, the Output format and the Examples. The title row shows the Difficulty and the curriculum stage.", how: "Read it all before you type. Note the function name and what it must return.", target: ["main article", "article"] },
          { id: "understand-input", title: "2. Understand the input", body: "Most problems pass data to your function as arguments, so the Examples show you the input. Some programs read lines with input(). The Stdin tab is where you type those lines.", how: "Click Stdin and type test lines, one per line. Leave it empty if the problem does not call input().", target: ["[data-help=\"py-stdin-tab\"]", "[data-help=\"py-workspace\"]"] },
          { id: "write-code", title: "3. Write the Python code", body: "This is the code editor. solution.py holds your answer and starts with the function you must complete. Other tabs, like main.py, are free space for experiments.", how: "Click in the editor and type. Open more files from the list on the left.", target: ["[data-help=\"py-editor\"]", "[aria-label$=\"editor\"]"] },
          { id: "execute", title: "4. Execute it", body: "Run Script runs the file you are looking at and shows what it prints. Check Tests grades solution.py. Python itself runs inside your browser.", how: "Press Run Script to experiment. Press Check Tests when you think you are done. Stop ends a run that will not finish.", target: ["[data-help=\"py-run\"]", "[data-help=\"py-workspace\"]"] },
          { id: "inspect-output", title: "5. Inspect the output", body: "Everything your code prints appears here, followed by any error. A plain \"(no output)\" means nothing was printed.", how: "Use print() inside your code to look at values. Clear empties this panel.", target: ["[data-help=\"py-console\"]", "[role=\"region\"][aria-label=\"Console Output\"]"] },
          { id: "review-tests", title: "6. Review the test results", body: "After Check Tests, the Tests tab says All Tests Passed or Tests Incomplete and explains why. Passing the visible tests is not enough: hidden tests run too.", how: "Click Tests. If a test failed, compare the message with the Examples. Show the tests on the left lists the visible checks.", target: ["[data-help=\"py-tests-tab\"]", "[data-help=\"py-workspace\"]"] },
          { id: "debug-improve", title: "7. Debug and improve", body: "An error shows the error type, the line number and a short hint. The failing line is also marked in the editor. Fix it, run again, then read the Solution explanation to compare approaches.", how: "Read the last line of the error first. Use Show hint one step at a time, and Show a solution last.", target: ["[data-help=\"py-workspace\"]", "[aria-label^=\"Python workspace\"]"] },
        ],
      },
      topics: [
        { id: "how-python-runs", kind: "concept", title: "Where does my Python run?", body: "In your browser, not on a server. DataForge loads Pyodide, which is the real Python (version 3.13) compiled to run inside a web page. The first run downloads it (about 10 MB) and later runs reuse it. Your code never leaves your computer. For safety it cannot reach the internet, the page or your own files: importing js, socket, urllib.request, http.client, ssl or micropip is blocked.", keywords: ["pyodide", "webassembly", "browser", "sandbox", "version", "network", "offline", "safe"] },
        { id: "packages", kind: "concept", title: "Which packages can I import?", body: "The Python standard library works (math, json, csv, re, collections, datetime, itertools and so on). Packages Pyodide ships, such as numpy and pandas, are fetched automatically when your code imports them, so the first run with them is slower. You cannot pip install anything, and the network is blocked. Almost every practice problem needs the standard library only. The NumPy z-score problem is the one that imports NumPy.", keywords: ["import", "numpy", "pandas", "pip", "install", "library", "module not found"] },
        { id: "run-vs-check", kind: "concept", title: "Run Script or Check Tests?", body: "Run Script runs the file you are on and shows its output, so you can experiment. Check Tests grades solution.py with the problem's tests. Use Run Script while you think, Check Tests when you want a verdict.", keywords: ["run", "submit", "check", "grade", "difference"] },
        { id: "visible-hidden", kind: "concept", title: "Visible and hidden tests", body: "Show the tests lists the visible tests: plain assert lines you can read. After they pass, Check Tests runs hidden tests too. They cover edge cases such as empty input, duplicates, ties, negative numbers and very large values. If you pass the visible tests but fail a hidden one, the message says so. Write a general solution, not one that only fits the examples.", keywords: ["hidden", "visible", "edge case", "assert", "fails a hidden test"] },
        { id: "stdin-input", kind: "concept", title: "Using the Stdin tab and input()", body: "Type lines in the Stdin tab. When your file calls input(), it gets the first line, then the next, and so on. If the file asks for more lines than you typed, Python raises EOFError. Stdin is only used by Run Script and Check Tests runs; most problems pass data as function arguments and do not need it.", keywords: ["input()", "stdin", "EOFError", "read line", "console input"] },
        { id: "time-limit", kind: "concept", title: "The 10 second limit", body: "A run is stopped after 10 seconds with a message that starts \"Stopped after 10s\" and tells you to check for an infinite loop. The very first run may take longer while Python downloads (up to 90 s is allowed). After a stop, the next run starts a fresh Python. The assessment page stops each check after 10 seconds too.", keywords: ["timeout", "infinite loop", "stopped", "slow", "hang", "while true"] },
        { id: "files-tabs", kind: "workflow", title: "Work with several files", body: "The workspace is a tiny project folder. solution.py is graded and cannot be renamed or deleted. main.py starts as a scratch file that does \"from solution import *\", and you can add your own.", steps: ["Click the + beside Files and type a name such as helpers.py.", "Write a function in it.", "In solution.py write from helpers import my_function.", "Hover over a file name to rename or delete it (not solution.py).", "Click a file name to open it as a tab; the x on a tab closes it."], keywords: ["file", "tab", "rename", "delete", "new file", "import", "helper", "main.py", "solution.py", "20 files"] },
        { id: "file-limits", kind: "concept", title: "File limits", body: "A workspace holds up to 20 files, each up to 64 KB, 256 KB in total. File names may use letters, digits, dot, dash and underscore, and cannot start with a slash or contain \"..\". The files live in memory for each run, so a file you write while running is gone afterwards.", keywords: ["limit", "size", "too large", "filename", "path", "virtual filesystem"] },
        { id: "complexity", kind: "concept", title: "Complexity labels (Big-O)", body: "Many problems list an expected time and space cost such as O(n), meaning the work grows in step with the amount of data. You see it under Solution explanation, which appears after you pass or open a solution. Use it to check that your loops are not doing far more work than needed.", keywords: ["big o", "o(n)", "time", "space", "efficiency", "performance"] },
        { id: "difficulty", kind: "concept", title: "Difficulty levels", body: "Every problem is Easy, Medium or Hard. Easy problems use one idea. Medium problems combine two or three. Hard problems look like real pipeline tasks and have many edge cases. The list is sorted Easy first.", keywords: ["easy", "medium", "hard", "level"] },
        { id: "stages", kind: "concept", title: "The 14 curriculum stages", body: "The problems are arranged in 14 stages: 1 Variables, Types and Arithmetic; 2 Conditions; 3 Strings; 4 Lists, Tuples, Sets and Dictionaries; 5 Functions; 6 Comprehensions; 7 Core Algorithms and Data Structures; 8 Exceptions and Validation; 9 File I/O, CSV, JSON; 10 Classes; 11 Iterators and Generators; 12 Data Transformation; 13 Decorators and Contexts; 14 Pipeline Patterns. The list page shows your progress per stage, and the 14-Stage Progression buttons filter by stage.", keywords: ["stage", "curriculum", "progression", "roadmap", "order", "path"] },
        { id: "variables-data-structures", kind: "concept", title: "Where do I learn variables and data structures?", body: "Variables and types come first, in stage 1; lists, tuples, sets and dictionaries are stage 4. There is no variable viewer in this workspace, so use print() to look at values. The Daily Learning programme teaches both from scratch (Day 2 for variables, Day 8 to 10 for lists, tuples, sets and dicts), and the notes Variables and data types and Lists, tuples, sets and dictionaries go deeper.", keywords: ["variable", "list", "dict", "dictionary", "tuple", "set", "type", "data structure", "stage 1", "stage 4"] },
        { id: "reading-errors", kind: "workflow", title: "Debug with an error message", body: "When code fails, the Output tab shows a traceback: the lines Python was running, then the error type and message on the last line. DataForge trims the internal lines and adds a one-line hint for common errors. The line it names is also marked in the editor.", steps: ["Read the last line. It names the error, like NameError or KeyError.", "Find the line number in \"File ..., line N\" and look at that line in the editor.", "Read the hint under the error, if there is one.", "Fix one thing, press Run Script again.", "If the error moves, you made progress. Repeat."], keywords: ["traceback", "debug", "error line", "marker", "hint", "exception", "message"] },
        { id: "error-name-error", kind: "error", title: "NameError: name 'x' is not defined", body: "Python met a name it does not know. Common causes: a spelling or capital-letter difference, using a variable before the line that creates it, or forgetting to import a module. Fix: check the spelling, move the creating line above the line that uses it, or add the import.", keywords: ["NameError", "not defined", "undefined variable", "spelling"] },
        { id: "error-type-error", kind: "error", title: "TypeError (unsupported operand, not subscriptable)", body: "An operation got the wrong kind of value, for example \"5\" + 3 (text plus number) or taking len() of a number. Fix: print type(value) to see what you really have, then convert it with int(), float() or str().", keywords: ["TypeError", "unsupported operand", "can only concatenate", "not subscriptable", "NoneType", "not callable"] },
        { id: "error-index-error", kind: "error", title: "IndexError: list index out of range", body: "You asked for a position the list does not have. A list of 3 items has positions 0, 1 and 2, so items[3] fails, and any index on an empty list fails. Fix: use len(items) - 1 as the last index, check for an empty list first, or loop with for item in items.", keywords: ["IndexError", "out of range", "list index", "off by one", "empty list"] },
        { id: "error-key-error", kind: "error", title: "KeyError: 'name'", body: "The dictionary has no such key. The text after KeyError is the missing key. Fix: use record.get(\"name\") (gives None, or a default you choose) or test \"name\" in record before reading it. Check spelling and capital letters too.", keywords: ["KeyError", "missing key", "dict.get", "dictionary"] },
        { id: "error-indentation-error", kind: "error", title: "IndentationError: expected an indented block", body: "Python uses spaces at the start of a line to know what is inside a function, loop or if. The line after a colon must be indented, and all lines in one block must use the same amount (4 spaces). Fix: indent the body, and do not mix tabs and spaces.", keywords: ["IndentationError", "unexpected indent", "unindent", "tabs", "spaces"] },
        { id: "error-syntax-error", kind: "error", title: "SyntaxError: invalid syntax", body: "Python cannot read the line as code. Look at the marked line and the one above it for a missing colon after if, for, while or def, an unclosed bracket or quote, or a single = where == is meant. Fix that and run again.", keywords: ["SyntaxError", "invalid syntax", "missing colon", "unmatched", "unterminated string", "EOL"] },
        { id: "error-zero-division", kind: "error", title: "ZeroDivisionError: division by zero", body: "Something divided by 0, often an empty list's length or a missing total. Fix: check the divisor first (if total == 0: return 0.0) or catch the error with try/except ZeroDivisionError.", keywords: ["ZeroDivisionError", "divide by zero", "average of empty"] },
        { id: "error-assertion", kind: "error", title: "AssertionError or \"A test failed\"", body: "Check Tests ran an assert and the answer was wrong. The message shows what was expected when the test supplies it. Fix: run the failing example yourself in main.py, print the result, and compare it with the Examples. Check ties, empty input and rounding.", keywords: ["AssertionError", "test failed", "wrong answer", "expected", "tests incomplete"] },
        { id: "error-not-implemented", kind: "error", title: "Starter function raises NotImplementedError", body: "The starter code still has raise NotImplementedError. Check Tests refuses to grade until you replace that line with real logic that returns a value.", keywords: ["NotImplementedError", "starter", "not implemented", "raise"] },
        { id: "error-module-not-found", kind: "error", title: "ModuleNotFoundError or ImportError", body: "The module is not available in the browser sandbox, or the name is misspelled. Pip packages cannot be installed, and js, socket, urllib.request, http.client, ssl and micropip are blocked. Fix: use the standard library, and check that a file you import (such as helpers) really exists in Files.", keywords: ["ModuleNotFoundError", "ImportError", "no module named", "pip", "blocked", "sandbox", "disabled in this sandbox"] },
        { id: "error-timeout", kind: "error", title: "Stopped after 10s (check for an infinite loop)", body: "Your code ran for more than 10 seconds and was ended. The usual cause is a while loop whose condition never becomes false because the variable it checks is never updated. Fix: update that variable inside the loop, or switch to a for loop over the data.", keywords: ["timeout", "infinite loop", "while", "stuck", "stopped", "10s"] },
        { id: "error-eof", kind: "error", title: "EOFError: EOF when reading a line", body: "Your code called input() but the Stdin tab has no more lines. Fix: type the lines your program needs in the Stdin tab, one per line, or remove the input() call if the problem passes data as arguments.", keywords: ["EOFError", "input()", "stdin", "end of file"] },
        { id: "assessment-how", kind: "tutorial", title: "How the timed assessment works", body: "Open the assessment page, choose 30, 45, 60 or 90 minutes and press Start assessment. You get one Easy, one Medium and one Hard problem. Hints and solutions stay hidden. Each Check shows how many visible tests and hidden edge cases passed, but not the hidden inputs. The timer keeps running if you reload. Passing a problem also marks it completed.", steps: ["Open Timed Python assessment from the Python practice page.", "Pick a time limit; tick Include problems I've already solved only if you want repeats.", "Press Start assessment.", "Switch between Problem 1, 2 and 3 with the buttons at the top.", "Press Check; read the visible and hidden counts.", "Press Finish when done, or wait for the timer. Your score and time are saved under Past assessments."], keywords: ["assessment", "timed", "timer", "mock", "interview", "score", "30 minutes", "past assessments", "finish"] },
        { id: "assessment-differences", kind: "concept", title: "Assessment page vs a normal problem", body: "The assessment editor has one file and one Check button. There is no Run Script, no Stdin tab and no extra files, and a check stops after 10 seconds. It is graded like a normal problem, with visible tests and then hidden ones.", keywords: ["assessment", "no run", "one file", "difference"] },
      ],
    },
  ],
  glossary: [
    { id: "pyodide", term: "Pyodide", short: "Pyodide is the real Python (3.13) packaged to run inside your browser. Your code runs on your own computer, not on a server, and it cannot use the network.", more: "The first run downloads it (about 10 MB). After that it is cached.", section: "python-practice", keywords: ["python in browser", "webassembly", "sandbox"] },
    { id: "python-editor", term: "Code editor", short: "The editor is where you type Python. It colours the code, suggests names as you type, and marks the line where an error happened. Each file opens as a tab.", section: "python-practice", keywords: ["monaco", "editor", "autocomplete"] },
    { id: "run-code", term: "Run Script", short: "Run Script runs the file you are looking at and shows what it prints in the Output tab. It is for experiments and does not grade your answer.", section: "python-practice", keywords: ["run", "execute", "output"] },
    { id: "check-tests", term: "Run Script or Check Tests", short: "Run Script just runs a file and shows its output. Check Tests grades solution.py with the problem's tests and tells you whether it passed.", more: "Use Run Script to explore, Check Tests when you want a verdict.", section: "python-practice", keywords: ["submit", "grade", "difference"] },
    { id: "stdin-input", term: "Stdin tab", short: "Stdin is text you type for your program to read. Each line you enter here is what input() returns, in order, when you press Run Script.", more: "Leave it empty if your code never calls input().", section: "python-practice", keywords: ["input", "standard input"] },
    { id: "visible-vs-hidden-tests", term: "Visible and hidden tests", short: "Visible tests are shown under Show the tests. Hidden tests run after them and try edge cases like empty input, ties or big values. Pass both to complete a problem.", section: "python-practice", keywords: ["hidden", "edge case", "assert"] },
    { id: "traceback", term: "Traceback", short: "A traceback is the list Python prints when code fails. It shows which lines were running, and the last line names the error. Read that last line first.", section: "python-practice", keywords: ["stack trace", "error message", "exception"] },
    { id: "name-error", term: "NameError", short: "Python met a name it does not know. Check the spelling and capital letters, or make sure the variable is created on an earlier line than where you use it.", section: "python-practice", keywords: ["not defined"] },
    { id: "type-error", term: "TypeError", short: "You used a value of the wrong kind, like adding a number to text. Check the types with type(value) and convert with int(), float() or str().", section: "python-practice", keywords: ["wrong type"] },
    { id: "index-error", term: "IndexError", short: "You asked for a list position that does not exist. A list of 3 items has positions 0, 1 and 2, so the last one is len(items) - 1.", section: "python-practice", keywords: ["out of range"] },
    { id: "key-error", term: "KeyError", short: "The dictionary has no such key. Use record.get(\"key\") to get None instead of an error, or check \"key\" in record first.", section: "python-practice", keywords: ["missing key"] },
    { id: "indentation-error", term: "IndentationError", short: "Lines inside a function, loop or if must start with the same number of spaces (use 4). The line after a colon must be indented.", section: "python-practice", keywords: ["indent", "spaces", "tabs"] },
    { id: "syntax-error", term: "SyntaxError", short: "Python cannot read the line as code. Look for a missing colon, an unclosed bracket or quote, or a typo on the marked line or the one above it.", section: "python-practice", keywords: ["invalid syntax"] },
    { id: "for-loop", term: "for loop", short: "A for loop repeats the lines inside it once for each item. for price in prices: runs the body once per price, with price holding that item each time.", more: "Example: total = 0, then for p in prices: total += p adds them all up.", section: "python-practice", keywords: ["loop", "iterate", "range"] },
    { id: "list-vs-dict", term: "List or dict?", short: "A list keeps items in order and you find them by position: items[0]. A dict stores pairs and you find a value by its key: prices[\"apple\"].", more: "Use a list for a sequence of things and a dict for looking things up by name.", section: "python-practice", keywords: ["list", "dictionary", "collections"] },
    { id: "time-limit", term: "10 second limit", short: "A run is stopped after 10 seconds. That usually means a loop that never ends, for example a while whose variable is never updated.", section: "python-practice", keywords: ["timeout", "infinite loop"] },
    { id: "complexity-o-n", term: "O(n)", short: "O(n) means the work grows in step with the amount of data: twice as many items takes about twice as long. It is how problems label the expected speed.", more: "A loop inside a loop over the same data is O(n squared), which gets slow quickly.", section: "python-practice", keywords: ["big o", "time complexity", "linear"] },
    { id: "print-vs-return", term: "print or return?", short: "print() shows text on screen for you. return hands a value back to the code that called the function. Tests read the returned value, so use return.", section: "python-practice", keywords: ["return value", "print"] },
    { id: "mutable-default", term: "Mutable default argument", short: "A default like def add(x, seen=[]) creates one list that is shared by every call. Use seen=None, then write seen = [] inside the function.", more: "Without this fix, results from an earlier call can leak into the next one.", section: "python-practice", keywords: ["default argument", "list default", "shared state"] },
    { id: "variable", term: "Variable", short: "A variable is a name that holds a value, like total = 0. You can change it later: total = total + 5. Names are case sensitive.", section: "python-practice", keywords: ["assignment", "name", "value"] },
    { id: "file-tabs", term: "Files and tabs", short: "The workspace is like a small folder of .py files. solution.py is the one that is graded; main.py and your own files are for experiments and can be imported.", section: "python-practice", keywords: ["solution.py", "main.py", "import"] },
    { id: "error-line-marker", term: "Error line marker", short: "When your code raises an error, the line that caused it is marked in the editor, and the error message in the Output tab names the same line number.", section: "python-practice", keywords: ["red line", "line number"] },
  ],
};

export default mod;
export const { sections, glossary } = mod;
