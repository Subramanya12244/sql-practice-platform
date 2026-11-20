/**
 * Pandas beats (lib/visual/pandasBeats.ts) against the real runtime: CPython with real pandas runs the probe, and a second,
 * independent run computes the truth (the real filter result, the real sort order, the real groupby, the real merge ...).
 * Every number or row a beat shows must equal that truth; a beat that cannot be proven falls back to the generic one.
 */
import { describe, expect, it } from "vitest";
import { buildDataBeats, type DataBeat } from "../site/lib/visual/dataBeats";
import { buildDataModel, runDataProbe, type DataModelData } from "../site/lib/visual/dataframe";
import { storyProblems } from "../site/lib/visual/story";
import type { CalcView, FlowView, GridView, GroupsView, PandasView, TableView } from "../site/lib/visual/pandasBeatParts";
import { createDataAdapter } from "../site/workspace/adapters/data";
import type { ExerciseDef, RunContext } from "../site/workspace/types";
import { cpythonRun, hasDataPython } from "./siteWorkspaceDataPy";

const IMPORT = "import pandas as pd\nimport numpy as np\nimport json\n";
async function analyse(code: string) {
  const full = code.startsWith("import") ? code : IMPORT + code;
  const r = await runDataProbe(full, { run: cpythonRun });
  const data = buildDataModel("pandas", r.probe!, full);
  return { data, beats: buildDataBeats(data), full };
}
/** The real value of a Python expression, from a fresh run of the same program. */
async function truth<T>(code: string, expr: string): Promise<T> {
  const full = `${code.startsWith("import") ? code : IMPORT + code}\nprint("@@" + json.dumps(${expr}, default=str))`;
  // (the shared helper always reports a failed phase after the program has run, so the program's own output is what counts)
  const out = await cpythonRun(full);
  expect(out.stdout, out.error).toContain("@@");
  return JSON.parse(out.stdout.split("@@").pop()!.trim()) as T;
}
const stageBeats = (beats: DataBeat[], stage: number) => beats.filter((b) => b.stage === stage);
const view = <T extends PandasView>(b: DataBeat) => b.view as unknown as T;
const lastStage = (data: DataModelData) => data.stages.length - 1;

const BRIEF = "import pandas as pd\nimport json\ndf = pd.DataFrame({'name': ['A','B','C','D'], 'salary': [30000, 60000, 45000, 80000]})\nresult = df[df['salary'] > 50000]\n";

