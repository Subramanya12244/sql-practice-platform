---
id: PY-084
title: Layered Pipeline Config With Env Overrides
slug: layered-config-loader
difficulty: Medium
category: advanced
skill: orchestration
description: Combine default, file and environment config with type coercion and required-key checks.
topic: python-modules-packages
concepts: config layering, type coercion, ChainMap-style precedence
time: O(k)
space: O(k)
minutes: 20
---

## Scenario

The same ETL job runs in dev and prod. Defaults live in code, a JSON file sets per-environment values, and environment variables override both at deploy time.

## Problem

Write load_config(defaults, file_text, env, prefix='ETL_'). Start with defaults, overlay keys from file_text (JSON object; empty string means no file), then overlay env vars named prefix + KEY.upper() for keys present in defaults. Env values are strings: coerce to the type of the default (int, float, bool where 'true/1/yes' is True and 'false/0/no' is False, else str). Raise ValueError naming the key on a failed coercion, and raise KeyError if any value is still None. Return the merged dict.

## Objective

Implement precedence-based configuration with validation.

## Input format

dict, str, dict, str.

## Output format

dict.

## Constraints

- Unknown env vars are ignored
- File keys not in defaults are kept

## Examples

```
defaults={'batch_size':100,'dry_run':False,'target':None}, file='{"target":"dev_db"}', env={'ETL_BATCH_SIZE':'500','ETL_DRY_RUN':'yes'}
->  {'batch_size':500,'dry_run':True,'target':'dev_db'}
```

## Hints

- Check bool before int, since bool is a subclass of int.
- Apply layers in order: defaults, file, env.

## Why it matters

Twelve-factor style config layering is how pipelines move between environments without code changes. Coercing and validating early prevents a prod job from running with a string where an int was expected.

```task
{
  "id": "layered-config-loader",
  "title": "Layered Pipeline Config With Env Overrides",
  "type": "python",
  "instructions": "Write load_config(defaults, file_text, env, prefix='ETL_'). Start with defaults, overlay keys from file_text (JSON object; empty string means no file), then overlay env vars named prefix + KEY.upper() for keys present in defaults. Env values are strings: coerce to the type of the default (int, float, bool where 'true/1/yes' is True and 'false/0/no' is False, else str). Raise ValueError naming the key on a failed coercion, and raise KeyError if any value is still None. Return the merged dict.",
  "starter": "def load_config(defaults: dict, file_text: str, env: dict, prefix: str = 'ETL_') -> dict:\n    raise NotImplementedError\n",
  "solution": "import json\n\ndef load_config(defaults: dict, file_text: str, env: dict, prefix: str = 'ETL_') -> dict:\n    cfg = dict(defaults)\n    if file_text.strip():\n        cfg.update(json.loads(file_text))\n    for key, default in defaults.items():\n        raw = env.get(prefix + key.upper())\n        if raw is None:\n            continue\n        try:\n            if isinstance(default, bool):\n                low = raw.strip().lower()\n                if low in ('true', '1', 'yes'):\n                    val = True\n                elif low in ('false', '0', 'no'):\n                    val = False\n                else:\n                    raise ValueError\n            elif isinstance(default, int):\n                val = int(raw)\n            elif isinstance(default, float):\n                val = float(raw)\n            else:\n                val = raw\n        except ValueError:\n            raise ValueError(f'bad value for {key}: {raw!r}')\n        cfg[key] = val\n    missing = sorted(k for k, v in cfg.items() if v is None)\n    if missing:\n        raise KeyError(', '.join(missing))\n    return cfg\n",
  "tests": "d={'batch_size':100,'dry_run':False,'target':None}\nassert load_config(d, '{\"target\":\"dev_db\"}', {'ETL_BATCH_SIZE':'500','ETL_DRY_RUN':'yes'}) == {'batch_size':500,'dry_run':True,'target':'dev_db'}\nassert load_config({'rate':1.5}, '', {}) == {'rate':1.5}\n",
  "hidden": "d={'batch_size':100,'dry_run':False,'target':None}\ntry:\n    load_config(d, '', {}); assert False\nexcept KeyError as e:\n    assert 'target' in str(e)\ntry:\n    load_config(d, '{\"target\":\"x\"}', {'ETL_BATCH_SIZE':'lots'}); assert False\nexcept ValueError as e:\n    assert 'batch_size' in str(e)\ntry:\n    load_config(d, '{\"target\":\"x\"}', {'ETL_DRY_RUN':'maybe'}); assert False\nexcept ValueError:\n    pass\nassert load_config(d, '{\"target\":\"x\",\"extra\":1}', {'ETL_TARGET':'prod','OTHER':'1'}) == {'batch_size':100,'dry_run':False,'target':'prod','extra':1}\nassert load_config({'n':1}, '', {'APP_N':'7'}, prefix='APP_') == {'n':7}\n",
  "explanation": "Layers are applied lowest to highest precedence, so later sources simply overwrite earlier ones. The type of each default drives coercion of env strings, and bool is tested before int because True is an int. Coercion errors are re-raised with the key name, which makes deployment mistakes obvious. A final None check enforces required settings that have no safe default."
}
```
