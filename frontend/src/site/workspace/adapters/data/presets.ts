/**
 * Worked examples for the pandas and NumPy stage view. Every one of them is run for real (CPython in the unit tests, Pyodide in
 * `frontend/scripts/data-stages-verify.ts`); nothing here is an expected picture, only code. `fails` marks the examples that are
 * supposed to raise, to show NumPy's real error next to the shape rule.
 */
import type { DataDomain } from "./adapter";

export interface DataPreset { id: string; domain: DataDomain; title: string; code: string; fails?: boolean }

const P = (id: string, title: string, code: string): DataPreset => ({ id, domain: "pandas", title, code });
const N = (id: string, title: string, code: string, fails = false): DataPreset => ({ id, domain: "numpy", title, code, fails });

export const DATA_PRESETS: DataPreset[] = [
  P("pd-create", "Create a DataFrame", "import pandas as pd\ndf = pd.DataFrame({'city': ['Oslo', 'Rome', 'Lima', 'Kyiv'], 'sales': [120, 75, 200, 90]})\n"),
  P("pd-read-csv", "Read CSV text", "import io\nimport pandas as pd\ntext = 'id,name,score\\n1,Ana,9.5\\n2,Ben,\\n3,Chen,7\\n'\ndf = pd.read_csv(io.StringIO(text))\n"),
  P("pd-select-filter", "Select, filter and sort", "import pandas as pd\ndf = pd.DataFrame({'city': ['Oslo', 'Rome', 'Lima', 'Kyiv'], 'sales': [120, 75, 200, 90], 'qty': [3, 1, 4, 2]})\nsub = df[['city', 'sales']]\nbig = df[df['sales'] > 80]\nbig = big.sort_values('sales', ascending=False)\n"),
  P("pd-missing", "Missing values", "import pandas as pd\ndf = pd.DataFrame({'a': [1.0, None, 3.0, None], 'b': ['x', 'y', None, 'z']})\nfilled = df.fillna({'a': 0, 'b': 'unknown'})\nclean = df.dropna()\nrows_only = df.dropna(subset=['a'])\n"),
  P("pd-dedupe-rename", "Duplicates and rename", "import pandas as pd\ndf = pd.DataFrame({'id': [1, 2, 2, 3], 'v': [10, 20, 20, 30]})\nunique = df.drop_duplicates()\nren = unique.rename(columns={'v': 'value'})\n"),
  P("pd-calculated", "Calculated columns", "import pandas as pd\ndf = pd.DataFrame({'price': [2.5, 4.0, 1.0], 'qty': [4, 2, 10]})\ndf['total'] = df['price'] * df['qty']\ndf = df.assign(discounted=lambda d: d['total'] * 0.9)\n"),
  P("pd-groupby", "GroupBy then aggregate", "import pandas as pd\ndf = pd.DataFrame({'team': ['a', 'b', 'a', 'b', 'a'], 'pts': [3, 5, 4, 1, 2]})\ntotals = df.groupby('team')['pts'].sum()\navg = df.groupby('team')['pts'].mean().reset_index()\n"),
  P("pd-merge", "Merge: matched and unmatched keys", "import pandas as pd\nusers = pd.DataFrame({'id': [1, 2, 3, 4], 'name': ['Ana', 'Ben', 'Chen', 'Dee']})\norders = pd.DataFrame({'user_id': [1, 1, 3, 9], 'amount': [10, 20, 5, 7]})\ninner = users.merge(orders, left_on='id', right_on='user_id', how='inner')\nleft = users.merge(orders, left_on='id', right_on='user_id', how='left')\nright = users.merge(orders, left_on='id', right_on='user_id', how='right')\nouter = pd.merge(users, orders, left_on='id', right_on='user_id', how='outer')\n"),
  P("pd-join", "Join on the index", "import pandas as pd\na = pd.DataFrame({'x': [1, 2, 3]}, index=['p', 'q', 'r'])\nb = pd.DataFrame({'y': [10, 20, 30]}, index=['q', 'r', 's'])\nj = a.join(b, how='outer')\n"),
  P("pd-clean", "Fill, convert and drop", "import pandas as pd\ndf = pd.DataFrame({'a': ['1', '2', 'x'], 'b': [1.5, None, 3.0]})\ndf['b'] = df['b'].fillna(0)\ndf['a'] = pd.to_numeric(df['a'], errors='coerce')\nclean = df.dropna()\n"),
  P("pd-concat-dedupe", "Concatenate, then drop duplicates", "import pandas as pd\na = pd.DataFrame({'id': [1, 2, 2], 'v': [10, 20, 20]})\nb = pd.DataFrame({'id': [3], 'v': [30]})\nall_rows = pd.concat([a, b], ignore_index=True)\nunique = all_rows.drop_duplicates()\n"),
  P("pd-concat", "Concatenate", "import pandas as pd\na = pd.DataFrame({'id': [1, 2], 'v': [10, 20]})\nb = pd.DataFrame({'id': [3], 'v': [30]})\nall_rows = pd.concat([a, b], ignore_index=True)\n"),
  P("pd-reshape", "Pivot and melt", "import pandas as pd\nlong = pd.DataFrame({'m': ['Jan', 'Jan', 'Feb', 'Feb'], 'k': ['x', 'y', 'x', 'y'], 'v': [1, 2, 3, 4]})\nwide = long.pivot(index='m', columns='k', values='v')\nback = wide.reset_index().melt(id_vars='m')\ntotals = long.pivot_table(index='m', values='v', aggfunc='sum')\n"),
  P("pd-apply-map", "apply and map", "import pandas as pd\ns = pd.Series([1, 2, 3])\ndoubled = s.apply(lambda x: x * 2)\nlabels = s.map({1: 'one', 2: 'two'})\n"),
  P("pd-datetime-string", "Datetime and string operations", "import pandas as pd\ndf = pd.DataFrame({'when': pd.to_datetime(['2024-01-05', '2024-02-10']), 'name': ['ana lee', 'ben ray']})\nyear = df['when'].dt.year\nup = df['name'].str.title()\n"),
  P("pd-rolling", "Rolling window", "import pandas as pd\ns = pd.Series([1, 2, 3, 4, 5])\nr = s.rolling(3).mean()\n"),
  N("np-create", "Create arrays and read their attributes", "import numpy as np\na = np.arange(12).reshape(3, 4)\nshape = a.shape\nndim = a.ndim\nsize = a.size\ndt = a.dtype\n"),
  N("np-index-slice", "Indexing and slicing", "import numpy as np\na = np.arange(12).reshape(3, 4)\nel = a[1, 2]\nrow = a[0]\ncol = a[:, 1]\nblock = a[1:, :2]\n"),
  N("np-reshape", "Reshape, flatten, transpose", "import numpy as np\na = np.arange(6)\nb = a.reshape(2, 3)\nf = b.flatten()\nt = b.T\n"),
  N("np-broadcast-ok", "Broadcasting (valid)", "import numpy as np\na = np.arange(6).reshape(2, 3)\nrow = np.array([10, 20, 30])\ncol = np.array([[100], [200]])\nc = a + row\nd = a + col\ne = a * 2\n"),
  N("np-broadcast-bad", "Broadcasting (invalid)", "import numpy as np\na = np.ones((2, 3))\nb = np.ones(4)\nc = a + b\n", true),
  N("np-mask", "Boolean masks", "import numpy as np\nx = np.array([[1, 5, 9], [2, 6, 3]])\nmask = x > 4\nbig = x[mask]\nx[mask] = 0\n"),
  N("np-masks-slice-agg", "Masks, slicing and aggregation together", "import numpy as np\nx = np.array([[1, 5, 9], [2, 6, 3]])\nmask = x > 4\nbig = x[mask]\nrow = x[0, :]\ncol_sums = x.sum(axis=0)\nflat = x.reshape(6)\n"),
  N("np-axis", "Aggregation along an axis", "import numpy as np\nx = np.arange(12).reshape(3, 4)\ncol_sums = x.sum(axis=0)\nrow_means = x.mean(axis=1)\nkeep = x.max(axis=1, keepdims=True)\ntotal = x.sum()\n"),
  N("np-matmul-ok", "Matrix multiplication (valid)", "import numpy as np\na = np.arange(6).reshape(2, 3)\nb = np.arange(12).reshape(3, 4)\nc = a @ b\nd = np.dot(a, b)\n"),
  N("np-matmul-bad", "Matrix multiplication (invalid)", "import numpy as np\na = np.arange(6).reshape(2, 3)\nb = np.arange(8).reshape(2, 4)\nc = a @ b\n", true),
  N("np-random", "Seeded random numbers (seed 42)", "import numpy as np\nnp.random.seed(42)\nr = np.random.randint(0, 10, size=(2, 3))\nrng = np.random.default_rng(42)\ng = rng.integers(0, 10, size=4)\n"),
];

