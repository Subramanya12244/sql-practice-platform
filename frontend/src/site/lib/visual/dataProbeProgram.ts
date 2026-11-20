/**
 * The Python program behind the pandas / NumPy stage view (Agent 4). Runs inside the EXISTING Pyodide worker (see lib/pyodide.worker.ts);
 * it is also valid CPython, which is how the unit tests run it for real.
 *
 * What it does: parses the learner's program, runs it statement by statement (top level), and for each statement that touches a
 * DataFrame, Series or ndarray it records stages:
 *   - a method chain such as `df[df.a > 1].sort_values("a").groupby("k")["v"].sum()` is evaluated step by step, each step exactly once
 *     (receiver, then arguments, then the call), so every intermediate value is REAL and nothing is run twice;
 *   - an operator or a module function (`a + b`, `a @ b`, `np.dot(a, b)`, `pd.merge(x, y)`) records its operands and its result;
 *   - a statement that changes a variable without a value stage (`df["c"] = ...`, `df.dropna(inplace=True)`, `a[0] = 9`) records the
 *     variable before and after (a copy taken before the statement, so in-place changes are visible).
 * The learner's stdout/stderr go to one buffer and are returned in the result, like the normal run.
 *
 * Not done here (reported as notes, never faked): operations inside loops, function bodies, `with`/`try` blocks are not split into
 * stages (only the variables they changed are shown). Snapshots hold the first rows/columns only; shapes, dtypes, counts are exact.
 */

/** Same convention as TRACE_MARK in pyTrace.ts, with its own tag. */
export const DATA_MARK = "\u001eDFDATA\u001e";

