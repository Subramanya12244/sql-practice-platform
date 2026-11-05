import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { useTheme } from "../../contexts/ThemeContext";
import { FORGE_THEMES, defineForgeThemes } from "../lib/monacoTheme";

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
        beforeMount={defineForgeThemes}
        onChange={(v) => onChange(v ?? "")}
        onMount={(editor, monaco) => {
          ed.current = { editor, monaco };
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.());
        }}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: "on", lineNumbers: "on", automaticLayout: true, tabSize: language === "python" ? 4 : 2 }}
      />
    </div>
  );
}
