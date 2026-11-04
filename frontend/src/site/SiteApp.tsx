import { createContext, useContext, useEffect, useState } from "react";
import { useLocation, type Params } from "react-router-dom";
import type { PageData } from "./types";
import { loadPage, matchRoute, notFoundRoute } from "./routes";
import { SiteLayout } from "./components/SiteLayout";

export interface InitialPage {
  path: string;
  data: PageData;
  notFound: boolean;
}

interface PageState extends InitialPage {
  params: Params;
  loading: boolean;
}

const PageCtx = createContext<PageState | null>(null);

export function usePage(): PageState {
  const ctx = useContext(PageCtx);
  if (!ctx) throw new Error("usePage outside SiteApp");
  return ctx;
}

/**
 * Renders the page for the last fully loaded path. On client navigation the
 * old page stays on screen until the next page's data arrives.
 */
export function SiteApp({ initial }: { initial: InitialPage }) {
  const location = useLocation();
  const [page, setPage] = useState<InitialPage>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (location.pathname === page.path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPage(location.pathname)
      .then((res) => {
        if (cancelled) return;
        setPage({ path: location.pathname, ...res });
        setLoading(false);
        if (!location.hash) window.scrollTo(0, 0);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const { route, params } = matchRoute(page.path);
  const element = page.notFound ? notFoundRoute.element : route.element;

  return (
    <PageCtx.Provider value={{ ...page, params, loading }}>
      <SiteLayout loading={loading} error={error}>
        {element}
      </SiteLayout>
    </PageCtx.Provider>
  );
}
