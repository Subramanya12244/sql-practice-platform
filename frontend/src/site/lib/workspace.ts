/**
 * Coding-workspace helpers shared by the SQL and Python editors: saved snippets, file download, a Python tidy-up formatter and Python completion items. All stored in
 * this browser; nothing here talks to a server.
 */

// ── Storage ──────────────────────────────────────────────────────────────
const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

// ── Snippets (global per language) ───────────────────────────────────────
export interface Snippet { id: string; name: string; code: string; at: string }
const SNIP = (lang: "sql" | "python") => `sqlp.snippets.${lang}`;
export const readSnippets = (lang: "sql" | "python") => read<Snippet[]>(SNIP(lang), []);
export function saveSnippet(lang: "sql" | "python", name: string, code: string): Snippet[] {
  const s: Snippet = { id: crypto.randomUUID(), name: name.trim().slice(0, 80) || "Untitled", code: code.slice(0, 20000), at: new Date().toISOString() };
  const next = [s, ...readSnippets(lang)].slice(0, 100);
  write(SNIP(lang), next);
  return next;
}
export function deleteSnippet(lang: "sql" | "python", id: string): Snippet[] {
  const next = readSnippets(lang).filter((s) => s.id !== id);
  write(SNIP(lang), next);
  return next;
}

// ── Files ────────────────────────────────────────────────────────────────
export function downloadText(name: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const safeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "code";

// ── Python formatting ────────────────────────────────────────────────────
/**
 * Conservative tidy-up that never changes meaning. Indentation is rebuilt by block level (the way
 * Python reads it, a tab counting to the next multiple of 8), so 2-space, tab and mixed files all
 * become 4 spaces per level; lines inside brackets keep their offset from the statement they
 * continue; trailing whitespace goes; top-level def/class get two blank lines before them (one
 * for methods, none after a decorator); runs of blank lines collapse to two. Text inside
 * triple-quoted strings is never touched. Returns null if the indentation is inconsistent.
 */
export function formatPython(src: string): string | null {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const width = (ws: string) => { let w = 0; for (const ch of ws) w = ch === "\t" ? (Math.floor(w / 8) + 1) * 8 : w + 1; return w; };
  const out: string[] = [];
  const stack = [0]; // indentation widths of the open blocks
  let triple: string | null = null, depth = 0, contBase = 0, contNew = 0;
  for (const raw of lines) {
    if (triple !== null) out.push(raw);
    else {
      const body = raw.replace(/\s+$/, "");
      if (!body.trim()) { out.push(""); continue; }
      const ws = body.match(/^[ \t]*/)![0], w = width(ws), text = body.slice(ws.length);
      if (depth > 0) {
        out.push(" ".repeat(Math.max(0, contNew + (w - contBase))) + text); // continuation inside brackets
      } else {
        if (w > stack[stack.length - 1]) stack.push(w);
        else { while (w < stack[stack.length - 1]) stack.pop(); if (w !== stack[stack.length - 1]) return null; }
        const ind = " ".repeat(4 * (stack.length - 1));
        contBase = w; contNew = ind.length;
        if (/^(async\s+def|def|class)\s/.test(text) || text.startsWith("@")) {
          // A decorator owns the blank lines, and the first statement of a block follows its header directly.
          const prev = [...out].reverse().find((x) => x.trim());
          if (!(prev && (/^\s*@/.test(prev) || /:\s*(#.*)?$/.test(prev)))) {
            while (out.length && !out[out.length - 1].trim()) out.pop();
            if (out.length) out.push(...Array(stack.length === 1 ? 2 : 1).fill(""));
          }
        }
        out.push(ind + text);
      }
    }
    // Track brackets and triple-quoted strings; single-line strings and comments are skipped.
    for (const m of raw.replace(/#.*$/, "").matchAll(/'''|"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[()[\]{}]/g)) {
      const t = m[0];
      if (t === "'''" || t === '"""') triple = triple === null ? t : triple === t ? null : triple;
      else if (triple === null && t.length === 1) depth = Math.max(0, depth + ("([{".includes(t) ? 1 : -1));
    }
  }
  return out.join("\n").replace(/\n{4,}/g, "\n\n\n").replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
}

// ── Python completions ───────────────────────────────────────────────────
export const PY_KEYWORDS = "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield".split(" ");
export const PY_BUILTINS = "abs all any bool dict enumerate filter float frozenset getattr hasattr isinstance int iter len list map max min next open print range repr reversed round set setattr sorted str sum tuple type zip ValueError TypeError KeyError IndexError Exception StopIteration RuntimeError".split(" ");
/** Members of standard-library modules the problems use (static list, no introspection). */
export const PY_MODULES: Record<string, string[]> = {
  json: ["loads", "dumps", "load", "dump", "JSONDecodeError"],
  csv: ["reader", "writer", "DictReader", "DictWriter", "QUOTE_MINIMAL"],
  re: ["match", "search", "findall", "finditer", "sub", "split", "compile", "fullmatch", "IGNORECASE"],
  datetime: ["datetime", "date", "timedelta", "timezone"],
  collections: ["Counter", "defaultdict", "deque", "OrderedDict", "namedtuple"],
  itertools: ["islice", "groupby", "chain", "count", "accumulate", "tee", "product", "zip_longest"],
  functools: ["reduce", "partial", "wraps", "lru_cache", "cache"],
  heapq: ["heappush", "heappop", "heapify", "nlargest", "nsmallest", "merge"],
  math: ["ceil", "floor", "sqrt", "isclose", "inf", "fsum"],
  statistics: ["mean", "median", "stdev", "pstdev", "mode"],
  os: ["path", "replace", "remove", "listdir", "makedirs", "environ"],
  io: ["StringIO", "BytesIO"],
  logging: ["getLogger", "basicConfig", "INFO", "WARNING", "ERROR", "DEBUG"],
  hashlib: ["sha256", "md5"],
  bisect: ["bisect_left", "bisect_right", "insort"],
  contextlib: ["contextmanager", "suppress"],
  dataclasses: ["dataclass", "field", "asdict"],
  typing: ["Iterator", "Iterable", "Optional", "Any", "Callable"],
};
/** Names defined in the code itself: functions, classes, assigned variables, parameters, imports. */
export function pyLocalNames(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm)) {
    names.add(m[1]);
    for (const p of m[2].split(",")) { const n = p.trim().replace(/^\*+/, "").split(/[:=\s]/)[0]; if (/^[A-Za-z_]\w*$/.test(n) && n !== "self") names.add(n); }
  }
  for (const m of src.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=[^=]/gm)) for (const n of m[1].split(",")) names.add(n.trim());
  for (const m of src.matchAll(/\bfor\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\b/g)) for (const n of m[1].split(",")) names.add(n.trim());
  for (const m of src.matchAll(/^\s*(?:from\s+[\w.]+\s+)?import\s+(.+)$/gm)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop()!.trim(); if (/^[A-Za-z_]\w*$/.test(n)) names.add(n); }
  return [...names].filter((n) => !PY_KEYWORDS.includes(n));
}
