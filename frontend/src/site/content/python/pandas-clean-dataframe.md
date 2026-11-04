---
title: Clean a DataFrame with pandas
slug: pandas-clean-dataframe
difficulty: Medium
description: Fix types, fill nulls and drop duplicate rows in a raw pandas DataFrame.
topic: python-pandas
minutes: 20
---

## Problem

Write `def clean(df: pd.DataFrame) -> pd.DataFrame` for columns `id, name, amount, signup`:
- strip whitespace from `name` and replace empty names with `"unknown"` (nulls too);
- convert `amount` to float with `pd.to_numeric(errors="coerce")`, filling nulls with `0.0`;
- parse `signup` to datetime (`errors="coerce"`);
- drop rows with a null `id`, cast `id` to int, drop duplicate `id`s keeping the first;
- return with a fresh `RangeIndex`. Do not mutate the input.

## Examples

```
id   name     amount  signup         ->  id  name     amount  signup
1    " Ann "  "10"    "2024-01-02"       1   Ann      10.0    2024-01-02
1    "Ann"    "5"     "2024-01-03"       2   unknown  0.0     NaT
2    None     "x"     "bad"
```

## Hints

- Work on `df.copy()`.
- `df.dropna(subset=['id'])` then `.astype({'id': int})`, then `drop_duplicates('id')`.

```task
{
  "id": "pandas-clean-dataframe",
  "title": "Clean a DataFrame with pandas",
  "type": "python",
  "instructions": "Write `def clean(df: pd.DataFrame) -> pd.DataFrame` for columns `id, name, amount, signup`:\n- strip whitespace from `name` and replace empty names with `\"unknown\"` (nulls too);\n- convert `amount` to float with `pd.to_numeric(errors=\"coerce\")`, filling nulls with `0.0`;\n- parse `signup` to datetime (`errors=\"coerce\"`);\n- drop rows with a null `id`, cast `id` to int, drop duplicate `id`s keeping the first;\n- return with a fresh `RangeIndex`. Do not mutate the input.",
  "starter": "import pandas as pd\n\ndef clean(df: pd.DataFrame) -> pd.DataFrame:\n    raise NotImplementedError\n",
  "solution": "import pandas as pd\n\ndef clean(df: pd.DataFrame) -> pd.DataFrame:\n    out = df.copy()\n    out[\"name\"] = out[\"name\"].fillna(\"\").astype(str).str.strip().replace(\"\", \"unknown\")\n    out[\"amount\"] = pd.to_numeric(out[\"amount\"], errors=\"coerce\").fillna(0.0).astype(float)\n    out[\"signup\"] = pd.to_datetime(out[\"signup\"], errors=\"coerce\")\n    out = out.dropna(subset=[\"id\"])\n    out[\"id\"] = out[\"id\"].astype(int)\n    out = out.drop_duplicates(\"id\", keep=\"first\").reset_index(drop=True)\n    return out\n",
  "tests": "import pandas as pd\nraw = pd.DataFrame({\"id\": [1, 1, 2, None], \"name\": [\" Ann \", \"Ann\", None, \"Zed\"],\n                    \"amount\": [\"10\", \"5\", \"x\", \"1\"], \"signup\": [\"2024-01-02\", \"2024-01-03\", \"bad\", None]})\nsnapshot = raw.copy()\nc = clean(raw)\nassert list(c[\"id\"]) == [1, 2]\nassert list(c[\"name\"]) == [\"Ann\", \"unknown\"]\nassert list(c[\"amount\"]) == [10.0, 0.0]\nassert c[\"amount\"].dtype == float\nassert pd.api.types.is_datetime64_any_dtype(c[\"signup\"])\nassert c.loc[0, \"signup\"] == pd.Timestamp(\"2024-01-02\") and pd.isna(c.loc[1, \"signup\"])\nassert list(c.index) == [0, 1]\nassert raw.equals(snapshot)\nempty = clean(pd.DataFrame({\"id\": [], \"name\": [], \"amount\": [], \"signup\": []}))\nassert len(empty) == 0\n"
}
```
