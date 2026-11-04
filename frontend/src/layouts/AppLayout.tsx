import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  BookOpen,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Database,
  FolderTree,
  Github,
  GitBranch,
  LayoutDashboard,
  Lightbulb,
  Menu,
  Plus,
  RefreshCw,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import { api } from "../services/api";
import { useToast } from "../components/Toast";
import { ThemeToggle } from "../components/ThemeToggle";
import { useProject } from "../contexts/ProjectContext";

const primaryNav = [
  { to: "/", label: "SQL Practice", icon: Terminal, end: true },
  { to: "/git", label: "Git Lab", icon: GitBranch, end: false },
  { to: "/questions", label: "Questions", icon: BookOpen, end: true },
  { to: "/progress", label: "Progress", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderTree },
];

const secondaryNav = [
  { to: "/questions/new", label: "Add question", icon: Plus },
  { to: "/git/import", label: "Import Git MD", icon: Upload },
  { to: "/mistakes", label: "Mistakes", icon: Lightbulb },
  { to: "/concepts", label: "Concepts", icon: BrainCircuit },
  { to: "/schema", label: "Schema", icon: Database },
  { to: "/import/chatgpt", label: "Import ChatGPT", icon: Upload },
];

export function AppLayout() {
  const toast = useToast();
  const qc = useQueryClient();
  const location = useLocation();
  const { projects, activeProjectId, setActiveProjectId } = useProject();
  const progress = useQuery({ queryKey: ["progress"], queryFn: api.getProgress });
  const [syncReport, setSyncReport] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const sync = useMutation({
    mutationFn: api.syncGithub,
    onSuccess: (data) => {
      toast.push(data.message, data.success ? "success" : "error");
      setSyncReport(
        [
          `Source: ${data.source}`,
          `New: ${data.new} · Modified: ${data.modified} · Unchanged: ${data.unchanged} · Missing from repo: ${data.deleted}`,
          data.new_categories?.length
            ? `New categories: ${data.new_categories.join(", ")}`
            : null,
          data.difficulty_changes?.length
            ? `Difficulty changes: ${data.difficulty_changes.length}`
            : null,
          data.incomplete_files?.length
            ? `Incomplete (missing md/sql): ${data.incomplete_files.length}`
            : null,
          data.next_question_number != null
            ? `Next available question: Q${data.next_question_number}`
            : null,
          data.auto_solved
            ? `${data.auto_solved} documented questions marked SOLVED.`
            : "Documented questions were already marked SOLVED.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      void qc.invalidateQueries({ queryKey: ["questions"] });
      void qc.invalidateQueries({ queryKey: ["progress"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const solved = progress.data?.solved ?? 0;
  const total = progress.data?.total_questions ?? 0;
  const pct = total > 0 ? Math.round((solved / total) * 100) : 0;

  const NavItems = ({ compact = false }: { compact?: boolean }) => (
    <>
      <div className="space-y-0.5">
        {!compact && <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">Workspace</p>}
        {primaryNav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={label}
            className={({ isActive }) =>
              `nav-link ${isActive ? "nav-link-active" : "nav-link-idle"} ${compact ? "justify-center px-2" : ""}`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!compact && <span>{label}</span>}
          </NavLink>
        ))}
      </div>

      <div className="mt-6 space-y-0.5">
        {!compact && <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">Tools</p>}
        {secondaryNav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              `nav-link ${isActive ? "nav-link-active" : "nav-link-idle"} ${compact ? "justify-center px-2" : ""}`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!compact && <span>{label}</span>}
          </NavLink>
        ))}
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={`relative z-30 hidden shrink-0 flex-col border-r border-surface-border bg-surface-raised/80 backdrop-blur-md lg:flex ${
          collapsed ? "w-[68px]" : "w-[240px]"
        } transition-all duration-base`}
      >
        <div className={`flex h-14 items-center border-b border-surface-border ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-glow"
              style={{ background: "linear-gradient(135deg, #8b7cf8, #6366f1)" }}
            >
              DF
            </span>
            {!collapsed && (
              <span className="truncate font-display text-[15px] font-semibold tracking-tight text-ink">
                DataForge
              </span>
            )}
          </NavLink>
          {!collapsed && (
            <button
              type="button"
              className="btn-ghost px-1.5 py-1.5"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className={`flex-1 overflow-y-auto py-4 ${collapsed ? "px-2" : "px-3"}`}>
          {collapsed && (
            <button
              type="button"
              className="nav-link nav-link-idle mb-4 w-full justify-center px-2"
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          <NavItems compact={collapsed} />
        </nav>

        <div className={`border-t border-surface-border p-3 ${collapsed ? "px-2" : ""}`}>
          {progress.data && !collapsed && (
            <div className="mb-3 rounded-card border border-surface-border bg-surface-overlay/50 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-ink-faint">Progress</span>
                <span className="font-medium text-ink">
                  {solved}/{total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-hover/10">
                <div
                  className="h-full rounded-full transition-all duration-base"
                  style={{
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, #8b7cf8, #6366f1)",
                  }}
                />
              </div>
              <p className="mt-2 text-[11px] text-ink-faint">{progress.data.current_level}</p>
            </div>
          )}
          <button
            type="button"
            className={`btn-secondary w-full ${collapsed ? "px-2" : ""}`}
            title="Sync question docs from GitHub"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Github className="h-3.5 w-3.5" />
            )}
            {!collapsed && <span>Sync GitHub</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-surface-border bg-surface/80 px-4 backdrop-blur-md sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="btn-ghost px-2 lg:hidden"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-medium text-ink">Interview practice</p>
              <p className="truncate text-[11px] text-ink-faint">Write · run · inspect · submit</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <ThemeToggle compact />

            <label className="flex items-center gap-2 text-[11px] text-ink-faint">
              <span className="hidden sm:inline">Database</span>
              <select
                className="field-input max-w-[160px] py-1.5 text-xs"
                title="Which database the SQL editor runs against"
                value={activeProjectId ?? ""}
                onChange={(e) =>
                  setActiveProjectId(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Northwind</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            {progress.data && (
              <div className="hidden items-center gap-2 rounded-full border border-surface-border bg-surface-overlay/70 px-3 py-1.5 text-xs text-ink-muted md:flex">
                <span className="font-semibold text-accent">{solved}</span>
                <span className="text-ink-faint">/ {total}</span>
              </div>
            )}
          </div>
        </header>

        {mobileOpen && (
          <div className="animate-fade-in border-b border-surface-border bg-surface-raised px-3 py-3 lg:hidden">
            <nav className="grid gap-0.5">
              <NavItems />
            </nav>
            <button
              type="button"
              className="btn-secondary mt-3 w-full"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
            >
              {sync.isPending ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Github className="h-3.5 w-3.5" />
              )}
              Sync GitHub
            </button>
          </div>
        )}

        {syncReport && (
          <div className="animate-fade-in border-b border-surface-border bg-surface-overlay/60 px-4 py-3 text-xs text-ink-muted">
            <div className="mx-auto flex max-w-5xl items-start justify-between gap-4">
              <pre className="whitespace-pre-line font-sans leading-relaxed">{syncReport}</pre>
              <button type="button" className="btn-ghost shrink-0 px-2" onClick={() => setSyncReport(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
