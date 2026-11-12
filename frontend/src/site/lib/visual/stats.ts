/**
 * Statistics Lab engine. Pure (no React) and deterministic: every random draw comes from a seeded PRNG, so a run is
 * reproducible from its seed. The special functions (normal, gamma, beta, Student t, chi-square) are implemented here and
 * tested against scipy reference values, not borrowed from an approximation that is "close enough".
 * Terminology follows the Daily Learning lessons d086 to d090 and a101 to a105.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Seeded random numbers
// ---------------------------------------------------------------------------------------------------------------------

/** mulberry32: a small, well-mixed 32-bit generator. Same seed, same sequence, on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Uniform on [0, 1). */
  u: () => number;
  /** Standard normal (Box-Muller). */
  normal: () => number;
  /** Exponential with the given rate. */
  exp: (rate: number) => number;
  /** Integer in [0, n). */
  int: (n: number) => number;
}

export function makeRng(seed: number): Rng {
  const u = mulberry32(seed);
  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let a = u(); while (a <= 1e-12) a = u();
    const b = u(), r = Math.sqrt(-2 * Math.log(a));
    spare = r * Math.sin(2 * Math.PI * b);
    return r * Math.cos(2 * Math.PI * b);
  };
  return { u, normal, exp: (rate) => -Math.log(1 - u()) / rate, int: (n) => Math.floor(u() * n) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Special functions
// ---------------------------------------------------------------------------------------------------------------------

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

/** log Gamma(x), Lanczos approximation (g = 7, 9 terms): relative error about 1e-15. */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const EPS = 1e-16, TINY = 1e-300;

/** Regularised lower incomplete gamma P(a, x) and upper Q(a, x) = 1 - P, each computed on its accurate side. */
export function gammaPQ(a: number, x: number): { p: number; q: number } {
  if (x <= 0) return { p: 0, q: 1 };
  if (!Number.isFinite(x)) return { p: 1, q: 0 };
  const lead = Math.exp(-x + a * Math.log(x) - lgamma(a));
  if (x < a + 1) {
    // Series: converges quickly when x is small relative to a.
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 100000; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * EPS) break; }
    const p = Math.min(1, sum * lead);
    return { p, q: 1 - p };
  }
  // Continued fraction (modified Lentz): converges quickly when x is large; keeps tiny tails accurate.
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i < 100000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  const q = Math.min(1, lead * h);
  return { p: 1 - q, q };
}
export const gammaP = (a: number, x: number) => gammaPQ(a, x).p;
export const gammaQ = (a: number, x: number) => gammaPQ(a, x).q;

function betaCf(x: number, a: number, b: number): number {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 100000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(x, a, b)) / a : 1 - (bt * betaCf(1 - x, b, a)) / b;
}

// Normal ------------------------------------------------------------------------------------------------------------

/** Standard normal CDF via the incomplete gamma function: Phi(x) = 1/2 (1 + sign(x) P(1/2, x^2/2)). */
export function normCdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const { q } = gammaPQ(0.5, (x * x) / 2);
  return x >= 0 ? 1 - 0.5 * q : 0.5 * q;
}
/** Upper tail 1 - Phi(x), accurate far in the tail. */
export const normSf = (x: number) => normCdf(-x);
export const normPdf = (x: number, mu = 0, sd = 1) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));

const ACK_A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
const ACK_B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const ACK_C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const ACK_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

/** Inverse standard normal CDF (the lesson's "percent point function"): a rational start refined by two Halley steps. */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  let x: number;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((ACK_C[0] * q + ACK_C[1]) * q + ACK_C[2]) * q + ACK_C[3]) * q + ACK_C[4]) * q + ACK_C[5]) / ((((ACK_D[0] * q + ACK_D[1]) * q + ACK_D[2]) * q + ACK_D[3]) * q + 1);
  } else if (p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((ACK_C[0] * q + ACK_C[1]) * q + ACK_C[2]) * q + ACK_C[3]) * q + ACK_C[4]) * q + ACK_C[5]) / ((((ACK_D[0] * q + ACK_D[1]) * q + ACK_D[2]) * q + ACK_D[3]) * q + 1);
  } else {
    const q = p - 0.5, r = q * q;
    x = ((((((ACK_A[0] * r + ACK_A[1]) * r + ACK_A[2]) * r + ACK_A[3]) * r + ACK_A[4]) * r + ACK_A[5]) * q) / (((((ACK_B[0] * r + ACK_B[1]) * r + ACK_B[2]) * r + ACK_B[3]) * r + ACK_B[4]) * r + 1);
  }
  for (let i = 0; i < 2; i++) {
    const e = normCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return x;
}

// Student t -----------------------------------------------------------------------------------------------------------

export const tPdf = (t: number, df: number) => Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log1p((t * t) / df));
/** Two-sided tail P(|T| > |t|) = I_x(df/2, 1/2) with x = df / (df + t^2): no cancellation for large t. */
export const tTwoSided = (t: number, df: number) => betaI(df / (df + t * t), df / 2, 0.5);
/** Student t CDF. */
export function tCdf(t: number, df: number): number {
  if (t === 0) return 0.5;
  const half = 0.5 * tTwoSided(t, df);
  return t > 0 ? 1 - half : half;
}
export const tSf = (t: number, df: number) => tCdf(-t, df);

