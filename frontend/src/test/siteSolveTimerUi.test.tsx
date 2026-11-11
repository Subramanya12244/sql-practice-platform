import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { SolveTimer } from "../site/components/SolveTimer";
import { SessionHistory } from "../site/components/SessionHistory";
import { getProgress, recordSession, replaceProgress } from "../site/lib/progress";
import { getActive, noteAttempt, noteExecution, type SolveSession } from "../site/lib/solveSessions";

const META = { kind: "sql" as const, ref: "sql:25", difficulty: "Easy", topic: "joins" };
const T0 = Date.parse("2026-11-11T10:00:00Z");

beforeEach(() => {
  localStorage.clear();
  replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(T0);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("SolveTimer (module)", () => {
  it("renders nothing on the server, so hydration cannot mismatch", () => {
    expect(renderToString(<SolveTimer meta={META} />)).toBe("");
  });

  it("starts by itself, counts up, and shows the target", () => {
    render(<SolveTimer meta={META} />);
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");
    tick(5000);
    expect(screen.getByRole("timer")).toHaveTextContent("00:05");
    expect(screen.getByText(/04:55 left/)).toBeInTheDocument(); // Easy default 5 min, 5 s used
  });

  it("pause stops the clock, resume continues, controls are labelled", () => {
    render(<SolveTimer meta={META} />);
    tick(4000);
    fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
    tick(60_000);
    expect(screen.getByRole("timer")).toHaveTextContent("00:04");
    expect(screen.getByText("Paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume timer" }));
    tick(3000);
    expect(screen.getByRole("timer")).toHaveTextContent("00:07");
  });

  it("a remount (refresh, strict mode) resumes the same session instead of adding one", () => {
    const first = render(<SolveTimer meta={META} />);
    tick(3000);
    const id = getActive("sql:25")!.id;
    first.unmount();
    render(<SolveTimer meta={META} />);
    expect(getActive("sql:25")!.id).toBe(id);
    expect(Object.keys(JSON.parse(localStorage.getItem("sqlp.solve.active")!))).toHaveLength(1);
  });

  it("Finish asks first, then records an abandoned session and offers a new attempt", () => {
    render(<SolveTimer meta={META} />);
    noteExecution("sql:25");
    fireEvent.click(screen.getByRole("button", { name: "Finish session without solving" }));
    expect(screen.getByText(/End without solving/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(getProgress().sessions ?? []).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Finish session without solving" }));
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    expect(getProgress().sessions![0].status).toBe("abandoned");
    expect(screen.getByRole("status")).toHaveTextContent(/not solved/);
    fireEvent.click(screen.getByRole("button", { name: /New attempt/ }));
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");
    expect(getProgress().sessions).toHaveLength(1); // history kept
  });

  it("a validated solve shows 'Solved in' and never comes from clicking Finish", () => {
    render(<SolveTimer meta={META} />);
    tick(7000);
    act(() => { noteAttempt("sql:25", true, Date.now(), recordSession); });
    expect(screen.getByRole("status")).toHaveTextContent(/Solved in 7 s/);
    expect(getProgress().sessions![0].status).toBe("solved");
  });

  it("the Python timer is separate from the SQL one", () => {
    render(<><SolveTimer meta={META} /><SolveTimer meta={{ kind: "python", ref: "py:cart-line-total", difficulty: "Hard", topic: "etl" }} /></>);
    expect(Object.keys(JSON.parse(localStorage.getItem("sqlp.solve.active")!)).sort()).toEqual(["py:cart-line-total", "sql:25"]);
    expect(screen.getAllByRole("group", { name: /solve timer/ })).toHaveLength(2);
    expect(screen.getByText(/25:00 left/)).toBeInTheDocument(); // Hard default on the Python one
  });
});

describe("target time picker (module)", () => {
  const pick = (min: number) => fireEvent.change(screen.getByLabelText("Target time for this challenge"), { target: { value: String(min) } });

  it("offers 5, 10, 15, 20, 30 minutes and none, with the difficulty default selected", () => {
    render(<SolveTimer meta={{ ...META, difficulty: "Medium" }} />);
    const select = screen.getByLabelText("Target time for this challenge") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["None", "5 min", "10 min", "12 min", "15 min", "20 min", "30 min"]);
    expect(select.value).toBe("12");
  });

  it("choosing 10 minutes changes the countdown and is stored on the session", () => {
    render(<SolveTimer meta={META} />);
    pick(10);
    expect(screen.getByText(/10:00 left/)).toBeInTheDocument();
    expect(getActive("sql:25")!.targetSec).toBe(600);
    tick(30_000);
    expect(screen.getByText(/09:30 left/)).toBeInTheDocument();
  });

  it("going past the goal says so, without stopping the timer", () => {
    render(<SolveTimer meta={META} />);
    pick(5);
    tick(5 * 60_000 + 20_000);
    expect(screen.getByText(/\+00:20 over/)).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("05:20");
  });

  it("'None' removes the goal", () => {
    render(<SolveTimer meta={META} />);
    pick(0);
    expect(screen.queryByText(/left|over/)).not.toBeInTheDocument();
    expect(getActive("sql:25")!.targetSec).toBe(0);
  });

  it("the choice is remembered for the next challenge, SQL or Python", () => {
    const first = render(<SolveTimer meta={META} />);
    pick(15);
    first.unmount();
    render(<SolveTimer meta={{ kind: "python", ref: "py:cart-line-total", difficulty: "Hard", topic: "etl" }} />);
    expect(screen.getByText(/15:00 left/)).toBeInTheDocument();
    expect(getActive("py:cart-line-total")!.targetSec).toBe(900);
  });
});

describe("SessionHistory (module)", () => {
  const s = (id: string, status: SolveSession["status"], sec: number, day: string): SolveSession => ({
    id, kind: "sql", ref: "sql:25", startedAt: `${day}T10:00:00Z`, endedAt: `${day}T10:10:00Z`, activeSec: sec, attempts: 2, executions: 5, hints: status === "solved" ? 0 : 3, status, difficulty: "Easy", topic: "joins",
  });
  it("shows an explanatory empty state", () => {
    render(<SessionHistory sessionRef="sql:25" />);
    expect(screen.getByText(/No finished sessions yet/)).toBeInTheDocument();
  });
  it("lists every session newest first, keeps earlier successes, other challenges excluded", () => {
    replaceProgress({ ...getProgress(), sessions: [s("a", "solved", 125, "2026-11-01"), s("b", "abandoned", 40, "2026-11-05"), { ...s("c", "solved", 9, "2026-11-06"), ref: "sql:99" }] });
    render(<SessionHistory sessionRef="sql:25" />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/40 s/); // newest (abandoned) first
    expect(rows[0]).toHaveTextContent(/Not solved/);
    expect(rows[1]).toHaveTextContent(/2 min/);
    expect(rows[1]).toHaveTextContent(/Solved/);
    expect(screen.getByText(/2 sessions · 1 solved/)).toBeInTheDocument();
  });
});
