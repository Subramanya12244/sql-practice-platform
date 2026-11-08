import { InlineMarkdown } from "./Markdown";
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { QuestionSummary } from "../types";

const DIFF_STYLE: Record<string, string> = {
  Easy: "bg-success-dim text-success",
  Medium: "bg-warn-dim text-warn",
  Hard: "bg-danger-dim text-danger",
  Advanced: "bg-danger-dim text-danger",
  Expert: "bg-accent-dim text-accent",
};

export function Difficulty({ level }: { level: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${DIFF_STYLE[level] ?? "bg-surface-soft text-ink-muted"}`}>
      {level}
    </span>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-surface-border bg-surface-overlay px-1.5 py-0.5 text-[11px] text-ink-muted">
      {children}
    </span>
  );
}

export function Container({ children, className = "", wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={`mx-auto w-full ${wide ? "max-w-[1600px]" : "max-w-6xl"} px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function PageHeader({ eyebrow, title, intro }: { eyebrow?: string; title: string; intro?: ReactNode }) {
  return (
    <header className="pb-6 pt-10 sm:pt-14">
      {eyebrow && <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent"><span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-accent to-secondary" aria-hidden />{eyebrow}</p>}
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
      {intro && <div className="mt-3 max-w-3xl text-base leading-relaxed text-ink-muted">{intro}</div>}
    </header>
  );
}

export function QuestionCard({ q, solved }: { q: QuestionSummary; solved?: boolean }) {
  return (
    <Link
      to={`/questions/${q.slug}`}
      className="group flex flex-col gap-2 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition duration-fast hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow"
    >
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <span className="font-mono">Q{String(q.number).padStart(2, "0")}</span>
        <span>·</span>
        <span>{q.topicLabel}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {q.isNew && <span className="rounded bg-accent-dim px-1.5 text-[10px] font-semibold uppercase text-accent">New</span>}
          {q.hadMistakes && <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-label="Common trap" />}
          {solved && <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="Solved" />}
          <Difficulty level={q.difficulty} />
        </span>
      </div>
      <h3 className="font-semibold text-ink group-hover:text-accent">{q.title}</h3>
      {q.problemShort && <p className="line-clamp-2 text-sm text-ink-muted"><InlineMarkdown source={q.problemShort} /></p>}
    </Link>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-soft ${className}`} />;
}

// ── Design system primitives (DataForge) ───────────────────────────────────
// One place for the shapes every page uses, so pages stay consistent. Colours come from the
// theme tokens in site.css; nothing here hard-codes a palette.

type Variant = "primary" | "secondary" | "ghost" | "danger";
const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-fast active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
const BTN_VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-on-accent shadow-glow hover:brightness-110",
  secondary: "border border-surface-border bg-surface-raised text-ink hover:border-accent/40 hover:bg-surface-overlay",
  ghost: "text-ink-muted hover:bg-hover/5 hover:text-ink",
  danger: "bg-danger text-on-accent hover:brightness-110",
};
const BTN_SIZE = { sm: "min-h-[36px] px-3 text-sm", md: "min-h-[42px] px-4 text-sm", lg: "min-h-[48px] px-5 text-base" };

export function buttonClass(variant: Variant = "primary", size: keyof typeof BTN_SIZE = "md", extra = "") {
  return `${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${extra}`;
}

export function Button({ variant = "primary", size = "md", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof BTN_SIZE }) {
  return <button type="button" {...rest} className={buttonClass(variant, size, className)} />;
}

export function ButtonLink({ to, variant = "primary", size = "md", className = "", children }: { to: string; variant?: Variant; size?: keyof typeof BTN_SIZE; className?: string; children: ReactNode }) {
  return <Link to={to} className={buttonClass(variant, size, className)}>{children}</Link>;
}

const CARD_PAD = { none: "", sm: "p-4", md: "p-5" };
export function Card({ children, className = "", as: Tag = "div", interactive = false, pad = "md", "aria-label": label, "aria-labelledby": labelledBy }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "li"; interactive?: boolean; pad?: keyof typeof CARD_PAD; "aria-label"?: string; "aria-labelledby"?: string }) {
  return (
    <Tag aria-label={label} aria-labelledby={labelledBy} className={`rounded-card border border-surface-border bg-surface-raised ${CARD_PAD[pad]} shadow-panel ${interactive ? "transition duration-fast hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow" : ""} ${className}`}>
      {children}
    </Tag>
  );
}

const BADGE_TONE = {
  neutral: "bg-surface-soft text-ink-muted",
  accent: "bg-accent-dim text-accent",
  secondary: "bg-secondary-dim text-secondary",
  success: "bg-success-dim text-success",
  warn: "bg-warn-dim text-warn",
  danger: "bg-danger-dim text-danger",
};
export function Badge({ tone = "neutral", children, className = "" }: { tone?: keyof typeof BADGE_TONE; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONE[tone]} ${className}`}>{children}</span>;
}

/** value/max with an accessible label; the bar fills with a short transition (reduced-motion safe). */
export function ProgressBar({ value, max = 100, label, tone = "accent", className = "" }: { value: number; max?: number; label: string; tone?: "accent" | "secondary" | "success"; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = { accent: "bg-gradient-to-r from-accent to-accent-muted", secondary: "bg-secondary", success: "bg-success" }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={`h-2 overflow-hidden rounded-full bg-surface-soft ${className}`}>
      <div className={`h-full rounded-full ${fill} transition-[width] duration-500 ease-out`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ProgressRing({ value, max = 100, size = 72, label, children }: { value: number; max?: number; size?: number; label: string; children?: ReactNode }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${Math.round(pct * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="stroke-surface-soft" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-accent transition-[stroke-dashoffset] duration-700 ease-out"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span className="absolute text-center">{children}</span>
    </div>
  );
}

/** Metric tile. `trend` adds a coloured up/down/flat note beside the hint (e.g. "+3 this week"). */
export function StatCard({ label, value, hint, icon: Icon, trend }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ComponentType<{ className?: string }>; trend?: { direction: "up" | "down" | "flat"; label: string } }) {
  const trendTone = trend ? { up: "text-success", down: "text-danger", flat: "text-ink-faint" }[trend.direction] : "";
  const TrendIcon = trend ? { up: TrendingUp, down: TrendingDown, flat: Minus }[trend.direction] : null;
  return (
    <Card pad="sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
        {Icon && <span className="rounded-lg bg-accent-dim p-1.5 text-accent"><Icon className="h-4 w-4" /></span>}
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
      {(hint || trend) && (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          {trend && TrendIcon && <span className={`inline-flex items-center gap-0.5 font-medium ${trendTone}`}><TrendIcon className="h-3 w-3" aria-hidden />{trend.label}</span>}
          {hint}
        </p>
      )}
    </Card>
  );
}

/** Square icon-only button with a required accessible label and a 40px touch target. */
export function IconButton({ label, children, active = false, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control transition duration-fast disabled:pointer-events-none disabled:opacity-50 ${active ? "bg-accent-dim text-accent" : "text-ink-muted hover:bg-hover/5 hover:text-ink"} ${className}`}>
      {children}
    </button>
  );
}

/** Horizontal action bar (editor toolbars, table toolbars). Children decide grouping; use <ToolbarDivider />. */
export function Toolbar({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="toolbar" aria-label={label} className={`flex min-h-[48px] flex-wrap items-center gap-1.5 border-b border-surface-border bg-surface-raised px-2 py-1 ${className}`}>
      {children}
    </div>
  );
}
export function ToolbarDivider() {
  return <span aria-hidden className="mx-1 h-6 w-px bg-surface-border" />;
}

/** Progress as discrete segments (lesson steps, module parts). Falls back to a bar above 24 steps. */
export function SegmentedProgress({ done, total, label, className = "" }: { done: number; total: number; label: string; className?: string }) {
  if (total > 24) return <ProgressBar value={done} max={total} label={label} className={className} />;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className={`flex gap-1 ${className}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-2 flex-1 rounded-full transition-colors duration-base ${i < done ? "bg-accent" : "bg-surface-soft"}`} />
      ))}
    </div>
  );
}

/** A whole-card radio option (assessments, choices). Wrap a group in role="radiogroup". */
export function RadioCard({ name, value, checked, onChange, title, description, disabled, tone }: { name: string; value: string; checked: boolean; onChange: (value: string) => void; title: ReactNode; description?: ReactNode; disabled?: boolean; tone?: "success" | "danger" }) {
  const ring = tone === "success" ? "border-success bg-success-dim" : tone === "danger" ? "border-danger bg-danger-dim" : checked ? "border-accent bg-accent-dim" : "border-surface-border bg-surface-raised hover:border-accent/40";
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-card border p-4 transition duration-fast has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${ring} ${disabled ? "cursor-default opacity-80" : ""}`}>
      <input type="radio" className="sr-only" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} />
      <span aria-hidden className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-accent" : "border-ink-faint"}`}>
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Settings row: label + description on the left, an accessible switch on the right. */
export function SwitchRow({ label, description, checked, onChange, disabled }: { label: string; description?: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-fast disabled:opacity-50 ${checked ? "bg-accent" : "bg-surface-soft"}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-surface-raised shadow-panel transition-transform duration-fast ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

export function SectionHeader({ title, action, id, description }: { title: string; action?: ReactNode; id?: string; description?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 id={id} className="font-display text-lg font-bold text-ink sm:text-xl">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: ComponentType<{ className?: string }>; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-surface-border bg-surface-raised/50 px-6 py-10 text-center">
      {Icon && <span className="mb-3 rounded-2xl bg-accent-dim p-3 text-accent"><Icon className="h-6 w-6" /></span>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger-dim p-4 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold text-danger">{title}</p>
        {children && <div className="mt-0.5 text-ink">{children}</div>}
      </div>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Accessible tab list (roving arrow keys). Panels are rendered by the caller. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-surface-border bg-surface-overlay p-1"
      onKeyDown={(e) => {
        const i = tabs.findIndex((t) => t.id === value);
        const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
        if (next) { e.preventDefault(); onChange(next.id); }
      }}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition duration-fast ${t.id === value ? "bg-surface-raised text-ink shadow-panel" : "text-ink-muted hover:text-ink"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Small hover/focus tooltip. The trigger keeps its own accessible name; the tip is supplementary. */
export function Tooltip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-surface-overlay px-2 py-1 text-xs text-ink opacity-0 shadow-soft ring-1 ring-surface-border transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100">
        {tip}
      </span>
    </span>
  );
}