/** Monotone root finder by bisection to full double precision. `f` increases from below target at lo to above at hi. */
function bisect(f: (x: number) => number, target: number, lo: number, hi: number, decreasing = false): number {
  const less = (v: number) => (decreasing ? v > target : v < target);
  while (less(f(hi)) && hi < 1e300) hi *= 2;
  for (let i = 0; i < 400 && hi - lo > 1e-15 * Math.abs(hi); i++) {
    const mid = 0.5 * (lo + hi);
    if (less(f(mid))) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Student t quantile (percent point function). Solves the accurate tail, so extreme p stay accurate. */
export function tInv(p: number, df: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  if (p === 0.5) return 0;
  const q = Math.min(p, 1 - p);
  const t = bisect((x) => 0.5 * tTwoSided(x, df), q, 0, 1, true);
  return p > 0.5 ? t : -t;
}

// Chi-square ---------------------------------------------------------------------------------------------------------

export const chi2Cdf = (x: number, k: number) => gammaP(k / 2, x / 2);
export const chi2Sf = (x: number, k: number) => gammaQ(k / 2, x / 2);
export const chi2Pdf = (x: number, k: number) => (x <= 0 ? (k === 2 ? 0.5 : 0) : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.LN2 - lgamma(k / 2)));
export function chi2Inv(p: number, k: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? 0 : p === 1 ? Infinity : NaN;
  return p < 0.5 ? bisect((x) => chi2Cdf(x, k), p, 0, 1) : bisect((x) => chi2Sf(x, k), 1 - p, 0, 1, true);
}

// Discrete and skewed distributions ----------------------------------------------------------------------------------

export const lchoose = (n: number, k: number) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
export function binomPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n || !Number.isInteger(k)) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}
export function binomCdf(k: number, n: number, p: number): number {
  let s = 0;
  for (let i = 0; i <= Math.min(Math.floor(k), n); i++) s += binomPmf(i, n, p);
  return Math.min(1, s);
}
export const poissonPmf = (k: number, lam: number) => (k < 0 || !Number.isInteger(k) ? 0 : lam === 0 ? (k === 0 ? 1 : 0) : Math.exp(-lam + k * Math.log(lam) - lgamma(k + 1)));
export function poissonCdf(k: number, lam: number): number {
  let s = 0;
  for (let i = 0; i <= Math.floor(k); i++) s += poissonPmf(i, lam);
  return Math.min(1, s);
}
export const lognormPdf = (x: number, mu: number, sigma: number) => (x <= 0 ? 0 : Math.exp(-0.5 * ((Math.log(x) - mu) / sigma) ** 2) / (x * sigma * Math.sqrt(2 * Math.PI)));
export const lognormCdf = (x: number, mu: number, sigma: number) => (x <= 0 ? 0 : normCdf((Math.log(x) - mu) / sigma));

// ---------------------------------------------------------------------------------------------------------------------
// Distribution explorer
// ---------------------------------------------------------------------------------------------------------------------

export type DistId = "normal" | "uniform" | "binomial" | "poisson" | "exponential" | "lognormal";
export interface ParamSpec { key: string; label: string; min: number; max: number; step: number; def: number }
export interface DistSpec { id: DistId; label: string; discrete: boolean; params: ParamSpec[]; blurb: string }

export const DISTRIBUTIONS: DistSpec[] = [
  { id: "normal", label: "Normal", discrete: false, blurb: "Symmetric bell: mean, median and mode coincide. Heights, measurement error.", params: [{ key: "mu", label: "Mean (mu)", min: -10, max: 10, step: 0.5, def: 0 }, { key: "sigma", label: "Standard deviation (sigma)", min: 0.5, max: 5, step: 0.1, def: 1 }] },
  { id: "uniform", label: "Uniform", discrete: false, blurb: "Every value between a and b is equally likely. Random number generators.", params: [{ key: "a", label: "Lower bound (a)", min: -10, max: 5, step: 0.5, def: 0 }, { key: "b", label: "Upper bound (b)", min: 6, max: 20, step: 0.5, def: 10 }] },
  { id: "binomial", label: "Binomial", discrete: true, blurb: "Number of successes in n independent yes/no trials with success probability p.", params: [{ key: "n", label: "Trials (n)", min: 1, max: 60, step: 1, def: 20 }, { key: "p", label: "Success probability (p)", min: 0.02, max: 0.98, step: 0.01, def: 0.3 }] },
  { id: "poisson", label: "Poisson", discrete: true, blurb: "Count of events in a fixed interval when events arrive independently at a steady average rate.", params: [{ key: "lambda", label: "Average rate (lambda)", min: 0.5, max: 25, step: 0.5, def: 4 }] },
  { id: "exponential", label: "Exponential", discrete: false, blurb: "Waiting time between independent events. Strongly right-skewed.", params: [{ key: "rate", label: "Rate (lambda)", min: 0.2, max: 3, step: 0.1, def: 1 }] },
  { id: "lognormal", label: "Skewed (lognormal)", discrete: false, blurb: "Long right tail: incomes, order values, waiting times. Mean is pulled above the median.", params: [{ key: "mu", label: "Log-mean (mu)", min: -1, max: 3, step: 0.1, def: 1 }, { key: "sigma", label: "Log-sd (sigma)", min: 0.2, max: 1.2, step: 0.05, def: 0.6 }] },
];

export const defaultParams = (id: DistId): Record<string, number> => Object.fromEntries(DISTRIBUTIONS.find((d) => d.id === id)!.params.map((p) => [p.key, p.def]));

export interface Dist {
  id: DistId; discrete: boolean;
  /** Density (continuous) or mass (discrete). */
  pdf: (x: number) => number;
  cdf: (x: number) => number;
  mean: number; variance: number; sd: number; median: number;
  /** Most likely value; null when every value in an interval ties (uniform). */
  mode: number | null;
  /** Range worth plotting. */
  lo: number; hi: number;
  sample: (rng: Rng) => number;
}

const discreteMedian = (cdf: (k: number) => number) => { let k = 0; while (cdf(k) < 0.5 && k < 1e5) k++; return k; };

