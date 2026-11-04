import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Key,
  Link2,
  Loader2,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../services/api";
import { useProject } from "../contexts/ProjectContext";
import { useToast } from "../components/Toast";
import { ErDiagram } from "../components/ErDiagram";
import type { ProjectCreateResult, ProjectTableInfo } from "../types";

const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xls,.json,.sql";

function TableCard({ table }: { table: ProjectTableInfo }) {
  const imported = table.imported_rows ?? table.row_count;
  const mismatch = table.row_count_matches === false;
  return (
    <div className="panel rounded-lg p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-medium text-ink">
            <Table2 className="h-4 w-4 text-accent" />
            {table.table_name}
          </h3>
          {table.source_file && (
            <p className="mt-0.5 text-[11px] text-ink-faint">from {table.source_file}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs ${
            mismatch ? "bg-amber-900/30 text-amber-400" : "bg-surface-overlay text-ink-muted"
          }`}
        >
          {imported} rows
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-ink-faint">
            <tr>
              <th className="pb-1 pr-3 font-medium">Column</th>
              <th className="pb-1 pr-3 font-medium">Type</th>
              <th className="pb-1 pr-3 font-medium">Null</th>
              <th className="pb-1 font-medium">Inferred from</th>
            </tr>
          </thead>
          <tbody className="text-ink-muted">
            {table.columns.map((col) => {
              const isPk = table.primary_key.includes(col.name);
              const fk = table.foreign_keys.find((f) => f.column === col.name);
              return (
                <tr key={col.name} className="border-t border-surface-border">
                  <td className="py-1 pr-3">
                    <span className="text-ink">{col.name}</span>
                    {isPk && (
                      <span title="Primary key">
                        <Key className="ml-1 inline h-3 w-3 text-accent" />
                      </span>
                    )}
                    {fk && (
                      <span
                        title={`References ${fk.references_table}.${fk.references_column} — ${fk.reason}`}
                      >
                        <Link2 className="ml-1 inline h-3 w-3 text-sky-400" />
                      </span>
                    )}
                    {col.original_name !== col.name && (
                      <span className="ml-1 text-ink-faint">({col.original_name})</span>
                    )}
                  </td>
                  <td className="py-1 pr-3 font-mono">{col.pg_type}</td>
                  <td className="py-1 pr-3">{col.nullable ? "yes" : "no"}</td>
                  <td className="py-1 text-ink-faint">{col.inferred_from}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {table.foreign_keys.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-surface-border pt-2 text-[11px] text-ink-muted">
          {table.foreign_keys.map((fk) => (
            <p key={fk.column}>
              <span className="text-sky-400">{fk.column}</span> →{" "}
              {fk.references_table}.{fk.references_column}{" "}
              <span className="text-ink-faint">({fk.reason})</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { projects, activeProjectId, setActiveProjectId, isLoading } = useProject();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ProjectCreateResult | null>(null);
  const [inspectId, setInspectId] = useState<number | null>(null);

  const detail = useQuery({
    queryKey: ["project", inspectId],
    queryFn: () => api.getProject(inspectId!),
    enabled: inspectId != null,
  });

  const create = useMutation({
    mutationFn: () => api.createProject(name.trim(), description.trim(), files),
    onSuccess: (data) => {
      setResult(data);
      toast.push(data.message, data.warnings.length ? "info" : "success");
      setName("");
      setDescription("");
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["projects"] });
      setActiveProjectId(data.project.id);
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteProject(id),
    onSuccess: (data) => {
      toast.push(data.message, "success");
      setInspectId(null);
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const canCreate = name.trim().length >= 2 && files.length > 0 && !create.isPending;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl animate-fade-in px-4 py-8">
      <div className="mb-6">
        <h1 className="page-title">SQL Projects</h1>
        <p className="page-subtitle">
          Upload a dataset and it gets its own PostgreSQL database with inferred types,
          primary keys and relationships. Practice against it in the editor.
        </p>
      </div>

      <section className="panel mb-6 rounded-lg p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <Upload className="h-4 w-4" />
          Create New SQL Project
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="section-label mb-0">Project name</span>
            <input
              className="field-input mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sales Analytics"
            />
          </label>
          <label className="block">
            <span className="section-label mb-0">Description</span>
            <input
              className="field-input mt-1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Orders, customers and products"
            />
          </label>
        </div>

        <div className="mt-3">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-overlay file:px-3 file:py-2 file:text-sm file:text-ink hover:file:bg-surface-border"
          />
          <p className="mt-1 text-[11px] text-ink-faint">
            CSV, TSV, XLSX, JSON or a .sql dump. Multiple files become multiple related
            tables.
          </p>
        </div>

        {files.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-ink-muted">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-2">
                <FileSpreadsheet className="h-3.5 w-3.5 text-accent" />
                {f.name}
                <span className="text-ink-faint">
                  ({(f.size / 1024).toFixed(0)} KB)
                </span>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="btn-primary mt-4"
          disabled={!canCreate}
          onClick={() => create.mutate()}
        >
          {create.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Database className="h-3.5 w-3.5" />
          )}
          {create.isPending ? "Provisioning database…" : "Create Project"}
        </button>
      </section>

      {result && (
        <section className="panel mb-6 rounded-lg p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
            <CheckCircle2 className="h-4 w-4 text-accent" />
            {result.project.name}
          </h2>
          <p className="mb-3 text-sm text-ink-muted">{result.message}</p>

          {result.warnings.length > 0 && (
            <div className="mb-3 rounded border border-amber-900/50 bg-amber-900/20 p-3">
              <p className="mb-1 flex items-center gap-2 text-xs font-medium text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Warnings
              </p>
              <ul className="space-y-0.5 text-xs text-amber-200/80">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-4 grid gap-3 md:grid-cols-2">
            {result.tables.map((t) => (
              <TableCard key={t.table_name} table={t} />
            ))}
          </div>

          {result.er_diagram && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Schema Diagram</h3>
              <div className="panel rounded-lg p-4">
                <ErDiagram source={result.er_diagram} />
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">Your Projects</h2>
        {isLoading ? (
          <p className="text-sm text-ink-faint">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-ink-faint">
            No projects yet. Northwind is used by default until you create one.
          </p>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`panel flex items-center justify-between gap-3 rounded-lg p-3 ${
                  p.id === activeProjectId ? "border-accent" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {p.name}
                    {p.id === activeProjectId && (
                      <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                        Active
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-faint">
                    {p.table_count} tables · {p.row_count} rows · {p.database_name}
                    {p.status !== "ready" && ` · ${p.status}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      setActiveProjectId(p.id === activeProjectId ? null : p.id)
                    }
                  >
                    {p.id === activeProjectId ? "Deactivate" : "Use"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setInspectId(inspectId === p.id ? null : p.id)}
                  >
                    {inspectId === p.id ? "Hide" : "Inspect"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-rose-400"
                    title="Delete the project and drop its database"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete "${p.name}" and permanently drop database ${p.database_name}?`,
                        )
                      ) {
                        remove.mutate(p.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {inspectId != null && detail.data && (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {detail.data.tables.map((t) => (
                <TableCard key={t.table_name} table={t} />
              ))}
            </div>
            {detail.data.er_diagram && (
              <div className="panel rounded-lg p-4">
                <h3 className="mb-2 text-sm font-semibold text-ink">Schema Diagram</h3>
                <ErDiagram source={detail.data.er_diagram} />
              </div>
            )}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
