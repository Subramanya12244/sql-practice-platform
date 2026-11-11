/**
 * DataForge Centralized Diagnostics & Error Classification System.
 *
 * Provides structured error classification, health probes for SQL (PGlite)
 * and Python (Pyodide), an in-memory ring buffer for events and timings,
 * and a sanitized diagnostic report generator for developers.
 */

export type ErrorCategory =
  | "APPLICATION_ERROR"
  | "SQL_ENGINE_ERROR"
  | "PYTHON_RUNTIME_ERROR"
  | "PYTHON_EXECUTION_ERROR"
  | "WORKER_ERROR"
  | "PACKAGE_LOADING_ERROR"
  | "NETWORK_ERROR"
  | "AUTHENTICATION_ERROR"
  | "DATABASE_SYNC_ERROR"
  | "PDF_EXPORT_ERROR"
  | "PROJECT_VALIDATION_ERROR"
  | "ASSESSMENT_ERROR";

export type FeatureId =
  | "sql_practice"
  | "sql_playground"
  | "sql_visualizer"
  | "python_practice"
  | "python_workspace"
  | "guided_projects"
  | "study_notes"
  | "assessments"
  | "account_sync"
  | "navigation"
  | "data_generator"
  | "data_quality";

export type Severity = "info" | "warn" | "error" | "fatal";

export interface DiagnosticEvent {
  id: string;
  category: ErrorCategory;
  feature: FeatureId;
  code: string;
  severity: Severity;
  userMessage: string;
  technicalMessage: string;
  timestamp: string;
  recoverable: boolean;
  suggestedAction: string;
  metadata?: Record<string, unknown>;
}

export interface EngineHealth {
  status: "healthy" | "degraded" | "uninitialized" | "error";
  engine: "pglite" | "pyodide";
  version: string;
  lastPingMs?: number;
  message?: string;
}

export const MAX_EVENTS = 200;
export const RETENTION_DAYS = 90;
const STORE_KEY = "sqlp.diag.log";
const eventLog: DiagnosticEvent[] = [];
const subscribers = new Set<(events: DiagnosticEvent[]) => void>();

let eventSequence = 0;

/**
 * Remove anything that could be learner code or a secret before an event is stored. Events keep their
 * fixed fields (category, code, severity, feature, messages); free text is shortened, long quoted
 * strings (usually SQL or source) are cut, and metadata keeps only short scalar values.
 */
export function redactEvent(e: DiagnosticEvent): DiagnosticEvent {
  const text = (v: string, max: number) => (sanitizeDiagnosticValue(v) as string)
    .replace(/"[^"\n]{40,}"|'[^'\n]{40,}'/g, "\"…\"")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\s+/g, " ")
    .slice(0, max);
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e.metadata ?? {})) {
    if (/sql|code|source|query|password|token|secret|key|body|text/i.test(k)) continue;
    if (typeof v === "number" || typeof v === "boolean") meta[k] = v;
    else if (typeof v === "string" && v.length <= 80) meta[k] = text(v, 80);
  }
  return {
    ...e,
    technicalMessage: text(e.technicalMessage, 300),
    userMessage: text(e.userMessage, 300),
    suggestedAction: text(e.suggestedAction, 200),
    metadata: Object.keys(meta).length ? meta : undefined,
  };
}

/** Drop events older than the retention window. */
export function pruneEvents(events: DiagnosticEvent[], now = Date.now()): DiagnosticEvent[] {
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  return events.filter((e) => Date.parse(e.timestamp) >= cutoff).slice(0, MAX_EVENTS);
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(eventLog)); } catch { /* storage full or blocked: the in-memory log still works */ }
}

function hydrate() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as DiagnosticEvent[];
    if (Array.isArray(saved)) eventLog.push(...pruneEvents(saved.filter((e) => e && typeof e.id === "string" && typeof e.timestamp === "string")));
  } catch { /* corrupt or unavailable: start empty */ }
}
if (typeof localStorage !== "undefined") hydrate();

/** Notify UI subscribers when events are recorded */
function notifySubscribers() {
  const snapshot = [...eventLog];
  subscribers.forEach((cb) => cb(snapshot));
}