describe.skipIf(!hasDataPython)("filter (the brief's salary example)", () => {
  it("is exactly five beats in the stated order, drawn by the pandas views", async () => {
    const { data, beats } = await analyse(BRIEF);
    const bs = stageBeats(beats, 1);
    expect(data.stages[1].op).toBe("[]");
    expect(bs.map((b) => b.title)).toEqual(["Input rows", "Condition", "Classify rows", "Filter rows", "Result"]);
    expect(bs.map((b) => b.view.type)).toEqual(["flow", "calc", "flow", "flow", "flow"]);
    expect(bs.every((b) => b.view.owner === "pandas" && b.of === 5)).toBe(true);
    expect(bs.map((b) => b.beat)).toEqual([0, 1, 2, 3, 4]);
    // Creating the DataFrame (stage 0) keeps its one generic beat, so the whole program is 1 + 5 steps.
    expect(beats).toHaveLength(6);
    expect(beats[0].view.owner).toBe("generic");
  });
  it("the per-row verdicts are the real mask, the kept rows are B and D, the removed rows A and C", async () => {
    const { beats } = await analyse(BRIEF);
    const real = await truth<{ mask: boolean[]; index: string[]; rows: string[][]; removed: string[] }>(BRIEF, `{"mask": (df['salary'] > 50000).tolist(), "index": [str(i) for i in result.index], "rows": result.astype(str).values.tolist(), "removed": [str(i) for i in df.index.difference(result.index)]}`);
    expect(real.mask).toEqual([false, true, false, true]);
    const bs = stageBeats(beats, 1);
    // beat 2: the condition evaluated per row, with the real operands
    const calc = view<CalcView>(bs[1]);
    expect(calc.rows.map((r) => r.parts.map((p) => p.text))).toEqual([["30000 > 50000", "False"], ["60000 > 50000", "True"], ["45000 > 50000", "False"], ["80000 > 50000", "True"]]);
    const verdicts = calc.rows.map((r) => r.parts[r.parts.length - 1].chip === "true");
    expect(verdicts).toEqual(real.mask);
    expect(calc.rows.map((r) => r.ident[0])).toEqual(["A", "B", "C", "D"]);
    // beat 3: every row card carries its verdict; beat 4: kept rows moved to the result lane, removed rows stay, faded
    const board = view<FlowView>(bs[2]).board;
    expect(board.cards.map((c) => c.at[1].verdict?.value)).toEqual(real.mask);
    const final = board.cards.map((c) => c.at[2]);
    const kept = board.cards.filter((_c, i) => final[i].lane === 1);
    const removed = board.cards.filter((_c, i) => final[i].lane === 0 && final[i].fade);
    expect(kept.map((c) => c.label)).toEqual(real.index);
    expect(kept.map((c) => c.cells[0])).toEqual(["B", "D"]);
    expect(removed.map((c) => c.label)).toEqual(real.removed);
    expect(removed.map((c) => c.cells[0])).toEqual(["A", "C"]);
    expect(kept.map((c) => c.at[2].row)).toEqual([0, 1]);
    expect(kept.every((c) => c.at[2].tone === "kept") && removed.every((c) => c.at[2].tone === "removed")).toBe(true);
    // beat 5: the result is the real DataFrame
    const res = view<FlowView>(bs[4]);
    expect(res.result!.snap.index).toEqual(real.index);
    expect(res.result!.snap.rows).toEqual(real.rows);
    expect(res.reasons).toEqual(["Row 0: 30000 > 50000 is False → removed", "Row 1: 60000 > 50000 is True → kept", "Row 2: 45000 > 50000 is False → removed", "Row 3: 80000 > 50000 is True → kept"]);
  });
  it("story numbers match the runtime, and all four parts of every beat pass the story guard", async () => {
    const { beats } = await analyse(BRIEF);
    const real = await truth<{ kept: number; removed: number; shapeIn: number[]; shapeOut: number[] }>(BRIEF, `{"kept": len(result), "removed": len(df) - len(result), "shapeIn": list(df.shape), "shapeOut": list(result.shape)}`);
    const bs = stageBeats(beats, 1);
    for (const b of bs) expect(storyProblems(b.story, { allowNaN: true }), b.title).toEqual([]);
    expect(real).toEqual({ kept: 2, removed: 2, shapeIn: [4, 2], shapeOut: [2, 2] });
    expect(bs[1].story.changed).toContain(`${real.kept} rows give True and ${real.removed} rows give False`);
    expect(bs[1].story.changed).toContain("True for 1, 3; False for 0, 2");
    expect(bs[1].story.what).toContain("df['salary'] > 50000");
    expect(bs[2].story.changed).toContain("Keep: rows 1, 3. Drop: rows 0, 2.");
    expect(bs[3].story.changed).toContain("4 rows → 2 rows; shape (4, 2) → (2, 2)");
    expect(bs[4].story.changed).toContain(`${real.kept} rows kept and ${real.removed} rows removed, out of 4`);
    expect(bs[4].story.why).toContain("Row 1 kept: 60000 > 50000 is True. Row 0 removed: 30000 > 50000 is False.");
    // The input beat states the whole table.
    expect(bs[0].story.what).toContain("4 rows and 2 columns (name, salary)");
  });
  it("a compound condition lists every part with its real operands and combines them like pandas", async () => {
    const code = "df = pd.DataFrame({'n': list('ABCD'), 's': [30, 60, 45, 80], 'd': ['IT', 'IT', 'HR', 'HR']})\nr = df[(df['s'] > 40) & (df['d'] == 'IT')]\n";
    const { beats, data } = await analyse(code);
    const bs = stageBeats(beats, 1);
    expect(bs).toHaveLength(5);
    const real = await truth<{ a: boolean[]; b: boolean[]; both: boolean[] }>(code, "{'a': (df['s'] > 40).tolist(), 'b': (df['d'] == 'IT').tolist(), 'both': ((df['s'] > 40) & (df['d'] == 'IT')).tolist()}");
    const calc = view<CalcView>(bs[1]);
    expect(calc.heads.map((h) => h.text)).toEqual(["df['s'] > 40", "df['d'] == 'IT'", "combined (&)"]);
    const chips = (k: number) => calc.rows.map((r) => r.parts[k].chip === "true");
    expect(chips(1)).toEqual(real.a);
    expect(chips(3)).toEqual(real.b);
    expect(chips(5)).toEqual(real.both);
    expect(data.stages[1].cond?.joiner).toBe("&");
  });
  it("a threshold computed by mean() is shown as its real value, not as a numpy repr", async () => {
    const code = "df = pd.DataFrame({'s': [30000, 60000, 45000, 80000]})\nr = df[df['s'] > df['s'].mean()]\n";
    const { beats } = await analyse(code);
    const calc = view<CalcView>(stageBeats(beats, 1)[1]);
    expect(calc.rows[0].parts[0].text).toBe("30000 > 53750.0");
  });
  it("without the condition's parts (a stored mask) the same five beats show the real mask only", async () => {
    const code = "df = pd.DataFrame({'s': [1, 5, 2, 8]})\nm = df['s'] > 3\nr = df[m]\n";
    const { beats, data } = await analyse(code);
    const stage = data.stages.findIndex((s) => s.op === "[]");
    expect(data.stages[stage].cond!.leaves[0].op).toBeUndefined(); // a variable has no operands to show
    const bs = stageBeats(beats, stage);
    expect(bs).toHaveLength(5);
    const calc = view<CalcView>(bs[1]);
    expect(calc.heads).toEqual([{ text: "m", span: 1 }]);
    expect(calc.rows.map((r) => r.parts[0].chip === "true")).toEqual([false, true, false, true]);
    // and the stored mask is itself a calculation: operands, per row, result
    const cmp = stageBeats(beats, data.stages.findIndex((s) => s.kind === "compare"));
    expect(cmp.map((b) => b.title)).toEqual(["Operands", "Compare each row", "Result"]);
  });
});

