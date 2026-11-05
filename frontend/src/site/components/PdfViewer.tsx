import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
// Bundled as a regular .js worker so it never depends on how a host serves .mjs files.
import PdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import { Button } from "./ui";

if (typeof window !== "undefined") pdfjs.GlobalWorkerOptions.workerPort ??= new PdfjsWorker();

/**
 * Renders the generated PDF itself (pdf.js), page by page: the bytes previewed here are the
 * same bytes the Download button saves. Supports page navigation, zoom and fit-to-width.
 */
export default function PdfViewer({ blob }: { blob: Blob }) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [err, setErr] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false, loaded: pdfjs.PDFDocumentProxy | null = null;
    setDoc(null); setErr(null); setPage(1);
    void blob.arrayBuffer().then((buf) => pdfjs.getDocument({ data: new Uint8Array(buf) }).promise).then((d) => {
      loaded = d;
      if (!cancelled) setDoc(d); else void d.destroy();
    }).catch((e: Error) => !cancelled && setErr(`The PDF could not be displayed: ${e.message}`));
    return () => { cancelled = true; void loaded?.destroy(); };
  }, [blob]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null, cancelled = false;
    setRendering(true);
    void doc.getPage(page).then((p) => {
      if (cancelled || !canvas.current) return;
      const base = p.getViewport({ scale: 1 });
      const width = (box.current?.clientWidth ?? 800) - 24;
      const scale = zoom === "fit" ? Math.max(0.3, width / base.width) : zoom;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = p.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = `${Math.floor(vp.width / dpr)}px`; c.style.height = `${Math.floor(vp.height / dpr)}px`;
      task = p.render({ canvasContext: c.getContext("2d")!, viewport: vp });
      return task.promise;
    }).catch((e: Error) => { if (!/cancel/i.test(e.message)) setErr(e.message); }).finally(() => !cancelled && setRendering(false));
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, page, zoom]);

  const n = doc?.numPages ?? 0;
  const go = (p: number) => setPage(Math.max(1, Math.min(n, p)));
  const z = typeof zoom === "number" ? zoom : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
    };
    const el = box.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  });

  if (err) return <p role="alert" className="rounded-lg border border-danger/30 bg-danger-dim px-3 py-2 text-sm text-danger">{err}</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-sm" role="toolbar" aria-label="PDF preview controls">
        <Button size="sm" variant="secondary" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
        <label className="flex items-center gap-1 text-ink-muted">Page
          <input type="number" min={1} max={n || 1} value={page} onChange={(e) => go(Number(e.target.value) || 1)} className="w-14 rounded-lg border border-surface-border bg-surface px-1.5 py-1 text-ink" aria-label="Page number" />
          of <span className="tabular-nums text-ink" data-testid="pdf-page-count">{n || "…"}</span>
        </label>
        <Button size="sm" variant="secondary" onClick={() => go(page + 1)} disabled={!n || page >= n} aria-label="Next page"><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        <span className="mx-1 h-5 w-px bg-surface-border" aria-hidden />
        <Button size="sm" variant="ghost" onClick={() => setZoom(Math.max(0.5, (z ?? 1) - 0.25))} aria-label="Zoom out"><ZoomOut className="h-4 w-4" aria-hidden /></Button>
        <span className="w-12 text-center tabular-nums text-ink-muted" aria-live="polite">{z ? `${Math.round(z * 100)}%` : "Fit"}</span>
        <Button size="sm" variant="ghost" onClick={() => setZoom(Math.min(3, (z ?? 1) + 0.25))} aria-label="Zoom in"><ZoomIn className="h-4 w-4" aria-hidden /></Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom("fit")} aria-label="Fit to width"><Maximize className="h-4 w-4" aria-hidden /></Button>
        {(rendering || !doc) && <Loader2 className="h-4 w-4 animate-spin text-ink-faint" aria-label="Rendering" />}
      </div>
      <div ref={box} tabIndex={0} aria-label={`PDF page ${page} of ${n}`} className="mt-2 max-h-[80vh] overflow-auto rounded-lg border border-surface-border bg-surface-soft p-3 focus-visible:outline-2">
        <canvas ref={canvas} className="mx-auto block bg-white shadow-panel" />
      </div>
    </div>
  );
}
