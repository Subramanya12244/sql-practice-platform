/**
 * DataForge mark: a database cylinder whose layers feed a pipeline arrow.
 * Pure SVG so it renders the same in the app, favicon and social images.
 */
/** `tone="site"` is the public site's teal-to-violet palette; the default keeps the local app's indigo. */
const TONES = { default: ["#4f46e5", "#2563eb"], site: ["#14b8a6", "#7c3aed"] } as const;

export function BrandMark({ size = 28, className = "", tone = "default" }: { size?: number; className?: string; tone?: keyof typeof TONES }) {
  const [a, b] = TONES[tone];
  const id = `df-g-${tone}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${id})`} />
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