describe.skipIf(!hasDataPython)("sort", () => {
  const code = "df = pd.DataFrame({'n': list('ABCDE'), 's': [30, 60, 45, 80, 45]})\nr = df.sort_values('s', ascending=False)\n";
  it("the permutation equals the real order and the direction is stated only because the data proves it", async () => {
    const { beats } = await analyse(code);
    const bs = stageBeats(beats, 1);
    expect(bs.map((b) => b.title)).toEqual(["Current order", "Read the sort key", "Reorder rows", "Result"]);
    const real = await truth<{ order: string[]; pos: number[] }>(code, "{'order': [str(i) for i in r.index], 'pos': [list(r.index).index(i) for i in df.index]}");
    const board = view<FlowView>(bs[2]).board;
    expect(board.cards.map((c) => c.at[2].row)).toEqual(real.pos);
    expect(board.cards.every((c) => c.at[2].lane === 1)).toBe(true);
    expect(view<FlowView>(bs[3]).result!.snap.index).toEqual(real.order);
    expect(bs[2].story.changed).toContain(`New order: ${real.order.join(", ")}`);
    expect(bs[1].story.what).toContain("from largest to smallest");
    expect(view<FlowView>(bs[1]).board.cards.map((c) => c.at[1].badge)).toEqual(real.pos.map((p) => `→ #${p + 1}`));
  });
  it("sort_index and an already sorted table say so", async () => {
    const c2 = "df = pd.DataFrame({'s': [3, 1, 2]}, index=[2, 0, 1])\nr = df.sort_index()\nq = r.sort_index()\n";
    const { beats, data } = await analyse(c2);
    const first = stageBeats(beats, 1), second = stageBeats(beats, data.stages.findIndex((s, i) => i > 1 && s.op === "sort_index"));
    expect(first[1].story.what).toContain("the index labels");
    expect(second[2].story.changed).toContain("already sorted");
    expect((await truth<number[]>(c2, "list(r.index)"))).toEqual([0, 1, 2]);
  });
  it("an in-place sort is recognised from its statement", async () => {
    const c3 = "df = pd.DataFrame({'s': [3, 1, 2]})\ndf.sort_values('s', inplace=True)\n";
    const { beats, data } = await analyse(c3);
    const i = data.stages.findIndex((s) => s.kind === "change" && s.op === "in-place");
    expect(stageBeats(beats, i).map((b) => b.view.type)).toEqual(["flow", "flow", "flow", "flow"]);
    expect(stageBeats(beats, i)[2].story.changed).toContain("New order: 1, 2, 0");
  });
});

