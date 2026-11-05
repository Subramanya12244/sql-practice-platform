---
id: PY-011
title: Vectorised Outlier Detection with NumPy
slug: numpy-vectorised-zscore
difficulty: Hard
category: advanced
skill: validation
description: Compute z-scores and flag outliers without Python loops, handling NaN and zero variance.
topic: python-numpy
concepts: NumPy vectorisation, z-scores, NaN handling
time: O(n)
space: O(n)
minutes: 20
---

## Scenario

An IoT platform receives millions of temperature readings per hour, with some readings missing as NaN. Data quality checks must flag extreme readings fast, which Python loops cannot do at this volume.

## Problem

Write `def flag_outliers(values, threshold: float = 3.0) -> np.ndarray` returning a boolean array, same
length as `values`, `True` where `|x - mean| / std > threshold`. Use NumPy vectorised ops (no Python loops).
`NaN` values are ignored when computing mean/std and are never flagged. If std is 0 or there are no valid
values, return all `False`. Use population std (`ddof=0`).

## Objective

Return a boolean array flagging values whose z-score exceeds the threshold using vectorized NumPy ops, ignoring NaN.

## Input format

An array-like of numbers (may contain NaN) and a threshold.

## Output format

A boolean NumPy array of the same length.

## Constraints

- No Python loops
- Constant or empty input flags nothing

## Examples

```
flag_outliers([10, 10, 10, 10, 10, 10, 10, 10, 10, 100], threshold=2)
  ->  array([False, ..., False,  True])
```

## Hints

- `np.nanmean` and `np.nanstd` skip NaN.
- `np.abs(x - m) / s > t` is `False` for NaN automatically; guard `s == 0` first.

## Why it matters

Vectorized checks run orders of magnitude faster than loops, and NaN-aware statistics are essential when validating real sensor and metric data.

```task
{
  "id": "numpy-vectorised-zscore",
  "title": "Vectorised Outlier Detection with NumPy",
  "type": "python",
  "instructions": "Write `def flag_outliers(values, threshold: float = 3.0) -> np.ndarray` returning a boolean array, same\nlength as `values`, `True` where `|x - mean| / std > threshold`. Use NumPy vectorised ops (no Python loops).\n`NaN` values are ignored when computing mean/std and are never flagged. If std is 0 or there are no valid\nvalues, return all `False`. Use population std (`ddof=0`).",
  "starter": "import numpy as np\n\ndef flag_outliers(values, threshold: float = 3.0) -> np.ndarray:\n    raise NotImplementedError\n",
  "solution": "import numpy as np\n\ndef flag_outliers(values, threshold: float = 3.0) -> np.ndarray:\n    x = np.asarray(values, dtype=float)\n    if x.size == 0 or np.all(np.isnan(x)):\n        return np.zeros(x.shape, dtype=bool)\n    m, s = np.nanmean(x), np.nanstd(x)\n    if s == 0:\n        return np.zeros(x.shape, dtype=bool)\n    with np.errstate(invalid=\"ignore\"):\n        return np.abs(x - m) / s > threshold\n",
  "tests": "import numpy as np\nr = flag_outliers([10] * 9 + [100], threshold=2)\nassert isinstance(r, np.ndarray) and r.dtype == bool\nassert r.tolist() == [False] * 9 + [True]\nassert flag_outliers([]).tolist() == []\nassert flag_outliers([5, 5, 5]).tolist() == [False, False, False]\n",
  "hidden": "assert flag_outliers([np.nan, np.nan]).tolist() == [False, False]\nr2 = flag_outliers([1, 1, 1, 1, 1, 1, 1, 1, np.nan, 50], threshold=2)\nassert r2.tolist() == [False] * 8 + [False, True]\nbig = np.arange(100000, dtype=float)\nassert flag_outliers(big).sum() == 0\n",
  "explanation": "Whole-array operations compute every z-score at once in compiled code. `nanmean`/`nanstd` ignore missing values; a zero standard deviation would divide by zero, so constant data is handled first and flags nothing."
}
```