export function makeDist(id: DistId, par: Record<string, number>): Dist {
  switch (id) {
    case "normal": { const { mu, sigma } = par; return { id, discrete: false, pdf: (x) => normPdf(x, mu, sigma), cdf: (x) => normCdf((x - mu) / sigma), mean: mu, variance: sigma ** 2, sd: sigma, median: mu, mode: mu, lo: mu - 4.5 * sigma, hi: mu + 4.5 * sigma, sample: (r) => mu + sigma * r.normal() }; }
    case "uniform": { const { a, b } = par; return { id, discrete: false, pdf: (x) => (x >= a && x <= b ? 1 / (b - a) : 0), cdf: (x) => Math.max(0, Math.min(1, (x - a) / (b - a))), mean: (a + b) / 2, variance: (b - a) ** 2 / 12, sd: (b - a) / Math.sqrt(12), median: (a + b) / 2, mode: null, lo: a - 0.1 * (b - a), hi: b + 0.1 * (b - a), sample: (r) => a + (b - a) * r.u() }; }
    case "binomial": { const { n, p } = par; const v = n * p * (1 - p); const cdf = (k: number) => binomCdf(k, n, p); return { id, discrete: true, pdf: (k) => binomPmf(k, n, p), cdf, mean: n * p, variance: v, sd: Math.sqrt(v), median: discreteMedian(cdf), mode: Math.min(n, Math.floor((n + 1) * p)), lo: 0, hi: n, sample: (r) => { let c = 0; for (let i = 0; i < n; i++) if (r.u() < p) c++; return c; } }; }
    case "poisson": { const lam = par.lambda; const cdf = (k: number) => poissonCdf(k, lam); return { id, discrete: true, pdf: (k) => poissonPmf(k, lam), cdf, mean: lam, variance: lam, sd: Math.sqrt(lam), median: discreteMedian(cdf), mode: Math.floor(lam), lo: 0, hi: Math.ceil(lam + 5 * Math.sqrt(lam) + 3), sample: (r) => { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= r.u(); } while (p > L); return k - 1; } }; }
    case "exponential": { const rate = par.rate; return { id, discrete: false, pdf: (x) => (x < 0 ? 0 : rate * Math.exp(-rate * x)), cdf: (x) => (x < 0 ? 0 : 1 - Math.exp(-rate * x)), mean: 1 / rate, variance: 1 / rate ** 2, sd: 1 / rate, median: Math.LN2 / rate, mode: 0, lo: 0, hi: 6 / rate, sample: (r) => r.exp(rate) }; }
    case "lognormal": { const { mu, sigma } = par; const v = (Math.exp(sigma ** 2) - 1) * Math.exp(2 * mu + sigma ** 2); const mean = Math.exp(mu + sigma ** 2 / 2); return { id, discrete: false, pdf: (x) => lognormPdf(x, mu, sigma), cdf: (x) => lognormCdf(x, mu, sigma), mean, variance: v, sd: Math.sqrt(v), median: Math.exp(mu), mode: Math.exp(mu - sigma ** 2), lo: 0, hi: Math.exp(mu + 3.2 * sigma), sample: (r) => Math.exp(mu + sigma * r.normal()) }; }
  }
}

/** Curve points for plotting a density, or bars for a mass function. */
export function plotPoints(d: Dist, count = 160): { x: number; y: number }[] {
  if (d.discrete) { const out = []; for (let k = Math.max(0, Math.ceil(d.lo)); k <= Math.floor(d.hi); k++) out.push({ x: k, y: d.pdf(k) }); return out; }
  return Array.from({ length: count + 1 }, (_, i) => { const x = d.lo + ((d.hi - d.lo) * i) / count; return { x, y: d.pdf(x) }; });
}

/** A small seeded data set drawn from a distribution, rounded to one decimal so that ties (and so a mode) can occur. */
export function sampleData(d: Dist, n: number, seed: number): number[] {
  const rng = makeRng(seed);
  return Array.from({ length: n }, () => Math.round(d.sample(rng) * 10) / 10);
}

// ---------------------------------------------------------------------------------------------------------------------
// Descriptive statistics (d086, d087)
// ---------------------------------------------------------------------------------------------------------------------

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => sum(xs) / xs.length;
export const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** Percentile with linear interpolation: position (n - 1) * q, as taught on Day 86 (numpy and pandas default). */
export function quantile(xs: number[], q: number): number {
  const s = sorted(xs);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (pos - lo) * (s[hi] - s[lo]);
}
export const median = (xs: number[]) => quantile(xs, 0.5);

/** All values tied for most frequent. Empty when every value is distinct (no mode). */
export function modes(xs: number[]): number[] {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  const top = Math.max(0, ...c.values());
  if (top <= 1) return [];
  return [...c.entries()].filter(([, n]) => n === top).map(([v]) => v).sort((a, b) => a - b);
}

export const variancePop = (xs: number[]) => { const m = mean(xs); return sum(xs.map((x) => (x - m) ** 2)) / xs.length; };
export const varianceSample = (xs: number[]) => { const m = mean(xs); return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1); };
export const sdPop = (xs: number[]) => Math.sqrt(variancePop(xs));
export const sdSample = (xs: number[]) => Math.sqrt(varianceSample(xs));
/** Moment skewness g1 (same as scipy.stats.skew with bias=True). */
export function skewness(xs: number[]): number {
  const m = mean(xs), m2 = sum(xs.map((x) => (x - m) ** 2)) / xs.length, m3 = sum(xs.map((x) => (x - m) ** 3)) / xs.length;
  return m2 === 0 ? 0 : m3 / m2 ** 1.5;
}

export interface Describe {
  n: number; sum: number; mean: number; median: number; modes: number[]; min: number; max: number; range: number;
  q1: number; q3: number; iqr: number; varPop: number; varSample: number; sdPop: number; sdSample: number; skew: number;
  /** Tukey fences: values beyond these are flagged by the 1.5 x IQR rule. */
  fenceLo: number; fenceHi: number; outliers: number[];
}

export function describe(xs: number[]): Describe {
  const q1 = quantile(xs, 0.25), q3 = quantile(xs, 0.75), iqr = q3 - q1;
  const fenceLo = q1 - 1.5 * iqr, fenceHi = q3 + 1.5 * iqr;
  const n = xs.length;
  return {
    n, sum: sum(xs), mean: mean(xs), median: median(xs), modes: modes(xs), min: Math.min(...xs), max: Math.max(...xs), range: Math.max(...xs) - Math.min(...xs),
    q1, q3, iqr, varPop: variancePop(xs), varSample: n > 1 ? varianceSample(xs) : NaN, sdPop: sdPop(xs), sdSample: n > 1 ? sdSample(xs) : NaN, skew: skewness(xs), fenceLo, fenceHi,
    outliers: xs.filter((x) => x < fenceLo || x > fenceHi),
  };
}

export interface ArithmeticStep { title: string; text: string; rows?: { x: number; dev: number; sq: number }[] }
const r4 = (v: number) => Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);

