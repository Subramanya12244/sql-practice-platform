/**
 * Python Code Time Machine: a real execution trace of the learner's code.
 *
 * The learner's source is run inside the existing Pyodide worker under `sys.settrace`. Every executed line, call, return
 * and exception is COUNTED exactly; a bounded, sampled subset is RECORDED with the variables visible at that moment.
 * Nothing is simulated: if a step is shown, Python really executed it.
 *
 * Scalable by design (not by raising a cap):
 * - The first steps of the run are recorded in detail, and a ring buffer keeps the last ones (the end is not known in advance).
 * - A loop that repeats keeps its first `loopHead` iterations and its last `loopTail` iterations in full, a few checkpoints
 *   in between, and SUMMARISES the rest (iteration count, lines executed, per-variable first/last value and number of changes).
 *   Loops are found per call frame, so nested loops and loops inside functions are sampled separately and recursion is never
 *   mistaken for a loop.
 * - The call stack at the deepest point, every exception origin, the first step and the last step are always kept.
 * - Line counts, call counts and the deepest stack are exact for the whole run, including skipped steps.
 * - A hard event budget (events or traced time) detaches the tracer; the learner's program then runs on at full speed with the
 *   same output, result and exceptions. The trace says exactly where it stopped, and the counts become lower bounds.
 *
 * What is NOT literal: the "memory" view built from this trace is a teaching model (names pointing at objects). Object ids
 * are small counters, not addresses, and it says nothing about CPython's real memory layout.
 *
 * Tracing never assigns to the learner's variables, never writes to the learner's stdout, never calls the learner's __repr__, and
 * keeps no reference to the learner's objects (so finalizers run when they would have). Object numbers are counters; for built-in
 * lists, dicts and sets, which Python cannot weakly reference, a new object that reuses the address of a freed one can share its number.
 *
 * The trace lives in memory for the page only. It is never stored or synced.
 */
import { isPythonWarmed, runPython, FIRST_RUN_TIMEOUT_MS, type PyResult } from "../pyRunner";
import { decodeSteps, type RawStep } from "./traceStore";

/** Back-compat name: the total number of recorded steps a trace may hold. */
export const MAX_STEPS = 1500;
export const TRACE_MARK = "\u001eDFTRACE\u001e";
/** Wall-clock limit for a traced run once Python is loaded (tracing itself stops earlier, at `maxTraceMs`). */
export const TRACE_TIMEOUT_MS = 25_000;

/** Limits for one traced run. Every field has a default; pass only what you want to change. */
export interface TraceOptions {
  /** Hard ceiling for recorded steps (the number form of the second argument of `buildTraceProgram`). */
  maxSteps: number;
  /** Steps recorded in detail from the start of the run, outside loops. */
  headSteps: number;
  /** Steps kept in a ring at the end of the run, outside loops. */
  tailSteps: number;
  /** A repeating loop keeps this many first iterations in full (a loop nested inside another keeps half as many per level, at least 3). */
  loopHead: number;
  /** ...and this many last iterations in full. */
  loopTail: number;
  /** ...and the first step of every N-th iteration between them (a checkpoint). */
  checkpointEvery: number;
  /** Checkpoints kept per loop; beyond it the interval doubles and every other checkpoint is dropped. */
  maxCheckpoints: number;
  /** Outside loops, every N-th event after the detailed head is kept as a checkpoint. */
  rootCheckpointEvery: number;
  /** Hard budget of traced events (lines, calls, returns, exceptions). At this point tracing detaches. */
  maxEvents: number;
  /** Wall-clock budget for tracing in milliseconds (0 = none). At this point tracing detaches. */
  maxTraceMs: number;
  /** Characters of a value's short text. */
  maxValueChars: number;
  /** Items shown per list, tuple, set or dict. */
  maxItems: number;
  /** Characters of program output kept (the count of all output characters is always exact). */
  maxStdout: number;
  /** Per loop iteration: first and last events kept when one iteration is very long. */
  iterHead: number;
  iterTail: number;
  /** Frames of the call stack kept per step (innermost). */
  maxFrames: number;
}

export const DEFAULT_TRACE_OPTIONS: Readonly<TraceOptions> = {
  maxSteps: MAX_STEPS, headSteps: 300, tailSteps: 60, loopHead: 10, loopTail: 10, checkpointEvery: 1000, maxCheckpoints: 40,
  rootCheckpointEvery: 5000, maxEvents: 400_000, maxTraceMs: 5000, maxValueChars: 80, maxItems: 12, maxStdout: 20_000,
  iterHead: 40, iterTail: 20, maxFrames: 12,
};

const int = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : d;
  return Math.max(lo, Math.min(hi, n));
};

/** Fill defaults and clamp every field. A bare number means "at most this many recorded steps". */
export function resolveTraceOptions(o?: number | Partial<TraceOptions>): TraceOptions {
  const x: Partial<TraceOptions> = typeof o === "number" ? { maxSteps: o } : o ?? {};
  const d = DEFAULT_TRACE_OPTIONS;
  const maxSteps = int(x.maxSteps, d.maxSteps, 8, 20_000);
  // A small budget shrinks the head and the tail with it so the parts always fit inside `maxSteps`.
  const headSteps = Math.min(int(x.headSteps, d.headSteps, 1, 5000), Math.max(1, Math.floor(maxSteps * 0.35)));
  const tailSteps = Math.min(int(x.tailSteps, d.tailSteps, 1, 2000), Math.max(1, Math.floor(maxSteps * 0.15)));
  return {
    maxSteps, headSteps, tailSteps,
    loopHead: int(x.loopHead, d.loopHead, 1, 500), loopTail: int(x.loopTail, d.loopTail, 1, 500),
    checkpointEvery: int(x.checkpointEvery, d.checkpointEvery, 1, 10_000_000), maxCheckpoints: int(x.maxCheckpoints, d.maxCheckpoints, 1, 500),
    rootCheckpointEvery: int(x.rootCheckpointEvery, d.rootCheckpointEvery, 1, 100_000_000),
    maxEvents: int(x.maxEvents, d.maxEvents, 100, 100_000_000), maxTraceMs: int(x.maxTraceMs, d.maxTraceMs, 0, 600_000),
    maxValueChars: int(x.maxValueChars, d.maxValueChars, 20, 400), maxItems: int(x.maxItems, d.maxItems, 2, 40), maxStdout: int(x.maxStdout, d.maxStdout, 0, 1_000_000),
    iterHead: int(x.iterHead, d.iterHead, 1, 500), iterTail: int(x.iterTail, d.iterTail, 1, 500), maxFrames: int(x.maxFrames, d.maxFrames, 1, 40),
  };
}

/** A serialised Python value. `k` is the kind; containers carry a few items, never the whole object. */
export interface PyVal {
  k: "none" | "bool" | "int" | "float" | "str" | "bytes" | "list" | "tuple" | "set" | "frozenset" | "deque" | "dict" | "df" | "series" | "nd" | "gen" | "func" | "class" | "obj" | "other";
  /** Short repr (truncated). */
  r: string;
  /** Type name as Python reports it. */
  t?: string;
  /** Small counter identifying one object for the whole trace (same id = same object). Absent for plain immutables. */
  id?: number;
  /** Length or element count. */
  n?: number;
  /** Indexes into the value table: list/tuple/set items, or flat [key, value, key, value…] for dicts. */
  items?: number[];
  /** Attribute name → value index, for plain objects (linked nodes, trees). */
  attrs?: Record<string, number>;
  // DataFrame / Series / ndarray
  shape?: number[];
  cols?: string[];
  dtypes?: string[];
  index?: string[];
  rows?: (string | null)[][];
  na?: number[];
  dtype?: string;
  name?: string;
  ndim?: number;
  /** ndarray contents as nested lists of short strings (at most 2 dimensions, 8 by 8). */
  data?: unknown;
  /** Generator state: GEN_CREATED, GEN_SUSPENDED, GEN_CLOSED… */
  state?: string;
  /** More elements exist than are shown. */
  more?: boolean;
}

