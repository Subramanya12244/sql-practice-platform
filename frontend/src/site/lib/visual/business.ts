/**
 * Business Analytics Lab engine. Pure and deterministic. Everything is computed from a FIXED SAMPLE business (a seeded
 * fixture of customers, orders, visitors and subscribers: not real data). Model assumptions in the decision simulations,
 * such as price elasticity, are inputs the learner can change; they are assumptions, not facts.
 * Terminology follows Daily Learning lessons a111, a140, a143 to a152.
 */
import { mulberry32 } from "./stats";

// ---------------------------------------------------------------------------------------------------------------------
// Fixture: the sample business
// ---------------------------------------------------------------------------------------------------------------------

export const PRODUCTS = [
  { id: "Laptop", list: 900, cost: 620 },
  { id: "Phone", list: 600, cost: 390 },
  { id: "Audio", list: 120, cost: 55 },
  { id: "Accessory", list: 25, cost: 9 },
] as const;
export type ProductId = (typeof PRODUCTS)[number]["id"];
export const PRODUCT_IDS = PRODUCTS.map((p) => p.id) as ProductId[];
export const REGIONS = ["North", "South", "East", "West"] as const;
export const CHANNELS = ["Online", "Store"] as const;
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_START = MONTH_DAYS.map((_, i) => MONTH_DAYS.slice(0, i).reduce((a, b) => a + b, 0));
/** The fixture's "today": the day after the last day of the year, used for recency. */
export const AS_OF_DAY = 365;

export interface Line { product: ProductId; qty: number; price: number; cost: number }
export interface Order { id: string; customer: string; month: number; day: number; channel: (typeof CHANNELS)[number]; region: (typeof REGIONS)[number]; lines: Line[] }
export interface Customer { id: string; region: (typeof REGIONS)[number]; channel: (typeof CHANNELS)[number] }

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Net unit price: list price, with a Phone price rise in H2 and a Laptop/Phone promotion in Nov and Dec. Realistic price movement for the variance view. */
const unitPrice = (p: (typeof PRODUCTS)[number], m: number) => r2(p.list * (m >= 6 && p.id === "Phone" ? 1.04 : 1) * (m >= 10 && (p.id === "Laptop" || p.id === "Phone") ? 0.92 : 1));
/** Unit cost drifts up 1.5% a quarter (supplier inflation). */
const unitCost = (p: (typeof PRODUCTS)[number], m: number) => r2(p.cost * (1 + 0.015 * Math.floor(m / 3)));

function build(): { customers: Customer[]; orders: Order[] } {
  const rng = mulberry32(4242), int = (n: number) => Math.floor(rng() * n);
  const customers: Customer[] = [], orders: Order[] = [];
  const weights: [ProductId, number][] = [["Laptop", 0.1], ["Phone", 0.22], ["Audio", 0.3], ["Accessory", 0.38]];
  const pickProduct = () => { let u = rng(); for (const [p, w] of weights) { if ((u -= w) < 0) return p; } return "Accessory" as ProductId; };
  let oid = 1;
  for (let c = 0; c < 150; c++) {
    const cust: Customer = { id: `C${String(c + 1).padStart(3, "0")}`, region: REGIONS[c % 4], channel: rng() < 0.6 ? "Online" : "Store" };
    customers.push(cust);
    const start = Math.min(11, Math.floor(Math.pow(rng(), 1.4) * 12)), lastMonth = rng() < 0.35 ? start + 1 + int(5) : 99, p = 0.25 + rng() * 0.35;
    for (let m = start; m <= Math.min(11, lastMonth); m++) {
      if (m !== start && rng() >= p) continue; // the first month always has the order that defines the cohort
      const lines: Line[] = [];
      for (let k = rng() < 0.35 ? 2 : 1; k > 0; k--) {
        const id = pickProduct(), prod = PRODUCTS.find((x) => x.id === id)!;
        const qty = id === "Audio" ? 1 + int(2) : id === "Accessory" ? 1 + int(4) : 1;
        const existing = lines.find((l) => l.product === id);
        if (existing) existing.qty += qty; else lines.push({ product: id, qty, price: unitPrice(prod, m), cost: unitCost(prod, m) });
      }
      orders.push({ id: `O${String(oid++).padStart(4, "0")}`, customer: cust.id, month: m, day: MONTH_START[m] + int(MONTH_DAYS[m]), channel: cust.channel, region: cust.region, lines });
    }
  }
  orders.sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  return { customers, orders };
}
const FIX = build();
export const CUSTOMERS: Customer[] = FIX.customers;
export const ORDERS: Order[] = FIX.orders;

