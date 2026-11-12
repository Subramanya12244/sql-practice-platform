import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StatsLab } from "../site/components/visual/StatsLab";
import * as S from "../site/lib/visual/stats";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
afterEach(cleanup);

const status = () => screen.getAllByRole("status").map((e) => e.textContent ?? "").join(" | ");
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next step" }));

describe("StatsLab UI", () => {
  it("opens on the preset's topic and states that simulations are seeded", () => {
    render(<StatsLab preset="bayes" />);
    expect(screen.getByRole("tab", { name: "Probability", selected: true })).toBeTruthy();
    const table = screen.getByRole("table", { name: /Natural frequency table/ });
    expect(within(table).getByText("90")).toBeTruthy(); // 10,000 x 1% x 90% true positives
    expect(within(table).getByText("495")).toBeTruthy();
    expect(screen.getByText(/Out of 585 people who test positive, only/)).toBeTruthy();
    expect(screen.getAllByText(/Simulated/i).length).toBeGreaterThan(0);
  });
  it("every preset id opens without crashing and lands on its own tab", () => {
    for (const p of S.PRESETS) { const { unmount } = render(<StatsLab preset={p.id} />); expect(screen.getByRole("tab", { selected: true }).textContent).toBe(S.TABS.find((t) => t.id === p.tab)!.label); unmount(); }
  });
  it("tabs are keyboard operable with arrow keys", () => {
    render(<StatsLab />);
    const first = screen.getByRole("tab", { name: "Distributions" });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Summary statistics", selected: true })).toBeTruthy();
  });
  it("outlier toggle moves the mean far more than the median, and says so", () => {
    render(<StatsLab preset="normal" />);
    const before = status();
    fireEvent.click(screen.getByLabelText(/Add an outlier/));
    const after = status();
    expect(after).not.toBe(before);
    expect(after).toMatch(/median is robust/);
    const mean = Number(/Mean (-?[\d.]+)/.exec(after)![1]), med = Number(/median (-?[\d.]+)/.exec(after)![1]);
    const base = S.describe(S.sampleData(S.makeDist("normal", { mu: 0, sigma: 1 }), 11, 2024));
    expect(mean - base.mean).toBeGreaterThan(0.4); expect(Math.abs(med - base.median)).toBeLessThan(mean - base.mean);
  });
  it("summary statistics: steps walk through the arithmetic, with n and n - 1 variance side by side", () => {
    render(<StatsLab preset="descriptive" />);
    expect(screen.getAllByText(/Step 1 of 8/).length).toBeGreaterThan(0);
    next(); expect(status()).toMatch(/mean = 31 \/ 6|sum = 31, count = 6/);
    const t = screen.getByRole("table", { name: "Population versus sample" }); const d = S.describe([2, 3, 3, 4, 8, 11]);
    expect(within(t).getByText(String(Math.round(d.varPop * 10000) / 10000))).toBeTruthy();
    expect(within(t).getByText(String(Math.round(d.varSample * 10000) / 10000))).toBeTruthy();
  });
  it("variance preset starts at the deviations step; bad input is reported, not guessed", () => {
    render(<StatsLab preset="variance" />);
    expect(status()).toMatch(/Deviations from the mean/);
    fireEvent.change(screen.getByLabelText(/Your data/), { target: { value: "1, 2, x, 4" } });
    expect(status()).toMatch(/Could not read: x/);
    fireEvent.change(screen.getByLabelText(/Your data/), { target: { value: "" } });
    expect(status()).toMatch(/Enter at least one number/);
  });
  it("law of large numbers: stepping to the last frame reaches 5000 trials with the simulated count", () => {
    render(<StatsLab preset="lln" />);
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });
    const sim = S.simulateEvent("coin", 5000, 2024).checkpoints.at(-1)!;
    expect(status()).toContain(`After 5000 trials: ${sim.hits} hits`);
    expect(status()).toMatch(/law of large numbers/);
  });
  it("one-sample t-test result equals the engine; stepping reveals the decision, and alpha changes it", () => {
    render(<StatsLab preset="t-test" />);
    const r = S.tTest1(S.parseNumbers("12.1, 9.8, 11.4, 13.2, 10.9, 12.7, 8.9, 14.1, 11.8, 10.2").values, 10, "two-sided");
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });
    const text = status();
    expect(text).toContain(`p-value = ${r.p < 0.0001 ? "< 0.0001" : String(Math.round(r.p * 10000) / 10000)}`);
    expect(text).toContain(r.p < 0.05 ? "reject H0" : "fail to reject H0");
    fireEvent.change(screen.getByRole("slider", { name: /Significance level alpha/ }), { target: { value: "0.2" } });
    expect(status()).toContain(r.p < 0.2 ? "reject H0" : "fail to reject H0");
  });
  it("Welch test reports fractional degrees of freedom; empty group is explained", () => {
    render(<StatsLab preset="welch" />);
    next(); next(); next();
    expect(status()).toMatch(/Welch-Satterthwaite degrees of freedom = \d+\.\d+/);
    fireEvent.change(screen.getByLabelText("Group B values"), { target: { value: "5" } });
    expect(status()).toMatch(/Each group needs at least 2 values/);
  });
  it("chi-square independence shows expected counts and warns when they are small", () => {
    render(<StatsLab preset="chi-square" />);
    expect(screen.getByRole("table", { name: "Expected counts" })).toBeTruthy();
    const inputs = screen.getAllByRole("spinbutton").filter((e) => /^Group \d, outcome/.test(e.getAttribute("aria-label") ?? ""));
    expect(inputs).toHaveLength(6);
    [[0, 1], [1, 2], [2, 1], [3, 2], [4, 1], [5, 2]].forEach(([i, v]) => fireEvent.change(inputs[i], { target: { value: String(v) } }));
    expect(screen.getByText(/below 5/)).toBeTruthy();
  });
  it("errors and power: Type I error is reported near alpha", () => {
    render(<StatsLab preset="errors-power" />);
    const e = S.errorSim({ delta: 1, sigma: 2, n: 25, alpha: 0.05, reps: 1000, seed: 2024 });
    expect(status()).toContain(`${Math.round(e.typeIRate * 1000) / 10}% of 1000 simulated tests rejected`);
    fireEvent.change(screen.getByRole("slider", { name: /True shift/ }), { target: { value: "0" } });
    expect(status()).toMatch(/power equals alpha/);
  });
  it("coverage: showing all 100 intervals reports the simulated count", () => {
    render(<StatsLab preset="coverage" />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 100" }));
    const sim = S.coverageSim({ pop: "normal", n: 10, conf: 0.95, reps: 100, seed: 2024, method: "t" });
    expect(status()).toContain(`All 100: ${sim.covered} cover it`);
    expect(screen.getByRole("img", { name: new RegExp(`100 confidence intervals.*${sim.covered} contain`) })).toBeTruthy();
  });
  it("sampling: the last frame shows 2000 means and the theoretical standard error", () => {
    render(<StatsLab preset="clt" />);
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });
    const res = S.samplingDistribution(S.makePopulation("skewed"), 30, 2000, 2024);
    expect(status()).toContain(`2000 sample means: standard error ${Math.round(res.empiricalSe * 1000) / 1000} against theory ${Math.round(res.theoreticalSe * 1000) / 1000}`);
  });
  it("regression: editing a point changes r; selecting an outlier compares with and without it; causation note appears", () => {
    render(<StatsLab preset="outlier-effect" />);
    const pts = S.relationPoints("outlier"), before = S.pearson(pts.map((p) => p.x), pts.map((p) => p.y));
    expect(status()).toContain(`r = ${Math.round(before * 1000) / 1000}`);
    fireEvent.click(screen.getAllByRole("button", { name: "Select" }).at(-1)!);
    expect(status()).toMatch(/Without point 16/);
    fireEvent.click(screen.getByRole("button", { name: "Delete point 16" }));
    expect(status()).not.toMatch(/Without point/);
    const after = S.ols(pts.slice(0, -1));
    expect(status()).toContain(`R squared = ${Math.round(after.r2 * 1000) / 1000}`);
    cleanup();
    render(<StatsLab preset="causation" />);
    expect(screen.getByRole("note").textContent).toMatch(/Correlation is not causation/);
    expect(screen.getByRole("note").textContent).toMatch(/temperature/);
  });
  it("points are focusable and move with the arrow keys", () => {
    render(<StatsLab preset="correlation" />);
    const dot = screen.getAllByRole("button").find((b) => /^Point 1:/.test(b.getAttribute("aria-label") ?? ""))!;
    const x0 = (screen.getByLabelText("Point 1 x") as HTMLInputElement).value;
    fireEvent.keyDown(dot, { key: "ArrowRight" });
    expect((screen.getByLabelText("Point 1 x") as HTMLInputElement).value).not.toBe(x0);
  });
  it("every chart has a text label", () => {
    render(<StatsLab preset="normal" />);
    for (const img of screen.getAllByRole("img")) expect(img.getAttribute("aria-label")!.length).toBeGreaterThan(10);
  });
});