/** `end` is a synthetic last step added when tracing was detached: the program's final variables, not a traced event. */
export type TraceEvent = "line" | "call" | "return" | "yield" | "exception" | "end";

export interface TraceFrame { fn: string; line: number; vars: Record<string, number> }

export interface TraceStep {
  ev: TraceEvent;
  line: number;
  /** Call stack, outermost (module) first. */
  frames: TraceFrame[];
  /** Characters of stdout printed so far. */
  out: number;
  /** Returned or yielded value (index into the value table). */
  ret?: number;
  exc?: { type: string; msg: string };
  /** Which traced event this was, counting from 1 over the whole run (absent in hand-built traces: then steps are consecutive). */
  seq?: number;
  /** Kept as a checkpoint: the first step of every N-th loop iteration (or every N-th event outside loops). */
  cp?: boolean;
  /** Inside a loop that repeats: [line of the loop, iteration number]. */
  loop?: [number, number];
}

/** What one summarised stretch of a loop did, without recording its steps. */
export interface TraceGapLoop {
  fn: string;
  /** Line of the loop statement. */
  line: number;
  /** Iterations summarised, inclusive (1-based). */
  from: number;
  to: number;
  /** How many times each line ran in the summarised iterations (exact), including lines of called functions. */
  lines: Record<number, number>;
  /** Variables of the loop's frame at the start of the first and the last summarised iteration, and how many times they differed between consecutive summarised iterations. */
  vars: { name: string; first: number; last: number; changes: number }[];
}

export interface TraceGap {
  /** Index of the recorded step before the gap, and of the one after it. */
  after: number;
  before: number;
  /** The traced events not recorded here, inclusive (event numbers counted over the whole run). */
  fromSeq: number;
  toSeq: number;
  skipped: number;
  /** `loop`: a repeating loop was summarised. `limit`: the step budget reached. `detached`: tracing had stopped, the program ran on untraced. */
  kind: "loop" | "limit" | "detached";
  loops: TraceGapLoop[];
}

/** Exact counts over every traced event, recorded or not. When `exact` is false tracing stopped early and these are lower bounds. */
export interface TraceCounts {
  events: number;
  lines: Record<number, number>;
  calls: Record<string, number>;
  maxDepth: number;
  exceptions: number;
  exact: boolean;
}

export interface LoopStat { line: number; entries: number; iterations: number; longest: number; /** one-line loops: the count may be off by one */ approx: boolean }

export interface TraceDetach { atEvent: number; reason: "events" | "time" | "error"; message?: string }

export interface Trace {
  ok: boolean;
  steps: TraceStep[];
  vals: PyVal[];
  stdout: string;
  error?: { type: string; msg: string; line?: number };
  /** True when some traced events were not recorded as steps (sampled loops, step budget) or tracing stopped early. The program still ran to the end. */
  truncated: boolean;
  stat: { loopDepth: number; recursive: string[]; loops: number };
  // Added by the scalable tracer. All optional: a hand-built trace without them is a complete, unsampled trace.
  gaps?: TraceGap[];
  /** Indexes of the checkpoint steps. */
  checkpoints?: number[];
  options?: TraceOptions;
  skipped?: { events: number; steps: number };
  counts?: TraceCounts;
  loops?: LoopStat[];
  /** Index of the step where the exception that ended the program was raised. */
  exceptionStep?: number;
  detached?: TraceDetach;
  stdoutChars?: number;
  stdoutTruncated?: boolean;
}