/** Site visitors per month, channel and region: an input fixture (a formula with seasonality), not a result. */
export function visitorsFor(month: number, channel: (typeof CHANNELS)[number], region: (typeof REGIONS)[number]): number {
  const season = [0.9, 0.85, 0.95, 1, 1.02, 1, 0.97, 1, 1.05, 1.1, 1.3, 1.4][month];
  return Math.round((channel === "Online" ? 260 : 120) * season * (1 + 0.1 * REGIONS.indexOf(region)));
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. KPIs and the metric tree (a140, a143)
// ---------------------------------------------------------------------------------------------------------------------

export interface Filter { channel?: (typeof CHANNELS)[number]; region?: (typeof REGIONS)[number] }
export const orderRevenue = (o: Order) => o.lines.reduce((a, l) => a + l.qty * l.price, 0);
export const orderCogs = (o: Order) => o.lines.reduce((a, l) => a + l.qty * l.cost, 0);
const inFilter = (o: { channel: string; region: string }, f: Filter) => (!f.channel || o.channel === f.channel) && (!f.region || o.region === f.region);

export interface Kpis { visitors: number; orders: number; revenue: number; cogs: number; grossProfit: number; aov: number; grossMargin: number; conversion: number; unitsPerOrder: number }
export function kpis(months: number[], f: Filter = {}): Kpis {
  const set = new Set(months), os = ORDERS.filter((o) => set.has(o.month) && inFilter(o, f));
  let visitors = 0;
  for (const m of months) for (const c of CHANNELS) for (const r of REGIONS) if (inFilter({ channel: c, region: r }, f)) visitors += visitorsFor(m, c, r);
  const revenue = os.reduce((a, o) => a + orderRevenue(o), 0), cogs = os.reduce((a, o) => a + orderCogs(o), 0), units = os.reduce((a, o) => a + o.lines.reduce((x, l) => x + l.qty, 0), 0);
  return { visitors, orders: os.length, revenue, cogs, grossProfit: revenue - cogs, aov: os.length ? revenue / os.length : 0, grossMargin: revenue ? (revenue - cogs) / revenue : 0, conversion: visitors ? os.length / visitors : 0, unitsPerOrder: os.length ? units / os.length : 0 };
}

export type PeriodKind = "month" | "quarter";
export const periodMonths = (kind: PeriodKind, index: number) => (kind === "month" ? [index] : [index * 3, index * 3 + 1, index * 3 + 2]);
export const periodLabel = (kind: PeriodKind, index: number) => (kind === "month" ? `${MONTH_NAMES[index]} 2025` : `Q${index + 1} 2025`);

export interface KpiChange { key: keyof Kpis; current: number; previous: number | null; change: number | null; pct: number | null }
const KPI_KEYS: (keyof Kpis)[] = ["revenue", "orders", "aov", "grossMargin", "conversion", "visitors", "grossProfit"];
/** Period-over-period: the period is compared with the one right before it (no value for the first period). */
export function kpiComparison(kind: PeriodKind, index: number, f: Filter = {}): { current: Kpis; previous: Kpis | null; changes: KpiChange[] } {
  const current = kpis(periodMonths(kind, index), f), previous = index > 0 ? kpis(periodMonths(kind, index - 1), f) : null;
  return { current, previous, changes: KPI_KEYS.map((key) => ({ key, current: current[key], previous: previous ? previous[key] : null, change: previous ? current[key] - previous[key] : null, pct: previous && previous[key] ? (current[key] - previous[key]) / previous[key] : null })) };
}

export interface TreeNode { id: string; label: string; value: number; formula?: string; children?: TreeNode[] }
/** Revenue = visitors x conversion x AOV; gross profit = revenue x gross margin. Each parent is checked to equal the product of its children. */
export function metricTree(k: Kpis): TreeNode {
  return { id: "gp", label: "Gross profit", value: k.grossProfit, formula: "revenue x gross margin", children: [
    { id: "rev", label: "Revenue", value: k.revenue, formula: "visitors x conversion x average order value", children: [
      { id: "vis", label: "Visitors", value: k.visitors }, { id: "conv", label: "Conversion (orders / visitors)", value: k.conversion }, { id: "aov", label: "Average order value", value: k.aov }] },
    { id: "gm", label: "Gross margin", value: k.grossMargin, formula: "gross profit / revenue" }] };
}
/** Largest gap between a parent and the product of its children in the tree. Zero up to floating-point error. */
export function treeError(t: TreeNode): number {
  const rev = t.children![0], [v, c, a] = rev.children!, gm = t.children![1];
  return Math.max(Math.abs(v.value * c.value * a.value - rev.value), Math.abs(rev.value * gm.value - t.value));
}
/** Sequential substitution: how much of a revenue change came from visitors, conversion and AOV. The three effects add to the change exactly. */
export function revenueDrivers(prev: Kpis, cur: Kpis): { visitors: number; conversion: number; aov: number; total: number } {
  const visitors = (cur.visitors - prev.visitors) * prev.conversion * prev.aov;
  const conversion = cur.visitors * (cur.conversion - prev.conversion) * prev.aov;
  const aov = cur.visitors * cur.conversion * (cur.aov - prev.aov);
  return { visitors, conversion, aov, total: cur.revenue - prev.revenue };
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Variance: budget versus actual, price / volume / mix (a144, a151)
// ---------------------------------------------------------------------------------------------------------------------

export interface ProdLine { product: ProductId; qty: number; price: number; cost: number }

/** Plan for each quarter: units, standard price and standard cost per product. A fixed input, set before the year. */
export const BUDGET: Record<number, ProdLine[]> = {
  0: [{ product: "Laptop", qty: 18, price: 900, cost: 620 }, { product: "Phone", qty: 36, price: 600, cost: 390 }, { product: "Audio", qty: 60, price: 120, cost: 55 }, { product: "Accessory", qty: 90, price: 25, cost: 9 }],
  1: [{ product: "Laptop", qty: 16, price: 900, cost: 620 }, { product: "Phone", qty: 38, price: 600, cost: 390 }, { product: "Audio", qty: 62, price: 120, cost: 55 }, { product: "Accessory", qty: 105, price: 25, cost: 9 }],
  2: [{ product: "Laptop", qty: 20, price: 900, cost: 620 }, { product: "Phone", qty: 50, price: 600, cost: 390 }, { product: "Audio", qty: 90, price: 120, cost: 55 }, { product: "Accessory", qty: 170, price: 25, cost: 9 }],
  3: [{ product: "Laptop", qty: 22, price: 900, cost: 620 }, { product: "Phone", qty: 52, price: 600, cost: 390 }, { product: "Audio", qty: 95, price: 120, cost: 55 }, { product: "Accessory", qty: 200, price: 25, cost: 9 }],
};

/** Realised units, average net price and average unit cost per product over some months (price x qty equals revenue exactly). */
export function actualLines(months: number[], f: Filter = {}): ProdLine[] {
  const set = new Set(months), os = ORDERS.filter((o) => set.has(o.month) && inFilter(o, f));
  return PRODUCTS.map((p) => {
    let qty = 0, rev = 0, cogs = 0;
    for (const o of os) for (const l of o.lines) if (l.product === p.id) { qty += l.qty; rev += l.qty * l.price; cogs += l.qty * l.cost; }
    return { product: p.id, qty, price: qty ? rev / qty : p.list, cost: qty ? cogs / qty : p.cost };
  });
}
const rev = (ls: ProdLine[]) => ls.reduce((a, l) => a + l.qty * l.price, 0);
const gp = (ls: ProdLine[]) => ls.reduce((a, l) => a + l.qty * (l.price - l.cost), 0);
const qty = (ls: ProdLine[]) => ls.reduce((a, l) => a + l.qty, 0);

export interface Pvm {
  base: { revenue: number; grossProfit: number; units: number }; actual: { revenue: number; grossProfit: number; units: number };
  /** Revenue effects (a144): price = sum Q1 (P1 - P0); volume = (Qtot1 - Qtot0) x average P0; mix = the rest of the unit change. */
  revenue: { price: number; volume: number; mix: number; total: number; check: number };
  /** Gross-profit effects: the same three at base margins, plus a cost effect = sum Q1 (C0 - C1). */
  profit: { price: number; volume: number; mix: number; cost: number; total: number; check: number };
  byProduct: { product: ProductId; priceEffect: number; qtyEffectAtBasePrice: number; costEffect: number }[];
}
/** Price / volume / mix between a base (budget or earlier period) and an actual. `check` is the unexplained remainder: zero up to rounding. */
export function priceVolumeMix(base: ProdLine[], actual: ProdLine[]): Pvm {
  const get = (ls: ProdLine[], p: ProductId) => ls.find((l) => l.product === p)!;
  const q0 = qty(base), q1 = qty(actual), avgP0 = q0 ? rev(base) / q0 : 0, avgM0 = q0 ? gp(base) / q0 : 0;
  let price = 0, qAtP0 = 0, costE = 0, qAtM0 = 0;
  const byProduct = PRODUCT_IDS.map((p) => {
    const b = get(base, p), a = get(actual, p);
    const priceEffect = a.qty * (a.price - b.price), qe = (a.qty - b.qty) * b.price, ce = a.qty * (b.cost - a.cost);
    price += priceEffect; qAtP0 += qe; costE += ce; qAtM0 += (a.qty - b.qty) * (b.price - b.cost);
    return { product: p, priceEffect, qtyEffectAtBasePrice: qe, costEffect: ce };
  });
  const volume = (q1 - q0) * avgP0, mix = qAtP0 - volume, volumeP = (q1 - q0) * avgM0, mixP = qAtM0 - volumeP;
  const revTotal = rev(actual) - rev(base), gpTotal = gp(actual) - gp(base);
  return {
    base: { revenue: rev(base), grossProfit: gp(base), units: q0 }, actual: { revenue: rev(actual), grossProfit: gp(actual), units: q1 },
    revenue: { price, volume, mix, total: revTotal, check: price + volume + mix - revTotal },
    profit: { price, volume: volumeP, mix: mixP, cost: costE, total: gpTotal, check: price + volumeP + mixP + costE - gpTotal },
    byProduct,
  };
}

export interface WaterfallBar { label: string; value: number; start: number; end: number; kind: "total" | "up" | "down" }
/** Turn a start value and a list of effects into bars; the last bar is the end total, and equals start + sum of effects. */
export function waterfall(startLabel: string, start: number, effects: [string, number][], endLabel: string): WaterfallBar[] {
  const bars: WaterfallBar[] = [{ label: startLabel, value: start, start: 0, end: start, kind: "total" }];
  let run = start;
  for (const [label, v] of effects) { bars.push({ label, value: v, start: run, end: run + v, kind: v >= 0 ? "up" : "down" }); run += v; }
  bars.push({ label: endLabel, value: run, start: 0, end: run, kind: "total" });
  return bars;
}
/** Favourable when the variance raises profit: revenue above budget, cost below budget (a151). */
export const isFavourable = (line: "revenue" | "cost", variance: number) => (line === "revenue" ? variance >= 0 : variance <= 0);

// ---------------------------------------------------------------------------------------------------------------------
// 3. Cohort retention (a111)
// ---------------------------------------------------------------------------------------------------------------------

export interface CohortRow { cohort: number; size: number; active: (number | null)[]; rates: (number | null)[] }
/** Cohort = month of a customer's first order; cell k = distinct cohort customers who ordered again k months later. null = not yet observable. */
export function cohortTable(orders: Order[] = ORDERS): CohortRow[] {
  const first = new Map<string, number>(), seen = new Map<string, Set<number>>();
  for (const o of orders) { first.set(o.customer, Math.min(first.get(o.customer) ?? 99, o.month)); (seen.get(o.customer) ?? seen.set(o.customer, new Set()).get(o.customer)!).add(o.month); }
  const rows: CohortRow[] = [];
  for (let c = 0; c < 12; c++) {
    const members = [...first.entries()].filter(([, m]) => m === c).map(([id]) => id);
    const active = Array.from({ length: 12 }, (_, k) => (c + k > 11 ? null : members.filter((id) => seen.get(id)!.has(c + k)).length));
    rows.push({ cohort: c, size: members.length, active, rates: active.map((a) => (a === null || !members.length ? null : a / members.length)) });
  }
  return rows;
}
/** The working behind one cell: who is in the cohort and who came back. */
export function cohortCell(cohort: number, k: number, orders: Order[] = ORDERS): { members: string[]; returned: string[]; rate: number | null; label: string } {
  const first = new Map<string, number>();
  for (const o of orders) first.set(o.customer, Math.min(first.get(o.customer) ?? 99, o.month));
  const members = [...first.entries()].filter(([, m]) => m === cohort).map(([id]) => id).sort();
  if (cohort + k > 11) return { members, returned: [], rate: null, label: `${MONTH_NAMES[cohort]} + ${k} is after the end of the data` };
  const returned = members.filter((id) => orders.some((o) => o.customer === id && o.month === cohort + k));
  return { members, returned, rate: members.length ? returned.length / members.length : null, label: `${MONTH_NAMES[cohort]} cohort, ${k} month${k === 1 ? "" : "s"} after the first order (${MONTH_NAMES[cohort + k]})` };
}
/** Weighted average retention at each age, using only cohorts old enough to be observed: recent cohorts are left out of later points (a146). */
export function retentionByAge(rows: CohortRow[]): { age: number; rate: number; eligible: number }[] {
  return Array.from({ length: 12 }, (_, k) => { const el = rows.filter((r) => r.active[k] !== null && r.size > 0); const base = el.reduce((a, r) => a + r.size, 0); return { age: k, rate: base ? el.reduce((a, r) => a + (r.active[k] ?? 0), 0) / base : 0, eligible: base }; }).filter((x) => x.eligible > 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Funnel (a147)
// ---------------------------------------------------------------------------------------------------------------------

export const FUNNEL_STEPS = ["Visited the site", "Viewed a product", "Added to cart", "Started checkout", "Purchased"] as const;
/** Fixture step rates for the first three transitions; the last step is the real order count from the order fixture. */
const FUNNEL_RATES: Record<string, [number, number, number]> = { Online: [0.58, 0.2, 0.5], Store: [0.7, 0.24, 0.62] };

export interface FunnelStep { name: string; count: number; stepRate: number | null; dropped: number | null; dropRate: number | null; cumulative: number }
/** Counts for the filtered months: visits and purchases are exact; the middle steps follow the fixture rates, never falling below the next step. */
export function funnelCounts(months: number[], f: Filter = {}): number[] {
  const set = new Set(months);
  let c = [0, 0, 0, 0, 0];
  for (const ch of CHANNELS) for (const rg of REGIONS) {
    if (!inFilter({ channel: ch, region: rg }, f)) continue;
    let visits = 0; for (const m of months) visits += visitorsFor(m, ch, rg);
    const orders = ORDERS.filter((o) => set.has(o.month) && o.channel === ch && o.region === rg).length, [a, b, d] = FUNNEL_RATES[ch];
    const views = Math.round(visits * a), carts = Math.round(views * b), checkouts = Math.max(orders, Math.round(carts * d));
    c = [c[0] + visits, c[1] + views, c[2] + Math.max(carts, checkouts), c[3] + checkouts, c[4] + orders];
  }
  return c;
}
export function funnelSteps(counts: number[]): FunnelStep[] {
  return counts.map((count, i) => ({ name: FUNNEL_STEPS[i], count, stepRate: i ? (counts[i - 1] ? count / counts[i - 1] : 0) : null, dropped: i ? counts[i - 1] - count : null, dropRate: i ? (counts[i - 1] ? 1 - count / counts[i - 1] : 0) : null, cumulative: counts[0] ? count / counts[0] : 0 }));
}
/** What if one step converted at a different rate and the others stayed as they are? Downstream counts are recomputed from the step rates. */
export function funnelWhatIf(counts: number[], step: number, newRate: number, aov: number): { counts: number[]; purchases: number; deltaOrders: number; deltaRevenue: number; overall: number } {
  const rates = counts.map((c, i) => (i ? (counts[i - 1] ? c / counts[i - 1] : 0) : 1));
  rates[step] = newRate;
  const out = [counts[0]]; for (let i = 1; i < counts.length; i++) out.push(out[i - 1] * rates[i]);
  const purchases = out[out.length - 1];
  return { counts: out, purchases, deltaOrders: purchases - counts[counts.length - 1], deltaRevenue: (purchases - counts[counts.length - 1]) * aov, overall: counts[0] ? purchases / counts[0] : 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. RFM (a145)
// ---------------------------------------------------------------------------------------------------------------------

export interface RfmRow { customer: string; recencyDays: number; frequency: number; monetary: number; r: number; f: number; m: number; segment: string }
/** SQL NTILE(n): rows sorted by `key` then id; the first (N mod n) groups get one extra row. Returns each id's group, 1..n. */
export function ntile(ids: string[], keys: number[], n: number): Map<string, number> {
  const order = ids.map((id, i) => ({ id, k: keys[i] })).sort((a, b) => a.k - b.k || a.id.localeCompare(b.id)), N = order.length, base = Math.floor(N / n), extra = N % n, out = new Map<string, number>();
  let pos = 0;
  for (let g = 1; g <= n; g++) { const size = base + (g <= extra ? 1 : 0); for (let i = 0; i < size; i++) out.set(order[pos++].id, g); }
  return out;
}
/** Frequency uses explicit thresholds (a145 recommends this when most customers have one order): 1 order, 2, 3 to 4, 5 or more. */
export const FREQ_THRESHOLDS = [{ score: 1, text: "1 order", test: (v: number) => v <= 1 }, { score: 2, text: "2 orders", test: (v: number) => v === 2 }, { score: 3, text: "3 to 4 orders", test: (v: number) => v >= 3 && v <= 4 }, { score: 4, text: "5 or more orders", test: (v: number) => v >= 5 }];
export const SEGMENT_RULES: { name: string; text: string; test: (r: number, f: number, m: number) => boolean }[] = [
  { name: "Champions", text: "R >= 3 and F >= 3 and M >= 3", test: (r, f, m) => r >= 3 && f >= 3 && m >= 3 },
  { name: "Loyal", text: "F >= 3 and R >= 2 (not a champion)", test: (r, f) => f >= 3 && r >= 2 },
  { name: "At risk, high value", text: "R <= 2 and M >= 3", test: (r, _f, m) => r <= 2 && m >= 3 },
  { name: "New or small", text: "R >= 3 and F <= 2", test: (r, f) => r >= 3 && f <= 2 },
  { name: "Lapsed", text: "R <= 2 (everyone else who has not bought recently)", test: (r) => r <= 2 },
];
export function rfm(orders: Order[] = ORDERS, asOf = AS_OF_DAY): { rows: RfmRow[]; thresholds: { measure: "R" | "M"; score: number; min: number; max: number; count: number }[] } {
  const by = new Map<string, { last: number; n: number; money: number }>();
  for (const o of orders) { const e = by.get(o.customer) ?? { last: -1, n: 0, money: 0 }; e.last = Math.max(e.last, o.day); e.n++; e.money += orderRevenue(o); by.set(o.customer, e); }
  const ids = [...by.keys()].sort(), rec = ids.map((id) => asOf - by.get(id)!.last), mon = ids.map((id) => by.get(id)!.money);
  // Recency: a large number of days is bad, so sort descending (negate) and the most recent group becomes score 4.
  const rs = ntile(ids, rec.map((v) => -v), 4), ms = ntile(ids, mon, 4);
  const rows = ids.map((id, i) => {
    const e = by.get(id)!, r = rs.get(id)!, m = ms.get(id)!, fsc = FREQ_THRESHOLDS.find((t) => t.test(e.n))!.score;
    return { customer: id, recencyDays: rec[i], frequency: e.n, monetary: mon[i], r, f: fsc, m, segment: SEGMENT_RULES.find((s) => s.test(r, fsc, m))?.name ?? "Other" };
  });
  const thresholds = (["R", "M"] as const).flatMap((measure) => [1, 2, 3, 4].map((score) => { const g = rows.filter((x) => (measure === "R" ? x.r : x.m) === score), v = g.map((x) => (measure === "R" ? x.recencyDays : x.monetary)); return { measure, score, min: Math.min(...v), max: Math.max(...v), count: g.length }; }));
  return { rows, thresholds };
}
export function segmentSummary(rows: RfmRow[]): { segment: string; customers: number; revenue: number; share: number; orders: number; aov: number }[] {
  const total = rows.reduce((a, r) => a + r.monetary, 0);
  return SEGMENT_RULES.map((s) => { const g = rows.filter((r) => r.segment === s.name), revenue = g.reduce((a, r) => a + r.monetary, 0), orders = g.reduce((a, r) => a + r.frequency, 0); return { segment: s.name, customers: g.length, revenue, share: total ? revenue / total : 0, orders, aov: orders ? revenue / orders : 0 }; });
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Churn, retention and lifetime value (a146)
// ---------------------------------------------------------------------------------------------------------------------

export interface Sub { id: string; start: number; /** First month the customer is no longer active, or null if still active at the end of the data. */ end: number | null }
/** A fixed subscription base for the churn view (separate from the order fixture): 240 subscribers, churn higher in the first months. */
export const SUBS: Sub[] = (() => {
  const rng = mulberry32(777), subs: Sub[] = [];
  for (let i = 0; i < 240; i++) {
    const start = Math.min(11, Math.floor(Math.pow(rng(), 1.2) * 12)); let age = 0, end: number | null = null;
    for (;;) { const hazard = age === 0 ? 0.14 : age < 3 ? 0.09 : 0.05; if (rng() < hazard) { end = start + age + 1; break; } age++; if (start + age > 11) break; }
    subs.push({ id: `S${String(i + 1).padStart(3, "0")}`, start, end: end !== null && end <= 11 ? end : null });
  }
  return subs;
})();
export const SUB_PRICE = 30, SUB_GROSS_MARGIN = 0.7;
const activeIn = (s: Sub, m: number) => s.start <= m && (s.end === null || m < s.end);

export interface ChurnMonth { month: number; active: number; started: number; lost: number; atRisk: number; churn: number | null }
export function churnTable(subs: Sub[] = SUBS): ChurnMonth[] {
  return Array.from({ length: 12 }, (_, m) => ({
    month: m, active: subs.filter((s) => activeIn(s, m)).length, started: subs.filter((s) => s.start === m).length,
    lost: subs.filter((s) => s.end === m).length, atRisk: m ? subs.filter((s) => activeIn(s, m - 1)).length : 0,
    churn: m ? (subs.filter((s) => activeIn(s, m - 1)).length ? subs.filter((s) => s.end === m).length / subs.filter((s) => activeIn(s, m - 1)).length : null) : null,
  }));
}
export interface Survival { age: number; eligible: number; stillActive: number; rate: number }
/** Share still active at each age, counting only subscribers old enough to be observed at that age (censoring). */
export function survivalByAge(subs: Sub[] = SUBS): Survival[] {
  const out: Survival[] = [];
  for (let a = 0; a <= 11; a++) { const el = subs.filter((s) => s.start + a <= 11), alive = el.filter((s) => s.end === null || s.end > s.start + a).length; if (el.length) out.push({ age: a, eligible: el.length, stillActive: alive, rate: alive / el.length }); }
  return out;
}
export interface Ltv { churn: number; expectedLifetime: number; monthlyGrossProfit: number; ltv: number; naiveTenure: number; ltvToCac: number | null; paybackMonths: number | null }
/** Overall monthly churn = total lost / total customer-months at risk. LTV = monthly gross profit x expected lifetime, lifetime = 1 / churn (constant-churn approximation). */
export function lifetimeValue(subs: Sub[] = SUBS, cac: number | null = null, price = SUB_PRICE, margin = SUB_GROSS_MARGIN): Ltv {
  const t = churnTable(subs), lost = t.reduce((a, r) => a + r.lost, 0), risk = t.reduce((a, r) => a + r.atRisk, 0);
  const churn = risk ? lost / risk : 0, gpm = price * margin, churned = subs.filter((s) => s.end !== null);
  const naiveTenure = churned.length ? churned.reduce((a, s) => a + (s.end! - s.start), 0) / churned.length : 0;
  const expectedLifetime = churn ? 1 / churn : Infinity, ltv = gpm * expectedLifetime;
  return { churn, expectedLifetime, monthlyGrossProfit: gpm, ltv, naiveTenure, ltvToCac: cac ? ltv / cac : null, paybackMonths: cac ? cac / gpm : null };
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. Decision simulations (a148, a149): every input is an assumption
// ---------------------------------------------------------------------------------------------------------------------

export interface DiscountInput { price: number; cost: number; units: number; discount: number; elasticity: number; /** Share of the extra units that is only borrowed from the future or from other products (cannibalisation). */ borrowed: number }
export interface DiscountResult {
  margin: number; newPrice: number; newUnits: number; volumeRise: number; baseRevenue: number; newRevenue: number; baseProfit: number; newProfit: number; profitChange: number; profitChangePct: number;
  /** Rule from a149: required volume increase = d / (m - d); Infinity when the discount is as large as the margin. */
  breakEvenVolumeRise: number; breakEvenElasticity: number | null;
}
/** Constant-elasticity demand: units scale by (new price / old price) ^ elasticity. Elasticity is an assumption, not a fact. */
export function discountScenario(i: DiscountInput): DiscountResult {
  const m = (i.price - i.cost) / i.price, newPrice = i.price * (1 - i.discount);
  const ratio = (e: number) => Math.pow(1 - i.discount, e), units = (e: number) => i.units * (1 + (ratio(e) - 1) * (1 - i.borrowed));
  const profit = (e: number) => units(e) * (newPrice - i.cost);
  const newUnits = units(i.elasticity), baseProfit = i.units * (i.price - i.cost), newProfit = profit(i.elasticity);
  let breakEvenElasticity: number | null = null;
  if (i.discount > 0 && i.discount < m) { // profit falls as elasticity rises toward 0, so bisect on [-60, 0]
    let lo = -60, hi = 0;
    if (profit(lo) >= baseProfit) { for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (profit(mid) >= baseProfit) lo = mid; else hi = mid; } breakEvenElasticity = (lo + hi) / 2; }
  }
  return { margin: m, newPrice, newUnits, volumeRise: newUnits / i.units - 1, baseRevenue: i.units * i.price, newRevenue: newUnits * newPrice, baseProfit, newProfit, profitChange: newProfit - baseProfit, profitChangePct: baseProfit ? (newProfit - baseProfit) / baseProfit : 0, breakEvenVolumeRise: i.discount < m ? i.discount / (m - i.discount) : Infinity, breakEvenElasticity };
}
export function discountSensitivity(base: DiscountInput, elasticities: number[], discounts: number[]): { elasticity: number; cells: { discount: number; profitChangePct: number }[] }[] {
  return elasticities.map((e) => ({ elasticity: e, cells: discounts.map((d) => ({ discount: d, profitChangePct: discountScenario({ ...base, elasticity: e, discount: d }).profitChangePct })) }));
}
export function discountRecommendation(i: DiscountInput, r: DiscountResult): { verdict: "adopt" | "reject" | "borderline"; text: string } {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const be = r.breakEvenElasticity === null ? "no elasticity makes this discount pay, because the discount is at least as large as the unit margin" : `the discount pays only if demand is more elastic than ${r.breakEvenElasticity.toFixed(2)}`;
  const verdict = Math.abs(r.profitChangePct) < 0.02 ? "borderline" : r.profitChange > 0 ? "adopt" : "reject";
  const lead = verdict === "borderline" ? "Too close to call" : verdict === "adopt" ? "The discount raises modelled gross profit" : "The discount lowers modelled gross profit";
  return { verdict, text: `${lead} (${pct(r.profitChangePct)}) under the assumed elasticity of ${i.elasticity} with ${pct(i.borrowed)} of extra units borrowed from the future. This depends entirely on those assumptions: ${be}; the volume rise needed to break even is ${Number.isFinite(r.breakEvenVolumeRise) ? pct(r.breakEvenVolumeRise) : "impossible"} against the ${pct(r.volumeRise)} the model gives. Test elasticity with a controlled price experiment before relying on this.` };
}

export interface CampaignInput { spend: number; reach: number; treatedRate: number; /** Conversion rate the audience would have had with no campaign (from a holdout group). */ baselineRate: number; aov: number; margin: number }
export interface CampaignResult {
  attributed: number; incremental: number; attributedRevenue: number; incrementalRevenue: number; roasAttributed: number; roasIncremental: number; roiAttributed: number; roiIncremental: number;
  cac: number | null; /** Incremental conversion rate at which ROI is zero. */ breakEvenIncrementalRate: number;
}
/** ROAS = revenue / spend; ROI = (revenue x margin - spend) / spend; incrementality = treated minus holdout (a148). */
export function campaignScenario(i: CampaignInput): CampaignResult {
  const attributed = i.reach * i.treatedRate, incremental = Math.max(0, i.reach * (i.treatedRate - i.baselineRate)), ar = attributed * i.aov, ir = incremental * i.aov;
  return { attributed, incremental, attributedRevenue: ar, incrementalRevenue: ir, roasAttributed: ar / i.spend, roasIncremental: ir / i.spend, roiAttributed: (ar * i.margin - i.spend) / i.spend, roiIncremental: (ir * i.margin - i.spend) / i.spend, cac: incremental > 0 ? i.spend / incremental : null, breakEvenIncrementalRate: i.spend / (i.reach * i.aov * i.margin) };
}
export function campaignSensitivity(base: CampaignInput, baselines: number[], margins: number[]): { baselineRate: number; cells: { margin: number; roi: number }[] }[] {
  return baselines.map((b) => ({ baselineRate: b, cells: margins.map((m) => ({ margin: m, roi: campaignScenario({ ...base, baselineRate: b, margin: m }).roiIncremental })) }));
}
export function campaignRecommendation(i: CampaignInput, r: CampaignResult): { verdict: "scale" | "stop" | "test"; text: string } {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`, incRate = i.treatedRate - i.baselineRate;
  const verdict = r.roiIncremental > 0.1 ? "scale" : r.roiIncremental < -0.1 ? "stop" : "test";
  return { verdict, text: `${verdict === "scale" ? "The campaign earns more than it costs on incremental sales" : verdict === "stop" ? "The campaign loses money on incremental sales" : "The result is close to break-even"}: incremental ROI ${pct(r.roiIncremental)} against an attributed ROI of ${pct(r.roiAttributed)}. This depends on the holdout baseline of ${pct(i.baselineRate)}: the campaign needs an incremental lift of ${pct(r.breakEvenIncrementalRate)} to break even and has ${pct(incRate)}. If the true baseline is higher, the incremental return is lower than shown. Confirm with a randomised holdout before changing the budget.` };
}

// ---------------------------------------------------------------------------------------------------------------------
// Forecasting basics (a152)
// ---------------------------------------------------------------------------------------------------------------------

/** 24 months of revenue from a formula (trend x seasonal index, plus a small fixed wobble): an input fixture, not a result. */
export const SERIES: number[] = Array.from({ length: 24 }, (_, t) => { const s = [0.88, 0.84, 0.95, 1, 1.03, 1.0, 0.96, 1, 1.06, 1.12, 1.3, 1.42][t % 12], wob = [0.01, -0.015, 0.02, -0.005, 0.0, 0.012, -0.01, 0.008, -0.02, 0.015, -0.01, 0.005][(t * 5) % 12]; return Math.round(40000 * (1 + 0.012 * t) * s * (1 + wob)); });
export type ForecastMethod = "naive" | "moving-average" | "seasonal-naive";
export interface ForecastResult { forecast: number[]; actual: number[]; errors: number[]; mae: number; mape: number; rmse: number }
/** Hold out the last `holdout` months, forecast them from the training months only, and score the forecast (a152). */
export function forecast(series: number[], method: ForecastMethod, holdout = 6, window = 3): ForecastResult {
  const train = series.slice(0, series.length - holdout), actual = series.slice(series.length - holdout);
  const fc = actual.map((_, h) => method === "naive" ? train[train.length - 1] : method === "moving-average" ? train.slice(-window).reduce((a, b) => a + b, 0) / window : train[train.length - 12 + h]);
  const errors = actual.map((a, i) => a - fc[i]);
  return { forecast: fc, actual, errors, mae: errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length, mape: errors.reduce((a, e, i) => a + Math.abs(e) / actual[i], 0) / errors.length, rmse: Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------------------------------

export type BusinessTab = "kpi" | "variance" | "cohort" | "funnel" | "rfm" | "churn" | "decisions" | "forecast";
export const TABS: { id: BusinessTab; label: string }[] = [
  { id: "kpi", label: "KPIs" }, { id: "variance", label: "Variance" }, { id: "cohort", label: "Cohorts" }, { id: "funnel", label: "Funnel" },
  { id: "rfm", label: "RFM" }, { id: "churn", label: "Churn and LTV" }, { id: "decisions", label: "Decisions" }, { id: "forecast", label: "Forecast" },
];
export interface BusinessPreset { id: string; label: string; tab: BusinessTab; mode?: string }
export const PRESETS: BusinessPreset[] = [
  { id: "kpi", label: "KPI dashboard with period-over-period change", tab: "kpi" },
  { id: "metric-tree", label: "Metric tree: revenue = visitors x conversion x AOV", tab: "kpi", mode: "tree" },
  { id: "variance", label: "Budget versus actual variance", tab: "variance", mode: "budget" },
  { id: "price-volume-mix", label: "Price, volume and mix", tab: "variance", mode: "period" },
  { id: "cohort", label: "Cohort retention table", tab: "cohort" },
  { id: "funnel", label: "Funnel and conversion", tab: "funnel" },
  { id: "rfm", label: "RFM segmentation", tab: "rfm" },
  { id: "churn", label: "Retention and churn", tab: "churn" },
  { id: "ltv", label: "Customer lifetime value", tab: "churn", mode: "ltv" },
  { id: "pricing", label: "Pricing and discount decision", tab: "decisions", mode: "discount" },
  { id: "campaign-roi", label: "Campaign ROI and incrementality", tab: "decisions", mode: "campaign" },
  { id: "forecast", label: "Forecasting: naive, moving average, seasonal", tab: "forecast" },
];
export const presetById = (id?: string) => PRESETS.find((p) => p.id === id);