/** The arithmetic of d086 and d087, one step per frame, with population (divide by n) and sample (divide by n - 1) side by side. */
export function summarySteps(xs: number[]): ArithmeticStep[] {
  const n = xs.length, s = sorted(xs), d = describe(xs);
  const rows = xs.map((x) => ({ x, dev: x - d.mean, sq: (x - d.mean) ** 2 }));
  const ss = sum(rows.map((r) => r.sq));
  const mid = n % 2 === 0 ? `the middle two values are ${r4(s[n / 2 - 1])} and ${r4(s[n / 2])}, so the median is their average ${r4(d.median)}` : `the middle value (position ${(n + 1) / 2}) is ${r4(d.median)}`;
  return [
    { title: "The data", text: `${n} values: ${xs.map(r4).join(", ")}. Sorted: ${s.map(r4).join(", ")}.` },
    { title: "Mean", text: `sum = ${r4(d.sum)}, count = ${n}, mean = ${r4(d.sum)} / ${n} = ${r4(d.mean)}.` },
    { title: "Median and mode", text: `Sorted, ${mid}. Mode: ${d.modes.length ? d.modes.map(r4).join(" and ") : "none, every value appears once"}.` },
    { title: "Range and quartiles", text: `range = max - min = ${r4(d.max)} - ${r4(d.min)} = ${r4(d.range)}. Q1 (position ${r4((n - 1) * 0.25)}) = ${r4(d.q1)}, Q3 (position ${r4((n - 1) * 0.75)}) = ${r4(d.q3)}, IQR = Q3 - Q1 = ${r4(d.iqr)}.` },
    { title: "Deviations from the mean", text: `For each value subtract the mean ${r4(d.mean)}. The deviations always add to ${r4(sum(rows.map((r) => r.dev)))} (zero, apart from rounding).`, rows },
    { title: "Square the deviations", text: `Squaring removes the signs and weights big misses more. Sum of squared deviations = ${r4(ss)}.`, rows },
    { title: "Population variance (divide by n)", text: `Use this when the data is the whole population: ${r4(ss)} / ${n} = ${r4(d.varPop)}. Standard deviation = sqrt = ${r4(d.sdPop)}.` },
    { title: "Sample variance (divide by n - 1)", text: n > 1 ? `Use this when the data is a sample used to estimate the population: ${r4(ss)} / ${n - 1} = ${r4(d.varSample)}. Standard deviation = sqrt = ${r4(d.sdSample)}. Dividing by n - 1 corrects the tendency of a sample to underestimate spread, because the sample mean sits closer to the sample values than the true mean does.` : "A sample needs at least two values for a variance (n - 1 would be zero)." },
  ];
}

/** Numbers typed by a learner: separated by commas, spaces, semicolons or new lines. Anything else is reported, not guessed. */
export function parseNumbers(text: string): { values: number[]; bad: string[] } {
  const parts = text.split(/[\s,;]+/).filter(Boolean), values: number[] = [], bad: string[] = [];
  for (const p of parts) { const v = Number(p); if (Number.isFinite(v)) values.push(v); else bad.push(p); }
  return { values, bad };
}

export interface BiasDemo { trueVariance: number; meanDivN: number; meanDivNMinus1: number; reps: number; n: number }
/** Why n - 1: average both variance formulas over many seeded small samples from a population whose variance is known. */
export function varianceBiasDemo(n: number, reps: number, seed: number, sigma = 10): BiasDemo {
  const rng = makeRng(seed);
  let a = 0, b = 0;
  for (let r = 0; r < reps; r++) { const xs = Array.from({ length: n }, () => sigma * rng.normal()); a += variancePop(xs); b += varianceSample(xs); }
  return { trueVariance: sigma * sigma, meanDivN: a / reps, meanDivNMinus1: b / reps, reps, n };
}

export interface Hist { edges: number[]; counts: number[] }
export function histogram(xs: number[], bins: number, lo = Math.min(...xs), hi = Math.max(...xs)): Hist {
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const x of xs) counts[Math.max(0, Math.min(bins - 1, Math.floor((x - lo) / w)))]++;
  return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * w), counts };
}

// ---------------------------------------------------------------------------------------------------------------------
// Probability (d088)
// ---------------------------------------------------------------------------------------------------------------------

export type EventKind = "coin" | "die" | "two-dice" | "card-heart" | "card-ace";
export const EVENTS: { id: EventKind; label: string; theory: number; describe: string }[] = [
  { id: "coin", label: "Fair coin: heads", theory: 1 / 2, describe: "P(heads) = 1/2" },
  { id: "die", label: "Fair die: a six", theory: 1 / 6, describe: "P(six) = 1/6" },
  { id: "two-dice", label: "Two dice: sum is 7", theory: 6 / 36, describe: "6 of the 36 equally likely pairs sum to 7, so 1/6" },
  { id: "card-heart", label: "One card: a heart", theory: 13 / 52, describe: "13 hearts in 52 cards, so 1/4" },
  { id: "card-ace", label: "One card: an ace", theory: 4 / 52, describe: "4 aces in 52 cards, so 1/13" },
];
export const CHECKPOINTS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export interface Checkpoint { n: number; hits: number; proportion: number; error: number }
/** Law of large numbers: the running proportion of the event, recorded at fixed trial counts. */
export function simulateEvent(kind: EventKind, trials: number, seed: number, points = CHECKPOINTS): { theory: number; checkpoints: Checkpoint[] } {
  const rng = makeRng(seed), theory = EVENTS.find((e) => e.id === kind)!.theory;
  const hit = () => {
    switch (kind) {
      case "coin": return rng.u() < 0.5;
      case "die": return rng.int(6) === 5;
      case "two-dice": return rng.int(6) + 1 + rng.int(6) + 1 === 7;
      case "card-heart": return rng.int(52) < 13; // a freshly shuffled deck each draw: card index 0..12 are the hearts
      case "card-ace": return rng.int(52) % 13 === 0;
    }
  };
  const marks = points.filter((p) => p <= trials);
  if (!marks.includes(trials)) marks.push(trials);
  const out: Checkpoint[] = [];
  let hits = 0, done = 0;
  for (const m of marks) {
    while (done < m) { if (hit()) hits++; done++; }
    out.push({ n: m, hits, proportion: hits / m, error: Math.abs(hits / m - theory) });
  }
  return { theory, checkpoints: out };
}

export interface BayesInput { population: number; prevalence: number; sensitivity: number; specificity: number }
export interface BayesTable {
  population: number; sick: number; healthy: number;
  truePositive: number; falseNegative: number; falsePositive: number; trueNegative: number;
  positives: number; negatives: number;
  /** P(sick | positive) by counting positives, and by Bayes' formula: they must agree. */
  ppv: number; ppvBayes: number; npv: number;
}
/** Natural-frequency table: "out of 10,000 people ..." avoids probability notation until the counts are clear. */
export function bayesTable(i: BayesInput): BayesTable {
  const sick = i.population * i.prevalence, healthy = i.population - sick;
  const tp = sick * i.sensitivity, fn = sick - tp, fp = healthy * (1 - i.specificity), tn = healthy - fp;
  const ppvBayes = (i.sensitivity * i.prevalence) / (i.sensitivity * i.prevalence + (1 - i.specificity) * (1 - i.prevalence));
  return { population: i.population, sick, healthy, truePositive: tp, falseNegative: fn, falsePositive: fp, trueNegative: tn, positives: tp + fp, negatives: fn + tn, ppv: tp / (tp + fp), ppvBayes, npv: tn / (tn + fn) };
}