/**
 * The examples the Pandas and NumPy Studio page offered before the stage view replaced its old viewer (`/visual/data`). The page
 * never had URL ids for them, so an id is the slug of the old button label. Each maps to the DATA_PRESETS entry whose code does
 * the same operations (the old code now lives in `pd-clean`, `pd-concat-dedupe` and `np-masks-slice-agg`, character for character;
 * the others are supersets). The old label stays the button text, so existing links, notes and tests that name it keep working.
 */
export const LEGACY_DATA_PRESETS: { id: string; label: string; presetId: string }[] = [
  { id: "filter-and-sort", label: "Filter and sort", presetId: "pd-select-filter" },
  { id: "groupby-and-aggregate", label: "GroupBy and aggregate", presetId: "pd-groupby" },
  { id: "merge", label: "Merge", presetId: "pd-merge" },
  { id: "missing-values-and-types", label: "Missing values and types", presetId: "pd-clean" },
  { id: "pivot-and-melt", label: "Pivot and melt", presetId: "pd-reshape" },
  { id: "duplicates-and-concat", label: "Duplicates and concat", presetId: "pd-concat-dedupe" },
  { id: "numpy-broadcasting", label: "NumPy broadcasting", presetId: "np-broadcast-ok" },
  { id: "masks-slicing-aggregation", label: "Masks, slicing, aggregation", presetId: "np-masks-slice-agg" },
];

