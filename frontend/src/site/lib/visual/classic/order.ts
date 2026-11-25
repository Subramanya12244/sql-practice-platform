/**
 * ORDER BY, read from the learner's own text: the sort keys, their direction and where NULLs go, and tie detection on rows
 * the database already returned. Pure functions; nothing here runs SQL.
 */
import { canon, fmtCell, splitTopLevel } from "./rowFlow";

export interface SortKey {
  /** The item as written, e.g. `unit_price DESC`. */
  text: string;
  /** The key as the learner named it, without direction: an output alias stays an alias (`n`), an ordinal stays a number. */
  name: string;
  /** The expression to evaluate for a row (an ordinal or an output alias is replaced by the SELECT item it names). */
  expr: string;
  desc: boolean;
  /** Where NULLs sort for this key (PostgreSQL: NULLs are the largest value, so last for ASC and first for DESC). */
  nulls: "first" | "last";
  /** The learner wrote NULLS FIRST / NULLS LAST. */
  explicitNulls: boolean;
}

const aliasOf = (item: string) => /\s+as\s+("[^"]+"|[A-Za-z_]\w*)\s*$/i.exec(item);
const stripAlias = (item: string) => { const m = aliasOf(item); return (m ? item.slice(0, m.index) : item).trim(); };

/** Sort keys of an ORDER BY. Returns [] when any key cannot be read safely (USING operator, unreadable text). */
export function sortKeys(orderBy: string | undefined, select?: string): SortKey[] {
  if (!orderBy?.trim()) return [];
  const items = select ? splitTopLevel(select) : [];
  const out: SortKey[] = [];
  for (const raw of splitTopLevel(orderBy)) {
    if (/\s+using\s+\S+\s*$/i.test(raw)) return [];
    let rest = raw.trim();
    let explicitNulls = false;
    let nulls: "first" | "last" | undefined;
    const nm = /\s+nulls\s+(first|last)\s*$/i.exec(rest);
    if (nm) { nulls = nm[1].toLowerCase() as "first" | "last"; explicitNulls = true; rest = rest.slice(0, nm.index).trim(); }
    let desc = false;
    const dm = /\s+(asc|desc)\s*$/i.exec(rest);
    if (dm) { desc = dm[1].toLowerCase() === "desc"; rest = rest.slice(0, dm.index).trim(); }
    if (!rest) return [];
    let expr = rest;
    if (/^\d+$/.test(rest)) {
      const it = items[Number(rest) - 1];
      if (!it) return [];
      expr = stripAlias(it);
    } else {
      const hit = items.find((it) => aliasOf(it)?.[1].replace(/"/g, "").toLowerCase() === rest.replace(/"/g, "").toLowerCase());
      if (hit) expr = stripAlias(hit);
    }
    out.push({ text: raw.trim(), name: rest, expr, desc, nulls: nulls ?? (desc ? "first" : "last"), explicitNulls });
  }
  return out;
}

export const nullsWord = (k: SortKey) => `NULLs sort ${k.nulls}${k.explicitNulls ? " (you wrote NULLS " + k.nulls.toUpperCase() + ")" : ` (PostgreSQL's default for ${k.desc ? "DESC" : "ASC"})`}`;

/**
 * Runs of consecutive rows with equal sort keys. `keys[i]` are the sort-key values of sorted row i. Each run of two or more rows is a
 * tie: the ORDER BY does not say which of them comes first.
 */
export function tieRuns(keys: unknown[][]): { start: number; length: number; key: unknown[] }[] {
  const out: { start: number; length: number; key: unknown[] }[] = [];
  let i = 0;
  while (i < keys.length) {
    let j = i + 1;
    while (j < keys.length && canon(keys[j]) === canon(keys[i])) j++;
    if (j - i > 1) out.push({ start: i, length: j - i, key: keys[i] });
    i = j;
  }
  return out;
}

export const keyText = (key: unknown[]) => key.map(fmtCell).join(", ");
