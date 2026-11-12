// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AGGS, BOOKS, MESSY, PRESETS, SALES, SUPPORTED_FUNCTIONS, applyCf, applyCleanOp, applyCleanOps, changedCells, copyCell, createEngine, evaluateAll, evaluateFormula,
  formatText, isErr, lookupCore, parseCriteria, parseFormula, pivot, precedents, qualityIssues, recalcOrder, shiftFormula, traceCell, directDependents,
  type Cells, type PivotField, type PivotSpec, type Val,
} from "../site/lib/visual/excel";

const ev = (f: string, cells: Cells = {}): Val => evaluateFormula(f, cells);
const E = (code: string) => ({ error: code });

describe("tokenizer and parser", () => {
  it("respects operator precedence, unary minus and percent like Excel", () => {
    expect(ev("=1+2*3")).toBe(7);
    expect(ev("=(1+2)*3")).toBe(9);
    expect(ev("=2^3^2")).toBe(64); // left to right in Excel: (2^3)^2
    expect(ev("=-2^2")).toBe(4); // unary minus binds tighter than ^
    expect(ev("=50%")).toBe(0.5);
    expect(ev("=10-2-3")).toBe(5);
    expect(ev('="a"&"b"&1+2')).toBe("ab3"); // + before &
    expect(ev("=1+1=2")).toBe(true);
  });
  it("reads strings with doubled quotes and error literals", () => {
    expect(ev('="say ""hi"""')).toBe('say "hi"');
    expect(ev("=#N/A")).toEqual(E("#N/A"));
    expect(ev('=IFERROR(#N/A,"x")')).toBe("x");
  });
  it("rejects bad syntax with a message instead of throwing", () => {
    expect(parseFormula("1+").ok).toBe(false);
    expect(parseFormula("SUM(1,2").ok).toBe(false);
    expect(parseFormula("A:A").ok).toBe(false);
    expect(parseFormula("Sheet2!A1").ok).toBe(false);
    expect(ev("=1+")).toEqual(E("#SYNTAX!"));
    expect(ev("=SUM(1,2")).toEqual(E("#SYNTAX!"));
  });
  it("treats LOG10( as a function and TAX like names as #NAME?", () => {
    expect(ev("=LOG10(100)")).toEqual(E("#NAME?"));
    expect(ev("=bogus+1")).toEqual(E("#NAME?"));
    expect(ev("=NOSUCH(1)")).toEqual(E("#NAME?"));
  });
  it("lists the supported functions, which covers the required set", () => {
    for (const f of "SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK IF IFS AND OR NOT IFERROR ROUND ABS MOD VLOOKUP HLOOKUP XLOOKUP INDEX MATCH SUMIF SUMIFS COUNTIF COUNTIFS AVERAGEIF AVERAGEIFS LEFT MID RIGHT LEN TRIM UPPER LOWER PROPER CONCAT TEXTJOIN SUBSTITUTE DATE YEAR MONTH DAY TEXT".split(" ")) expect(SUPPORTED_FUNCTIONS).toContain(f);
  });
});

describe("evaluation: arithmetic, comparison, coercion", () => {
  const cells: Cells = { A1: "10", A2: "4", A3: "text", A4: "", A5: "2.5", A6: "TRUE", A7: "'42" };
  it("computes and compares", () => {
    expect(ev("=A1/A2", cells)).toBe(2.5);
    expect(ev("=A1>A2", cells)).toBe(true);
    expect(ev("=A1<>A2", cells)).toBe(true);
    expect(ev("=A1>=10", cells)).toBe(true);
    expect(ev('="a"="A"')).toBe(true); // text compares ignoring case
    expect(ev('="a"<"b"')).toBe(true);
    expect(ev("=A4=0", cells)).toBe(true); // blank equals 0
    expect(ev('=A4=""', cells)).toBe(true);
    expect(ev('=5<"a"')).toBe(true); // numbers sort before text
  });
  it("coerces text numbers in arithmetic but not in comparison", () => {
    expect(ev("=A7+1", cells)).toBe(43);
    expect(ev('="5"+1')).toBe(6);
    expect(ev('="5"=5')).toBe(false);
    expect(ev("=A3+1", cells)).toEqual(E("#VALUE!"));
    expect(ev("=A6+1", cells)).toBe(2);
  });
  it("raises Excel's error names", () => {
    expect(ev("=1/0")).toEqual(E("#DIV/0!"));
    expect(ev("=A1/A4", cells)).toEqual(E("#DIV/0!"));
    expect(ev("=MOD(5,0)")).toEqual(E("#DIV/0!"));
    expect(ev("=AVERAGE(A3:A4)", cells)).toEqual(E("#DIV/0!"));
    expect(ev('="a"+1')).toEqual(E("#VALUE!"));
    expect(ev("=SQRT(-1)")).toEqual(E("#NUM!"));
    expect(ev("=VLOOKUP(1,A1:A2,3,FALSE)", cells)).toEqual(E("#REF!"));
    expect(ev("=#REF!+1")).toEqual(E("#REF!"));
  });
  it("propagates an error through dependent formulas and IFERROR catches it", () => {
    const c: Cells = { A1: "=1/0", A2: "=A1+1", A3: '=IFERROR(A2,"fallback")', A4: "=SUM(A1:A2)" };
    const v = evaluateAll(c).values;
    expect(v.A1).toEqual(E("#DIV/0!")); expect(v.A2).toEqual(E("#DIV/0!")); expect(v.A3).toBe("fallback"); expect(v.A4).toEqual(E("#DIV/0!"));
  });
  it("a range in scalar position is #VALUE! (arrays are not supported)", () => {
    expect(ev("=A1:A2+1", cells)).toEqual(E("#VALUE!"));
    expect(ev("=A1:A2", cells)).toEqual(E("#VALUE!"));
  });
});