// The tracer. Runs inside Pyodide; also valid CPython 3.13 (the unit tests run it there). No CPython-only features are used.
// Reading guide: _FS is the per-frame tracer; _Reg is one running loop; _Buf is one iteration; _Root is the run outside loops.
const TRACER = String.raw`
import sys as _sys, json as _json, ast as _ast, inspect as _inspect, dis as _dis, collections as _coll, io as _io, weakref as _weakref, builtins as _builtins, importlib as _importlib
from itertools import islice as _islice
from time import perf_counter as _clock
_SRC = __DF_SRC__
_O = _json.loads(__DF_OPT__)
_FN = "<learner>"
_MAXEV = _O["maxEvents"]; _MAXS = _O["maxSteps"]; _H = _O["headSteps"]; _T = _O["tailSteps"]
_LH = _O["loopHead"]; _LT = _O["loopTail"]; _IH = _O["iterHead"]; _IT = _O["iterTail"]
_CPN = _O["checkpointEvery"]; _MAXCP = _O["maxCheckpoints"]; _RCP = _O["rootCheckpointEvery"]
_VC = _O["maxValueChars"]; _MI = _O["maxItems"]; _MAXF = _O["maxFrames"]; _OUTMAX = _O["maxStdout"]
_SL = max(6, _MAXS // 10)
_P = max(0, _MAXS - _H - _T - _SL)
_DEAD = 1e18
_LC = [0] * (len(_SRC.split("\n")) + 6)
_CALLS = {}; _LST = {}; _LIVE = []; _HDR = {}
_nev = 0; _depth = 0; _maxdepth = 0; _nexc = 0
_inside = False
_det = None; _terr = None
_first = None; _last = None; _deep = None; _exco = None; _lastexc = 0; _excs = []
_real_out = _sys.stdout
class _Tee:
    # Captures the learner's stdout. Writes made while the tracer itself is working are dropped, so tracing never adds output.
    encoding = "utf-8"; errors = "strict"
    def __init__(self): self.buf = []; self.n = 0; self.kept = 0
    def write(self, s):
        s = str(s)
        if _inside: return len(s)
        self.n += len(s)
        if self.kept < _OUTMAX:
            s2 = s[: _OUTMAX - self.kept]; self.buf.append(s2); self.kept += len(s2)
        return len(s)
    def writelines(self, ls):
        for x in ls: self.write(x)
    def flush(self): pass
    def isatty(self): return False
    def writable(self): return True
    def readable(self): return False
    def fileno(self): raise _io.UnsupportedOperation("fileno")
    # A plain run's sys.stdout is a text stream: programs may read these or call reconfigure, so the stand-in has them too.
    name = "<stdout>"; mode = "w"; line_buffering = False; closed = False
    def reconfigure(self, **kw): pass
    @property
    def buffer(self): return _TeeBuf(self)
class _TeeBuf:
    def __init__(self, t): self.t = t
    def write(self, b):
        self.t.write(bytes(b).decode("utf-8", "replace")); return len(b)
    def flush(self): pass
    def writable(self): return True
_TEE = _Tee()
def _clip(s, n=None):
    n = n or _VC
    return s if len(s) <= n else s[: n - 1] + "…"
_IMM = frozenset((type(None), bool, int, float, str, bytes))
_MODT = type(_sys)
_NONE = type(None)
def _rp(v, n=None, d=0):
    # A short text for a value. Never calls the learner's own __repr__ (it could print or have side effects).
    n = n or _VC
    t = type(v)
    try:
        if t is str or t is bytes: return _clip(repr(v[: n + 2]), n)
        if t in _IMM or t is complex: return _clip(repr(v), n)
        if t is list or t is tuple or t is set or t is frozenset or t is _coll.deque:
            if d >= 3: return "…"
            try: ln = len(v)
            except Exception: ln = 0
            if t is set or t is frozenset: it = sorted(_islice(v, 40), key=lambda x: _rp(x, 24, d + 1))[:8]
            else: it = list(_islice(v, 8))
            body = ", ".join(_rp(x, 24, d + 1) for x in it) + (", …" if ln > 8 else "")
            if t is list: s = "[" + body + "]"
            elif t is tuple: s = "(" + body + ("," if ln == 1 else "") + ")"
            elif t is _coll.deque: s = "deque([" + body + "])"
            elif t is set: s = "{" + body + "}" if ln else "set()"
            else: s = "frozenset({" + body + "})" if ln else "frozenset()"
            return _clip(s, n)
        if isinstance(v, dict):
            if d >= 3: return "…"
            ln = dict.__len__(v)
            body = ", ".join(_rp(a, 24, d + 1) + ": " + _rp(b, 24, d + 1) for a, b in _islice(dict.items(v), 8)) + (", …" if ln > 8 else "")
            s = "{" + body + "}"
            return _clip(s if t is dict else t.__name__ + "(" + s + ")", n)
        mod = getattr(t, "__module__", "") or ""
        if mod in ("__main__", "") or (mod == "builtins" and getattr(_builtins, t.__name__, None) is not t): return "<" + t.__name__ + " object>"
        return _clip(repr(v), n)
    except Exception as e:
        return "<repr failed: " + type(e).__name__ + ">"
_IDS = {}
def _oid(v):
    # A small counter per object. The table never holds the object itself (that could delay the learner's finalizers and change
    # what they print); a weak reference, where Python allows one, tells a new object at a reused address from the old one.
    k = id(v)
    e = _IDS.get(k)
    if e is not None and (e[1] is None or e[1]() is v): return e[0]
    if len(_IDS) >= 200000 and e is None: return None
    try: wr = _weakref.ref(v)
    except TypeError: wr = None
    i = _IDS[k] = (len(_IDS) + 1 if e is None else e[0] + 100000, wr)
    return i[0]
def _imm(v):
    t = type(v)
    if v is None: return {"k": "none", "r": "None"}
    if t is bool: return {"k": "bool", "r": repr(v)}
    if t is int: return {"k": "int", "r": _clip(repr(v))}
    if t is float: return {"k": "float", "r": repr(v)}
    if t is str: return {"k": "str", "r": _rp(v), "n": len(v)}
    return {"k": "bytes", "r": _rp(v), "n": len(v)}
def _cell(x):
    try:
        if x is None: return None
        if isinstance(x, float) and x != x: return None
        tn = type(x).__name__
        if tn in ("NaTType", "NAType"): return None
        if isinstance(x, float): return _clip(repr(round(x, 6)), 18)
        return _clip(str(x), 18)
    except Exception: return "?"
_FC = {}
def _desc(d, v):
    if d.get("id") is None: d.pop("id", None)
    return d
def _ser(v, d=0):
    # Immutable scalars are returned as they are (safe to keep); everything else becomes a small descriptor dict, taken NOW.
    t = type(v)
    if t in _IMM:
        if (t is str or t is bytes) and len(v) > 100: return _imm(v)
        return v
    tn = t.__name__; mod = getattr(t, "__module__", "") or ""
    if mod.startswith("pandas") and tn == "DataFrame":
        try:
            h = v.iloc[:10, :8]
            return _desc({"k": "df", "r": "DataFrame", "id": _oid(v), "shape": [int(v.shape[0]), int(v.shape[1])],
                "cols": [_clip(str(c), 18) for c in h.columns], "dtypes": [str(x) for x in h.dtypes],
                "index": [_clip(str(i), 14) for i in h.index], "rows": [[_cell(x) for x in row] for row in h.itertuples(index=False, name=None)],
                "na": [int(x) for x in v.iloc[:, :8].isna().sum()], "more": bool(v.shape[0] > 10 or v.shape[1] > 8)}, v)
        except Exception: return {"k": "other", "t": tn, "r": "DataFrame"}
    if mod.startswith("pandas") and tn == "Series":
        try:
            h = v.iloc[:12]
            return _desc({"k": "series", "r": "Series", "id": _oid(v), "n": int(len(v)), "name": None if v.name is None else str(v.name), "dtype": str(v.dtype),
                "index": [_clip(str(i), 14) for i in h.index], "rows": [[_cell(x)] for x in h.tolist()], "more": bool(len(v) > 12)}, v)
        except Exception: return {"k": "other", "t": tn, "r": "Series"}
    if mod.startswith("numpy") and tn == "ndarray":
        try:
            a = v
            while a.ndim > 2: a = a[0]
            if a.ndim == 2: data = [[_cell(x) for x in row[:8]] for row in a[:8].tolist()]
            elif a.ndim == 1: data = [_cell(x) for x in a[:12].tolist()]
            else: data = _cell(a.item())
            return _desc({"k": "nd", "r": "ndarray", "id": _oid(v), "shape": [int(x) for x in v.shape], "ndim": int(v.ndim), "dtype": str(v.dtype), "n": int(v.size), "data": data,
                "more": bool(v.ndim > 2 or any(s > (8 if v.ndim > 1 else 12) for s in v.shape))}, v)
        except Exception: return {"k": "other", "t": tn, "r": "ndarray"}
    if mod.startswith("numpy") and hasattr(v, "item") and not hasattr(v, "__len__"):
        try:
            x = v.item()
            return {"k": "float" if isinstance(x, float) else "bool" if isinstance(x, bool) else "int" if isinstance(x, int) else "other", "r": _rp(x), "t": tn}
        except Exception: pass
    if t in (list, tuple, set, frozenset) or t is _coll.deque:
        kind = "deque" if t is _coll.deque else tn
        ln = len(v)
        base = {"k": kind, "r": _rp(v, 60), "id": _oid(v), "n": ln}
        if d < 2:
            if t is set or t is frozenset: seq = sorted(_islice(v, 200), key=_rp)[:_MI]
            else: seq = list(_islice(v, _MI))
            base["items"] = [_ser(x, d + 1) for x in seq]
            base["more"] = ln > _MI
        return _desc(base, v)
    if isinstance(v, dict):
        ln = dict.__len__(v)
        base = {"k": "dict", "r": _rp(v, 60), "id": _oid(v), "n": ln, "t": tn}
        if d < 2:
            flat = []
            for i, (a, b) in enumerate(dict.items(v)):
                if i >= _MI: break
                flat.append(_ser(a, d + 1)); flat.append(_ser(b, d + 1))
            base["items"] = flat; base["more"] = ln > _MI
        return _desc(base, v)
    if _inspect.isgenerator(v):
        return _desc({"k": "gen", "r": getattr(v, "__name__", "generator"), "id": _oid(v), "state": _inspect.getgeneratorstate(v)}, v)
    if _inspect.isfunction(v) or _inspect.isbuiltin(v) or _inspect.ismethod(v):
        nm = getattr(v, "__name__", "function")
        c = _FC.get(nm)
        if c is None: c = _FC[nm] = {"k": "func", "r": nm}
        return c
    if _inspect.isclass(v): return {"k": "class", "r": v.__name__}
    # object.__getattribute__ skips the learner's own __getattr__, which a plain getattr would call (and may log) for a slots class.
    try: dd = object.__getattribute__(v, "__dict__")
    except Exception: dd = None
    if isinstance(dd, dict) and d < 3 and mod in ("__main__", "builtins", ""):
        attrs = {}
        for i, (a, b) in enumerate(dict.items(dd)):
            if i >= 8: break
            attrs[str(a)] = _ser(b, d + 1)
        return _desc({"k": "obj", "t": tn, "r": _rp(v, 50), "id": _oid(v), "attrs": attrs}, v)
    return {"k": "other", "t": tn, "r": _rp(v)}
_NOK = {}
def _cv(f):
    # Variables of one frame, taken now. Returns (vars, pure): pure means every value is an immutable scalar kept as it is.
    out = {}; pure = True
    try: items = list(f.f_locals.items())
    except Exception: return out, False
    for name, val in items:
        ok = _NOK.get(name)
        if ok is None: ok = _NOK[name] = not (name[:2] == "__" or name[:4] == "_df_")
        if not ok: continue
        t = type(val)
        if t in _IMM and not ((t is str or t is bytes) and len(val) > 100): out[name] = val
        else:
            if t is _MODT: continue
            pure = False
            try: out[name] = _ser(val)
            except Exception: out[name] = {"k": "other", "r": "<unreadable>"}
        if len(out) >= 24: break
    return out, pure
_YIELD = _dis.opmap.get("YIELD_VALUE", -1); _RESUME = _dis.opmap.get("RESUME", -2)
_YC = {}
def _isyield(frame):
    try:
        co = frame.f_code
        if not co.co_flags & 0x20 or frame.f_lasti < 0: return False
        b = _YC.get(co)
        if b is None: b = _YC[co] = co.co_code
        i = frame.f_lasti
        # Python 3.14 reports the YIELD_VALUE itself; 3.12 and 3.13 report the RESUME that follows it (Pyodide 0.29 runs 3.13).
        return b[i] == _YIELD or (b[i] == _RESUME and i >= 2 and b[i - 2] == _YIELD)
    except Exception: return False

# ── Where recorded steps live ───────────────────────────────────────────
# A step is a list: [seq, event, line, frames, out_chars, ret, exc, loop_tag, flags]. A gap summary is a dict with "g".
class _Buf:
    # One loop iteration: its first _IH events and a ring of its last _IT events (a very long iteration cannot flood memory).
    __slots__ = ("head", "ring", "n", "s0", "lc")
    def __init__(self, s0): self.head = []; self.ring = None; self.n = 0; self.s0 = s0; self.lc = None
    def add(self, it):
        self.n += 1
        h = self.head
        if len(h) < _IH: h.append(it)
        else:
            r = self.ring
            if r is None: r = self.ring = _coll.deque(maxlen=_IT)
            r.append(it)
    commit = add
    def items(self): return self.head + list(self.ring) if self.ring else self.head
class _Root:
    # The run outside sampled loops: a detailed head, a ring of the last steps, checkpoints, and what finished loops committed.
    # Committed loop steps also keep a start and an end: the first half of the budget fills first, then a ring keeps the latest.
    def __init__(self):
        self.head = []; self.ring = _coll.deque(maxlen=max(1, _T)); self.prot = []; self.pring = _coll.deque(maxlen=max(1, _P - _P // 2))
        self.mid = []; self.cpn = _RCP
    def add(self, it):
        h = self.head
        if len(h) < _H: h.append(it); return
        r = self.ring
        if len(r) == r.maxlen:
            old = r[0]
            if type(old) is list and old[0] % self.cpn == 0:
                old[8] = 1; self.mid.append(old)
                if len(self.mid) > _MAXCP:
                    self.cpn *= 2; self.mid = [e for e in self.mid if e[0] % self.cpn == 0]
        r.append(it)
    def commit(self, it):
        if len(self.prot) < _P // 2: self.prot.append(it)
        else: self.pring.append(it)
_ROOT = _Root()
class _Reg:
    # One running loop in one call frame.
    __slots__ = ("li", "k", "cur", "ring", "mid", "seg", "cpn", "ncp", "closed", "owner", "tag", "fn", "lastn", "lh", "lt", "dep")
    def __init__(self, li, owner, fn, dep):
        # A loop inside another sampled loop keeps fewer iterations (half per level, at least 3), so nesting cannot multiply the steps.
        self.dep = dep; self.lh = max(3, _LH >> dep) if _LH > 3 else _LH; self.lt = max(3, _LT >> dep) if _LT > 3 else _LT
        self.li = li; self.k = 0; self.cur = None; self.ring = _coll.deque(); self.mid = []; self.seg = None; self.cpn = _CPN; self.ncp = 0
        self.closed = False; self.owner = owner; self.tag = None; self.fn = fn; self.lastn = 0
class _LI:
    __slots__ = ("line", "lo", "hi", "single")
    def __init__(self, line, lo, hi): self.line = line; self.lo = lo; self.hi = hi; self.single = lo == hi
def _sig(x):
    if type(x) is dict: return (x["k"], x["r"], x.get("n"))
    return (type(x), x)

class _FS:
    # Tracer state of one call frame. It lives as long as the frame (a generator keeps it between yields).
    __slots__ = ("regs", "inh", "t", "fn", "cache", "cellfree")
    def __init__(self, inh, fn, cellfree): self.regs = []; self.inh = inh; self.fn = fn; self.t = self.ev; self.cache = None; self.cellfree = cellfree
    def tgt(self):
        if self.regs: return self.regs[-1].cur
        r = self.inh
        if r is not None and not r.closed and r.cur is not None: return r.cur
        return _ROOT
    def parent(self, j):
        if j > 0: return self.regs[j - 1].cur
        r = self.inh
        if r is not None and not r.closed and r.cur is not None: return r.cur
        return _ROOT
    def begin(self, r, seq):
        b = _Buf(seq)
        if r.k > r.lh:
            lc = _LC[:]; lc[r.li.line] -= 1; b.lc = lc
        r.cur = b; r.tag = (r.li.line, r.k)
    def endpass(self, r, j):
        buf = r.cur
        if buf is None: return
        r.cur = None; r.lastn = buf.n
        k = r.k
        if k <= r.lh:
            par = self.parent(j)
            for it in buf.items(): par.commit(it)
        else:
            ring = r.ring; ring.append((k, buf))
            while len(ring) > r.lt + 1:
                kk, bb = ring.popleft(); self.fold(r, kk, bb)
    def fold(self, r, k, buf):
        # Iteration k is now certainly in the middle: summarise it, and keep its first step when it is a checkpoint.
        it0 = buf.head[0] if buf.head else None
        if type(it0) is not list: it0 = None
        if it0 is not None and k % r.cpn == 0:
            if r.seg is not None: self.endseg(r, buf.lc, buf.s0 - 1)
            it0[8] = 1; r.mid.append(it0); r.ncp += 1
            if r.ncp > _MAXCP:
                r.cpn *= 2
                r.mid = [e for e in r.mid if type(e) is dict or e[7][1] % r.cpn == 0]
                r.ncp = sum(1 for e in r.mid if type(e) is list)
            return
        sg = r.seg
        if sg is None: sg = r.seg = {"from": k, "to": k, "lc0": buf.lc, "s0": buf.s0, "vars": {}}
        sg["to"] = k
        if it0 is not None and it0[3]:
            sv = sg["vars"]
            for name, v in it0[3][-1][2].items():
                rec = sv.get(name)
                if rec is None: sv[name] = [v, v, 0]
                else:
                    p = rec[1]
                    if p is not v:
                        tp = type(p); tv = type(v)
                        if tp is dict or tv is dict:
                            if _sig(p) != _sig(v): rec[2] += 1
                        elif tp is not tv or p != v: rec[2] += 1
                        rec[1] = v
    def endseg(self, r, end_lc, end_s):
        sg = r.seg; r.seg = None
        lc0 = sg["lc0"]; lines = {}
        for i in range(len(lc0)):
            dd = end_lc[i] - lc0[i]
            if dd: lines[i] = dd
        r.mid.append({"g": 1, "s0": sg["s0"], "s1": end_s, "fn": r.fn, "line": r.li.line, "from": sg["from"], "to": sg["to"], "lines": lines,
            "vars": [[n, v[0], v[1], v[2]] for n, v in list(sg["vars"].items())[:12]]})
    def close(self, j):
        regs = self.regs
        r = regs[-1]
        self.endpass(r, j)
        regs.pop()
        r.closed = True
        try: _LIVE.remove(r)
        except ValueError: pass
        li = r.li; ring = r.ring; k = r.k
        exitb = None
        isexit = (r.lastn == 1) or li.single
        if k > r.lh and ring and isexit:
            exitb = ring.pop()[1]
        iters = max(0, k - 1) if isexit else k
        st = _LST.get(li.line)
        if st is None: st = _LST[li.line] = [0, 0, 0, 1 if li.single else 0]
        st[0] += 1; st[1] += iters
        if iters > st[2]: st[2] = iters
        if k > r.lh:
            while len(ring) > r.lt:
                kk, bb = ring.popleft(); self.fold(r, kk, bb)
            if r.seg is not None:
                if ring: eb = ring[0][1]; self.endseg(r, eb.lc, eb.s0 - 1)
                elif exitb is not None: self.endseg(r, exitb.lc, exitb.s0 - 1)
                else: self.endseg(r, _LC[:], _nev)
            par = self.parent(j)
            for it in r.mid: par.commit(it)
            for kk, bb in ring:
                for it in bb.items(): par.commit(it)
            if exitb is not None:
                for it in exitb.items(): par.commit(it)
    def hdr(self, li, seq):
        regs = self.regs
        j = len(regs) - 1
        while j >= 0 and regs[j].li is not li: j -= 1
        if j >= 0:
            while len(regs) > j + 1: self.close(len(regs) - 1)
            r = regs[j]
            self.endpass(r, j)
            r.k += 1
            self.begin(r, seq)
        else:
            pr = regs[-1] if regs else self.inh
            r = _Reg(li, self, self.fn, 0 if pr is None or pr.closed else pr.dep + 1)
            regs.append(r); _LIVE.append(r)
            r.k = 1; self.begin(r, seq)
    def ev(self, frame, event, arg):
        global _nev, _depth, _maxdepth, _inside, _last, _first, _deep, _exco, _lastexc, _nexc
        try:
            _nev += 1
            if _nev > _MAXEV or ((_nev & 1023) == 0 and _clock() > _DEAD):
                _nev -= 1; _detach("events" if _nev >= _MAXEV else "time"); return None
            seq = _nev
            regs = self.regs
            l = frame.f_lineno
            if event == "line":
                _LC[l] += 1
                while regs:
                    li = regs[-1].li
                    if li.lo <= l <= li.hi: break
                    self.close(len(regs) - 1)
                li = _HDR.get(l)
                if li is not None: self.hdr(li, seq)
            elif event == "call":
                _depth += 1
                if _depth > _maxdepth: _maxdepth = _depth
                c = _CALLS.get(self.fn)
                _CALLS[self.fn] = 1 if c is None else c + 1
            elif event == "return":
                if not _isyield(frame):
                    while regs: self.close(len(regs) - 1)
                _depth -= 1
            elif event == "exception": _nexc += 1
            _inside = True
            vs, pure = _cv(frame)
            self.cache = (l, vs) if pure and self.cellfree else None
            fr = [(self.fn, l, vs)]; n = 1; f = frame.f_back
            while f is not None and n < _MAXF:
                if f.f_code.co_filename == _FN:
                    ln = f.f_lineno
                    fs = getattr(f.f_trace, "__self__", None)
                    c = fs.cache if fs.__class__ is _FS else None
                    # An outer frame cannot change while a callee runs, unless it holds mutable values or cells: reuse its last snapshot then.
                    fr.append((f.f_code.co_name, ln, c[1] if c is not None and c[0] == ln else _cv(f)[0])); n += 1
                f = f.f_back
            fr.reverse()
            ret = exc = None
            if event == "return":
                ret = _ser(arg)
                if _isyield(frame): event = "yield"
            elif event == "exception":
                exc = (getattr(arg[0], "__name__", str(arg[0])), _clip(str(arg[1]), 200))
            if regs: tg = regs[-1].cur; tag = regs[-1].tag
            else:
                r = self.inh
                if r is not None and not r.closed and r.cur is not None: tg = r.cur; tag = r.tag
                else: tg = _ROOT; tag = None
            it = [seq, event, l, fr, _TEE.n, ret, exc, tag, 0]
            _inside = False
            tg.add(it)
            _last = it
            if _first is None: _first = it
            if event == "call" and _depth == _maxdepth: _deep = it
            elif event == "exception" and id(arg[1]) != _lastexc:
                _lastexc = id(arg[1]); _exco = it
                if len(_excs) < 8: _excs.append(it)
            if event == "return": self.t = None
        except RecursionError:
            _inside = False
            return self.t
        except Exception as e:
            _inside = False
            _detach("error", e); return None
        return self.t
def _inh_of(frame):
    b = frame.f_back
    if b is None: return None
    cs = getattr(b.f_trace, "__self__", None)
    if cs.__class__ is _FS: return cs.regs[-1] if cs.regs else cs.inh
    return None
def _glob(frame, event, arg):
    global _depth, _maxdepth
    co = frame.f_code
    if co.co_filename != _FN: return None
    ft = frame.f_trace
    st = getattr(ft, "__self__", None)
    try:
        if st.__class__ is _FS:
            st.inh = _inh_of(frame); st.t = st.ev
        else:
            # Module globals can be changed by any callee (global x), so a module frame's snapshot is never reused.
            st = _FS(_inh_of(frame), co.co_name, not co.co_cellvars and co.co_name != "<module>")
        if co.co_name == "<module>":
            _depth += 1
            if _depth > _maxdepth: _maxdepth = _depth
            return st.t
        return st.ev(frame, "call", arg)
    except Exception as e:
        _detach("error", e); return None
def _detach(reason, e=None):
    # Stop tracing; the learner's program carries on untouched. Loops still open are written out as far as they got.
    global _det, _terr
    _sys.settrace(None)
    _det = {"atEvent": _nev, "reason": reason}
    if e is not None: _det["message"] = type(e).__name__ + ": " + _clip(str(e), 120)
    _closeall()
def _closeall():
    # Loops still open (tracing stopped, or a generator that was never finished) are written out as far as they got.
    try:
        for r in list(reversed(_LIVE)):
            fs = r.owner
            if fs.regs and fs.regs[-1] is r: fs.close(len(fs.regs) - 1)
    except Exception: pass

# ── Finishing: pick what to keep, intern values, delta-encode, write one JSON line ──
_VALS = []; _VIDX = {}; _IIDX = {}
def _put(d):
    key = _json.dumps(d, sort_keys=True, default=str)
    i = _VIDX.get(key)
    if i is None:
        i = len(_VALS); _VIDX[key] = i; _VALS.append(d)
    return i
def _iv(x):
    if type(x) is dict:
        d = {k: v for k, v in x.items() if k != "_o"}
        if "items" in d: d["items"] = [_iv(c) for c in d["items"]]
        if "attrs" in d: d["attrs"] = {a: _iv(c) for a, c in d["attrs"].items()}
        return _put(d)
    key = (type(x), x)
    try: i = _IIDX.get(key)
    except TypeError: i = None
    if i is None:
        i = _put(_imm(x))
        try: _IIDX[key] = i
        except TypeError: pass
    return i
def _thin(steps, pins):
    if len(steps) <= _MAXS: return steps
    keep = {s[0] for s in pins}
    rest = [s for s in steps if s[0] not in keep]
    need = max(0, _MAXS - len(keep))
    if need == 0: rest = []
    else: rest = [rest[int(i * len(rest) / need)] for i in range(need)] if len(rest) > need else rest
    out = [s for s in steps if s[0] in keep] + rest
    out.sort(key=lambda s: s[0])
    return out
def _static(src):
    out = {"loopDepth": 0, "recursive": [], "loops": 0}
    try: tree = _ast.parse(src)
    except Exception: return out
    def depth(node, d):
        m = d
        for ch in _ast.iter_child_nodes(node):
            nd = d + 1 if isinstance(ch, (_ast.For, _ast.While, _ast.AsyncFor)) else d
            if nd > d: out["loops"] += 1
            m = max(m, depth(ch, nd))
        return m
    out["loopDepth"] = depth(tree, 0)
    for fn in _ast.walk(tree):
        if isinstance(fn, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
            for c in _ast.walk(fn):
                if isinstance(c, _ast.Call) and isinstance(c.func, _ast.Name) and c.func.id == fn.name:
                    if fn.name not in out["recursive"]: out["recursive"].append(fn.name)
        # Loops the tracer samples: for/while statements and one-line comprehensions, found by the line of their header.
        if isinstance(fn, (_ast.For, _ast.While, _ast.AsyncFor)) or (isinstance(fn, (_ast.ListComp, _ast.SetComp, _ast.DictComp, _ast.GeneratorExp)) and fn.lineno == getattr(fn, "end_lineno", fn.lineno)):
            if fn.lineno not in _HDR and fn.lineno < len(_LC): _HDR[fn.lineno] = _LI(fn.lineno, fn.lineno, getattr(fn, "end_lineno", fn.lineno) or fn.lineno)
    return out
def _finish(err, endvars, stat):
    _closeall()
    its = {}
    gaps_raw = []
    def take(x):
        if x is None: return
        if type(x) is dict: gaps_raw.append(x)
        else: its[x[0]] = x
    for x in _ROOT.head: take(x)
    for x in _ROOT.prot: take(x)
    for x in _ROOT.pring: take(x)
    for x in _ROOT.ring: take(x)
    for x in _ROOT.mid: take(x)
    pins = [x for x in (_first, _last, _exco) if x is not None] + list(_excs)
    if _deep is not None: pins.append(_deep)
    endstep = None
    if _det is not None:
        ln = (err or {}).get("line") or (_last[2] if _last else 1)
        endstep = [_nev + 1, "end", ln, [("<module>", ln, endvars)], _TEE.n, None, (err["type"], err["msg"]) if err else None, None, 0]
        pins.append(endstep)
    for x in pins: its[x[0]] = x
    steps = sorted(its.values(), key=lambda s: s[0])
    steps = _thin(steps, pins)
    idx = {s[0]: i for i, s in enumerate(steps)}
    # Gaps: wherever recorded steps are not consecutive, say what was skipped.
    gaps = []
    descs = sorted(gaps_raw, key=lambda d: d["s0"])
    for i in range(len(steps) - 1):
        a = steps[i][0]; b = steps[i + 1][0]
        if b > a + 1:
            lo = a + 1; hi = b - 1
            loops = [{"fn": d["fn"], "line": d["line"], "from": d["from"], "to": d["to"], "lines": d["lines"],
                "vars": [[n, _iv(f), _iv(l2), c] for n, f, l2, c in d["vars"]]} for d in descs if lo <= d["s0"] <= hi]
            kind = "loop" if loops else "limit"
            gaps.append({"a": i, "b": i + 1, "q0": lo, "q1": hi, "n": hi - lo + 1, "k": kind, "L": loops})
    if endstep is not None:
        # Between the last traced step and the final-state step the program ran untraced: how many events is unknown, so none is claimed.
        j = len(steps) - 1
        gaps.append({"a": j - 1, "b": j, "q0": _det["atEvent"] + 1, "q1": _det["atEvent"], "n": 0, "k": "detached", "L": []})
    out = []; prev = None
    for s in steps:
        fr = []; cur = []
        for i, (fn, ln, vs) in enumerate(s[3]):
            vi = {name: _iv(val) for name, val in vs.items()}
            p = prev[i] if prev is not None and i < len(prev) and prev[i][0] == fn else None
            if p is None: fr.append([fn, ln, vi])
            else:
                pv = p[1]
                fr.append([fn, ln, [{k: v for k, v in vi.items() if pv.get(k) != v}, [k for k in pv if k not in vi]]])
            cur.append((fn, vi))
        prev = cur
        o = {"e": s[1], "l": s[2], "f": fr, "o": s[4]}
        if s[1] != "end": o["q"] = s[0]
        if s[5] is not None: o["r"] = _iv(s[5])
        if s[6] is not None: o["x"] = [s[6][0], s[6][1]]
        if s[7] is not None: o["i"] = [s[7][0], s[7][1]]
        if s[8]: o["c"] = 1
        out.append(o)
    kept = len(steps) - (1 if endstep is not None else 0)
    exc_i = -1
    if err is not None and _exco is not None and _exco[0] in idx: exc_i = idx[_exco[0]]
    counts = {"events": _nev, "lines": {i: c for i, c in enumerate(_LC) if c}, "calls": _CALLS, "maxDepth": _maxdepth, "exceptions": _nexc, "exact": _det is None}
    loops = [{"line": ln, "entries": v[0], "iterations": v[1], "longest": v[2], "approx": bool(v[3])} for ln, v in sorted(_LST.items())]
    full = "".join(_TEE.buf)
    skipped_steps = _nev - kept
    _real_out.write(chr(30) + "DFTRACE" + chr(30) + _json.dumps({"v": 2, "ok": err is None, "steps": out, "vals": _VALS, "gaps": gaps, "stdout": full,
        "stdoutChars": _TEE.n, "error": err, "truncated": skipped_steps > 0 or _det is not None, "stat": stat, "counts": counts, "loops": loops,
        "exc": exc_i, "det": _det, "opt": _O, "skipped": {"events": skipped_steps, "steps": skipped_steps}}, default=str) + "\n")
class _FakeFrame:
    def __init__(self, g): self.f_locals = g

_err = None
_endv = {}
# Same namespace a plain run gets in the worker (pyodide.worker.ts): no __name__ key, so name lookups fall through to
# builtins ("builtins"), and the worker's own guard setup leaves sys and importlib imported. Matching it keeps a program
# from behaving differently when traced. (Side effect, same as a plain run: a main-guard block does not run.)
_g = {"__builtins__": __builtins__}
if _sys.platform == "emscripten": _g.update(sys=_sys, importlib=_importlib)  # only where the worker's plain run has them too
else: _g["__name__"] = "__main__"  # desktop CPython (the unit-test harness): its plain run is a __main__ script
_stat = _static(_SRC)
try:
    _code = compile(_SRC, _FN, "exec")
except SyntaxError as _e:
    _err = {"type": "SyntaxError", "msg": str(_e.msg), "line": _e.lineno}
    _code = None
if _code is not None:
    _sys.stdout = _TEE
    try:
        if _O["maxTraceMs"] > 0: _DEAD = _clock() + _O["maxTraceMs"] / 1000.0
        _sys.settrace(_glob)
        try:
            exec(_code, _g)
        finally:
            _sys.settrace(None)
    except BaseException as _e:
        _ln = None; _tb = _e.__traceback__
        while _tb is not None:
            if _tb.tb_frame.f_code.co_filename == _FN: _ln = _tb.tb_lineno
            _tb = _tb.tb_next
        _err = {"type": type(_e).__name__, "msg": _clip(str(_e), 300), "line": _ln}
    finally:
        # The program's own finalizers run now, still captured as its output (a plain run runs them at exit, after its last print).
        if _det is not None:
            try: _endv = _cv(_FakeFrame(_g))[0]
            except Exception: _endv = {}
        _g.clear()
        _sys.stdout = _real_out
_finish(_err, _endv, _stat)
`;