export interface DiceEvent { id: string; label: string; test: (a: number, b: number) => boolean }
export const DICE_EVENTS: DiceEvent[] = [
  { id: "sum7", label: "sum is 7", test: (a, b) => a + b === 7 },
  { id: "sum9", label: "sum is at least 9", test: (a, b) => a + b >= 9 },
  { id: "doubles", label: "doubles", test: (a, b) => a === b },
  { id: "first-even", label: "first die is even", test: (a) => a % 2 === 0 },
  { id: "first-big", label: "first die is 4 or more", test: (a) => a >= 4 },
  { id: "sum-even", label: "sum is even", test: (a, b) => (a + b) % 2 === 0 },
];
export interface Conditional { total: number; a: number; b: number; both: number; pA: number; pB: number; pAandB: number; pAgivenB: number; independent: boolean }
/** Conditional probability by enumerating all 36 equally likely outcomes of two dice. */
export function diceConditional(aId: string, bId: string): Conditional {
  const A = DICE_EVENTS.find((e) => e.id === aId)!, B = DICE_EVENTS.find((e) => e.id === bId)!;
  let a = 0, b = 0, both = 0;
  for (let x = 1; x <= 6; x++) for (let y = 1; y <= 6; y++) { const ia = A.test(x, y), ib = B.test(x, y); if (ia) a++; if (ib) b++; if (ia && ib) both++; }
  return { total: 36, a, b, both, pA: a / 36, pB: b / 36, pAandB: both / 36, pAgivenB: b ? both / b : NaN, independent: both * 36 === a * b };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sampling and the central limit theorem (d089)
// ---------------------------------------------------------------------------------------------------------------------

export type PopKind = "skewed" | "normal" | "uniform";
export const POP_LABEL: Record<PopKind, string> = { skewed: "Skewed (lognormal)", normal: "Normal", uniform: "Uniform" };

/** A fixed population of N values, so the population mean and standard deviation (the parameters) are known exactly. */
export function makePopulation(kind: PopKind, size = 10000, seed = 2024): number[] {
  const rng = makeRng(seed);
  return Array.from({ length: size }, () => kind === "skewed" ? Math.exp(3 + 0.8 * rng.normal()) : kind === "normal" ? 50 + 10 * rng.normal() : 20 + 60 * rng.u());
}

export interface SamplingResult { means: number[]; popMean: number; popSd: number; n: number; reps: number; meanOfMeans: number; empiricalSe: number; theoreticalSe: number; skewOfMeans: number; skewOfPop: number }
/** Draw `reps` simple random samples (with replacement) of size n and keep each sample mean. */
export function samplingDistribution(pop: number[], n: number, reps: number, seed: number): SamplingResult {
  const rng = makeRng(seed), means: number[] = [];
  for (let r = 0; r < reps; r++) { let s = 0; for (let i = 0; i < n; i++) s += pop[rng.int(pop.length)]; means.push(s / n); }
  const popMean = mean(pop), popSd = sdPop(pop);
  return { means, popMean, popSd, n, reps, meanOfMeans: mean(means), empiricalSe: reps > 1 ? sdSample(means) : NaN, theoreticalSe: popSd / Math.sqrt(n), skewOfMeans: skewness(means), skewOfPop: skewness(pop) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Confidence intervals (d089)
// ---------------------------------------------------------------------------------------------------------------------

export interface Interval { lo: number; hi: number; margin: number; crit: number; se: number; df: number | null; kind: "z" | "t" }
export function zInterval(xbar: number, sigma: number, n: number, conf: number): Interval {
  const crit = normInv(1 - (1 - conf) / 2), se = sigma / Math.sqrt(n), margin = crit * se;
  return { lo: xbar - margin, hi: xbar + margin, margin, crit, se, df: null, kind: "z" };
}
export function tInterval(xbar: number, s: number, n: number, conf: number): Interval {
  const df = n - 1, crit = tInv(1 - (1 - conf) / 2, df), se = s / Math.sqrt(n), margin = crit * se;
  return { lo: xbar - margin, hi: xbar + margin, margin, crit, se, df, kind: "t" };
}

export interface CoverageInput { pop: "normal" | "skewed"; n: number; conf: number; reps: number; seed: number; method: "z" | "t" }
export interface CoverageResult { trueMean: number; sigma: number; intervals: (Interval & { mean: number; covers: boolean })[]; covered: number; reps: number; rate: number }
/** Draw `reps` seeded samples from a known population and build an interval from each; count those that contain the true mean. */
export function coverageSim(i: CoverageInput): CoverageResult {
  const rng = makeRng(i.seed);
  const trueMean = i.pop === "normal" ? 50 : Math.exp(3 + 0.8 ** 2 / 2);
  const sigma = i.pop === "normal" ? 10 : Math.sqrt((Math.exp(0.64) - 1) * Math.exp(6 + 0.64));
  const intervals = [];
  for (let r = 0; r < i.reps; r++) {
    const xs = Array.from({ length: i.n }, () => (i.pop === "normal" ? 50 + 10 * rng.normal() : Math.exp(3 + 0.8 * rng.normal())));
    const m = mean(xs);
    // z uses the true sigma (known, as in textbooks); t estimates it from the sample, as in practice.
    const iv = i.method === "z" ? zInterval(m, sigma, i.n, i.conf) : tInterval(m, sdSample(xs), i.n, i.conf);
    intervals.push({ ...iv, mean: m, covers: iv.lo <= trueMean && trueMean <= iv.hi });
  }
  const covered = intervals.filter((v) => v.covers).length;
  return { trueMean, sigma, intervals, covered, reps: i.reps, rate: covered / i.reps };
}

// ---------------------------------------------------------------------------------------------------------------------
// Hypothesis tests (d090, a103, a104)
// ---------------------------------------------------------------------------------------------------------------------

export type Alt = "two-sided" | "greater" | "less";
export type NullKind = "z" | "t" | "chi2";

export interface TestResult {
  name: string; kind: NullKind; stat: number; df: number | null; p: number; alt: Alt;
  /** Estimate and its standard error, for steps and intervals. */
  estimate?: number; se?: number; ci?: [number, number]; effect?: { name: string; value: number };
  steps: string[];
  /** Chi-square only. */
  expected?: number[][]; residuals?: number[][]; cramersV?: number; minExpected?: number;
}
export const decide = (p: number, alpha: number) => (p < alpha ? "reject H0" : "fail to reject H0");

function pFromStat(kind: NullKind, stat: number, df: number | null, alt: Alt): number {
  if (kind === "chi2") return chi2Sf(stat, df!);
  if (kind === "z") return alt === "two-sided" ? 2 * normSf(Math.abs(stat)) : alt === "greater" ? normSf(stat) : normCdf(stat);
  return alt === "two-sided" ? tTwoSided(stat, df!) : alt === "greater" ? tSf(stat, df!) : tCdf(stat, df!);
}
const altText = (alt: Alt, sym: string, v: string) => (alt === "two-sided" ? `H0: ${sym} = ${v}; H1: ${sym} is not ${v}` : alt === "greater" ? `H0: ${sym} = ${v}; H1: ${sym} > ${v}` : `H0: ${sym} = ${v}; H1: ${sym} < ${v}`);

/** One-sample z-test: the population standard deviation sigma is known. */
export function zTest1(xs: number[], mu0: number, sigma: number, alt: Alt): TestResult {
  const n = xs.length, m = mean(xs), se = sigma / Math.sqrt(n), z = (m - mu0) / se, p = pFromStat("z", z, null, alt);
  const crit = normInv(1 - 0.025);
  return {
    name: "One-sample z-test", kind: "z", stat: z, df: null, p, alt, estimate: m, se, ci: [m - crit * se, m + crit * se],
    steps: [altText(alt, "mu", r4(mu0)) + ".", `Sample mean = ${r4(m)} from n = ${n}. Standard error = sigma / sqrt(n) = ${r4(sigma)} / ${r4(Math.sqrt(n))} = ${r4(se)}.`, `z = (${r4(m)} - ${r4(mu0)}) / ${r4(se)} = ${r4(z)}.`, `Under H0, z follows the standard normal distribution. p-value = ${r4(p)}.`],
  };
}

/** One-sample t-test: sigma is estimated by the sample standard deviation, so the null distribution is Student t with n - 1 degrees of freedom. */
export function tTest1(xs: number[], mu0: number, alt: Alt, conf = 0.95): TestResult {
  const n = xs.length, m = mean(xs), s = sdSample(xs), se = s / Math.sqrt(n), df = n - 1, t = (m - mu0) / se, p = pFromStat("t", t, df, alt);
  const crit = tInv(1 - (1 - conf) / 2, df);
  return {
    name: "One-sample t-test", kind: "t", stat: t, df, p, alt, estimate: m, se, ci: [m - crit * se, m + crit * se], effect: { name: "Cohen's d", value: (m - mu0) / s },
    steps: [altText(alt, "mu", r4(mu0)) + ".", `Sample mean = ${r4(m)}, sample standard deviation s = ${r4(s)} (divided by n - 1), n = ${n}. Standard error = s / sqrt(n) = ${r4(se)}.`, `t = (${r4(m)} - ${r4(mu0)}) / ${r4(se)} = ${r4(t)} with df = n - 1 = ${df}.`, `Under H0, t follows the Student t distribution with ${df} degrees of freedom. p-value = ${r4(p)}.`],
  };
}

/** Welch's two-sample t-test: does not assume equal variances; degrees of freedom by Welch-Satterthwaite. */
export function welchTest(xs: number[], ys: number[], alt: Alt, conf = 0.95): TestResult {
  const n1 = xs.length, n2 = ys.length, m1 = mean(xs), m2 = mean(ys), v1 = varianceSample(xs), v2 = varianceSample(ys);
  const a = v1 / n1, b = v2 / n2, se = Math.sqrt(a + b), t = (m1 - m2) / se;
  const df = (a + b) ** 2 / (a ** 2 / (n1 - 1) + b ** 2 / (n2 - 1)), p = pFromStat("t", t, df, alt);
  const crit = tInv(1 - (1 - conf) / 2, df), sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  return {
    name: "Welch two-sample t-test", kind: "t", stat: t, df, p, alt, estimate: m1 - m2, se, ci: [m1 - m2 - crit * se, m1 - m2 + crit * se], effect: { name: "Cohen's d", value: (m1 - m2) / sp },
    steps: [altText(alt, "mu1 - mu2", "0") + ".", `Group A: mean ${r4(m1)}, variance ${r4(v1)}, n = ${n1}. Group B: mean ${r4(m2)}, variance ${r4(v2)}, n = ${n2}.`, `Standard error of the difference = sqrt(${r4(a)} + ${r4(b)}) = ${r4(se)}. t = (${r4(m1)} - ${r4(m2)}) / ${r4(se)} = ${r4(t)}.`, `Welch-Satterthwaite degrees of freedom = ${r4(df)} (not a whole number, and smaller than n1 + n2 - 2 = ${n1 + n2 - 2} when variances differ). p-value = ${r4(p)}.`],
  };
}

/** Chi-square test of independence on a contingency table (no continuity correction, like scipy with correction=False). */
export function chi2Independence(obs: number[][]): TestResult {
  const R = obs.length, C = obs[0].length, rows = obs.map(sum), cols = Array.from({ length: C }, (_, j) => sum(obs.map((r) => r[j]))), N = sum(rows);
  const expected = obs.map((_, i) => cols.map((c) => (rows[i] * c) / N));
  let stat = 0;
  const residuals = obs.map((r, i) => r.map((o, j) => { const e = expected[i][j]; stat += (o - e) ** 2 / e; return (o - e) / Math.sqrt(e); }));
  const df = (R - 1) * (C - 1), p = chi2Sf(stat, df), minExpected = Math.min(...expected.flat());
  return {
    name: "Chi-square test of independence", kind: "chi2", stat, df, p, alt: "greater", expected, residuals, minExpected, cramersV: Math.sqrt(stat / (N * Math.min(R - 1, C - 1))),
    steps: ["H0: the two variables are independent; H1: they are associated.", `Expected count for each cell = row total x column total / grand total (grand total ${N}).`, `Chi-square = sum of (O - E)^2 / E over ${R * C} cells = ${r4(stat)} with df = (${R} - 1)(${C} - 1) = ${df}.`, `Under H0 the statistic follows the chi-square distribution with ${df} df. p-value = ${r4(p)}.${minExpected < 5 ? ` Warning: the smallest expected count is ${r4(minExpected)}, below the usual minimum of 5, so the approximation is shaky.` : ""}`],
  };
}

/** Chi-square goodness of fit: do observed counts match the stated proportions? */
export function chi2GoodnessOfFit(obs: number[], probs: number[]): TestResult {
  const N = sum(obs), ps = probs.map((p) => p / sum(probs)), expected = ps.map((p) => p * N);
  const stat = sum(obs.map((o, i) => (o - expected[i]) ** 2 / expected[i])), df = obs.length - 1, p = chi2Sf(stat, df);
  return {
    name: "Chi-square goodness of fit", kind: "chi2", stat, df, p, alt: "greater", expected: [expected], residuals: [obs.map((o, i) => (o - expected[i]) / Math.sqrt(expected[i]))], minExpected: Math.min(...expected),
    steps: ["H0: the counts follow the stated proportions; H1: they do not.", `Expected count = total ${N} x proportion: ${expected.map(r4).join(", ")}.`, `Chi-square = sum of (O - E)^2 / E = ${r4(stat)} with df = categories - 1 = ${df}.`, `p-value = ${r4(p)}.`],
  };
}

/** The null distribution's density at x, for plotting. */
export function nullPdf(kind: NullKind, df: number | null): (x: number) => number {
  return kind === "z" ? (x) => normPdf(x) : kind === "t" ? (x) => tPdf(x, df!) : (x) => chi2Pdf(x, df!);
}
export function nullRange(kind: NullKind, df: number | null, stat: number): [number, number] {
  if (kind === "chi2") return [0, Math.max(chi2Inv(0.999, df!), stat * 1.15, 6)];
  const w = Math.max(4, Math.abs(stat) * 1.2);
  return [-w, w];
}
/** Intervals of the x axis whose area is the p-value. */
export function pValueRegions(kind: NullKind, stat: number, alt: Alt, hi: number, lo: number): [number, number][] {
  if (kind === "chi2") return [[stat, hi]];
  if (alt === "two-sided") return [[lo, -Math.abs(stat)], [Math.abs(stat), hi]];
  return alt === "greater" ? [[stat, hi]] : [[lo, stat]];
}
/** Critical values that bound the rejection region at significance level alpha. */
export function criticalValues(kind: NullKind, df: number | null, alpha: number, alt: Alt): number[] {
  const q = (p: number) => (kind === "z" ? normInv(p) : tInv(p, df!));
  if (kind === "chi2") return [chi2Inv(1 - alpha, df!)];
  return alt === "two-sided" ? [-q(1 - alpha / 2), q(1 - alpha / 2)] : alt === "greater" ? [q(1 - alpha)] : [q(alpha)];
}

// Type I error, Type II error and power ------------------------------------------------------------------------------

/** Exact power of a z-test for a true mean shift `delta` (two-sided or one-sided greater). */
export function powerZ(delta: number, sigma: number, n: number, alpha: number, alt: Alt = "two-sided"): number {
  const shift = (delta * Math.sqrt(n)) / sigma;
  if (alt === "two-sided") { const zc = normInv(1 - alpha / 2); return normSf(zc - shift) + normCdf(-zc - shift); }
  const zc = normInv(1 - alpha);
  return alt === "greater" ? normSf(zc - shift) : normCdf(-zc + shift);
}
export interface ErrorSim { reps: number; typeIRate: number; powerSim: number; typeIISim: number; powerExact: number; typeIExact: number }
/** Run many seeded z-tests: with the null true (rejections are Type I errors) and with a real shift (non-rejections are Type II errors). */
export function errorSim(o: { delta: number; sigma: number; n: number; alpha: number; reps: number; seed: number }): ErrorSim {
  const rng = makeRng(o.seed), zc = normInv(1 - o.alpha / 2), se = o.sigma / Math.sqrt(o.n);
  let fp = 0, tp = 0;
  const draw = (shift: number) => { let s = 0; for (let i = 0; i < o.n; i++) s += shift + o.sigma * rng.normal(); return Math.abs(s / o.n / se) > zc; };
  for (let r = 0; r < o.reps; r++) { if (draw(0)) fp++; if (draw(o.delta)) tp++; }
  return { reps: o.reps, typeIRate: fp / o.reps, powerSim: tp / o.reps, typeIISim: 1 - tp / o.reps, powerExact: powerZ(o.delta, o.sigma, o.n, o.alpha), typeIExact: o.alpha };
}

// ---------------------------------------------------------------------------------------------------------------------
// Correlation and regression (a101, a102)
// ---------------------------------------------------------------------------------------------------------------------

export interface Pt { x: number; y: number }
export const covarianceSample = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); return sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / (xs.length - 1); };
export function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  const sxy = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))), sxx = sum(xs.map((x) => (x - mx) ** 2)), syy = sum(ys.map((y) => (y - my) ** 2));
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
}
/** Average ranks (ties share the mean of the ranks they occupy), 1-based. */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) out[idx[k][1]] = r; i = j + 1; }
  return out;
}
/** Spearman's rank correlation: Pearson's r of the ranks. */
export const spearman = (xs: number[], ys: number[]) => pearson(ranks(xs), ranks(ys));
/** Two-sided p-value for a correlation r with n pairs: t = r sqrt((n - 2) / (1 - r^2)), df = n - 2. */
export function corrPValue(r: number, n: number): number {
  if (n < 3 || !Number.isFinite(r)) return NaN;
  if (Math.abs(r) >= 1) return 0;
  return tTwoSided(r * Math.sqrt((n - 2) / (1 - r * r)), n - 2);
}

