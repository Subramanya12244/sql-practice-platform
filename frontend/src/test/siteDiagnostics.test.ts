// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import {
  recordDiagnostic,
  getDiagnosticEvents,
  clearDiagnosticEvents,
  classifyError,
  sanitizeDiagnosticValue,
  generateDiagnosticReport,
  subscribeDiagnostics,
  type DiagnosticEvent,
} from "../site/lib/diagnostics";

describe("Diagnostics and error classification system", () => {
  beforeEach(() => {
    clearDiagnosticEvents();
  });

  it("records diagnostic events into the circular buffer", () => {
    recordDiagnostic({
      category: "SQL_ENGINE_ERROR",
      feature: "sql_practice",
      code: "TEST_SQL_ERR",
      severity: "error",
      userMessage: "Test user message",
      technicalMessage: "syntax error at or near 'SELECT'",
      recoverable: true,
      suggestedAction: "Check syntax",
    });

    const events = getDiagnosticEvents();
    expect(events.length).toBe(1);
    expect(events[0].code).toBe("TEST_SQL_ERR");
    expect(events[0].category).toBe("SQL_ENGINE_ERROR");
    expect(events[0].id).toMatch(/^df-diag-/);
  });

  it("classifies SQL errors into learner-friendly explanations", () => {
    const evt = classifyError(
      new Error('column "total" must appear in the GROUP BY clause or be used in an aggregate function'),
      "SQL_ENGINE_ERROR",
      "sql_practice"
    );

    expect(evt.category).toBe("SQL_ENGINE_ERROR");
    expect(evt.userMessage).toContain("Selected column is not grouped or aggregated");
    expect(evt.suggestedAction).toContain("Add the column to GROUP BY");
  });

  it("classifies Python initialization and runtime errors", () => {
    const initEvt = classifyError(
      new Error("Failed to initialize WebAssembly core"),
      "PYTHON_RUNTIME_ERROR",
      "python_workspace"
    );
    expect(initEvt.category).toBe("PYTHON_RUNTIME_ERROR");
    expect(initEvt.severity).toBe("fatal");
    expect(initEvt.userMessage).toContain("Python could not initialize");

    const timeoutEvt = classifyError(
      new Error("Stopped after 10s — check for an infinite loop"),
      "PYTHON_EXECUTION_ERROR",
      "python_workspace"
    );
    expect(timeoutEvt.code).toBe("PY_TIMEOUT");
    expect(timeoutEvt.userMessage).toContain("Execution timed out");
  });

  it("scrubs authentication tokens and passwords from diagnostic exports", () => {
    const sensitiveData = {
      user: "learner@dataforge.test",
      jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature",
      anonKey: "sb_secret_token_12345",
      config: {
        password: "super_secret_db_password",
        databaseUrl: "postgresql://postgres:secret@db.supabase.co:5432/postgres?apiKey=sensitive_api_key",
        normalField: "visible_value",
      },
    };

    const sanitized = sanitizeDiagnosticValue(sensitiveData) as Record<string, unknown>;
    expect(sanitized.jwt).toBe("[REDACTED]");
    expect(sanitized.anonKey).toBe("[REDACTED]");
    const cfg = sanitized.config as Record<string, unknown>;
    expect(cfg.password).toBe("[REDACTED]");
    expect(cfg.normalField).toBe("visible_value");
  });

  it("generates a complete formatted diagnostic report", () => {
    recordDiagnostic({
      category: "PACKAGE_LOADING_ERROR",
      feature: "python_practice",
      code: "PY_PKG_FAIL",
      severity: "warn",
      userMessage: "Package download failed",
      technicalMessage: "Failed to fetch pandas.whl",
      recoverable: true,
      suggestedAction: "Retry loading",
    });

    const reportStr = generateDiagnosticReport();
    const report = JSON.parse(reportStr);

    expect(report.platform).toContain("DataForge");
    expect(report.eventSummary.warnings).toBe(1);
    expect(report.recentEvents.length).toBe(1);
    expect(report.engineHealth.sql).toBeDefined();
    expect(report.engineHealth.python).toBeDefined();
  });

  it("notifies subscribers when events are recorded or cleared", () => {
    const received: DiagnosticEvent[][] = [];
    const unsubscribe = subscribeDiagnostics((evts) => received.push(evts));

    recordDiagnostic({
      category: "APPLICATION_ERROR",
      feature: "navigation",
      code: "NAV_FAIL",
      severity: "info",
      userMessage: "Navigated to page",
      technicalMessage: "Route change: /practice",
      recoverable: true,
      suggestedAction: "",
    });

    expect(received.length).toBeGreaterThanOrEqual(2); // initial call + after record
    clearDiagnosticEvents();
    expect(received[received.length - 1].length).toBe(0);

    unsubscribe();
  });
});

