import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  FileCode2,
  FileText,
  FileSpreadsheet,
  FileJson,
  Folder,
  Plus,
  Trash2,
  Play,
  FlaskConical,
  RotateCcw,
  Loader2,
  X,
  Terminal,
  CheckCircle2,
  XCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Edit3,
  Eraser,
  Square,
} from "lucide-react";
import { runPython, stopPython, resetPython, isPythonWarmed, PY_TIMEOUT_MS } from "../lib/pyRunner";
import { runPythonTask, type TaskResult, type TestCounts } from "../lib/tasks";
import type { PythonTask } from "../lib/tasks";
import { validateVirtualPath, VFS_LIMITS } from "../lib/virtualFs";
import { Badge, IconButton, Skeleton } from "./ui";
import { HelpTooltip } from "../help/HelpTooltip";
import { useHelpExample } from "../help/exampleBridge";
import type { HelpExample } from "../help/types";

const CodeEditor = lazy(() => import("./CodeEditor"));

export interface WorkspaceFile {
  name: string;
  content: string;
  readOnly?: boolean;
}

export interface PythonWorkspaceProps {
  slug: string;
  title: string;
  task?: PythonTask | null;
  defaultFiles?: WorkspaceFile[];
  onSolved?: () => void;
  onCheckResult?: (result: TaskResult & { counts?: Record<string, TestCounts> }, code: string) => void;
  onRunResult?: (result: { ok: boolean; ms?: number; error?: string; stdout?: string }, code: string) => void;
  externalCode?: { name: string; content: string; ts: number } | null;
  height?: number;
  className?: string;
  mode?: "exercise" | "project";
}

function getFileIcon(name: string) {
  if (name.endsWith(".py")) return <FileCode2 className="h-4 w-4 text-accent" />;
  if (name.endsWith(".json")) return <FileJson className="h-4 w-4 text-warn" />;
  if (name.endsWith(".csv")) return <FileSpreadsheet className="h-4 w-4 text-success" />;
  return <FileText className="h-4 w-4 text-ink-faint" />;
}