/** `import x` / `from x import y` lines, repeated in dead code so the worker's package loader sees pandas, numpy and friends. */
function importHints(code: string): string {
  const lines = code.split("\n").map((l) => l.trim()).filter((l) => /^(import\s+[\w.]+(\s+as\s+\w+)?(\s*,\s*[\w.]+(\s+as\s+\w+)?)*|from\s+[\w.]+\s+import\s+[\w*]+(\s+as\s+\w+)?(\s*,\s*\w+(\s+as\s+\w+)?)*)$/.test(l));
  return lines.length ? `if False:\n${lines.map((l) => `    ${l}`).join("\n")}\n` : "";
}

/**
 * The Python program sent to the worker: the tracer with the learner's source embedded as a string literal.
 * `options` is a `TraceOptions` object, or a number meaning "at most this many recorded steps" (the old second argument).
 */
export function buildTraceProgram(code: string, options?: number | Partial<TraceOptions>): string {
  const opt = JSON.stringify(JSON.stringify(resolveTraceOptions(options)));
  // One pass with a function replacer: a string replacement would treat "$&" in the learner's code as a pattern, and a second pass would rewrite placeholder names inside the code.
  const src = JSON.stringify(code);
  return importHints(code) + TRACER.replace(/__DF_(SRC|OPT)__/g, (m) => (m === "__DF_SRC__" ? src : opt));
}

