import { useEffect, type ReactNode } from "react";
import { ThemeProvider } from "../contexts/ThemeContext";
import { ToastProvider } from "../components/Toast";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AuthProvider } from "./lib/auth";
import { installGlobalErrorHandlers } from "./lib/diagnostics";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => installGlobalErrorHandlers(), []);
  return (
    <ErrorBoundary>
      <ThemeProvider defaultPreference="dark">
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
