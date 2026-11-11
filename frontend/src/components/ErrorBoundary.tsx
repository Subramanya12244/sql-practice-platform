import { Component, type ErrorInfo, type ReactNode } from "react";
import { classifyError } from "../site/lib/diagnostics";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error, info);
    classifyError(error, "APPLICATION_ERROR", "navigation", { code: "REACT_RENDER_ERROR" });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-screen flex-col items-center justify-center gap-3 bg-surface p-8 text-center">
          <h1 className="font-display text-2xl text-danger">Something went wrong</h1>
          <p className="max-w-md text-ink-muted">{this.state.message}</p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              this.setState({ hasError: false, message: undefined });
              window.location.assign("/");
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
