// @vitest-environment node
/**
 * Business Analytics Lab engine tests. The data is a fixed sample business; every test checks that derived figures reconcile
 * (parts sum to totals, a waterfall ends at the total, funnel rates multiply to the overall rate, cohort cells equal an
 * independent recount that does not share code with the implementation).
 */
import { describe, expect, it } from "vitest";
import * as B from "../site/lib/visual/business";

const TOL = 1e-6;
const ALL = Array.from({ length: 12 }, (_, i) => i);
const filters: B.Filter[] = [{}, { channel: "Online" }, { channel: "Store" }, { region: "North" }, { channel: "Online", region: "West" }];
const sumBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

describe("fixture", () => {
  it("is a stable, well-formed sample business", () => {
    expect(B.CUSTOMERS).toHaveLength(150);
    expect(new Set(B.ORDERS.map((o) => o.id)).size).toBe(B.ORDERS.length);
    const ids = new Set(B.CUSTOMERS.map((c) => c.id));
    for (const o of B.ORDERS) { expect(ids.has(o.customer)).toBe(true); expect(o.lines.length).toBeGreaterThan(0); expect(o.month).toBeGreaterThanOrEqual(0); expect(o.month).toBeLessThanOrEqual(11); expect(o.day).toBeGreaterThanOrEqual(0); expect(o.day).toBeLessThan(365); for (const l of o.lines) { expect(l.qty).toBeGreaterThan(0); expect(l.price).toBeGreaterThan(l.cost); } }
    // a customer's channel and region are fixed, so orders agree with the customer table
    const byId = new Map(B.CUSTOMERS.map((c) => [c.id, c]));
    for (const o of B.ORDERS) expect([o.channel, o.region]).toEqual([byId.get(o.customer)!.channel, byId.get(o.customer)!.region]);
    expect(B.ORDERS.length).toBeGreaterThan(400);
  });
});

describe("KPIs and the metric tree", () => {
  it("revenue equals an independent sum over flattened order lines; margin, AOV and conversion follow their definitions", () => {
    const flat = B.ORDERS.flatMap((o) => o.lines.map((l) => l.qty * l.price)), k = B.kpis(ALL);
    expect(k.revenue).toBeCloseTo(flat.reduce((a, b) => a + b, 0), 6);
    expect(k.orders).toBe(B.ORDERS.length); expect(k.aov).toBeCloseTo(k.revenue / k.orders, 9); expect(k.conversion).toBeCloseTo(k.orders / k.visitors, 12);
    expect(k.grossMargin).toBeCloseTo((k.revenue - k.cogs) / k.revenue, 12); expect(k.grossProfit).toBeCloseTo(k.revenue - k.cogs, 6);
  });
  it("parts sum to totals: months to the year, channels and regions to all", () => {
    const year = B.kpis(ALL);
    expect(sumBy(ALL, (m) => B.kpis([m]).revenue)).toBeCloseTo(year.revenue, 6);
    expect(sumBy(ALL, (m) => B.kpis([m]).orders)).toBe(year.orders);
    expect(sumBy(ALL, (m) => B.kpis([m]).visitors)).toBe(year.visitors);
    expect(sumBy([...B.CHANNELS], (c) => B.kpis(ALL, { channel: c }).revenue)).toBeCloseTo(year.revenue, 6);
    expect(sumBy([...B.REGIONS], (r) => B.kpis(ALL, { region: r }).orders)).toBe(year.orders);
    expect(sumBy([0, 1, 2, 3], (q) => B.kpis(B.periodMonths("quarter", q)).revenue)).toBeCloseTo(year.revenue, 6);
    let cells = 0; for (const c of B.CHANNELS) for (const r of B.REGIONS) cells += B.kpis(ALL, { channel: c, region: r }).visitors; expect(cells).toBe(year.visitors);
  });
  it("metric tree: visitors x conversion x AOV = revenue and revenue x margin = gross profit, for every slice", () => {
    for (const f of filters) for (const kind of ["month", "quarter"] as const) for (let i = 0; i < (kind === "month" ? 12 : 4); i++) expect(B.treeError(B.metricTree(B.kpis(B.periodMonths(kind, i), f)))).toBeLessThan(TOL);
  });
  it("revenue drivers (visitors, conversion, AOV) add exactly to the revenue change", () => {
    for (const f of filters) for (let m = 1; m < 12; m++) { const a = B.kpis([m - 1], f), b = B.kpis([m], f), d = B.revenueDrivers(a, b); expect(d.visitors + d.conversion + d.aov).toBeCloseTo(b.revenue - a.revenue, 6); expect(d.total).toBeCloseTo(b.revenue - a.revenue, 9); }
  });
  it("period-over-period: the first period has no comparison; others compare with the period before", () => {
    expect(B.kpiComparison("quarter", 0).previous).toBeNull(); expect(B.kpiComparison("quarter", 0).changes[0].change).toBeNull();
    const c = B.kpiComparison("quarter", 3), rev = c.changes.find((x) => x.key === "revenue")!;
    expect(rev.previous).toBeCloseTo(B.kpis(B.periodMonths("quarter", 2)).revenue, 9); expect(rev.change).toBeCloseTo(rev.current - rev.previous!, 9); expect(rev.pct).toBeCloseTo(rev.change! / rev.previous!, 12);
  });
});

