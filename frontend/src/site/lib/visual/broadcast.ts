/**
 * NumPy broadcasting and matrix-multiplication shape arithmetic. Pure: real shapes in, an alignment table out.
 *
 * The shapes always come from arrays that were really executed in Pyodide (see dataframe.ts). The table here is what the rule predicts;
 * `crossCheckBroadcast` and `crossCheckMatmul` compare that prediction with what NumPy really did (the result's shape, or NumPy's own
 * error text), so a visual can never silently disagree with the run.
 *
 * Rule (NumPy): align the shapes on the right. Two sizes in one position are compatible when they are equal or one of them is 1
 * (that one is "stretched"). A missing position (the operand has fewer dimensions) counts as 1. Otherwise the shapes are incompatible.
 */

export type DimStatus = "equal" | "stretch" | "missing" | "incompatible";

export interface DimCell {
  /** Size of this operand in this position, or null when the operand has no such dimension. */
  size: number | null;
  /** Position inside the operand's own shape (0-based from the left), or null when missing. */
  axis: number | null;
  status: DimStatus;
}

export interface BroadcastRow {
  /** 0 is the last axis, 1 the one before it, and so on (the order the rule is applied in). */
  fromRight: number;
  /** Position in the result shape (0-based from the left). */
  outAxis: number;
  cells: DimCell[];
  /** Size in the result, or null when the operands conflict here. */
  resultSize: number | null;
  status: "equal" | "stretched" | "incompatible";
}

export interface BroadcastConflict {
  fromRight: number;
  /** Negative axis number as NumPy writes it (-1 is the last axis). */
  axisNegative: number;
  /** The conflicting sizes with the operand and its own axis index. */
  sizes: { operand: number; axis: number; size: number }[];
}

export interface BroadcastTable {
  shapes: number[][];
  ndim: number;
  /** One row per aligned position, last axis first (the order of the rule). */
  rows: BroadcastRow[];
  valid: boolean;
  resultShape: number[] | null;
  conflicts: BroadcastConflict[];
  /** Plain-language verdict built from the real shapes. */
  message: string;
  /** The text NumPy would raise for these shapes (only when invalid). Cross-checked against the real error by `crossCheckBroadcast`. */
  numpyMessage: string | null;
}

/** NumPy's way of writing a shape inside its error text: (2,3), (3,), (). */
export function numpyShape(s: readonly number[]): string {
  return s.length === 0 ? "()" : s.length === 1 ? `(${s[0]},)` : `(${s.join(",")})`;
}
/** Python's way (tuple repr): (2, 3), (3,), (). */
export function pyShape(s: readonly number[]): string {
  return s.length === 0 ? "()" : s.length === 1 ? `(${s[0]},)` : `(${s.join(", ")})`;
}

const ordinal = (i: number) => (i === 0 ? "first" : i === 1 ? "second" : i === 2 ? "third" : `#${i + 1}`);

/** Align N shapes (usually 2) on the right and decide, per position, equal / stretched / incompatible. Never throws. */
export function alignShapes(shapes: readonly (readonly number[])[]): BroadcastTable {
  const sh = shapes.map((s) => [...s]);
  const ndim = sh.reduce((m, s) => Math.max(m, s.length), 0);
  const rows: BroadcastRow[] = [];
  const conflicts: BroadcastConflict[] = [];
  for (let r = 0; r < ndim; r++) {
    const outAxis = ndim - 1 - r;
    const raw = sh.map((s, op) => {
      const axis = s.length - 1 - r;
      return axis >= 0 ? { op, axis, size: s[axis] } : { op, axis: -1, size: null as number | null };
    });
    const distinct = [...new Set(raw.filter((c) => c.size !== null && c.size !== 1).map((c) => c.size as number))];
    const conflict = distinct.length > 1;
    const resultSize = conflict ? null : distinct.length === 1 ? distinct[0] : 1;
    const cells: DimCell[] = raw.map((c) => {
      if (c.size === null) return { size: null, axis: null, status: "missing" as const };
      if (conflict) return { size: c.size, axis: c.axis, status: c.size === 1 ? ("stretch" as const) : ("incompatible" as const) };
      return { size: c.size, axis: c.axis, status: c.size === resultSize ? ("equal" as const) : ("stretch" as const) };
    });
    if (conflict) {
      conflicts.push({
        fromRight: r, axisNegative: -(r + 1),
        sizes: raw.filter((c) => c.size !== null && c.size !== 1).map((c) => ({ operand: c.op, axis: c.axis, size: c.size as number })),
      });
    }
    const anyStretch = cells.some((c) => c.status === "stretch" || c.status === "missing");
    rows.push({ fromRight: r, outAxis, cells, resultSize, status: conflict ? "incompatible" : anyStretch ? "stretched" : "equal" });
  }
  const valid = conflicts.length === 0;
  const resultShape = valid ? rows.map((r) => r.resultSize as number).reverse() : null;
  const names = sh.map(numpyShape);
  const numpyMessage = valid ? null : `operands could not be broadcast together with shapes ${names.join(" ")} `;
  let message: string;
  if (valid) {
    message = sh.length === 0 ? "Nothing to broadcast." : `Shapes ${names.join(" and ")} are compatible. The result has shape ${numpyShape(resultShape!)}.`;
  } else {
    const parts = conflicts.map((c) => `axis ${c.axisNegative} (${c.fromRight === 0 ? "the last axis" : `${c.fromRight + 1}${c.fromRight === 1 ? "nd" : c.fromRight === 2 ? "rd" : "th"} from the right`}) has sizes ${c.sizes.map((s) => `${s.size} (${ordinal(s.operand)} array, axis ${s.axis})`).join(" and ")}; neither is 1`);
    message = `Shapes ${names.join(" and ")} cannot be broadcast: ${parts.join("; ")}.`;
  }
  return { shapes: sh, ndim, rows, valid, resultShape, conflicts, message, numpyMessage };
}

