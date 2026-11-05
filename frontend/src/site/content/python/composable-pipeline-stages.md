---
id: PY-120
title: Composable ETL Stages With Error Policies
slug: composable-pipeline-stages
difficulty: Hard
category: etl
skill: orchestration
description: Build reusable Stage objects that chain with | into a lazy pipeline with per-stage metrics and skip/fail policies.
topic: python-etl-pipelines
concepts: classes, operator overloading, generators, metrics, error policies
time: O(records * stages)
space: O(stages) beyond the sink
minutes: 40
---

## Scenario

Every team at the company writes its own ad-hoc loop for cleaning order feeds. The platform team wants one small framework where stages are reusable objects, composed with |, and each stage reports what it received, emitted and rejected.

## Problem

Implement `PipelineError(Exception)`, `Stage(name, fn, on_error='fail')` and `Pipeline(stages)`. `fn(record)` returns a record, None (drop it) or a list (fan out into several records). `stage_a | stage_b` returns a Pipeline, and `pipeline | stage` returns a new Pipeline with the stage appended. Duplicate stage names raise ValueError. `Pipeline.run(records, sink)` streams records one at a time through all stages and calls `sink.append` for each output; it returns metrics `{stage_name: {'in': n, 'out': n, 'errors': n}}`. When `fn` raises: with on_error='skip' count the error, store `(stage_name, record, 'ExcType: message')` in `pipeline.rejected` and continue; with 'fail' raise PipelineError mentioning the stage name, chained from the original exception. The pipeline must be lazy: it must not read further input after a fail.

## Objective

Design a small reusable pipeline framework with streaming semantics and observability.

## Input format

Stage objects, an iterable of records and a sink with append.

## Output format

A metrics dict; rejected records on the pipeline.

## Constraints

- Records flow one at a time (generators)
- on_error is 'skip' or 'fail'
- Metrics and rejected reset on every run

## Examples

```
p = Stage('parse', lambda r: {**r, 'amt': float(r['amt'])}, on_error='skip') | Stage('big', lambda r: r if r['amt'] > 10 else None)
out = []; p.run([{'amt': '50'}, {'amt': 'x'}, {'amt': '5'}], out)
->  {'parse': {'in': 3, 'out': 2, 'errors': 1}, 'big': {'in': 2, 'out': 1, 'errors': 0}}; out == [{'amt': 50.0}]
```

## Hints

- Wrap the input in one generator per stage: each reads from the previous generator and yields outputs.
- Normalise the fn result: None -> nothing, list -> its items, anything else -> [result].
- Use raise PipelineError(...) from exc so the cause is kept.

## Why it matters

Frameworks like Beam, Bonobo and in-house ETL libraries all reduce to composable stages with per-stage metrics and error policies. Building one teaches how to make pipeline code reusable, testable and observable.

