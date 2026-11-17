// @vitest-environment node
// The motion system has three copies of its numbers (lib/motion.ts, tailwind.config.js, site.css). They must agree, and the
// rules that keep the interface quick (short entrances, no endless decorative loops) are checked here so they cannot drift back.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error the Tailwind config is plain JavaScript and has no type declarations
import tailwind from "../../tailwind.config.js";
import { EASE, MOTION, STAGGER, staggerSettleMs } from "../site/lib/motion";

const css = readFileSync(join(__dirname, "..", "site", "site.css"), "utf8");
const ui = readFileSync(join(__dirname, "..", "site", "components", "ui.tsx"), "utf8");
const ms = (v: unknown) => Number(String(v).replace("ms", ""));

describe("motion tokens agree everywhere", () => {
  it("Tailwind durations equal lib/motion", () => {
    const d = (tailwind.theme!.extend as { transitionDuration: Record<string, string> }).transitionDuration;
    for (const k of Object.keys(MOTION) as (keyof typeof MOTION)[]) expect(ms(d[k]), k).toBe(MOTION[k]);
    expect(Object.keys(d).sort()).toEqual(Object.keys(MOTION).sort());
  });

  it("site.css custom properties equal lib/motion", () => {
    for (const [name, value] of Object.entries(MOTION)) expect(css, name).toContain(`--motion-${name}: ${value}ms;`);
    expect(css).toContain(`--ease-out: ${EASE.out};`);
    expect(css).toContain(`--ease-in-out: ${EASE.inOut};`);
  });

  it("targets: press and hover feedback is 100-160 ms, cards and menus 140-200 ms, modals and pages up to 240 ms, complex up to 300 ms", () => {
    expect(MOTION.instant).toBeGreaterThanOrEqual(100);
    expect(MOTION.fast).toBeLessThanOrEqual(160);
    expect(MOTION.base).toBeGreaterThanOrEqual(140);
    expect(MOTION.base).toBeLessThanOrEqual(200);
    expect(MOTION.enter).toBeLessThanOrEqual(240);
    expect(MOTION.slow).toBeLessThanOrEqual(300);
  });
});

describe("entrances are short", () => {
  it("a staggered list finishes in well under half a second (it took 825 ms)", () => {
    expect(staggerSettleMs).toBeLessThanOrEqual(400);
    const delays = [...css.matchAll(/\.stagger > \*:nth-child\([^)]*\) \{ animation-delay: (\d+)ms; \}/g)].map((m) => Number(m[1]));
    expect(delays.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...delays)).toBe(STAGGER.stepMs * (STAGGER.maxItems - 1));
    expect(css).toMatch(/\.stagger > \* \{ animation: df-fade-up var\(--motion-enter\)/);
  });

  it("scroll reveal, accordions and the theme switch use the tokens, not hard-coded long times", () => {
    expect(css).toMatch(/\.reveal-in \{[^}]*var\(--motion-enter\)/);
    expect(css).toMatch(/\.collapse-grid \{[^}]*var\(--motion-base\)/);
    expect(css).toMatch(/html\.theme-transition[^{]*\{[^}]*var\(--motion-base\)/);
  });

  it("Tailwind entrance animations are 160-240 ms", () => {
    const anim = (tailwind.theme!.extend as { animation: Record<string, string> }).animation;
    for (const k of ["fade-in", "fade-up", "slide-in", "toast-in", "scale-in", "pop"]) {
      const t = /(\d+)ms/.exec(anim[k]);
      expect(t, k).toBeTruthy();
      expect(Number(t![1]), k).toBeLessThanOrEqual(240);
    }
  });
});

describe("nothing moves forever for decoration", () => {
  it("site.css has no infinite animation", () => {
    expect(css.match(/\binfinite\b/g) ?? []).toEqual([]);
  });

  it("only the loading shimmer is infinite in the Tailwind config, and the panning and floating decorations are gone", () => {
    const anim = (tailwind.theme!.extend as { animation: Record<string, string> }).animation;
    expect(Object.entries(anim).filter(([, v]) => /infinite/.test(v)).map(([k]) => k)).toEqual(["shimmer"]);
    for (const gone of ["float", "float-slow", "gradient-pan"]) expect(anim[gone]).toBeUndefined();
  });

  it("the hero gradient no longer animates background-position", () => {
    expect(css).not.toMatch(/gradient-pan/);
    const daily = readFileSync(join(__dirname, "..", "site", "components", "daily", "DailyDashboard.tsx"), "utf8");
    expect(daily).not.toMatch(/gradient-pan/);
  });
});

describe("components animate only what they should", () => {
  it("buttons and interactive cards list the properties they transition instead of transition-all", () => {
    const button = /const BTN_BASE =\s*"([^"]+)"/.exec(ui)![1];
    expect(button).not.toContain("transition-all");
    expect(button).toContain("active:scale-[0.98]");
    expect(button).toContain("active:duration-instant");
    const card = /interactive \? "([^"]+)"/.exec(ui)![1];
    expect(card).not.toContain("transition-all");
    expect(card).toContain("duration-base");
  });

  it("reduced motion switches the entrance, reveal and accordion animations off", () => {
    // every reduced-motion block in the file (there are several, by feature)
    const block = css.split("@media (prefers-reduced-motion: reduce)").slice(1).map((chunk) => chunk.slice(0, 900)).join("\n");
    expect(block).toMatch(/\.stagger/);
    expect(block).toMatch(/\.reveal-pending/);
    expect(block).toMatch(/\.collapse-grid/);
  });
});
