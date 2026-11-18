import { describe, expect, it } from "vitest";
import { DATA_PRESETS, LEGACY_DATA_PRESETS, resolveDataPreset } from "../site/workspace/adapters/data/presets";

// The eight examples /visual/data offered before the stage view replaced its old viewer. Their code is pinned here, character for
// character, so a change to DATA_PRESETS cannot silently change what an old example did.
const OLD_PAGE_CODE: Record<string, string> = {
  "filter-and-sort": "import pandas as pd\ndf = pd.DataFrame({'city': ['Oslo', 'Rome', 'Lima', 'Kyiv'], 'sales': [120, 75, 200, 90]})\nbig = df[df['sales'] > 80]\nbig = big.sort_values('sales', ascending=False)\n",
  "groupby-and-aggregate": "import pandas as pd\ndf = pd.DataFrame({'team': ['a', 'b', 'a', 'b', 'a'], 'pts': [3, 5, 4, 1, 2]})\ntotals = df.groupby('team')['pts'].sum()\navg = df.groupby('team')['pts'].mean().reset_index()\n",
  merge: "import pandas as pd\nusers = pd.DataFrame({'id': [1, 2, 3], 'name': ['Ana', 'Ben', 'Chen']})\norders = pd.DataFrame({'user_id': [1, 1, 3], 'amount': [10, 20, 5]})\njoined = users.merge(orders, left_on='id', right_on='user_id', how='left')\n",
  "missing-values-and-types": "import pandas as pd\ndf = pd.DataFrame({'a': ['1', '2', 'x'], 'b': [1.5, None, 3.0]})\ndf['b'] = df['b'].fillna(0)\ndf['a'] = pd.to_numeric(df['a'], errors='coerce')\nclean = df.dropna()\n",
  "pivot-and-melt": "import pandas as pd\nlong = pd.DataFrame({'m': ['Jan', 'Jan', 'Feb', 'Feb'], 'k': ['x', 'y', 'x', 'y'], 'v': [1, 2, 3, 4]})\nwide = long.pivot(index='m', columns='k', values='v')\nback = wide.reset_index().melt(id_vars='m')\n",
  "duplicates-and-concat": "import pandas as pd\na = pd.DataFrame({'id': [1, 2, 2], 'v': [10, 20, 20]})\nb = pd.DataFrame({'id': [3], 'v': [30]})\nall_rows = pd.concat([a, b], ignore_index=True)\nunique = all_rows.drop_duplicates()\n",
  "numpy-broadcasting": "import numpy as np\na = np.arange(6).reshape(2, 3)\nb = np.array([10, 20, 30])\nc = a + b\ncol = np.array([[100], [200]])\nd = a + col\n",
  "masks-slicing-aggregation": "import numpy as np\nx = np.array([[1, 5, 9], [2, 6, 3]])\nmask = x > 4\nbig = x[mask]\nrow = x[0, :]\ncol_sums = x.sum(axis=0)\nflat = x.reshape(6)\n",
};

describe("/visual/data presets: every old example still resolves", () => {
  it("lists exactly the eight old ids, each with its old button label", () => {
    expect(LEGACY_DATA_PRESETS.map((l) => l.id).sort()).toEqual(Object.keys(OLD_PAGE_CODE).sort());
    expect(LEGACY_DATA_PRESETS.map((l) => l.label)).toEqual(["Filter and sort", "GroupBy and aggregate", "Merge", "Missing values and types", "Pivot and melt", "Duplicates and concat", "NumPy broadcasting", "Masks, slicing, aggregation"]);
  });
  it.each(Object.keys(OLD_PAGE_CODE))("old id %s resolves to a DATA_PRESETS entry", (id) => {
    const p = resolveDataPreset(id);
    expect(p, id).toBeDefined();
    expect(DATA_PRESETS).toContain(p);
    expect(resolveDataPreset(id.toUpperCase())).toBe(p); // links are case-insensitive
  });
  it("four old examples live on unchanged, the other four on a superset that still contains every operation", () => {
    const same = ["missing-values-and-types", "duplicates-and-concat", "masks-slicing-aggregation", "groupby-and-aggregate"];
    for (const id of same) expect(resolveDataPreset(id)!.code, id).toBe(OLD_PAGE_CODE[id]);
    // filter-and-sort: the old two filter lines are inside the new preset
    expect(resolveDataPreset("filter-and-sort")!.code).toContain("big = df[df['sales'] > 80]\nbig = big.sort_values('sales', ascending=False)\n");
    expect(resolveDataPreset("merge")!.code).toContain("users.merge(orders, left_on='id', right_on='user_id', how='left')");
    expect(resolveDataPreset("pivot-and-melt")!.code).toContain("wide = long.pivot(index='m', columns='k', values='v')\nback = wide.reset_index().melt(id_vars='m')\n");
    expect(resolveDataPreset("numpy-broadcasting")!.code).toContain("c = a + b".replace("b", "row")); // a + row: the same row broadcast
    expect(resolveDataPreset("numpy-broadcasting")!.code).toContain("d = a + col");
  });
  it("new ids, short aliases and the lesson preset words resolve; unknown ids do not", () => {
    for (const p of DATA_PRESETS) expect(resolveDataPreset(p.id)).toBe(p);
    for (const a of ["filter", "groupby", "merge", "missing", "dtype", "pivot", "melt", "duplicates", "concat", "broadcasting", "masks", "slicing", "reshaping", "axis", "beforeAfter", "reshape", "shapes", "broadcast"]) expect(resolveDataPreset(a), a).toBeDefined();
    expect(resolveDataPreset("nope")).toBeUndefined();
    expect(resolveDataPreset("")).toBeUndefined();
    expect(resolveDataPreset(null)).toBeUndefined();
  });
  it("every preset id is unique and the invalid examples are flagged", () => {
    expect(new Set(DATA_PRESETS.map((p) => p.id)).size).toBe(DATA_PRESETS.length);
    expect(DATA_PRESETS.filter((p) => p.fails).map((p) => p.id).sort()).toEqual(["np-broadcast-bad", "np-matmul-bad"]);
  });
});