describe("variance: price, volume and mix", () => {
  it("hand-worked example (a144 formulas): price 12, volume 0, mix -10, sum = 2", () => {
    const mk = (a: [number, number], b: [number, number], _c: [number, number]) => B.PRODUCT_IDS.map((p, i): B.ProdLine => ({ product: p, qty: i === 0 ? a[0] : i === 1 ? b[0] : 0, price: i === 0 ? a[1] : i === 1 ? b[1] : 1, cost: 0 }));
    const base = mk([10, 5], [20, 10], [0, 1]), act = mk([12, 6], [18, 10], [0, 1]), r = B.priceVolumeMix(base, act);
    expect(r.revenue.price).toBeCloseTo(12, 9); expect(r.revenue.volume).toBeCloseTo(0, 9); expect(r.revenue.mix).toBeCloseTo(-10, 9); expect(r.revenue.total).toBeCloseTo(2, 9); expect(r.revenue.check).toBeCloseTo(0, 9);
  });
  it("same prices and total units but a shift to the expensive product is a pure mix effect", () => {
    const L = (q: number[]): B.ProdLine[] => B.PRODUCT_IDS.map((p, i) => ({ product: p, qty: q[i], price: [100, 10, 1, 1][i], cost: 0 }));
    const r = B.priceVolumeMix(L([5, 10, 0, 0]), L([8, 7, 0, 0]));
    expect(r.revenue.price).toBeCloseTo(0, 9); expect(r.revenue.volume).toBeCloseTo(0, 9); expect(r.revenue.mix).toBeCloseTo(270, 9); expect(r.revenue.mix).toBeCloseTo(r.revenue.total, 9);
  });
  it("revenue and gross-profit effects reconcile to the total variance for every budget quarter, period pair and filter", () => {
    for (const f of filters) for (let q = 0; q < 4; q++) {
      const act = B.actualLines(B.periodMonths("quarter", q), f), pairs = [B.priceVolumeMix(B.BUDGET[q], act), ...(q ? [B.priceVolumeMix(B.actualLines(B.periodMonths("quarter", q - 1), f), act)] : [])];
      for (const r of pairs) {
        expect(r.revenue.price + r.revenue.volume + r.revenue.mix).toBeCloseTo(r.revenue.total, 6); expect(Math.abs(r.revenue.check)).toBeLessThan(TOL);
        expect(r.profit.price + r.profit.volume + r.profit.mix + r.profit.cost).toBeCloseTo(r.profit.total, 6); expect(Math.abs(r.profit.check)).toBeLessThan(TOL);
        expect(r.revenue.total).toBeCloseTo(r.actual.revenue - r.base.revenue, 6);
      }
    }
  });
  it("actual lines times price equal revenue from the orders", () => {
    for (let q = 0; q < 4; q++) { const lines = B.actualLines(B.periodMonths("quarter", q)); expect(sumBy(lines, (l) => l.qty * l.price)).toBeCloseTo(B.kpis(B.periodMonths("quarter", q)).revenue, 6); expect(sumBy(lines, (l) => l.qty * (l.price - l.cost))).toBeCloseTo(B.kpis(B.periodMonths("quarter", q)).grossProfit, 6); }
  });
  it("the waterfall starts at the base, ends at the actual total, and every bar chains from the previous one", () => {
    const r = B.priceVolumeMix(B.BUDGET[3], B.actualLines(B.periodMonths("quarter", 3)));
    const bars = B.waterfall("Budget", r.base.revenue, [["Price", r.revenue.price], ["Volume", r.revenue.volume], ["Mix", r.revenue.mix]], "Actual");
    expect(bars[0].value).toBeCloseTo(r.base.revenue, 9); expect(bars.at(-1)!.value).toBeCloseTo(r.actual.revenue, 6);
    for (let i = 1; i < bars.length - 1; i++) { expect(bars[i].start).toBeCloseTo(bars[i - 1].kind === "total" ? bars[i - 1].end : bars[i - 1].end, 9); expect(bars[i].end - bars[i].start).toBeCloseTo(bars[i].value, 9); expect(bars[i].kind).toBe(bars[i].value >= 0 ? "up" : "down"); }
    const gpBars = B.waterfall("Budget", r.base.grossProfit, [["Price", r.profit.price], ["Volume", r.profit.volume], ["Mix", r.profit.mix], ["Cost", r.profit.cost]], "Actual");
    expect(gpBars.at(-1)!.value).toBeCloseTo(r.actual.grossProfit, 6);
  });
  it("favourable and unfavourable follow the sign convention (a151)", () => {
    expect(B.isFavourable("revenue", 5)).toBe(true); expect(B.isFavourable("revenue", -5)).toBe(false); expect(B.isFavourable("cost", 5)).toBe(false); expect(B.isFavourable("cost", -5)).toBe(true);
  });
});