describe("functions", () => {
  const cells: Cells = { A1: "1", A2: "2", A3: "3", A4: "text", A5: "", A6: "TRUE", B1: "apple", B2: "banana", B3: "cherry" };
  it("math and aggregates", () => {
    expect(ev("=SUM(A1:A6)", cells)).toBe(6); // text and booleans in ranges are ignored
    expect(ev("=SUM(A1,A2,10)", cells)).toBe(13);
    expect(ev('=SUM("5",1)')).toBe(6); // direct text is coerced
    expect(ev("=AVERAGE(A1:A3)", cells)).toBe(2);
    expect(ev("=MIN(A1:A3)", cells)).toBe(1);
    expect(ev("=MAX(A1:A3,10)", cells)).toBe(10);
    expect(ev("=MIN(A4:A5)", cells)).toBe(0);
    expect(ev("=COUNT(A1:A6)", cells)).toBe(3);
    expect(ev("=COUNTA(A1:A6)", cells)).toBe(5);
    expect(ev("=COUNTBLANK(A1:A6)", cells)).toBe(1);
    expect(ev("=ROUND(2.675,2)")).toBe(2.68);
    expect(ev("=ROUND(1.005,2)")).toBe(1.01);
    expect(ev("=ROUND(-2.5,0)")).toBe(-3);
    expect(ev("=ROUND(1234.5,-2)")).toBe(1200);
    expect(ev("=ABS(-3.5)")).toBe(3.5);
    expect(ev("=MOD(10,3)")).toBe(1);
    expect(ev("=MOD(-1,3)")).toBe(2); // sign follows the divisor
    expect(ev("=MEDIAN(1,2,3,10)")).toBe(2.5);
  });
  it("logical functions short-circuit and combine", () => {
    expect(ev('=IF(1>2,"y","n")')).toBe("n");
    expect(ev("=IF(1>2,1)")).toBe(false);
    expect(ev('=IF(TRUE,"ok",1/0)')).toBe("ok"); // untaken branch never evaluated
    expect(ev('=IFS(5>10,"a",5>1,"b",TRUE,"c")')).toBe("b");
    expect(ev('=IFS(FALSE,"a")')).toEqual(E("#N/A"));
    expect(ev("=AND(1<2,2<3)")).toBe(true);
    expect(ev("=AND(1<2,2>3)")).toBe(false);
    expect(ev("=OR(1>2,2<3)")).toBe(true);
    expect(ev("=NOT(1>2)")).toBe(true);
    expect(ev('=IF("x","a","b")')).toEqual(E("#VALUE!"));
  });
  it("text functions", () => {
    expect(ev('=LEFT("Excel",2)')).toBe("Ex");
    expect(ev('=LEFT("Excel")')).toBe("E");
    expect(ev('=RIGHT("Excel",3)')).toBe("cel");
    expect(ev('=MID("Excel",2,3)')).toBe("xce");
    expect(ev('=LEN("hello")')).toBe(5);
    expect(ev('=TRIM("  a   b  ")')).toBe("a b");
    expect(ev('=UPPER("ab")&LOWER("CD")')).toBe("ABcd");
    expect(ev('=PROPER("hELLO wORLD-foo bar")')).toBe("Hello World-Foo Bar");
    expect(ev('=CONCAT("a",B1:B2)', cells)).toBe("aapplebanana");
    expect(ev('=TEXTJOIN(", ",TRUE,B1:B3)', cells)).toBe("apple, banana, cherry");
    expect(ev('=TEXTJOIN("-",TRUE,A4:A5,"x")', cells)).toBe("text-x"); // empties skipped
    expect(ev('=TEXTJOIN("-",FALSE,A4:A5,"x")', cells)).toBe("text--x");
    expect(ev('=SUBSTITUTE("a-b-c","-","+")')).toBe("a+b+c");
    expect(ev('=SUBSTITUTE("a-b-c","-","+",2)')).toBe("a-b+c");
    expect(ev('=FIND("b","abc")')).toBe(2);
    expect(ev('=FIND("B","abc")')).toEqual(E("#VALUE!"));
    expect(ev('=SEARCH("B","abc")')).toBe(2);
    expect(ev('=VALUE("1,200")')).toBe(1200);
    expect(ev('=VALUE("12%")')).toBe(0.12);
    expect(ev('=VALUE("abc")')).toEqual(E("#VALUE!"));
    expect(ev('=12&"x"')).toBe("12x");
  });
  it("dates are serial numbers", () => {
    expect(ev("=DATE(2024,2,10)")).toBe(45332);
    expect(ev("=DATE(1970,1,1)")).toBe(25569);
    expect(ev("=DATE(1900,1,1)")).toBe(1);
    expect(ev("=YEAR(DATE(2024,2,10))")).toBe(2024);
    expect(ev("=MONTH(DATE(2024,2,10))")).toBe(2);
    expect(ev("=DAY(DATE(2024,2,10))")).toBe(10);
    expect(ev("=DATE(2025,14,1)")).toBe(ev("=DATE(2026,2,1)")); // month overflow
    expect(ev("=DATE(2025,3,0)")).toBe(ev("=DATE(2025,2,28)")); // day 0 is the last day of the previous month
    expect(ev("=EOMONTH(DATE(2024,2,10),0)")).toBe(ev("=DATE(2024,2,29)"));
    expect(ev("=EOMONTH(DATE(2025,1,31),1)")).toBe(ev("=DATE(2025,2,28)"));
    expect(ev('=YEAR("2025-03-05")')).toBe(2025);
    expect(ev("=DATE(2025,12,5)-DATE(2025,1,31)")).toBe(308);
    expect(ev('=MONTH("not a date")')).toEqual(E("#VALUE!"));
  });
  it("TEXT formats numbers and dates", () => {
    expect(ev('=TEXT(1234.567,"0.00")')).toBe("1234.57");
    expect(ev('=TEXT(1234.567,"#,##0")')).toBe("1,235");
    expect(ev('=TEXT(1234.5,"#,##0.00")')).toBe("1,234.50");
    expect(ev('=TEXT(0.256,"0%")')).toBe("26%");
    expect(ev('=TEXT(0.256,"0.0%")')).toBe("25.6%");
    expect(ev('=TEXT(7,"000")')).toBe("007");
    expect(ev('=TEXT(5,"$#,##0.00")')).toBe("$5.00");
    expect(ev('=TEXT(DATE(2024,2,10),"yyyy-mm-dd")')).toBe("2024-02-10");
    expect(ev('=TEXT(DATE(2024,2,10),"dd/mm/yyyy")')).toBe("10/02/2024");
    expect(ev('=TEXT(DATE(2024,2,10),"mmm")')).toBe("Feb");
    expect(ev('=TEXT(DATE(2024,2,10),"dddd, d mmmm yyyy")')).toBe("Saturday, 10 February 2024");
    expect(formatText(-5, "0.0")).toBe("-5.0");
  });
});