export interface Fit { n: number; slope: number; intercept: number; r: number; r2: number; residuals: number[]; fitted: number[]; sse: number; sst: number; seSlope: number; pSlope: number; sRes: number }
/** Ordinary least squares: the line that minimises the sum of squared vertical distances (residuals). */
export function ols(pts: Pt[]): Fit {
  const n = pts.length, xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), mx = mean(xs), my = mean(ys);
  const sxx = sum(xs.map((x) => (x - mx) ** 2)), sxy = sum(pts.map((p) => (p.x - mx) * (p.y - my))), sst = sum(ys.map((y) => (y - my) ** 2));
  const slope = sxx === 0 ? NaN : sxy / sxx, intercept = my - slope * mx;
  const fitted = xs.map((x) => intercept + slope * x), residuals = ys.map((y, i) => y - fitted[i]), sse = sum(residuals.map((e) => e * e));
  const r2 = sst === 0 ? NaN : 1 - sse / sst, sRes = n > 2 ? Math.sqrt(sse / (n - 2)) : NaN, seSlope = sRes / Math.sqrt(sxx);
  const pSlope = n > 2 && Number.isFinite(seSlope) ? (seSlope === 0 ? 0 : tTwoSided(slope / seSlope, n - 2)) : NaN;
  return { n, slope, intercept, r: pearson(xs, ys), r2, residuals, fitted, sse, sst, seSlope, pSlope, sRes };
}
/** Correlation of x and y after removing what z explains in each (partial correlation). */
export function partialCorrelation(xs: number[], ys: number[], zs: number[]): number {
  const rx = ols(xs.map((x, i) => ({ x: zs[i], y: x }))).residuals, ry = ols(ys.map((y, i) => ({ x: zs[i], y }))).residuals;
  return pearson(rx, ry);
}

