import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * The one way to put an icon on a page. Every icon is a Lucide glyph drawn with the same stroke, at one of five sizes, in
 * `currentColor` so it follows the text colour in light and dark themes.
 *
 *   inline   15 px   beside running text, badges, chips
 *   button   17 px   inside buttons and links
 *   nav      19 px   sidebar and header navigation
 *   card     22 px   the icon tile of a card
 *   feature  32 px   an empty state or a feature block
 *
 * An icon is decorative unless it carries meaning on its own. Decorative icons are hidden from assistive technology; pass
 * `label` when the icon is the only thing that says what something is (a status tick with no text beside it).
 */
export type IconSize = "inline" | "button" | "nav" | "card" | "feature";

export const ICON_PX: Record<IconSize, number> = { inline: 15, button: 17, nav: 19, card: 22, feature: 32 };
/** A slightly lighter line than Lucide's default 2, which looks heavy next to the interface text. Large icons go lighter still. */
export const ICON_STROKE: Record<IconSize, number> = { inline: 1.9, button: 1.85, nav: 1.75, card: 1.75, feature: 1.5 };

export interface IconProps extends Omit<LucideProps, "size" | "ref" | "children"> {
  icon: LucideIcon;
  size?: IconSize;
  /** Set when the icon alone conveys meaning. Without it the icon is `aria-hidden`. */
  label?: string;
}

export function Icon({ icon: Glyph, size = "button", label, className = "", strokeWidth, ...rest }: IconProps) {
  return (
    <Glyph
      {...rest}
      size={ICON_PX[size]}
      strokeWidth={strokeWidth ?? ICON_STROKE[size]}
      className={`shrink-0 ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}

/** An icon on a tinted rounded tile: the shape every card icon takes. */
export function IconTile({ icon, tone = "accent", size = "card", className = "" }: { icon: LucideIcon; tone?: "accent" | "success" | "warn" | "info" | "secondary" | "neutral"; size?: IconSize; className?: string }) {
  const tones = {
    accent: "bg-accent-dim text-accent", success: "bg-success-dim text-success", warn: "bg-warn-dim text-warn",
    info: "bg-info-dim text-info", secondary: "bg-secondary-dim text-secondary", neutral: "bg-surface-soft text-ink-muted",
  } as const;
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-xl p-2.5 ${tones[tone]} ${className}`}><Icon icon={icon} size={size} /></span>;
}
