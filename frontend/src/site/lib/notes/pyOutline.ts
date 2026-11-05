/**
 * Structure of a Python solution, read from its syntax tree with Python's own `ast` module
 * (run in the Pyodide sandbox). Nothing is guessed from the problem text: steps are the real
 * statements, and data-flow stages are recognised from the calls and statements in the code.
 */
export interface PyStep { kind: "assign" | "loop" | "branch" | "try" | "with" | "return" | "yield" | "raise" | "call" | "other"; text: string; line: number; children?: PyStep[] }
export interface PyOutline {
  functions: { name: string; args: string[]; line: number; steps: PyStep[] }[];
  classes: { name: string; methods: string[]; line: number }[];
  /** Data operations in source order, e.g. "Parse JSON" (line 4) → "Deduplicate" (line 7). */
  stages: { label: string; line: number }[];
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

RULES = [
    ("Read file", lambda n: isinstance(n, ast.Call) and getattr(n.func, "id", "") == "open"),
    ("Parse CSV", lambda n: isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == "csv" and n.attr in ("reader", "DictReader")),
    ("Parse JSON", lambda n: isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == "json" and n.attr in ("loads", "load")),
    ("Parse XML", lambda n: isinstance(n, ast.Attribute) and n.attr in ("fromstring", "parse", "iterparse") and "ET" in seg(n.value)),
    ("Match pattern", lambda n: isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == "re"),
    ("Parse dates", lambda n: isinstance(n, ast.Attribute) and n.attr in ("strptime", "fromisoformat")),
    ("Validate", lambda n: isinstance(n, ast.Raise) or (isinstance(n, ast.If) and any(isinstance(b, (ast.Continue, ast.Raise)) for b in n.body))),
    ("Handle errors", lambda n: isinstance(n, ast.Try)),
    ("Filter", lambda n: isinstance(n, (ast.ListComp, ast.GeneratorExp, ast.SetComp, ast.DictComp)) and any(g.ifs for g in n.generators)),
    ("Convert types", lambda n: isinstance(n, ast.Call) and getattr(n.func, "id", "") in ("int", "float", "str", "bool", "Decimal")),
    ("Deduplicate", lambda n: isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "add" or (isinstance(n, ast.Compare) and any(isinstance(o, ast.NotIn) for o in n.ops) and "seen" in seg(n))),
    ("Group", lambda n: isinstance(n, ast.Call) and getattr(n.func, "attr", "") in ("setdefault", "groupby") or (isinstance(n, ast.Call) and getattr(n.func, "id", "") == "defaultdict")),
    ("Aggregate", lambda n: isinstance(n, ast.AugAssign) or (isinstance(n, ast.Call) and getattr(n.func, "id", "") in ("sum", "max", "min", "Counter"))),
    ("Sort", lambda n: isinstance(n, ast.Call) and (getattr(n.func, "id", "") == "sorted" or getattr(n.func, "attr", "") == "sort")),
    ("Priority queue", lambda n: isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == "heapq"),
    ("Batch", lambda n: isinstance(n, ast.Call) and getattr(n.func, "id", "") == "islice" or getattr(getattr(n, "func", None), "attr", "") == "islice"),
    ("Write file", lambda n: isinstance(n, ast.Call) and getattr(n.func, "attr", "") in ("write", "writerow", "writerows", "dump", "replace")),
    ("Stream out", lambda n: isinstance(n, (ast.Yield, ast.YieldFrom))),
    ("Return result", lambda n: isinstance(n, ast.Return) and n.value is not None),
]
found = {}
for node in ast.walk(tree):
    for label, test in RULES:
        try:
            ok = test(node)
        except Exception:
            ok = False
        if ok and hasattr(node, "lineno"):
            found[label] = min(found.get(label, 10**9), node.lineno)
stages = sorted(({"label": k, "line": v} for k, v in found.items()), key=lambda s: (s["line"], s["label"]))
if any(s["label"] == "Return result" for s in stages):
    stages = [s for s in stages if s["label"] != "Return result"] + [s for s in stages if s["label"] == "Return result"]

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
print("__DF_OUTLINE__" + json.dumps({"functions": funcs, "classes": classes, "stages": stages, "imports": imports}))
`;

export const outlineProgram = (src: string) => OUTLINE_PY.replace("__DF_SRC__", JSON.stringify(JSON.stringify(src)));

export function parseOutline(stdout: string): PyOutline | null {
  const i = stdout.lastIndexOf("__DF_OUTLINE__");
  if (i < 0) return null;
  try { return JSON.parse(stdout.slice(i + "__DF_OUTLINE__".length).split("\n")[0]) as PyOutline; } catch { return null; }
}