export function PythonWorkspace({
  slug,
  title,
  task,
  defaultFiles,
  onSolved,
  onCheckResult,
  onRunResult,
  externalCode,
  height = 540,
  className = "",
  mode: _mode = "exercise",
}: PythonWorkspaceProps) {
  const storageKey = `sqlp.py.workspace.${slug}`;
  const draftKey = `sqlp.py.draft.${slug}`;

  // Initialize files from storage or defaults
  const [files, setFiles] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
      const draft = localStorage.getItem(draftKey);
      if (draft) {
        return {
          "solution.py": draft,
          "main.py": `# Interactive script testing\nfrom solution import *\n\nprint("Workspace initialized.")\n`,
        };
      }
    } catch {
      /* ignore */
    }
    const initial: Record<string, string> = {};
    if (defaultFiles && defaultFiles.length > 0) {
      defaultFiles.forEach((f) => {
        initial[f.name] = f.content;
      });
    } else {
      initial["solution.py"] = task?.starter ?? "# Write your Python solution here\n";
      initial["main.py"] = `# Interactive script testing\nfrom solution import *\n\nprint("Workspace initialized.")\n`;
    }
    return initial;
  });

  const [activeFile, setActiveFile] = useState<string>("solution.py");
  const [openTabs, setOpenTabs] = useState<string[]>(["solution.py", "main.py"]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => setClientReady(true), []);
  // On phones the explorer would leave the editor ~150px wide: start collapsed (it stays one tap away).
  useEffect(() => {
    if (window.matchMedia?.("(max-width: 639px)").matches) setSidebarOpen(false);
  }, []);
  const [newFileName, setNewFileName] = useState("");
  const [isCreatingFile, setIsCreatingFile] = useState(false);

  // Execution state
  const [busy, setBusy] = useState<"run" | "check" | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<"uninitialized" | "ready" | "running" | "failed" | "restarting">(() =>
    isPythonWarmed() ? "ready" : "uninitialized"
  );
  const [stdin, setStdin] = useState("");
  const [activeBottomTab, setActiveBottomTab] = useState<"output" | "tests" | "stdin">("output");
  const [terminalOutput, setTerminalOutput] = useState<string>("");
  const [testResult, setTestResult] = useState<(TaskResult & { counts?: Record<string, TestCounts> }) | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Debounced persistence
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const updateFileContent = (name: string, content: string) => {
    setFiles((prev) => {
      const next = { ...prev, [name]: content };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
          if (name === "solution.py") {
            localStorage.setItem(draftKey, content);
          }
        } catch {
          /* ignore */
        }
      }, 500);
      return next;
    });
  };

  // Help "Try Example": goes into its own help_example.py tab. solution.py and every other learner file stay untouched,
  // and graded checks only ever read solution.py, so the example is never part of a submission.
  const loadHelpExample = (example: HelpExample) => {
    const name = "help_example.py";
    if (!(name in files) && Object.keys(files).length >= VFS_LIMITS.MAX_FILES) {
      alert(`Cannot create more than ${VFS_LIMITS.MAX_FILES} files. Delete a file you no longer need, then try the example again.`);
      return;
    }
    updateFileContent(name, example.code.endsWith("\n") ? example.code : `${example.code}\n`);
    setOpenTabs((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setActiveFile(name);
    setActiveBottomTab("output");
  };
  useHelpExample("python", "the Python workspace", { isDirty: () => false, load: loadHelpExample, ready: clientReady });

  // External code restore sync
  useEffect(() => {
    if (externalCode && externalCode.ts) {
      updateFileContent(externalCode.name, externalCode.content);
      setActiveFile(externalCode.name);
      if (!openTabs.includes(externalCode.name)) {
        setOpenTabs((prev) => [...prev, externalCode.name]);
      }
    }
  }, [externalCode]);

  const handleCreateFile = () => {
    const raw = newFileName.trim();
    if (!raw) {
      setIsCreatingFile(false);
      return;
    }
    const fileName = raw.includes(".") ? raw : `${raw}.py`;
    try {
      validateVirtualPath(fileName);
      if (Object.keys(files).length >= VFS_LIMITS.MAX_FILES) {
        alert(`Cannot create more than ${VFS_LIMITS.MAX_FILES} files.`);
        setIsCreatingFile(false);
        return;
      }
      if (!files[fileName]) {
        setFiles((prev) => ({ ...prev, [fileName]: "" }));
        setOpenTabs((prev) => (prev.includes(fileName) ? prev : [...prev, fileName]));
        setActiveFile(fileName);
      }
    } catch (err) {
      alert((err as Error).message);
    }
    setNewFileName("");
    setIsCreatingFile(false);
  };

  const handleDeleteFile = (fileName: string) => {
    if (fileName === "solution.py") return; // Keep primary file
    if (!confirm(`Delete ${fileName}?`)) return;
    setFiles((prev) => {
      const next = { ...prev };
      delete next[fileName];
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setOpenTabs((prev) => prev.filter((t) => t !== fileName));
    if (activeFile === fileName) {
      setActiveFile("solution.py");
    }
  };

  const handleCloseTab = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = openTabs.filter((t) => t !== name);
    setOpenTabs(next);
    if (activeFile === name) {
      setActiveFile(next[next.length - 1] ?? "solution.py");
    }
  };

  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  const handleStartRename = (fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (fileName === "solution.py") return;
    setRenamingFile(fileName);
    setRenameValue(fileName);
  };

  const handleFinishRename = (oldName: string) => {
    const raw = renameValue.trim();
    if (!raw || raw === oldName) {
      setRenamingFile(null);
      return;
    }
    const nextName = raw.includes(".") ? raw : `${raw}.py`;
    try {
      validateVirtualPath(nextName);
      if (files[nextName] && nextName !== oldName) {
        alert(`A file named "${nextName}" already exists.`);
        setRenamingFile(null);
        return;
      }
      setFiles((prev) => {
        const next = { ...prev };
        const content = next[oldName] ?? "";
        delete next[oldName];
        next[nextName] = content;
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      setOpenTabs((prev) => prev.map((t) => (t === oldName ? nextName : t)));
      if (activeFile === oldName) {
        setActiveFile(nextName);
      }
    } catch (err) {
      alert((err as Error).message);
    }
    setRenamingFile(null);
  };

  const handleResetWorkspace = () => {
    if (!confirm("Reset workspace to initial starter files? This will reset all files in this problem.")) return;
    const initial: Record<string, string> = {};
    if (defaultFiles && defaultFiles.length > 0) {
      defaultFiles.forEach((f) => {
        initial[f.name] = f.content;
      });
    } else {
      initial["solution.py"] = task?.starter ?? "# Write your Python solution here\n";
      initial["main.py"] = `# Interactive script testing\nfrom solution import *\n\nprint("Workspace initialized.")\n`;
    }
    setFiles(initial);
    setActiveFile("solution.py");
    setOpenTabs(["solution.py", "main.py"]);
    setTerminalOutput("");
    setTestResult(null);
    setErrorLine(null);
    resetPython();
    setRuntimeStatus("uninitialized");
    try {
      localStorage.setItem(storageKey, JSON.stringify(initial));
      if (initial["solution.py"]) {
        localStorage.setItem(draftKey, initial["solution.py"]);
      }
    } catch {
      /* ignore */
    }
  };

  const handleClearOutput = () => {
    setTerminalOutput("");
    setTestResult(null);
    setErrorLine(null);
  };

  // Execution: Script Mode (runs active file or main.py directly)
  const runScript = async () => {
    setBusy("run");
    setRuntimeStatus("running");
    setActiveBottomTab("output");
    setErrorLine(null);

    const activeCode = files[activeFile] ?? "";
    const otherFiles: Record<string, string> = { ...files };

    const r = await runPython(activeCode, undefined, PY_TIMEOUT_MS, stdin, otherFiles);
    setTerminalOutput([r.stdout, r.error].filter(Boolean).join("\n") || "(no output)");
    setLastMs(r.ms ?? null);
    if (!r.ok && r.errorLine) {
      setErrorLine(r.errorLine);
    }
    setRuntimeStatus(r.phase === "load" ? "failed" : "ready");
    onRunResult?.(r, activeCode);
    setBusy(null);
  };

  // Execution: Function Challenge Mode (grades solution.py through test harness)
  const checkTests = async () => {
    if (!task) return;
    setBusy("check");
    setRuntimeStatus("running");
    setActiveBottomTab("tests");
    setErrorLine(null);

    const solutionCode = files["solution.py"] ?? "";
    const otherFiles: Record<string, string> = { ...files };

    // Check if starter is completely untouched raising NotImplementedError
    if (/raise\s+NotImplementedError/.test(solutionCode) && !/def\s+\w+.*:[\s\S]+(return|yield)/.test(solutionCode)) {
      setTestResult({
        ok: false,
        message: "Starter function raises NotImplementedError. Implement your logic before checking tests.",
        output: "NotImplementedError: function has not been implemented yet.",
        ms: 0,
      });
      setBusy(null);
      return;
    }

    let reportedLine: number | undefined;
    const res = await runPythonTask(
      task,
      solutionCode,
      (c, t) =>
        runPython(c, t, PY_TIMEOUT_MS, stdin, otherFiles).then((r) => {
          reportedLine = r.errorLine;
          return r;
        }),
      { count: true }
    );

    setTestResult(res);
    setLastMs(res.ms ?? null);
    if (reportedLine) setErrorLine(reportedLine);
    setRuntimeStatus(res.ok || (res as { phase?: string }).phase !== "load" ? "ready" : "failed");
    onCheckResult?.(res, solutionCode);
    if (res.ok) {
      onSolved?.();
    }
    setBusy(null);
  };

  const resetStarter = () => {
    if (!confirm("Reset solution.py to the original starter code?")) return;
    const starter = task?.starter ?? "# Write your solution here\n";
    updateFileContent("solution.py", starter);
    try {
      localStorage.setItem(draftKey, starter);
    } catch {
      /* ignore */
    }
  };

  const copyCode = async () => {
    const text = files[activeFile] ?? "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const currentContent = files[activeFile] ?? "";

  return (
    <div
      aria-label={`Python workspace: ${title}`}
      data-help="py-workspace"
      className={`flex flex-col overflow-hidden rounded-card border border-surface-border bg-surface-raised shadow-panel transition-all duration-base ${
        fullScreen ? "fixed inset-0 z-50 rounded-none" : ""
      } ${className}`}
      style={{ height: fullScreen ? "100vh" : height }}
    >
      {/* Top Workspace Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border bg-surface-overlay/60 px-3 py-2 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide File Explorer" : "Show File Explorer"}
            aria-label={sidebarOpen ? "Hide file explorer" : "Show file explorer"}
            aria-expanded={sidebarOpen}
            className="rounded p-1 text-ink-muted transition-colors hover:bg-hover/5 hover:text-ink"
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <Folder className="h-4 w-4 text-accent" />
            <span className="hidden sm:inline">Workspace</span>
          </span>
          {lastMs !== null && (
            <Badge tone="neutral" className="tabular-nums">
              {lastMs} ms
            </Badge>
          )}
          {busy ? (
            <Badge tone="accent" className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Running</span>
            </Badge>
          ) : runtimeStatus === "ready" ? (
            <Badge tone="success">Ready</Badge>
          ) : runtimeStatus === "failed" ? (
            <Badge tone="danger">Runtime Error</Badge>
          ) : runtimeStatus === "restarting" ? (
            <Badge tone="accent">Restarting</Badge>
          ) : (
            <Badge tone="neutral">Python 3.13</Badge>
          )}
          <HelpTooltip id="pyodide" label="What is Pyodide and where does my code run?" />
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <IconButton label="Copy file code" onClick={copyCode} className="h-8 w-8">
            {copied ? <Check className="h-3.5 w-3.5 animate-pop text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label="Reset starter" onClick={resetStarter} className="h-8 w-8">
            <RotateCcw className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label={fullScreen ? "Exit full screen" : "Full screen"}
            onClick={() => setFullScreen((v) => !v)}
            className="h-8 w-8"
          >
            {fullScreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton
            label="Reset workspace to default"
            onClick={handleResetWorkspace}
            className="h-8 w-8"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </IconButton>

          <span className="mx-1 h-4 w-px bg-surface-border" />

          {/* Script Mode Run Button */}
          <button
            type="button"
            onClick={runScript}
            disabled={!!busy}
            title="Execute active file in script mode"
            data-help="py-run"
            className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-surface-border bg-surface-raised px-3 text-xs font-semibold text-ink transition-all duration-fast hover:bg-surface-overlay active:scale-[0.98] disabled:opacity-50"
          >
            {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-accent" />}
            <span>Run Script</span>
          </button>

          {/* Function Challenge Mode Test Button (when task is present) */}
          {task && (
            <button
              type="button"
              onClick={checkTests}
              disabled={!!busy}
              title="Grade solution.py with test harness"
              data-help="py-check"
              className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent shadow-glow transition-all duration-fast hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              <span>Check Tests</span>
            </button>
          )}
          <HelpTooltip id="check-tests" label="How do trying code and testing it differ?" />

          {busy && (
            <button
              type="button"
              onClick={() => {
                stopPython();
                setBusy(null);
                setTerminalOutput((prev) => `${prev}\nExecution stopped by user.`);
              }}
              title="Stop the running code"
              className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-danger px-2.5 text-xs font-semibold text-on-accent transition-all duration-fast active:scale-[0.98]"
            >
              <Square className="h-3 w-3 fill-current" aria-hidden />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="flex min-h-0 flex-1">
        {/* Left Side: File Explorer */}
        {sidebarOpen && (
          <aside data-help="py-files" className="w-48 shrink-0 border-r border-surface-border bg-surface-overlay/30 p-2 text-xs">
            <div className="mb-2 flex items-center justify-between text-ink-faint">
              <span className="font-semibold uppercase tracking-wider text-[10px]">Files</span>
              <button
                type="button"
                onClick={() => setIsCreatingFile(true)}
                title="New file"
                className="rounded p-0.5 hover:bg-hover/10 hover:text-ink"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {isCreatingFile && (
              <div className="mb-2 flex items-center gap-1">
                <input
                  type="text"
                  autoFocus
                  placeholder="name.py"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFile();
                    if (e.key === "Escape") setIsCreatingFile(false);
                  }}
                  onBlur={handleCreateFile}
                  className="w-full rounded border border-accent bg-surface px-1.5 py-0.5 text-xs text-ink outline-none"
                />
              </div>
            )}

            <ul className="space-y-0.5">
              {Object.keys(files).map((name) => {
                const isActive = activeFile === name;
                return (
                  <li
                    key={name}
                    onClick={() => {
                      if (renamingFile !== name) {
                        setActiveFile(name);
                        if (!openTabs.includes(name)) setOpenTabs((prev) => [...prev, name]);
                      }
                    }}
                    className={`group flex cursor-pointer items-center justify-between rounded px-2 py-1 transition-colors duration-fast ${
                      isActive ? "bg-accent-dim/60 font-semibold text-accent" : "text-ink-muted hover:bg-hover/5 hover:text-ink"
                    }`}
                  >
                    {renamingFile === name ? (
                      <input
                        type="text"
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFinishRename(name);
                          if (e.key === "Escape") setRenamingFile(null);
                        }}
                        onBlur={() => handleFinishRename(name)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded border border-accent bg-surface px-1 py-0.5 text-xs text-ink outline-none"
                      />
                    ) : (
                      <>
                        <span className="flex min-w-0 items-center gap-1.5 truncate">
                          {getFileIcon(name)}
                          <span className="truncate">{name}</span>
                        </span>
                        {name !== "solution.py" && (
                          <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={(e) => handleStartRename(name, e)}
                              title={`Rename ${name}`}
                              className="p-0.5 hover:text-accent"
                            >
                              <Edit3 className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFile(name);
                              }}
                              title={`Delete ${name}`}
                              className="p-0.5 hover:text-danger"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>
        )}

        {/* Center: Editor + Tabs + Output Panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tab Strip */}
          <div className="scroll-fade-x flex items-center gap-1 border-b border-surface-border bg-surface-overlay/50 px-2 py-1">
            {openTabs.map((name) => {
              const isActive = activeFile === name;
              return (
                <div
                  key={name}
                  onClick={() => setActiveFile(name)}
                  className={`flex cursor-pointer select-none items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-1.5 text-xs transition-all duration-fast ${
                    isActive
                      ? "border-accent bg-surface-raised font-semibold text-ink shadow-panel"
                      : "border-transparent text-ink-muted hover:bg-hover/5 hover:text-ink"
                  }`}
                >
                  {getFileIcon(name)}
                  <span>{name}</span>
                  {openTabs.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => handleCloseTab(name, e)}
                      title="Close tab"
                      className="rounded-full p-0.5 hover:bg-hover/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Monaco Code Editor */}
          <div className="min-h-0 flex-1" data-help="py-editor">
            {/* The editor is lazy-loaded: React's server renderer cannot suspend, so prerender and the first client render show the same skeleton and the editor mounts after. */}
            {!clientReady ? <Skeleton className="h-full rounded-none" /> : (
            <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
              <CodeEditor
                value={currentContent}
                onChange={(v) => updateFileContent(activeFile, v)}
                onRun={task ? checkTests : runScript}
                height={fullScreen ? 500 : 280}
                label={`${activeFile} editor`}
                language={activeFile.endsWith(".py") ? "python" : "sql"}
                errorLine={errorLine}
                errorMessage={testResult?.message || "Execution error"}
              />
            </Suspense>
            )}
          </div>

          {/* Bottom Resizable Output Panel */}
          <div className="flex h-44 shrink-0 flex-col border-t border-surface-border bg-surface-overlay/20">
            {/* Output Panel Header */}
            <div className="flex items-center justify-between gap-2 border-b border-surface-border px-3 py-1.5 text-xs">
              <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                <button
                  type="button"
                  data-help="py-output-tab"
                  onClick={() => setActiveBottomTab("output")}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors ${
                    activeBottomTab === "output" ? "bg-accent-dim text-accent" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <Terminal className="h-3.5 w-3.5" /> Output
                </button>
                {task && (
                  <button
                    type="button"
                    data-help="py-tests-tab"
                    onClick={() => setActiveBottomTab("tests")}
                    className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors ${
                      activeBottomTab === "tests" ? "bg-accent-dim text-accent" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    <FlaskConical className="h-3.5 w-3.5" /> Tests
                    {testResult && (
                      <span className={`ml-1 text-[10px] ${testResult.ok ? "text-success" : "text-danger"}`}>
                        {testResult.ok ? "✓" : "✗"}
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  data-help="py-stdin-tab"
                  onClick={() => setActiveBottomTab("stdin")}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors ${
                    activeBottomTab === "stdin" ? "bg-accent-dim text-accent" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  Stdin {stdin ? `(${stdin.split("\n").length})` : ""}
                </button>
              </div>

              <button
                type="button"
                onClick={handleClearOutput}
                className="flex shrink-0 items-center gap-1 text-[11px] text-ink-faint hover:text-ink transition-colors"
                title="Clear output and test results"
              >
                <Eraser className="h-3 w-3" /> Clear
              </button>
            </div>

            {/* Output Panel Content */}
            <div className="flex-1 overflow-auto p-3 font-mono text-xs text-ink" role="region" aria-label="Console Output" data-help="py-console">
              {activeBottomTab === "output" && (
                <pre className="whitespace-pre-wrap font-mono leading-relaxed">
                  {terminalOutput || <span className="text-ink-faint">Press &ldquo;Run Script&rdquo; to execute the active file.</span>}
                </pre>
              )}

              {activeBottomTab === "tests" && (
                <div className="space-y-2">
                  {testResult ? (
                    <>
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {testResult.ok ? (
                          <span className="flex items-center gap-1.5 text-success">
                            <CheckCircle2 className="h-4 w-4 animate-pop" /> All Tests Passed!
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-danger">
                            <XCircle className="h-4 w-4" /> Tests Incomplete
                          </span>
                        )}
                        {testResult.ms !== undefined && (
                          <span className="text-xs font-normal text-ink-muted">({Math.round(testResult.ms)} ms)</span>
                        )}
                      </div>
                      <p className={`rounded-lg px-3 py-1.5 text-xs ${testResult.ok ? "bg-success-dim text-success" : "bg-danger-dim text-danger"}`}>
                        {testResult.message}
                      </p>
                      {testResult.output && (
                        <pre className="max-h-24 overflow-auto rounded bg-surface-soft p-2 text-[11px] text-ink-muted">
                          {testResult.output}
                        </pre>
                      )}
                    </>
                  ) : (
                    <p className="text-ink-muted">Press &ldquo;Check Tests&rdquo; to run the test harness against solution.py.</p>
                  )}
                </div>
              )}

              {activeBottomTab === "stdin" && (
                <div className="flex h-full flex-col">
                  <p className="mb-1 text-[11px] text-ink-faint">
                    Lines entered here are provided to Python&apos;s <code>input()</code> during script execution:
                    <HelpTooltip id="stdin-input" label="What is the Stdin tab for?" className="ml-1" />
                  </p>
                  <textarea
                    value={stdin}
                    onChange={(e) => setStdin(e.target.value)}
                    placeholder="Enter standard input lines here..."
                    className="flex-1 resize-none rounded border border-surface-border bg-surface p-2 font-mono text-xs text-ink outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
