// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GLOSSARY, SECTIONS, FALLBACK_SECTION_ID, sectionsForPath, getSection } from "../site/help/registry";
import { NAV_GROUPS } from "../site/lib/navigation";
import { ROUTE_PATTERNS, checkGlossary, checkSection, e2eControlNames, tooltipIdsInSource, tooltipLabelsInSource } from "./helpValidate";

describe("help content", () => {
  it("has a platform fallback and unique section ids", () => {
    expect(getSection(FALLBACK_SECTION_ID)).toBeTruthy();
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
  });

  for (const s of SECTIONS) {
    it(`section "${s.id}" is complete and points only at real things`, () => {
      expect(checkSection(s)).toEqual([]);
    });
  }

  it("glossary is well formed", () => {
    expect(checkGlossary(GLOSSARY, new Set(SECTIONS.map((s) => s.id)))).toEqual([]);
  });

  it("every HelpTooltip in the app uses a glossary id that exists", () => {
    const ids = new Set(GLOSSARY.map((g) => g.id));
    expect(tooltipIdsInSource().filter((t) => !ids.has(t.id))).toEqual([]);
  });

  it("no tooltip's accessible name contains a button or link name the browser tests look up (would make them ambiguous)", () => {
    const names = e2eControlNames();
    const clash = tooltipLabelsInSource().flatMap((t) => names.filter((n) => (typeof n === "string" ? t.label.toLowerCase().includes(n.toLowerCase()) && n.length > 4 : n.test(t.label) && n.source.length > 4)).map((n) => `${t.file}: "${t.label}" vs ${String(n)}`));
    expect(clash).toEqual([]);
  });

  it("every real route resolves to help (own section or platform guide)", () => {
    for (const r of ROUTE_PATTERNS) expect(sectionsForPath(r.replace(/:[^/]+/g, "x")).length, r).toBeGreaterThan(0);
  });

  it("pending sections: routes really are absent (tripwire: remove `pending` once merged)", () => {
    for (const s of SECTIONS.filter((x) => x.pending)) for (const r of s.routes) expect(ROUTE_PATTERNS, `${s.id} ${r} now exists, drop pending`).not.toContain(r);
  });

  it("platform guide names every navigation group", () => {
    const text = JSON.stringify(getSection(FALLBACK_SECTION_ID)).toLowerCase();
    for (const g of NAV_GROUPS) expect(text, g.label).toContain(g.label.toLowerCase());
  });

  it("major sections are all present", () => {
    const need = ["sql-practice", "python-practice", "daily-learning", "projects-scenarios", "etl-builder", "mistake-notebook", "analytics"];
    for (const id of need) expect(getSection(id), id).toBeTruthy();
  });
});
