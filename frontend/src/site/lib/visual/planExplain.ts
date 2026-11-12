/**
 * Plain-language meaning of PostgreSQL plan node types. Only types listed here are explained: an unknown node gets no
 * text rather than a guess. The plan itself always comes from EXPLAIN; this file never produces plan output.
 */
const NODE_HELP: Record<string, string> = {
  "Seq Scan": "Sequential scan: reads every row of the table in order and keeps the ones that pass the filter. Cheap for small tables or when most rows are needed.",
  "Index Scan": "Index scan: walks an index to find matching rows, then fetches each from the table. Helps when few rows match.",
  "Index Only Scan": "Index-only scan: answers from the index alone, without visiting the table, when the index holds every needed column.",
  "Bitmap Index Scan": "Builds a bitmap of matching row locations from an index (the first half of a bitmap scan).",
  "Bitmap Heap Scan": "Reads the table pages marked by a bitmap index scan, in physical order. A middle ground between index and sequential scans.",
  "Nested Loop": "Nested loop join: for each row from the outer side, look for matches on the inner side. Good when the outer side is small or the inner side is indexed.",
  "Hash Join": "Hash join: builds an in-memory hash table from one input, then probes it with each row of the other. Good for large unsorted inputs and equality joins.",
  "Merge Join": "Merge join: walks two inputs that are both sorted on the join key and matches them like a zipper. Good when the inputs are already sorted.",
  Hash: "Builds the hash table that a Hash Join then probes.",
  Sort: "Sorts rows (for ORDER BY, a merge join or a group aggregate). Large sorts can spill to disk.",
  Aggregate: "Aggregate: combines all input rows into one result row (COUNT, SUM and so on without GROUP BY).",
  HashAggregate: "Hash aggregate: groups rows with a hash table keyed by the GROUP BY columns.",
  GroupAggregate: "Group aggregate: groups rows that arrive already sorted by the GROUP BY columns.",
  Limit: "Stops after the requested number of rows.",
  Unique: "Removes adjacent duplicate rows from sorted input (DISTINCT or UNION).",
  Append: "Concatenates the rows of several inputs (UNION ALL or partitions).",
  Materialize: "Stores its input in memory so it can be read more than once cheaply.",
  WindowAgg: "Computes window functions over sorted partitions while keeping every row.",
  "CTE Scan": "Reads the result of a WITH query (CTE).",
  "Subquery Scan": "Reads the output of a subquery in FROM.",
  Result: "Produces a computed row without reading a table (for example SELECT 1).",
};

export function planNodeHelp(nodeType: string, joinType?: string): string | undefined {
  const help = NODE_HELP[nodeType];
  if (!help) return undefined;
  const join = joinType && /Join|Nested Loop/.test(nodeType) && joinType !== "Inner" ? ` Join type here: ${joinType}.` : "";
  return `${help}${join}`;
}

export const KNOWN_PLAN_NODES = Object.keys(NODE_HELP);
