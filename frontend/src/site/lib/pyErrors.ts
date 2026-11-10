/**
 * Learner-facing Python error text. Pyodide tracebacks include the runner's own frames
 * (compile, ast, asyncio ...); learners only need their own lines and the final exception.
 */

const HINTS: [RegExp, string][] = [
  [/^IndentationError/m, "Hint: lines inside a function, loop or if-block must be indented by the same amount (4 spaces)."],
  [/^SyntaxError/m, "Hint: check for a missing colon, an unclosed bracket or quote, or a typo near the marked line."],
  [/^NameError: name '([^']+)'/m, "Hint: that name is used before it is defined. Check the spelling, or define it above."],
  [/^TypeError/m, "Hint: an operation received a value of the wrong type (for example adding a number to a string)."],
  [/^KeyError/m, "Hint: that key is not in the dictionary. Use dict.get(key) or check the key spelling."],
  [/^IndexError/m, "Hint: the index is past the end of the list. Remember the last valid index is len(items) - 1."],
  [/^ZeroDivisionError/m, "Hint: guard the divisor so it is never 0."],
  [/^ModuleNotFoundError|^ImportError/m, "Hint: that module is not available in the browser sandbox, or the file name is misspelled."],
];

export function cleanPyTraceback(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let keepBlock = false;
  for (const line of lines) {
    if (/^\s*File "/.test(line)) {
      keepBlock = /File "<exec>"/.test(line) || /File "\/home\/pyodide\//.test(line) || /File "[^"/]+\.py"/.test(line);
      if (keepBlock) out.push(line);
    } else if (/^\s/.test(line)) {
      // Source line, caret marker or continuation of the frame above.
      if (keepBlock) out.push(line);
    } else {
      keepBlock = false;
      if (line.trim()) out.push(line);
    }
  }
  return out.join("\n").trim();
}

/** Cleaned traceback plus one plain-language hint when the exception type is recognised. */
export function friendlyPyError(raw: string): string {
  const cleaned = cleanPyTraceback(raw) || raw.trim();
  const hint = HINTS.find(([re]) => re.test(cleaned))?.[1];
  return hint ? `${cleaned}\n\n${hint}` : cleaned;
}
