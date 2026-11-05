import { useRef } from "react";
import Editor from "@monaco-editor/react";
import { useTheme } from "../../contexts/ThemeContext";
import { FORGE_THEMES, defineForgeThemes } from "../lib/monacoTheme";

/** Small Monaco editor (SQL or Python, no toolbar). Ctrl/⌘+Enter calls onRun. Loaded lazily. */
export default function CodeEditor({ value, onChange, onRun, height = 220, label, language = "sql" }: {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  height?: number;
  label: string;
  language?: "sql" | "python";
}) {
  const { resolved } = useTheme();
  // Monaco keeps the command from mount time; read the latest handler through a ref.
  const runRef = useRef(onRun);
  runRef.current = onRun;
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
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.());
        }}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: "on", lineNumbers: "on", automaticLayout: true, tabSize: language === "python" ? 4 : 2 }}
      />
    </div>
  );
}
