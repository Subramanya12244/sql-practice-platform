import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { HelpContext, type HelpApi, type OpenHelpOptions } from "./context";
import { loadRegistry } from "./registryLoader";
import { restartOnboarding, setOnboarding, setTourStatus, useHelpProgress } from "./progress";
import type { HelpSection } from "./types";

const HelpPanel = lazy(() => import("./HelpPanel"));
const GuidedTour = lazy(() => import("./GuidedTour"));
const Onboarding = lazy(() => import("./Onboarding"));

type Registry = typeof import("./registry");

/** Pages where a welcome card would be noise. */
const QUIET_PATHS = ["/login", "/signup", "/reset-password"];
const WELCOME_DELAY_MS = 1200;

/** Monaco focuses a plain div, so check for it as well as normal inputs. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  return /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable || !!el.closest(".monaco-editor, .native-edit-context, [role=textbox]");
}

/**
 * Owns the help UI state: the drawer, the active tour and the first-visit welcome card.
 * Mounted once inside SiteLayout (so it survives client navigation). Heavy parts are lazy and
 * nothing renders until the learner asks, except the welcome card for first-time visitors.
 */
export function HelpProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const progress = useHelpProgress();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<OpenHelpOptions>({});
  const [reg, setReg] = useState<Registry | null>(null);
  const [tour, setTour] = useState<HelpSection | null>(null);
  const [welcome, setWelcome] = useState(false);
  const pendingTour = useRef<string | null>(null);
  /** Set when the tour itself moved to another page, so the page change does not end it. */
  const tourNavigating = useRef(false);
  const opener = useRef<HTMLElement | null>(null);

  const ensureRegistry = useCallback(() => { void loadRegistry().then(setReg); }, []);

  const openHelp = useCallback((o: OpenHelpOptions = {}) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ensureRegistry();
    setOpts(o);
    setOpen(true);
  }, [ensureRegistry]);

  const closeHelp = useCallback(() => setOpen(false), []);
  const toggleHelp = useCallback(() => (open ? setOpen(false) : openHelp()), [open, openHelp]);

  const beginTour = useCallback((s: HelpSection) => {
    setOpen(false);
    setTour(s);
  }, []);

  const startTour = useCallback((sectionId?: string) => {
    void loadRegistry().then((r) => {
      setReg(r);
      const here = r.sectionsForPath(pathname);
      const section = (sectionId ? r.getSection(sectionId) : here.find((s) => s.tour)) ?? undefined;
      if (!section?.tour) return;
      if (here.some((s) => s.id === section.id) || section.tour.route || section.tour.steps.some((st) => st.route)) beginTour(section);
      else { pendingTour.current = section.id; setOpen(false); navigate(section.home); }
    });
  }, [pathname, navigate, beginTour]);

  // A tour that needed another page starts once that page is showing.
  useEffect(() => {
    const id = pendingTour.current;
    if (!id || !reg) return;
    const s = reg.getSection(id);
    if (s && reg.sectionsForPath(pathname).some((x) => x.id === id)) { pendingTour.current = null; beginTour(s); }
  }, [pathname, reg, beginTour]);

  // Help follows the page: a section picked from search does not stick after navigating; phones close the sheet.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setOpts({});
    if (tourNavigating.current) tourNavigating.current = false;
    else setTour(null);
    if (window.matchMedia?.("(max-width: 767px)").matches) setOpen(false);
  }, [pathname]);

  // Return focus to whatever opened help.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) opener.current?.focus?.();
    wasOpen.current = open;
  }, [open]);

  // "?" opens help from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      toggleHelp();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleHelp]);

  // First visit: show the welcome card once, a moment after the page settles. Returning visitors never see it:
  // the stored answer arrives right after hydration, which cancels this timer.
  useEffect(() => {
    if (progress.onboarding || QUIET_PATHS.includes(pathname) || welcome) return;
    const t = window.setTimeout(() => setWelcome(true), WELCOME_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [progress.onboarding, pathname, welcome]);

  const replayWelcome = useCallback(() => { restartOnboarding(); setOpen(false); setWelcome(true); }, []);

  const api = useMemo<HelpApi>(() => ({ open, openHelp, closeHelp, toggleHelp, startTour, replayWelcome }), [open, openHelp, closeHelp, toggleHelp, startTour, replayWelcome]);

  return (
    <HelpContext.Provider value={api}>
      {children}
      {open && (
        <Suspense fallback={null}>
          <HelpPanel registry={reg} pathname={pathname} options={opts} onClose={closeHelp} />
        </Suspense>
      )}
      {tour?.tour && (
        <Suspense fallback={null}>
          <GuidedTour
            key={tour.id}
            tour={tour.tour}
            onNavigate={() => { tourNavigating.current = true; }}
            onExit={(status) => { setTourStatus(tour.id, status); setTour(null); }}
          />
        </Suspense>
      )}
      {welcome && !tour && (
        <Suspense fallback={null}>
          <Onboarding
            onSkip={() => { setOnboarding("skipped"); setWelcome(false); }}
            onDone={(next) => { setOnboarding("done"); setWelcome(false); if (next === "tour") startTour("platform"); }}
          />
        </Suspense>
      )}
    </HelpContext.Provider>
  );
}