describe("cohort retention", () => {
  // Independent recount: group each customer's order months, then count by brute force. No shared helper with the implementation.
  const months = new Map<string, number[]>();
  for (const o of B.ORDERS) months.set(o.customer, [...(months.get(o.customer) ?? []), o.month]);
  const firstOf = (id: string) => months.get(id)!.reduce((a, b) => (b < a ? b : a), 99);
  it("every cell equals the independent recount; blanks sit exactly where cohort + age passes December", () => {
    const rows = B.cohortTable();
    for (const r of rows) {
      const members = [...months.keys()].filter((id) => firstOf(id) === r.cohort);
      expect(r.size).toBe(members.length);
      for (let k = 0; k < 12; k++) {
        if (r.cohort + k > 11) { expect(r.active[k]).toBeNull(); expect(r.rates[k]).toBeNull(); continue; }
        const want = members.filter((id) => months.get(id)!.includes(r.cohort + k)).length;
        expect(r.active[k]).toBe(want); expect(r.rates[k]).toBeCloseTo(want / members.length, 12);
      }
      expect(r.active[0]).toBe(r.size); expect(r.rates[0]).toBe(1);
    }
    expect(sumBy(rows, (r) => r.size)).toBe(months.size);
  });
  it("cohortCell shows the working for a cell and agrees with the table", () => {
    const rows = B.cohortTable();
    for (const [c, k] of [[0, 2], [2, 3], [5, 1]] as const) { const d = B.cohortCell(c, k); expect(d.members.length).toBe(rows[c].size); expect(d.returned.length).toBe(rows[c].active[k]); expect(d.rate).toBeCloseTo(rows[c].rates[k]!, 12); for (const id of d.returned) expect(months.get(id)!.includes(c + k)).toBe(true); }
    expect(B.cohortCell(11, 3).rate).toBeNull();
  });
  it("average retention by age only uses cohorts old enough to be observed", () => {
    const rows = B.cohortTable(), curve = B.retentionByAge(rows);
    expect(curve[0].rate).toBe(1); expect(curve[0].eligible).toBe(sumBy(rows, (r) => r.size));
    for (let i = 1; i < curve.length; i++) expect(curve[i].eligible).toBeLessThanOrEqual(curve[i - 1].eligible);
    const k = 4, el = rows.filter((r) => r.cohort + k <= 11 && r.size > 0); expect(curve[k].rate).toBeCloseTo(sumBy(el, (r) => r.active[k]!) / sumBy(el, (r) => r.size), 12);
  });
});