interface RawGap { a: number; b: number; q0: number; q1: number; n: number; k: TraceGap["kind"]; L: { fn: string; line: number; from: number; to: number; lines: Record<string, number>; vars: [string, number, number, number][] }[] }
interface RawTrace {
  v?: number; ok: boolean; steps: RawStep[]; vals: PyVal[]; stdout: string; error?: Trace["error"] | null; truncated: boolean; stat: Trace["stat"];
  gaps?: RawGap[]; counts?: TraceCounts; loops?: LoopStat[]; exc?: number; det?: TraceDetach | null; opt?: TraceOptions; skipped?: { events: number; steps: number }; stdoutChars?: number;
}

/** Read the tracer's JSON out of the worker's stdout. Returns null when the marker is missing (the run died before the end). */
export function parseTrace(stdout: string): Trace | null {
  const at = stdout.lastIndexOf(TRACE_MARK);
  if (at < 0) return null;
  try {
    // The trace is one line; anything printed after it (a finalizer at teardown) is not part of it.
    const rest = stdout.slice(at + TRACE_MARK.length);
    const nl = rest.indexOf("\n");
    const raw = JSON.parse(nl < 0 ? rest : rest.slice(0, nl)) as RawTrace;
    const steps = decodeSteps(raw.steps);
    const t: Trace = { ok: raw.ok, vals: raw.vals, stdout: raw.stdout, error: raw.error ?? undefined, truncated: raw.truncated, stat: raw.stat, steps };
    if (raw.v) {
      t.gaps = (raw.gaps ?? []).map((g) => ({
        after: g.a, before: g.b, fromSeq: g.q0, toSeq: g.q1, skipped: g.n, kind: g.k,
        loops: g.L.map((l) => ({ fn: l.fn, line: l.line, from: l.from, to: l.to, lines: Object.fromEntries(Object.entries(l.lines).map(([k, c]) => [Number(k), c])), vars: l.vars.map(([name, first, last, changes]) => ({ name, first, last, changes })) })),
      }));
      t.checkpoints = steps.flatMap((s, i) => (s.cp ? [i] : []));
      t.options = raw.opt;
      t.skipped = raw.skipped;
      t.counts = raw.counts && { ...raw.counts, lines: Object.fromEntries(Object.entries(raw.counts.lines).map(([k, c]) => [Number(k), c])) };
      t.loops = raw.loops;
      if (raw.exc !== undefined && raw.exc >= 0) t.exceptionStep = raw.exc;
      t.detached = raw.det ?? undefined;
      t.stdoutChars = raw.stdoutChars;
      t.stdoutTruncated = raw.stdoutChars !== undefined && raw.stdoutChars > raw.stdout.length;
    }
    return t;
  } catch {
    return null;
  }
}

