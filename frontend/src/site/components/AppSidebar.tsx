import { useEffect, useState, type ComponentType } from "react";
import { NavLink } from "react-router-dom";
import { BookOpen, Briefcase, ChevronDown, Code2, FolderKanban, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Sparkles, Users } from "lucide-react";
import { NAV_GROUPS, activeGroup } from "../lib/navigation";

const GROUP_ICON: Record<string, ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  learn: BookOpen,
  practice: Code2,
  projects: FolderKanban,
  ai: Sparkles,
  career: Briefcase,
  community: Users,
};

const COLLAPSE_KEY = "df.sidebar.collapsed";

/**
 * Desktop (lg+) left navigation. Groups are disclosure sections; the group that holds the
 * current page starts open. That is derived from the URL only, so the prerendered HTML and
 * the first client render match. The collapsed (icon-only) preference is read after hydration.
 */
export function AppSidebar({ pathname }: { pathname: string }) {
  const current = activeGroup(pathname);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(current ? [current] : []));
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* storage unavailable */ }
  }, []);
  // Navigating into another group opens it (without closing ones the user opened).
  useEffect(() => {
    if (current) setOpenGroups((s) => (s.has(current) ? s : new Set(s).add(current)));
  }, [current]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1"); } catch { /* storage unavailable */ }
      return !v;
    });
  };
  const toggleGroup = (id: string) =>
    setOpenGroups((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <aside
      className={`sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 flex-col border-r border-surface-border bg-surface-raised/40 transition-[width] duration-base ease-out lg:flex ${collapsed ? "w-16" : "w-60"}`}
      aria-label="Sidebar"
    >
      <nav aria-label="Main" className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
        <ul className="space-y-0.5">
          {NAV_GROUPS.map((g) => {
            const Icon = GROUP_ICON[g.id] ?? LayoutDashboard;
            const isActive = current === g.id;
            const isOpen = openGroups.has(g.id) && !collapsed;
            const listId = `nav-${g.id}`;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  data-nav-group={g.id}
                  data-active={isActive ? "true" : "false"}
                  aria-expanded={isOpen}
                  aria-controls={listId}
                  title={collapsed ? g.label : undefined}
                  onClick={() => (collapsed ? (toggleCollapsed(), setOpenGroups((s) => new Set(s).add(g.id))) : toggleGroup(g.id))}
                  className={`group flex min-h-[40px] w-full items-center gap-2.5 rounded-control px-2.5 text-sm font-medium transition-all duration-fast active:scale-[0.98] ${isActive ? "bg-accent-dim text-accent" : "text-ink-muted hover:bg-hover/5 hover:text-ink"} ${collapsed ? "justify-center" : ""}`}
                >
                  <Icon className="h-4 w-4 shrink-0 transition-transform duration-fast ease-out group-hover:scale-110" />
                  <span className={collapsed ? "sr-only" : "flex-1 truncate text-left"}>{g.label}</span>
                  {!collapsed && <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-fast ease-out ${isOpen ? "rotate-180" : ""}`} aria-hidden />}
                </button>
                <div className="collapse-grid" data-open={isOpen ? "true" : "false"}>
                <ul id={listId} hidden={!isOpen && collapsed} {...(isOpen ? {} : { inert: "" })} aria-hidden={!isOpen} className="mb-1 ml-[1.15rem] mt-0.5 space-y-0.5 border-l border-surface-border pl-2">
                  {g.items!.map((n) => (
                    <li key={n.to}>
                      <NavLink
                        to={n.to}
                        end
                        className={({ isActive: here }) =>
                          `relative block rounded-control px-2.5 py-1.5 text-sm transition-all duration-fast ${here ? "bg-accent-dim/60 font-semibold text-accent" : "text-ink-muted hover:bg-hover/5 hover:text-ink hover:translate-x-0.5"}`
                        }
                      >
                        {({ isActive: here }) => (
                          <>
                            {here && <span className="absolute -left-[9px] top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" aria-hidden />}
                            <span className="truncate">{n.label}</span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-surface-border p-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex min-h-[40px] w-full items-center gap-2.5 rounded-control px-2.5 text-sm text-ink-faint transition-colors duration-fast hover:bg-hover/5 hover:text-ink ${collapsed ? "justify-center" : ""}`}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