describe("funnel", () => {
  it("counts never increase down the funnel, and purchases equal the orders", () => {
    for (const f of filters) for (const months of [ALL, B.periodMonths("quarter", 1)]) { const c = B.funnelCounts(months, f); for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThanOrEqual(c[i - 1]); expect(c[4]).toBe(B.kpis(months, f).orders); expect(c[0]).toBe(B.kpis(months, f).visitors); }
  });
  it("step conversion rates multiply to the overall conversion; drop-offs add up", () => {
    for (const f of filters) {
      const c = B.funnelCounts(ALL, f), s = B.funnelSteps(c), product = s.slice(1).reduce((a, x) => a * x.stepRate!, 1);
      expect(product).toBeCloseTo(c[4] / c[0], 12); expect(s[4].cumulative).toBeCloseTo(B.kpis(ALL, f).conversion, 12);
      expect(sumBy(s.slice(1), (x) => x.dropped!)).toBe(c[0] - c[4]); for (const x of s.slice(1)) expect(x.dropped! / (c[s.indexOf(x) - 1])).toBeCloseTo(x.dropRate!, 12);
    }
  });
  it("what-if: an unchanged rate reproduces the funnel; a changed step scales everything downstream; revenue change = extra orders x AOV", () => {
    const c = B.funnelCounts(ALL), s = B.funnelSteps(c);
    const same = B.funnelWhatIf(c, 2, s[2].stepRate!, 100); c.forEach((v, i) => expect(same.counts[i]).toBeCloseTo(v, 9)); expect(same.deltaOrders).toBeCloseTo(0, 9);
    const up = B.funnelWhatIf(c, 2, s[2].stepRate! * 1.5, 80);
    expect(up.counts[1]).toBeCloseTo(c[1], 9); expect(up.counts[2]).toBeCloseTo(c[2] * 1.5, 9); expect(up.purchases).toBeCloseTo(c[4] * 1.5, 9);
    expect(up.deltaOrders).toBeCloseTo(c[4] * 0.5, 9); expect(up.deltaRevenue).toBeCloseTo(up.deltaOrders * 80, 9); expect(up.overall).toBeCloseTo(up.purchases / c[0], 12);
  });
});

