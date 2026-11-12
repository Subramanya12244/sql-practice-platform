import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InterviewLab } from "../site/components/visual/InterviewLab";
import { CATEGORY_LABEL, QUESTIONS, questionById } from "../site/lib/visual/interview";

const KEY = "sqlp.visual.interview.ui";
const mount = (preset?: string) => render(<MemoryRouter><InterviewLab preset={preset} /></MemoryRouter>);
const stage = () => screen.getByTestId("interview-stage").textContent;
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next stage" }));
const pickStage = (name: string) => fireEvent.click(screen.getByRole("button", { name: name }));

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Interview Walkthrough", () => {
  it("opens on the first question at the Question stage and labels itself as a worked example, not a run", () => {
    mount();
    expect(screen.getByRole("heading", { level: 2, name: QUESTIONS[0].title })).toBeInTheDocument();
    expect(stage()).toBe("Stage 1 of 6: Question");
    expect(screen.getByText("Conceptual model")).toBeInTheDocument();
    expect(screen.getByText(/runs nothing and stores nothing about you/)).toBeInTheDocument();
    expect(screen.getByText(QUESTIONS[0].clarify[0])).toBeInTheDocument();
    expect(screen.getByText(/Questions you could ask the interviewer/)).toBeInTheDocument();
  });

  it("a preset id opens that question; an unknown preset is ignored", () => {
    mount("py-two-sum");
    expect(screen.getByRole("heading", { level: 2, name: questionById("py-two-sum")!.title })).toBeInTheDocument();
    cleanup();
    localStorage.clear();
    mount("nope");
    expect(screen.getByRole("heading", { level: 2, name: QUESTIONS[0].title })).toBeInTheDocument();
  });

  it("hints are revealed one at a time and never all at once", () => {
    const q = questionById("sql-dedupe-latest")!;
    mount("sql-dedupe-latest");
    pickStage("Hints");
    expect(stage()).toBe("Stage 2 of 6: Hints");
    expect(screen.queryByText(q.hints[0])).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reveal hint 1" }));
    expect(screen.getByText(q.hints[0])).toBeInTheDocument();
    expect(screen.queryByText(q.hints[1])).toBeNull();
    expect(screen.getByText(/1 of 3 shown/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal hint 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Reveal hint 3" }));
    expect(within(screen.getByRole("list", { name: "Revealed hints" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "No more hints" })).toBeDisabled();
    // the answer is not on the page just because hints are open
    expect(screen.queryByText(/ROW_NUMBER\(\) OVER/)).toBeNull();
  });

  it("the example answer appears only on request and is labelled 'one good answer, not the only one'", () => {
    const q = questionById("sql-top-n-ties")!;
    mount("sql-top-n-ties");
    pickStage("Example answer");
    expect(screen.queryByText(q.answer.text)).toBeNull();
    expect(screen.queryByText(/One good answer, not the only one/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the example answer" }));
    expect(screen.getByRole("note")).toHaveTextContent("One good answer, not the only one.");
    expect(screen.getByText(q.answer.text)).toBeInTheDocument();
    expect(screen.getByLabelText(`${q.answer.snippets[0].title}: code`)).toHaveTextContent("RANK() OVER");
    const result = screen.getByText(/Result \(checked on PostgreSQL\)/).parentElement!;
    expect(within(result).getAllByRole("row")).toHaveLength(1 + q.answer.snippets[0].expect.rows!.length);
    expect(screen.getByText("Common pitfalls")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SQL Query Cinema" })).toHaveAttribute("href", "/query-visualizer");
  });

  it("Python answers show their checked output; NULL cells are marked", () => {
    mount("py-first-unique");
    pickStage("Example answer");
    fireEvent.click(screen.getByRole("button", { name: "Show the example answer" }));
    expect(screen.getByLabelText("First unique character: output")).toHaveTextContent("0 2 -1");
    expect(screen.getByRole("link", { name: "Python Code Time Machine" })).toHaveAttribute("href", "/visual/python");
    cleanup();
    mount("sql-lag-mom");
    pickStage("Example answer");
    fireEvent.click(screen.getByRole("button", { name: "Show the example answer" }));
    expect(screen.getByText("NULL")).toBeInTheDocument();
  });

  it("follow-ups: each has its own hint and answer on request", () => {
    const q = questionById("sql-not-in-null")!;
    mount("sql-not-in-null");
    pickStage("Follow-ups");
    const [f1, f2] = q.followUps;
    expect(screen.getByText(f1.q)).toBeInTheDocument();
    expect(screen.queryByText(f1.hint)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show hint for follow-up 1" }));
    expect(screen.getByText(f1.hint)).toBeInTheDocument();
    expect(screen.queryByText(f1.answer)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show answer to follow-up 1" }));
    expect(screen.getByText(f1.answer)).toBeInTheDocument();
    expect(screen.queryByText(f2.hint)).toBeNull();
    expect(screen.queryByText(f2.answer)).toBeNull();
  });

  it("self-assessment counts ticks and gives different advice", () => {
    const q = questionById("py-two-sum")!;
    mount("py-two-sum");
    pickStage("Self-check");
    expect(screen.getAllByRole("checkbox")).toHaveLength(q.rubric.length);
    expect(screen.getByTestId("interview-score")).toHaveTextContent(`0 of ${q.rubric.length} ticked. Re-read the approach outline`);
    fireEvent.click(screen.getByLabelText(q.rubric[0]));
    fireEvent.click(screen.getByLabelText(q.rubric[1]));
    fireEvent.click(screen.getByLabelText(q.rubric[2]));
    expect(screen.getByTestId("interview-score")).toHaveTextContent("3 of 5 ticked. Good start");
    for (const r of q.rubric.slice(3)) fireEvent.click(screen.getByLabelText(r));
    expect(screen.getByTestId("interview-score")).toHaveTextContent("5 of 5 ticked. Strong");
  });

  it("the stepper moves with Next and Previous and announces the stage; the last stage cannot go further", () => {
    mount();
    expect(screen.getByRole("button", { name: "Previous stage" })).toBeDisabled();
    for (let i = 2; i <= 6; i++) { next(); expect(stage()).toMatch(`Stage ${i} of 6`); }
    expect(screen.getByRole("button", { name: "Next stage" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Self-check" })).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: "Previous stage" }));
    expect(stage()).toBe("Stage 5 of 6: Follow-ups");
  });

  it("changing topic and question resets the walk; question navigation respects the filter", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "stats" } });
    const stats = QUESTIONS.filter((q) => q.category === "stats");
    expect(screen.getByRole("heading", { level: 2, name: stats[0].title })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Question")).getAllByRole("option")).toHaveLength(stats.length);
    expect(screen.getByRole("button", { name: "Previous question" })).toBeDisabled();
    next();
    expect(stage()).toMatch("Stage 2");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByRole("heading", { level: 2, name: stats[1].title })).toBeInTheDocument();
    expect(stage()).toBe("Stage 1 of 6: Question");
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: stats[stats.length - 1].id } });
    expect(screen.getByRole("button", { name: "Next question" })).toBeDisabled();
    expect(within(screen.getByLabelText("Topic")).getByRole("option", { name: new RegExp(CATEGORY_LABEL.git) })).toBeInTheDocument();
  });

  it("keyboard: the stage buttons are focusable and Space or Enter activate them", () => {
    mount();
    const hints = screen.getByRole("button", { name: "Hints" });
    hints.focus();
    expect(document.activeElement).toBe(hints);
    fireEvent.click(hints); // a native button turns Enter and Space into a click
    expect(stage()).toBe("Stage 2 of 6: Hints");
  });

  it("remembers only the open question and topic, in localStorage, and survives it being blocked", () => {
    mount("etl-late-data");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ id: "etl-late-data", category: "all" });
    cleanup();
    mount();
    expect(screen.getByRole("heading", { level: 2, name: questionById("etl-late-data")!.title })).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).not.toMatch(/hint|answer|checked|score/i);
    cleanup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    mount();
    expect(screen.getByRole("heading", { level: 2, name: QUESTIONS[0].title })).toBeInTheDocument();
    next();
    expect(stage()).toMatch("Stage 2");
  });

  it("ignores corrupt stored state", () => {
    localStorage.setItem(KEY, "{not json");
    mount();
    expect(screen.getByRole("heading", { level: 2, name: QUESTIONS[0].title })).toBeInTheDocument();
    cleanup();
    localStorage.setItem(KEY, JSON.stringify({ id: "gone", category: "sql" }));
    mount();
    expect(screen.getByRole("heading", { level: 2, name: QUESTIONS[0].title })).toBeInTheDocument();
  });

  it("every question can be opened and walked to its example answer without error", () => {
    for (const q of QUESTIONS) {
      mount(q.id);
      expect(screen.getByRole("heading", { level: 2, name: q.title })).toBeInTheDocument();
      pickStage("Example answer");
      fireEvent.click(screen.getByRole("button", { name: "Show the example answer" }));
      expect(screen.getByText(q.answer.text)).toBeInTheDocument();
      if (q.link) expect(screen.getByRole("link", { name: q.link.label })).toHaveAttribute("href", q.link.to);
      cleanup();
    }
  });
});
