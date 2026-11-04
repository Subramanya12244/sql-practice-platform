import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor, languages, IDisposable } from "monaco-editor";
import { formatStandardSql } from "../utils/formatSql";
import {
  AlignLeft,
  Copy,
  Eraser,
  Play,
  RotateCcw,
  Send,
  TextSelect,
} from "lucide-react";
import { useToast } from "./Toast";
import { useTheme } from "../contexts/ThemeContext";
import type { ResultTarget, RunScope, TableSchema } from "../types";

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL OUTER JOIN",
  "CROSS JOIN",
  "SELF JOIN",
  "ON",
  "AND",
  "OR",
  "NOT",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "IS NULL",
  "IS NOT NULL",
  "GROUP BY",
  "HAVING",
  "ORDER BY",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "DISTINCT",
  "AS",
  "WITH",
  "UNION",
  "UNION ALL",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "NULLIF",
  "CAST",
  "ROUND",
  "OVER",
  "PARTITION BY",
  "ROW_NUMBER",
  "RANK",
  "DENSE_RANK",
  "LAG",
  "LEAD",
];

export interface RunRequest {
  sql: string;
  scope: RunScope;
}

interface Props {
  value: string;
  onChange: (sql: string) => void;
  onRun: (request: RunRequest) => void;
  /** Omit to hide the Submit button (free-form playground). */
  onSubmit?: () => void;
  running?: boolean;
  submitting?: boolean;
  starterSql?: string;
  schemas?: TableSchema[];
  resultTarget: ResultTarget;
  onResultTargetChange: (target: ResultTarget) => void;
  submitLabel?: string;
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  onSubmit,
  running,
  submitting,
  starterSql = "",
  schemas = [],
  resultTarget,
  onResultTargetChange,
  submitLabel,
}: Props) {
  const toast = useToast();
  const { resolved: theme } = useTheme();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const schemasRef = useRef(schemas);
  schemasRef.current = schemas;
  const completionRef = useRef<IDisposable | null>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const valueRef = useRef(value);
  valueRef.current = value;
  const [hasSelection, setHasSelection] = useState(false);

  useEffect(() => {
    monacoRef.current?.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  const getSelectionSql = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return "";
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel || sel.isEmpty()) return "";
    return model.getValueInRange(sel);
  }, []);

  const runAll = useCallback(() => {
    const sql = valueRef.current.trim();
    if (!sql) return;
    onRunRef.current({ sql: valueRef.current, scope: "all" });
  }, []);

  const runSelection = useCallback(() => {
    const selected = getSelectionSql();
    if (!selected.trim()) {
      toast.push("Select some SQL first", "info");
      return;
    }
    onRunRef.current({ sql: selected, scope: "selection" });
  }, [getSelectionSql, toast]);

  const runAllRef = useRef(runAll);
  runAllRef.current = runAll;
  const runSelectionRef = useRef(runSelection);
  runSelectionRef.current = runSelection;

  const registerCompletions = useCallback(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    completionRef.current?.dispose();
    completionRef.current = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [".", " ", "\n"],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const line = model.getLineContent(position.lineNumber);
        const before = line.slice(0, position.column - 1);
        const dotted = before.match(/([A-Za-z_][\w]*)\.\s*$/);

        const suggestions: languages.CompletionItem[] = [];
        const tables = schemasRef.current;

        if (dotted) {
          const aliasOrTable = dotted[1].toLowerCase();
          const table =
            tables.find((t) => t.table_name.toLowerCase() === aliasOrTable) ||
            tables.find((t) => t.table_name.toLowerCase().startsWith(aliasOrTable));
          if (table) {
            for (const col of table.columns) {
              suggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: col.name,
                detail: `${table.table_name}.${col.name} : ${col.data_type}`,
                range,
              });
            }
          }
        } else {
          for (const kw of SQL_KEYWORDS) {
            suggestions.push({
              label: kw,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: kw,
              detail: "SQL",
              range,
            });
          }
          for (const table of tables) {
            suggestions.push({
              label: table.table_name,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: table.table_name,
              detail: `table · ${table.columns.length} columns`,
              range,
            });
            for (const col of table.columns) {
              suggestions.push({
                label: `${table.table_name}.${col.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: `${table.table_name}.${col.name}`,
                detail: col.data_type,
                range,
              });
            }
          }
        }

        return { suggestions };
      },
    });
  }, []);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      setHasSelection(!!sel && !sel.isEmpty());
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runAllRef.current();
    });
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => {
        runSelectionRef.current();
      },
    );
    registerCompletions();
  };

  useEffect(() => {
    registerCompletions();
    return () => {
      completionRef.current?.dispose();
      completionRef.current = null;
    };
  }, [schemas, registerCompletions]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
      e.preventDefault();
      if (e.shiftKey) runSelectionRef.current();
      else runAllRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const formatSql = useCallback(() => {
    try {
      const formatted = formatStandardSql(value);
      onChange(formatted);
      toast.push("SQL formatted", "success");
    } catch {
      toast.push("Could not format SQL", "error");
    }
  }, [value, onChange, toast]);

  const copySql = async () => {
    await navigator.clipboard.writeText(value);
    toast.push("SQL copied", "info");
  };

  const clearSql = () => {
    if (!value.trim()) return;
    if (!window.confirm("Clear the editor?")) return;
    onChange("");
  };

  const resetSql = () => {
    if (!window.confirm("Reset to starter SQL?")) return;
    onChange(starterSql);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border bg-surface-overlay/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            SQL Editor
          </span>
          <div className="flex items-center gap-1 rounded-lg border border-surface-border bg-surface p-0.5">
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-[11px] transition ${
                resultTarget === "same"
                  ? "bg-accent-dim text-accent"
                  : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => onResultTargetChange("same")}
              title="Replace the active results tab"
            >
              Same tab
            </button>
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-[11px] transition ${
                resultTarget === "new"
                  ? "bg-accent-dim text-accent"
                  : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => onResultTargetChange("new")}
              title="Open results in a new tab"
            >
              New tab
            </button>
          </div>
          <span className="hidden text-[10px] text-ink-faint xl:inline">
            ⌘/Ctrl+Enter run all · ⌘/Ctrl+Shift+Enter selection
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn-secondary" onClick={formatSql} title="Format SQL">
            <AlignLeft className="h-3.5 w-3.5" />
            Format
          </button>
          <button type="button" className="btn-secondary" onClick={copySql} title="Copy">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="btn-secondary" onClick={clearSql} title="Clear">
            <Eraser className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="btn-secondary" onClick={resetSql} title="Reset">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={runSelection}
            disabled={running || !hasSelection}
            title="Run selected SQL only"
          >
            <TextSelect className="h-3.5 w-3.5" />
            {running ? "Running…" : "Run Selection"}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={runAll}
            disabled={running || !value.trim()}
            title="Run the entire editor contents"
          >
            <Play className="h-3.5 w-3.5" />
            {running ? "Running…" : "Run All"}
          </button>
          {onSubmit && (
            <button
              type="button"
              className="btn-secondary border-accent/40 text-accent hover:bg-accent-dim"
              onClick={onSubmit}
              disabled={submitting || !value.trim()}
            >
              <Send className="h-3.5 w-3.5" />
              {submitting
                ? "Submitting…"
                : submitLabel || "Submit"}
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme={theme === "dark" ? "vs-dark" : "vs"}
          value={value}
          onChange={(v) => onChange(v ?? "")}
          onMount={handleMount}
          options={{
            fontSize: 14,
            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
            minimap: { enabled: false },
            lineNumbers: "on",
            tabSize: 2,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            padding: { top: 12 },
            suggestOnTriggerCharacters: true,
            quickSuggestions: {
              other: true,
              comments: false,
              strings: false,
            },
            suggest: {
              showKeywords: true,
              showSnippets: true,
              preview: true,
            },
            wordBasedSuggestions: "off",
            parameterHints: { enabled: false },
          }}
        />
      </div>
    </div>
  );
}
