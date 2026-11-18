/**
 * The code editor. Reuses the site's Monaco editor (components/CodeEditor.tsx, loaded lazily) and falls back to an accessible
 * plain textarea while it loads, if it fails to load, or when `editor="plain"` (tests, very small screens).
 */
import { Component, lazy, Suspense, type KeyboardEvent, type ReactNode } from "react";

const CodeEditor = lazy(() => import("../../components/CodeEditor"));

export function PlainEditor({ value, onChange, onRun, label, rows = 12 }: { value: string; onChange: (v: string) => void; onRun?: () => void; label: string; rows?: number }) {
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onRun?.(); }
  };
  return (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} rows={rows} spellCheck={false} autoCapitalize="off" autoCorrect="off"
      className="block w-full resize-y rounded-lg border border-surface-border bg-surface p-3 font-mono text-[13px] leading-relaxed text-ink focus-visible:outline-2" />
  );
}

class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function EditorPanel({ value, onChange, onRun, language, label, editor = "monaco", height = 260, errorLine, errorMessage }: {
  value: string; onChange: (v: string) => void; onRun?: () => void; language: "sql" | "python"; label: string; editor?: "monaco" | "plain"; height?: number;
  errorLine?: number | null; errorMessage?: string;
}) {
  const plain = <PlainEditor value={value} onChange={onChange} onRun={onRun} label={label} rows={Math.max(6, Math.round(height / 22))} />;
  return (
    <div data-testid="workspace-editor">
      {editor === "plain" ? plain : (
        <EditorBoundary fallback={plain}>
          <Suspense fallback={plain}>
            <CodeEditor value={value} onChange={onChange} onRun={onRun} height={height} label={label} language={language} errorLine={errorLine} errorMessage={errorMessage} />
          </Suspense>
        </EditorBoundary>
      )}
      <p className="mt-1 text-xs text-ink-faint">Ctrl or Cmd + Enter runs your code. In the code editor, Ctrl+M moves Tab to the next control.</p>
    </div>
  );
}
