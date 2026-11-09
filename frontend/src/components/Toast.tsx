import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  exiting?: boolean;
}

interface ToastCtx {
  push: (message: string, kind?: ToastKind) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.map((x) => (x.id === id ? { ...x, exiting: true } : x)));
    setTimeout(() => {
      setToasts((all) => all.filter((x) => x.id !== id));
    }, 220);
  }, []);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message, exiting: false }]);
    setTimeout(() => {
      dismiss(id);
    }, 4200);
  }, [dismiss]);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-3 rounded-card border px-4 py-3 text-sm shadow-soft backdrop-blur-md transition-all duration-base ease-out ${
              t.exiting
                ? "translate-y-2 opacity-0 scale-95"
                : "animate-toast-in"
            } ${
              t.kind === "success"
                ? "border-success/25 bg-surface-raised/95 text-success"
                : t.kind === "error"
                  ? "border-danger/25 bg-surface-raised/95 text-danger"
                  : "border-surface-border bg-surface-raised/95 text-ink"
            }`}
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 animate-pop" />
            ) : t.kind === "error" ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            )}
            <span className="flex-1 leading-relaxed text-ink">{t.message}</span>
            <button
              type="button"
              className="rounded-lg p-0.5 text-ink-faint transition-all duration-fast active:scale-90 hover:bg-hover/5 hover:text-ink"
              onClick={() => dismiss(t.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
