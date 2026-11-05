/**
 * Structure of a Python solution, read from its syntax tree with Python's own `ast` module
 * (run in the Pyodide sandbox). Nothing is guessed from the problem text: steps are the real
 * statements, and data-flow stages are recognised from the calls and statements in the code.
 */
export interface PyStep { kind: "assign" | "loop" | "branch" | "try" | "with" | "return" | "yield" | "raise" | "call" | "other"; text: string; line: number; children?: PyStep[] }
export interface PyOutline {
  functions: { name: string; args: string[]; line: number; steps: PyStep[] }[];
  classes: { name: string; methods: string[]; line: number }[];
  /** Data operations recognised in the syntax tree, in source order, e.g. "Parse JSON" (line 4) → "Deduplicate" (line 7). */
  stages: { label: string; line: number }[];
  /** Statements no rule recognised: shown as code instead of being given an invented stage. */
  unrecognised?: { line: number; code: string }[];
  imports: string[];
}

/** Analyzer source. Reads the code from a JSON string and prints one JSON line. */
export const OUTLINE_PY = String.raw`
import ast, json
SRC = json.loads(__DF_SRC__)
tree = ast.parse(SRC)
seg = lambda n: (ast.get_source_segment(SRC, n) or "").strip().splitlines()[0][:110]

def step(n):
    if isinstance(n, (ast.For, ast.AsyncFor)):
        return {"kind": "loop", "text": "for " + seg(n.target) + " in " + seg(n.iter), "line": n.lineno, "children": steps(n.body)}
    if isinstance(n, ast.While):
        return {"kind": "loop", "text": "while " + seg(n.test), "line": n.lineno, "children": steps(n.body)}
    if isinstance(n, ast.If):
        kids = steps(n.body)
        if n.orelse:
            kids.append({"kind": "other", "text": "else / elif branch (" + str(len(n.orelse)) + " statement" + ("s" if len(n.orelse) != 1 else "") + ")", "line": n.orelse[0].lineno})
        return {"kind": "branch", "text": "if " + seg(n.test), "line": n.lineno, "children": kids}
    if isinstance(n, ast.Try):
        names = [seg(h.type) if h.type else "any error" for h in n.handlers]
        return {"kind": "try", "text": "try ... except " + ", ".join(names), "line": n.lineno, "children": steps(n.body)}
    if isinstance(n, (ast.With, ast.AsyncWith)):
        return {"kind": "with", "text": "with " + ", ".join(seg(i.context_expr) for i in n.items), "line": n.lineno, "children": steps(n.body)}
    if isinstance(n, ast.Return):
        return {"kind": "return", "text": "return " + (seg(n.value) if n.value else "None"), "line": n.lineno}
    if isinstance(n, ast.Raise):
        return {"kind": "raise", "text": seg(n), "line": n.lineno}
    if isinstance(n, ast.Expr) and isinstance(n.value, (ast.Yield, ast.YieldFrom)):
        return {"kind": "yield", "text": seg(n), "line": n.lineno}
    if isinstance(n, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
        return {"kind": "assign", "text": seg(n), "line": n.lineno}
    if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call):
        return {"kind": "call", "text": seg(n), "line": n.lineno}
    if isinstance(n, (ast.FunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom, ast.Pass)) or (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)):
        return None
    return {"kind": "other", "text": seg(n), "line": n.lineno}

def steps(body):
    return [s for s in (step(n) for n in body) if s]

def name_of(f):
    """Dotted name of a call target: open, json.loads, heapq.nlargest, x.append -> '.append'."""
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        base = name_of(f.value) if isinstance(f.value, (ast.Name, ast.Attribute)) else ""
        return (base + "." if base else ".") + f.attr
    return ""

def calls(node):
    return [n for n in ast.walk(node) if isinstance(n, ast.Call)]

def open_mode(c):
    m = c.args[1] if len(c.args) > 1 else next((k.value for k in c.keywords if k.arg == "mode"), None)
    return m.value if isinstance(m, ast.Constant) and isinstance(m.value, str) else "r"

CONVERT = {"int", "float", "str", "bool", "Decimal", "date", "datetime", "complex"}
AGG = {"sum", "min", "max", "Counter", "statistics.mean", "statistics.median", "mean", "median", "fsum"}
stages = {}      # label -> first line
covered = set()  # source lines explained by a recognised stage

def hit(label, node):
    stages[label] = min(stages.get(label, 10**9), node.lineno)
    for ln in range(node.lineno, (getattr(node, "end_lineno", None) or node.lineno) + 1):
        covered.add(ln)

own_funcs = {n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

for node in ast.walk(tree):
    if isinstance(node, ast.Call):
        n = name_of(node.func)
        if n.endswith(".merge") or (n.endswith(".join") and not isinstance(getattr(node.func, "value", None), ast.Constant)) and "pd" in SRC:
            hit("Join datasets", node)
        elif n.endswith(".drop_duplicates") or n.endswith(".unique") or n.endswith(".nunique"):
            hit("Deduplicate", node)
        elif n.endswith(".fillna") or n.endswith(".dropna") or n.endswith(".isna") or n.endswith(".notna"):
            hit("Handle missing values", node)
        elif n.endswith(".groupby") or n.endswith(".pivot_table") or n.endswith(".pivot"):
            hit("Group", node)
        elif n.endswith(".agg") or n.endswith(".aggregate") or (n.split(".")[-1] in ("sum", "mean", "count", "size", "median", "std") and "pd" in SRC):
            hit("Aggregate", node)
        elif n in ("pd.to_numeric", "pd.to_datetime", "pandas.to_numeric", "pandas.to_datetime"):
            hit("Convert types", node)
        elif n in ("pd.read_csv", "pd.read_json", "pd.read_parquet"):
            hit("Read file", node)
        elif n.endswith(".sort_values") or n.endswith(".sort_index"):
            hit("Sort", node)
        elif n.endswith(".to_csv") or n.endswith(".to_json") or n.endswith(".to_parquet"):
            hit("Write file", node)
        elif n == "open":
            hit("Write file" if any(ch in open_mode(node) for ch in "wax+") else "Read file", node)
        elif n in ("json.loads", "json.load"):
            hit("Parse JSON", node)
        elif n in ("json.dumps", "json.dump"):
            hit("Serialise JSON", node)
        elif n in ("csv.reader", "csv.DictReader"):
            hit("Parse CSV", node)
        elif n in ("csv.writer", "csv.DictWriter") or n.endswith(".writerow") or n.endswith(".writerows") or n.endswith(".write") or n.endswith(".write_text") or n in ("os.replace", "os.rename", "shutil.move"):
            hit("Write file", node)
        elif n.endswith(".read_text") or n.endswith(".readlines") or n.endswith(".readline"):
            hit("Read file", node)
        elif n.endswith("fromstring") or n.endswith("iterparse") or (n.endswith(".parse") and ("ET" in n or "ElementTree" in n)) or n.endswith(".findall") or n.endswith(".iter"):
            hit("Parse XML", node)
        elif n.startswith("re."):
            hit("Parse text", node)
        elif n in CONVERT or n.endswith(".strptime") or n.endswith(".fromisoformat") or n.endswith(".isoformat") or n.endswith(".astype"):
            hit("Convert types", node)
        elif n in ("sorted",) or n.endswith(".sort") or n in ("heapq.nlargest", "heapq.nsmallest"):
            hit("Sort", node)
        elif n.startswith("heapq."):
            hit("Priority queue", node)
        elif n in AGG:
            hit("Aggregate", node)
        elif n.endswith(".setdefault") or n in ("defaultdict", "collections.defaultdict", "itertools.groupby", "groupby"):
            hit("Group", node)
        elif n in ("dict.fromkeys",):
            hit("Deduplicate", node)
        elif n in ("filter",):
            hit("Filter", node)
        elif n in ("map",):
            hit("Map", node)
        elif n in ("itertools.islice", "islice", "itertools.batched", "batched"):
            hit("Batch", node)
        elif n.endswith(".update") or n == "dict":
            hit("Transform records", node)
        elif n.endswith(".add"):
            # set.add next to a membership test on the same set: deduplication.
            target = seg(node.func.value) if isinstance(node.func, ast.Attribute) else ""
            if any(isinstance(c, ast.Compare) and any(isinstance(o, (ast.In, ast.NotIn)) for o in c.ops) and target and target in seg(c) for c in ast.walk(tree)):
                hit("Deduplicate", node)
        elif n in ("time.sleep",) or "sleep" in n:
            hit("Wait / back off", node)
        elif isinstance(node.func, ast.Name) and node.func.id in own_funcs:
            # A function calling itself on nested values: recursive flattening/walking.
            # Innermost enclosing function (nested helpers such as walk() inside flatten()).
            fn = max((f for f in ast.walk(tree) if isinstance(f, (ast.FunctionDef, ast.AsyncFunctionDef)) and f.lineno <= node.lineno <= (f.end_lineno or f.lineno)), key=lambda f: f.lineno, default=None)
            if fn is not None and fn.name == node.func.id and any(isinstance(c, ast.Call) and name_of(c.func) == "isinstance" and "dict" in seg(c) for c in ast.walk(fn)):
                hit("Flatten nested JSON", node)
    elif isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
        gens = node.generators
        if any(g.ifs for g in gens):
            hit("Filter", node)
        elt = node.key if isinstance(node, ast.DictComp) else node.elt
        tgt = {seg(g.target) for g in gens}
        if isinstance(node, ast.DictComp) and len(gens) == 1 and seg(node.value) in tgt:
            hit("Index records", node)
        elif isinstance(elt, ast.Dict) or (isinstance(node, ast.DictComp)):
            hit("Transform records", node)
        elif seg(elt) not in tgt:
            hit("Map", node)
        if isinstance(node, ast.SetComp) and not any(g.ifs for g in gens):
            hit("Deduplicate", node)
    elif isinstance(node, (ast.Yield, ast.YieldFrom)):
        hit("Stream out (generator)", node)
    elif isinstance(node, ast.Raise):
        hit("Validate", node)
    elif isinstance(node, ast.If):
        test = seg(node.test)
        body_kinds = [type(b) for b in node.body]
        appends_err = any(isinstance(c, ast.Call) and name_of(c.func).endswith(".append") and any(w in seg(c.func.value).lower() for w in ("err", "invalid", "bad", "reject", "quarantine", "dead", "fail", "problem")) for b in node.body for c in calls(b) if isinstance(c.func, ast.Attribute))
        if appends_err or "isinstance(" in test or any(t is ast.Raise for t in body_kinds):
            hit("Validate", node)
        elif ast.Continue in body_kinds:
            hit("Dedupe or filter" if " in " in test else "Filter", node)
        if isinstance(node.test, ast.Compare) and any(isinstance(o, (ast.GtE, ast.Gt)) for o in node.test.ops) and "len(" in test:
            hit("Batch", node)
    elif isinstance(node, ast.Try):
        hit("Handle errors", node)
    elif isinstance(node, ast.Subscript) and isinstance(node.slice, (ast.Compare, ast.BinOp, ast.UnaryOp)) and "pd" in SRC:
        hit("Filter", node)  # df[df["x"] > 0] boolean mask
    elif isinstance(node, ast.AugAssign):
        hit("Aggregate", node)
    elif isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict) and any(isinstance(k, type(None)) for k in node.value.keys):
        hit("Transform records", node)  # {**record, ...}
    elif isinstance(node, (ast.For, ast.While)) and isinstance(node, ast.For) and isinstance(node.iter, ast.Call) and name_of(node.iter.func) == "range" and len(node.iter.args) == 3:
        hit("Batch", node)
    elif isinstance(node, ast.Return) and node.value is not None:
        hit("Return result", node)

# "Dedupe or filter": decide from what the membership test checks against.
if "Dedupe or filter" in stages:
    line = stages.pop("Dedupe or filter")
    seen_like = any(isinstance(c, ast.Call) and name_of(c.func).endswith(".add") for c in ast.walk(tree))
    stages["Deduplicate" if seen_like else "Filter"] = min(stages.get("Deduplicate" if seen_like else "Filter", 10**9), line)

# Join: a lookup dict built from one iterable, then read while looping over another.
lookups = {}
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and isinstance(node.value, ast.DictComp) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        lookups[node.targets[0].id] = seg(node.value.generators[0].iter)
for node in ast.walk(tree):
    if isinstance(node, (ast.For, ast.comprehension)):
        it = seg(node.iter)
        body = node.body if isinstance(node, ast.For) else []
        for name, src in lookups.items():
            if it == src:
                continue
            for b in body:
                for sub in ast.walk(b):
                    if (isinstance(sub, ast.Subscript) and seg(sub.value) == name) or (isinstance(sub, ast.Call) and name_of(sub.func) == name + ".get") or (isinstance(sub, ast.Compare) and any(seg(c) == name for c in sub.comparators)):
                        hit("Join datasets", sub)
if "Join datasets" in stages:
    stages.pop("Index records", None)

order = sorted(({"label": k, "line": v} for k, v in stages.items()), key=lambda x: (x["line"], x["label"]))
stages = [x for x in order if x["label"] != "Return result"] + [x for x in order if x["label"] == "Return result"]

def trivial(n):
    """Set-up and plumbing statements that are not data operations."""
    if isinstance(n, (ast.Pass, ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal, ast.FunctionDef, ast.ClassDef, ast.Break, ast.Continue)):
        return True
    if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant):
        return True
    if isinstance(n, (ast.Assign, ast.AnnAssign)):
        v = n.value
        if v is None or isinstance(v, (ast.Constant, ast.Name, ast.Attribute)):
            return True
        if isinstance(v, (ast.List, ast.Dict, ast.Set, ast.Tuple)) and not (getattr(v, "elts", None) or getattr(v, "keys", None)):
            return True
        if isinstance(v, ast.Tuple) and all(isinstance(e, (ast.Constant, ast.Name)) or (isinstance(e, (ast.List, ast.Dict, ast.Set)) and not (getattr(e, "elts", None) or getattr(e, "keys", None))) for e in v.elts):
            return True  # good, bad = [], 0
        if isinstance(v, ast.Dict) and all(isinstance(x, ast.Constant) for x in v.values if x is not None):
            return True  # counts = {"good": 0, "bad": 0}
        if isinstance(v, ast.Call) and name_of(v.func) in ("set", "list", "dict", "deque", "collections.deque", "Counter", "defaultdict", "len", "iter"):
            return True
        if isinstance(n, ast.Assign) and all(isinstance(t, ast.Attribute) for t in n.targets):
            return True  # self.x = ...
    if isinstance(n, ast.Return) and (n.value is None or isinstance(n.value, (ast.Name, ast.Constant, ast.Attribute))):
        return True
    return False

unrecognised = []
def scan(body):
    for n in body:
        if isinstance(n, (ast.For, ast.While, ast.If, ast.With, ast.Try)):
            head = n.lineno
            if head not in covered and isinstance(n, (ast.For, ast.While)) and not any(l in covered for l in range(n.lineno, (n.end_lineno or n.lineno) + 1)):
                unrecognised.append({"line": n.lineno, "code": seg(n)})
                continue
            scan(n.body)
            scan(getattr(n, "orelse", []) or [])
            for h in getattr(n, "handlers", []) or []:
                scan(h.body)
            continue
        if trivial(n):
            continue
        if not any(l in covered for l in range(n.lineno, (getattr(n, "end_lineno", None) or n.lineno) + 1)):
            unrecognised.append({"line": n.lineno, "code": seg(n)})
for fn in ast.walk(tree):
    if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
        scan(fn.body)
unrecognised = sorted({u["line"]: u for u in unrecognised}.values(), key=lambda u: u["line"])[:12]

funcs, classes = [], []
for n in tree.body:
    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
        funcs.append({"name": n.name, "args": [a.arg for a in n.args.args], "line": n.lineno, "steps": steps(n.body)})
    elif isinstance(n, ast.ClassDef):
        methods = [m for m in n.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
        classes.append({"name": n.name, "methods": [m.name for m in methods], "line": n.lineno})
        for m in methods:
            if m.name.startswith("__") and m.name != "__init__":
                continue
            funcs.append({"name": n.name + "." + m.name, "args": [a.arg for a in m.args.args], "line": m.lineno, "steps": steps(m.body)})
imports = sorted({a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names} | {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module})
print("__DF_OUTLINE__" + json.dumps({"functions": funcs, "classes": classes, "stages": stages, "imports": imports, "unrecognised": unrecognised}))
`;

export const outlineProgram = (src: string) => OUTLINE_PY.replace("__DF_SRC__", JSON.stringify(JSON.stringify(src)));

export function parseOutline(stdout: string): PyOutline | null {
  const i = stdout.lastIndexOf("__DF_OUTLINE__");
  if (i < 0) return null;
  try { return JSON.parse(stdout.slice(i + "__DF_OUTLINE__".length).split("\n")[0]) as PyOutline; } catch { return null; }
}