export type TraceRun = { trace: Trace; result: PyResult } | { trace: null; result: PyResult };

/** Trace `code` in the browser. Uses the same worker and sandbox as a normal run, with a longer time limit once Python is loaded. */
export async function traceRun(code: string, stdin = "", run: typeof runPython = runPython, options?: number | Partial<TraceOptions>): Promise<TraceRun> {
  const result = await run(buildTraceProgram(code, options), undefined, isPythonWarmed() ? TRACE_TIMEOUT_MS : FIRST_RUN_TIMEOUT_MS, stdin);
  return { trace: parseTrace(result.stdout ?? ""), result };
}

// ── Derived views (pure) ─────────────────────────────────────────────────
const top = (s: TraceStep | undefined) => s?.frames[s.frames.length - 1];

export interface VarChange { name: string; kind: "new" | "changed" | "removed"; before?: number; after?: number }

/**
 * The step `changedVars` compares step `i` with: the previous recorded step at the same stack depth, and how many traced events
 * lie between the two (0 when they are neighbours, more when the tracer skipped steps in between).
 */
export function changeBase(t: Trace, i: number): { index: number; skippedBetween: number } | null {
  const me = t.steps[i];
  if (!me) return null;
  for (let j = i - 1; j >= 0; j--) {
    const s = t.steps[j];
    if (s.frames.length < me.frames.length) return null;
    if (s.frames.length === me.frames.length) {
      const between = s.seq !== undefined && me.seq !== undefined ? me.seq - s.seq - 1 : 0;
      return { index: j, skippedBetween: Math.max(0, between) };
    }
  }
  return null;
}