describe.skipIf(!hasDataPython)("select, drop and calculate columns", () => {
  it("column selection: the chosen columns are the real result's columns", async () => {
    const code = "df = pd.DataFrame({'n': ['A', 'B'], 's': [30, 60], 'd': [1, 2]})\na = df[['n', 's']]\nb = df['s']\n";
    const { beats } = await analyse(code);
    const real = await truth<{ a: string[]; b: string }>(code, "{'a': list(a.columns), 'b': b.name}");
    const g = view<GridView>(stageBeats(beats, 1)[1]).grid;
    expect(g.cols.filter((_, j) => g.colTone[j] === "kept")).toEqual(real.a);
    expect(g.cols.filter((_, j) => g.colTone[j] === "removed")).toEqual(["d"]);
    const t = view<TableView>(stageBeats(beats, 1)[2]);
    expect(t.snap.cols).toEqual(real.a);
    const g2 = view<GridView>(stageBeats(beats, 2)[1]).grid;
    expect(g2.cols.filter((_, j) => g2.colTone[j] === "kept")).toEqual([real.b]);
    expect(stageBeats(beats, 2)[2].story.what).toContain(`a Series named ${real.b}`);
  });
  it("drop(columns=...) marks the real dropped columns", async () => {
    const code = "df = pd.DataFrame({'n': ['A'], 's': [30], 'd': [1]})\nr = df.drop(columns=['d', 's'])\n";
    const { beats } = await analyse(code);
    const g = view<GridView>(stageBeats(beats, 1)[1]).grid;
    expect(g.cols.filter((_, j) => g.colTone[j] === "removed")).toEqual(["s", "d"].sort((a, b) => ["n", "s", "d"].indexOf(a) - ["n", "s", "d"].indexOf(b)));
    expect(view<TableView>(stageBeats(beats, 1)[2]).snap.cols).toEqual(await truth<string[]>(code, "list(r.columns)"));
  });
  it("a calculation shows the real operands and the real result per row (Series * scalar, column + column)", async () => {
    const code = "df = pd.DataFrame({'a': [1, 2, 3], 'b': [10, 20, 40]})\ns = df['a'] * df['b']\nt = df['a'] * 0.5\nm = df['b'] > 15\n";
    const { beats, data } = await analyse(code);
    const real = await truth<{ s: string[]; t: string[]; m: string[] }>(code, "{'s': [str(x) for x in s], 't': [str(x) for x in t], 'm': [str(x) for x in m]}");
    const calcOf = (op: string) => view<CalcView>(stageBeats(beats, data.stages.findIndex((x) => x.expr.startsWith(op)))[1]);
    expect(calcOf("df['a'] * df['b']").rows.map((r) => r.parts.map((p) => p.text))).toEqual([["1", "*", "10", "10"], ["2", "*", "20", "40"], ["3", "*", "40", "120"]]);
    expect(calcOf("df['a'] * df['b']").rows.map((r) => r.parts[3].text)).toEqual(real.s);
    expect(calcOf("df['a'] * 0.5").rows.map((r) => r.parts[3].text)).toEqual(real.t);
    expect(calcOf("df['a'] * 0.5").rows.map((r) => r.parts[2].text)).toEqual(["0.5", "0.5", "0.5"]);
    expect(calcOf("df['b'] > 15").rows.map((r) => r.parts[3].text)).toEqual(real.m);
    // the first beat hides the result column; the second shows it
    const first = view<CalcView>(stageBeats(beats, data.stages.findIndex((x) => x.expr.startsWith("df['a'] * df['b']")))[0]);
    expect(first.hideResult).toBe(true);
  });
  it("df['c'] = expr and assign(): the new column's per-row values equal the real column, next to the operands", async () => {
    const code = "df = pd.DataFrame({'salary': [30000, 60000], 'name': ['A', 'B']})\ndf['bonus'] = df['salary'] * 0.1\nd2 = df.assign(total=df['salary'] + df['bonus'])\n";
    const { beats, data } = await analyse(code);
    const real = await truth<{ bonus: string[]; total: string[] }>(code, "{'bonus': [str(x) for x in df['bonus']], 'total': [str(x) for x in d2['total']]}");
    const ch = data.stages.findIndex((s) => s.kind === "change" && s.op === "in-place");
    const g = view<GridView>(stageBeats(beats, ch)[1]).grid;
    expect(g.cols).toEqual(["salary", "name", "bonus"]);
    expect(g.colTone).toEqual(["used", "normal", "new"]);
    expect(g.rows.map((r) => r[2])).toEqual(real.bonus);
    expect(view<GridView>(stageBeats(beats, ch)[0]).grid.colTone).toEqual(["used", "normal"]);
    expect(stageBeats(beats, ch)[1].story.changed).toContain("row 0: salary 30000 → bonus 3000.0");
    const as = data.stages.findIndex((s) => s.op === "assign" && s.kind === "call");
    const ga = view<GridView>(stageBeats(beats, as)[1]).grid;
    expect(ga.rows.map((r) => r[ga.cols.indexOf("total")])).toEqual(real.total);
    expect(ga.colTone[ga.cols.indexOf("total")]).toBe("new");
    expect(ga.colTone[ga.cols.indexOf("salary")]).toBe("used");
    expect(ga.colTone[ga.cols.indexOf("bonus")]).toBe("used");
  });
});

