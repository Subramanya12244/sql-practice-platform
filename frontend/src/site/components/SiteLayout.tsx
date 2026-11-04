import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Database, Github, Menu, X } from "lucide-react";
import { ThemeToggle } from "../../components/ThemeToggle";
import { SITE_NAME } from "../lib/seo";
import { Container } from "./ui";

const NAV = [
  { to: "/questions", label: "Practice" },
  { to: "/concepts", label: "Concepts" },
  { to: "/flashcards", label: "Flashcards" },
  { to: "/cheatsheet", label: "Cheat sheet" },
  { to: "/progress", label: "Progress" },
];

const REPO_URL = "https://github.com/Subramanya12244/northwind-sql-practice";

export function SiteLayout({ children, loading, error }: { children: ReactNode; loading: boolean; error: string | null }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

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
          <Link to="/" className="flex items-center gap-2 font-display text-base font-bold text-ink">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
              <Database className="h-4 w-4" aria-hidden />
            </span>
            {SITE_NAME}
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={linkClass}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden md:block">
            <ThemeToggle compact />
          </div>
          <button
            type="button"
            className="ml-auto rounded-lg p-2 text-ink-muted hover:bg-hover/5 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </Container>
        {open && (
          <nav className="border-t border-surface-border md:hidden" aria-label="Mobile">
            <Container className="flex flex-col gap-1 py-3">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={linkClass}>
                  {n.label}
                </NavLink>
              ))}
              <div className="pt-2">
                <ThemeToggle />
              </div>
            </Container>
          </nav>
        )}
        <div className={`h-0.5 bg-accent transition-opacity duration-base ${loading ? "animate-pulse opacity-100" : "opacity-0"}`} aria-hidden />
      </header>

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
              Free SQL interview practice on the Northwind database. Queries run in your browser — no sign-up.
            </p>
          </div>
          <div>
            <p className="font-semibold text-ink">Learn</p>
            <ul className="mt-2 space-y-1.5">
              <li><Link className="hover:text-ink" to="/questions">All 88 questions</Link></li>
              <li><Link className="hover:text-ink" to="/concepts">SQL concept guides</Link></li>
              <li><Link className="hover:text-ink" to="/cheatsheet">SQL cheat sheet</Link></li>
              <li><Link className="hover:text-ink" to="/flashcards">Flashcards</Link></li>
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
