/**
 * Result-set comparison for grading — a port of backend/app/utils/result_compare.py
 * so the public site grades in the browser with the same rules.
 */

export interface ComparisonResult {
  match: boolean;
  message: string;
  feedback: string[];
  yourRowCount: number;
  expectedRowCount: number;
}

const MISMATCH = "Your query runs successfully, but the result does not match the expected result.";
const CORRECT = "Correct! Your query produces the expected result.";

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isInteger(value) ? value : Math.round(value * 1e6) / 1e6;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const s = value.trim();
    // NUMERIC columns arrive as strings; compare them as numbers.
    if (/^-?\d+(\.\d+)?$/.test(s)) return normalizeValue(Number(s));
    return s;
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  return JSON.stringify(value);
}

function rowKey(row: unknown[]): string {
  return JSON.stringify(row.map(normalizeValue));
}

const normalizeColumns = (cols: string[]) => cols.map((c) => c.trim().toLowerCase());

export interface OrderKey {
  column: string;
  desc: boolean;
}

/** Column indexes for ORDER BY keys, or null if any key isn't an output column/ordinal. */
function keyIndexes(columns: string[], keys: OrderKey[]): number[] | null {
  const cols = normalizeColumns(columns);
  const idx = keys.map((k) => (/^\d+$/.test(k.column) ? Number(k.column) - 1 : cols.indexOf(k.column.toLowerCase())));
  return idx.every((i) => i >= 0 && i < cols.length) ? idx : null;
}

/**
 * @param orderBy  the reference query's top-level ORDER BY keys. When given, rows that tie on
 *                 those keys may appear in any order; otherwise ordering is compared strictly.
 */
export function compareResults(
  userColumns: string[],
  userRows: unknown[][],
  expectedColumns: string[],
  expectedRows: unknown[][],
  sortRequired = false,
  orderBy: OrderKey[] | null = null,
): ComparisonResult {
  const base = { yourRowCount: userRows.length, expectedRowCount: expectedRows.length };
  const u = normalizeColumns(userColumns);
  const e = normalizeColumns(expectedColumns);

  if (u.length !== e.length || u.some((c, i) => c !== e[i])) {
    return {
      ...base,
      match: false,
      message: MISMATCH,
      feedback: [
        "Check your column names and column order.",
        `Your columns: ${userColumns.join(", ") || "(none)"}`,
        `Expected columns: ${expectedColumns.join(", ")}`,
      ],
    };
  }

  if (userRows.length !== expectedRows.length) {
    return {
      ...base,
      match: false,
      message: MISMATCH,
      feedback: [
        `Your query returned: ${userRows.length} rows`,
        `Expected result: ${expectedRows.length} rows`,
        "Check:",
        "• Your filtering conditions",
        "• Your grouping logic",
        "• Whether duplicate rows are being preserved",
      ],
    };
  }

  const userKeys = userRows.map(rowKey);
  const expectedKeys = expectedRows.map(rowKey);

  const sameMultiset = () => {
    const a = [...userKeys].sort();
    const b = [...expectedKeys].sort();
    return a.every((k, i) => k === b[i]);
  };
  const keyIdx = sortRequired && orderBy?.length ? keyIndexes(expectedColumns, orderBy) : null;

  if (keyIdx) {
    if (!sameMultiset()) {
      return {
        ...base,
        match: false,
        message: MISMATCH,
        feedback: ["Row values do not match.", "Check:", "• Your filtering conditions", "• Your grouping logic", "• Whether duplicate rows are being preserved"],
      };
    }
    // Both results come from PostgreSQL, so their sequences of sort-key values must agree;
    // rows that tie on every key may legitimately appear in either order.
    const seq = (rows: unknown[][]) => rows.map((r) => JSON.stringify(keyIdx.map((i) => normalizeValue(r[i]))));
    const u = seq(userRows);
    const e = seq(expectedRows);
    if (u.some((k, i) => k !== e[i])) {
      const keys = orderBy!.map((k) => `${k.column}${k.desc ? " DESC" : ""}`).join(", ");
      return {
        ...base,
        match: false,
        message: MISMATCH,
        feedback: ["The rows are right, but the order is not.", `Expected order: ORDER BY ${keys}`],
      };
    }
  } else if (sortRequired) {
    if (userKeys.some((k, i) => k !== expectedKeys[i])) {
      return {
        ...base,
        match: false,
        message: MISMATCH,
        feedback: [
          "Results differ — ordering may be required.",
          "Check:",
          "• Your ORDER BY clause",
          "• Your filtering and grouping logic",
          "• Column values and sort direction",
        ],
      };
    }
  } else {
    if (!sameMultiset()) {
      return {
        ...base,
        match: false,
        message: MISMATCH,
        feedback: [
          "Row values do not match.",
          "Check:",
          "• Your filtering conditions",
          "• Your grouping logic",
          "• Whether duplicate rows are being preserved",
        ],
      };
    }
  }

  return { ...base, match: true, message: CORRECT, feedback: [] };
}

