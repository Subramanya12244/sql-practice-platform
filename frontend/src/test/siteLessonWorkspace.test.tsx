import { beforeEach, describe, expect, it } from "vitest";
import { act, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useRef } from "react";
import { DayList, LessonRail, loadPosition, savePosition, useHeadings, useResume } from "../site/components/daily/LessonWorkspace";
import { CURRICULUM, findDay, sequenceFor } from "../site/lib/daily";
import type { DailyView } from "../site/lib/useDaily";
import type { DailyState } from "../site/lib/dailyProgress";

const day3 = findDay("common", 3)!;
const view = (state: DailyState): DailyView => ({ progress: {} as never, state, path: undefined, seq: sequenceFor(undefined), revisions: {} });
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => localStorage.clear());

describe("remembered lesson position", () => {
  it("saves and loads the step and scroll offset per lesson", () => {
    savePosition("d003", { step: "guided", y: 1234 });
    expect(loadPosition("d003")).toMatchObject({ step: "guided", y: 1234 });
    expect(loadPosition("d004")).toBeUndefined();
  });

  it("keeps only the 40 most recent lessons", () => {
    for (let i = 0; i < 45; i++) savePosition(`x${i}`, { step: "understand", y: i });
    const all = JSON.parse(localStorage.getItem("df.daily.pos.v1")!);
    expect(Object.keys(all)).toHaveLength(40);
  });

  it("survives unavailable storage", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("denied"); };
    try { expect(() => savePosition("d001", { step: "understand", y: 0 })).not.toThrow(); } finally { Storage.prototype.setItem = orig; }
  });

  it("offers to resume only a lesson that was left part-way and is not complete", () => {
    savePosition("d003", { step: "guided", y: 900 });
    const a = renderHook(() => useResume("d003", "understand", false));
    expect(a.result.current.offer).toMatchObject({ step: "guided", y: 900 });
    const done = renderHook(() => useResume("d003", "understand", true));
    expect(done.result.current.offer).toBeUndefined();
    savePosition("d004", { step: "understand", y: 50 });
    expect(renderHook(() => useResume("d004", "understand", false)).result.current.offer).toBeUndefined();
    act(() => a.result.current.dismiss());
    expect(a.result.current.offer).toBeUndefined();
  });

  it("opening a lesson does not overwrite where you were", () => {
    savePosition("d003", { step: "guided", y: 900 });
    renderHook(() => useResume("d003", "understand", false));
    expect(loadPosition("d003")).toMatchObject({ step: "guided", y: 900 });
  });

  it("a step change is remembered", () => {
    const { rerender } = renderHook(({ step }) => useResume("d005", step, false), { initialProps: { step: "understand" } });
    rerender({ step: "check" });
    expect(loadPosition("d005")?.step).toBe("check");
  });
});

describe("section headings of the current step", () => {
  function Probe({ html }: { html: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const heads = useHeadings(ref, html);
    return (<><div ref={ref} dangerouslySetInnerHTML={{ __html: html }} /><ul>{heads.map((h) => <li key={h.id} data-level={h.level}>{h.text}</li>)}</ul></>);
  }
  it("lists h2 and h3 in order, with ids to link to, and ignores empty ones", () => {
    const { container } = render(<Probe html="<h2>Understand</h2><h3>Operators</h3><h3> </h3><h4>skip</h4><h2>Examples</h2>" />);
    const items = [...container.querySelectorAll("li")].map((l) => [l.textContent, l.getAttribute("data-level")]);
    expect(items).toEqual([["Understand", "2"], ["Operators", "3"], ["Examples", "2"]]);
    for (const h of container.querySelectorAll("h2, h3")) if (h.textContent?.trim()) expect(h.id).toMatch(/^lesson-sec-/);
  });
});

describe("day navigation and rail", () => {
  it("lists the days of the phase, marks the current one and shows real completion", () => {
    const state: DailyState = { days: { d001: { completedAt: "2026-02-01T10:00:00Z" } } };
    wrap(<DayList day={day3} view={view(state)} />);
    const phaseDays = CURRICULUM.days.filter((d) => d.phase === day3.phase && d.path === day3.path);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("link")).toHaveLength(phaseDays.length);
    expect(within(list).getByRole("link", { current: "page" }).textContent).toContain("Numbers and operators");
    expect(screen.getByText(`1 of ${phaseDays.length} days complete`)).toBeTruthy();
  });

  it("never scrolls the page itself when it opens (it used to jump the page down on laptop widths)", () => {
    let calls = 0;
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => { calls++; };
    try { wrap(<DayList day={day3} view={view({ days: {} })} />); } finally { Element.prototype.scrollIntoView = orig; }
    expect(calls).toBe(0);
  });

  it("the rail shows time, concepts, unfinished prerequisites and the page's headings", () => {
    wrap(<LessonRail day={day3} view={view({ days: {} })} finished={2} total={6} headings={[{ id: "a", text: "Understand", level: 2 }, { id: "b", text: "Operators", level: 3 }]} />);
    expect(screen.getByText("about 2.2 h")).toBeTruthy();
    expect(screen.getByText("2 of 6 activities")).toBeTruthy();
    for (const t of day3.topics) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText("Not all finished yet")).toBeTruthy();
    const toc = screen.getByRole("region", { name: "On this page" });
    expect(within(toc).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["#a", "#b"]);
  });

  it("no prerequisites card when there are none", () => {
    const d1 = findDay("common", 1)!;
    wrap(<LessonRail day={d1} view={view({ days: {} })} finished={0} total={6} headings={[]} />);
    expect(screen.queryByText("Before this lesson")).toBeNull();
    expect(screen.queryByRole("region", { name: "On this page" })).toBeNull();
  });
});
