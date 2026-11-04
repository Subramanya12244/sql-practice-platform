/** Renders `EXPLAIN (FORMAT JSON)` output as an indented tree. */
export interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  Alias?: string;
  "Join Type"?: string;
  "Index Name"?: string;
  "Total Cost"?: number;
  "Plan Rows"?: number;
  Filter?: string;
  "Hash Cond"?: string;
  "Merge Cond"?: string;
  "Index Cond"?: string;
  "Sort Key"?: string[];
  "Group Key"?: string[];
  Plans?: PlanNode[];
}

/** Pull the root plan out of whatever shape the driver returned (string or parsed JSON). */
export function parsePlan(cell: unknown): PlanNode | null {
  try {
    const v = typeof cell === "string" ? JSON.parse(cell) : cell;
    const root = Array.isArray(v) ? v[0] : v;
    return (root?.Plan as PlanNode) ?? null;
  } catch {
    return null;
  }
}

function label(n: PlanNode): string {
  const parts = [n["Join Type"] ? `${n["Join Type"]} ${n["Node Type"]}` : n["Node Type"]];
  if (n["Relation Name"]) parts.push(`on ${n["Relation Name"]}${n.Alias && n.Alias !== n["Relation Name"] ? ` ${n.Alias}` : ""}`);
  if (n["Index Name"]) parts.push(`using ${n["Index Name"]}`);
  return parts.join(" ");
}

function detail(n: PlanNode): string | null {
  const cond = n["Hash Cond"] ?? n["Merge Cond"] ?? n["Index Cond"] ?? n.Filter;
  if (cond) return cond;
  if (n["Sort Key"]) return `by ${n["Sort Key"].join(", ")}`;
  if (n["Group Key"]) return `by ${n["Group Key"].join(", ")}`;
  return null;
}

function Node({ n }: { n: PlanNode }) {
  const d = detail(n);
  return (
    <li className="mt-1">
      <span className="font-medium text-ink">{label(n)}</span>
      <span className="ml-2 text-ink-faint">
        cost {n["Total Cost"]?.toFixed(1)} · ~{n["Plan Rows"]} rows
      </span>
      {d && <div className="font-mono text-[11px] text-ink-muted">{d}</div>}
      {n.Plans && (
        <ul className="ml-4 border-l border-surface-border pl-3">
          {n.Plans.map((c, i) => <Node key={i} n={c} />)}
        </ul>
      )}
    </li>
  );
}

export function PlanTree({ plan }: { plan: PlanNode }) {
  return (
    <ul className="text-xs" aria-label="Query plan">
      <Node n={plan} />
    </ul>
  );
}
