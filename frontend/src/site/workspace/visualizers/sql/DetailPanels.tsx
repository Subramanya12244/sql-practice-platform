import type { ReactNode } from "react";
import { SampleTable } from "../../../components/SampleTable";
import { SourceBadge } from "../../../components/VizView";
import type { CaseView, CteSet, GroupView, NullView, SubquerySet, WindowView } from "../../adapters/sql/extras";

const KIND_LABEL: Record<SubquerySet["kind"], string> = { scalar: "Scalar subquery", "in-list": "IN / ANY / ALL subquery", exists: "EXISTS subquery", "derived-table": "Derived table (FROM subquery)", lateral: "LATERAL subquery" };
const cell = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v));
const num = (n?: number) => (n === undefined ? "?" : n.toLocaleString());

export function Section({ title, badge, testId, children, intro }: { title: string; badge: ReactNode; testId: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section data-testid={testId} aria-label={title} className="space-y-2 rounded-xl border border-surface-border bg-surface-raised p-3">
      <h4 className="flex flex-wrap items-center gap-2 font-display text-sm font-bold text-ink">{title} {badge}</h4>
      {intro && <p className="text-xs text-ink-muted">{intro}</p>}
      {children}
    </section>
  );
}

export function CtePanel({ ctes }: { ctes: CteSet[] }) {
  const order = ctes.map((c) => c.name).concat("main query");
  return (
    <Section title="CTEs, in the order PostgreSQL needs them" badge={<SourceBadge s="executed" />} testId="sql-detail-ctes"
      intro={<>Each CTE is run on its own, with the same WITH clause. A CTE can only read the ones before it. Dependency order: <span className="font-mono text-ink" data-testid="cte-order">{order.join(" → ")}</span>.</>}>
      {ctes.map((c) => (
        <div key={c.name} data-testid={`cte-${c.name}`} className="space-y-1">
          <p className="text-xs text-ink">
            <strong>{c.order}. {c.name}</strong>{c.recursive && <span className="ml-1 text-warn">recursive</span>}
            <span className="text-ink-muted">{c.dependsOn.length ? ` · reads ${c.dependsOn.join(", ")}` : " · reads base tables"}{c.usedBy.length ? ` · used by ${c.usedBy.join(", ")}` : ""} · {num(c.rowCount)} rows</span>
          </p>
          {c.error ? <p role="alert" className="text-xs text-ink-muted">Could not be read on its own: {c.error}</p> : <SampleTable columns={c.columns} rows={c.rows} caption={`${c.name}: first ${c.rows.length} of ${num(c.rowCount)} rows`} />}
        </div>
      ))}
    </Section>
  );
}

export function SubqueryPanel({ subqueries }: { subqueries: SubquerySet[] }) {
  return (
    <Section title="Subqueries, innermost first" badge={<SourceBadge s="executed" />} testId="sql-detail-subqueries"
      intro="Each subquery that can run by itself is run by itself. One that reads a column of the outer query (a correlated subquery) is evaluated once per outer row, so it has no result set to show.">
      {subqueries.map((s) => (
        <div key={s.id} data-testid={`subquery-${s.id}`} data-status={s.status} className="space-y-1">
          <p className="text-xs text-ink"><strong>{KIND_LABEL[s.kind]}</strong>{s.clause && <span className="text-ink-muted"> in {s.clause}</span>}{s.status === "executed" && <span className="text-ink-muted"> · {num(s.rowCount)} rows</span>}</p>
          <pre className="overflow-x-auto rounded bg-surface-soft p-2 font-mono text-[11px] text-ink-muted">{s.text}</pre>
          {s.status === "executed"
            ? <SampleTable columns={s.columns} rows={s.rows} caption={`First ${s.rows.length} of ${num(s.rowCount)} rows`} />
            : <p className="rounded border border-surface-border bg-surface-soft px-2 py-1 text-xs text-ink-muted">Correlated: this subquery depends on the outer row, so it has no result set of its own and none is shown.</p>}
        </div>
      ))}
    </Section>
  );
}

