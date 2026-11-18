import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandLogo, BrandMark } from "../components/BrandMark";
import { MARK_BOX, MARK_PATH, WORDMARK, lockupMetrics } from "../brandGeometry.js";

describe("BrandMark", () => {
  it("is decorative unless it has a label", () => {
    const { container, rerender } = render(<BrandMark />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    rerender(<BrandMark label="DataForge" />);
    expect(screen.getByRole("img", { name: "DataForge" })).toBeTruthy();
  });

  it("draws the shared geometry, in the brand colour by default and in the text colour when mono", () => {
    const { container, rerender } = render(<BrandMark />);
    const p = container.querySelector("path")!;
    expect(p.getAttribute("d")).toBe(MARK_PATH);
    expect(p.getAttribute("class")).toContain("fill-brand");
    rerender(<BrandMark variant="mono" />);
    expect(container.querySelector("path")!.getAttribute("class")).toContain("fill-current");
    rerender(<BrandMark variant="heated" />);
    const classes = [...container.querySelectorAll("path")].map((x) => x.getAttribute("class"));
    expect(classes).toEqual(["fill-brand-ember", "fill-brand"]);
  });

  it("keeps its proportions: square on the grid, or cropped to the ink box with the matching height", () => {
    const { container, rerender } = render(<BrandMark size={40} />);
    let svg = container.querySelector("svg")!;
    expect([svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("viewBox")]).toEqual(["40", "40", "0 0 64 64"]);
    rerender(<BrandMark size={60} tight />);
    svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe(`${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.width} ${MARK_BOX.height}`);
    expect(Number(svg.getAttribute("height"))).toBeCloseTo((60 * MARK_BOX.height) / MARK_BOX.width, 5);
  });

  it("uses no ids, so any number of marks can share a page (the old gradient mark needed a unique id each)", () => {
    const { container } = render(<><BrandMark /><BrandMark /><BrandMark tight /></>);
    expect(container.querySelectorAll("[id]")).toHaveLength(0);
    expect(container.querySelectorAll("linearGradient, defs, filter")).toHaveLength(0);
  });
});

describe("BrandLogo", () => {
  it("is one drawing: the mark in the brand colour and the outlined wordmark in the text colour, with no typed text to wait for a font", () => {
    const { container } = render(<BrandLogo />);
    expect(container.textContent).toBe("");
    const paths = [...container.querySelectorAll("path")];
    expect(paths).toHaveLength(3);
    expect(paths[0].getAttribute("d")).toBe(MARK_PATH);
    expect(paths[0].getAttribute("class")).toBe("fill-brand");
    expect(paths[1].getAttribute("d")).toBe(WORDMARK.data);
    expect(paths[2].getAttribute("d")).toBe(WORDMARK.forge);
    expect(paths[1].parentElement!.getAttribute("class")).toBe("fill-current");
    expect(container.querySelectorAll("[id], defs, linearGradient")).toHaveLength(0);
  });

  it("keeps the lockup's proportions at any height", () => {
    const L = lockupMetrics();
    for (const h of [24, 34, 48]) {
      const { container, unmount } = render(<BrandLogo height={h} />);
      const svg = container.querySelector("svg")!;
      expect(Number(svg.getAttribute("width")) / Number(svg.getAttribute("height"))).toBeCloseTo(L.width / L.height, 3);
      expect(svg.getAttribute("height")).toBe(String(h));
      unmount();
    }
  });

  it("is hidden from assistive technology unless it is given a label, and then it is one named image", () => {
    const { container, rerender } = render(<BrandLogo />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    rerender(<BrandLogo label="DataForge" />);
    expect(screen.getAllByRole("img", { name: "DataForge" })).toHaveLength(1);
  });

  it("the compact form swaps to the mark alone below 360 px and keeps one name", () => {
    const { container } = render(<BrandLogo compact label="DataForge" />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    expect(svgs[0].getAttribute("class")).toContain("max-[359px]:hidden");
    expect(svgs[1].getAttribute("class")).toContain("max-[359px]:block");
    const mark = svgs[1];
    expect(Number(mark.getAttribute("width")) / Number(mark.getAttribute("height"))).toBeCloseTo(MARK_BOX.width / MARK_BOX.height, 3);
  });
});
