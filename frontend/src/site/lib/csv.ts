/** CSV export for admin tables. RFC 4180 quoting, plus a guard against spreadsheet formula injection. */

type Cell = string | number | boolean | null | undefined | object;

function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // A value starting with = + - @ (or tab/CR) runs as a formula in Excel and Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, Cell>>(rows: T[], columns: (keyof T & string)[]): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
