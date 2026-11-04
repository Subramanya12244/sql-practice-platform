import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Send, TerminalSquare, Trash2 } from "lucide-react";

interface Line {
  type: "input" | "output" | "error" | "system";
  text: string;
}

interface Props {
  onRun: (command: string) => Promise<{ ok: boolean; output: string; error?: string | null }>;
  onSubmit: (command: string) => void;
  running?: boolean;
  submitting?: boolean;
  disabled?: boolean;
}

export function GitTerminal({ onRun, onSubmit, running, submitting, disabled }: Props) {
  const [lines, setLines] = useState<Line[]>([
    { type: "system", text: "Git Practice Lab — sandboxed simulator. Type a git command." },
  ]);
  const [input, setInput] = useState("git ");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const push = (line: Line) => setLines((prev) => [...prev, line]);

  const run = async () => {
    const cmd = input.trim();
    if (!cmd || running || disabled) return;
    push({ type: "input", text: `$ ${cmd}` });
    setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50));
    setHistIdx(-1);
    setInput("git ");
    const res = await onRun(cmd);
    if (res.ok) {
      if (res.output) push({ type: "output", text: res.output });
      else push({ type: "system", text: "(no output)" });
    } else {
      push({ type: "error", text: res.error || res.output || "Command failed" });
    }
    inputRef.current?.focus();
  };

  const submit = () => {
    const cmd = input.trim();
    if (!cmd || submitting || disabled) return;
    onSubmit(cmd);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-surface-border bg-[#0c0c0e] dark:bg-[#0c0c0e]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <TerminalSquare className="h-3.5 w-3.5 text-accent" />
          Terminal
        </div>
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
          onClick={() =>
            setLines([
              { type: "system", text: "Terminal cleared. Repository state unchanged." },
            ])
          }
        >
          <span className="inline-flex items-center gap-1">
            <Trash2 className="h-3 w-3" /> Clear
          </span>
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 font-mono text-[12px] leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((l, i) => (
          <pre
            key={i}
            className={`whitespace-pre-wrap ${
              l.type === "input"
                ? "text-zinc-100"
                : l.type === "error"
                  ? "text-red-400"
                  : l.type === "system"
                    ? "text-zinc-500"
                    : "text-zinc-300"
            }`}
          >
            {l.text}
          </pre>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/10 p-2">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
          <span className="font-mono text-xs text-accent">$</span>
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
            value={input}
            disabled={disabled}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void run();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const next = Math.min(histIdx + 1, history.length - 1);
                if (history[next]) {
                  setHistIdx(next);
                  setInput(history[next]);
                }
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = histIdx - 1;
                if (next < 0) {
                  setHistIdx(-1);
                  setInput("git ");
                } else {
                  setHistIdx(next);
                  setInput(history[next]);
                }
              }
            }}
            placeholder="git status"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={running || disabled} onClick={() => void run()}>
            <Play className="h-3.5 w-3.5" />
            {running ? "Running…" : "Run"}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={submitting || disabled || !input.trim()}
            onClick={submit}
          >
            <Send className="h-3.5 w-3.5" />
            {submitting ? "Checking…" : "Submit answer"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            title="Prefill submit with last run command"
            onClick={() => history[0] && setInput(history[0])}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Last command
          </button>
        </div>
      </div>
    </div>
  );
}
