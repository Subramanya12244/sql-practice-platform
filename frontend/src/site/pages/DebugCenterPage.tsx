import { useState, useEffect } from "react";
import {
  Activity,
  Copy,
  Database,
  RefreshCw,
  Terminal,
  Trash2,
  Check,
} from "lucide-react";
import { Container, PageHeader, Card, Badge, Button } from "../components/ui";
import { Seo } from "../lib/seo";
import {
  getDiagnosticEvents,
  subscribeDiagnostics,
  clearDiagnosticEvents,
  generateDiagnosticReport,
  type DiagnosticEvent,
  type EngineHealth,
  type Severity,
} from "../lib/diagnostics";
import { runPython, resetPython } from "../lib/pyRunner";
import { getDb } from "../lib/browserDb";

export function DebugCenterPage() {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const [sqlHealth, setSqlHealth] = useState<EngineHealth>({
    status: "uninitialized",
    engine: "pglite",
    version: "0.5.10",
  });
  const [pythonHealth, setPythonHealth] = useState<EngineHealth>({
    status: "uninitialized",
    engine: "pyodide",
    version: "0.29.5 (Python 3.13)",
  });
  const [testingSql, setTestingSql] = useState(false);
  const [testingPython, setTestingPython] = useState(false);

  useEffect(() => {
    setEvents(getDiagnosticEvents());
    return subscribeDiagnostics(setEvents);
  }, []);

  const pingSql = async () => {
    setTestingSql(true);
    const start = performance.now();
    try {
      const handle = await getDb();
      await handle.db.exec("SELECT 1 AS ping");
      const elapsed = Math.round(performance.now() - start);
      setSqlHealth({
        status: "healthy",
        engine: "pglite",
        version: "0.5.10",
        lastPingMs: elapsed,
        message: `PGlite responded in ${elapsed}ms`,
      });
    } catch (err) {
      setSqlHealth({
        status: "error",
        engine: "pglite",
        version: "0.5.10",
        message: (err as Error).message,
      });
    } finally {
      setTestingSql(false);
    }
  };

  const pingPython = async () => {
    setTestingPython(true);
    const start = performance.now();
    try {
      const res = await runPython("import sys\nprint('ping', sys.version_info.major, sys.version_info.minor)");
      const elapsed = Math.round(performance.now() - start);
      if (res.ok) {
        setPythonHealth({
          status: "healthy",
          engine: "pyodide",
          version: "0.29.5 (Python 3.13)",
          lastPingMs: elapsed,
          message: `Pyodide responded in ${elapsed}ms: ${res.stdout.trim()}`,
        });
      } else {
        setPythonHealth({
          status: "error",
          engine: "pyodide",
          version: "0.29.5 (Python 3.13)",
          message: res.error ?? "Execution failed",
        });
      }
    } catch (err) {
      setPythonHealth({
        status: "error",
        engine: "pyodide",
        version: "0.29.5 (Python 3.13)",
        message: (err as Error).message,
      });
    } finally {
      setTestingPython(false);
    }
  };

  const copyReport = () => {
    const report = generateDiagnosticReport({ sqlHealth, pythonHealth });
    navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredEvents = events.filter((e) => {
    if (filterSeverity !== "all" && e.severity !== filterSeverity) return false;
    if (filterCategory !== "all" && e.category !== filterCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        e.code.toLowerCase().includes(q) ||
        e.userMessage.toLowerCase().includes(q) ||
        e.technicalMessage.toLowerCase().includes(q) ||
        e.feature.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getSeverityBadge = (sev: Severity) => {
    switch (sev) {
      case "fatal":
        return <Badge tone="danger">FATAL</Badge>;
      case "error":
        return <Badge tone="danger">ERROR</Badge>;
      case "warn":
        return <Badge tone="accent">WARN</Badge>;
      case "info":
      default:
        return <Badge tone="neutral">INFO</Badge>;
    }
  };

  return (
    <Container wide className="pt-6">
      <Seo
        title="Developer Diagnostics & Debug Center"
        description="Inspect client-side SQL and Python engine health, worker lifecycles, and error diagnostics."
        path="/debug"
        noindex
      />

      <PageHeader
        eyebrow="System Diagnostics"
        title="DataForge Debug Center"
        intro="Live health monitoring and error classification for browser WebAssembly runtimes (PGlite & Pyodide), execution queues, and account persistence."
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={pingSql} disabled={testingSql}>
            <Database className="mr-1.5 h-3.5 w-3.5 text-accent" />
            {testingSql ? "Testing PGlite..." : "Probe SQL Engine"}
          </Button>
          <Button variant="secondary" size="sm" onClick={pingPython} disabled={testingPython}>
            <Terminal className="mr-1.5 h-3.5 w-3.5 text-accent" />
            {testingPython ? "Testing Pyodide..." : "Probe Python Runtime"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              resetPython();
              setPythonHealth({
                status: "uninitialized",
                engine: "pyodide",
                version: "0.29.5 (Python 3.13)",
                message: "Worker terminated and reset.",
              });
            }}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-warn" />
            Restart Python Worker
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={copyReport}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? "Copied Report" : "Copy Diagnostic Report"}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearDiagnosticEvents} disabled={events.length === 0}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5 text-ink-muted" />
            Clear Log
          </Button>
        </div>
      </div>

      {/* Engine Health Grid */}
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Card pad="md" className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-accent" />
              <h3 className="font-semibold text-ink">PostgreSQL (PGlite Wasm)</h3>
            </div>
            {sqlHealth.status === "healthy" ? (
              <Badge tone="success">Operational</Badge>
            ) : sqlHealth.status === "error" ? (
              <Badge tone="danger">Error</Badge>
            ) : (
              <Badge tone="neutral">Idle / Unprobed</Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-ink-muted">
            <div>
              <span className="font-semibold text-ink">Version:</span> {sqlHealth.version}
            </div>
            <div>
              <span className="font-semibold text-ink">Latency:</span>{" "}
              {sqlHealth.lastPingMs ? `${sqlHealth.lastPingMs}ms` : "—"}
            </div>
          </div>
          {sqlHealth.message && (
            <p className="rounded bg-surface-overlay p-2 text-xs font-mono text-ink">{sqlHealth.message}</p>
          )}
        </Card>

        <Card pad="md" className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-accent" />
              <h3 className="font-semibold text-ink">Python 3.13 (Pyodide Worker)</h3>
            </div>
            {pythonHealth.status === "healthy" ? (
              <Badge tone="success">Operational</Badge>
            ) : pythonHealth.status === "error" ? (
              <Badge tone="danger">Error</Badge>
            ) : (
              <Badge tone="neutral">Idle / Unprobed</Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-ink-muted">
            <div>
              <span className="font-semibold text-ink">Version:</span> {pythonHealth.version}
            </div>
            <div>
              <span className="font-semibold text-ink">Latency:</span>{" "}
              {pythonHealth.lastPingMs ? `${pythonHealth.lastPingMs}ms` : "—"}
            </div>
          </div>
          {pythonHealth.message && (
            <p className="rounded bg-surface-overlay p-2 text-xs font-mono text-ink">{pythonHealth.message}</p>
          )}
        </Card>
      </div>

      {/* Diagnostics Event Log */}
      <Card pad="md">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-surface-border pb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-accent" />
            <h3 className="font-semibold text-ink">Recent Diagnostic Events ({filteredEvents.length})</h3>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="text"
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs text-ink outline-none focus:border-accent"
            />
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="rounded-md border border-surface-border bg-surface px-2 py-1 text-xs text-ink outline-none"
            >
              <option value="all">All Severities</option>
              <option value="fatal">Fatal</option>
              <option value="error">Error</option>
              <option value="warn">Warn</option>
              <option value="info">Info</option>
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-md border border-surface-border bg-surface px-2 py-1 text-xs text-ink outline-none"
            >
              <option value="all">All Categories</option>
              <option value="SQL_ENGINE_ERROR">SQL Engine</option>
              <option value="PYTHON_RUNTIME_ERROR">Python Runtime</option>
              <option value="PYTHON_EXECUTION_ERROR">Python Execution</option>
              <option value="PACKAGE_LOADING_ERROR">Package Loading</option>
              <option value="DATABASE_SYNC_ERROR">Database Sync</option>
              <option value="PROJECT_VALIDATION_ERROR">Project Validation</option>
            </select>
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="py-8 text-center text-xs text-ink-muted">
            No diagnostic events recorded. System running smoothly without captured runtime errors.
          </div>
        ) : (
          <div className="divide-y divide-surface-border overflow-x-auto text-xs">
            {filteredEvents.map((evt) => (
              <div key={evt.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    {getSeverityBadge(evt.severity)}
                    <span className="font-mono font-bold text-ink">{evt.code}</span>
                    <span className="text-ink-faint">· {evt.category}</span>
                    <span className="text-ink-faint">({evt.feature})</span>
                  </div>
                  <time className="font-mono text-[10px] text-ink-faint">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </time>
                </div>

                <div className="text-sm font-medium text-ink mb-1">{evt.userMessage}</div>

                <div className="rounded bg-surface-overlay/80 p-2 font-mono text-[11px] text-ink-muted">
                  {evt.technicalMessage}
                </div>

                {evt.suggestedAction && (
                  <div className="mt-1 text-[11px] text-accent">
                    <span className="font-semibold">Suggested Action:</span> {evt.suggestedAction}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </Container>
  );
}
