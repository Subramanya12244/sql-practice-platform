import { beforeEach, describe, expect, it, vi } from "vitest";

const load = async () => { vi.resetModules(); return import("../site/lib/diagnostics"); };
const ev = (o: Partial<import("../site/lib/diagnostics").DiagnosticEvent> = {}) => ({
  id: "x", category: "SQL_ENGINE_ERROR" as const, feature: "sql_practice" as const, code: "SQL_EXEC_FAIL", severity: "error" as const,
  userMessage: "u", technicalMessage: "t", timestamp: new Date().toISOString(), recoverable: true, suggestedAction: "a", ...o,
});

beforeEach(() => localStorage.clear());

describe("error log: redaction", () => {
  it("cuts long quoted strings (SQL or source), emails and tokens, and keeps short facts", async () => {
    const { redactEvent } = await load();
    const sql = "SELECT secret_customer_name, email FROM customers WHERE note = 'this is a long free text literal that came from the learner'";
    const out = redactEvent(ev({ technicalMessage: `syntax error at or near "${sql}" for jane.doe@example.com token=abc123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUNUGU` }));
    expect(out.technicalMessage).not.toMatch(/secret_customer_name|jane\.doe|abc123|eyJhbGci/);
    expect(out.technicalMessage).toContain("syntax error");
  });
  it("never stores long strings or code-like metadata", async () => {
    const { redactEvent } = await load();
    const out = redactEvent(ev({ technicalMessage: "x".repeat(5000), userMessage: "y".repeat(900), metadata: { sql: "SELECT 1", code: "print(1)", ms: 12, ok: true, route: "/questions/q1", note: "z".repeat(500), password: "p" } }));
    expect(out.technicalMessage.length).toBeLessThanOrEqual(300);
    expect(out.userMessage.length).toBeLessThanOrEqual(300);
    expect(out.metadata).toEqual({ ms: 12, ok: true, route: "/questions/q1" });
  });
});

describe("error log: persistence", () => {
  it("survives a reload, is capped at 200 and expires after 90 days", async () => {
    let d = await load();
    for (let i = 0; i < 230; i++) d.recordDiagnostic({ ...ev(), code: `C${i}` });
    expect(d.getDiagnosticEvents()).toHaveLength(200);
    d = await load(); // a fresh page load
    expect(d.getDiagnosticEvents()).toHaveLength(200);
    expect(d.getDiagnosticEvents()[0].code).toBe("C229"); // newest first
    expect(JSON.parse(localStorage.getItem("sqlp.diag.log")!)).toHaveLength(200);
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    expect(d.pruneEvents([ev({ timestamp: old }), ev()])).toHaveLength(1);
  });
  it("clear removes the saved copy too; corrupt storage is ignored", async () => {
    let d = await load();
    d.recordDiagnostic(ev());
    d.clearDiagnosticEvents();
    expect(JSON.parse(localStorage.getItem("sqlp.diag.log")!)).toEqual([]);
    localStorage.setItem("sqlp.diag.log", "{not json");
    d = await load();
    expect(d.getDiagnosticEvents()).toEqual([]);
  });
});

describe("error log: uncaught errors", () => {
  it("captures window errors and unhandled rejections after reload-safe install", async () => {
    const d = await load();
    const swallow = (e: Event) => e.preventDefault(); // keep the test runner from treating our synthetic errors as real
    window.addEventListener("error", swallow);
    const off = d.installGlobalErrorHandlers();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom in widget"), message: "boom in widget" }));
    const rej = new Event("unhandledrejection") as Event & { reason?: unknown };
    rej.reason = new Error("promise failed");
    window.dispatchEvent(rej);
    const codes = d.getDiagnosticEvents().map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["UNCAUGHT_ERROR", "UNHANDLED_REJECTION"]));
    off();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("after uninstall"), message: "after uninstall" }));
    expect(d.getDiagnosticEvents().some((e) => e.technicalMessage.includes("after uninstall"))).toBe(false);
    window.removeEventListener("error", swallow);
  });
  it("ignores browser noise and de-duplicates repeats within 5 seconds", async () => {
    const d = await load();
    expect(d.recordUncaught("ResizeObserver loop completed with undelivered notifications.", "error")).toBeNull();
    expect(d.recordUncaught("Script error.", "error")).toBeNull();
    const t = 1_000_000;
    expect(d.recordUncaught("same failure", "error", t)).not.toBeNull();
    expect(d.recordUncaught("same failure", "error", t + 1000)).toBeNull();
    expect(d.recordUncaught("same failure", "error", t + 6000)).not.toBeNull();
  });
  it("classifies render errors, sync, auth and worker failures into the log", async () => {
    const d = await load();
    d.classifyError(new Error("render blew up"), "APPLICATION_ERROR", "navigation", { code: "REACT_RENDER_ERROR" });
    d.classifyError(new Error("fetch failed"), "DATABASE_SYNC_ERROR", "account_sync");
    d.classifyError(new Error("Invalid login credentials for a@b.co"), "AUTHENTICATION_ERROR", "account_sync", { code: "AUTH_FAILED" });
    d.classifyError(new Error("Worker error: terminated"), "WORKER_ERROR", "python_workspace", { code: "PY_WORKER_CRASH" });
    const all = d.getDiagnosticEvents();
    expect(all.map((e) => e.category).sort()).toEqual(["APPLICATION_ERROR", "AUTHENTICATION_ERROR", "DATABASE_SYNC_ERROR", "WORKER_ERROR"]);
    expect(JSON.stringify(all)).not.toContain("a@b.co");
  });
});