/** Variables of the current function that differ from the previous recorded step in the same function activation. */
export function changedVars(t: Trace, i: number): VarChange[] {
  const cur = top(t.steps[i]);
  if (!cur) return [];
  const base = changeBase(t, i);
  const prev = base ? top(t.steps[base.index]) : undefined;
  if (!prev || prev.fn !== cur.fn) return Object.keys(cur.vars).map((name) => ({ name, kind: "new" as const, after: cur.vars[name] }));
  const out: VarChange[] = [];
  for (const [name, v] of Object.entries(cur.vars)) {
    if (!(name in prev.vars)) out.push({ name, kind: "new", after: v });
    else if (prev.vars[name] !== v) out.push({ name, kind: "changed", before: prev.vars[name], after: v });
  }
  for (const name of Object.keys(prev.vars)) if (!(name in cur.vars)) out.push({ name, kind: "removed", before: prev.vars[name] });
  return out;
}

/**
 * How many times each source line ran. With the scalable tracer these are exact counts for the whole run, skipped steps included
 * (up to the event where tracing stopped, if it did: see `t.counts.exact`). A hand-built trace counts its own steps.
 */
export function lineCounts(t: Trace): Record<number, number> {
  if (t.counts) return t.counts.lines;
  const out: Record<number, number> = {};
  for (const s of t.steps) if (s.ev === "line") out[s.line] = (out[s.line] ?? 0) + 1;
  return out;
}