/** Subscribe to live diagnostic log updates */
export function subscribeDiagnostics(callback: (events: DiagnosticEvent[]) => void): () => void {
  subscribers.add(callback);
  callback([...eventLog]);
  return () => {
    subscribers.delete(callback);
  };
}

/** Record a new diagnostic event into the circular log */
export function recordDiagnostic(event: Omit<DiagnosticEvent, "id" | "timestamp">): DiagnosticEvent {
  const fullEvent = redactEvent({
    ...event,
    id: `df-diag-${++eventSequence}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  });

  eventLog.unshift(fullEvent);
  if (eventLog.length > MAX_EVENTS) {
    eventLog.pop();
  }

  persist();
  notifySubscribers();
  return fullEvent;
}

/** Get all recorded diagnostic events */
export function getDiagnosticEvents(): DiagnosticEvent[] {
  return [...eventLog];
}

/** Clear the diagnostic event log */
export function clearDiagnosticEvents(): void {
  eventLog.length = 0;
  persist();
  notifySubscribers();
}

/**
 * Maps raw error messages to user-friendly diagnostic events.
 * Avoids showing confusing internal stack traces to learners.
 */
export function classifyError(
  rawError: unknown,
  category: ErrorCategory,
  feature: FeatureId,
  context?: { code?: string; suggestedAction?: string }
): DiagnosticEvent {
  const rawMsg = rawError instanceof Error ? rawError.message : String(rawError ?? "Unknown error");
  let userMessage = "An unexpected error occurred. Please try again.";
  let suggestedAction = context?.suggestedAction ?? "Refresh the workspace or retry the action.";
  let code = context?.code ?? "ERR_GENERIC";
  let recoverable = true;
  let severity: Severity = "error";

  if (category === "SQL_ENGINE_ERROR") {
    code = "SQL_EXEC_FAIL";
    if (rawMsg.includes("syntax error")) {
      userMessage = "Syntax error in SQL query. Check clause order, commas, and keyword spelling.";
      suggestedAction = "Verify your SQL syntax in the editor before running again.";
    } else if (rawMsg.includes("does not exist")) {
      userMessage = "Referenced table or column was not found in the current schema.";
      suggestedAction = "Check the Schema tab for exact table and column names.";
    } else if (rawMsg.includes("must appear in the GROUP BY")) {
      userMessage = "Selected column is not grouped or aggregated.";
      suggestedAction = "Add the column to GROUP BY or wrap it in an aggregate function.";
    } else {
      userMessage = "PostgreSQL query execution failed. Inspect the schema and query structure.";
    }
  } else if (category === "PYTHON_RUNTIME_ERROR") {
    code = "PY_RUNTIME_INIT";
    severity = "fatal";
    recoverable = true;
    userMessage = "Python could not initialize because a required runtime component was unavailable. Your code has not executed yet.";
    suggestedAction = "Click 'Reset Runtime' or refresh the page to restart the Web Worker interpreter.";
  } else if (category === "PYTHON_EXECUTION_ERROR") {
    code = "PY_USER_CODE";
    if (rawMsg.includes("Timeout") || rawMsg.includes("infinite loop")) {
      code = "PY_TIMEOUT";
      userMessage = "Execution timed out. Your code took longer than the safety limit (check for infinite loops or heavy operations).";
      suggestedAction = "Inspect loop termination conditions and avoid unbounded calculations.";
    } else if (rawMsg.includes("NameError")) {
      code = "PY_NAME_ERROR";
      userMessage = "A variable, function, or module name used in your code is not defined.";
      suggestedAction = "Ensure all identifiers are defined before use and check for typos.";
    } else if (rawMsg.includes("SyntaxError")) {
      code = "PY_SYNTAX_ERROR";
      userMessage = "Python syntax error: invalid syntax, unmatched parentheses, or indentation issue.";
      suggestedAction = "Check indentation and ensure all quotes and brackets are properly closed.";
    } else {
      userMessage = "Python code encountered a runtime exception during execution.";
      suggestedAction = "Inspect the line number and exception message in the output console.";
    }
  } else if (category === "PACKAGE_LOADING_ERROR") {
    code = "PY_PKG_LOAD";
    severity = "warn";
    userMessage = "A required Python package could not be downloaded from the WebAssembly CDN.";
    suggestedAction = "Check your internet connection and verify that the package is supported by Pyodide.";
  } else if (category === "DATABASE_SYNC_ERROR") {
    code = "SYNC_FAILED";
    severity = "warn";
    userMessage = "Could not sync learning progress with remote database. Progress remains saved locally.";
    suggestedAction = "Your progress is safely stored in local browser storage. It will sync automatically when connected.";
  } else if (category === "PDF_EXPORT_ERROR") {
    code = "PDF_GEN_FAIL";
    userMessage = "PDF generation could not complete.";
    suggestedAction = "Try reducing content complexity or export individual chapters.";
  } else if (category === "PROJECT_VALIDATION_ERROR") {
    code = "PROJECT_TEST_FAIL";
    userMessage = "Project task validation encountered an error during automated verification.";
    suggestedAction = "Review task requirements and verify all required tables or variables exist.";
  }

  return recordDiagnostic({
    category,
    feature,
    code,
    severity,
    userMessage,
    technicalMessage: rawMsg,
    recoverable,
    suggestedAction,
  });
}

/**
 * Scrubs any sensitive values (tokens, passwords, secrets, full user code)
 * from diagnostic export objects.
 */
export function sanitizeDiagnosticValue(val: unknown): unknown {
  if (typeof val === "string") {
    return val
      .replace(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED_JWT]")
      .replace(/(?:key|secret|password|token|auth)=["']?[^"'\s&]+/gi, "$1=[REDACTED]");
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeDiagnosticValue);
  }
  if (val && typeof val === "object") {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (/password|secret|token|apiKey|anonKey|jwt/i.test(k)) {
        clean[k] = "[REDACTED]";
      } else {
        clean[k] = sanitizeDiagnosticValue(v);
      }
    }
    return clean;
  }
  return val;
}

/** Generates a complete, sanitized developer diagnostic report */
export function generateDiagnosticReport(extra?: {
  sqlHealth?: EngineHealth;
  pythonHealth?: EngineHealth;
}): string {
  const report = {
    platform: "DataForge Interactive Learning Platform",
    generatedAt: new Date().toISOString(),
    environment: {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "SSR",
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      screenResolution:
        typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "unknown",
      storageAvailable: typeof localStorage !== "undefined",
    },
    engineHealth: {
      sql: extra?.sqlHealth ?? { status: "uninitialized", engine: "pglite", version: "0.5.10" },
      python: extra?.pythonHealth ?? { status: "uninitialized", engine: "pyodide", version: "0.29.5" },
    },
    eventSummary: {
      totalRecorded: eventLog.length,
      errors: eventLog.filter((e) => e.severity === "error" || e.severity === "fatal").length,
      warnings: eventLog.filter((e) => e.severity === "warn").length,
      info: eventLog.filter((e) => e.severity === "info").length,
    },
    recentEvents: sanitizeDiagnosticValue(eventLog.slice(0, 50)),
  };

  return JSON.stringify(report, null, 2);
}


// ── Uncaught errors ───────────────────────────────────────────────────────
const NOISE = /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection/i;
const recent = new Map<string, number>();

/** Record an error nobody handled, once per distinct message every 5 seconds. */
export function recordUncaught(raw: unknown, source: "error" | "unhandledrejection", now = Date.now()): DiagnosticEvent | null {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "Unknown error");
  if (NOISE.test(msg)) return null;
  const key = `${source}:${msg.slice(0, 120)}`;
  if (now - (recent.get(key) ?? 0) < 5000) return null;
  recent.set(key, now);
  if (recent.size > 50) recent.clear();
  const ev = classifyError(raw, "APPLICATION_ERROR", "navigation", { code: source === "error" ? "UNCAUGHT_ERROR" : "UNHANDLED_REJECTION" });
  return ev;
}

/** Install window handlers once (browser only). Returns a function that removes them. */
export function installGlobalErrorHandlers(): () => void {
  if (typeof window === "undefined") return () => {};
  const onError = (e: ErrorEvent) => { recordUncaught(e.error ?? e.message, "error"); };
  const onRejection = (e: PromiseRejectionEvent) => { recordUncaught(e.reason, "unhandledrejection"); };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
}
