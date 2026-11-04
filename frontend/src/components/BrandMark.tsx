/**
 * DataForge mark: a database cylinder whose layers feed a pipeline arrow.
 * Pure SVG so it renders the same in the app, favicon and social images.
 */
export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="df-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#df-g)" />
      <g fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="25" cy="17" rx="12" ry="4.5" />
        <path d="M13 17v24c0 2.5 5.4 4.5 12 4.5" />
        <path d="M37 17v9" />
        <path d="M13 29c0 2.5 5.4 4.5 12 4.5" />
        <path d="M31 39h18" />
        <path d="M43 32l7 7-7 7" />
      </g>
    </svg>
  );
}