```task
{
  "id": "composable-pipeline-stages",
  "title": "Composable ETL Stages With Error Policies",
  "type": "python",
  "instructions": "Implement `PipelineError(Exception)`, `Stage(name, fn, on_error='fail')` and `Pipeline(stages)`. `fn(record)` returns a record, None (drop it) or a list (fan out into several records). `stage_a | stage_b` returns a Pipeline, and `pipeline | stage` returns a new Pipeline with the stage appended. Duplicate stage names raise ValueError. `Pipeline.run(records, sink)` streams records one at a time through all stages and calls `sink.append` for each output; it returns metrics `{stage_name: {'in': n, 'out': n, 'errors': n}}`. When `fn` raises: with on_error='skip' count the error, store `(stage_name, record, 'ExcType: message')` in `pipeline.rejected` and continue; with 'fail' raise PipelineError mentioning the stage name, chained from the original exception. The pipeline must be lazy: it must not read further input after a fail.",
  "starter": "class PipelineError(Exception):\n    pass\n\n\nclass Stage:\n    def __init__(self, name, fn, on_error='fail'):\n        raise NotImplementedError\n\n\nclass Pipeline:\n    def __init__(self, stages):\n        raise NotImplementedError\n",
  "solution": "class PipelineError(Exception):\n    pass\n\n\nclass Stage:\n    def __init__(self, name, fn, on_error=\"fail\"):\n        if on_error not in (\"fail\", \"skip\"):\n            raise ValueError(\"on_error must be 'fail' or 'skip'\")\n        self.name, self.fn, self.on_error = name, fn, on_error\n\n    def __or__(self, other):\n        return Pipeline([self, other])\n\n\nclass Pipeline:\n    def __init__(self, stages):\n        names = [s.name for s in stages]\n        if len(names) != len(set(names)):\n            raise ValueError(\"duplicate stage names\")\n        self.stages = list(stages)\n        self.metrics, self.rejected = {}, []\n\n    def __or__(self, stage):\n        return Pipeline(self.stages + [stage])\n\n    def _apply(self, stage, stream):\n        m = self.metrics[stage.name]\n        for rec in stream:\n            m[\"in\"] += 1\n            try:\n                res = stage.fn(rec)\n            except Exception as exc:\n                m[\"errors\"] += 1\n                if stage.on_error == \"skip\":\n                    self.rejected.append((stage.name, rec, f\"{type(exc).__name__}: {exc}\"))\n                    continue\n                raise PipelineError(f\"stage {stage.name} failed\") from exc\n            if res is None:\n                continue\n            for out in (res if isinstance(res, list) else [res]):\n                m[\"out\"] += 1\n                yield out\n\n    def run(self, records, sink):\n        self.metrics = {s.name: {\"in\": 0, \"out\": 0, \"errors\": 0} for s in self.stages}\n        self.rejected = []\n        stream = iter(records)\n        for s in self.stages:\n            stream = self._apply(s, stream)\n        for rec in stream:\n            sink.append(rec)\n        return self.metrics\n",
  "tests": "p = Stage('parse', lambda r: {**r, 'amt': float(r['amt'])}, on_error='skip') | Stage('big', lambda r: r if r['amt'] > 10 else None)\nout = []\nassert p.run([{'amt': '50'}, {'amt': 'x'}, {'amt': '5'}], out) == {'parse': {'in': 3, 'out': 2, 'errors': 1}, 'big': {'in': 2, 'out': 1, 'errors': 0}}\nassert out == [{'amt': 50.0}]\nassert p.rejected[0][0] == 'parse' and p.rejected[0][2].startswith('ValueError')\n",
  "hidden": "explode = Stage('explode', lambda o: [{'sku': s} for s in o['skus']])\nupper = Stage('upper', lambda r: {'sku': r['sku'].upper()})\np = explode | upper\nout = []\nm = p.run([{'skus': ['a', 'b']}, {'skus': []}, {'skus': ['c']}], out)\nassert out == [{'sku': 'A'}, {'sku': 'B'}, {'sku': 'C'}] and m['explode'] == {'in': 3, 'out': 3, 'errors': 0}\np2 = p | Stage('check', lambda r: 1 / 0 if r['sku'] == 'B' else r)\nassert len(p2.stages) == 3 and len(p.stages) == 2\npulled = []\ndef src():\n    for i in range(1000):\n        pulled.append(i)\n        yield {'skus': ['a', 'b']}\ntry:\n    p2.run(src(), [])\n    raise AssertionError('expected PipelineError')\nexcept PipelineError as e:\n    assert 'check' in str(e) and isinstance(e.__cause__, ZeroDivisionError)\nassert len(pulled) == 1\ntry:\n    Stage('a', str) | Stage('a', str)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nq = Stage('s', lambda r: r)\nq2 = Pipeline([q])\nq2.run([1, 2], [])\nassert q2.run([], []) == {'s': {'in': 0, 'out': 0, 'errors': 0}} and q2.rejected == []\n",
  "explanation": "Each stage is wrapped in its own generator that pulls from the previous one, so records flow through the whole chain one at a time and memory stays flat. Because nothing is read ahead, a 'fail' stage stops the run before more input is consumed. Normalising the return value into zero, one or many records gives filtering and fan-out without special stage types. Per-stage counters and a rejected list make the pipeline observable, and raising PipelineError from the original exception keeps the root cause. Operator overloading with | gives a readable way to compose reusable stages without mutating existing pipelines."
}
```
