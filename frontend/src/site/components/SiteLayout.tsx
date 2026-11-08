import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, Github, LogOut, Menu, Moon, Search, Settings, Shield, Sun, UserRound, X } from "lucide-react";
import { BrandMark } from "../../components/BrandMark";
import { BRAND } from "../../brand";
import { NAV_GROUPS, activeGroup } from "../lib/navigation";
import { AppSidebar } from "./AppSidebar";
import { prefersReducedMotion } from "./Motion";
import { SearchDialog } from "./SearchDialog";
import { useTheme } from "../../contexts/ThemeContext";
import { SITE_NAME } from "../lib/seo";
import { useMyReviews } from "../lib/reviews";
import { Container } from "./ui";
import { useAuth } from "../lib/auth";

/** Focused pages without the sidebar. */
const AUTH_PATHS = ["/login", "/signup", "/reset-password"];

const REPO_URL = "https://github.com/Subramanya12244/northwind-sql-practice";

/** Close a popover on outside click or Escape, returning focus to its trigger. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      ref.current?.querySelector<HTMLElement>("button")?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

/**
 * Light/dark switch. The prerendered HTML can't know the visitor's theme, so both icons are
 * rendered and CSS (`dark:`) picks one; markup is identical on server and client.
 */
function ThemeButton() {
  const { resolved, setPreference } = useTheme();
  const toggle = () => {
    const root = document.documentElement;
    if (!prefersReducedMotion()) {
      root.classList.add("theme-transition");
      window.setTimeout(() => root.classList.remove("theme-transition"), 260);
    }
    setPreference(resolved === "dark" ? "light" : "dark");
  };
  return (
    <button type="button" onClick={toggle} aria-label="Toggle light or dark theme" title="Toggle theme"
      className="rounded-lg p-2 text-ink-muted transition-colors duration-fast hover:bg-hover/5 hover:text-ink">
      <Sun className="hidden h-4 w-4 dark:block" aria-hidden />
      <Moon className="h-4 w-4 dark:hidden" aria-hidden />
    </button>
  );
}

function AccountMenu({ unseen }: { unseen: number }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useDismiss(open, () => setOpen(false), ref);
  const name = profile?.username ?? "Account";
  const item = "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink hover:bg-hover/5";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true" aria-label={`Account menu for ${name}`}
        className="inline-flex items-center gap-2 rounded-full border border-surface-border py-1 pl-1 pr-2.5 text-sm font-medium text-ink hover:border-accent/40">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent to-secondary text-xs font-bold text-on-accent" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-[8rem] truncate sm:inline">{name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right animate-scale-in rounded-card border border-surface-border bg-surface-raised p-1.5 shadow-soft">
          <p className="truncate px-3 py-2 text-xs text-ink-faint">Signed in as <span className="font-semibold text-ink">{name}</span></p>
          <Link role="menuitem" to="/account" className={item}><UserRound className="h-4 w-4 text-ink-faint" aria-hidden /> Account{unseen > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-bold text-on-accent">{unseen}</span>}</Link>
          <Link role="menuitem" to="/progress" className={item}>Progress</Link>
          <Link role="menuitem" to="/portfolio" className={item}>Portfolio</Link>
          {profile?.role === "admin" && <Link role="menuitem" to="/admin" className={item}><Shield className="h-4 w-4 text-ink-faint" aria-hidden /> Admin</Link>}
          <Link role="menuitem" to="/settings" className={item}><Settings className="h-4 w-4 text-ink-faint" aria-hidden /> Settings</Link>
          <div className="my-1 h-px bg-surface-border" />
          <button role="menuitem" type="button" className={`${item} w-full`} onClick={() => void signOut().then(() => navigate("/"))}><LogOut className="h-4 w-4 text-ink-faint" aria-hidden /> Sign out</button>
        </div>
      )}
    </div>
  );
}