describe.skipIf(!hasDataPython)("groupby and aggregation", () => {
  const code = "df = pd.DataFrame({'k': ['a', 'b', 'a', 'b', 'c'], 'v': [1, 2, 3, 4, 5], 'w': [10, 20, 30, 40, 50]})\ng = df.groupby('k')\nt = g['v'].sum()\nm = g.mean()\n";
  it("groups form: every row's group equals the real groupby membership", async () => {
    const { beats, data } = await analyse(code);
    const gi = data.stages.findIndex((s) => s.op === "groupby");
    const bs = stageBeats(beats, gi);
    expect(bs.map((b) => b.title)).toEqual(["Input rows", "Find the groups", "Rows move into groups"]);
    const real = await truth<Record<string, number[]>>(code, "{k: [int(i) for i in v] for k, v in g.groups.items()}");
    const board = view<FlowView>(bs[2]).board;
    const byGroup: Record<string, number[]> = {};
    board.cards.filter((c) => c.head === undefined).forEach((c) => { const grp = c.at[1].badge!; (byGroup[grp] ??= []).push(Number(c.label)); });
    expect(byGroup).toEqual(real);
    // after the move every row sits in lane 1 under its group's header
    const heads = board.cards.filter((c) => c.head !== undefined);
    expect(heads.map((c) => c.head)).toEqual(["k = a · 2 rows", "k = b · 2 rows", "k = c · 1 row"]);
    const rowsAt = (label: string) => board.cards.find((c) => c.label === label)!.at[2];
    expect(rowsAt("0").lane).toBe(1);
    expect(rowsAt("0").row).toBe(heads[0].at[2].row + 1);
    expect(bs[1].story.changed).toContain("3 distinct keys: a (2 rows), b (2 rows), c (1 row)");
  });
  it("each aggregate's inputs and result equal the real groupby result", async () => {
    const { beats, data } = await analyse(code);
    const real = await truth<{ sum: Record<string, number>; members: Record<string, number[]>; mean: Record<string, Record<string, number>> }>(code, "{'sum': {k: int(v) for k, v in t.items()}, 'members': {k: [int(x) for x in df[df.k == k]['v']] for k in df.k.unique()}, 'mean': {c: {k: float(v) for k, v in m[c].items()} for c in m.columns}}");
    const sumStage = data.stages.findIndex((s) => s.op === "sum");
    const bs = stageBeats(beats, sumStage);
    expect(bs.map((b) => b.title)).toEqual(["The groups", "sum per group", "Result"]);
    const gv = view<GroupsView>(bs[1]);
    expect(gv.groups.map((b) => b.key)).toEqual(Object.keys(real.sum));
    gv.groups.forEach((b) => {
      expect(Number(b.calcs[0].value)).toBe(real.sum[b.key]);
      expect(b.calcs[0].values.map(Number)).toEqual(real.members[b.key]);
      expect(b.calcs[0].values.map(Number).reduce((x, y) => x + y, 0)).toBe(real.sum[b.key]);
    });
    expect(bs[1].story.changed).toContain("a: sum(1, 3) = 4");
    expect(view<GroupsView>(bs[2]).result!.rows).toEqual(Object.values(real.sum).map((v) => [String(v)]));
    // a DataFrame aggregation: one calculation per value column
    const meanStage = data.stages.findIndex((s) => s.op === "mean");
    const mv = view<GroupsView>(stageBeats(beats, meanStage)[1]);
    expect(mv.cols).toEqual(["v", "w"]);
    mv.groups.forEach((b) => b.calcs.forEach((c) => expect(Number(c.value)).toBeCloseTo(real.mean[c.col][b.key], 9)));
  });
  it("count and size, and a sampled group list (more than 6 groups) says so while the counts stay exact", async () => {
    const big = "df = pd.DataFrame({'k': [str(i % 9) for i in range(27)], 'v': list(range(27))})\nt = df.groupby('k')['v'].count()\n";
    const { beats, data } = await analyse(big);
    const i = data.stages.findIndex((s) => s.op === "count");
    const gv = view<GroupsView>(stageBeats(beats, i)[1]);
    expect(gv.groups).toHaveLength(6);
    expect(gv.moreGroups).toBe(3);
    expect(gv.sampled).toMatch(/6 of 9 groups/);
    expect(stageBeats(beats, i)[0].story.what).toContain("9 groups");
    expect(gv.groups[0].calcs[0].value).toBe("3");
  });
});

describe.skipIf(!hasDataPython)("merge and join", () => {
  const A = "a = pd.DataFrame({'id': [1, 2, 3, 3], 'x': ['p', 'q', 'r', 's']})\nb = pd.DataFrame({'id': [2, 3, 3, 4], 'y': [10, 20, 30, 40]})\n";
  for (const how of ["inner", "left", "right", "outer"] as const) {
    it(`how='${how}': matched keys, unmatched rows and the row count equal the real merge`, async () => {
      const code = `${A}m = a.merge(b, on='id', how='${how}')\n`;
      const { beats, data } = await analyse(code);
      const si = data.stages.findIndex((s) => s.op === "merge");
      const bs = stageBeats(beats, si);
      expect(bs.map((b) => b.title)).toEqual(["Two tables", "Match the keys", `Keep rows (${how})`, "Result"]);
      const real = await truth<{ rows: number; pairs: number; leftOnly: number; rightOnly: number; matched: number[]; origin: Record<string, number>; outIds: string[] }>(code,
        "{'rows': len(m), 'pairs': sum(1 for x in a.id for y in b.id if x == y), 'leftOnly': int((~a.id.isin(b.id)).sum()), 'rightOnly': int((~b.id.isin(a.id)).sum()), 'matched': sorted(set(a.id) & set(b.id)), 'origin': a.merge(b, on='id', how='" + how + "', indicator=True)['_merge'].astype(str).value_counts().to_dict(), 'outIds': [str(x) for x in m['id']]}");
      const m = data.stages[si].merge!;
      expect(m.outRows).toBe(real.rows);
      expect(m.matchedKeys!.map((k) => Number(k.key))).toEqual(real.matched);
      expect(m.leftUnmatchedRows).toBe(real.leftOnly);
      expect(m.rightUnmatchedRows).toBe(real.rightOnly);
      expect(view<TableView>(bs[3]).snap.shape).toEqual([real.rows, 3]);
      expect(view<TableView>(bs[3]).snap.rows!.map((r) => r[0])).toEqual(real.outIds);
      // links: one line for every (left row, right row) pair with an equal key
      const board = view<FlowView>(bs[1]).board;
      expect(board.links).toHaveLength(real.pairs);
      // tones: left rows flagged unmatched are exactly those with no key on the right
      const lt = board.cards.filter((c) => c.id.startsWith("L:")).map((c) => c.at[1].tone);
      expect(lt).toEqual(["unmatched", "matched", "matched", "matched"]);
      expect(Object.fromEntries(Object.entries(m.originCounts ?? {}))).toEqual(Object.fromEntries(Object.entries(real.origin).map(([k, v]) => [k, v])));
      expect(bs[3].story.what).toContain(`${real.rows} rows`);
      expect(bs[1].story.changed).toContain(`${real.matched.length} keys appear on both sides`);
      // which unmatched rows survive
      const keepsLeft = how === "left" || how === "outer", keepsRight = how === "right" || how === "outer";
      const fin = board.cards.map((c) => ({ side: c.id[0], matched: c.at[1].tone === "matched", faded: !!c.at[2].fade }));
      expect(fin.filter((x) => x.side === "L" && !x.matched).every((x) => x.faded === !keepsLeft)).toBe(true);
      expect(fin.filter((x) => x.side === "R" && !x.matched).every((x) => x.faded === !keepsRight)).toBe(true);
    });
  }
  it("repeated keys multiply rows, and the story says by how much", async () => {
    const code = `${A}m = a.merge(b, on='id')\n`;
    const { beats, data } = await analyse(code);
    const bs = stageBeats(beats, data.stages.findIndex((s) => s.op === "merge"));
    expect(bs[2].story.changed).toContain("3: 2×2 = 4 rows");
    expect((await truth<number>(code, "len(m)"))).toBe(5);
  });
  it("df.join uses the index as the key", async () => {
    const code = "a = pd.DataFrame({'x': [1, 2, 3]}, index=['p', 'q', 'r'])\nb = pd.DataFrame({'y': [10, 20]}, index=['q', 'r'])\nj = a.join(b, how='left')\n";
    const { beats, data } = await analyse(code);
    const bs = stageBeats(beats, data.stages.findIndex((s) => s.op === "join"));
    expect(bs).toHaveLength(4);
    expect(view<FlowView>(bs[1]).board.links).toHaveLength(2);
    expect(await truth<number>(code, "len(j)")).toBe(3);
  });
});

