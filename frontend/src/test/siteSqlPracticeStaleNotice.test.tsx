import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClassicStaleNotice } from "../site/components/visual/classic/ClassicStaleNotice";
import { vizNoticeText, type VizReason, type VizStatus } from "../site/lib/visual/classic/vizSource";

const CASES: [VizStatus, VizReason][] = [["current", "matches-editor"], ["current", "failed-run"], ["last-successful", "edited"], ["last-successful", "latest-failed"], ["stale", "older-run"], ["stale", "edited-failed"], ["none", "no-run"], ["none", "not-visualized"], ["none", "only-failed"]];

describe("ClassicStaleNotice", () => {
  it.each(CASES)("%s / %s: a polite status region with the state and the wording", (status, reason) => {
    render(<ClassicStaleNotice status={status} reason={reason} />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("data-status")).toBe(status);
    expect(el.getAttribute("data-reason")).toBe(reason);
    expect(el.textContent).toContain(vizNoticeText(status, reason));
  });
  it("uses site theme tokens only (no raw colours)", () => {
    const { container } = render(<ClassicStaleNotice status="stale" reason="older-run" />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|\b(?:bg|text|border)-(?:red|green|amber|yellow|blue|gray|slate)-\d/i);
  });
});