export type RelationSet = "linear" | "curved" | "outlier" | "causation";
export const RELATION_SETS: { id: RelationSet; label: string; note: string; xLabel: string; yLabel: string }[] = [
  { id: "linear", label: "Roughly linear", note: "y rises with x with random noise.", xLabel: "x", yLabel: "y" },
  { id: "curved", label: "Curved (monotonic)", note: "A perfect upward curve: Spearman is exactly 1, Pearson is lower because the shape is not a line.", xLabel: "x", yLabel: "y" },
  { id: "outlier", label: "One outlier", note: "Linear data with one far-away point. Move or delete it and watch r, the slope and R squared.", xLabel: "x", yLabel: "y" },
  { id: "causation", label: "Ice cream and drownings", note: "Both rise with temperature. Neither causes the other.", xLabel: "ice cream sales (per day)", yLabel: "drownings (per month)" },
];

export interface CausationData { pts: Pt[]; temps: number[] }
/** Seeded fixture: a hidden common cause (temperature) drives both series. */
export function causationData(seed = 7): CausationData {
  const rng = makeRng(seed), temps: number[] = [], pts: Pt[] = [];
  for (let i = 0; i < 24; i++) {
    const t = 5 + (i % 12) * 2.3 + rng.normal() * 1.5;
    temps.push(Math.round(t * 10) / 10);
    pts.push({ x: Math.round(40 + 12 * t + rng.normal() * 25), y: Math.round((1 + 0.35 * t + rng.normal() * 1.2) * 10) / 10 });
  }
  return { pts, temps };
}
export function relationPoints(id: RelationSet, seed = 11): Pt[] {
  const rng = makeRng(seed);
  switch (id) {
    case "linear": return Array.from({ length: 20 }, (_, i) => ({ x: i + 1, y: Math.round((2 * (i + 1) + 3 + rng.normal() * 5) * 10) / 10 }));
    case "curved": return Array.from({ length: 15 }, (_, i) => ({ x: i + 1, y: (i + 1) ** 3 / 10 }));
    case "outlier": return [...Array.from({ length: 15 }, (_, i) => ({ x: i + 1, y: Math.round((1.5 * (i + 1) + 4 + rng.normal() * 2.5) * 10) / 10 })), { x: 16, y: 3 }];
    case "causation": return causationData().pts;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Presets (a lesson links with ?preset=<id>)
// ---------------------------------------------------------------------------------------------------------------------

export type StatsTab = "distributions" | "summary" | "probability" | "sampling" | "intervals" | "tests" | "relationships";
export const TABS: { id: StatsTab; label: string }[] = [
  { id: "distributions", label: "Distributions" }, { id: "summary", label: "Summary statistics" }, { id: "probability", label: "Probability" },
  { id: "sampling", label: "Sampling and CLT" }, { id: "intervals", label: "Confidence intervals" }, { id: "tests", label: "Hypothesis tests" }, { id: "relationships", label: "Correlation and regression" },
];
export interface StatsPreset { id: string; label: string; tab: StatsTab; mode?: string }
export const PRESETS: StatsPreset[] = [
  { id: "normal", label: "Normal distribution", tab: "distributions", mode: "normal" },
  { id: "uniform", label: "Uniform distribution", tab: "distributions", mode: "uniform" },
  { id: "binomial", label: "Binomial distribution", tab: "distributions", mode: "binomial" },
  { id: "poisson", label: "Poisson distribution", tab: "distributions", mode: "poisson" },
  { id: "exponential", label: "Exponential distribution", tab: "distributions", mode: "exponential" },
  { id: "skewed", label: "Skewed distribution: mean versus median", tab: "distributions", mode: "lognormal" },
  { id: "outliers", label: "Outliers: mean, median and mode", tab: "distributions", mode: "outlier" },
  { id: "descriptive", label: "Mean, median, mode, range and IQR", tab: "summary", mode: "steps" },
  { id: "variance", label: "Variance and standard deviation: n versus n - 1", tab: "summary", mode: "variance" },
  { id: "lln", label: "Law of large numbers: coins, dice, cards", tab: "probability", mode: "lln" },
  { id: "conditional", label: "Conditional probability", tab: "probability", mode: "conditional" },
  { id: "bayes", label: "Bayes' rule with natural frequencies", tab: "probability", mode: "bayes" },
  { id: "sampling", label: "Sampling distribution of the mean", tab: "sampling", mode: "sampling" },
  { id: "clt", label: "Central limit theorem", tab: "sampling", mode: "clt" },
  { id: "confidence", label: "Confidence intervals: z and t", tab: "intervals", mode: "interval" },
  { id: "coverage", label: "Interval coverage: 100 samples", tab: "intervals", mode: "coverage" },
  { id: "z-test", label: "One-sample z-test", tab: "tests", mode: "z" },
  { id: "t-test", label: "One-sample t-test", tab: "tests", mode: "t" },
  { id: "welch", label: "Two-sample Welch t-test", tab: "tests", mode: "welch" },
  { id: "chi-square", label: "Chi-square test of independence", tab: "tests", mode: "chi-indep" },
  { id: "goodness-of-fit", label: "Chi-square goodness of fit", tab: "tests", mode: "chi-gof" },
  { id: "errors-power", label: "Type I error, Type II error and power", tab: "tests", mode: "power" },
  { id: "correlation", label: "Pearson and Spearman correlation", tab: "relationships", mode: "linear" },
  { id: "regression", label: "Linear regression and residuals", tab: "relationships", mode: "linear" },
  { id: "outlier-effect", label: "Effect of an outlier on correlation and regression", tab: "relationships", mode: "outlier" },
  { id: "causation", label: "Correlation is not causation", tab: "relationships", mode: "causation" },
];
export const presetById = (id?: string) => PRESETS.find((p) => p.id === id);