describe("conditional aggregation", () => {
  const rows: Cells = {};
  const data = [["North", "Pen", 3, 30], ["South", "Pen", 1, 10], ["North", "Book", 2, 40], ["East", "Book", 5, 100], ["South", "Book", 1, 20], ["North", "Pen", 4, 40], ["East", "Pen", 2, 20]];
  data.forEach((r, i) => { rows[`A${i + 1}`] = String(r[0]); rows[`B${i + 1}`] = String(r[1]); rows[`C${i + 1}`] = String(r[2]); rows[`D${i + 1}`] = String(r[3]); });
  it("matches the curriculum fixture values", () => {
    expect(ev('=SUMIFS(D1:D7,A1:A7,"North",C1:C7,">=3")', rows)).toBe(70);
    expect(ev('=COUNTIFS(B1:B7,"Pen",D1:D7,">=20")', rows)).toBe(3);
    expect(ev('=AVERAGEIFS(D1:D7,B1:B7,"Book")', rows)).toBeCloseTo(53.3333, 3);
    expect(ev('=SUMIF(A1:A7,"East",D1:D7)', rows)).toBe(120);
    expect(ev('=SUMIF(C1:C7,">2")', rows)).toBe(12);
    expect(ev('=AVERAGEIF(A1:A7,"North",D1:D7)', rows)).toBeCloseTo(36.667, 2);
    expect(ev('=COUNTIF(A1:A7,"<>North")', rows)).toBe(4);
    expect(ev('=COUNTIF(A1:A7,"n*")', rows)).toBe(3); // wildcard, case-insensitive
    expect(ev('=COUNTIF(C1:C7,3)', rows)).toBe(1);
    expect(ev('=COUNTIF(A1:A7,"nor?h")', rows)).toBe(3);
    expect(ev('=SUMIFS(D1:D7,A1:A7,"Nowhere")', rows)).toBe(0);
    expect(ev('=AVERAGEIFS(D1:D7,A1:A7,"Nowhere")', rows)).toEqual(E("#DIV/0!"));
  });
  it("rejects ranges of different sizes", () => {
    expect(ev('=SUMIFS(D1:D7,A1:A6,"North")', rows)).toEqual(E("#VALUE!"));
  });
  it("criteria strings", () => {
    expect(parseCriteria(">=3")(3)).toBe(true);
    expect(parseCriteria(">=3")(2)).toBe(false);
    expect(parseCriteria(">=3")("x")).toBe(false);
    expect(parseCriteria("a*")("Apple")).toBe(true);
    expect(parseCriteria("=")(null)).toBe(true);
    expect(parseCriteria("<>")(null)).toBe(false);
    expect(parseCriteria("5")("5")).toBe(true); // number-like text matches a numeric criterion
  });
});

