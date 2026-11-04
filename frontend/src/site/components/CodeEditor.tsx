import Editor from "@monaco-editor/react";
import { useTheme } from "../../contexts/ThemeContext";

/** Small Monaco SQL editor (no toolbar). Ctrl/⌘+Enter calls onRun. Loaded lazily. */
export default function CodeEditor({ value, onChange, onRun, height = 220, label }: {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  height?: number;
  label: string;
}) {
  const { resolved } = useTheme();
  return (
    <div className="overflow-hidden rounded-lg border border-surface-border" aria-label={label}>
      <Editor
        height={height}
        defaultLanguage="sql"
        value={value}
        theme={resolved === "dark" ? "vs-dark" : "vs"}
        onChange={(v) => onChange(v ?? "")}
        onMount={(editor, monaco) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRun?.());
        }}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: "on", lineNumbers: "on", automaticLayout: true, tabSize: 2 }}
      />
    </div>
  );
}
