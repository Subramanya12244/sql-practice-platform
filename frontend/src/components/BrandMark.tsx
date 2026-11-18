import { MARK_BOX, MARK_PATH, MARK_ROWS, MARK_VIEWBOX, WORDMARK, lockupMetrics } from "../brandGeometry.js";

/**
 * The DataForge mark: an anvil cut into three rows, the way a table is cut into rows (see docs/DATAFORGE_BRAND_IDENTITY.md).
 * Pure SVG paths from one shared geometry, so the app, the favicon files and the social cards draw the same shape. It is a single
 * flat colour, and it draws nothing else (no gradient, no id, no filter), so any number can sit on a page.
 *
 *   variant "color"  the product blue (follows the theme: a lighter blue on dark surfaces)
 *   variant "mono"   the surrounding text colour (`currentColor`), for one-colour uses
 *   variant "heated" the working face in the ember accent. Use sparingly; the default is "color".
 *   tight            crop to the mark's own ink box, so it aligns with text; otherwise it sits on its 64 x 64 grid (tiles)
 *   label            set when the mark alone names something; without it the mark is hidden from assistive technology
 */
export type BrandMarkVariant = "color" | "mono" | "heated";

export function BrandMark({ size = 28, className = "", variant = "color", tight = false, label }: { size?: number; className?: string; variant?: BrandMarkVariant; tight?: boolean; label?: string }) {
  const fill = variant === "mono" ? "fill-current" : "fill-brand";
  const viewBox = tight ? `${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.width} ${MARK_BOX.height}` : MARK_VIEWBOX;
  const height = tight ? (size * MARK_BOX.height) / MARK_BOX.width : size;
  return (
    <svg width={size} height={height} viewBox={viewBox} className={`shrink-0 ${className}`} focusable="false" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      {variant === "heated" ? (
        <>
          <path className="fill-brand-ember" d={MARK_ROWS[0]} />
          <path className="fill-brand" d={`${MARK_ROWS[1]}${MARK_ROWS[2]}`} />
        </>
      ) : (
        <path className={fill} d={MARK_PATH} />
      )}
    </svg>
  );
}

/**
 * The horizontal lockup: the mark and the word "DataForge" ("Data" Medium, "Forge" Bold, the application's own Inter), with the word
 * drawn from outlines rather than typed. Outlines mean the logo never waits for a web font, so it cannot shift the header when the
 * font arrives, and it is the same drawing as the files in /brand.
 *
 *   height   the lockup's height in px (default 32); its width follows from the drawing
 *   compact  below 360 px wide only the mark is shown
 *   label    set to name the logo as an image; leave it off when the logo sits inside a link or heading that already has the name
 */
export function BrandLogo({ height = 32, className = "", compact = false, label }: { height?: number; className?: string; compact?: boolean; label?: string }) {
  const L = lockupMetrics();
  const width = (height * L.width) / L.height;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <span className={`inline-flex items-center text-ink ${className}`}>
      <svg width={width} height={height} viewBox={`0 0 ${L.width} ${L.height}`} focusable="false" className={compact ? "max-[359px]:hidden" : undefined} {...a11y}>
        <g transform={`scale(${L.scale})`}><path className="fill-brand" d={MARK_PATH} /></g>
        <g className="fill-current" transform={`translate(${L.textX} ${L.baseline})`}>
          <path d={WORDMARK.data} />
          <path d={WORDMARK.forge} />
        </g>
      </svg>
      {compact && (
        <svg width={(MARK_BOX.width * L.scale * height) / L.height} height={(MARK_BOX.height * L.scale * height) / L.height} viewBox={`${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.width} ${MARK_BOX.height}`} focusable="false" className="hidden max-[359px]:block" {...a11y}>
          <path className="fill-brand" d={MARK_PATH} />
        </svg>
      )}
    </span>
  );
}
