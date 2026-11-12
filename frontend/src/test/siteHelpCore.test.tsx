import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GuidedTour from "../site/help/GuidedTour";
import { HelpProvider } from "../site/help/HelpProvider";
import { HelpButton } from "../site/help/HelpButton";
import { HELP_KEY, _resetHelpProgressCache, getHelpProgress, restartOnboarding, setOnboarding, setTourStatus, tourDone } from "../site/help/progress";
import { registerExampleListener, setPendingExample, takePendingExample } from "../site/help/exampleBridge";
import { ExampleBlock } from "../site/help/HelpPanel";
import { buildDocs, searchDocs } from "../site/help/search";
import type { HelpExample, HelpSection } from "../site/help/types";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;

beforeEach(() => { localStorage.clear(); _resetHelpProgressCache(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("HelpProgress", () => {
  it("remembers tours and onboarding, and can restart them", () => {
    expect(getHelpProgress().onboarding).toBeUndefined();
    setOnboarding("skipped");
    setTourStatus("sql-practice", "done");
    _resetHelpProgressCache();
    expect(getHelpProgress().onboarding).toBe("skipped");
    expect(tourDone(getHelpProgress(), "sql-practice")).toBe(true);
    restartOnboarding();
    expect(getHelpProgress().onboarding).toBeUndefined();
    expect(tourDone(getHelpProgress(), "sql-practice")).toBe(true);
  });
  it("survives corrupt or unavailable storage", () => {
    localStorage.setItem(HELP_KEY, "{not json");
    _resetHelpProgressCache();
    expect(getHelpProgress().tours).toEqual({});
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => setOnboarding("done")).not.toThrow();
    spy.mockRestore();
  });
});

const SECTION = (over: Partial<HelpSection> = {}): HelpSection => ({
  id: "demo", title: "Demo", blurb: "b", icon: "code", routes: ["/demo"], home: "/demo", keywords: ["demo", "thing", "x"],
  overview: { what: "w".repeat(30), why: "y".repeat(30), when: "n".repeat(30) }, canDo: ["a", "b", "c"], howTo: ["a", "b", "c"],
  controls: [{ name: "Run query", what: "Runs the SQL." }, { name: "Reset", what: "Puts the starter code back." }, { name: "Clear", what: "Empties the editor." }],
  mistakes: [{ mistake: "m1", fix: "f1" }, { mistake: "m2", fix: "f2" }], tips: ["t1", "t2"], related: [], recommendations: [], topics: [
    { id: "group-by", kind: "concept", title: "What does GROUP BY do?", body: "Collapses rows into groups, one row per group.", keywords: ["aggregate", "grouping"] },
    { id: "name-error", kind: "error", title: "NameError: name is not defined", body: "You used a variable before creating it.", keywords: ["nameerror"] },
    { id: "cursor", kind: "concept", title: "Cursor in API pagination", body: "A bookmark the server gives you for the next page.", keywords: ["pagination"] },
  ], ...over,
});
const DOCS = buildDocs([SECTION()], [{ id: "watermark", term: "Watermark", short: "The newest timestamp already loaded, so the next run only reads newer rows.", keywords: ["incremental"] }]);

describe("HelpSearch", () => {
  it("finds concepts, buttons, errors and terms", () => {
    expect(searchDocs(DOCS, "group by")[0].doc.title).toMatch(/GROUP BY/);
    expect(searchDocs(DOCS, "reset")[0].doc.category).toBe("buttons");
    expect(searchDocs(DOCS, "NameError")[0].doc.category).toBe("errors");
    expect(searchDocs(DOCS, "cursor")[0].doc.title).toMatch(/Cursor/);
    expect(searchDocs(DOCS, "watermark")[0].doc.category).toBe("concepts");
    expect(searchDocs(DOCS, "incremental")[0].doc.title).toBe("Watermark");
  });
  it("matches synonyms and prefixes, filters by category, and returns nothing for nonsense", () => {
    expect(searchDocs(DOCS, "bug").length).toBeGreaterThan(0);
    expect(searchDocs(DOCS, "pagin")[0].doc.title).toMatch(/Cursor/);
    expect(searchDocs(DOCS, "reset", { category: "errors" })).toEqual([]);
    expect(searchDocs(DOCS, "zzzqqq")).toEqual([]);
    expect(searchDocs(DOCS, "   ")).toEqual([]);
  });
});

describe("GuidedTour", () => {
  const tour = { id: "demo", title: "Demo tour", steps: [
    { id: "a", title: "Step A", body: "Body A", how: "Click it", target: "#a" },
    { id: "b", title: "Step B", body: "Body B", target: "#missing" },
    { id: "c", title: "Step C", body: "Body C", target: "#a" },
  ] };
  const setup = () => {
    document.body.innerHTML = '<button id="a">Target</button>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 100, left: 100, width: 80, height: 30, bottom: 130, right: 180, x: 100, y: 100, toJSON() {} });
    const onExit = vi.fn();
    render(<MemoryRouter><GuidedTour tour={tour} onExit={onExit} /></MemoryRouter>);
    return onExit;
  };
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

  it("walks Next / Previous with a progress indicator and finishes", async () => {
    const onExit = setup();
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("Step 1 of 3")).toBeInTheDocument();
    expect(within(dlg).getByText("Click it")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Step B")).toBeInTheDocument();
    expect(screen.getByText(/not on screen right now/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Step A")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onExit).toHaveBeenCalledWith("done");
  });
  it("Skip and Esc report skipped; arrows move between steps", async () => {
    const onExit = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByText("Step B")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(screen.getByText("Step A")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onExit).toHaveBeenCalledWith("skipped");
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onExit).toHaveBeenCalledTimes(2);
  });
  it("does not steal arrow keys while the learner types elsewhere", () => {
    const onExit = setup();
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(ta, { key: "Escape" });
    fireEvent.keyDown(ta, { key: "ArrowRight" });
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByText("Step A")).toBeInTheDocument();
  });
});

describe("GuidedTour across pages", () => {
  const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
  const tour = { id: "multi", title: "Multi", route: "/list", steps: [
    { id: "a", title: "On list", body: "x", target: "#here" },
    { id: "b", route: "/detail/1", title: "On detail", body: "y", target: "#nowhere" },
  ] };
  it("moves to the step's page when its element is not on screen, and tells the provider it did", async () => {
    document.body.innerHTML = '<div id="here">h</div>';
    const onNavigate = vi.fn();
    render(<MemoryRouter initialEntries={["/list"]}><Where /><GuidedTour tour={tour} onExit={() => {}} onNavigate={onNavigate} /></MemoryRouter>);
    expect(screen.getByTestId("where")).toHaveTextContent("/list");
    expect(onNavigate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/detail/1");
    expect(onNavigate).toHaveBeenCalledTimes(1);
    document.body.innerHTML = "";
  });
  it("does not move when the element is already visible on another page of the same kind", () => {
    document.body.innerHTML = '<div id="here">h</div>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 100, left: 10, width: 50, height: 20, bottom: 120, right: 60, x: 10, y: 100, toJSON() {} });
    const onNavigate = vi.fn();
    render(<MemoryRouter initialEntries={["/other"]}><Where /><GuidedTour tour={tour} onExit={() => {}} onNavigate={onNavigate} /></MemoryRouter>);
    expect(screen.getByTestId("where")).toHaveTextContent("/other");
    expect(onNavigate).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });
});

describe("Try Example", () => {
  const ex: HelpExample = { id: "e", title: "Demo", target: "sql", language: "sql", code: "SELECT 1", explains: "Shows one.", expected: "One row: 1", expectedRows: { columns: ["?column?"], rows: [[1]] } };
  const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

  it("loads straight into a clean editor", async () => {
    const load = vi.fn();
    const off = registerExampleListener({ kind: "sql", label: "the SQL editor", isDirty: () => false, load });
    wrap(<ExampleBlock ex={ex} onCloseOnMobile={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Try example/ }));
    expect(load).toHaveBeenCalledWith(ex);
    expect(screen.getByRole("status")).toHaveTextContent(/Loaded into the SQL editor/);
    off();
  });
  it("asks before replacing learner code, and Keep my code leaves it alone", async () => {
    const load = vi.fn();
    const off = registerExampleListener({ kind: "sql", label: "the SQL editor", isDirty: () => true, load });
    wrap(<ExampleBlock ex={ex} onCloseOnMobile={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Try example/ }));
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/replaces what is currently in the SQL editor/);
    await userEvent.click(screen.getByRole("button", { name: "Keep my code" }));
    expect(load).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Try example/ }));
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(load).toHaveBeenCalledTimes(1);
    off();
  });
  it("shows expected rows and offers Copy code; a pending example expires and is single-use", () => {
    wrap(<ExampleBlock ex={ex} onCloseOnMobile={() => {}} />);
    expect(screen.getByText("One row: 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy code/ })).toBeInTheDocument();
    setPendingExample(ex);
    expect(takePendingExample("python")).toBeNull();
    expect(takePendingExample("sql")).toEqual(ex);
    expect(takePendingExample("sql")).toBeNull();
    setPendingExample(ex);
    expect(takePendingExample("sql", -1)).toBeNull();
  });
});