describe("RFM", () => {
  it("NTILE matches SQL: group sizes differ by at most one and the first groups are larger", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `x${i}`), g = B.ntile(ids, ids.map((_, i) => 100 - i), 4), sizes = [1, 2, 3, 4].map((n) => [...g.values()].filter((v) => v === n).length);
    expect(sizes).toEqual([3, 3, 2, 2]); expect(g.get("x9")).toBe(1); expect(g.get("x0")).toBe(4); // lowest key lands in group 1
    const ties = B.ntile(["b", "a", "c", "d"], [1, 1, 1, 1], 2); expect([...ties.entries()].sort()).toEqual([["a", 1], ["b", 1], ["c", 2], ["d", 2]]); // tie-break by id is repeatable
  });
  it("R, F and M match an independent recount from the orders", () => {
    const { rows } = B.rfm(), by = new Map<string, B.Order[]>();
    for (const o of B.ORDERS) by.set(o.customer, [...(by.get(o.customer) ?? []), o]);
    expect(rows.length).toBe(by.size);
    for (const r of rows) { const os = by.get(r.customer)!; expect(r.frequency).toBe(os.length); expect(r.recencyDays).toBe(B.AS_OF_DAY - Math.max(...os.map((o) => o.day))); expect(r.monetary).toBeCloseTo(sumBy(os, (o) => sumBy(o.lines, (l) => l.qty * l.price)), 6); for (const s of [r.r, r.f, r.m]) { expect(s).toBeGreaterThanOrEqual(1); expect(s).toBeLessThanOrEqual(4); } }
  });
  it("score groups are quartile-sized and thresholds are ordered: score 4 is most recent and highest value", () => {
    const { rows, thresholds } = B.rfm();
    for (const m of ["R", "M"] as const) { const t = thresholds.filter((x) => x.measure === m).sort((a, b) => a.score - b.score); const sizes = t.map((x) => x.count); expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1); expect(sum(sizes)).toBe(rows.length); }
    const R = thresholds.filter((x) => x.measure === "R").sort((a, b) => a.score - b.score), M = thresholds.filter((x) => x.measure === "M").sort((a, b) => a.score - b.score);
    for (let i = 1; i < 4; i++) { expect(R[i].max).toBeLessThanOrEqual(R[i - 1].min); expect(M[i].min).toBeGreaterThanOrEqual(M[i - 1].max); }
    for (const r of rows) expect(B.FREQ_THRESHOLDS.find((t) => t.test(r.frequency))!.score).toBe(r.f);
  });
  it("segments partition the customers; revenue and shares add to the totals", () => {
    const { rows } = B.rfm(), seg = B.segmentSummary(rows), total = sumBy(B.ORDERS, (o) => sumBy(o.lines, (l) => l.qty * l.price));
    expect(sumBy(seg, (s) => s.customers)).toBe(rows.length); expect(sumBy(seg, (s) => s.revenue)).toBeCloseTo(total, 6); expect(sumBy(seg, (s) => s.share)).toBeCloseTo(1, 12); expect(sumBy(seg, (s) => s.orders)).toBe(B.ORDERS.length);
    expect(rows.every((r) => B.SEGMENT_RULES.some((s) => s.name === r.segment))).toBe(true);
    const champs = rows.filter((r) => r.segment === "Champions"); expect(champs.every((r) => r.r >= 3 && r.f >= 3 && r.m >= 3)).toBe(true);
    for (const s of seg) expect(s.aov).toBeCloseTo(s.orders ? s.revenue / s.orders : 0, 9);
  });
});
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("churn, retention and lifetime value", () => {
  it("active customers reconcile: active = previous active + started - lost; lost matches an independent count", () => {
    const t = B.churnTable();
    for (let m = 1; m < 12; m++) expect(t[m].active).toBe(t[m - 1].active + t[m].started - t[m].lost);
    expect(t[0].active).toBe(t[0].started);
    expect(sumBy(t, (r) => r.lost)).toBe(B.SUBS.filter((s) => s.end !== null).length);
    expect(sumBy(t, (r) => r.started)).toBe(B.SUBS.length);
    for (const r of t.slice(1)) expect(r.churn).toBeCloseTo(r.lost / r.atRisk, 12);
    // at-risk this month is the active count of last month
    for (let m = 1; m < 12; m++) expect(t[m].atRisk).toBe(t[m - 1].active);
  });
  it("survival by age: 100% at age 0, only observable subscribers counted, never increasing in a way that breaks counts", () => {
    const s = B.survivalByAge();
    expect(s[0].rate).toBe(1);
    for (const x of s) { expect(x.eligible).toBe(B.SUBS.filter((u) => u.start + x.age <= 11).length); expect(x.stillActive).toBeLessThanOrEqual(x.eligible); }
    for (let i = 1; i < s.length; i++) expect(s[i].eligible).toBeLessThan(s[i - 1].eligible + 1);
  });
  it("LTV = monthly gross profit / churn; naive tenure of churned customers is shorter than 1 / churn (the lifetime trap)", () => {
    const l = B.lifetimeValue(B.SUBS, 60), t = B.churnTable();
    expect(l.churn).toBeCloseTo(sumBy(t, (r) => r.lost) / sumBy(t, (r) => r.atRisk), 12);
    expect(l.expectedLifetime).toBeCloseTo(1 / l.churn, 12); expect(l.ltv).toBeCloseTo(B.SUB_PRICE * B.SUB_GROSS_MARGIN / l.churn, 9);
    expect(l.ltvToCac).toBeCloseTo(l.ltv / 60, 12); expect(l.paybackMonths).toBeCloseTo(60 / (B.SUB_PRICE * B.SUB_GROSS_MARGIN), 12);
    expect(l.naiveTenure).toBeLessThan(l.expectedLifetime);
    expect(B.lifetimeValue(B.SUBS).ltvToCac).toBeNull();
  });
});

