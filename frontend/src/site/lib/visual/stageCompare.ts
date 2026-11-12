import type { Visualization } from "../visualize";

export interface StageCompareRow { clause: string; a?: { rowsOut?: number; source?: string }; b?: { rowsOut?: number; source?: string }; same: boolean }

/** Line two visualizations up by clause. A clause only one query has is shown with the other side empty. */
export function compareStages(a: Visualization | undefined, b: Visualization | undefined): StageCompareRow[] {
  const order: string[] = [];
  for (const v of [a, b]) for (const s of v?.stages ?? []) if (!order.includes(s.clause)) order.push(s.clause);
  const pick = (v: Visualization | undefined, c: string) => {
    const s = v?.stages.find((x) => x.clause === c);
    return s ? { rowsOut: s.rowsOut, source: s.source } : undefined;
  };
  return order.map((clause) => {
    const x = pick(a, clause), y = pick(b, clause);
    return { clause, a: x, b: y, same: !!x && !!y && x.rowsOut === y.rowsOut };
  });
}

/** Operations a query performs, from its logical stages (which clauses it uses). */
export const operationsOf = (v: Visualization | undefined) => (v?.stages ?? []).map((s) => s.clause);