export const DATA_PROBE = String.raw`
import sys as _sys, json as _json, ast as _ast, io as _io, types as _types, operator as _opm, copy as _copy, itertools as _it, hashlib as _hl, math as _math, traceback as _tb
_SRC = __DF_SRC__
_O = _json.loads(__DF_OPT__)
_R = _O["rows"]; _C = _O["cols"]; _GR = _O["groups"]; _MAXST = _O["maxStages"]; _MAXOUT = _O["maxStdout"]; _BIG = _O["bigCells"]; _MAXROWS = _O["maxFlowRows"]
_MARK = "\x1eDFDATA\x1e"
_G = {}
_STAGES = []; _NOTES = []; _DROPPED = [0]; _PLAIN = [0]; _TRACK = {}; _CURLINE = [0]

class _Sink:
    encoding = "utf-8"; errors = "strict"
    def __init__(self): self.buf = []; self.n = 0; self.kept = 0
    def write(self, s):
        s = str(s); self.n += len(s)
        if self.kept < _MAXOUT:
            t = s[: _MAXOUT - self.kept]; self.buf.append(t); self.kept += len(t)
        return len(s)
    def writelines(self, ls):
        for x in ls: self.write(x)
    def flush(self): pass
    def isatty(self): return False
    def text(self): return "".join(self.buf)

def _clip(s, n):
    s = str(s)
    return s if len(s) <= n else s[: n - 1] + "…"
def _lab(x, n=18):
    try:
        if isinstance(x, tuple): return _clip(" | ".join("NaN" if (y is None or y != y) else str(y) for y in x), n)
        if x is None or (isinstance(x, float) and x != x): return "NaN"
        return _clip(x, n)
    except Exception: return "?"
def _cell(x):
    try:
        if x is None: return None
        if isinstance(x, float) and x != x: return None
        tn = type(x).__name__
        if tn in ("NaTType", "NAType"): return None
        if isinstance(x, float): return _clip(repr(round(x, 6)), 18)
        return _clip(str(x), 18)
    except Exception: return "?"
def _mod(v): return getattr(type(v), "__module__", "") or ""
def _isdf(v): return type(v).__name__ == "DataFrame" and _mod(v).startswith("pandas")
def _isser(v): return type(v).__name__ == "Series" and _mod(v).startswith("pandas")
def _isnd(v): return type(v).__name__ == "ndarray" and _mod(v).startswith("numpy")
def _isgrp(v): return type(v).__name__ in ("DataFrameGroupBy", "SeriesGroupBy") and _mod(v).startswith("pandas")
_WIN = ("Rolling", "Expanding", "ExponentialMovingWindow", "Window", "RollingGroupby", "ExpandingGroupby")
def _iswin(v):
    n = type(v).__name__
    return _mod(v).startswith("pandas") and (n in _WIN or n.endswith("Resampler"))
_ACC = ("StringMethods", "DatetimeProperties", "TimedeltaProperties", "PeriodProperties", "CategoricalAccessor", "SparseAccessor", "ArrowExtensionArray")
def _isdata(v): return _isdf(v) or _isser(v) or _isnd(v)
def _kind(v):
    if _isdata(v): return "data"
    if _isgrp(v): return "group"
    if _iswin(v): return "window"
    n = type(v).__name__
    if _mod(v).startswith("pandas") and (n in _ACC or n.endswith("Indexer")): return "helper"
    return "other"
def _short(x):
    try:
        if _isdf(x): return "DataFrame" + str(tuple(x.shape))
        if _isser(x): return "Series(" + str(len(x)) + ")"
        if _isnd(x): return "ndarray" + str(tuple(x.shape))
        if callable(x) and not isinstance(x, type): return "<" + getattr(x, "__name__", type(x).__name__) + ">"
        if isinstance(x, (list, tuple, set, frozenset)):
            n = len(x); body = ", ".join(_short(y) for y in _it.islice(x, 6)) + (", …" if n > 6 else "")
            return ("[" + body + "]") if isinstance(x, list) else ("(" + body + ")") if isinstance(x, tuple) else "{" + body + "}"
        if isinstance(x, dict):
            n = len(x); return "{" + ", ".join(_short(a) + ": " + _short(b) for a, b in _it.islice(x.items(), 4)) + (", …" if n > 4 else "") + "}"
        return _clip(repr(x), 40)
    except Exception: return "?"

def _plain(v):
    t = type(v)
    if v is None: return {"k": "none", "r": "None"}
    if t is bool: return {"k": "bool", "r": repr(v)}
    if t in (int, float, str): return {"k": t.__name__, "r": _clip(repr(v), 80)}
    if t in (list, tuple, set, frozenset, dict): return {"k": t.__name__, "r": _clip(_short(v), 120), "n": len(v)}
    return {"k": "other", "t": t.__name__, "r": _clip(_short(v) if _kind(v) == "other" else "<" + t.__name__ + ">", 80)}

def _nd_data(v, fn):
    nd = v.ndim
    def sl(s): return s.astype(str) if s.dtype.kind in "Mm" else s
    if nd == 0: return fn(sl(v).item()), []
    if nd == 1:
        s = v[:12]; return [fn(x) for x in sl(s).tolist()], [int(s.shape[0])]
    if nd == 2:
        s = v[:10, :10]; return [[fn(x) for x in r] for r in sl(s).tolist()], [int(x) for x in s.shape]
    lead = nd - 3
    s = v[(0,) * lead] if lead else v
    s = s[:4, :8, :8]
    return [[[fn(x) for x in r] for r in pl] for pl in sl(s).tolist()], [int(x) for x in s.shape]

def _snap_nd(v):
    data, shown = _nd_data(v, _cell)
    return {"k": "nd", "r": "ndarray", "shape": [int(x) for x in v.shape], "ndim": int(v.ndim), "dtype": str(v.dtype), "n": int(v.size),
        "itemsize": int(v.itemsize), "nbytes": int(v.nbytes), "strides": [int(x) for x in v.strides], "c": bool(v.flags["C_CONTIGUOUS"]), "owns": v.base is None,
        "data": data, "shown": shown, "lead": max(0, int(v.ndim) - 3), "more": bool(_math.prod(shown) < v.size)}
def _idxnames(ix): return [None if x is None else _lab(x, 24) for x in ix.names]
def _snap_df(v):
    n, m = int(v.shape[0]), int(v.shape[1])
    h = v.iloc[:_R, :_C]
    pd = _sys.modules["pandas"]
    d = {"k": "df", "r": "DataFrame", "shape": [n, m], "cols": [_lab(c) for c in h.columns], "dtypes": [str(x) for x in h.dtypes],
        "index": [_lab(i, 14) for i in h.index], "rows": [[_cell(x) for x in row] for row in h.itertuples(index=False, name=None)],
        "na": [int(x) for x in v.iloc[:, :_C].isna().to_numpy().sum(axis=0)], "more": bool(n > _R or m > _C),
        "colNames": [_lab(c, 30) for c in v.columns[:60]], "colDtypes": [str(x) for x in v.dtypes.iloc[:60]],
        "idxName": _idxnames(v.index), "idxDtype": str(v.index.dtype), "multiRows": isinstance(v.index, pd.MultiIndex), "multiCols": isinstance(v.columns, pd.MultiIndex),
        "naTotal": int(v.isna().to_numpy().sum()) if v.size <= _BIG else None}
    return d
def _snap_ser(v):
    pd = _sys.modules["pandas"]
    h = v.iloc[:_R + 0]
    return {"k": "series", "r": "Series", "shape": [int(len(v))], "n": int(len(v)), "name": None if v.name is None else _lab(v.name, 24), "dtype": str(v.dtype),
        "index": [_lab(i, 14) for i in h.index], "rows": [[_cell(x)] for x in h.tolist()], "more": bool(len(v) > _R), "idxName": _idxnames(v.index),
        "multiRows": isinstance(v.index, pd.MultiIndex), "na": [int(v.isna().sum())], "naTotal": int(v.isna().sum())}
def _kfmt(key):
    return _lab(key if isinstance(key, tuple) else (key,), 40)
def _snap_grp(gb):
    tn = type(gb).__name__
    keys = getattr(gb, "keys", None)
    by = [_lab(x, 24) for x in keys] if isinstance(keys, (list, tuple)) else [_lab(keys, 24)] if isinstance(keys, str) else []
    obj = getattr(gb, "obj", None)
    try:
        sz = gb.size(); szs = sz["size"] if hasattr(sz, "columns") else sz
        in_groups = int(szs.sum())
    except Exception: in_groups = None
    groups = []
    for key, g in _it.islice(iter(gb), _GR):
        gs = _snap_df(g.iloc[:5, :6]) if _isdf(g) else _snap_ser(g.iloc[:5])
        groups.append({"key": _kfmt(key), "size": int(len(g)), "snap": gs})
    return {"k": "group", "t": tn, "r": tn, "by": by, "ngroups": int(gb.ngroups), "groups": groups, "srcRows": None if obj is None else int(len(obj)), "inGroups": in_groups,
        "source": "series" if _isser(obj) else "df", "name": None if not _isser(obj) or obj.name is None else _lab(obj.name, 24)}
def _snap_win(v):
    params = {}
    for a in getattr(v, "_attributes", []) or []:
        try:
            x = getattr(v, a, None)
            if x is not None and a != "axis" and a != "method": params[a] = _clip(repr(x), 30)
        except Exception: pass
    return {"k": "obj", "t": type(v).__name__, "r": type(v).__name__, "params": params}
def _snap(v):
    try:
        tn = type(v).__name__; md = _mod(v)
        if md.startswith("pandas"):
            if tn == "DataFrame": return _snap_df(v)
            if tn == "Series": return _snap_ser(v)
            if tn in ("DataFrameGroupBy", "SeriesGroupBy"): return _snap_grp(v)
            if _iswin(v): return _snap_win(v)
            return {"k": "other", "t": tn, "r": _clip(tn, 60)} if _kind(v) == "helper" else {"k": "other", "t": tn, "r": _clip(repr(v), 120)}
        if md.startswith("numpy"):
            if tn == "ndarray": return _snap_nd(v)
            if hasattr(v, "item") and getattr(v, "ndim", None) == 0 and hasattr(v, "dtype"):
                x = v.item()
                return {"k": "float" if isinstance(x, float) else "bool" if isinstance(x, bool) else "int" if isinstance(x, int) else "other", "r": _clip(repr(x), 60), "t": tn, "dtype": str(v.dtype)}
            return {"k": "other", "t": tn, "r": _clip(repr(v), 120)}
        return _plain(v)
    except Exception as e:
        return {"k": "other", "t": type(v).__name__, "r": "<could not capture: " + type(e).__name__ + ">"}

def _fp(v):
    try:
        if _isnd(v):
            if v.size > _BIG: return ("nd", id(v), tuple(v.shape), str(v.dtype), None)
            if v.dtype.hasobject: return ("nd", tuple(v.shape), str(v.dtype), hash(repr(v.tolist())))
            return ("nd", tuple(v.shape), str(v.dtype), _hl.md5(v.tobytes()).hexdigest())
        pd = _sys.modules["pandas"]
        if v.size > _BIG: return ("pd", id(v), tuple(v.shape), None)
        meta = (tuple(v.shape), tuple(str(x) for x in v.dtypes) if _isdf(v) else str(v.dtype), tuple(str(x) for x in v.columns) if _isdf(v) else str(v.name), str(v.index.names), str(v.index.dtype))
        try: h = _hl.md5(pd.util.hash_pandas_object(v, index=True).to_numpy().tobytes()).hexdigest()
        except Exception: h = hash(str(v.to_numpy(dtype=object).tolist()))
        return ("pd", meta, h)
    except Exception: return ("id", id(v))
def _copyof(v):
    try:
        if v.size <= _MAXROWS: return v.copy()
    except Exception: pass
    return None

def _same(x, y):
    pd = _sys.modules["pandas"]
    try:
        eq = (x == y)
        both = pd.isna(x) & pd.isna(y)
        return bool((eq | both).all())
    except Exception: return False
def _rowflow(src, out):
    try:
        if not ((_isdf(src) or _isser(src)) and (_isdf(out) or _isser(out))): return None
        n = int(len(src)); m = int(len(out))
        r = {"in": n, "out": m}
        if n > _MAXROWS or m > _MAXROWS: r["ident"] = "skipped"; return r
        if not (src.index.is_unique and out.index.is_unique): r["ident"] = "unknown"; return r
        kept = src.index.isin(out.index)
        common = src.index[kept]
        if len(common) and not src.index.equals(out.index):
            if _isdf(src) and _isdf(out):
                if not (src.columns.is_unique and out.columns.is_unique): r["ident"] = "unknown"; return r
                shared = [c for c in src.columns if c in out.columns]
                if not shared: r["ident"] = "unknown"; return r
                a = src.loc[common, shared].to_numpy(dtype=object); b = out.loc[common, shared].to_numpy(dtype=object)
            elif _isser(src) and _isser(out):
                a = src.loc[common].to_numpy(dtype=object); b = out.loc[common].to_numpy(dtype=object)
            else:
                r["ident"] = "unknown"; return r
            if not _same(a, b): r["ident"] = "unknown"; return r
        r["ident"] = "index"
        r["retained"] = int(kept.sum()); r["removed"] = n - r["retained"]
        newmask = ~out.index.isin(src.index)
        r["added"] = int(newmask.sum())
        r["reordered"] = bool(len(common) and list(out.index[out.index.isin(src.index)]) != list(common))
        r["shownKept"] = [bool(x) for x in kept[:_R]]
        r["shownNew"] = [bool(x) for x in newmask[:_R]]
        return r
    except Exception as e:
        return {"in": int(len(src)), "out": int(len(out)), "ident": "unknown", "why": type(e).__name__}

def _nk(t): return tuple(None if (x is None or x != x) else x for x in t)
def _kcount(kf):
    d = {}
    for t in kf.itertuples(index=False, name=None):
        t = _nk(t); d[t] = d.get(t, 0) + 1
    return d
_MERGE_POS = ["how", "on", "left_on", "right_on", "left_index", "right_index", "sort", "suffixes", "copy", "indicator", "validate"]
_JOIN_POS = ["on", "how", "lsuffix", "rsuffix", "sort", "validate"]
def _aslist(x): return None if x is None else (list(x) if isinstance(x, (list, tuple)) else [x])
def _kf(df, cols, use_index):
    if cols:
        if not all(c in df.columns for c in cols): return None
        return df[list(cols)].reset_index(drop=True)
    if use_index: return df.index.to_frame(index=False)
    return None
def _merge_info(left, right, how, kw, is_join, out, rerun):
    try:
        pd = _sys.modules["pandas"]
        if _isser(right): right = right.to_frame()
        if not (_isdf(left) and _isdf(right)): return None
        if how == "cross": return {"how": how, "skipped": "cross join has no keys"}
        if len(left) > _MAXROWS or len(right) > _MAXROWS: return {"how": how, "skipped": "too many rows to analyse"}
        on = _aslist(kw.get("on")); lon = _aslist(kw.get("left_on")); ron = _aslist(kw.get("right_on"))
        li = bool(kw.get("left_index")); ri = bool(kw.get("right_index"))
        if is_join:
            lcols, rcols, lidx, ridx = on, None, on is None, True
        elif on is not None: lcols, rcols, lidx, ridx = on, on, False, False
        elif lon is not None or ron is not None or li or ri: lcols, rcols, lidx, ridx = lon, ron, li, ri
        else:
            common = [c for c in left.columns if c in right.columns]
            lcols, rcols, lidx, ridx = common, common, False, False
        lk = _kf(left, lcols, lidx); rk = _kf(right, rcols, ridx)
        if lk is None or rk is None or len(lk.columns) != len(rk.columns) or len(lk.columns) == 0: return {"how": how, "skipped": "keys could not be read from the call"}
        kn = ["k%d" % i for i in range(len(lk.columns))]
        lnames = [_lab(c, 24) for c in (lcols if lcols else left.index.names)]
        rnames = [_lab(c, 24) for c in (rcols if rcols else right.index.names)]
        lk.columns = kn; rk.columns = kn
        rku = rk.drop_duplicates().assign(__m=1); lku = lk.drop_duplicates().assign(__m=1)
        lm = lk.merge(rku, on=kn, how="left")["__m"].notna().to_numpy()
        rm = rk.merge(lku, on=kn, how="left")["__m"].notna().to_numpy()
        lc = _kcount(lk); rc = _kcount(rk)
        matched = [(k, lc[k], rc[k]) for k in lc if k in rc]
        ul = [(k, lc[k]) for k in lc if k not in rc]; ur = [(k, rc[k]) for k in rc if k not in lc]
        expected = sum(a * b for _, a, b in matched) + (sum(c for _, c in ul) if how in ("left", "outer") else 0) + (sum(c for _, c in ur) if how in ("right", "outer") else 0)
        info = {"how": how, "viaJoin": is_join, "leftKeys": lnames, "rightKeys": rnames, "leftRows": int(len(left)), "rightRows": int(len(right)), "outRows": int(len(out)),
            "matchedKeys": [{"key": _kfmt(k), "left": a, "right": b} for k, a, b in matched[:8]], "matchedKeyCount": len(matched),
            "unmatchedLeftKeys": [{"key": _kfmt(k), "rows": c} for k, c in ul[:8]], "unmatchedLeftKeyCount": len(ul),
            "unmatchedRightKeys": [{"key": _kfmt(k), "rows": c} for k, c in ur[:8]], "unmatchedRightKeyCount": len(ur),
            "leftMatchedRows": int(lm.sum()), "leftUnmatchedRows": int(len(lm) - lm.sum()), "rightMatchedRows": int(rm.sum()), "rightUnmatchedRows": int(len(rm) - rm.sum()),
            "leftShown": ["matched" if x else "unmatched" for x in lm[:_R]], "rightShown": ["matched" if x else "unmatched" for x in rm[:_R]],
            "expectedOutRows": int(expected), "pairRows": int(sum(a * b for _, a, b in matched))}
        if not is_join and _isdf(out):
            col = None; ind = kw.get("indicator")
            try:
                if ind:
                    col = out["_merge" if ind is True else ind]
                else:
                    col = rerun(indicator="__df_origin__")["__df_origin__"]
            except Exception: col = None
            if col is not None:
                info["origin"] = [str(x) for x in col.iloc[:_R]]
                info["originCounts"] = {str(a): int(b) for a, b in col.value_counts().items() if int(b) > 0}
        return info
    except Exception as e:
        return {"how": how, "skipped": "analysis failed: " + type(e).__name__}
def _concat_info(a, k, out):
    try:
        objs = a[0] if a else k.get("objs")
        if isinstance(objs, dict): objs = list(objs.values())
        objs = list(objs)
        ax = k.get("axis", a[1] if len(a) > 1 else 0)
        ax = 1 if ax in (1, "columns") else 0
        parts = [{"shape": [int(x) for x in p.shape] if hasattr(p, "shape") else None, "kind": type(p).__name__} for p in objs[:8]]
        info = {"axis": ax, "parts": parts, "partCount": len(objs), "join": str(k.get("join", "outer")), "ignoreIndex": bool(k.get("ignore_index", False))}
        if ax == 0 and all(hasattr(p, "__len__") for p in objs) and len(out) == sum(len(p) for p in objs):
            info["rowOrigin"] = [j for j, p in enumerate(objs) for _ in range(len(p))][:_R]
            info["rowCounts"] = [int(len(p)) for p in objs[:8]]
        if ax == 1 and all(_isdf(p) for p in objs) and len(out.columns) == sum(len(p.columns) for p in objs):
            info["colOrigin"] = [j for j, p in enumerate(objs) for _ in range(len(p.columns))][:_C]
        return info
    except Exception: return None

_RED = ("sum", "mean", "min", "max", "prod", "std", "var", "argmax", "argmin", "any", "all", "median", "ptp", "average", "nansum", "nanmean", "nanmax", "nanmin", "nanmedian", "count_nonzero", "amax", "amin")
_ALONG = ("cumsum", "cumprod", "sort", "argsort", "diff", "flip", "cummax", "cummin")
_POSOPS = ("reshape", "ravel", "flatten", "transpose", "swapaxes", "squeeze", "moveaxis")
def _axisinfo(name, arr, a, k, method):
    try:
        if name not in _RED and name not in _ALONG: return None
        pos = 0 if method else 1
        ax = k.get("axis", a[pos] if len(a) > pos and not isinstance(a[pos], (_types.FunctionType,)) else None)
        if name in _ALONG and "axis" not in k and len(a) <= pos: ax = -1 if name in ("sort", "argsort", "diff") else None
        d = {"op": "reduce" if name in _RED else "along", "keepdims": bool(k.get("keepdims", False))}
        if ax is None: d["axis"] = None
        elif isinstance(ax, int): d["axis"] = [ax % arr.ndim if arr.ndim else 0]
        elif isinstance(ax, (tuple, list)): d["axis"] = [int(x) % arr.ndim for x in ax]
        else: return None
        return d
    except Exception: return None
def _nd_extra(src, out, op, a, k, key, method):
    np = _sys.modules.get("numpy")
    ex = {}
    try:
        if np is not None and _isnd(src):
            ai = _axisinfo(op, src, a, k, method)
            if ai: ex["axis"] = ai
            fnp = None
            if key is not _NOKEY: fnp = lambda p: p[key]
            elif op == "T": fnp = lambda p: p.T
            elif op in _POSOPS and method: fnp = lambda p: getattr(p, op)(*a, **k)
            if fnp is not None and src.size <= 1000000:
                po = fnp(np.arange(src.size).reshape(src.shape))
                po = np.asarray(po)
                if tuple(po.shape) == tuple(np.shape(out)):
                    sel = np.zeros(src.size, dtype=bool); sel.reshape(-1)[po.ravel()] = True
                    sd, _ = _nd_data(sel.reshape(src.shape), bool)
                    pd_, _ = _nd_data(po, int)
                    ex["pos"] = {"src": pd_, "sel": sd}
            if _isnd(out): ex["view"] = bool(out.base is not None and (out.base is src or out.base is src.base))
    except Exception: pass
    return ex
class _NoKey: pass
_NOKEY = _NoKey()

def _jdef(o):
    try:
        if hasattr(o, "item"): return o.item()
    except Exception: pass
    return str(o)
class _CapKey:
    def __getitem__(self, k): return k
def _line(node): return int(getattr(node, "end_lineno", None) or getattr(node, "lineno", 0) or 0)
def _seg(node):
    try: s = _ast.get_source_segment(_SRC, node)
    except Exception: s = None
    if s is None:
        try: s = _ast.unparse(node)
        except Exception: s = ""
    return " ".join(s.split())
def _steptext(st):
    try:
        if isinstance(st, _ast.Call):
            args = [_seg(x) for x in st.args] + [(("**" if kw.arg is None else kw.arg + "=") + _seg(kw.value)) for kw in st.keywords]
            return _clip("." + st.func.attr + "(" + ", ".join(args) + ")", 160)
        if isinstance(st, _ast.Attribute): return "." + st.attr
        return _clip("[" + _seg(st.slice) + "]", 160)
    except Exception: return "?"
def _ev(node, extra=None):
    e = _ast.Expression(body=node); _ast.fix_missing_locations(e)
    return eval(compile(e, "<learner>", "eval"), _G, extra if extra is not None else {})
def _capcall(call):
    c = _ast.Call(func=_ast.Name(id="__df_cap__", ctx=_ast.Load()), args=call.args, keywords=call.keywords)
    _ast.copy_location(c, call)
    return _ev(c, {"__df_cap__": lambda *a, **k: (a, k)})
def _evkey(sl, st):
    s = _ast.Subscript(value=_ast.Name(id="__df_k__", ctx=_ast.Load()), slice=sl, ctx=_ast.Load())
    _ast.copy_location(s, st)
    return _ev(s, {"__df_k__": _CapKey()})
def _spine(node):
    steps = []
    while True:
        if isinstance(node, _ast.Call) and isinstance(node.func, _ast.Attribute): steps.append(node); node = node.func.value
        elif isinstance(node, (_ast.Attribute, _ast.Subscript)): steps.append(node); node = node.value
        else: break
    steps.reverse()
    return node, steps
def _recvnode(st): return st.func.value if isinstance(st, _ast.Call) else st.value
def _pure(n):
    while isinstance(n, _ast.Attribute): n = n.value
    return isinstance(n, _ast.Name)

def _emit(ctx, d):
    if d.get("error"): _CURLINE[0] = d.get("line") or ctx["line"]
    d["stmt"] = ctx["stmt"]; d["stmtLine"] = ctx["line"]
    ctx["made"].append(d)
    if len(_STAGES) >= _MAXST: _DROPPED[0] += 1; return
    d["i"] = len(_STAGES); _STAGES.append(d)
def _err(e): return {"type": type(e).__name__, "msg": _clip(str(e), 600)}
def _argsnaps(vals):
    out = []
    for x in vals:
        if _isdata(x): out.append(_snap(x))
        elif isinstance(x, (list, tuple)) and x and all(_isdata(y) for y in x[:3]): out.extend(_snap(y) for y in x[:3])
    return out[:4]
def _reprs(a, k):
    return {"argsRepr": [_clip(_short(x), 40) for x in a[:6]], "kwargsRepr": {str(n): _clip(_short(v), 40) for n, v in list(k.items())[:8]}}

_SAFECALL = ("mean", "median", "min", "max", "sum", "std", "var", "count", "nunique", "quantile", "abs", "round", "isna", "notna", "isnull", "notnull", "isin", "between", "lower", "upper", "strip", "len", "contains", "startswith", "endswith", "isnumeric", "isalpha")
_IMPURE = (_ast.Lambda, _ast.NamedExpr, _ast.Await, _ast.Yield, _ast.YieldFrom, _ast.ListComp, _ast.SetComp, _ast.DictComp, _ast.GeneratorExp, _ast.JoinedStr)
def _purex(n):
    for x in _ast.walk(n):
        if isinstance(x, _IMPURE): return False
        if isinstance(x, _ast.Call) and not (isinstance(x.func, _ast.Attribute) and x.func.attr in _SAFECALL): return False
    return True
def _flat(n, op):
    if isinstance(n, _ast.BinOp) and isinstance(n.op, op): return _flat(n.left, op) + _flat(n.right, op)
    return [n]
def _opnd(v): return _snap(v) if (_isdata(v) or _kind(v) != "other" or _mod(v).startswith("numpy")) else _plain(v)
def _cond(sl):
    """The pieces of a row condition inside df[...]: each comparison with its operands and its own True/False column. Only call-free expressions are evaluated again (a few safe methods such as mean() are allowed), so nothing with a side effect ever runs twice."""
    try:
        joiner = None; leaves = [sl]
        if isinstance(sl, _ast.BinOp) and isinstance(sl.op, (_ast.BitAnd, _ast.BitOr)):
            op = type(sl.op); joiner = "&" if op is _ast.BitAnd else "|"; leaves = _flat(sl, op)
        if len(leaves) > 4: return None
        out = []
        for lf in leaves:
            if not _purex(lf): return None
            if isinstance(lf, _ast.Compare) and len(lf.ops) == 1 and type(lf.ops[0]) in _CMP:
                fn, sym = _CMP[type(lf.ops[0])]
                lv = _ev(lf.left); rv = _ev(lf.comparators[0]); mk = fn(lv, rv)
                if not (_isser(mk) and str(mk.dtype) == "bool"): return None
                out.append({"text": _clip(_seg(lf), 120), "op": sym, "leftText": _clip(_seg(lf.left), 80), "rightText": _clip(_seg(lf.comparators[0]), 80), "left": _opnd(lv), "right": _opnd(rv), "mask": _snap(mk)})
            else:
                mk = _ev(lf)
                if not (_isser(mk) and str(mk.dtype) == "bool"): return None
                out.append({"text": _clip(_seg(lf), 120), "mask": _snap(mk)})
        return {"joiner": joiner, "leaves": out}
    except Exception: return None

def _apply(st, cur, csnap, ctx, last):
    pend = ctx.get("pend")
    data_in, in_snap, codes = cur, csnap, []
    if pend is not None: data_in, in_snap, codes = pend["obj"], pend["snap"], pend["codes"]
    ctx["pend"] = None
    here = _steptext(st)
    code = "".join(codes) + here
    expr = _clip(_seg(st), 200)
    in_data = _isdata(data_in) or _isgrp(data_in) or _iswin(data_in)
    if in_snap is None and in_data: in_snap = _snap(data_in)
    a = (); k = {}; key = _NOKEY; fn = None
    if isinstance(st, _ast.Call): fn = getattr(cur, st.func.attr); a, k = _capcall(st); op = st.func.attr; method = True
    elif isinstance(st, _ast.Attribute): op = st.attr; method = False
    else: key = _evkey(st.slice, st); op = "[]"; method = False
    base = {"op": op, "code": code, "expr": expr, "line": _line(st), "inputs": [in_snap] if in_snap is not None else [], "argSnaps": _argsnaps(list(a) + list(k.values()) + ([] if key is _NOKEY else [key]))}
    base.update(_reprs(a, k))
    if key is not _NOKEY: base["keyRepr"] = _clip(_short(key), 40)
    try:
        if fn is not None: out = fn(*a, **k)
        elif key is not _NOKEY: out = cur[key]
        else: out = getattr(cur, op)
    except BaseException as e:
        if in_data:
            d = dict(base); d["kind"] = "call" if method else "attr" if key is _NOKEY else "select"; d["output"] = None; d["error"] = _err(e); _emit(ctx, d)
        raise
    ko = _kind(out)
    if ko == "helper" and not last:
        ctx["pend"] = {"obj": data_in, "snap": in_snap, "codes": codes + [here]}
        return out, None
    if out is None: return out, None
    if not (in_data or ko in ("data", "group", "window", "helper")): return out, None
    osnap = _snap(out)
    d = dict(base); d["kind"] = "call" if method else "attr" if key is _NOKEY else "select"; d["output"] = osnap
    rf = _rowflow(data_in, out) if in_data and (_isdf(data_in) or _isser(data_in)) else None
    if rf: d["rows"] = rf
    if key is not _NOKEY and isinstance(st, _ast.Subscript) and in_data and (_isdf(data_in) or _isser(data_in)):
        cd = _cond(st.slice)
        if cd: d["cond"] = cd
    if _isnd(data_in):
        d.update(_nd_extra(data_in, out, op, a, k, key, method))
    if method and op in ("merge", "join") and _isdf(data_in) and _isdf(out):
        right = k.get("right", k.get("other", a[0] if a else None))
        kw = dict(k)
        for nme, val in zip(_JOIN_POS if op == "join" else _MERGE_POS, a[1:] if op == "merge" else a[1:]): kw.setdefault(nme, val)
        how = kw.get("how", "left" if op == "join" else "inner")
        d["merge"] = _merge_info(data_in, right, how, kw, op == "join", out, lambda **x: fn(*a, **dict(k, **x)))
    ctx["last_obj"] = out
    _emit(ctx, d)
    return out, osnap

_BIN = {_ast.Add: (_opm.add, "+"), _ast.Sub: (_opm.sub, "-"), _ast.Mult: (_opm.mul, "*"), _ast.Div: (_opm.truediv, "/"), _ast.FloorDiv: (_opm.floordiv, "//"), _ast.Mod: (_opm.mod, "%"),
    _ast.Pow: (_opm.pow, "**"), _ast.MatMult: (_opm.matmul, "@"), _ast.BitAnd: (_opm.and_, "&"), _ast.BitOr: (_opm.or_, "|"), _ast.BitXor: (_opm.xor, "^"), _ast.LShift: (_opm.lshift, "<<"), _ast.RShift: (_opm.rshift, ">>")}
_CMP = {_ast.Eq: (_opm.eq, "=="), _ast.NotEq: (_opm.ne, "!="), _ast.Lt: (_opm.lt, "<"), _ast.LtE: (_opm.le, "<="), _ast.Gt: (_opm.gt, ">"), _ast.GtE: (_opm.ge, ">=")}
_UN = {_ast.USub: (_opm.neg, "-"), _ast.UAdd: (_opm.pos, "+"), _ast.Invert: (_opm.invert, "~")}
def _opstage(ctx, node, fn, sym, vals, kind):
    snaps = [_snap(x) if (_isdata(x) or _kind(x) != "other") else _plain(x) for x in vals]
    anyd = any(_isdata(x) for x in vals)
    d = {"kind": kind, "op": sym, "code": _clip(_seg(node), 200), "expr": _clip(_seg(node), 200), "line": _line(node), "inputs": snaps, "argSnaps": []}
    try: out = fn(*vals)
    except BaseException as e:
        if anyd: d["output"] = None; d["error"] = _err(e); _emit(ctx, d)
        raise
    if not anyd and not _isdata(out): return out, None
    d["output"] = _snap(out)
    ctx["last_obj"] = out
    _emit(ctx, d)
    return out, d["output"]
def _funcname(f):
    if isinstance(f, _ast.Attribute): return f.attr
    if isinstance(f, _ast.Name): return f.id
    return "call"
def _eval_root(node, ctx):
    if isinstance(node, _ast.BinOp) and type(node.op) in _BIN:
        fn, sym = _BIN[type(node.op)]
        lv = _ev(node.left); rv = _ev(node.right)
        return _opstage(ctx, node, fn, sym, [lv, rv], "binop")
    if isinstance(node, _ast.Compare) and len(node.ops) == 1 and type(node.ops[0]) in _CMP:
        fn, sym = _CMP[type(node.ops[0])]
        lv = _ev(node.left); rv = _ev(node.comparators[0])
        return _opstage(ctx, node, fn, sym, [lv, rv], "compare")
    if isinstance(node, _ast.UnaryOp) and type(node.op) in _UN:
        fn, sym = _UN[type(node.op)]
        return _opstage(ctx, node, fn, sym, [_ev(node.operand)], "unary")
    if isinstance(node, _ast.Call):
        f = _ev(node.func); a, k = _capcall(node)
        name = _funcname(node.func)
        ops = [x for x in a if _isdata(x)] + [y for x in a if isinstance(x, (list, tuple, dict)) for y in (x.values() if isinstance(x, dict) else x) if _isdata(y)] + [v for v in k.values() if _isdata(v)]
        d = {"kind": "func", "op": name, "code": _clip(_seg(node), 200), "expr": _clip(_seg(node), 200), "line": _line(node), "inputs": [_snap(x) for x in ops[:4]], "argSnaps": []}
        d.update(_reprs(a, k))
        try: out = f(*a, **k)
        except BaseException as e:
            if ops: d["output"] = None; d["error"] = _err(e); _emit(ctx, d)
            raise
        if out is None or not (ops or _isdata(out) or _kind(out) != "other"): return out, None
        d["output"] = _snap(out)
        first = ops[0] if ops else None
        if _isnd(first):
            d.update(_nd_extra(first, out, name, list(a[1:]), k, _NOKEY, True))
        if name == "merge" and len(a) >= 2 and _isdf(a[0]) and _isdf(out):
            kw = dict(k)
            for nme, val in zip(_MERGE_POS, a[2:]): kw.setdefault(nme, val)
            d["merge"] = _merge_info(a[0], a[1], kw.get("how", "inner"), kw, False, out, lambda **x: f(*a, **dict(k, **x)))
        elif name == "concat" and (_isdf(out) or _isser(out)):
            d["concat"] = _concat_info(a, k, out)
        ctx["last_obj"] = out
        _emit(ctx, d)
        return out, d["output"]
    return _ev(node), None
def _eval_value(node, ctx):
    base, steps = _spine(node)
    root = node
    ri = 0
    if steps:
        recv = base
        while ri < len(steps) and _pure(recv):
            try: rv = _ev(recv)
            except Exception: break
            if isinstance(rv, _types.ModuleType) or isinstance(rv, type): recv = steps[ri]; ri += 1
            else: break
        root = recv
    cur, snap = _eval_root(root, ctx)
    rest = steps[ri:]
    for n, st in enumerate(rest):
        cur, snap = _apply(st, cur, snap, ctx, n == len(rest) - 1)
    return cur

def _tracked():
    return {k: v for k, v in list(_G.items()) if not k.startswith("_") and _isdata(v)}
def _run_stmt(node):
    _CURLINE[0] = int(node.lineno)
    ctx = {"stmt": _clip(_seg(node), 200), "line": int(node.lineno), "made": [], "pend": None, "last_obj": None}
    before = len(ctx["made"])
    val_node = node.value if isinstance(node, (_ast.Assign, _ast.AugAssign, _ast.AnnAssign, _ast.Expr)) else None
    assigned = []
    if isinstance(node, _ast.Assign): assigned = [t.id for t in node.targets if isinstance(t, _ast.Name)]
    elif isinstance(node, (_ast.AnnAssign, _ast.AugAssign)) and isinstance(node.target, _ast.Name): assigned = [node.target.id]
    val = None
    staged = val_node is not None and isinstance(val_node, (_ast.Call, _ast.BinOp, _ast.UnaryOp, _ast.Compare, _ast.Attribute, _ast.Subscript))
    if isinstance(node, (_ast.For, _ast.AsyncFor, _ast.While, _ast.If, _ast.With, _ast.Try, _ast.FunctionDef, _ast.ClassDef)):
        _NOTES.append({"line": int(node.lineno), "kind": type(node).__name__})
    if staged:
        val = _eval_value(val_node, ctx)
        if not isinstance(node, _ast.Expr):
            n2 = _copy.copy(node); n2.value = _ast.Name(id="__df_val__", ctx=_ast.Load()); _ast.copy_location(n2.value, val_node)
            _G["__df_val__"] = val
            try: exec(compile(_ast.Module([n2], []), "<learner>", "exec"), _G)
            finally: _G.pop("__df_val__", None)
    else:
        exec(compile(_ast.Module([node], []), "<learner>", "exec"), _G)
    if ctx["made"] and assigned and ctx["last_obj"] is val and val is not None: ctx["made"][-1]["assignedTo"] = assigned[0]
    cur = _tracked()
    changed = 0
    for name in sorted(cur):
        v = cur[name]; fp = _fp(v); old = _TRACK.get(name)
        if old is not None and old[0] == fp: continue
        snap = _snap(v)
        skip = name in assigned and val is v and ctx["made"]
        if not skip:
            alias = next((o for o in sorted(cur) if o != name and cur[o] is v), None)
            d = {"kind": "change", "op": "assign" if old is None else "in-place", "code": ctx["stmt"], "expr": ctx["stmt"], "line": int(node.lineno), "inputs": [old[1]] if old is not None else [], "argSnaps": [],
                "output": snap, "assignedTo": name}
            if alias: d["alias"] = alias
            if old is not None and old[2] is not None:
                rf = _rowflow(old[2], v)
                if rf: d["rows"] = rf
            _emit(ctx, d); changed += 1
        _TRACK[name] = (fp, snap, _copyof(v))
    for name in [n for n in _TRACK if n not in cur]: del _TRACK[name]
    if not ctx["made"] and not changed and staged and val is None and isinstance(val_node, _ast.Call) and isinstance(val_node.func, _ast.Attribute) and isinstance(val_node.func.value, _ast.Name) and val_node.func.value.id in cur:
        nm = val_node.func.value.id
        d = {"kind": "change", "op": "in-place", "code": ctx["stmt"], "expr": ctx["stmt"], "line": int(node.lineno), "inputs": [_TRACK[nm][1]], "argSnaps": [], "output": _TRACK[nm][1], "assignedTo": nm, "unchanged": True}
        _emit(ctx, d); changed += 1
    if not ctx["made"] and not changed: _PLAIN[0] += 1

def _main():
    sink = _Sink(); err = None; syntax = False
    real_out, real_err = _sys.stdout, _sys.stderr
    try:
        tree = _ast.parse(_SRC, "<learner>")
    except SyntaxError as e:
        return {"v": 1, "ok": False, "syntax": True, "error": {"type": "SyntaxError", "msg": _clip(str(e), 300), "line": e.lineno}, "stdout": "", "stages": [], "notes": [], "dropped": 0, "plain": 0, "libs": {}, "finals": {}}
    _sys.stdout = sink; _sys.stderr = sink
    try:
        for node in tree.body:
            _run_stmt(node)
    except BaseException as e:
        line = None
        for fr in _tb.extract_tb(e.__traceback__):
            if fr.filename == "<learner>": line = fr.lineno
        if line is None: line = _CURLINE[0] or None
        err = {"type": type(e).__name__, "msg": _clip(str(e), 600), "line": line}
    finally:
        _sys.stdout = real_out; _sys.stderr = real_err
    libs = {"python": _sys.version.split()[0]}
    for m in ("numpy", "pandas"):
        mo = _sys.modules.get(m)
        if mo is not None: libs[m] = str(getattr(mo, "__version__", "?"))
    return {"v": 1, "ok": err is None, "error": err, "stdout": sink.text(), "stdoutChars": sink.n, "stages": _STAGES, "dropped": _DROPPED[0], "plain": _PLAIN[0], "notes": _NOTES[:20], "libs": libs,
        "finals": {n: t[1] for n, t in list(_TRACK.items())[:20]}}
_RESULT = _main()
print(_MARK + _json.dumps(_RESULT, default=_jdef, ensure_ascii=True, separators=(",", ":")))
`;