export function SiteLayout({ children, loading, error }: { children: ReactNode; loading: boolean; error: string | null }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);
  const current = activeGroup(location.pathname);
  const showSidebar = !AUTH_PATHS.includes(location.pathname);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).isContentEditable) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Soft page transition on navigation. Animates the existing <main> with WAAPI instead of
  // remounting it, so page state and data loading are untouched. Skipped on first paint.
  const mainRef = useRef<HTMLElement>(null);
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    const el = mainRef.current;
    if (!el || prefersReducedMotion() || typeof el.animate !== "function") return;
    el.animate([{ opacity: 0.4, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [location.pathname]);
  const { enabled, session, profile } = useAuth();
  const { unseen } = useMyReviews(session?.user.id);
  const navigate = useNavigate();
  // A seeded account must pick its own password before using the site.
  useEffect(() => {
    if (profile?.must_change_password && location.pathname !== "/account") navigate("/account", { replace: true });
  }, [profile, location.pathname, navigate]);

  const searchButton = (
    <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search (Ctrl+K)"
      className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-surface-border bg-surface-overlay/60 px-2.5 text-sm text-ink-faint transition-colors duration-fast hover:border-accent/40 hover:text-ink">
      <Search className="h-4 w-4" aria-hidden /> <span className="hidden 2xl:inline">Search</span>
      <kbd className="hidden rounded border border-surface-border px-1 font-mono text-[10px] 2xl:inline">⌘K</kbd>
    </button>
  );
  const bell = enabled && session ? (
    <Link to="/account#acc-reviews" aria-label={unseen ? `${unseen} new project review${unseen > 1 ? "s" : ""}` : "Notifications: no new reviews"} title="Project reviews"
      className="relative rounded-lg p-2 text-ink-muted transition-colors duration-fast hover:bg-hover/5 hover:text-ink">
      <Bell className="h-4 w-4" aria-hidden />
      {unseen > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent" aria-hidden>{unseen}</span>}
    </Link>
  ) : null;
  const account = !enabled ? null : session ? <AccountMenu unseen={unseen} /> : (
    <Link to={["/", "/login", "/signup", "/reset-password"].includes(location.pathname) ? "/login" : `/login?next=${encodeURIComponent(location.pathname)}`}
      className="inline-flex min-h-[36px] items-center rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent hover:brightness-110">Sign in</Link>
  );

  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-surface-border bg-surface/80 backdrop-blur-md">
        <Container wide className="flex h-16 items-center gap-3">
          <Link to="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap font-display text-base font-bold tracking-tight text-ink">
            <BrandMark tone="site" size={30} />
            {SITE_NAME}
          </Link>
          <div className="ml-auto hidden items-center gap-1.5 lg:flex">
            {searchButton}
            <ThemeButton />
            {bell}
            {account}
          </div>
          <div className="ml-auto flex items-center gap-1 lg:hidden">
            <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search" className="rounded-lg p-2.5 text-ink-muted hover:bg-hover/5">
              <Search className="h-5 w-5" />
            </button>
            {bell}
            <button type="button" className="rounded-lg p-2.5 text-ink-muted hover:bg-hover/5" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"}>
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </Container>
        {open && (
          <nav id="mobile-nav" className="animate-fade-in max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-surface-border lg:hidden" aria-label="Mobile">
            <Container className="flex flex-col gap-1 py-3">
              {NAV_GROUPS.map((g) => (
                <div key={g.id}>
                  <button type="button" onClick={() => setMobileGroup((v) => (v === g.id ? null : g.id))} aria-expanded={mobileGroup === g.id}
                    className={`flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 text-sm font-medium hover:bg-hover/5 ${current === g.id ? "text-accent" : "text-ink"}`}>
                    {g.label} <ChevronDown className={`h-4 w-4 transition-transform ${mobileGroup === g.id ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {mobileGroup === g.id && (
                    <div className="ml-3 flex flex-col border-l border-surface-border pl-2">
                      {g.items!.map((n) => <Link key={n.to} to={n.to} className="flex min-h-[40px] items-center rounded-lg px-3 text-sm text-ink-muted hover:text-ink">{n.label}</Link>)}
                    </div>
                  )}
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-surface-border pt-3">
                {account}
                <span className="flex items-center gap-1">
                  <NavLink to="/settings" aria-label="Settings" className="rounded-lg p-2.5 text-ink-muted hover:bg-hover/5"><Settings className="h-4 w-4" /></NavLink>
                  <ThemeButton />
                </span>
              </div>
            </Container>
          </nav>
        )}
        <div className={`h-0.5 bg-gradient-to-r from-accent via-accent-muted to-secondary transition-opacity duration-base ${loading ? "animate-pulse opacity-100" : "opacity-0"}`} aria-hidden />
      </header>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <div className="flex flex-1">
      {showSidebar && <AppSidebar pathname={location.pathname} />}
      <div className="flex min-w-0 flex-1 flex-col">
      <main id="main" ref={mainRef} className="flex-1">
        {error && (
          <Container className="pt-6">
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger-dim px-4 py-3 text-sm text-danger">
              Could not load this page: {error}. Check your connection and try again.
            </p>
          </Container>
        )}
        {children}
      </main>

      <footer className="mt-16 border-t border-surface-border bg-surface-raised/40 py-12 text-sm text-ink-muted">
        <Container className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <p className="flex items-center gap-2 font-display font-bold text-ink"><BrandMark tone="site" size={24} /> {SITE_NAME}</p>
            <p className="mt-3 max-w-sm">
              {BRAND.tagline} SQL, Python and data engineering practice with real PostgreSQL and Python in your browser. Sign-up is optional.
            </p>
            <a className="mt-4 inline-flex items-center gap-1.5 hover:text-ink" href={REPO_URL} rel="noopener">
              <Github className="h-4 w-4" aria-hidden /> Questions on GitHub
            </a>
          </div>
          {[
            { title: "Learn", links: [["/learn", "Learn SQL (free course)"], ["/notes", "SQL theory notes"], ["/data-engineering", "Data engineering tracks"], ["/patterns", "SQL patterns"], ["/mindmaps", "SQL mind maps"], ["/shortcuts", "SQL shortcuts"], ["/concepts", "SQL concept guides"], ["/cheatsheet", "SQL cheat sheet"], ["/flashcards", "Flashcards"], ["/study-notes", "Visual study notes"]] },
            { title: "Practice", links: [["/questions", "All practice questions"], ["/practice/python", "Python for data engineering"], ["/practice/python/assessment", "Timed Python assessment"], ["/scenarios", "Business SQL scenarios"], ["/interview", "SQL interview sets by role"], ["/mock-interview", "SQL mock interview"], ["/review", "Review queue"], ["/history", "History and revision"], ["/playground", "Online SQL playground"], ["/schema", "Northwind schema"]] },
            { title: "Build & grow", links: [["/projects-lab", "Projects lab"], ["/data-quality", "Data quality lab"], ["/data-generator", "SQL data generator"], ["/query-visualizer", "SQL query visualizer"], ["/solution-comparison", "Compare SQL solutions"], ["/career/planner", "Study planner"], ["/portfolio", "Portfolio"], ["/challenge", "Daily and weekly challenges"], ["/leaderboard", "Leaderboard"]] },
          ].map((col) => (
            <div key={col.title}>
              <p className="font-semibold text-ink">{col.title}</p>
              <ul className="mt-3 space-y-1.5">
                {col.links.map(([to, label]) => <li key={to}><Link className="hover:text-ink" to={to}>{label}</Link></li>)}
              </ul>
            </div>
          ))}
        </Container>
        <Container className="mt-10 border-t border-surface-border pt-6 text-xs text-ink-faint">
          © {SITE_NAME}. Free to use. Your practice runs in your browser.
        </Container>
      </footer>
      </div>
      </div>
    </div>
  );
}
