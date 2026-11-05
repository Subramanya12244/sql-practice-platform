---
id: PY-132
title: IP Range Geo Lookup Index
slug: ip-range-geo-index
difficulty: Hard
category: dsa
skill: transformation
description: Build a sorted interval index of IP ranges and enrich log lines with a country in O(log n).
topic: python-oop
concepts: bisect, interval lookup, validation, IPv4 parsing
time: O(n log n) build, O(log n) per lookup
space: O(n)
minutes: 30
---

## Scenario

Web access logs must be enriched with the visitor country before landing in the analytics lake. The geo vendor ships a table of IPv4 ranges, and scanning it for each of millions of log lines is far too slow.

## Problem

Implement class `IpRangeIndex(ranges)` where `ranges` is a list of `(start_ip, end_ip, country)` with inclusive bounds as dotted IPv4 strings, in any order. The constructor must raise ValueError if any range has start > end or if two ranges overlap. `lookup(ip)` returns the country for an IP or None if no range covers it, and raises ValueError for malformed IPs (not 4 parts or a part outside 0-255). `enrich(logs)` is a generator that takes dicts with an `ip` field and yields copies with a `country` field added, sending malformed IPs to country 'INVALID' instead of raising.

## Objective

Build a validated, binary-searchable range index and use it to enrich a stream.

## Input format

A list of (start_ip, end_ip, country) tuples; IP strings for lookup.

## Output format

Country strings or None; a generator of enriched dicts.

## Constraints

- Bounds inclusive
- Overlaps raise ValueError
- enrich must not mutate input dicts

## Examples

```
idx = IpRangeIndex([('10.0.0.0', '10.0.0.255', 'IN'), ('1.0.0.0', '1.0.0.255', 'AU')])
idx.lookup('10.0.0.7')  ->  'IN'
idx.lookup('2.2.2.2')  ->  None
```

## Hints

- Convert an IP to an int: ((a*256 + b)*256 + c)*256 + d.
- Sort ranges by start; overlap exists if a range starts at or before the previous end.
- bisect_right on the starts list gives the candidate range; check the IP is <= its end.

## Why it matters

Range joins (IP to geo, timestamp to price period, salary to band) are common and slow when done naively. Sorting plus bisect turns them into fast lookups, and validating overlaps catches bad reference data early.

```task
{
  "id": "ip-range-geo-index",
  "title": "IP Range Geo Lookup Index",
  "type": "python",
  "instructions": "Implement class `IpRangeIndex(ranges)` where `ranges` is a list of `(start_ip, end_ip, country)` with inclusive bounds as dotted IPv4 strings, in any order. The constructor must raise ValueError if any range has start > end or if two ranges overlap. `lookup(ip)` returns the country for an IP or None if no range covers it, and raises ValueError for malformed IPs (not 4 parts or a part outside 0-255). `enrich(logs)` is a generator that takes dicts with an `ip` field and yields copies with a `country` field added, sending malformed IPs to country 'INVALID' instead of raising.",
  "starter": "class IpRangeIndex:\n    def __init__(self, ranges):\n        raise NotImplementedError\n\n    def lookup(self, ip):\n        raise NotImplementedError\n\n    def enrich(self, logs):\n        raise NotImplementedError\n",
  "solution": "import bisect\n\n\ndef _ip_to_int(ip):\n    parts = ip.split(\".\") if isinstance(ip, str) else []\n    if len(parts) != 4 or not all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):\n        raise ValueError(f\"bad ip {ip!r}\")\n    n = 0\n    for p in parts:\n        n = n * 256 + int(p)\n    return n\n\n\nclass IpRangeIndex:\n    def __init__(self, ranges):\n        rows = sorted((_ip_to_int(s), _ip_to_int(e), c) for s, e, c in ranges)\n        for i, (s, e, _) in enumerate(rows):\n            if s > e:\n                raise ValueError(\"start after end\")\n            if i and s <= rows[i - 1][1]:\n                raise ValueError(\"overlapping ranges\")\n        self._starts = [r[0] for r in rows]\n        self._rows = rows\n\n    def lookup(self, ip):\n        n = _ip_to_int(ip)\n        i = bisect.bisect_right(self._starts, n) - 1\n        if i >= 0 and n <= self._rows[i][1]:\n            return self._rows[i][2]\n        return None\n\n    def enrich(self, logs):\n        for log in logs:\n            try:\n                country = self.lookup(log.get(\"ip\"))\n            except ValueError:\n                country = \"INVALID\"\n            yield {**log, \"country\": country}\n",
  "tests": "idx = IpRangeIndex([('10.0.0.0', '10.0.0.255', 'IN'), ('1.0.0.0', '1.0.0.255', 'AU')])\nassert idx.lookup('10.0.0.7') == 'IN'\nassert idx.lookup('2.2.2.2') is None\nassert idx.lookup('1.0.0.0') == 'AU' and idx.lookup('1.0.0.255') == 'AU'\n",
  "hidden": "try:\n    IpRangeIndex([('1.0.0.0', '1.0.0.10', 'A'), ('1.0.0.10', '1.0.0.20', 'B')])\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    IpRangeIndex([('1.0.0.9', '1.0.0.1', 'A')])\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    IpRangeIndex([]).lookup('300.1.1.1')\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nidx = IpRangeIndex([('0.0.0.0', '0.0.0.0', 'Z'), ('255.255.255.0', '255.255.255.255', 'END')])\nassert idx.lookup('0.0.0.0') == 'Z' and idx.lookup('0.0.0.1') is None and idx.lookup('255.255.255.255') == 'END'\nlogs = [{'ip': '255.255.255.9', 'path': '/'}, {'ip': 'abc'}, {'ip': '8.8.8.8'}]\nout = list(idx.enrich(logs))\nassert [o['country'] for o in out] == ['END', 'INVALID', None]\nassert 'country' not in logs[0]\nbig = IpRangeIndex([(f'{i}.0.0.0', f'{i}.255.255.255', f'C{i}') for i in range(0, 250, 2)])\nassert big.lookup('100.4.5.6') == 'C100' and big.lookup('101.4.5.6') is None\nassert IpRangeIndex([]).lookup('1.1.1.1') is None\n",
  "explanation": "Converting dotted IPs to integers turns the problem into integer interval lookup. After sorting by start, an overlap check only needs to compare each range with its predecessor. bisect_right on the sorted starts finds the last range starting at or before the IP, and a single comparison with that range's end decides membership. Failing fast on bad reference data prevents silently wrong enrichment, while the stream path degrades gracefully by tagging malformed IPs. Each lookup is O(log n), which is what makes enriching millions of log lines practical."
}
```