describe("lookups", () => {
  const cells: Cells = {
    A1: "P100", B1: "Pen", C1: "1.5", A2: "P200", B2: "Book", C2: "12", A3: "P300", B3: "Bag", C3: "45",
    E1: "0", F1: "F", E2: "50", F2: "D", E3: "60", F3: "C", E4: "70", F4: "B", E5: "85", F5: "A",
    H1: "x", I1: "y", J1: "z", H2: "10", I2: "20", J2: "30",
  };
  it("VLOOKUP exact, wrong column and not found", () => {
    expect(ev('=VLOOKUP("P200",A1:C3,3,FALSE)', cells)).toBe(12);
    expect(ev('=VLOOKUP("p200",A1:C3,2,FALSE)', cells)).toBe("Book"); // case-insensitive
    expect(ev('=VLOOKUP("P999",A1:C3,3,FALSE)', cells)).toEqual(E("#N/A"));
    expect(ev('=VLOOKUP("P200",A1:C3,4,FALSE)', cells)).toEqual(E("#REF!"));
    expect(ev('=VLOOKUP("P200",A1:C3,0,FALSE)', cells)).toEqual(E("#VALUE!"));
    expect(ev('=VLOOKUP("P*",A1:C3,2,FALSE)', cells)).toBe("Pen"); // wildcard in exact mode
  });
  it("VLOOKUP approximate finds the largest key not above the value, and #N/A below the smallest", () => {
    expect(ev("=VLOOKUP(67,E1:F5,2,TRUE)", cells)).toBe("C");
    expect(ev("=VLOOKUP(60,E1:F5,2,TRUE)", cells)).toBe("C");
    expect(ev("=VLOOKUP(95,E1:F5,2)", cells)).toBe("A"); // approximate is the default
    expect(ev("=VLOOKUP(-5,E1:F5,2,TRUE)", cells)).toEqual(E("#N/A"));
  });
  it("approximate match on unsorted keys gives a wrong answer (binary search), exact does not", () => {
    const u: Cells = { A1: "50", B1: "mid", A2: "10", B2: "low", A3: "90", B3: "high", A4: "20", B4: "low2" };
    expect(ev("=VLOOKUP(50,A1:B4,2,FALSE)", u)).toBe("mid");
    expect(ev("=VLOOKUP(50,A1:B4,2,TRUE)", u)).toBe("low"); // binary search probes row 2 first, never reaches row 1: the lesson
    expect(ev("=VLOOKUP(20,A1:B4,2,FALSE)", u)).toBe("low2");
    expect(ev("=VLOOKUP(20,A1:B4,2,TRUE)", u)).toBe("low");
  });
  it("HLOOKUP", () => { expect(ev('=HLOOKUP("y",H1:J2,2,FALSE)', cells)).toBe(20); expect(ev('=HLOOKUP("q",H1:J2,2,FALSE)', cells)).toEqual(E("#N/A")); });
  it("XLOOKUP with fallback and match modes", () => {
    expect(ev('=XLOOKUP("P300",A1:A3,C1:C3)', cells)).toBe(45);
    expect(ev('=XLOOKUP("P999",A1:A3,C1:C3,"none")', cells)).toBe("none");
    expect(ev('=XLOOKUP("P999",A1:A3,C1:C3)', cells)).toEqual(E("#N/A"));
    expect(ev("=XLOOKUP(67,E1:E5,F1:F5,\"-\",-1)", cells)).toBe("C"); // next smaller
    expect(ev("=XLOOKUP(67,E1:E5,F1:F5,\"-\",1)", cells)).toBe("B"); // next larger
    expect(ev('=XLOOKUP("P*",A1:A3,C1:C3,"-",2)', cells)).toBe(1.5); // wildcard
    expect(ev('=XLOOKUP("P*",A1:A3,C1:C3,"-",0)', cells)).toBe("-"); // no wildcards in plain exact mode
    expect(ev('=XLOOKUP("P200",A1:A3,B1:B3,"-",0,-1)', cells)).toBe("Book"); // search last to first
    expect(ev('=XLOOKUP("y",H1:J1,H2:J2)', cells)).toBe(20); // row orientation
  });
  it("INDEX and MATCH", () => {
    expect(ev("=INDEX(A1:C3,2,3)", cells)).toBe(12);
    expect(ev("=INDEX(C1:C3,3)", cells)).toBe(45);
    expect(ev("=INDEX(H2:J2,2)", cells)).toBe(20);
    expect(ev("=INDEX(A1:C3,4,1)", cells)).toEqual(E("#REF!"));
    expect(ev('=MATCH("P200",A1:A3,0)', cells)).toBe(2);
    expect(ev('=MATCH("P999",A1:A3,0)', cells)).toEqual(E("#N/A"));
    expect(ev("=MATCH(67,E1:E5,1)", cells)).toBe(3);
    expect(ev("=MATCH(67,E1:E5)", cells)).toBe(3);
    expect(ev("=INDEX(C1:C3,MATCH(\"P300\",A1:A3,0))", cells)).toBe(45);
    const d: Cells = { A1: "90", A2: "70", A3: "50" };
    expect(ev("=MATCH(60,A1:A3,-1)", d)).toBe(2); // descending: smallest value >= 60
  });
  it("lookupCore probes expose the search path", () => {
    const keys: Val[] = [0, 50, 60, 70, 85];
    const exact = lookupCore(70, keys, "exact");
    expect(exact.index).toBe(3);
    expect(exact.probes.map((p) => p.verdict)).toEqual(["differs", "differs", "differs", "equal"]);
    const approx = lookupCore(67, keys, "approximate");
    expect(approx.index).toBe(2);
    expect(approx.probes.length).toBeLessThanOrEqual(3); // binary search: fewer probes than rows
    expect(approx.probes.every((p) => ["le", "gt", "equal"].includes(p.verdict))).toBe(true);
    expect(lookupCore(-1, keys, "approximate").index).toBe(-1);
    expect(lookupCore(999, keys, "exact").probes).toHaveLength(5); // a miss scans every row
  });
  it("traceCell records the lookups of a cell's formula", () => {
    const l = BOOKS.lookups.cells;
    const t = traceCell(l, "F3")!;
    expect(t.lookups).toHaveLength(1);
    expect(t.lookups[0]).toMatchObject({ fn: "VLOOKUP", mode: "exact", matchIndex: -1 });
    expect(t.lookups[0].probes).toHaveLength(5);
    const h = traceCell(l, "H2")!;
    expect(h.lookups[0]).toMatchObject({ fn: "MATCH", matchIndex: 2 });
    expect(traceCell(l, "F8")!.lookups[0]).toMatchObject({ mode: "approximate", matchIndex: 2 });
  });
});

