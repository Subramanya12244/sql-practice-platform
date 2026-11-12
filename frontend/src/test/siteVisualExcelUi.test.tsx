import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ExcelLab } from "../site/components/visual/ExcelLab";
import { SALES } from "../site/lib/visual/excel";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
afterEach(cleanup);

const cell = (a: string) => document.getElementById(`xl-${a}`) as HTMLElement;
/** The displayed value only (a recalculation badge is a separate element after it). */
const text = (a: string) => cell(a).firstChild?.textContent ?? "";
const click = (a: string) => fireEvent.click(cell(a));
const setBar = (v: string) => { const bar = screen.getByLabelText("Formula bar"); fireEvent.change(bar, { target: { value: v } }); fireEvent.keyDown(bar, { key: "Enter" }); };

describe("ExcelLab shell", () => {
  it("states plainly that it is a simulated subset, and lists what is unsupported", () => {
    render(<ExcelLab />);
    expect(screen.getAllByText("Simulated").length).toBeGreaterThan(0);
    expect(screen.getByText(/simulated subset of Excel for learning, not Excel itself/)).toBeInTheDocument();
    expect(screen.getByText("What this lab does not support")).toBeInTheDocument();
    expect(screen.getByText(/Dynamic arrays and spilling/)).toBeInTheDocument();
  });
  it("opens the view and example named by the preset prop", () => {
    render(<ExcelLab preset="pivot" />);
    expect(screen.getByRole("tab", { name: "PivotTable" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("table", { name: "PivotTable" })).toBeInTheDocument();
  });
  it("an unknown preset falls back to the formulas example", () => {
    render(<ExcelLab preset="nope" />);
    expect(screen.getByRole("button", { name: "Formulas and references" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("formulas view", () => {
  it("shows computed values, steps through a formula innermost first and marks precedents", () => {
    render(<ExcelLab />);
    expect(text("D2")).toBe("15");
    expect(text("D6")).toBe("96");
    click("E2");
    const steps = screen.getByRole("list", { name: "Evaluation steps" });
    const rows = within(steps).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("code")!.textContent)).toEqual(["D2", "D2>=20", 'IF(D2>=20,"Big","Small")']); // innermost first
    expect(rows[0].querySelector("code")!.textContent).toBe("D2");
    expect(rows[0]).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText(/evaluates to/).textContent).toContain("D2>=20");
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText(/Final result of E2/).textContent).toContain("Small");
    // precedents highlighted
    click("D2");
    expect(cell("B2").className).toContain("bg-accent-dim");
    expect(cell("C2").className).toContain("bg-accent-dim");
    expect(cell("A2").className).not.toContain("bg-accent-dim");
  });
  it("editing a cell recalculates its dependents and lists the recalculation order", () => {
    render(<ExcelLab />);
    click("B2");
    expect(screen.getByText(/recalculation order: /).textContent).toContain("D2");
    setBar("20");
    expect(text("D2")).toBe("30");
    expect(text("D6")).toBe("111");
    expect(text("B6")).toBe("24");
  });
  it("shows the error name with an explanation and IFERROR hides it", () => {
    render(<ExcelLab />);
    click("D8");
    expect(text("D8")).toBe("#DIV/0!");
    expect(screen.getByRole("alert").textContent).toContain("divided by zero");
    expect(text("E8")).toBe("no qty");
  });
  it("reports a circular reference without hanging", () => {
    render(<ExcelLab />);
    click("H3");
    setBar("=H3+1");
    expect(text("H3")).toBe("#CIRC!");
    expect(screen.getAllByRole("alert").some((a) => /Circular reference involving H3/.test(a.textContent ?? ""))).toBe(true);
  });
  it("copies a formula so relative references move and absolute ones stay", () => {
    render(<ExcelLab />);
    click("F2");
    fireEvent.change(screen.getByLabelText("Copy formula to"), { target: { value: "F9" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByText(/Copied F2 to F9: =D9\*\(1\+\$H\$1\)/)).toBeInTheDocument();
    click("F9");
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("=D9*(1+$H$1)");
  });
  it("a syntax error is explained", () => {
    render(<ExcelLab />);
    click("H3");
    setBar("=1+");
    expect(text("H3")).toBe("#SYNTAX!");
    expect(screen.getAllByRole("alert").some((a) => /Excel would refuse this formula/.test(a.textContent ?? ""))).toBe(true);
  });
  it("arrow keys move the selection and Enter moves focus to the formula bar", () => {
    render(<ExcelLab />);
    click("A1");
    fireEvent.keyDown(screen.getByRole("grid", { name: "Sheet" }), { key: "ArrowRight" });
    expect((screen.getByLabelText("Selected cell") as HTMLInputElement).value).toBe("B1");
    fireEvent.keyDown(screen.getByRole("grid", { name: "Sheet" }), { key: "ArrowDown" });
    expect((screen.getByLabelText("Selected cell") as HTMLInputElement).value).toBe("B2");
    expect(cell("B2")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("grid", { name: "Sheet" }), { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText("Formula bar"));
  });
});

describe("lookup demonstration", () => {
  it("walks the keys of an exact lookup that misses, then explains #N/A", () => {
    render(<ExcelLab preset="lookups" />);
    click("F3");
    const demo = screen.getByRole("region", { name: "Lookup demonstration" });
    expect(within(demo).getByText(/Exact match: scans from the top/)).toBeInTheDocument();
    const keys = within(within(demo).getByRole("list", { name: "Keys scanned" })).getAllByRole("listitem");
    expect(keys).toHaveLength(5);
    fireEvent.keyDown(within(demo).getByRole("group", { name: "Playback controls" }), { key: "End" });
    expect(demo.textContent).toContain("Result: #N/A");
    expect(demo.textContent).toContain("Keys read: 5 of 5");
  });
  it("shows the approximate match as a binary search that reads fewer keys than rows", () => {
    render(<ExcelLab preset="lookups" />);
    click("F8");
    const demo = screen.getByRole("region", { name: "Lookup demonstration" });
    expect(within(demo).getByText(/binary search/)).toBeInTheDocument();
    fireEvent.keyDown(within(demo).getByRole("group", { name: "Playback controls" }), { key: "End" });
    expect(demo.textContent).toContain("Result: C");
    expect(demo.textContent).toMatch(/Keys read: [12] of 5/);
  });
  it("shows the exact match stopping at the first hit", () => {
    render(<ExcelLab preset="lookups" />);
    click("F2");
    const demo = screen.getByRole("region", { name: "Lookup demonstration" });
    fireEvent.keyDown(within(demo).getByRole("group", { name: "Playback controls" }), { key: "End" });
    expect(demo.textContent).toContain("Keys read: 3 of 5");
    expect(demo.textContent).toContain("Result: 45");
  });
});

describe("pivot view", () => {
  const num = (name: RegExp) => Number(screen.getByRole("button", { name }).textContent);
  it("shows totals and the source rows behind a clicked cell", () => {
    render(<ExcelLab preset="pivot" />);
    const grand = screen.getByRole("button", { name: /All rows by all columns/ });
    expect(Number(grand.textContent)).toBe(SALES.reduce((a, r) => a + r.Amount, 0));
    fireEvent.click(screen.getByRole("button", { name: /^Book by East/ }));
    const src = screen.getByRole("table", { name: "Rows behind the selected pivot cell" });
    const n = within(src).getAllByRole("row").length - 1;
    expect(screen.getByText(/source rows? feed this cell/).textContent).toContain(`${n} source`);
    expect(n).toBe(SALES.filter((r) => r.Product === "Book" && r.Region === "East").length);
    expect(n).toBe(2);
    const amounts = within(src).getAllByRole("row").slice(1).map((r) => Number(r.lastElementChild!.textContent));
    expect(amounts.reduce((x, y) => x + y, 0)).toBe(120);
  });
  it("changes the aggregation and keeps the grand total honest", () => {
    render(<ExcelLab preset="pivot" />);
    fireEvent.change(screen.getByLabelText("Summarize by"), { target: { value: "count" } });
    expect(num(/All rows by all columns/)).toBe(SALES.length);
    fireEvent.change(screen.getByLabelText("Summarize by"), { target: { value: "max" } });
    expect(num(/All rows by all columns/)).toBe(100);
  });
  it("filters rows out", () => {
    render(<ExcelLab preset="pivot" />);
    fireEvent.click(screen.getByText(/Filters \(/));
    const region = screen.getByText("Region", { selector: "legend" }).closest("fieldset")!;
    fireEvent.click(within(region).getByLabelText("North"));
    expect(screen.queryByRole("columnheader", { name: "North" })).toBeNull();
    expect(screen.getByText(/Filters \(6 of 18 rows hidden\)/)).toBeInTheDocument();
  });
  it("moving a field to Rows with no Columns still totals", () => {
    render(<ExcelLab preset="pivot" />);
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "" } });
    expect(screen.queryByRole("columnheader", { name: "Grand Total" })).toBeNull();
    expect(num(/All rows by .*: 920$/)).toBe(920);
    expect(num(/^Book by .*/)).toBe(SALES.filter((r) => r.Product === "Book").reduce((a, r) => a + r.Amount, 0));
  });
});

describe("conditional formatting view", () => {
  const marked = () => Array.from(document.querySelectorAll("td[role=gridcell]")).filter((td) => td.className.includes("bg-warn-dim")).map((td) => td.id.replace("xl-", ""));
  it("greater than highlights only matching cells", () => {
    render(<ExcelLab preset="conditional-format" />);
    expect(marked().sort()).toEqual(["C11", "C3", "C7"]);
    expect(screen.getByText(/3 of 10 cells in C2:C11 formatted/)).toBeInTheDocument();
  });
  it("switches rule and range", () => {
    render(<ExcelLab preset="conditional-format" />);
    fireEvent.change(screen.getByLabelText("Rule type"), { target: { value: "duplicates" } });
    expect(marked().sort()).toEqual(["C4", "C5", "C6", "C8"]);
    fireEvent.change(screen.getByLabelText("Range"), { target: { value: "A2:A11" } });
    expect(marked()).toHaveLength(8);
    fireEvent.change(screen.getByLabelText("Rule type"), { target: { value: "contains" } });
    expect(marked().sort()).toEqual(["A10", "A3", "A4", "A9"]);
  });
  it("top N includes ties and a colour scale shades every number", () => {
    render(<ExcelLab preset="conditional-format" />);
    fireEvent.change(screen.getByLabelText("Rule type"), { target: { value: "top" } });
    fireEvent.change(screen.getByLabelText("N"), { target: { value: "5" } });
    expect(marked()).toHaveLength(6);
    fireEvent.change(screen.getByLabelText("Rule type"), { target: { value: "scale" } });
    const shaded = Array.from(document.querySelectorAll("td[role=gridcell]")).filter((td) => (td as HTMLElement).style.backgroundColor);
    expect(shaded).toHaveLength(10);
  });
});

describe("data cleaning view", () => {
  const afterCells = () => within(screen.getByRole("table", { name: "After cleaning" }));
  it("applies TRIM then PROPER and shows before and after", () => {
    render(<ExcelLab preset="cleaning" />);
    expect(within(screen.getByRole("table", { name: "Before cleaning" })).getByText('"  ada   lovelace "', { normalizer: (t) => t })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TRIM" }));
    expect(afterCells().getByText('"ada lovelace"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PROPER" }));
    expect(afterCells().getAllByText('"Ada Lovelace"')).toHaveLength(2); // rows 1 and 4 now look identical
    expect(screen.getByRole("region", { name: "Applied steps" }).textContent).toContain("=PROPER(A2)");
    expect(screen.getByText(/extra spaces 6/).textContent).toContain("extra spaces 6 \u2192 2");
  });
  it("converts text numbers, removes duplicates after cleaning, and undo/reset work", () => {
    render(<ExcelLab preset="cleaning" />);
    for (const c of ["Name", "City"]) { fireEvent.change(screen.getByLabelText("Column"), { target: { value: c } }); fireEvent.click(screen.getByRole("button", { name: "TRIM" })); fireEvent.click(screen.getByRole("button", { name: "PROPER" })); }
    fireEvent.click(screen.getByRole("button", { name: "Remove duplicates" }));
    expect(screen.getByText("After (4 rows)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("After (6 rows)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "Amount" } });
    fireEvent.click(screen.getByRole("button", { name: "TRIM" }));
    fireEvent.click(screen.getByRole("button", { name: "VALUE" }));
    expect(afterCells().getByText("980")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("No steps yet.")).toBeInTheDocument();
  });
  it("text to columns adds columns", () => {
    render(<ExcelLab preset="cleaning" />);
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "Full name" } });
    fireEvent.click(screen.getByRole("button", { name: "Text to columns" }));
    expect(afterCells().getByText("Full name 1")).toBeInTheDocument();
    expect(afterCells().getAllByText('"Lovelace"').length).toBeGreaterThan(0);
  });
});
