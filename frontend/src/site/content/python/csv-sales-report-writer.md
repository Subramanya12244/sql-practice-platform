---
id: PY-114
title: Write A Regional Sales CSV Report
slug: csv-sales-report-writer
difficulty: Medium
category: files
skill: aggregation
description: Read a sales CSV, aggregate by region and write a summary CSV.
topic: python-csv-json
concepts: csv.DictReader, csv.DictWriter, bad-row counting
time: O(n + r log r)
space: O(r)
minutes: 15
---

## Scenario

Regional managers receive a weekly CSV with revenue and order counts. The raw export has some rows with blank or invalid amounts.

## Problem

Write sales_report(src, dst). src has header region,order_id,amount. Skip rows where region is blank or amount is not a number, counting them. Write dst with header region,orders,revenue, one row per region sorted by revenue desc then region, revenue formatted with 2 decimals. Return the number of skipped rows.

## Objective

Read, aggregate and write CSV files with the csv module.

## Input format

Two file paths.

## Output format

int skipped count; file dst written.

## Constraints

- Region names are stripped
- Write with newline=''

## Examples

```
src rows: EU,1,10 / EU,2,5.5 / US,3,abc  ->  dst 'region,orders,revenue\r\nEU,2,15.50\r\n', returns 1
```

## Hints

- Open with newline='' for both reading and writing.
- Sort with key (-revenue, region).

## Why it matters

CSV in, CSV out with aggregation is the bread-and-butter of reporting jobs. Using DictReader and DictWriter avoids quoting bugs from manual string splitting.

```task
{
  "id": "csv-sales-report-writer",
  "title": "Write A Regional Sales CSV Report",
  "type": "python",
  "instructions": "Write sales_report(src, dst). src has header region,order_id,amount. Skip rows where region is blank or amount is not a number, counting them. Write dst with header region,orders,revenue, one row per region sorted by revenue desc then region, revenue formatted with 2 decimals. Return the number of skipped rows.",
  "starter": "def sales_report(src: str, dst: str) -> int:\n    raise NotImplementedError\n",
  "solution": "import csv\n\ndef sales_report(src: str, dst: str) -> int:\n    agg, skipped = {}, 0\n    with open(src, newline='') as f:\n        for row in csv.DictReader(f):\n            region = (row.get('region') or '').strip()\n            try:\n                amt = float(row.get('amount'))\n            except (TypeError, ValueError):\n                skipped += 1\n                continue\n            if not region:\n                skipped += 1\n                continue\n            o, r = agg.get(region, (0, 0.0))\n            agg[region] = (o + 1, r + amt)\n    with open(dst, 'w', newline='') as f:\n        w = csv.DictWriter(f, fieldnames=['region', 'orders', 'revenue'])\n        w.writeheader()\n        for region, (o, r) in sorted(agg.items(), key=lambda kv: (-kv[1][1], kv[0])):\n            w.writerow({'region': region, 'orders': o, 'revenue': f'{r:.2f}'})\n    return skipped\n",
  "tests": "open('s.csv','w').write('region,order_id,amount\\nEU,1,10\\nEU,2,5.5\\nUS,3,abc\\n')\nassert sales_report('s.csv','r.csv') == 1\nassert open('r.csv', newline='').read() == 'region,orders,revenue\\r\\nEU,2,15.50\\r\\n'\n",
  "hidden": "open('s.csv','w').write('region,order_id,amount\\n')\nassert sales_report('s.csv','r.csv') == 0\nassert open('r.csv', newline='').read() == 'region,orders,revenue\\r\\n'\nopen('s.csv','w').write('region,order_id,amount\\n ,1,5\\nB,2,3\\nA,3,3\\nC,4,9\\nA,5,\\n')\nassert sales_report('s.csv','r.csv') == 2\nassert open('r.csv').read().split() == ['region,orders,revenue','C,1,9.00','A,1,3.00','B,1,3.00']\nopen('s.csv','w').write('region,order_id,amount\\n'+''.join(f'R{i%5},{i},1\\n' for i in range(5000)))\nassert sales_report('s.csv','r.csv') == 0\nassert 'R0,1000,1000.00' in open('r.csv').read()\n",
  "explanation": "DictReader maps each line to a dict by header, so columns are addressed by name. Invalid amounts and blank regions are counted and skipped rather than raising. Aggregates live in a small dict keyed by region, and the output is sorted by revenue descending with region as a tie-break. DictWriter handles quoting and line endings correctly."
}
```
