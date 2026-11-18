/**
 * Read-only helpers. The security boundary is `checkSqlPolicy` in policy.ts (parser-based, enforced by the adapter and by
 * lib/sqlRunner). What is left here is kept for callers that need a synchronous answer:
 *  - `checkReadOnly`: the policy's read-only rules over the token reader only (no parser, so it is not the boundary).
 *  - `isSingleQuery`: "one SELECT / WITH ... SELECT / VALUES / TABLE", the only shape the visualizer builds stages for.
 *  - `READ_ONLY_PREFIX`: the statement that narrows a transaction to READ ONLY, the DB-level second layer.
 */
import { checkSqlPolicyLexical } from "./policy";
import { maskSql } from "./sqlText";

export interface ReadOnlyCheck {
  readOnly: boolean;
  /** One plain sentence per refused statement. */
  reasons: string[];
  statements: number;
}

/** First transaction statement for read-only runs: PostgreSQL then refuses every write, whatever the SQL says. */
export const READ_ONLY_PREFIX = "SET TRANSACTION READ ONLY;\n";

/** Classify every statement of `sql` by its tokens. Comments, strings and quoted identifiers are ignored (`SELECT 'DROP TABLE x'` is fine). */
export function checkReadOnly(sql: string): ReadOnlyCheck {
  const v = checkSqlPolicyLexical(sql, "read-only");
  return { readOnly: v.allowed, reasons: v.reasons, statements: v.statements };
}

/** The statement is a single SELECT / WITH ... SELECT / VALUES / TABLE: the only shape the visualizer builds stages for. */
export function isSingleQuery(sql: string): boolean {
  const masked = maskSql(sql);
  const pieces = masked.split(";").filter((s) => s.trim());
  return pieces.length === 1 && /^\(*\s*(select|with|values|table)\b/i.test(pieces[0].trim()) && checkReadOnly(sql).readOnly;
}
