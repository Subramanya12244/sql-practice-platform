import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DifficultyBadge, StatusBadge } from "../components/Badges";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../components/Toast";
import { ThemeProvider } from "../contexts/ThemeContext";
import { ResultsPanel } from "../components/ResultsPanel";

describe("Badges", () => {
  it("renders difficulty", () => {
    render(<DifficultyBadge level="Advanced" />);
    expect(screen.getByText("Advanced")).toBeInTheDocument();
  });

  it("renders solved status", () => {
    render(<StatusBadge status="solved" />);
    expect(screen.getByText(/Solved/)).toBeInTheDocument();
  });
});

describe("ResultsPanel", () => {
  it("renders successful result table", () => {
    render(
      <ToastProvider>
        <ResultsPanel
          tabs={[
            {
              id: "1",
              title: "Result 1",
              sql: "SELECT 1",
              scope: "all",
              result: {
                success: true,
                execution_time_ms: 12,
                row_count: 2,
                columns: ["country", "cnt"],
                rows: [
                  ["USA", 10],
                  ["UK", 5],
                ],
                message: "Query executed successfully",
              },
            },
          ]}
          activeTabId="1"
          onSelectTab={() => {}}
          onCloseTab={() => {}}
        />
      </ToastProvider>,
    );
    expect(screen.getByText("USA")).toBeInTheDocument();
    expect(screen.getByText(/12 ms/)).toBeInTheDocument();
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
  });

  it("renders SQL error", () => {
    render(
      <ToastProvider>
        <ResultsPanel
          tabs={[
            {
              id: "1",
              title: "Result 1",
              sql: "SELECT",
              scope: "all",
              result: {
                success: false,
                columns: [],
                rows: [],
                error_type: "SQL_ERROR",
                message: 'syntax error at or near "FROM"',
              },
            },
          ]}
          activeTabId="1"
          onSelectTab={() => {}}
          onCloseTab={() => {}}
        />
      </ToastProvider>,
    );
    expect(screen.getByText(/syntax error/)).toBeInTheDocument();
  });

  it("renders submit feedback without revealing SQL", () => {
    render(
      <ToastProvider>
        <ResultsPanel
          tabs={[
            {
              id: "1",
              title: "Result 1",
              sql: "",
              scope: "all",
              result: null,
              submitResult: {
                correct: false,
                message:
                  "Your query runs successfully, but the result does not match the expected result.",
                feedback: ["Your query returned: 7 rows", "Expected result: 5 rows"],
                level_changed: false,
              },
            },
          ]}
          activeTabId="1"
          onSelectTab={() => {}}
          onCloseTab={() => {}}
        />
      </ToastProvider>,
    );
    expect(screen.getByText(/does not match/)).toBeInTheDocument();
    expect(screen.queryByText(/SELECT/i)).not.toBeInTheDocument();
  });
});

describe("API client shape", () => {
  it("builds question query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ questions: [], total: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../services/api");
    await api.getQuestions({ difficulty: "Advanced", search: "country" });
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("difficulty=Advanced");
    expect(url).toContain("search=country");
    vi.unstubAllGlobals();
  });
});

export function withProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ThemeProvider>
          <ToastProvider>{ui}</ToastProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