describe("Help button, drawer and onboarding", () => {
  const app = (path = "/") => render(<MemoryRouter initialEntries={[path]}><HelpProvider><header><HelpButton /></header><main><input aria-label="field" /></main></HelpProvider></MemoryRouter>);

  it("opens the platform guide, closes on Esc and returns focus to the button", async () => {
    setOnboarding("done");
    app("/");
    const btn = screen.getByRole("button", { name: "Help" });
    btn.focus();
    await userEvent.click(btn);
    const dlg = await screen.findByRole("dialog", { name: /DataForge basics/i });
    expect(await within(dlg).findByText(/Overview/)).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(dlg, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /DataForge basics/i })).toBeNull());
    expect(btn).toHaveFocus();
  });
  it("? opens help outside a field but not while typing", async () => {
    setOnboarding("done");
    app("/");
    const field = screen.getByLabelText("field");
    field.focus();
    await userEvent.keyboard("?");
    expect(screen.queryByRole("dialog", { name: /DataForge basics/i })).toBeNull();
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard("?");
    expect(await screen.findByRole("dialog", { name: /DataForge basics/i })).toBeInTheDocument();
  });
  it("searches help and shows results", async () => {
    setOnboarding("done");
    app("/");
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    await screen.findByRole("dialog");
    const box = await screen.findByRole("searchbox", { name: "Search help" });
    await userEvent.type(box, "dark mode");
    const list = await screen.findByRole("list", { name: "Help search results" });
    expect(within(list).getAllByRole("button").length).toBeGreaterThan(0);
  });
  it("welcomes a first-time visitor once, lets them skip, and never again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = app("/");
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    const card = await screen.findByRole("dialog", { name: /Welcome to DataForge/ });
    await userEvent.click(within(card).getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "The main sections" })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog", { name: /Welcome/ })).toBeNull();
    expect(getHelpProgress().onboarding).toBe("skipped");
    unmount();
    app("/");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByRole("dialog", { name: /Welcome/ })).toBeNull();
  });
  it("does not welcome on the login page, nor a returning visitor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    app("/login");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByRole("dialog", { name: /Welcome/ })).toBeNull();
  });
});