describe("decision simulations", () => {
  const base: B.DiscountInput = { price: 100, cost: 70, units: 1000, discount: 0.1, elasticity: -1.5, borrowed: 0 };
  it("break-even rule d / (m - d) from a149: price 100, cost 70, 10% off needs +50% volume, and profit is then equal", () => {
    const r = B.discountScenario(base); expect(r.margin).toBeCloseTo(0.3, 12); expect(r.breakEvenVolumeRise).toBeCloseTo(0.5, 12);
    const direct = 1500 * (90 - 70); expect(direct).toBe(base.units * (100 - 70)); // 1500 units at a 20 margin earns what 1000 units at 30 did
    expect(r.baseProfit).toBe(30000); expect(r.newPrice).toBeCloseTo(90, 12);
  });
  it("closed-form break-even elasticity equals the numerical one, and profit is flat there", () => {
    for (const d of [0.05, 0.1, 0.2]) {
      const m = 0.3, r = B.discountScenario({ ...base, discount: d }), closed = Math.log(m / (m - d)) / Math.log(1 - d);
      expect(r.breakEvenElasticity!).toBeCloseTo(closed, 6);
      expect(B.discountScenario({ ...base, discount: d, elasticity: closed }).profitChange).toBeCloseTo(0, 4);
      expect(B.discountScenario({ ...base, discount: d, elasticity: closed - 0.5 }).profitChange).toBeGreaterThan(0); expect(B.discountScenario({ ...base, discount: d, elasticity: closed + 0.5 }).profitChange).toBeLessThan(0);
    }
  });
  it("profit and revenue are computed directly from units and prices; no discount means no change; discount >= margin never pays", () => {
    const r = B.discountScenario({ ...base, elasticity: -2 });
    expect(r.newProfit).toBeCloseTo(r.newUnits * (r.newPrice - 70), 9); expect(r.newRevenue).toBeCloseTo(r.newUnits * r.newPrice, 9); expect(r.profitChange).toBeCloseTo(r.newProfit - r.baseProfit, 9);
    expect(B.discountScenario({ ...base, discount: 0 }).profitChange).toBeCloseTo(0, 9);
    const hi = B.discountScenario({ ...base, discount: 0.3, elasticity: -4 }); expect(hi.breakEvenElasticity).toBeNull(); expect(hi.breakEvenVolumeRise).toBe(Infinity); expect(hi.profitChange).toBeLessThan(0);
  });
  it("borrowed demand reduces the benefit; the sensitivity grid agrees with direct scenarios", () => {
    expect(B.discountScenario({ ...base, elasticity: -3, borrowed: 0.5 }).profitChange).toBeLessThan(B.discountScenario({ ...base, elasticity: -3 }).profitChange);
    const g = B.discountSensitivity(base, [-1, -3], [0.1, 0.2]); expect(g[1].cells[0].profitChangePct).toBeCloseTo(B.discountScenario({ ...base, elasticity: -3, discount: 0.1 }).profitChangePct, 12);
    expect(g[1].cells[0].profitChangePct).toBeGreaterThan(g[0].cells[0].profitChangePct);
  });
  it("the discount recommendation flips with the elasticity assumption and says what it depends on", () => {
    const low = B.discountScenario({ ...base, elasticity: -0.5 }), small = { ...base, discount: 0.05, elasticity: -4 }, high = B.discountScenario(small);
    expect(B.discountRecommendation({ ...base, elasticity: -0.5 }, low).verdict).toBe("reject"); expect(B.discountRecommendation(small, high).verdict).toBe("adopt");
    expect(B.discountRecommendation({ ...base, elasticity: -4 }, B.discountScenario({ ...base, elasticity: -4 })).verdict).toBe("borderline"); // +1.6%: within 2% of break-even
    const t = B.discountRecommendation(base, B.discountScenario(base)).text; expect(t).toMatch(/depends/); expect(t).toMatch(/elasticity/); expect(t).toMatch(/experiment/);
  });
  it("campaign: ROAS, ROI, incrementality and break-even by hand", () => {
    const i: B.CampaignInput = { spend: 10000, reach: 50000, treatedRate: 0.03, baselineRate: 0.02, aov: 60, margin: 0.45 }, r = B.campaignScenario(i);
    expect(r.attributed).toBeCloseTo(1500, 9); expect(r.incremental).toBeCloseTo(500, 9); expect(r.attributedRevenue).toBeCloseTo(90000, 6); expect(r.incrementalRevenue).toBeCloseTo(30000, 6);
    expect(r.roasAttributed).toBeCloseTo(9, 9); expect(r.roasIncremental).toBeCloseTo(3, 9); expect(r.roiAttributed).toBeCloseTo((90000 * 0.45 - 10000) / 10000, 9); expect(r.roiIncremental).toBeCloseTo(0.35, 9);
    expect(r.cac).toBeCloseTo(20, 9); expect(r.breakEvenIncrementalRate).toBeCloseTo(10000 / (50000 * 60 * 0.45), 12);
    // at exactly the break-even incremental rate the incremental ROI is zero
    expect(B.campaignScenario({ ...i, baselineRate: 0.03 - r.breakEvenIncrementalRate }).roiIncremental).toBeCloseTo(0, 9);
    const none = B.campaignScenario({ ...i, baselineRate: 0.03 }); expect(none.incremental).toBe(0); expect(none.cac).toBeNull(); expect(none.roiIncremental).toBeCloseTo(-1, 12);
  });
  it("campaign: attributed ROI always exceeds incremental ROI when there is a baseline; sensitivity agrees; recommendation names its dependence", () => {
    const i: B.CampaignInput = { spend: 10000, reach: 50000, treatedRate: 0.03, baselineRate: 0.02, aov: 60, margin: 0.45 }, r = B.campaignScenario(i);
    expect(r.roiAttributed).toBeGreaterThan(r.roiIncremental);
    const g = B.campaignSensitivity(i, [0.01, 0.025], [0.25, 0.55]); expect(g[0].cells[1].roi).toBeCloseTo(B.campaignScenario({ ...i, baselineRate: 0.01, margin: 0.55 }).roiIncremental, 12); expect(g[0].cells[0].roi).toBeGreaterThan(g[1].cells[0].roi);
    const rec = B.campaignRecommendation(i, r); expect(rec.text).toMatch(/depends on the holdout baseline/); expect(rec.text).toMatch(/holdout/);
    expect(B.campaignRecommendation({ ...i, baselineRate: 0.029 }, B.campaignScenario({ ...i, baselineRate: 0.029 })).verdict).toBe("stop");
    expect(B.campaignRecommendation({ ...i, baselineRate: 0.01 }, B.campaignScenario({ ...i, baselineRate: 0.01 })).verdict).toBe("scale");
  });
});