describe("circular references and recalculation", () => {
  it("detects a self reference and a two-cell cycle, and shows their dependents as errors", () => {
    const self = evaluateAll({ A1: "=A1+1" });
    expect(self.values.A1).toEqual(E("#CIRC!")); expect([...self.circular]).toEqual(["A1"]);
    const two = evaluateAll({ A1: "=B1+1", B1: "=A1+1", C1: "=A1*2", D1: "=IFERROR(A1,0)", E1: "5" });
    expect(two.values.A1).toEqual(E("#CIRC!")); expect(two.values.B1).toEqual(E("#CIRC!"));
    expect(two.values.C1).toEqual(E("#CIRC!"));
    expect(two.values.D1).toBe(0);
    expect(two.circular.has("C1")).toBe(false);
    expect(two.values.E1).toBe(5);
  });
  it("detects a three-cell cycle through a range", () => {
    const r = evaluateAll({ A1: "=SUM(B1:B2)", B1: "1", B2: "=C1", C1: "=A1" });
    expect(r.circular).toEqual(new Set(["A1", "B2", "C1"]));
  });
  it("is deterministic: evaluating twice gives the same values", () => {
    const c = BOOKS.formulas.cells;
    expect(evaluateAll(c).values).toEqual(evaluateAll(c).values);
  });
  it("precedents, dependents and the recalculation order of a change", () => {
    const c: Cells = { A1: "2", B1: "=A1*2", C1: "=B1+A1", D1: "=SUM(A1:C1)", E1: "=D1/10", F1: "=1+1" };
    expect(precedents(c, "D1")).toEqual(["A1", "B1", "C1"]);
    expect(precedents(c, "A1")).toEqual([]);
    expect(directDependents(c, "A1").sort()).toEqual(["B1", "C1", "D1"]);
    const r = recalcOrder(c, "A1");
    expect(r.order).toEqual(["B1", "C1", "D1", "E1"]);
    expect(r.levels).toEqual([["B1"], ["C1"], ["D1"], ["E1"]]);
    expect(r.order).not.toContain("F1");
    // every cell comes after all its affected precedents
    for (const cell of r.order) for (const p of precedents(c, cell)) if (r.order.includes(p)) expect(r.order.indexOf(p)).toBeLessThan(r.order.indexOf(cell));
    expect(recalcOrder(c, "E1").order).toEqual([]);
  });
  it("reports cyclic cells instead of looping", () => {
    const r = recalcOrder({ A1: "1", B1: "=A1+C1", C1: "=B1" }, "A1");
    expect(r.cyclic).toEqual(["B1", "C1"]);
  });
  it("a dependency level groups independent cells", () => {
    const r = recalcOrder({ A1: "1", B1: "=A1", C1: "=A1", D1: "=B1+C1" }, "A1");
    expect(r.levels).toEqual([["B1", "C1"], ["D1"]]);
  });
});

describe("formula evaluation view (traceCell)", () => {
  it("lists sub-expressions innermost first with their values", () => {
    const t = traceCell({ A1: "  ada   lovelace ", B1: "=PROPER(TRIM(A1))" }, "B1")!;
    expect(t.steps.map((s) => s.text)).toEqual(["A1", "TRIM(A1)", "PROPER(TRIM(A1))"]);
    expect(t.steps.map((s) => s.value)).toEqual(['"  ada   lovelace "', '"ada lovelace"', '"Ada Lovelace"']);
    expect(t.result).toBe("Ada Lovelace");
  });
  it("evaluates arithmetic in precedence order", () => {
    const t = traceCell({ A1: "2", B1: "3", C1: "=A1+B1*4" }, "C1")!;
    expect(t.steps.map((s) => s.text)).toEqual(["A1", "B1", "B1*4", "A1+B1*4"]);
    expect(t.steps.map((s) => s.value)).toEqual(["2", "3", "12", "14"]);
  });
  it("only traces the branch that IF takes", () => {
    const t = traceCell({ A1: "5", B1: '=IF(A1>3,A1*2,A1/0)' }, "B1")!;
    const texts = t.steps.map((s) => s.text);
    expect(texts).toContain("A1*2");
    expect(texts).not.toContain("A1/0");
    expect(t.result).toBe(10);
  });
  it("shows an error step and the error result", () => {
    const t = traceCell({ A1: "0", B1: "=1/A1+1" }, "B1")!;
    expect(t.steps.at(-1)).toMatchObject({ text: "1/A1+1", value: "#DIV/0!" });
    expect(isErr(t.result) && t.result.error).toBe("#DIV/0!");
  });
  it("returns null for a non-formula and reports syntax errors", () => {
    expect(traceCell({ A1: "5" }, "A1")).toBeNull();
    expect(traceCell({ A1: "=1+" }, "A1")!.syntaxError).toBeTruthy();
  });
  it("marks a circular cell", () => {
    expect(traceCell({ A1: "=A1+1" }, "A1")!.result).toEqual(E("#CIRC!"));
  });
});

