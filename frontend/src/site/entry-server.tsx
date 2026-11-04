import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { SiteApp, type InitialPage } from "./SiteApp";
import { Providers } from "./Providers";
import { loadPage, routes, notFoundRoute } from "./routes";
import { HeadCollector, renderHeadTags, type HeadData } from "./lib/seo";
import { setJsonFetcher } from "./lib/data";

export { setJsonFetcher };

/** Every concrete path to prerender. */
export async function allPaths(): Promise<string[]> {
  const lists = await Promise.all([...routes, notFoundRoute].map((r) => r.paths()));
  return lists.flat();
}

export async function render(path: string) {
  const { data, notFound } = await loadPage(path);
  const page: InitialPage = { path, data, notFound };
  const collector: { head?: HeadData } = {};
  const html = renderToString(
    <HeadCollector.Provider value={collector}>
      <StaticRouter location={path}>
        <Providers>
          <SiteApp initial={page} />
        </Providers>
      </StaticRouter>
    </HeadCollector.Provider>,
  );
  const head = collector.head;
  return {
    html,
    head: head ? renderHeadTags(head) : "",
    noindex: !!head?.noindex || notFound,
    page,
  };
}