describe("forecasting basics (a152)", () => {
  it("naive, moving average and seasonal naive with hand-checked errors", () => {
    const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];
    const n = B.forecast(s, "naive", 3); expect(n.forecast).toEqual([150, 150, 150]); expect(n.errors).toEqual([10, 20, 30]); expect(n.mae).toBeCloseTo(20, 12); expect(n.rmse).toBeCloseTo(Math.sqrt((100 + 400 + 900) / 3), 12); expect(n.mape).toBeCloseTo((10 / 160 + 20 / 170 + 30 / 180) / 3, 12);
    const m = B.forecast(s, "moving-average", 3, 3); expect(m.forecast).toEqual([140, 140, 140]);
    const sn = B.forecast(s, "seasonal-naive", 3); expect(sn.forecast).toEqual([40, 50, 60]); // training is months 1 to 15; the same months a year earlier are 4, 5 and 6
  });
  it("the forecast uses only training months: changing the holdout actuals does not change the forecast", () => {
    const a = B.forecast(B.SERIES, "moving-average", 6, 3), s2 = [...B.SERIES]; for (let i = 18; i < 24; i++) s2[i] = 1;
    expect(B.forecast(s2, "moving-average", 6, 3).forecast).toEqual(a.forecast);
  });
  it("seasonal naive beats naive on a seasonal series", () => { expect(B.forecast(B.SERIES, "seasonal-naive").mae).toBeLessThan(B.forecast(B.SERIES, "naive").mae); });
});

describe("presets", () => {
  it("unique ids, every tab covered, lookups work", () => {
    const ids = B.PRESETS.map((p) => p.id); expect(new Set(ids).size).toBe(ids.length);
    for (const t of B.TABS) expect(B.PRESETS.some((p) => p.tab === t.id)).toBe(true);
    for (const id of ["kpi", "metric-tree", "variance", "price-volume-mix", "cohort", "funnel", "rfm", "churn", "ltv", "pricing", "campaign-roi", "forecast"]) expect(B.presetById(id)).toBeDefined();
    expect(B.presetById("zzz")).toBeUndefined();
  });
});
