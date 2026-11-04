import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Database, Github, Menu, Search, Shield, UserRound, X } from "lucide-react";
import { SearchDialog } from "./SearchDialog";
import { ThemeToggle } from "../../components/ThemeToggle";
import { SITE_NAME } from "../lib/seo";
import { Container } from "./ui";
import { useAuth } from "../lib/auth";

const NAV = [
  { to: "/learn", label: "Learn" },
  { to: "/notes", label: "Notes" },
  { to: "/patterns", label: "Patterns" },
  { to: "/mindmaps", label: "Mind maps" },
  { to: "/questions", label: "Practice" },
  { to: "/interview", label: "Interview" },
  { to: "/progress", label: "Progress" },
];

const MORE = [
  { to: "/ai-tutor", label: "SQL tutor" },
  { to: "/query-visualizer", label: "Query visualizer" },
  { to: "/solution-comparison", label: "Compare solutions" },
  { to: "/readiness", label: "Interview readiness" },
  { to: "/mock-interview", label: "Mock interview" },
  { to: "/review", label: "Revision queue" },
  { to: "/flashcards", label: "Flashcards" },
  { to: "/shortcuts", label: "Shortcuts" },
  { to: "/concepts", label: "Concept guides" },
  { to: "/playground", label: "Playground" },
  { to: "/schema", label: "Schema" },
  { to: "/challenge", label: "Weekly challenge" },
];

const REPO_URL = "https://github.com/Subramanya12244/northwind-sql-practice";

