import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { useTheme } from "../../contexts/ThemeContext";
import { FORGE_THEMES, defineForgeThemes } from "../lib/monacoTheme";
import { PY_BUILTINS, PY_KEYWORDS, PY_MODULES, pyLocalNames } from "../lib/workspace";

type Monaco = Parameters<NonNullable<Parameters<typeof Editor>[0]["beforeMount"]>>[0];
let pyCompletions = false;
/** Python suggestions: keywords, builtins, members after `module.`, and names defined in the file. Registered once. */
function registerPython(monaco: Monaco) {
  if (pyCompletions) return;
  pyCompletions = true;
  const K = monaco.languages.CompletionItemKind;
  monaco.languages.registerCompletionItemProvider("python", {
    triggerCharacters: ["."],
    provideCompletionItems(model: import("monaco-editor").editor.ITextModel, pos: import("monaco-editor").Position) {
      const word = model.getWordUntilPosition(pos);
      const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const before = model.getLineContent(pos.lineNumber).slice(0, word.startColumn - 1);
      const mod = before.match(/([A-Za-z_]\w*)\.$/)?.[1];
      if (mod) {
        const members = PY_MODULES[mod];
        return { suggestions: (members ?? []).map((m) => ({ label: m, kind: K.Function, insertText: m, range, detail: `${mod}.${m}` })) };
      }
      const src = model.getValue();
      const locals = pyLocalNames(src);
      return {
        suggestions: [
          ...PY_KEYWORDS.map((k) => ({ label: k, kind: K.Keyword, insertText: k, range })),
          ...PY_BUILTINS.map((b) => ({ label: b, kind: K.Function, insertText: b, range, detail: "built-in" })),
          ...Object.keys(PY_MODULES).map((m) => ({ label: m, kind: K.Module, insertText: m, range, detail: "module" })),
          ...locals.map((n) => ({ label: n, kind: K.Variable, insertText: n, range, detail: "in this file" })),
        ],
      };
    },
  });
}

/** Small Monaco editor (SQL or Python, no toolbar). Ctrl/⌘+Enter calls onRun. Loaded lazily. */
export default function CodeEditor({ value, onChange, onRun, height = 220, label, language = "sql", errorLine, errorMessage }: {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  height?: number;
  label: string;
  language?: "sql" | "python";
  /** Mark this 1-based line as the error location. */
  errorLine?: number | null;
  errorMessage?: string;
}) {
  const { resolved } = useTheme();
  // Monaco keeps the command from mount time; read the latest handler through a ref.
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const ed = useRef<{ editor: Parameters<NonNullable<Parameters<typeof Editor>[0]["onMount"]>>[0]; monaco: Parameters<NonNullable<Parameters<typeof Editor>[0]["onMount"]>>[1] } | null>(null);
  useEffect(() => {
    const m = ed.current;
    const model = m?.editor.getModel();
    if (!m || !model) return;
    m.monaco.editor.setModelMarkers(model, "run", errorLine && errorLine <= model.getLineCount()
      ? [{ severity: m.monaco.MarkerSeverity.Error, message: errorMessage ?? "Error", startLineNumber: errorLine, startColumn: model.getLineFirstNonWhitespaceColumn(errorLine) || 1, endLineNumber: errorLine, endColumn: model.getLineMaxColumn(errorLine) }]
      : []);
  }, [errorLine, errorMessage]);
  return (
    <div className="overflow-hidden rounded-lg border border-surface-border" aria-label={label}>
      <Editor
        height={height}
        defaultLanguage={language}
        value={value}
        theme={resolved === "dark" ? FORGE_THEMES.dark : FORGE_THEMES.light}
        beforeMount={(m) => { defineForgeThemes(m); if (language === "python") registerPython(m); }}
        onChange={(v) => onChange(v ?? "")}
        onMount={(editor, monaco) => {
          ed.current = { editor, monaco };
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.());
        }}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          lineNumbers: "on",
          automaticLayout: true,
          tabSize: language === "python" ? 4 : 2,
          insertSpaces: true,
          autoIndent: "full",
          quickSuggestions: { other: true, comments: false, strings: false },
          suggestOnTriggerCharacters: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          bracketPairColorization: { enabled: true },
          matchBrackets: "always",
          renderLineHighlight: "all",
          renderLineHighlightOnlyWhenFocus: true,
          smoothScrolling: true,
        }}
      />
    </div>
  );
}