export function WindowPanel({ windows }: { windows: WindowView[] }) {
  return (
    <Section title="Window functions: partitions, order, values" badge={<SourceBadge s="executed" />} testId="sql-detail-windows"
      intro="Every row stays. PARTITION BY splits the rows into independent groups; ORDER BY orders the rows inside each group; the window values are computed per row. Row # is ROW_NUMBER() over the same window, added to show the order; rows that tie on the ORDER BY can appear in either order.">
      {windows.map((w, wi) => (
        <div key={wi} data-testid={`window-${wi}`} className="space-y-1">
          <p className="font-mono text-[11px] text-ink">OVER ({w.spec})</p>
          <p className="text-xs text-ink-muted">
            {w.partitionBy.length ? `Partition by ${w.partitionBy.join(", ")}: ${num(w.totalPartitions)} partition(s)` : "No PARTITION BY: the whole result is one partition"}
            {w.orderBy ? ` · ordered by ${w.orderBy}` : " · no ORDER BY: every row in a partition is a peer, so aggregates cover the whole partition"}
            {w.frame ? ` · frame ${w.frame}` : w.orderBy ? " · default frame: from the first row up to the current row and its peers" : ""}
          </p>
          <div tabIndex={0} className="overflow-x-auto rounded-lg border border-surface-border">
            <table className="min-w-full text-xs">
              <thead className="bg-surface-soft"><tr><th className="px-2 py-1 text-left text-ink-faint">Row #</th>{w.columns.map((c, i) => <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-semibold text-ink-muted">{c}</th>)}</tr></thead>
              <tbody>
                {w.rows.map((r, i) => {
                  const first = i === 0 || w.rows[i - 1].partition !== r.partition;
                  const p = w.partitions[r.partition];
                  return [
                    first && w.partitionBy.length > 0 && (
                      <tr key={`h${i}`} data-testid="window-partition" className="bg-accent-dim">
                        <td colSpan={w.columns.length + 1} className="px-2 py-1 font-semibold text-accent">
                          Partition {r.partition + 1}: {w.partitionBy.map((_, k) => cell(r.cells[k])).join(", ")} · {p.size} row(s){p.shown < p.size ? `, ${p.shown} shown` : ""}
                        </td>
                      </tr>
                    ),
                    <tr key={i} data-partition={r.partition} className={r.partition % 2 ? "bg-surface-soft/50" : ""}>
                      <td className="px-2 py-1 font-mono text-ink-faint">{r.rowInPartition}</td>
                      {r.cells.map((v, j) => <td key={j} className={`whitespace-nowrap px-2 py-1 font-mono ${v === null ? "italic text-ink-faint" : "text-ink"}`}>{cell(v)}</td>)}
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
          {w.truncated && <p className="text-[11px] text-ink-faint">Showing the first {w.rows.length} of {num(w.totalRows)} rows; the last partition may be cut. Partition sizes are exact.</p>}
        </div>
      ))}
    </Section>
  );
}

const verdictCls = (v: string) => (v === "true" ? "bg-success-dim text-success" : v === "false" ? "bg-danger-dim text-danger" : "bg-warn-dim text-warn");

export function GroupPanel({ g }: { g: GroupView }) {
  const more = g.totalGroups !== undefined && g.totalGroups > g.groups.length;
  return (
    <Section title="Groups: the rows in each group and what is calculated" badge={<SourceBadge s="executed" />} testId="sql-detail-groups"
      intro={g.noGroupBy ? "There is no GROUP BY, so all rows form one group and the aggregates are calculated over all of them." : `Rows with the same ${g.keys.join(", ")} form one group. Each aggregate reads one value per member row${g.having ? " and HAVING then tests each whole group" : ""}.`}>
      <p className="text-xs text-ink-muted" data-testid="group-totals">
        {num(g.totalGroups)} group(s){g.having ? ` before HAVING; ${num(g.groupsKept)} stay and ${g.groupsKept !== undefined && g.totalGroups !== undefined ? g.totalGroups - g.groupsKept : "?"} are removed by HAVING ${g.having}` : ""}.
        {more ? ` The first ${g.groups.length} are shown, in grouping-key order.` : ""}
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {g.groups.map((x, i) => (
          <div key={x.key} data-testid="group-card" data-having={x.having} className="space-y-1 rounded-lg border border-surface-border p-2">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink">
              Group {i + 1}
              <span className="rounded bg-surface-soft px-1.5 py-0.5 font-mono text-ink-muted">{x.rowCount} row(s)</span>
              {x.having && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${verdictCls(x.having)}`}>HAVING {x.having === "true" ? "keeps it" : x.having === "false" ? "removes it" : "unknown: removed"}</span>}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
              {g.columns.map((c, k) => (<div key={k} className="contents"><dt className="text-ink-faint">{c}</dt><dd className="font-mono text-ink">{cell(x.values[k])}</dd></div>))}
            </dl>
            {g.memberColumns.length > 0 && <SampleTable columns={g.memberColumns} rows={x.members.map((m) => m.cells)} caption={`Member rows: values the aggregates read (${x.members.length} of ${x.rowCount})`} />}
            {g.memberColumns.length === 0 && <p className="text-[11px] text-ink-faint">The aggregates here count rows, so only the row count above matters.</p>}
          </div>
        ))}
      </div>
    </Section>
  );
}

function CaseCard({ c }: { c: CaseView }) {
  return (
    <div data-testid="case-view" className="space-y-1">
      <pre className="overflow-x-auto rounded bg-surface-soft p-2 font-mono text-[11px] text-ink-muted">{c.text}</pre>
      <p className="text-xs text-ink-muted">
        {c.branches.map((b) => `${b.branch === -1 ? (c.hasElse ? "ELSE" : "no branch (NULL result)") : `WHEN ${b.branch + 1}`}: ${b.rows} row(s)`).join(" · ")}.
        {" "}Rows whose condition is unknown (NULL): {c.unknownPerCondition.map((n, i) => `WHEN ${i + 1} → ${n}`).join(", ")}.
      </p>
      <div tabIndex={0} className="overflow-x-auto rounded-lg border border-surface-border">
        <table className="min-w-full text-xs">
          <thead className="bg-surface-soft"><tr>
            {c.contextColumns.map((x, i) => <th key={`c${i}`} className="px-2 py-1 text-left font-semibold text-ink-muted">{x}</th>)}
            {c.conditions.map((_, i) => <th key={`w${i}`} className="px-2 py-1 text-left font-semibold text-ink-muted">WHEN {i + 1}</th>)}
            <th className="px-2 py-1 text-left font-semibold text-ink-muted">Result</th>
          </tr></thead>
          <tbody className="divide-y divide-surface-border">
            {c.sample.map((r, i) => (
              <tr key={i}>
                {r.context.map((v, k) => <td key={k} className="whitespace-nowrap px-2 py-1 font-mono text-ink">{cell(v)}</td>)}
                {r.verdicts.map((v, k) => <td key={k} className="px-2 py-1"><span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${verdictCls(v)}`}>{v}</span></td>)}
                <td className={`whitespace-nowrap px-2 py-1 font-mono ${r.result === null ? "italic text-ink-faint" : "text-ink"}`}>{cell(r.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="list-decimal pl-5 text-[11px] text-ink-faint">{c.conditions.map((x, i) => <li key={i}><code>{x}</code></li>)}</ol>
    </div>
  );
}

export function NullPanel({ n }: { n: NullView }) {
  const s = n.where?.split;
  return (
    <Section title="NULL and three-valued logic" badge={<><SourceBadge s="executed" /><SourceBadge s="parsed" /></>} testId="sql-detail-nulls"
      intro="A condition is TRUE, FALSE or UNKNOWN (NULL). WHERE keeps a row only when the condition is TRUE, and CASE WHEN takes a branch only when its condition is TRUE. UNKNOWN is not removed because it is false: it just is not true, so NOT of an unknown is still unknown.">
      {n.where && s && (
        <div data-testid="null-where" className="space-y-1">
          <p className="text-xs text-ink">WHERE <code className="text-ink-muted">{n.where.expr}</code> over the {s.total.toLocaleString()} rows of FROM</p>
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-soft" role="img" aria-label={`${s.true} true, ${s.false} false, ${s.unknown} unknown`}>
            {[["true", s.true], ["false", s.false], ["NULL", s.unknown]].map(([k, v]) => (Number(v) > 0 ? <span key={String(k)} style={{ width: `${(Number(v) / Math.max(1, s.total)) * 100}%` }} className={k === "true" ? "bg-success" : k === "false" ? "bg-danger" : "bg-warn"} /> : null))}
          </div>
          <p className="flex flex-wrap gap-3 text-xs text-ink-muted">
            <span><span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${verdictCls("true")}`}>true</span> {s.true.toLocaleString()} kept</span>
            <span><span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${verdictCls("false")}`}>false</span> {s.false.toLocaleString()} removed</span>
            <span><span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${verdictCls("NULL")}`}>NULL</span> {s.unknown.toLocaleString()} removed{s.unknown > 0 ? " (unknown is not true)" : ""}</span>
          </p>
        </div>
      )}
      {n.cases.map((c, i) => <CaseCard key={i} c={c} />)}
      {n.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-muted" data-testid="null-notes">{n.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    </Section>
  );
}