export const MUTABLE_KINDS: ReadonlySet<PyVal["k"]> = new Set(["list", "set", "deque", "dict", "df", "series", "nd", "obj", "gen"]);
export const isMutable = (v: PyVal) => MUTABLE_KINDS.has(v.k);

export interface MemoryObject { id: number; val: PyVal; names: string[] }
export interface MemoryModel {
  /** Names in the current function and the object or value each refers to. */
  names: { name: string; scope: string; val: PyVal; objectId?: number }[];
  /** Objects with identity (lists, dicts, sets, objects…), with every visible name that refers to each. */
  objects: MemoryObject[];
  /** Object ids referred to by two or more names: a change through one name is seen through the others. */
  aliased: number[];
}

/**
 * Conceptual memory model at step `i`: names on the left, objects on the right, arrows between them. It is a teaching
 * model built from the trace, not a view of real memory.
 */
export function memoryAt(t: Trace, i: number): MemoryModel {
  const step = t.steps[i];
  const names: MemoryModel["names"] = [];
  const objects = new Map<number, MemoryObject>();
  if (!step) return { names, objects: [], aliased: [] };
  for (const f of step.frames) {
    for (const [name, idx] of Object.entries(f.vars)) {
      const val = t.vals[idx];
      if (!val || val.k === "func" || val.k === "class") continue;
      const objectId = val.id !== undefined && (isMutable(val) || val.k === "tuple" || val.k === "frozenset") ? val.id : undefined;
      names.push({ name, scope: f.fn, val, objectId });
      if (objectId !== undefined) {
        const o = objects.get(objectId) ?? { id: objectId, val, names: [] };
        o.names.push(f.fn === "<module>" ? name : `${f.fn}.${name}`);
        objects.set(objectId, o);
      }
    }
  }
  const list = [...objects.values()].sort((a, b) => a.id - b.id);
  return { names, objects: list, aliased: list.filter((o) => o.names.length > 1).map((o) => o.id) };
}

const fnLabel = (fn: string) => (fn === "<module>" ? "the main program" : `${fn}()`);
const num = (n: number) => n.toLocaleString("en-US");

/** One plain sentence for a step, from what really happened. */
export function describeStep(t: Trace, i: number, source: string[]): string {
  const s = t.steps[i];
  if (!s) return "";
  const f = top(s);
  const text = (source[s.line - 1] ?? "").trim();
  const val = (idx?: number) => (idx === undefined ? "" : t.vals[idx]?.r ?? "");
  switch (s.ev) {
    case "call": return `Call ${fnLabel(f?.fn ?? "")}: a new frame is pushed on the call stack${f && Object.keys(f.vars).length ? ` with ${Object.entries(f.vars).map(([n, v]) => `${n} = ${val(v)}`).join(", ")}` : ""}.`;
    case "return":
      if (f?.fn === "<module>") return "The program finished. These are the final values.";
      return `${fnLabel(f?.fn ?? "")} returns ${val(s.ret)}; its frame is popped and execution continues in the caller.`;
    case "yield": return `${fnLabel(f?.fn ?? "")} yields ${val(s.ret)} and pauses here. Its local variables are kept until the next value is requested.`;
    case "exception": return `${s.exc?.type}: ${s.exc?.msg}. Raised at line ${s.line} in ${fnLabel(f?.fn ?? "")}.`;
    case "end": return `Tracing stopped earlier${t.detached ? ` (after ${num(t.detached.atEvent)} events)` : ""}; the program then ran to its end untraced. These are its variables when it finished${t.error ? `, after ${t.error.type}` : ""}. Steps in between were not recorded.`;
    default: {
      const ch = changedVars(t, i).filter((c) => c.kind !== "removed");
      const base = changeBase(t, i);
      const since = base && base.skippedBetween > 0 ? `Since the last recorded step (${num(base.skippedBetween)} steps were skipped before this one)` : "Since the previous step";
      const before = ch.length ? ` ${since}: ${ch.map((c) => (c.kind === "new" ? `${c.name} is now ${val(c.after)}` : `${c.name} changed from ${val(c.before)} to ${val(c.after)}`)).join("; ")}.` : "";
      return `About to run line ${s.line}${text ? `: ${text}` : ""}.${before}`;
    }
  }
}

/**
 * Notes on cost. Counts come from the tracer's own counters, which see every event, recorded or not, so they are exact for the
 * whole run unless tracing stopped early (then they are lower bounds and the note says so). The growth note is a reading of the
 * code's shape (loop nesting, recursion), not a measurement and not a proof.
 */
export function costNotes(t: Trace): { measured: string[]; conceptual: string[] } {
  const counts = lineCounts(t);
  const busiest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const c = t.counts;
  const lineRuns = c ? Object.values(c.lines).reduce((a, b) => a + b, 0) : t.steps.filter((s) => s.ev === "line").length;
  const calls = c ? Object.values(c.calls).reduce((a, b) => a + b, 0) : t.steps.filter((s) => s.ev === "call").length;
  const maxDepth = c ? Math.max(0, c.maxDepth - 1) : Math.max(0, ...t.steps.map((s) => s.frames.length - 1));
  const exact = c ? c.exact : !t.truncated;
  const tag = exact ? "exact" : "at least";
  const measured: string[] = [];
  if (c) measured.push(exact ? `Counts below are exact for the whole run (${num(c.events)} traced events), including steps the trace did not record.` : `Tracing stopped after ${num(t.detached?.atEvent ?? c.events)} events, so the counts below are lower bounds: the program ran on without being counted.`);
  measured.push(`${num(lineRuns)} line executions (${tag}).`);
  if (busiest && busiest[1] > 1) measured.push(`Line ${busiest[0]} ran ${num(busiest[1])} times (${tag}), more than any other line.`);
  if (calls) measured.push(`${num(calls)} function call${calls === 1 ? "" : "s"} (${tag}); deepest call stack: ${maxDepth}.`);
  for (const l of t.loops ?? []) if (l.iterations > 1) measured.push(`Loop at line ${l.line}: ${num(l.iterations)} iteration${l.iterations === 1 ? "" : "s"} in ${num(l.entries)} run${l.entries === 1 ? "" : "s"}, the longest ${num(l.longest)}${l.approx ? " (one-line loop: may be off by one)" : ""}.`);
  if (t.skipped && t.skipped.steps > 0) measured.push(`${num(t.steps.length)} steps are recorded; ${num(t.skipped.steps)} traced events were not recorded as steps (see the gap markers). The recorded steps are real; the skipped ones are summarised, never invented.`);
  else if (t.truncated) measured.push(`The recorded steps stop at ${num(t.steps.length)}; the program ran on.`);
  const d = t.stat.loopDepth;
  const conceptual = [
    d === 0 ? "No loops in the source: outside any function calls, the work does not grow with input size." :
      d === 1 ? "One level of looping: the work grows in step with the number of items looped over (linear, O(n), if the loop body is constant work)." :
        `Loops nested ${d} deep: the work grows like the product of the loop sizes (for equal sizes n, about n^${d}).`,
    ...(t.stat.recursive.length ? [`${t.stat.recursive.join(", ")} calls itself: each pending call keeps a frame on the stack, so memory grows with the recursion depth (${maxDepth} here).`] : []),
    "These are step counts and code shape, not timings. Real speed depends on the machine and on what each line does.",
  ];
  return { measured, conceptual };
}