/**
 * Multiset difference between two results with the same column count: rows the
 * expected result has that yours lacks, and rows you return that it doesn't.
 */
export function rowDiff(userRows: unknown[][], expectedRows: unknown[][], sample = 5) {
  const counts = new Map<string, number>();
  for (const r of expectedRows) counts.set(rowKey(r), (counts.get(rowKey(r)) ?? 0) + 1);
  const extra: unknown[][] = [];
  for (const r of userRows) {
    const k = rowKey(r);
    const n = counts.get(k) ?? 0;
    if (n > 0) counts.set(k, n - 1);
    else extra.push(r);
  }
  const missing: unknown[][] = [];
  const left = new Map(counts);
  for (const r of expectedRows) {
    const k = rowKey(r);
    const n = left.get(k) ?? 0;
    if (n > 0) {
      missing.push(r);
      left.set(k, n - 1);
    }
  }
  return { missing: missing.slice(0, sample), extra: extra.slice(0, sample), missingCount: missing.length, extraCount: extra.length };
}

/**
 * Explain *why* two results differ, in terms a learner can act on. Every statement is
 * derived from the two result sets; nothing is guessed about the SQL itself.
 */
export function diagnose(userColumns: string[], userRows: unknown[][], expectedColumns: string[], expectedRows: unknown[][]): string[] {
  const out: string[] = [];
  const u = normalizeColumns(userColumns);
  const e = normalizeColumns(expectedColumns);
  if (u.join() !== e.join()) {
    if (u.length === e.length && [...u].sort().join() === [...e].sort().join()) {
      out.push(`Same columns, different order — expected: ${expectedColumns.join(", ")}.`);
    } else if (u.length === e.length) {
      const renames = e.map((c, i) => (u[i] !== c ? `${userColumns[i]} → ${expectedColumns[i]}` : null)).filter(Boolean);
      out.push(`Rename column(s): ${renames.join(", ")} (use AS).`);
    } else {
      const missing = e.filter((c) => !u.includes(c));
      const extra = u.filter((c) => !e.includes(c));
      if (missing.length) out.push(`Missing column(s): ${missing.join(", ")}.`);
      if (extra.length) out.push(`Unexpected column(s): ${extra.join(", ")}.`);
    }
    return out;
  }

  const ukeys = userRows.map(rowKey);
  const ekeys = new Set(expectedRows.map(rowKey));
  const udistinct = new Set(ukeys).size;
  if (udistinct < ukeys.length && udistinct === expectedRows.length && ukeys.every((k) => ekeys.has(k))) {
    out.push(`Your result has ${ukeys.length - udistinct} duplicate row(s) but otherwise the right rows — a join may be multiplying rows (fan-out), or DISTINCT/GROUP BY is missing.`);
    return out;
  }
  const d = rowDiff(userRows, expectedRows, 1000);
  if (d.extraCount && !d.missingCount) out.push(`You return every expected row plus ${d.extraCount} extra — a filter is missing or too loose.`);
  if (d.missingCount && !d.extraCount) {
    out.push(`${d.missingCount} expected row(s) are missing — a filter may be too strict, or an INNER JOIN is dropping rows without a match (LEFT JOIN keeps them).`);
  }
  if (d.missingCount && d.extraCount) {
    // Pair rows that agree on every column but one, to name the exact difference.
    let rounding = 0;
    let nullVsZero = 0;
    const cols = expectedColumns.length;
    for (const m of d.missing) {
      for (const x of d.extra) {
        const diffAt = [...Array(cols).keys()].filter((i) => JSON.stringify(normalizeValue(m[i])) !== JSON.stringify(normalizeValue(x[i])));
        if (diffAt.length !== 1) continue;
        const a = normalizeValue(m[diffAt[0]]);
        const b = normalizeValue(x[diffAt[0]]);
        if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= Math.max(0.011, Math.abs(a) * 1e-4)) rounding++;
        else if ((a === 0 && b === null) || (a === null && b === 0)) nullVsZero++;
        break;
      }
    }
    if (rounding) out.push(`${rounding} row(s) differ only by rounding — check ROUND(…::numeric, 2) and where you round (before or after aggregating).`);
    if (nullVsZero) out.push(`${nullVsZero} row(s) differ only by NULL vs 0 — COALESCE(…, 0) turns a missing aggregate into 0 (or the other way round).`);
    if (!rounding && !nullVsZero) out.push(`${d.missingCount} expected row(s) are missing and ${d.extraCount} unexpected row(s) appear — compare the samples below.`);
  }
  return out;
}