export function SiteLayout({ children, loading, error }: { children: ReactNode; loading: boolean; error: string | null }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);
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
  const searchButton = (
    <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search (Ctrl+K)"
      className="inline-flex items-center gap-2 rounded-lg border border-surface-border px-2.5 py-1.5 text-sm text-ink-faint hover:text-ink">
      <Search className="h-4 w-4" aria-hidden /> <span className="hidden 2xl:inline">Search</span>
      <kbd className="hidden rounded border border-surface-border px-1 font-mono text-[10px] 2xl:inline">⌘K</kbd>
    </button>
  );
  const { enabled, session, profile } = useAuth();
  const navigate = useNavigate();
  // A seeded account must pick its own password before using the site.
  useEffect(() => {
    if (profile?.must_change_password && location.pathname !== "/account") navigate("/account", { replace: true });
  }, [profile, location.pathname, navigate]);

  const account = !enabled ? null : session ? (
    <span className="flex items-center gap-1">
      {profile?.role === "admin" && (
        <NavLink to="/admin" className="rounded-lg p-2 text-ink-muted hover:bg-hover/5 hover:text-ink" aria-label="Admin" title="Admin">
          <Shield className="h-4 w-4" />
        </NavLink>
      )}
      <NavLink to="/account" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-hover/5 hover:text-ink">
        <UserRound className="h-4 w-4" aria-hidden /> {profile?.username ?? "Account"}
      </NavLink>
    </span>
  ) : (
    <Link to="/login" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white">Sign in</Link>
  );

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-fast ${
      isActive ? "bg-accent-dim text-accent" : "text-ink-muted hover:bg-hover/5 hover:text-ink"
    }`;

  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-surface-border bg-surface/85 backdrop-blur">
        <Container className="flex h-14 items-center gap-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap font-display text-base font-bold text-ink">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
              <Database className="h-4 w-4" aria-hidden />
            </span>
            {SITE_NAME}
          </Link>
          <nav className="ml-4 hidden items-center gap-1 whitespace-nowrap xl:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={linkClass}>
                {n.label}
              </NavLink>
            ))}
            <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMoreOpen(false)}>
              <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} aria-haspopup="true"
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-hover/5 hover:text-ink">
                More <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
              {moreOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-card border border-surface-border bg-surface-raised p-1 shadow-panel">
                  {MORE.map((n) => (
                    <NavLink key={n.to} to={n.to} className="block rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-hover/5 hover:text-ink">{n.label}</NavLink>
                  ))}
                </div>
              )}
            </div>
          </nav>
          <div className="ml-auto hidden items-center gap-2 xl:flex">
            {searchButton}
            {account}
            <ThemeToggle compact />
          </div>
          <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search" className="ml-auto rounded-lg p-2 text-ink-muted hover:bg-hover/5 xl:hidden">
            <Search className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-ink-muted hover:bg-hover/5 xl:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </Container>
        {open && (
          <nav className="border-t border-surface-border xl:hidden" aria-label="Mobile">
            <Container className="flex flex-col gap-1 py-3">
              <div className="pb-1">{searchButton}</div>
              {[...NAV, ...MORE].map((n) => (
                <NavLink key={n.to} to={n.to} className={linkClass}>
                  {n.label}
                </NavLink>
              ))}
              <div className="flex items-center gap-2 pt-2">
                {account}
                <ThemeToggle />
              </div>
            </Container>
          </nav>
        )}
        <div className={`h-0.5 bg-accent transition-opacity duration-base ${loading ? "animate-pulse opacity-100" : "opacity-0"}`} aria-hidden />
      </header>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <main id="main" className="flex-1">
        {error && (
          <Container className="pt-6">
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger-dim px-4 py-3 text-sm text-danger">
              Could not load this page: {error}. Check your connection and try again.
            </p>
          </Container>
        )}
        {children}
      </main>

      <footer className="mt-16 border-t border-surface-border py-10 text-sm text-ink-muted">
        <Container className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-ink">{SITE_NAME}</p>
            <p className="mt-2 max-w-xs">
              Free SQL interview practice on the Northwind database. Queries run in your browser — sign-up optional.
            </p>
          </div>
          <div>
            <p className="font-semibold text-ink">Learn</p>
            <ul className="mt-2 space-y-1.5">
              <li><Link className="hover:text-ink" to="/learn">Learn SQL (free course)</Link></li>
              <li><Link className="hover:text-ink" to="/notes">SQL theory notes</Link></li>
              <li><Link className="hover:text-ink" to="/patterns">SQL patterns</Link></li>
              <li><Link className="hover:text-ink" to="/mindmaps">SQL mind maps</Link></li>
              <li><Link className="hover:text-ink" to="/shortcuts">SQL shortcuts</Link></li>
              <li><Link className="hover:text-ink" to="/query-visualizer">SQL query visualizer</Link></li>
              <li><Link className="hover:text-ink" to="/solution-comparison">Compare SQL solutions</Link></li>
              <li><Link className="hover:text-ink" to="/questions">All practice questions</Link></li>
              <li><Link className="hover:text-ink" to="/interview">SQL interview sets by role</Link></li>
              <li><Link className="hover:text-ink" to="/mock-interview">SQL mock interview</Link></li>
              <li><Link className="hover:text-ink" to="/review">Review queue</Link></li>
              <li><Link className="hover:text-ink" to="/challenge">Weekly SQL challenge</Link></li>
              <li><Link className="hover:text-ink" to="/leaderboard">Leaderboard</Link></li>
              <li><Link className="hover:text-ink" to="/concepts">SQL concept guides</Link></li>
              <li><Link className="hover:text-ink" to="/cheatsheet">SQL cheat sheet</Link></li>
              <li><Link className="hover:text-ink" to="/flashcards">Flashcards</Link></li>
              <li><Link className="hover:text-ink" to="/playground">Online SQL playground</Link></li>
              <li><Link className="hover:text-ink" to="/schema">Northwind schema</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-ink">Source</p>
            <a className="mt-2 inline-flex items-center gap-1.5 hover:text-ink" href={REPO_URL} rel="noopener">
              <Github className="h-4 w-4" aria-hidden /> Questions on GitHub
            </a>
          </div>
        </Container>
      </footer>
    </div>
  );
}