/** For one result index, the index into an operand of the given shape (broadcast dimensions read element 0). */
export function operandIndex(outIndex: readonly number[], shape: readonly number[]): number[] {
  const off = outIndex.length - shape.length;
  return shape.map((size, i) => (size === 1 ? 0 : outIndex[i + off]));
}

/** Shapes quoted in NumPy's broadcast error, e.g. "operands could not be broadcast together with shapes (2,3) (4,) ". Null if the text is something else. */
export function parseBroadcastError(text: string): number[][] | null {
  const m = /could not be broadcast together with shapes\s+((?:\([^)]*\)\s*)+)/.exec(text);
  if (!m) return null;
  return [...m[1].matchAll(/\(([^)]*)\)/g)].map((g) => g[1].split(",").map((x) => x.trim()).filter(Boolean).map(Number));
}

export interface Check { name: string; ok: boolean; detail: string }
export interface CrossCheck { ok: boolean; checks: Check[] }

const sameShape = (a: readonly number[] | null | undefined, b: readonly number[] | null | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Compare the table with what NumPy really did.
 * - the run succeeded: the real result shape must equal the predicted one, and the table must be valid;
 * - the run failed with a broadcast error: the table must be invalid and the shapes NumPy quotes must be the shapes we aligned.
 */
export function crossCheckBroadcast(table: BroadcastTable, actual: { resultShape?: readonly number[] | null; errorText?: string | null }): CrossCheck {
  const checks: Check[] = [];
  if (actual.errorText) {
    const quoted = parseBroadcastError(actual.errorText);
    if (!quoted) {
      checks.push({ name: "error kind", ok: false, detail: `The run failed, but not with a broadcast error: ${actual.errorText.split("\n").pop()}` });
    } else {
      checks.push({ name: "shapes match NumPy's error", ok: quoted.length === table.shapes.length && quoted.every((s, i) => sameShape(s, table.shapes[i])), detail: `NumPy quotes ${quoted.map(numpyShape).join(" ")}; the table aligned ${table.shapes.map(numpyShape).join(" ")}.` });
      checks.push({ name: "table predicts the failure", ok: !table.valid, detail: table.valid ? "The table says these shapes broadcast, but NumPy refused." : "The table also finds an incompatible axis." });
    }
  } else {
    checks.push({ name: "table predicts success", ok: table.valid, detail: table.valid ? "The shapes are compatible and the run succeeded." : "The table says these shapes cannot broadcast, but the run succeeded." });
    if (table.valid && actual.resultShape) {
      checks.push({ name: "result shape", ok: sameShape(table.resultShape, actual.resultShape), detail: `Predicted ${numpyShape(table.resultShape ?? [])}, NumPy returned ${numpyShape(actual.resultShape)}.` });
    }
  }
  return { ok: checks.every((c) => c.ok), checks };
}

// ── Matrix multiplication ────────────────────────────────────────────────

export interface MatmulPlan {
  a: number[];
  b: number[];
  valid: boolean;
  resultShape: number[] | null;
  /** The two sizes that must be equal (a's last axis and b's second-to-last, or its only axis). Null when an operand is 0-d. */
  inner: { a: number; b: number } | null;
  /** Leading (batch) dimensions when an operand has more than 2 dimensions. */
  batch: BroadcastTable | null;
  /** Short rule statement with the real shapes, e.g. "(2,3) @ (3,4) -> (2,4)". */
  rule: string;
  message: string;
  /** What NumPy's `@`/np.matmul raises, built from the shapes (only when invalid). */
  numpyMessage: string | null;
  /** What np.dot raises for the same mistake. */
  dotMessage: string | null;
}

/** Shape rule of `a @ b` / np.matmul. */
export function planMatmul(aShape: readonly number[], bShape: readonly number[]): MatmulPlan {
  const a = [...aShape], b = [...bShape];
  const base = { a, b, batch: null as BroadcastTable | null };
  if (a.length === 0 || b.length === 0) {
    const which = a.length === 0 ? 0 : 1;
    const msg = `matmul: Input operand ${which} does not have enough dimensions (has 0, gufunc core with signature (n?,k),(k,m?)->(n?,m?) requires 1)`;
    return { ...base, valid: false, resultShape: null, inner: null, rule: `${numpyShape(a)} @ ${numpyShape(b)}`, message: `matmul needs arrays with at least 1 dimension; the ${which === 0 ? "first" : "second"} operand is a scalar. Use * for scalar multiplication.`, numpyMessage: msg, dotMessage: null };
  }
  const ka = a[a.length - 1];
  const kbIndex = b.length === 1 ? 0 : b.length - 2;
  const kb = b[kbIndex];
  const inner = { a: ka, b: kb };
  const rule = (res: string) => `${numpyShape(a)} @ ${numpyShape(b)} -> ${res}`;
  if (ka !== kb) {
    const numpyMessage = `matmul: Input operand 1 has a mismatch in its core dimension 0, with gufunc signature (n?,k),(k,m?)->(n?,m?) (size ${kb} is different from ${ka})`;
    const dotMessage = `shapes ${numpyShape(a)} and ${numpyShape(b)} not aligned: ${ka} (dim ${a.length - 1}) != ${kb} (dim ${kbIndex})`;
    return {
      ...base, valid: false, resultShape: null, inner, rule: rule("error"),
      message: `Inner dimensions differ: the first array has ${ka} columns (its last axis) but the second has ${kb} rows (axis ${kbIndex}). They must be equal.`,
      numpyMessage, dotMessage,
    };
  }
  const aBatch = a.length > 2 ? a.slice(0, -2) : [];
  const bBatch = b.length > 2 ? b.slice(0, -2) : [];
  let batch: BroadcastTable | null = null;
  let lead: number[] = [];
  if (aBatch.length || bBatch.length) {
    batch = alignShapes([aBatch, bBatch]);
    if (!batch.valid) {
      return { ...base, batch, valid: false, resultShape: null, inner, rule: rule("error"), message: `The leading (batch) dimensions ${numpyShape(aBatch)} and ${numpyShape(bBatch)} cannot be broadcast.`, numpyMessage: null, dotMessage: null };
    }
    lead = batch.resultShape!;
  }
  const m = a.length >= 2 ? [a[a.length - 2]] : [];
  const p = b.length >= 2 ? [b[b.length - 1]] : [];
  const resultShape = [...lead, ...m, ...p];
  return {
    ...base, batch, valid: true, resultShape, inner, rule: rule(numpyShape(resultShape)),
    message: `Inner dimensions match (${ka} = ${kb}), so they are summed away. The result has shape ${numpyShape(resultShape)}.`,
    numpyMessage: null, dotMessage: null,
  };
}

/** Compare the matmul prediction with the real result shape or NumPy's real error text (`@`/np.matmul or np.dot wording). */
export function crossCheckMatmul(plan: MatmulPlan, actual: { resultShape?: readonly number[] | null; errorText?: string | null }): CrossCheck {
  const checks: Check[] = [];
  if (actual.errorText) {
    const t = actual.errorText;
    const mm = /size (\d+) is different from (\d+)/.exec(t);
    const dd = /not aligned: (\d+) \(dim (\d+)\) != (\d+) \(dim (\d+)\)/.exec(t);
    if (mm && plan.inner) {
      checks.push({ name: "table predicts the failure", ok: !plan.valid, detail: plan.valid ? "The rule says these shapes multiply, but NumPy refused." : "The rule also finds mismatched inner dimensions." });
      checks.push({ name: "sizes match NumPy's error", ok: Number(mm[1]) === plan.inner.b && Number(mm[2]) === plan.inner.a, detail: `NumPy says size ${mm[1]} is different from ${mm[2]}; the rule compares ${plan.inner.b} (second array) with ${plan.inner.a} (first array).` });
    } else if (dd && plan.inner) {
      checks.push({ name: "table predicts the failure", ok: !plan.valid, detail: plan.valid ? "The rule says these shapes multiply, but NumPy refused." : "The rule also finds mismatched inner dimensions." });
      checks.push({ name: "sizes match NumPy's error", ok: Number(dd[1]) === plan.inner.a && Number(dd[3]) === plan.inner.b, detail: `NumPy says ${dd[1]} != ${dd[3]}; the rule compares ${plan.inner.a} (first array) with ${plan.inner.b} (second array).` });
    } else if (/could not be broadcast together with remapped shapes/.test(t)) {
      checks.push({ name: "batch dimensions", ok: !!plan.batch && !plan.batch.valid, detail: plan.batch && !plan.batch.valid ? "NumPy could not broadcast the leading (batch) dimensions, and the rule finds the same conflict." : "NumPy reports a batch-dimension conflict that the rule did not predict." });
    } else {
      checks.push({ name: "error kind", ok: false, detail: `The run failed with a different error: ${t.split("\n").pop()}` });
    }
  } else {
    checks.push({ name: "rule predicts success", ok: plan.valid, detail: plan.valid ? "The inner dimensions match and the run succeeded." : "The rule says these shapes cannot multiply, but the run succeeded." });
    if (plan.valid && actual.resultShape) checks.push({ name: "result shape", ok: sameShape(plan.resultShape, actual.resultShape), detail: `Predicted ${numpyShape(plan.resultShape ?? [])}, NumPy returned ${numpyShape(actual.resultShape)}.` });
  }
  return { ok: checks.every((c) => c.ok), checks };
}