describe("copying formulas: relative and absolute references", () => {
  it("shifts relative references and keeps $ anchors", () => {
    expect(shiftFormula("=B2*C2", 1, 0)).toBe("=B3*C3");
    expect(shiftFormula("=B2*C2", 0, 1)).toBe("=C2*D2");
    expect(shiftFormula("=D2*(1+$H$1)", 1, 0)).toBe("=D3*(1+$H$1)");
    expect(shiftFormula("=$A2+B$1", 2, 2)).toBe("=$A4+D$1");
    expect(shiftFormula("=SUM(A1:B2)", 3, 1)).toBe("=SUM(B4:C5)");
    expect(shiftFormula("=SUM($A$1:B2)", 1, 1)).toBe("=SUM($A$1:C3)");
    expect(shiftFormula('=IF(A1>3,"A1",A1)', 1, 0)).toBe('=IF(A2>3,"A1",A2)'); // text is not touched
    expect(shiftFormula("=  A1 + B1", 1, 0)).toBe("=  A2 + B2"); // spacing preserved
    expect(shiftFormula("hello", 1, 0)).toBe("hello");
  });
  it("copying off the top or left edge gives #REF!", () => {
    expect(shiftFormula("=A1+1", -1, 0)).toBe("=#REF!+1");
    expect(shiftFormula("=B2+1", 0, -2)).toBe("=#REF!+1");
    expect(shiftFormula("=SUM(A1:B2)", -1, 0)).toBe("=SUM(#REF!)");
    expect(ev("=#REF!+1")).toEqual(E("#REF!"));
  });
  it("copyCell recalculates with the right inputs", () => {
    const c0 = BOOKS.formulas.cells;
    expect(c0.F3).toBe("=D3*(1+$H$1)");
    const c1 = copyCell({ ...c0, F9: "" }, "F2", "F9");
    expect(c1.F9).toBe("=D9*(1+$H$1)");
    const abs = copyCell({ A1: "5", B1: "=$A$1*2", B2: "" }, "B1", "B2");
    expect(createEngine(abs).get("B2")).toBe(10); // absolute: same input
    const rel = copyCell({ A1: "5", A2: "7", B1: "=A1*2", B2: "" }, "B1", "B2");
    expect(createEngine(rel).get("B2")).toBe(14); // relative: moved down
  });
});

describe("preset workbooks evaluate to what their hints say", () => {
  const v = (id: string) => evaluateAll(BOOKS[id].cells).values;
  it("formulas", () => {
    const x = v("formulas");
    expect(x.D2).toBe(15); expect(x.E2).toBe("Small"); expect(x.E3).toBe("Big"); expect(x.D6).toBe(96); expect(x.F2).toBeCloseTo(18);
    expect(x.D8).toEqual(E("#DIV/0!")); expect(x.E8).toBe("no qty");
  });
  it("lookups", () => {
    const x = v("lookups");
    expect(x.F2).toBe(45); expect(x.G2).toBe(45); expect(x.H2).toBe(45);
    expect(x.F3).toEqual(E("#N/A")); expect(x.G3).toBe("not listed"); expect(x.H3).toEqual(E("#N/A"));
    expect(x.F4).toBe(6.25);
    expect(x.F8).toBe("C"); expect(x.F9).toBe("A"); expect(x.F10).toEqual(E("#N/A"));
  });
  it("sumifs", () => {
    const x = v("sumifs");
    expect(x.G2).toBe(70); expect(x.G3).toBe(3); expect(x.G4).toBeCloseTo(53.333, 2); expect(x.G5).toBe(120); expect(x.G6).toBe(4); expect(x.G7).toBe(30);
  });
  it("text-formulas", () => {
    const x = v("text-formulas");
    expect(x.B2).toBe("Ada Lovelace"); expect(x.C2).toBe("Ada"); expect(x.D2).toBe("Lovelace"); expect(x.B3).toBe("Grace Hopper");
    expect(x.B5).toBe("DF"); expect(x.C5).toBe(2024); expect(x.D5).toBe("0137");
    expect(x.B7).toBe("apple, banana, cherry"); expect(x.C7).toBe("apple-banana"); expect(x.D7).toBe("aPPle"); expect(x.E7).toBe(5); expect(x.F7).toBe("APPLEx");
  });
  it("dates", () => {
    const x = v("dates");
    expect(x.A2).toBe(45332); expect(x.B2).toBe(2024); expect(x.C2).toBe(2); expect(x.D2).toBe(10);
    expect(x.E2).toBe("Saturday, 10 February 2024"); expect(x.F2).toBe(ev("=DATE(2024,2,1)")); expect(x.G2).toBe(ev("=DATE(2024,2,29)"));
    expect(x.B6).toBe(308); expect(x.B7).toBe(ev("=DATE(2026,2,1)"));
  });
  it("every preset id maps to a book and a tab", () => {
    for (const p of PRESETS) expect(BOOKS[p.id], p.id).toBeTruthy();
    expect(PRESETS.map((p) => p.id)).toEqual(expect.arrayContaining(["formulas", "lookups", "sumifs", "pivot", "conditional-format", "cleaning", "text-formulas", "dates"]));
  });
});