describe.skipIf(!hasDataPython)("missing values and duplicates", () => {
  const NA = "df = pd.DataFrame({'a': [1, np.nan, 3, 4], 'b': [np.nan, 5, 6, np.nan], 'c': ['x', 'y', 'z', 'w']})\n";
  it("dropna: the marked cells are the real NaN positions and the kept rows are the real survivors", async () => {
    const code = `${NA}r = df.dropna()\n`;
    const { beats } = await analyse(code);
    const bs = stageBeats(beats, 1);
    expect(bs.map((b) => b.title)).toEqual(["Input rows", "Mark missing values", "Apply the rule", "Filter rows", "Result"]);
    const real = await truth<{ nan: boolean[][]; kept: string[]; verdict: boolean[] }>(code, "{'nan': df.isna().values.tolist(), 'kept': [str(i) for i in r.index], 'verdict': [bool(i in r.index) for i in df.index]}");
    const board = view<FlowView>(bs[1]).board;
    expect(board.cards.map((c) => c.nan)).toEqual(real.nan);
    expect(board.cards.every((c) => c.at[1].flags === true && c.at[0].flags !== true)).toBe(true);
    expect(view<FlowView>(bs[2]).board.cards.map((c) => c.at[2].verdict?.value)).toEqual(real.verdict);
    expect(view<FlowView>(bs[4]).result!.snap.index).toEqual(real.kept);
    expect(bs[1].story.changed).toContain("3 missing cells");
    expect(bs[1].story.changed).toContain("rows 0, 1, 3");
    expect(bs[2].story.what).toContain("any value is missing");
  });
  it("dropna with how/subset states the matching rule, and refuses a rule the data does not bear out", async () => {
    const code = `${NA}r = df.dropna(subset=['a'])\n`;
    const { beats, data } = await analyse(code);
    const bs = stageBeats(beats, 1);
    expect(bs[2].story.what).toContain("any value among a is missing");
    expect(view<FlowView>(bs[4]).result!.snap.index).toEqual(await truth<string[]>(code, "[str(i) for i in r.index]"));
    // tampering with the recorded row flow so the rule no longer predicts it: the beats are not produced
    const tampered = structuredClone(data);
    tampered.stages[1].rows!.shownKept = tampered.stages[1].rows!.shownKept!.map((k) => !k);
    expect(stageBeats(buildDataBeats(tampered), 1)).toHaveLength(1);
    expect(stageBeats(buildDataBeats(tampered), 1)[0].view.owner).toBe("generic");
  });
  it("fillna / ffill: the marked cells are the real NaN positions and the filled values are the real ones", async () => {
    const code = `${NA}f = df.fillna(0)\nff = df.ffill()\n`;
    const { beats, data } = await analyse(code);
    const real = await truth<{ nan: boolean[][]; filled: string[][]; ff: string[][]; nanAfter: boolean[][] }>(code, "{'nan': df.isna().values.tolist(), 'filled': f.astype(str).values.tolist(), 'ff': ff.astype(str).values.tolist(), 'nanAfter': ff.isna().values.tolist()}");
    const fi = data.stages.findIndex((s) => s.op === "fillna");
    const g1 = view<GridView>(stageBeats(beats, fi)[0]).grid;
    expect(g1.cellTone!.map((r) => r.map((t) => t === "nan"))).toEqual(real.nan);
    const g2 = view<GridView>(stageBeats(beats, fi)[1]).grid;
    g2.cellText!.forEach((r, i) => r.forEach((t, j) => { if (real.nan[i][j]) expect(t).toBe(`NaN → ${real.filled[i][j]}`); else expect(t).toBeNull(); }));
    expect(view<TableView>(stageBeats(beats, fi)[2]).snap.rows!.map((r) => r.map(String))).toEqual(real.filled);
    // a gap with nothing to copy stays NaN, and the picture keeps it marked
    const ffi = data.stages.findIndex((s) => s.op === "ffill");
    const gf = view<GridView>(stageBeats(beats, ffi)[1]).grid;
    gf.cellTone!.forEach((r, i) => r.forEach((t, j) => { if (real.nan[i][j]) expect(t).toBe(real.nanAfter[i][j] ? "nan" : "new"); }));
    expect(stageBeats(beats, ffi)[1].story.what).toContain("copies the last known value");
  });
  it("isna: the marked cells and the True cells are the real NaN positions", async () => {
    const code = `${NA}z = df.isna()\n`;
    const { beats } = await analyse(code);
    const bs = stageBeats(beats, 1);
    const real = await truth<{ nan: boolean[][]; n: number }>(code, "{'nan': z.values.tolist(), 'n': int(z.values.sum())}");
    expect(view<GridView>(bs[1]).grid.cellTone!.map((r) => r.map((t) => t === "nan"))).toEqual(real.nan);
    expect(view<TableView>(bs[2]).snap.rows!.map((r) => r.map((c) => c === "True"))).toEqual(real.nan);
    expect(bs[1].story.changed).toContain(`${real.n} missing cells → ${real.n} True values`);
  });
  it("drop_duplicates: which row duplicates which, and the kept rows, equal the real result", async () => {
    const code = "df = pd.DataFrame({'a': [1, 1, 2, 2, 1], 'b': ['x', 'x', 'y', 'z', 'x']})\nr = df.drop_duplicates()\nq = df.drop_duplicates(subset=['a'], keep='last')\n";
    const { beats, data } = await analyse(code);
    const bs = stageBeats(beats, 1);
    expect(bs.map((b) => b.title)).toEqual(["Input rows", "Compare rows", "Remove duplicates", "Result"]);
    const real = await truth<{ dup: boolean[]; first: number[]; kept: string[]; keptLast: string[] }>(code, "{'dup': df.duplicated().tolist(), 'first': [int(df[(df.a == r_.a) & (df.b == r_.b)].index[0]) for _, r_ in df.iterrows()], 'kept': [str(i) for i in r.index], 'keptLast': [str(i) for i in q.index]}");
    const board = view<FlowView>(bs[1]).board;
    board.cards.forEach((c, i) => expect(c.at[1].badge).toBe(real.dup[i] ? `copy of ${real.first[i]}` : i === 0 ? "original" : "unique"));
    expect(board.cards.map((c) => c.at[1].tone === "dup")).toEqual(real.dup);
    expect(view<FlowView>(bs[3]).result!.snap.index).toEqual(real.kept);
    const qi = data.stages.findIndex((s) => s.code.includes("keep='last'"));
    expect(view<FlowView>(stageBeats(beats, qi)[3]).result!.snap.index).toEqual(real.keptLast);
    expect(stageBeats(beats, qi)[1].story.why).toContain("keeping the last");
  });
  it("df.drop(index) and query() use the real kept / removed rows", async () => {
    const code = "df = pd.DataFrame({'s': [1, 5, 2, 8]})\nr = df.drop([0, 2])\nq = df.query('s > 3')\n";
    const { beats, data } = await analyse(code);
    const di = data.stages.findIndex((s) => s.op === "drop");
    expect(stageBeats(beats, di).map((b) => b.title)).toEqual(["Input rows", "Classify rows", "Drop rows", "Result"]);
    expect(view<FlowView>(stageBeats(beats, di)[3]).result!.snap.index).toEqual(await truth<string[]>(code, "[str(i) for i in r.index]"));
    const qi = data.stages.findIndex((s) => s.op === "query");
    expect(stageBeats(beats, qi)).toHaveLength(4);
    expect(view<FlowView>(stageBeats(beats, qi)[3]).result!.snap.index).toEqual(await truth<string[]>(code, "[str(i) for i in q.index]"));
  });
});