/** Short names used by the Visual Learning docs and by `workspacePresetsFor` (lib/visual/dailyVisual.ts), so a link written with either keeps working. */
const ALIASES: Record<string, string> = {
  filter: "pd-select-filter", sort: "pd-select-filter", groupby: "pd-groupby", aggregate: "pd-groupby", merge: "pd-merge", join: "pd-merge",
  missing: "pd-missing", "missing-values": "pd-missing", dtype: "pd-clean", "dtype-conversion": "pd-clean", pivot: "pd-reshape", melt: "pd-reshape",
  reshape: "pd-reshape", duplicates: "pd-dedupe-rename", concat: "pd-concat", beforeafter: "pd-select-filter",
  broadcasting: "np-broadcast-ok", broadcast: "np-broadcast-ok", masks: "np-mask", slicing: "np-index-slice", reshaping: "np-reshape",
  axis: "np-axis", "axis-aggregation": "np-axis", shapes: "np-create", matmul: "np-matmul-ok",
};

/** The preset a `?preset=` value names: a DATA_PRESETS id, an old page id, or a short alias (case-insensitive). Undefined when it names nothing. */
export function resolveDataPreset(id: string | null | undefined): DataPreset | undefined {
  if (!id) return undefined;
  const k = id.trim().toLowerCase();
  const direct = DATA_PRESETS.find((p) => p.id === k);
  if (direct) return direct;
  const legacy = LEGACY_DATA_PRESETS.find((l) => l.id === k);
  const target = legacy?.presetId ?? ALIASES[k];
  return target ? DATA_PRESETS.find((p) => p.id === target) : undefined;
}