describe("pivot table", () => {
  const base: PivotSpec = { rows: "Product", cols: "Region", value: "Amount", agg: "sum", filters: {} };
  const independent = (spec: PivotSpec, r?: string, c?: string) => SALES.filter((s) => (!spec.rows || r === undefined || s[spec.rows] === r) && (!spec.cols || c === undefined || s[spec.cols] === c)
    && (Object.entries(spec.filters) as [PivotField, string[]][]).every(([f, a]) => a.includes(s[f]))).map((s) => s[spec.value]);
  it("sum cells, row/column totals and grand total equal an independent aggregation", () => {
    const p = pivot(SALES, base);
    for (const r of p.rowKeys) for (const c of p.colKeys) {
      const xs = independent(base, r, c);
      expect(p.cell(r, c).value).toBe(xs.length ? xs.reduce((a, b) => a + b, 0) : null);
    }
    for (const r of p.rowKeys) expect(p.rowTotal(r).value).toBe(independent(base, r).reduce((a, b) => a + b, 0));
    for (const c of p.colKeys) expect(p.colTotal(c).value).toBe(independent(base, undefined, c).reduce((a, b) => a + b, 0));
    expect(p.grand.value).toBe(SALES.reduce((a, s) => a + s.Amount, 0));
    const sumRowTotals = p.rowKeys.reduce((a, r) => a + p.rowTotal(r).value!, 0);
    expect(sumRowTotals).toBe(p.grand.value);
  });
  it("every aggregation agrees with a hand computation, including a true (not averaged) grand average", () => {
    for (const agg of AGGS) {
      const spec = { ...base, agg };
      const p = pivot(SALES, spec);
      const all = SALES.map((s) => s.Amount);
      const want = { sum: all.reduce((a, b) => a + b, 0), count: all.length, average: all.reduce((a, b) => a + b, 0) / all.length, min: Math.min(...all), max: Math.max(...all) }[agg];
      expect(p.grand.value).toBeCloseTo(want, 9);
      for (const r of p.rowKeys) for (const c of p.colKeys) {
        const xs = independent(spec, r, c);
        const w = !xs.length ? null : { sum: xs.reduce((a, b) => a + b, 0), count: xs.length, average: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) }[agg];
        expect(p.cell(r, c).value).toBe(w);
      }
    }
  });
  it("source rows behind a cell are exactly the rows that match", () => {
    const p = pivot(SALES, base);
    const cell = p.cell("Book", "East");
    expect(cell.source.every((i) => SALES[i].Product === "Book" && SALES[i].Region === "East")).toBe(true);
    expect(cell.source.length).toBe(SALES.filter((s) => s.Product === "Book" && s.Region === "East").length);
    expect(p.grand.source).toHaveLength(SALES.length);
  });
  it("filters restrict the data and a missing combination is blank, not 0", () => {
    const spec: PivotSpec = { ...base, filters: { Year: ["2025"], Region: ["North", "South"] } };
    const p = pivot(SALES, spec);
    expect(p.colKeys).toEqual(["North", "South"]);
    expect(p.grand.value).toBe(independent(spec).reduce((a, b) => a + b, 0));
    expect(p.filtered.every((i) => SALES[i].Year === "2025")).toBe(true);
    const bare = pivot(SALES, { ...base, filters: { Product: ["Bag"], Region: ["North", "East"] } });
    expect(bare.cell("Bag", "East").value).toBe(135);
    expect(pivot(SALES, { ...base, rows: "Rep", cols: "Region" }).cell("Fay", "North").value).toBeNull();
  });
  it("works with no row or column field (a single total) and with an empty filter result", () => {
    const one = pivot(SALES, { ...base, rows: null, cols: null });
    expect(one.rowKeys).toEqual([""]); expect(one.cell("", "").value).toBe(one.grand.value);
    const none = pivot(SALES, { ...base, filters: { Region: [] } });
    expect(none.filtered).toHaveLength(0); expect(none.grand.value).toBeNull();
  });
  it("matches the lesson fixture shape: Product by Region", () => {
    // Same arrangement as the a096 lesson; totals are derived here from this lab's own fixture.
    const p = pivot(SALES, base);
    expect(p.rowKeys).toEqual(["Bag", "Book", "Pen"]);
    expect(p.colKeys).toEqual(["East", "North", "South"]);
  });
});

describe("conditional formatting", () => {
  const cells = BOOKS["conditional-format"].cells; // C2:C11 = 30,100,20,45,20,90,45,10,60,75
  const m = (rule: Parameters<typeof applyCf>[2], range = "C2:C11") => [...applyCf(cells, range, rule).matches].sort();
  it("greater than, less than, between", () => {
    expect(m({ kind: "gt", value: 70 })).toEqual(["C11", "C3", "C7"]);
    expect(m({ kind: "lt", value: 25 })).toEqual(["C4", "C6", "C9"]);
    expect(m({ kind: "between", lo: 40, hi: 60 })).toEqual(["C10", "C5", "C8"]);
    expect(m({ kind: "between", lo: 60, hi: 40 })).toEqual(["C10", "C5", "C8"]); // order of the bounds does not matter
  });
  it("text contains ignores case and skips numbers", () => {
    expect(m({ kind: "contains", text: "en" }, "A2:A11")).toEqual(["A10", "A3", "A4", "A9"]); // Ben and Chen
    expect(m({ kind: "contains", text: "BOOK" }, "B2:B11")).toEqual(["B10", "B3", "B7"]);
    expect(m({ kind: "contains", text: "1" }, "C2:C11")).toEqual([]);
    expect(m({ kind: "contains", text: "" }, "A2:A11")).toEqual([]);
  });
  it("top and bottom N include ties at the cut-off", () => {
    expect(m({ kind: "top", n: 2 })).toEqual(["C3", "C7"]);
    expect(m({ kind: "top", n: 4 })).toEqual(["C10", "C11", "C3", "C7"]);
    expect(m({ kind: "top", n: 5 })).toEqual(["C10", "C11", "C3", "C5", "C7", "C8"]); // 45 and 45 tie for 5th: both are formatted
    expect(m({ kind: "top", n: 2, bottom: true })).toEqual(["C4", "C6", "C9"]); // 10, then 20 and 20
    expect(m({ kind: "top", n: 0 })).toEqual([]);
    expect(m({ kind: "top", n: 99 })).toHaveLength(10);
  });
  it("duplicates", () => {
    expect(m({ kind: "duplicates" }, "C2:C11")).toEqual(["C4", "C5", "C6", "C8"]); // 20,20 and 45,45
    expect(m({ kind: "duplicates" }, "A2:A11")).toEqual(["A10", "A11", "A2", "A3", "A4", "A5", "A6", "A9"]); // every name appears twice except Eli and Fay
  });
  it("colour scale gives 0 at the minimum and 1 at the maximum", () => {
    const r = applyCf(cells, "C2:C11", { kind: "scale" });
    expect(r.scale.C9).toBe(0); expect(r.scale.C3).toBe(1); expect(r.scale.C2).toBeCloseTo(20 / 90);
    expect(r.matches.size).toBe(10);
  });
  it("a bad range explains itself", () => { expect(applyCf(cells, "nonsense", { kind: "gt", value: 1 }).note).toMatch(/range/); });
});