describe.skipIf(!hasDataPython)("sampled data, fallbacks, purity, adapter", () => {
  const big = "df = pd.DataFrame({'id': list(range(40)), 'v': [i * 3 for i in range(40)]})\nr = df[df['v'] > 60]\ns = df.sort_values('v', ascending=False)\n";
  it("more than 12 rows: the picture is labelled sampled and the story numbers stay exact", async () => {
    const { beats, data } = await analyse(big);
    const real = await truth<{ kept: number; removed: number }>(big, "{'kept': len(r), 'removed': len(df) - len(r)}");
    const bs = stageBeats(beats, 1);
    const f = view<FlowView>(bs[0]);
    expect(f.board.cards).toHaveLength(12);
    expect(f.sampled).toMatch(/the first 12 of 40 rows/);
    expect(f.board.lanes[0].count).toBe("40");
    expect(f.board.lanes[1].count).toBe(String(real.kept));
    expect(bs[3].story.changed).toContain(`40 rows → ${real.kept} rows`);
    expect(bs[4].story.changed).toContain(`${real.kept} rows kept and ${real.removed} rows removed, out of 40`);
    expect(bs[1].story.changed).toContain(`${real.kept} rows give True`);
    expect(data.analyses[1].rowsRetained).toBe(real.kept);
    // the sort of 40 rows: positions are drawn only for rows that are in both windows; the first rows of the result are the real top rows
    const ss = stageBeats(beats, 2);
    expect(view<FlowView>(ss[2]).sampled).toMatch(/first 12 of 40 rows/);
    const top = await truth<string[]>(big, "[str(i) for i in s.index[:12]]");
    expect(view<FlowView>(ss[3]).result!.snap.index).toEqual(top);
    expect(ss[3].story.what).toContain("its first 12 rows are drawn");
    // rows that sort beyond the drawn rows are marked, not invented
    const board = view<FlowView>(ss[2]).board;
    expect(board.cards.some((c) => c.at[2].badge === "sorted beyond the drawn rows")).toBe(true);
    expect(board.cards.some((c) => c.at[2].badge === "from beyond the drawn rows")).toBe(true);
  });
  it("stages whose data is missing or contradicts a beat fall back to the generic beat", async () => {
    const code = "df = pd.DataFrame({'a': [1, 2, 3, 4]})\nh = df.head(2)\nd = pd.DataFrame({'a': [1, 1]}, index=[0, 0])\nx = d[d['a'] > 0]\n";
    const { beats, data } = await analyse(code);
    const head = data.stages.findIndex((s) => s.op === "head");
    expect(stageBeats(beats, head)).toHaveLength(1);
    expect(stageBeats(beats, head)[0].view.owner).toBe("generic");
    const dup = data.stages.findIndex((s) => s.op === "[]");
    expect(stageBeats(beats, dup)[0].view.owner).toBe("generic"); // duplicate index labels: rows cannot be followed
    expect(storyProblems(stageBeats(beats, dup)[0].story, { allowNaN: true })).toEqual([]);
  });
  it("every story of every beat has all four parts and passes the guard (with real NaN allowed)", async () => {
    const programs = [BRIEF, big, `${A_NA}r = df.dropna()\nf = df.fillna(0)\nz = df.isna()\nd = df.drop_duplicates()\n`, "df = pd.DataFrame({'k': list('abab'), 'v': [1, 2, 3, 4]})\nt = df.groupby('k')['v'].mean()\nm = df.merge(df, on='k')\ns = df.sort_values('v')\nc = df[['v']]\ndf['w'] = df['v'] + 1\n"];
    let pandasBeats = 0;
    for (const p of programs) {
      const { beats } = await analyse(p);
      for (const b of beats) {
        expect(storyProblems(b.story, { allowNaN: true }), `${b.id} ${b.title}`).toEqual([]);
        if (b.view.owner === "pandas") pandasBeats++;
      }
    }
    expect(pandasBeats).toBeGreaterThan(30);
  });
  it("a beat is a pure function of the stage: building twice gives equal beats and never changes the stage data", async () => {
    const { data } = await analyse(BRIEF + "g = df.groupby('name')['salary'].sum()\nm = df.merge(df, on='name')\n");
    const before = JSON.stringify(data);
    const a = buildDataBeats(data), b = buildDataBeats(data);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(data)).toBe(before);
    // ids are stable and unique, so Previous / Next / Reset resolve to the same beat object contents
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });
  it("the adapter's step count is the number of beats", async () => {
    const ex = { id: "x" } as unknown as ExerciseDef;
    const ctx = { exercise: ex, now: () => 0 } as unknown as RunContext;
    const a = createDataAdapter("pandas", { runner: cpythonRun });
    const out = await a.run(BRIEF, ctx);
    const vm = await a.visualize!(BRIEF, out, ctx);
    const data = vm!.data as DataModelData;
    expect(vm!.steps).toBe(buildDataBeats(data).length);
    expect(vm!.steps).toBe(1 + 5);
    expect(lastStage(data)).toBe(1);
  });
});

const A_NA = "df = pd.DataFrame({'a': [1, np.nan, 3, 4], 'b': [np.nan, 5, 6, np.nan], 'c': ['x', 'y', 'z', 'w']})\n";
