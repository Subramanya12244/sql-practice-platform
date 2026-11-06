import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SiteApp, type InitialPage } from "./SiteApp";
import { Providers } from "./Providers";
import { loadPage } from "./routes";
import { loadIndex, loadTopics } from "./lib/data";
import "../index.css";
import "./site.css";

const root = document.getElementById("root")!;

function app(initial: InitialPage) {
  return (
    <StrictMode>
      <BrowserRouter>
        <Providers>
          <SiteApp initial={initial} />
        </Providers>
      </BrowserRouter>
    </StrictMode>
  );
}

const pageData = document.getElementById("__PAGE__")?.textContent;
const embedded: InitialPage | undefined = pageData ? JSON.parse(pageData) : undefined;
if (embedded) {
  // Prerendered page. The shared index/topics are left out of the HTML to keep
  // it small; fetch them (browser-cached across pages) so hydration matches.
  Promise.all([loadIndex(), loadTopics()]).then(([index, topics]) => {
    hydrateRoot(root, app({ ...embedded, data: { ...embedded.data, index, topics } }));
  });
} else {
  // Dev server (no prerender): load data first, then render.
  loadPage(window.location.pathname).then(({ data, notFound }) => {
    createRoot(root).render(app({ path: window.location.pathname, data, notFound }));
  });
}

// Offline support for production builds only; dev keeps fresh modules.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
