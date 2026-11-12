import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BusinessLab } from "../site/components/visual/BusinessLab";
import * as B from "../site/lib/visual/business";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
afterEach(cleanup);

const status = () => screen.getAllByRole("status").map((e) => e.textContent ?? "").join(" | ");
const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const end = () => fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });

describe("BusinessLab UI", () => {
  it("states plainly that the data is a fixed sample and the assumptions are the learner's", () => {
    render(<BusinessLab />);
    expect(screen.getAllByText(/fixed sample business/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not real data/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Simulated/i).length).toBeGreaterThan(0);
  });
  it("every preset opens on its tab", () => {
    for (const p of B.PRESETS) { const { unmount } = render(<BusinessLab preset={p.id} />); expect(screen.getByRole("tab", { selected: true }).textContent).toBe(B.TABS.find((t) => t.id === p.tab)!.label); unmount(); }
  });
  it("tabs work with the arrow keys", () => {
    render(<BusinessLab />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "KPIs" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Variance", selected: true })).toBeTruthy();
  });
  it("KPI tiles show the computed revenue with the change versus the previous period, and filters change them", () => {
    render(<BusinessLab preset="kpi" />);
    const k = B.kpis(B.periodMonths("quarter", 3)), p = B.kpis(B.periodMonths("quarter", 2));
    const tiles = screen.getByRole("list", { name: "KPI tiles" });
    expect(within(tiles).getByText(money(k.revenue))).toBeTruthy();
    expect(tiles.textContent).toMatch(/vs Q3 2025/);
    expect(tiles.textContent).toContain(`${k.revenue >= p.revenue ? "up" : "down"} ${(Math.abs((k.revenue - p.revenue) / p.revenue) * 100).toFixed(1)}%`);
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "Online" } });
    expect(within(screen.getByRole("list", { name: "KPI tiles" })).getByText(money(B.kpis(B.periodMonths("quarter", 3), { channel: "Online" }).revenue))).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "0" } });
    expect(screen.getByRole("list", { name: "KPI tiles" }).textContent).toMatch(/no earlier period/);
  });
  it("metric tree and revenue drivers reconcile on screen", () => {
    render(<BusinessLab preset="metric-tree" />);
    expect(screen.getByText(/visitors x conversion x average order value/)).toBeTruthy();
    expect(status()).toMatch(/difference 0\.000000/);
    const tbl = screen.getByRole("table", { name: "Revenue change drivers" }), d = B.revenueDrivers(B.kpis(B.periodMonths("quarter", 2)), B.kpis(B.periodMonths("quarter", 3)));
    expect(within(tbl).getByText("Actual revenue change").nextSibling!.textContent).toBe(`${d.total >= 0 ? "+" : "-"}${money(d.total).replace("-", "")}`);
  });
  it("variance waterfall: stepping to the end shows start + effects = actual with no unexplained remainder", () => {
    render(<BusinessLab preset="variance" />);
    end();
    const pvm = B.priceVolumeMix(B.BUDGET[3], B.actualLines(B.periodMonths("quarter", 3)));
    expect(status()).toContain(`= ${money(pvm.actual.revenue)}`);
    expect(status()).toMatch(/Unexplained remainder: 0\.000000/);
    expect(screen.getByRole("img", { name: new RegExp(`Waterfall from Budget ${money(pvm.base.revenue).replace("$", "\\$")}`) })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gross profit" }));
    end();
    expect(status()).toContain(`= ${money(pvm.actual.grossProfit)}`);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(status()).toMatch(/Price effect/);
  });
  it("price, volume and mix preset compares a quarter with the previous quarter", () => {
    render(<BusinessLab preset="price-volume-mix" />);
    expect(screen.getByRole("button", { name: "Quarter vs previous quarter", pressed: true })).toBeTruthy();
    end();
    expect(status()).toMatch(/Unexplained remainder: 0\.000000/);
  });
  it("cohort heatmap: selecting a cell shows its computation, equal to the table value", () => {
    render(<BusinessLab preset="cohort" />);
    const cell = B.cohortTable()[1];
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Feb cohort month 2: ${cell.active[2]} of ${cell.size}`) }));
    expect(screen.getByText(/Feb cohort, 2 months after the first order \(Apr\)/)).toBeTruthy();
    end();
    expect(status()).toContain(`${cell.active[2]} / ${cell.size} = ${(cell.rates[2]! * 100).toFixed(1)}%`);
    expect(screen.getByRole("table", { name: "Cohort retention heatmap" })).toBeTruthy();
  });
  it("funnel: step rates multiply to the overall rate, and the what-if changes purchases", () => {
    render(<BusinessLab preset="funnel" />);
    const c = B.funnelCounts(Array.from({ length: 12 }, (_, i) => i)), s = B.funnelSteps(c);
    expect(status()).toContain(`${(s[4].cumulative * 100).toFixed(2)}%`);
    fireEvent.change(screen.getByRole("slider", { name: /New step conversion/ }), { target: { value: String(Math.min(1, s[2].stepRate! * 1.5)) } });
    expect(status()).toMatch(/Purchases change from \d+ to [\d.]+ \(\+/);
  });
  it("RFM: thresholds, rules and a total that equals the customer count", () => {
    render(<BusinessLab preset="rfm" />);
    expect(screen.getByRole("table", { name: "Scoring thresholds" })).toBeTruthy();
    expect(screen.getByText(/R >= 3 and F >= 3 and M >= 3/)).toBeTruthy();
    const t = screen.getByRole("table", { name: "Segment summary" });
    expect(within(t).getByText("Total").nextSibling!.textContent).toBe(String(B.rfm().rows.length));
    fireEvent.click(within(t).getByRole("button", { name: "Champions" }));
    expect(screen.getByRole("table", { name: "Customer scores" }).textContent).toContain("Champions");
  });
  it("churn and LTV: the CAC assumption changes LTV to CAC and the verdict", () => {
    render(<BusinessLab preset="ltv" />);
    const l = B.lifetimeValue(B.SUBS, 60);
    expect(status()).toContain(`LTV to CAC ${l.ltvToCac!.toFixed(2)}`);
    fireEvent.change(screen.getByRole("slider", { name: /acquisition cost/ }), { target: { value: "300" } });
    expect(status()).toMatch(/costs more than they return/);
    expect(screen.getByRole("note").textContent).toMatch(/lifetime trap/);
  });
  it("pricing: the elasticity assumption flips the recommendation, and the assumptions panel is shown", () => {
    render(<BusinessLab preset="pricing" />);
    expect(screen.getByRole("note", { name: "Assumptions" }).textContent).toMatch(/not facts/);
    expect(status()).toMatch(/Recommendation: reject/);
    fireEvent.change(screen.getByRole("slider", { name: /^Discount/ }), { target: { value: "0.05" } });
    fireEvent.change(screen.getByRole("slider", { name: /Price elasticity/ }), { target: { value: "-4" } });
    expect(status()).toMatch(/Recommendation: adopt/);
    expect(status()).toMatch(/depends/);
    expect(screen.getByRole("table", { name: /Sensitivity of gross profit change/ })).toBeTruthy();
  });
  it("campaign ROI shows attributed versus incremental and a recommendation tied to the holdout assumption", () => {
    render(<BusinessLab preset="campaign-roi" />);
    const r = B.campaignScenario({ spend: 10000, reach: 50000, treatedRate: 0.03, baselineRate: 0.02, aov: 60, margin: 0.45 });
    const t = screen.getByRole("table", { name: "Campaign result" });
    expect(t.textContent).toContain(r.roasIncremental.toFixed(2)); expect(t.textContent).toContain(`${(r.roiIncremental * 100).toFixed(1)}%`);
    expect(status()).toMatch(/depends on the holdout baseline/);
    fireEvent.change(screen.getByRole("slider", { name: /no campaign/ }), { target: { value: "0.03" } });
    expect(status()).toMatch(/loses money/);
  });
  it("forecast: choosing a method reports MAE against the naive benchmark", () => {
    render(<BusinessLab preset="forecast" />);
    const sn = B.forecast(B.SERIES, "seasonal-naive");
    expect(status()).toContain(`MAE ${money(sn.mae)}`);
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "naive" } });
    expect(status()).toMatch(/This is the benchmark/);
  });
  it("every chart exposes its numbers as a text label", () => {
    render(<BusinessLab preset="cohort" />);
    for (const img of screen.getAllByRole("img")) expect(img.getAttribute("aria-label")!.length).toBeGreaterThan(20);
  });
});
