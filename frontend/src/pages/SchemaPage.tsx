import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { useProject } from "../contexts/ProjectContext";

export function SchemaPage() {
  const { activeProjectId, activeProject } = useProject();
  const { data, isLoading, error } = useQuery({
    queryKey: ["schema-all", activeProjectId],
    queryFn: () => api.getSchema(undefined, activeProjectId),
  });

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 font-display text-2xl font-semibold">Database Schema</h1>
      <p className="mb-6 text-sm text-ink-muted">
        {activeProject
          ? `Tables in "${activeProject.name}" (${activeProject.database_name}), available read-only.`
          : "Northwind practice tables available to your queries (read-only)."}
      </p>

      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-surface-overlay" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-danger">
          Could not load schema. Ensure PostgreSQL is running and reachable.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.tables.map((t) => (
          <div key={t.table_name} className="panel rounded-lg p-4">
            <h2 className="mb-3 font-mono text-sm font-semibold text-accent">
              {t.table_name}
            </h2>
            <ul className="space-y-1 font-mono text-xs text-ink-muted">
              {t.columns.map((c, i) => (
                <li key={c.name}>
                  {i === t.columns.length - 1 ? "└──" : "├──"} {c.name}
                  <span className="text-ink-faint"> : {c.data_type}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