describe("data cleaning", () => {
  const col = (t: { cols: string[]; rows: (string | number)[][] }, c: string) => t.rows.map((r) => r[t.cols.indexOf(c)]);
  it("TRIM collapses inner runs and matches the TRIM formula", () => {
    const t = applyCleanOp(MESSY, { kind: "trim", col: "Name" });
    expect(col(t, "Name")[0]).toBe("ada lovelace");
    for (const [i, row] of MESSY.rows.entries()) expect(col(t, "Name")[i]).toBe(ev("=TRIM(A1)", { A1: `'${row[0]}` }));
  });
  it("PROPER after TRIM matches the PROPER(TRIM()) formula", () => {
    const t = applyCleanOps([{ kind: "trim", col: "Name" }, { kind: "proper", col: "Name" }]);
    for (const [i, row] of MESSY.rows.entries()) expect(col(t, "Name")[i]).toBe(ev("=PROPER(TRIM(A1))", { A1: `'${row[0]}` }));
    expect(col(t, "Name")).toEqual(["Ada Lovelace", "Grace Hopper", "Alan Turing", "Ada Lovelace", "Grace Hopper", "Margaret Hamilton"]);
  });
  it("VALUE turns text numbers into numbers, and leaves what it cannot read", () => {
    const t = applyCleanOp(MESSY, { kind: "value", col: "Amount" });
    expect(col(t, "Amount")).toEqual([1200, 45, 310, 1200, 45, 980]);
    expect(applyCleanOp({ cols: ["x"], rows: [["abc"]] }, { kind: "value", col: "x" }).rows[0][0]).toBe("abc");
  });
  it("date text becomes a serial number equal to DATE()", () => {
    const t = applyCleanOp(MESSY, { kind: "date", col: "Joined" });
    expect(col(t, "Joined")[0]).toBe(ev("=DATE(2025,3,5)"));
    expect(col(t, "Joined")[1]).toBe(ev("=DATE(2025,3,5)"));
    expect(col(t, "Joined")[2]).toBe(ev("=DATE(2025,3,17)"));
  });
  it("text to columns splits on the delimiter and trims the pieces", () => {
    const t = applyCleanOp(MESSY, { kind: "split", col: "Full name", delim: "," });
    expect(t.cols).toEqual(["Name", "City", "Amount", "Joined", "Full name", "Full name 1", "Full name 2"]);
    expect(col(t, "Full name 1")[0]).toBe("Lovelace"); expect(col(t, "Full name 2")[0]).toBe("Ada");
    expect(t.rows.every((r) => r.length === 7)).toBe(true);
  });
  it("remove duplicates is case-insensitive on the chosen columns and keeps the first", () => {
    const cleaned = applyCleanOps([{ kind: "trim", col: "Name" }, { kind: "proper", col: "Name" }, { kind: "trim", col: "City" }, { kind: "proper", col: "City" }, { kind: "trim", col: "Amount" }, { kind: "value", col: "Amount" }]);
    const t = applyCleanOp(cleaned, { kind: "dedupe", cols: ["Name", "City"] });
    expect(t.rows.length).toBe(4);
    expect(col(t, "Name")).toEqual(["Ada Lovelace", "Grace Hopper", "Alan Turing", "Margaret Hamilton"]);
    // Without cleaning first, the spaces hide the duplicates (the lesson).
    expect(applyCleanOp(MESSY, { kind: "dedupe", cols: ["Name"] }).rows.length).toBe(MESSY.rows.length);
  });
  it("never mutates its input", () => {
    const snapshot = JSON.stringify(MESSY);
    applyCleanOps([{ kind: "trim", col: "Name" }, { kind: "dedupe", cols: ["Name"] }, { kind: "split", col: "Full name", delim: "," }]);
    expect(JSON.stringify(MESSY)).toBe(snapshot);
  });
  it("before/after quality counts drop after cleaning and changed cells are reported", () => {
    const before = qualityIssues(MESSY);
    const ops = [{ kind: "trim", col: "Name" }, { kind: "proper", col: "Name" }, { kind: "trim", col: "City" }, { kind: "proper", col: "City" }, { kind: "trim", col: "Amount" }, { kind: "value", col: "Amount" }, { kind: "date", col: "Joined" }] as const;
    const after = qualityIssues(applyCleanOps([...ops]));
    expect(before.spaces).toBeGreaterThan(after.spaces); expect(after.spaces).toBe(0);
    expect(after.textNumbers).toBeLessThan(before.textNumbers); expect(after.textDates).toBe(0);
    const trimmed = applyCleanOp(MESSY, { kind: "trim", col: "Name" });
    const ch = changedCells(MESSY, trimmed);
    expect(ch.has("0,0")).toBe(true); expect(ch.has("2,0")).toBe(false);
  });
});

describe("safety and determinism", () => {
  it("has no volatile functions and no network or global access", () => {
    expect(SUPPORTED_FUNCTIONS).not.toContain("TODAY"); expect(SUPPORTED_FUNCTIONS).not.toContain("NOW"); expect(SUPPORTED_FUNCTIONS).not.toContain("RAND");
    expect(ev("=TODAY()")).toEqual(E("#NAME?"));
    expect(ev('=HYPERLINK("http://x","y")')).toEqual(E("#NAME?"));
  });
  it("a huge range is refused rather than allocated", () => {
    expect(ev("=SUM(A1:XFD1048576)")).toEqual(E("#VALUE!"));
  });
});
