/**
 * Git Lab engine: an in-memory simulation of Git's data model. It never touches a real repository, disk or network.
 *
 * What is modelled: commits (parents, message, a snapshot of every file), refs (branches, HEAD, detached HEAD, tags, ORIG_HEAD),
 * the three areas (working tree, staging area/index, repository), line-level three-way merge with conflict markers, merge-base,
 * rebase (replaying commits), reset, revert, cherry-pick and a basic stash. What is NOT modelled is listed in `NOT_IMPLEMENTED`.
 *
 * Object ids: blob, tree and commit ids are the real SHA-1 of Git's real object format (`<type> <size>\0<body>`, trees with
 * mode, name and raw 20-byte ids, nested directories). A blob id therefore equals `git hash-object` for the same text. Commits
 * use a fixed identity (`You <you@example.com>`) and a logical clock as the time (1700000000 + 60 * tick seconds), so every id
 * is deterministic and will NOT match the ids in any real repository, whose commits carry real names and times.
 *
 * Text rules: every file is a list of lines and ends with a newline (a file without a final newline is not modelled).
 */
export type Files = Record<string, string>;

// ── SHA-1 and Git object ids ─────────────────────────────────────────────

const enc = new TextEncoder();
const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

function sha1Bytes(data: Uint8Array): string {
  const ml = data.length;
  const total = (((ml + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(ml / 0x20000000));
  dv.setUint32(total - 4, (ml << 3) >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** SHA-1 of a string (UTF-8) as 40 hex characters. Exported so tests can check it against known vectors. */
export const sha1 = (s: string) => sha1Bytes(enc.encode(s));

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
const hashObject = (type: string, body: Uint8Array) => sha1Bytes(concat([enc.encode(`${type} ${body.length}\0`), body]));

/** The id Git gives a file with this text (equals `git hash-object`). */
export const blobId = (content: string) => hashObject("blob", enc.encode(content));

/** Id of a tree object built from a flat path→text map, with nested directories, as Git does. */
export function treeId(files: Files): string {
  const entries = new Map<string, { dir: boolean; id: string }>();
  const subdirs = new Map<string, Files>();
  for (const [p, c] of Object.entries(files)) {
    const i = p.indexOf("/");
    if (i < 0) entries.set(p, { dir: false, id: blobId(c) });
    else {
      const d = p.slice(0, i);
      if (!subdirs.has(d)) subdirs.set(d, {});
      subdirs.get(d)![p.slice(i + 1)] = c;
    }
  }
  for (const [d, sub] of subdirs) entries.set(d, { dir: true, id: treeId(sub) });
  // Git orders tree entries bytewise, comparing a directory as if its name ended with "/".
  const names = [...entries.keys()].sort((a, b) => { const ka = a + (entries.get(a)!.dir ? "/" : ""), kb = b + (entries.get(b)!.dir ? "/" : ""); return ka < kb ? -1 : ka > kb ? 1 : 0; });
  return hashObject("tree", concat(names.flatMap((n) => { const e = entries.get(n)!; return [enc.encode(`${e.dir ? "40000" : "100644"} ${n}\0`), hexToBytes(e.id)]; })));
}

const IDENT = "You <you@example.com>";
const EPOCH = 1_700_000_000;
const tickSeconds = (tick: number) => EPOCH + tick * 60;

/** The text Git hashes for a commit with this tree, parents, logical tick and message. */
export function commitText(tree: string, parents: string[], tick: number, message: string): string {
  const ts = tickSeconds(tick);
  return `tree ${tree}\n${parents.map((p) => `parent ${p}\n`).join("")}author ${IDENT} ${ts} +0000\ncommitter ${IDENT} ${ts} +0000\n\n${message.endsWith("\n") ? message : `${message}\n`}`;
}
const commitIdOf = (text: string) => hashObject("commit", enc.encode(text));

// ── Text helpers: lines, LCS, diff, three-way merge ──────────────────────

export const toLines = (s: string): string[] => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));
export const fromLines = (l: string[]): string => (l.length ? `${l.join("\n")}\n` : "");
/** Every file in the lab ends with a newline (or is empty). */
export const normalise = (s: string) => fromLines(toLines(s));

/** Longest common subsequence as [indexInA, indexInB] pairs. A shared prefix and suffix are matched first, as diff tools do. */
export function lcsPairs(a: string[], b: string[]): [number, number][] {
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length, eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const pairs: [number, number][] = [];
  for (let i = 0; i < lo; i++) pairs.push([i, i]);
  const n = ea - lo, m = eb - lo;
  if (n > 0 && m > 0) {
    const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[lo + i] === b[lo + j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[lo + i] === b[lo + j]) { pairs.push([lo + i, lo + j]); i++; j++; }
      else if (t[i + 1][j] >= t[i][j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < a.length - ea; k++) pairs.push([ea + k, eb + k]);
  return pairs;
}

export interface DiffOp { t: " " | "-" | "+"; s: string }
export function diffOps(a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  for (const [pi, pj] of lcsPairs(a, b)) {
    while (i < pi) ops.push({ t: "-", s: a[i++] });
    while (j < pj) ops.push({ t: "+", s: b[j++] });
    ops.push({ t: " ", s: a[i] }); i++; j++;
  }
  while (i < a.length) ops.push({ t: "-", s: a[i++] });
  while (j < b.length) ops.push({ t: "+", s: b[j++] });
  return ops;
}

const countOps = (ops: DiffOp[]) => ({ ins: ops.filter((o) => o.t === "+").length, del: ops.filter((o) => o.t === "-").length });
const short = (id: string) => id.slice(0, 7);
const blob7 = (c: string | undefined) => (c === undefined ? "0000000" : short(blobId(c)));

/** Unified diff of one file. `undefined` means the file does not exist on that side. */
export function unifiedDiff(path: string, oldText: string | undefined, newText: string | undefined, context = 3): string[] {
  const out = [`diff --git a/${path} b/${path}`];
  if (oldText === undefined) out.push("new file mode 100644");
  if (newText === undefined) out.push("deleted file mode 100644");
  out.push(`index ${blob7(oldText)}..${blob7(newText)}${oldText !== undefined && newText !== undefined ? " 100644" : ""}`);
  out.push(oldText === undefined ? "--- /dev/null" : `--- a/${path}`, newText === undefined ? "+++ /dev/null" : `+++ b/${path}`);
  const ops = diffOps(toLines(oldText ?? ""), toLines(newText ?? ""));
  const changed = ops.map((o, i) => (o.t === " " ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return out;
  // Group changes whose gaps are small enough that their context overlaps into one hunk.
  const groups: [number, number][] = [];
  for (const i of changed) {
    const last = groups[groups.length - 1];
    if (last && i - last[1] <= context * 2 + 1) last[1] = i; else groups.push([i, i]);
  }
  for (const [first, last] of groups) {
    const from = Math.max(0, first - context), to = Math.min(ops.length - 1, last + context);
    const slice = ops.slice(from, to + 1);
    const oldBefore = ops.slice(0, from).filter((o) => o.t !== "+").length, newBefore = ops.slice(0, from).filter((o) => o.t !== "-").length;
    const oldN = slice.filter((o) => o.t !== "+").length, newN = slice.filter((o) => o.t !== "-").length;
    const rng = (start: number, n: number) => `${n === 0 ? start : start + 1}${n === 1 ? "" : `,${n}`}`;
    out.push(`@@ -${rng(oldBefore, oldN)} +${rng(newBefore, newN)} @@`);
    for (const o of slice) out.push(`${o.t}${o.s}`);
  }
  return out;
}

export interface Merge3 { text: string; conflicts: number }
const sameLines = (x: string[], y: string[]) => x.length === y.length && x.every((l, i) => l === y[i]);

/**
 * Line-level three-way merge (diff3). Base lines that both sides kept form fixed anchors; between two anchors each side either
 * left the base alone or changed it. Both changed differently is a conflict. Changes on adjacent lines (no kept line between
 * them) conflict, as in Git. A conflict is narrowed by moving lines both sides share at its start or end outside the markers.
 */
export function merge3(baseText: string, oursText: string, theirsText: string, ourLabel: string, theirLabel: string): Merge3 {
  const base = toLines(baseText), ours = toLines(oursText), theirs = toLines(theirsText);
  const mo = new Array<number>(base.length).fill(-1), mt = new Array<number>(base.length).fill(-1);
  for (const [i, j] of lcsPairs(base, ours)) mo[i] = j;
  for (const [i, j] of lcsPairs(base, theirs)) mt[i] = j;
  const out: string[] = [];
  let conflicts = 0;
  const chunk = (b: string[], o: string[], t: string[]) => {
    if (sameLines(o, t)) out.push(...o);
    else if (sameLines(o, b)) out.push(...t);
    else if (sameLines(t, b)) out.push(...o);
    else {
      let p = 0;
      while (p < o.length && p < t.length && o[p] === t[p]) p++;
      let s = 0;
      while (s < o.length - p && s < t.length - p && o[o.length - 1 - s] === t[t.length - 1 - s]) s++;
      out.push(...o.slice(0, p), `<<<<<<< ${ourLabel}`, ...o.slice(p, o.length - s), "=======", ...t.slice(p, t.length - s), `>>>>>>> ${theirLabel}`, ...o.slice(o.length - s));
      conflicts++;
    }
  };
  let bi = 0, oi = 0, ti = 0;
  for (let i = 0; i < base.length; i++) {
    if (mo[i] < 0 || mt[i] < 0) continue;
    chunk(base.slice(bi, i), ours.slice(oi, mo[i]), theirs.slice(ti, mt[i]));
    out.push(base[i]);
    bi = i + 1; oi = mo[i] + 1; ti = mt[i] + 1;
  }
  chunk(base.slice(bi), ours.slice(oi), theirs.slice(ti));
  return { text: fromLines(out), conflicts };
}

export interface PathConflict { path: string; kind: "content" | "modify/delete" | "add/add" }
export interface TreeMerge { tree: Files; conflicts: PathConflict[]; log: string[] }

/** Merge three snapshots path by path. Conflicted files keep their markers in `tree`. `log` is what Git prints while merging. */
export function mergeTrees(base: Files, ours: Files, theirs: Files, labels: { ours: string; theirs: string }): TreeMerge {
  const tree: Files = {}, conflicts: PathConflict[] = [], log: string[] = [];
  const paths = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort();
  const put = (p: string, v: string | undefined) => { if (v !== undefined) tree[p] = v; };
  for (const p of paths) {
    const b = base[p], o = ours[p], t = theirs[p];
    if (o === t) put(p, o);
    else if (o === b) put(p, t);
    else if (t === b) put(p, o);
    else if (o === undefined || t === undefined) {
      const gone = o === undefined ? labels.ours : labels.theirs, kept = o === undefined ? labels.theirs : labels.ours;
      put(p, o ?? t);
      conflicts.push({ path: p, kind: "modify/delete" });
      log.push(`CONFLICT (modify/delete): ${p} deleted in ${gone} and modified in ${kept}.  Version ${kept} of ${p} left in tree.`);
    } else {
      const m = merge3(b ?? "", o, t, labels.ours, labels.theirs);
      if (b !== undefined) log.push(`Auto-merging ${p}`);
      put(p, m.text);
      if (m.conflicts) {
        const kind = b === undefined ? "add/add" : "content";
        conflicts.push({ path: p, kind });
        log.push(`CONFLICT (${kind}): Merge conflict in ${p}`);
      }
    }
  }
  return { tree, conflicts, log };
}

// ── Conflict markers: parse, validate, resolve ───────────────────────────

export type ConflictSegment =
  | { kind: "text"; lines: string[] }
  | { kind: "conflict"; index: number; ours: string[]; theirs: string[]; oursLabel: string; theirsLabel: string };

const START = /^<{7}(?: (.*))?$/, MID = /^={7}$/, END = /^>{7}(?: (.*))?$/;

export function parseConflicts(content: string): ConflictSegment[] {
  const segs: ConflictSegment[] = [];
  let text: string[] = [];
  const lines = toLines(content);
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = START.exec(lines[i]);
    if (!m) { text.push(lines[i]); continue; }
    let j = i + 1;
    const ours: string[] = [], theirs: string[] = [];
    while (j < lines.length && !MID.test(lines[j])) ours.push(lines[j++]);
    j++;
    let e: RegExpExecArray | null = null;
    while (j < lines.length && !(e = END.exec(lines[j]))) theirs.push(lines[j++]);
    if (j >= lines.length) { text.push(...lines.slice(i)); break; } // an unterminated block is left as plain text; validation still flags it
    if (text.length) segs.push({ kind: "text", lines: text });
    text = [];
    segs.push({ kind: "conflict", index: n++, ours, theirs, oursLabel: m[1] ?? "", theirsLabel: e?.[1] ?? "" });
    i = j;
  }
  if (text.length) segs.push({ kind: "text", lines: text });
  return segs;
}

export interface MarkerProblem { line: number; text: string }
/** Lines (1-based) that still look like conflict markers. A file with none is ready to be staged. */
export function markerProblems(content: string): MarkerProblem[] {
  return toLines(content).flatMap((l, i) => (START.test(l) || MID.test(l) || END.test(l) ? [{ line: i + 1, text: l }] : []));
}
export const hasMarkers = (content: string) => markerProblems(content).length > 0;

export type Choice = "ours" | "theirs" | "both";
/** Replace conflict block number `block` (0-based) with one side, or both (ours first). Other blocks are left as they are. */
export function resolveBlock(content: string, block: number, choice: Choice): string {
  const out: string[] = [];
  for (const s of parseConflicts(content)) {
    if (s.kind === "text") out.push(...s.lines);
    else if (s.index !== block) out.push(`<<<<<<< ${s.oursLabel}`.trimEnd(), ...s.ours, "=======", ...s.theirs, `>>>>>>> ${s.theirsLabel}`.trimEnd());
    else out.push(...(choice === "theirs" ? [] : s.ours), ...(choice === "ours" ? [] : s.theirs));
  }
  return fromLines(out);
}
export function resolveAll(content: string, choice: Choice): string {
  let c = content;
  for (let n = parseConflicts(c).filter((s) => s.kind === "conflict").length; n > 0; n--) c = resolveBlock(c, 0, choice);
  return c;
}

// ── Repository model ─────────────────────────────────────────────────────

export interface Commit { id: string; parents: string[]; message: string; tree: Files; treeId: string; tick: number }
export type Head = { kind: "branch"; name: string } | { kind: "detached"; id: string };

export type PendingOp =
  | { kind: "merge"; theirs: string; theirsName: string; message: string; unmerged: string[] }
  | { kind: "rebase"; branch: string; origHead: string; onto: string; todo: string[]; current: string; done: number; total: number; unmerged: string[] }
  | { kind: "cherry-pick"; commit: string; message: string; unmerged: string[] }
  | { kind: "revert"; commit: string; message: string; unmerged: string[] };

export interface StashEntry { message: string; base: string; index: Files; work: Files }

export interface Repo {
  initialized: boolean;
  commits: Record<string, Commit>;
  branches: Record<string, string>;
  tags: Record<string, string>;
  head: Head;
  work: Files;
  index: Files;
  stash: StashEntry[];
  op: PendingOp | null;
  /** Where HEAD was before the last merge, rebase or reset (`git reset --hard ORIG_HEAD` undoes it). */
  origHead: string | null;
  clock: number;
}

export const DEFAULT_BRANCH = "main";
export const emptyRepo = (): Repo => ({ initialized: false, commits: {}, branches: {}, tags: {}, head: { kind: "branch", name: DEFAULT_BRANCH }, work: {}, index: {}, stash: [], op: null, origHead: null, clock: 0 });

/** Commits are immutable so they are shared between copies; everything else is copied. */
export function cloneRepo(r: Repo): Repo {
  return { ...r, commits: { ...r.commits }, branches: { ...r.branches }, tags: { ...r.tags }, head: { ...r.head }, work: { ...r.work }, index: { ...r.index }, stash: r.stash.map((s) => ({ ...s, index: { ...s.index }, work: { ...s.work } })), op: r.op ? JSON.parse(JSON.stringify(r.op)) : null };
}

export const shortId = short;
export const subject = (c: Commit) => c.message.split("\n")[0];
export const headId = (r: Repo): string | null => (r.head.kind === "detached" ? r.head.id : r.branches[r.head.name] ?? null);
export const currentBranch = (r: Repo): string | null => (r.head.kind === "branch" ? r.head.name : null);
const headTree = (r: Repo): Files => { const id = headId(r); return id ? r.commits[id].tree : {}; };
const headLabel = (r: Repo) => (r.head.kind === "branch" ? r.head.name : "detached HEAD");

export class GitError extends Error {}
const fail = (msg: string): never => { throw new GitError(msg); };

/** All commits reachable from `id`, including itself. */
export function ancestors(r: Repo, id: string): Set<string> {
  const seen = new Set<string>(), stack = [id];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...r.commits[c].parents);
  }
  return seen;
}
/** True when `a` is `b` or an ancestor of `b`. */
export const isAncestor = (r: Repo, a: string, b: string) => ancestors(r, b).has(a);

/** Best common ancestors of a and b: common ancestors that are not ancestors of another common ancestor. Usually exactly one. */
export function mergeBases(r: Repo, a: string, b: string): string[] {
  const sa = ancestors(r, a), sb = ancestors(r, b);
  const common = [...sa].filter((c) => sb.has(c));
  const best = common.filter((c) => !common.some((d) => d !== c && isAncestor(r, c, d)));
  return best.sort((x, y) => r.commits[y].tick - r.commits[x].tick);
}
/** One merge base (the newest). Git's default strategy would merge several bases into a virtual one; the lab picks one. */
export const mergeBase = (r: Repo, a: string, b: string): string | null => mergeBases(r, a, b)[0] ?? null;

/** Newest first, every commit before its parents, ties broken by creation order (a logical clock). */
export function topoOrder(r: Repo, tips: string[]): string[] {
  const reach = new Set<string>();
  for (const t of tips) for (const c of ancestors(r, t)) reach.add(c);
  const pending = new Map<string, number>();
  for (const c of reach) pending.set(c, 0);
  for (const c of reach) for (const p of new Set(r.commits[c].parents)) pending.set(p, (pending.get(p) ?? 0) + 1);
  const ready = [...reach].filter((c) => pending.get(c) === 0);
  const out: string[] = [];
  while (ready.length) {
    ready.sort((x, y) => r.commits[x].tick - r.commits[y].tick || (x < y ? -1 : 1));
    const c = ready.pop()!;
    out.push(c);
    for (const p of new Set(r.commits[c].parents)) { pending.set(p, pending.get(p)! - 1); if (pending.get(p) === 0) ready.push(p); }
  }
  return out;
}

/** Resolve HEAD, a branch, a tag, an id prefix (4+ hex digits), ORIG_HEAD, with ~n, ^ and ^n suffixes. Null when unknown. */
export function resolveRev(r: Repo, spec: string): string | null {
  const m = /^([^~^]+)((?:[~^]\d*)*)$/.exec(spec);
  if (!m) return null;
  const name = m[1];
  let id: string | null = null;
  if (name === "HEAD" || name === "@") id = headId(r);
  else if (name === "ORIG_HEAD") id = r.origHead;
  else if (r.branches[name]) id = r.branches[name];
  else if (r.tags[name]) id = r.tags[name];
  else if (/^[0-9a-f]{4,40}$/.test(name)) {
    const hits = Object.keys(r.commits).filter((c) => c.startsWith(name));
    id = hits.length === 1 ? hits[0] : null;
  }
  if (!id) return null;
  let cur: string = id;
  for (const step of m[2].match(/[~^]\d*/g) ?? []) {
    const n = step.length > 1 ? Number(step.slice(1)) : 1;
    const parents: string[] = r.commits[cur].parents;
    if (step[0] === "~") { for (let k = 0; k < n; k++) { const p: string | undefined = r.commits[cur].parents[0]; if (!p) return null; cur = p; } }
    else { if (n === 0) continue; const p: string | undefined = parents[n - 1]; if (!p) return null; cur = p; }
  }
  return cur;
}

const needRepo = (r: Repo) => { if (!r.initialized) fail("fatal: not a git repository (or any of the parent directories): .git"); };
function needRev(r: Repo, spec: string): string {
  const id = resolveRev(r, spec);
  if (!id) fail(`fatal: ambiguous argument '${spec}': unknown revision or path not in the working tree.`);
  return id!;
}

function makeCommit(r: Repo, tree: Files, parents: string[], message: string): Commit {
  r.clock += 1;
  const tId = treeId(tree);
  const id = commitIdOf(commitText(tId, parents, r.clock, message));
  const c: Commit = { id, parents, message: message.replace(/\n+$/, ""), tree: { ...tree }, treeId: tId, tick: r.clock };
  r.commits[id] = c;
  return c;
}
function moveHead(r: Repo, id: string) {
  if (r.head.kind === "branch") r.branches[r.head.name] = id; else r.head = { kind: "detached", id };
}

/** Decorations per commit id: "HEAD -> main", other branches, "tag: v1". */
export function refLabels(r: Repo): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (id: string | undefined, l: string) => { if (id) (out[id] ??= []).push(l); };
  const cur = currentBranch(r);
  if (r.head.kind === "detached") add(r.head.id, "HEAD");
  else if (cur && r.branches[cur]) add(r.branches[cur], `HEAD -> ${cur}`);
  for (const b of Object.keys(r.branches).sort()) if (b !== cur) add(r.branches[b], b);
  for (const t of Object.keys(r.tags).sort()) add(r.tags[t], `tag: ${t}`);
  return out;
}

// ── Three areas ──────────────────────────────────────────────────────────

export type AreaState = "same" | "new" | "modified" | "deleted";
export interface AreaRow {
  path: string;
  work?: string; index?: string; head?: string;
  /** Short blob ids (the first 7 characters of the real blob id of the text). */
  workId?: string; indexId?: string; headId?: string;
  /** Working tree compared with the index (what `git add` would stage). */
  unstaged: AreaState;
  /** Index compared with HEAD (what `git commit` would record). */
  staged: AreaState;
  untracked: boolean;
  unmerged: boolean;
}
const cmp = (to: string | undefined, from: string | undefined): AreaState => (to === from ? "same" : from === undefined ? "new" : to === undefined ? "deleted" : "modified");

export function areaRows(r: Repo): AreaRow[] {
  const h = headTree(r), unmerged = new Set(r.op?.unmerged ?? []);
  const paths = [...new Set([...Object.keys(r.work), ...Object.keys(r.index), ...Object.keys(h)])].sort();
  return paths.map((p) => {
    const w = r.work[p], i = r.index[p], hd = h[p];
    return {
      path: p, work: w, index: i, head: hd,
      workId: w === undefined ? undefined : short(blobId(w)), indexId: i === undefined ? undefined : short(blobId(i)), headId: hd === undefined ? undefined : short(blobId(hd)),
      unstaged: i === undefined ? "same" : cmp(w, i), staged: cmp(i, hd), untracked: i === undefined && w !== undefined, unmerged: unmerged.has(p),
    };
  });
}

export interface Change { path: string; kind: "new file" | "modified" | "deleted" }
const kindOf = (s: AreaState): Change["kind"] | null => (s === "new" ? "new file" : s === "modified" ? "modified" : s === "deleted" ? "deleted" : null);
const changesBetween = (from: Files, to: Files): Change[] =>
  [...new Set([...Object.keys(from), ...Object.keys(to)])].sort().flatMap((p) => { const k = kindOf(cmp(to[p], from[p])); return k ? [{ path: p, kind: k }] : []; });

/** Staged changes (HEAD to index), unstaged changes (index to working tree), untracked paths and unmerged paths. */
export function statusParts(r: Repo) {
  const unmerged = new Set(r.op?.unmerged ?? []);
  const staged = changesBetween(headTree(r), r.index).filter((c) => !unmerged.has(c.path));
  const unstagedAll: Change[] = Object.keys(r.index).sort().flatMap((p) => { const k = kindOf(cmp(r.work[p], r.index[p])); return k ? [{ path: p, kind: k === "new file" ? "modified" as const : k }] : []; });
  const unstaged = unstagedAll.filter((c) => !unmerged.has(c.path));
  const untracked = Object.keys(r.work).filter((p) => r.index[p] === undefined).sort();
  // Git shows a wholly untracked directory as one entry ("dir/").
  const folded = [...new Set(untracked.map((p) => { const i = p.indexOf("/"); return i > 0 && !Object.keys(r.index).some((q) => q.startsWith(`${p.slice(0, i)}/`)) ? `${p.slice(0, i)}/` : p; }))];
  return { staged, unstaged, untracked: folded, unmerged: [...unmerged].sort() };
}

export const isClean = (r: Repo) => { const s = statusParts(r); return !s.staged.length && !s.unstaged.length && !s.unmerged.length; };

function statusLong(r: Repo): string {
  const s = statusParts(r), out: string[] = [];
  const hid = headId(r);
  out.push(r.head.kind === "branch" ? `On branch ${r.head.name}` : `HEAD detached at ${short(r.head.id)}`);
  const op = r.op;
  if (op?.kind === "rebase") out.push(`rebase in progress; onto ${short(op.onto)}`, `You are currently rebasing branch '${op.branch}' on '${short(op.onto)}'.`, '  (fix conflicts and then run "git rebase --continue")', '  (use "git rebase --skip" to skip this patch)', '  (use "git rebase --abort" to check out the original branch)', "");
  else if (op?.kind === "merge") out.push(s.unmerged.length ? "You have unmerged paths." : "All conflicts fixed but you are still merging.", s.unmerged.length ? '  (fix conflicts and run "git commit")' : '  (use "git commit" to conclude merge)', '  (use "git merge --abort" to abort the merge)', "");
  else if (op) out.push(`You are currently ${op.kind === "revert" ? "reverting" : "cherry-picking"} commit ${short(op.commit)}.`, s.unmerged.length ? `  (fix conflicts and run "git ${op.kind} --continue")` : `  (all conflicts fixed: run "git ${op.kind} --continue")`, `  (use "git ${op.kind} --abort" to cancel the ${op.kind} operation)`, "");
  if (!hid && r.head.kind === "branch") out.push("", "No commits yet");
  out.push("");
  const section = (title: string, hints: string[], lines: string[]) => { out.push(title, ...hints.map((h) => `  (${h})`), ...lines.map((l) => `\t${l}`), ""); };
  if (s.staged.length) section("Changes to be committed:", [hid ? 'use "git restore --staged <file>..." to unstage' : 'use "git rm --cached <file>..." to unstage'], s.staged.map((c) => `${`${c.kind}:`.padEnd(12)}${c.path}`));
  if (s.unmerged.length) section("Unmerged paths:", ['use "git add <file>..." to mark resolution'], s.unmerged.map((p) => `${"both modified:".padEnd(17)}${p}`));
  if (s.unstaged.length) section("Changes not staged for commit:", ['use "git add <file>..." to update what will be committed', 'use "git restore <file>..." to discard changes in working directory'], s.unstaged.map((c) => `${`${c.kind}:`.padEnd(12)}${c.path}`));
  if (s.untracked.length) section("Untracked files:", ['use "git add <file>..." to include in what will be committed'], s.untracked);
  const dirty = s.staged.length || s.unstaged.length || s.unmerged.length;
  if (!dirty && !s.untracked.length) out.push(hid ? "nothing to commit, working tree clean" : "nothing to commit (create/copy files and use \"git add\" to track)");
  else if (!s.staged.length && !s.unmerged.length) out.push(s.unstaged.length ? 'no changes added to commit (use "git add" and/or "git commit -a")' : 'nothing added to commit but untracked files present (use "git add" to track)');
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
}

function statusShort(r: Repo): string {
  const unmerged = new Set(r.op?.unmerged ?? []);
  const h = headTree(r);
  const code = (s: AreaState) => (s === "new" ? "A" : s === "modified" ? "M" : s === "deleted" ? "D" : " ");
  const lines: string[] = [];
  for (const p of [...new Set([...Object.keys(r.index), ...Object.keys(h)])].sort()) {
    if (unmerged.has(p)) { lines.push(`UU ${p}`); continue; }
    const x = code(cmp(r.index[p], h[p])), y = r.index[p] === undefined ? " " : code(cmp(r.work[p], r.index[p])).replace("A", "M");
    if (x !== " " || y !== " ") lines.push(`${x}${y} ${p}`);
  }
  for (const p of statusParts(r).untracked) lines.push(`?? ${p}`);
  return lines.join("\n");
}

// ── Diff output helpers ──────────────────────────────────────────────────

export interface StatFile { path: string; ins: number; del: number; status: "new" | "deleted" | "modified" }
export function diffStat(from: Files, to: Files): StatFile[] {
  return [...new Set([...Object.keys(from), ...Object.keys(to)])].sort().flatMap((p) => {
    if (from[p] === to[p]) return [];
    const { ins, del } = countOps(diffOps(toLines(from[p] ?? ""), toLines(to[p] ?? "")));
    return [{ path: p, ins, del, status: from[p] === undefined ? "new" as const : to[p] === undefined ? "deleted" as const : "modified" as const }];
  });
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
function statSummary(files: StatFile[]): string {
  const ins = files.reduce((n, f) => n + f.ins, 0), del = files.reduce((n, f) => n + f.del, 0);
  return ` ${plural(files.length, "file")} changed${ins ? `, ${plural(ins, "insertion")}(+)` : ""}${del ? `, ${plural(del, "deletion")}(-)` : ""}`;
}
function statLines(files: StatFile[], withBars: boolean): string[] {
  if (!files.length) return [];
  const out: string[] = [];
  if (withBars) {
    const w = Math.max(...files.map((f) => f.path.length)), dig = String(Math.max(...files.map((f) => f.ins + f.del))).length;
    for (const f of files) out.push(` ${f.path.padEnd(w)} | ${String(f.ins + f.del).padStart(dig)} ${"+".repeat(Math.min(f.ins, 40))}${"-".repeat(Math.min(f.del, 40))}`.trimEnd());
  }
  out.push(statSummary(files));
  for (const f of files) if (f.status !== "modified") out.push(` ${f.status === "new" ? "create" : "delete"} mode 100644 ${f.path}`);
  return out;
}

function diffText(from: Files, to: Files, only?: string[]): string {
  const out: string[] = [];
  for (const p of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
    if (only?.length && !only.some((o) => p === o || p.startsWith(`${o.replace(/\/$/, "")}/`) || o === ".")) continue;
    if (from[p] !== to[p]) out.push(...unifiedDiff(p, from[p], to[p]));
  }
  return out.join("\n");
}

// ── Safety checks before touching files ──────────────────────────────────

/** Paths whose files would be overwritten by moving the checkout from `from` to `to`; split into local changes and untracked files. */
function overwriteRisks(r: Repo, from: Files, to: Files) {
  const local: string[] = [], untracked: string[] = [];
  for (const p of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
    if (from[p] === to[p]) continue;
    const idx = r.index[p], wk = r.work[p], tracked = idx !== undefined;
    if (!tracked && from[p] === undefined) { if (wk !== undefined && to[p] !== undefined && wk !== to[p]) untracked.push(p); continue; }
    // Tracked: any difference between index and HEAD, or between working tree and index, is a local change.
    const dirty = idx !== from[p] || (tracked && wk !== idx);
    if (dirty && !(wk === to[p] && idx === to[p])) local.push(p);
  }
  return { local, untracked };
}
function guardOverwrite(r: Repo, from: Files, to: Files, verb: string) {
  const { local, untracked } = overwriteRisks(r, from, to);
  if (local.length) fail(`error: Your local changes to the following files would be overwritten by ${verb}:\n${local.map((p) => `\t${p}`).join("\n")}\n${verb === "merge" ? "Please commit your changes or stash them before you merge." : `Please commit your changes or stash them before you ${verb === "checkout" ? "switch branches" : verb}.`}\nAborting`);
  if (untracked.length) fail(`error: The following untracked working tree files would be overwritten by ${verb}:\n${untracked.map((p) => `\t${p}`).join("\n")}\nPlease move or remove them before you ${verb === "checkout" ? "switch branches" : verb}.\nAborting`);
}
/** Make the working tree and index match `to` for every path that differs from `from`; other files (untracked, unrelated edits) stay. */
function checkoutTree(r: Repo, from: Files, to: Files) {
  for (const p of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (from[p] === to[p]) continue;
    if (to[p] === undefined) { delete r.work[p]; delete r.index[p]; } else { r.work[p] = to[p]; r.index[p] = to[p]; }
  }
}
function guardNoOp(r: Repo) {
  if (!r.op) return;
  if (r.op.kind === "merge") fail("error: You have not concluded your merge (MERGE_HEAD exists).\nhint: Commit your changes or use 'git merge --abort'.");
  fail(`error: a ${r.op.kind} is in progress; use 'git ${r.op.kind} --continue', '--skip' (rebase only) or '--abort'.`);
}

// ── Tokenizer ────────────────────────────────────────────────────────────

/** Split a line on whitespace, honouring single and double quotes. Returns null for an unterminated quote. */
export function tokenize(line: string): string[] | null {
  const out: string[] = [];
  let cur = "", q: string | null = null, has = false;
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
    cur += ch;
  }
  if (q) return null;
  if (cur || has) out.push(cur);
  return out;
}
/** Split a line on `&&` outside quotes. */
function splitChain(line: string): string[] {
  const parts: string[] = [];
  let cur = "", q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "&" && line[i + 1] === "&") { parts.push(cur); cur = ""; i++; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ── Commands ─────────────────────────────────────────────────────────────

interface Out { out: string; ok?: boolean }
const MAX_FILES = 40, MAX_LINES = 300;

function checkPath(p: string) {
  if (!p || p.startsWith("/") || p.split("/").some((s) => s === ".." || s === "." || s === "") || p.startsWith(".git/") || p === ".git") fail(`fatal: invalid path '${p}' (the lab uses plain relative paths such as notes.txt or src/app.py)`);
}
function setFile(r: Repo, path: string, content: string) {
  checkPath(path);
  const text = normalise(content);
  if (toLines(text).length > MAX_LINES) fail(`error: the lab limits a file to ${MAX_LINES} lines`);
  if (r.work[path] === undefined && Object.keys(r.work).length >= MAX_FILES) fail(`error: the lab limits the working tree to ${MAX_FILES} files`);
  r.work[path] = text;
}
const matchPaths = (files: Files, spec: string): string[] => {
  if (spec === "." || spec === "./") return Object.keys(files);
  const dir = spec.replace(/\/$/, "");
  return Object.keys(files).filter((p) => p === spec || p.startsWith(`${dir}/`));
};

function cmdInit(r: Repo, args: string[]): Out {
  let name = DEFAULT_BRANCH;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-b" || args[i] === "--initial-branch") name = args[++i] ?? fail("error: switch `b' requires a value");
    else if (args[i].startsWith("--initial-branch=")) name = args[i].slice(17);
    else if (args[i] === "-q" || args[i] === "--quiet") continue;
    else fail(`error: unknown option or argument '${args[i]}' (the lab supports git init [-b <name>])`);
  }
  if (r.initialized) return { out: "Reinitialized existing Git repository in /project/.git/" };
  if (!validBranchName(name)) fail(`fatal: invalid initial branch name: '${name}'`);
  r.initialized = true;
  r.head = { kind: "branch", name };
  return { out: `Initialized empty Git repository in /project/.git/` };
}

function validBranchName(n: string) { return /^[A-Za-z0-9._/-]+$/.test(n) && !n.startsWith("-") && !n.startsWith("/") && !n.endsWith("/") && !n.endsWith(".lock") && !n.includes("..") && !n.includes("//") && n !== "HEAD"; }

function cmdAdd(r: Repo, args: string[]): Out {
  needRepo(r);
  const specs: string[] = [];
  let tracked = false;
  for (const a of args) {
    if (a === "-A" || a === "--all") specs.push(".");
    else if (a === "-u" || a === "--update") tracked = true;
    else if (a === "-p" || a === "-i" || a === "--patch" || a === "--interactive") fail("error: interactive staging (add -p) is not available in the lab");
    else if (a === "--") continue;
    else if (a.startsWith("-")) fail(`error: unknown option '${a}'`);
    else specs.push(a);
  }
  if (!specs.length && tracked) specs.push(".");
  if (!specs.length) return { out: "Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?" };
  const lines: string[] = [];
  for (const spec of specs) {
    const hits = [...new Set([...matchPaths(r.work, spec), ...matchPaths(r.index, spec)])];
    if (!hits.length) fail(`fatal: pathspec '${spec}' did not match any files`);
    for (const p of hits) {
      if (tracked && r.index[p] === undefined) continue;
      if (r.work[p] === undefined) delete r.index[p]; else r.index[p] = r.work[p];
      if (r.op) r.op.unmerged = r.op.unmerged.filter((u) => u !== p);
      if (r.work[p] !== undefined && hasMarkers(r.work[p])) lines.push(`lab hint: ${p} still contains conflict marker lines (<<<<<<<, =======, >>>>>>>). Git stages it anyway; check it before you commit.`);
    }
  }
  return { out: lines.join("\n") };
}

function cmdRm(r: Repo, args: string[]): Out {
  needRepo(r);
  const cached = args.includes("--cached"), specs = args.filter((a) => !a.startsWith("-"));
  if (!specs.length) fail("usage: git rm [--cached] <file>...");
  const lines: string[] = [];
  for (const spec of specs) {
    const hits = matchPaths(r.index, spec);
    if (!hits.length) fail(`fatal: pathspec '${spec}' did not match any files`);
    for (const p of hits) {
      if (!cached && (r.work[p] !== r.index[p] || r.index[p] !== headTree(r)[p]) && r.work[p] !== undefined) fail(`error: the following file has changes staged in the index or local modifications:\n    ${p}\n(use --cached to keep the file, or -f to force removal)`);
      delete r.index[p];
      if (!cached) delete r.work[p];
      lines.push(`rm '${p}'`);
    }
  }
  return { out: lines.join("\n") };
}

function cmdRestore(r: Repo, args: string[], viaCheckout = false): Out {
  needRepo(r);
  let staged = false;
  const specs: string[] = [];
  for (const a of args) {
    if (a === "--staged" || a === "-S") staged = true;
    else if (a === "--worktree" || a === "-W" || a === "--") continue;
    else if (a.startsWith("--source")) fail("error: restore --source is not available in the lab");
    else if (a.startsWith("-")) fail(`error: unknown option '${a}'`);
    else specs.push(a);
  }
  if (!specs.length) fail(viaCheckout ? "fatal: you must specify path(s) to restore" : "fatal: you must specify path(s) to restore");
  const h = headTree(r);
  for (const spec of specs) {
    const hits = [...new Set([...matchPaths(r.work, spec), ...matchPaths(r.index, spec), ...(staged ? matchPaths(h, spec) : [])])];
    if (!hits.length) fail(`error: pathspec '${spec}' did not match any file(s) known to git`);
    for (const p of hits) {
      if (staged) { if (h[p] === undefined) delete r.index[p]; else r.index[p] = h[p]; }
      else if (r.index[p] === undefined) { if (spec !== "." && spec !== "./") fail(`error: pathspec '${spec}' did not match any file(s) known to git`); }
      else r.work[p] = r.index[p];
      if (r.op) r.op.unmerged = r.op.unmerged.filter((u) => u !== p);
    }
  }
  return { out: "" };
}

function cmdCommit(r: Repo, args: string[]): Out {
  needRepo(r);
  const msgs: string[] = [];
  let all = false, amend = false, allowEmpty = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--amend") amend = true;
    else if (a === "--allow-empty") allowEmpty = true;
    else if (a === "--no-edit" || a === "-q" || a === "--quiet") continue;
    else if (a === "--all") all = true;
    else if (a.startsWith("--message=")) msgs.push(a.slice(10));
    else if (a === "--message") msgs.push(args[++i] ?? fail("error: switch `m' requires a value"));
    else if (/^-[a-zA-Z]+$/.test(a)) {
      for (let k = 1; k < a.length; k++) {
        if (a[k] === "a") all = true;
        else if (a[k] === "m") { msgs.push(k === a.length - 1 ? args[++i] ?? fail("error: switch `m' requires a value") : a.slice(k + 1)); break; }
        else fail(`error: unknown switch '${a[k]}'`);
      }
    } else fail(`error: unknown option or argument '${a}' (commit supports -m, -a, --amend, --allow-empty)`);
  }
  if (all) for (const p of Object.keys(r.index)) { if (r.work[p] === undefined) delete r.index[p]; else r.index[p] = r.work[p]; }
  const op = r.op;
  if (op?.kind === "rebase") fail("error: you are in the middle of a rebase: resolve, 'git add', then run 'git rebase --continue' (the lab does not allow 'git commit' here)");
  if (op && op.unmerged.length) fail("error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.");
  const hid = headId(r), h = headTree(r);
  let parents = hid ? [hid] : [];
  let message = msgs.join("\n\n");
  if (op?.kind === "merge") { parents = [hid!, op.theirs]; message ||= op.message; }
  else if (op && op.kind !== "rebase") message ||= op.message;
  if (amend) {
    if (!hid) fail("fatal: You have nothing to amend.");
    if (op) fail("fatal: You are in the middle of a merge -- cannot amend.");
    parents = [...r.commits[hid!].parents];
    message ||= r.commits[hid!].message;
  }
  if (!message) fail("fatal: the lab has no editor, so a message is required: git commit -m \"message\"");
  const same = treeId(r.index) === treeId(h);
  if (!amend && !op && same && !allowEmpty) {
    return fail(statusLong(r));
  }
  if (op?.kind === "cherry-pick" || op?.kind === "revert") if (same && !allowEmpty) fail(`error: nothing to commit: the ${op.kind} changes are already in this branch (use 'git ${op.kind} --abort')`);
  const c = makeCommit(r, r.index, parents, message);
  if (amend) r.origHead = hid;
  moveHead(r, c.id);
  r.op = null;
  const where = r.head.kind === "branch" ? r.head.name : "detached HEAD";
  const lines = [`[${where}${!parents.length ? " (root-commit)" : ""} ${short(c.id)}] ${subject(c)}`];
  lines.push(...statLines(diffStat(parents.length ? r.commits[parents[0]].tree : {}, c.tree), false));
  return { out: lines.join("\n") };
}

function cmdStatus(r: Repo, args: string[]): Out {
  needRepo(r);
  return { out: args.includes("-s") || args.includes("--short") || args.includes("--porcelain") ? statusShort(r) : statusLong(r) };
}

function cmdDiff(r: Repo, args: string[]): Out {
  needRepo(r);
  const flags = args.filter((a) => a.startsWith("-") && a !== "--"), rest = args.filter((a) => !a.startsWith("-") || a === "--");
  const dd = rest.indexOf("--");
  let revs = dd >= 0 ? rest.slice(0, dd) : rest, paths = dd >= 0 ? rest.slice(dd + 1) : [];
  if (dd < 0) { const firstPath = revs.findIndex((x) => !x.includes("..") && !resolveRev(r, x)); if (firstPath >= 0) { paths = revs.slice(firstPath); revs = revs.slice(0, firstPath); } }
  const staged = flags.includes("--staged") || flags.includes("--cached");
  let from: Files, to: Files;
  const treeOf = (spec: string) => r.commits[needRev(r, spec)].tree;
  if (revs.length === 1 && revs[0].includes("..")) { const [a, b] = revs[0].split(".."); from = treeOf(a || "HEAD"); to = treeOf(b || "HEAD"); }
  else if (revs.length === 2) { from = treeOf(revs[0]); to = treeOf(revs[1]); }
  else if (revs.length === 1) { from = treeOf(revs[0]); to = staged ? r.index : trackedWork(r); }
  else if (staged) { from = headTree(r); to = r.index; }
  else { from = r.index; to = trackedWork(r); }
  const unmerged = new Set(r.op?.unmerged ?? []);
  const keep = (f: Files) => Object.fromEntries(Object.entries(f).filter(([p]) => !unmerged.has(p)));
  if (!revs.length && !staged) { from = keep(from); to = keep(to); }
  const lines = !revs.length && !staged ? [...unmerged].sort().map((p) => `* Unmerged path ${p}`) : [];
  if (flags.includes("--name-only")) return { out: [...lines, ...diffStat(from, to).map((f) => f.path)].join("\n") };
  if (flags.includes("--name-status")) return { out: [...lines, ...diffStat(from, to).map((f) => `${f.status === "new" ? "A" : f.status === "deleted" ? "D" : "M"}\t${f.path}`)].join("\n") };
  if (flags.includes("--stat")) return { out: [...lines, ...statLines(diffStat(from, to), true)].join("\n") };
  const t = diffText(from, to, paths);
  return { out: [...lines, ...(t ? [t] : [])].join("\n") };
}
/** Working-tree view of the tracked files (an untracked file never appears in `git diff`). */
function trackedWork(r: Repo): Files {
  const out: Files = {};
  for (const p of Object.keys(r.index)) if (r.work[p] !== undefined) out[p] = r.work[p];
  return out;
}

function fullHeader(c: Commit, labels: Record<string, string[]>): string[] {
  const d = new Date(tickSeconds(c.tick) * 1000).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, (_, wd, day, mon, y, t) => `${wd} ${mon} ${Number(day)} ${t} ${y} +0000`);
  const dec = labels[c.id]?.length ? ` (${labels[c.id].join(", ")})` : "";
  return [`commit ${c.id}${dec}`, ...(c.parents.length > 1 ? [`Merge: ${c.parents.map(short).join(" ")}`] : []), `Author: ${IDENT}`, `Date:   ${d}`, "", ...c.message.split("\n").map((l) => `    ${l}`)];
}

function cmdShow(r: Repo, args: string[]): Out {
  needRepo(r);
  const spec = args.find((a) => !a.startsWith("-")) ?? "HEAD";
  const c = r.commits[needRev(r, spec)];
  const lines = fullHeader(c, refLabels(r));
  if (c.parents.length <= 1) { const t = diffText(c.parents[0] ? r.commits[c.parents[0]].tree : {}, c.tree); if (t) lines.push("", t); }
  return { out: lines.join("\n") };
}

export interface LogOptions { oneline: boolean; graph: boolean; all: boolean; limit: number | null; format: string | null }

/** Commit ids `git log` would list, newest first. Ranges `a..b` and `^a b` are supported. */
function logIds(r: Repo, revs: string[], all: boolean): string[] {
  const tips: string[] = [], hide: string[] = [];
  for (const spec of revs) {
    if (spec.includes("..")) { const [a, b] = spec.split(".."); hide.push(needRev(r, a || "HEAD")); tips.push(needRev(r, b || "HEAD")); }
    else tips.push(needRev(r, spec));
  }
  if (all) { tips.push(...Object.values(r.branches), ...Object.values(r.tags)); if (r.head.kind === "detached") tips.push(r.head.id); }
  if (!tips.length) { const h = headId(r); if (!h) fail(`fatal: your current branch '${currentBranch(r)}' does not have any commits yet`); tips.push(h!); }
  const hidden = new Set<string>();
  for (const h of hide) for (const c of ancestors(r, h)) hidden.add(c);
  return topoOrder(r, [...new Set(tips)]).filter((c) => !hidden.has(c));
}

/** Text rendering of the commit graph, one entry per commit: the row prefix, a continuation prefix and connector rows below. */
export function textGraph(r: Repo, order: string[]): { row: string; cont: string; after: string[] }[] {
  const lanes: (string | null)[] = [];
  const res: { row: string; cont: string; after: string[] }[] = [];
  const render = (col: number, star: boolean) => lanes.map((l, i) => (i === col ? (star ? "*" : "|") : l !== null ? "|" : " ")).join(" ").trimEnd();
  for (const id of order) {
    let idxs = lanes.flatMap((l, i) => (l === id ? [i] : []));
    if (!idxs.length) { let s = lanes.indexOf(null); if (s < 0) { s = lanes.length; lanes.push(null); } lanes[s] = id; idxs = [s]; }
    const col = idxs[0];
    const conn = (marks: Record<number, string>, skip = -1) => {
      const ch = new Array<string>(lanes.length * 2).fill(" ");
      lanes.forEach((l, i) => { if ((l !== null || i === col) && i !== skip) ch[2 * i] = "|"; });
      for (const [k, v] of Object.entries(marks)) { ch[Number(k)] = v; }
      return ch.join("").trimEnd();
    };
    // Lanes that wait for the same commit join the first one on a "|/" line drawn just before that commit's row, as Git does.
    const extras = idxs.slice(1);
    if (extras.length && res.length) {
      const marks: Record<number, string> = {};
      for (const j of extras) { marks[2 * j - 1] = "/"; marks[2 * j] = " "; }
      res[res.length - 1].after.push(conn(marks));
    }
    for (const j of extras) lanes[j] = null;
    const row = render(col, true), cont = render(col, false), after: string[] = [];
    const parents = r.commits[id].parents;
    lanes[col] = parents[0] ?? null;
    for (const p of parents.slice(1)) {
      let slot = lanes.findIndex((l) => l === p), fresh = false;
      if (slot < 0) { slot = lanes.indexOf(null); if (slot < 0) { slot = lanes.length; lanes.push(null); } lanes[slot] = p; fresh = true; }
      const marks: Record<number, string> = {}; marks[2 * col + 1] = "\\";
      after.push(conn(marks, fresh ? slot : -1));
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    res.push({ row, cont, after });
  }
  return res;
}

function cmdLog(r: Repo, args: string[]): Out {
  needRepo(r);
  const o: LogOptions = { oneline: false, graph: false, all: false, limit: null, format: null };
  const revs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--oneline") o.oneline = true;
    else if (a === "--graph") o.graph = true;
    else if (a === "--all") o.all = true;
    else if (a === "--decorate") continue;
    else if (a === "-n") o.limit = Number(args[++i]);
    else if (/^-n\d+$/.test(a)) o.limit = Number(a.slice(2));
    else if (/^-\d+$/.test(a)) o.limit = Number(a.slice(1));
    else if (a.startsWith("--max-count=")) o.limit = Number(a.slice(12));
    else if (a.startsWith("--format=") || a.startsWith("--pretty=")) { const f = a.slice(a.indexOf("=") + 1); o.format = f.replace(/^format:/, ""); }
    else if (a.startsWith("-")) fail(`fatal: unrecognized argument: ${a} (the lab supports --oneline --graph --all -n --format=%H/%h/%s)`);
    else revs.push(a);
  }
  let ids = logIds(r, revs, o.all);
  if (o.limit !== null && Number.isFinite(o.limit)) ids = ids.slice(0, o.limit);
  const labels = refLabels(r);
  const g = o.graph ? textGraph(r, ids) : null;
  const lines: string[] = [];
  ids.forEach((id, k) => {
    const c = r.commits[id];
    const dec = labels[id]?.length ? ` (${labels[id].join(", ")})` : "";
    let body: string[];
    if (o.format !== null) body = [o.format.replace(/%H/g, c.id).replace(/%h/g, short(c.id)).replace(/%s/g, subject(c)).replace(/%P/g, c.parents.join(" ")).replace(/%n/g, " ")];
    else if (o.oneline) body = [`${short(c.id)}${dec} ${subject(c)}`];
    else body = [...fullHeader(c, labels), ""];
    if (!g) { lines.push(...body); return; }
    lines.push(`${g[k].row} ${body[0]}`.trimEnd());
    for (const l of body.slice(1)) lines.push(`${g[k].cont} ${l}`.trimEnd());
    lines.push(...g[k].after);
  });
  if (!o.oneline && o.format === null && !g && lines[lines.length - 1] === "") lines.pop();
  return { out: lines.join("\n") };
}

function cmdBranch(r: Repo, args: string[]): Out {
  needRepo(r);
  const flags = args.filter((a) => a.startsWith("-")), rest = args.filter((a) => !a.startsWith("-"));
  const del = flags.some((f) => f === "-d" || f === "--delete"), force = flags.some((f) => f === "-D") || (del && flags.includes("--force")) || flags.includes("-f");
  const cur = currentBranch(r);
  if (del || flags.includes("-D")) {
    if (!rest.length) fail("fatal: branch name required");
    const lines: string[] = [];
    for (const n of rest) {
      const id = r.branches[n];
      if (!id) fail(`error: branch '${n}' not found.`);
      if (n === cur) fail(`error: cannot delete branch '${n}' used by worktree at '/project'`);
      const hid = headId(r);
      if (!(flags.includes("-D") || force) && !(hid && isAncestor(r, id, hid))) fail(`error: the branch '${n}' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D ${n}'`);
      delete r.branches[n];
      lines.push(`Deleted branch ${n} (was ${short(id)}).`);
    }
    return { out: lines.join("\n") };
  }
  if (flags.includes("-m") || flags.includes("-M")) {
    const [a, b] = rest.length === 1 ? [cur ?? fail("fatal: cannot rename the current detached HEAD"), rest[0]] : rest;
    if (!b || !validBranchName(b)) fail(`fatal: '${b}' is not a valid branch name`);
    if (!r.branches[a] && !(a === cur && !headId(r))) fail(`error: refname refs/heads/${a} not found\nfatal: Branch rename failed`);
    if (r.branches[b] && !flags.includes("-M")) fail(`fatal: a branch named '${b}' already exists`);
    if (r.branches[a]) { r.branches[b] = r.branches[a]; delete r.branches[a]; }
    if (r.head.kind === "branch" && r.head.name === a) r.head = { kind: "branch", name: b };
    return { out: "" };
  }
  if (rest.length) {
    const [name, start] = rest;
    if (!validBranchName(name)) fail(`fatal: '${name}' is not a valid branch name`);
    if (r.branches[name]) fail(`fatal: a branch named '${name}' already exists`);
    const id = start ? resolveRev(r, start) : headId(r);
    if (!id) fail(`fatal: not a valid object name: '${start ?? cur}'`);
    r.branches[name] = id!;
    return { out: "" };
  }
  const verbose = flags.includes("-v") || flags.includes("-vv");
  const names = Object.keys(r.branches).sort();
  const lines: string[] = [];
  if (r.head.kind === "detached") lines.push(`* (HEAD detached at ${short(r.head.id)})${verbose ? ` ${short(r.head.id)} ${subject(r.commits[r.head.id])}` : ""}`);
  const w = Math.max(0, ...names.map((n) => n.length));
  for (const n of names) lines.push(`${n === cur ? "*" : " "} ${verbose ? `${n.padEnd(w)} ${short(r.branches[n])} ${subject(r.commits[r.branches[n]])}` : n}`);
  if (!names.length && cur && r.head.kind === "branch") return { out: "" };
  return { out: lines.join("\n") };
}

function cmdSwitch(r: Repo, args: string[], checkout: boolean): Out {
  needRepo(r);
  let create: string | null = null, detach = false;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-c" || a === "-b" || a === "--create") create = args[++i] ?? fail(`error: switch \`${a.slice(-1)}' requires a value`);
    else if (a === "-d" || a === "--detach") detach = true;
    else if (a === "--") { rest.push(...args.slice(i)); break; }
    else if (a.startsWith("-") && a !== "-") fail(`error: unknown option '${a}'`);
    else rest.push(a);
  }
  if (checkout && rest[0] === "--") return cmdRestore(r, rest.slice(1), true);
  if (checkout && rest.length > 1 && rest[rest.length - 2] === "--") fail("error: checkout <rev> -- <path> is not available in the lab (use git restore)");
  if (r.op) fail("error: you need to resolve your current index first");
  const from = headTree(r);
  if (create !== null) {
    if (!validBranchName(create)) fail(`fatal: '${create}' is not a valid branch name`);
    if (r.branches[create]) fail(`fatal: a branch named '${create}' already exists`);
    const startSpec = rest[0];
    const start = startSpec ? resolveRev(r, startSpec) : headId(r);
    if (startSpec && !start) fail(`fatal: invalid reference: ${startSpec}`);
    if (start !== headId(r) && start) { guardOverwrite(r, from, r.commits[start].tree, "checkout"); checkoutTree(r, from, r.commits[start].tree); }
    if (start) r.branches[create] = start;
    r.head = { kind: "branch", name: create };
    return { out: `Switched to a new branch '${create}'` };
  }
  const target = rest[0];
  if (!target) fail(checkout ? "fatal: you must specify a branch or commit" : "fatal: missing branch or commit argument");
  if (target === "-") fail("fatal: '-' (previous branch) is not tracked by the lab");
  if (!detach && r.branches[target] !== undefined) {
    if (r.head.kind === "branch" && r.head.name === target) return { out: `Already on '${target}'` };
    const to = r.commits[r.branches[target]].tree;
    guardOverwrite(r, from, to, "checkout");
    checkoutTree(r, from, to);
    r.head = { kind: "branch", name: target };
    return { out: `Switched to branch '${target}'` };
  }
  if (r.head.kind === "branch" && r.head.name === target && !headId(r)) return { out: `Already on '${target}'` };
  const id = resolveRev(r, target);
  if (!id) fail(checkout ? `error: pathspec '${target}' did not match any file(s) known to git` : `fatal: invalid reference: ${target}`);
  if (!checkout && !detach) fail(`fatal: a branch is expected, got ${r.tags[target] ? `tag '${target}'` : `commit '${target}'`}`);
  const to = r.commits[id!].tree;
  guardOverwrite(r, from, to, "checkout");
  checkoutTree(r, from, to);
  r.head = { kind: "detached", id: id! };
  return { out: `Note: switching to '${target}'.\n\nYou are in 'detached HEAD' state. Commits you make here belong to no branch and can be lost unless you create a branch\nwith: git switch -c <new-branch-name>\n\nHEAD is now at ${short(id!)} ${subject(r.commits[id!])}` };
}

const mergeMessage = (r: Repo, name: string, kind: "branch" | "tag" | "commit") => `Merge ${kind} '${name}'${currentBranch(r) && currentBranch(r) !== "main" && currentBranch(r) !== "master" ? ` into ${currentBranch(r)}` : ""}`;

function cmdMerge(r: Repo, args: string[]): Out {
  needRepo(r);
  let noFf = false, ffOnly = false, abort = false, msg: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--no-ff") noFf = true;
    else if (a === "--ff-only") ffOnly = true;
    else if (a === "--abort") abort = true;
    else if (a === "-m") msg = args[++i] ?? fail("error: switch `m' requires a value");
    else if (a === "--no-edit" || a === "--ff") continue;
    else if (a === "--squash" || a === "--continue" || a.startsWith("-s") || a.startsWith("-X")) fail(`error: merge ${a} is not available in the lab`);
    else if (a.startsWith("-")) fail(`error: unknown option '${a}'`);
    else rest.push(a);
  }
  if (abort) {
    if (r.op?.kind !== "merge") fail("fatal: There is no merge to abort (MERGE_HEAD missing).");
    hardTo(r, headId(r)!, false);
    r.op = null;
    return { out: "" };
  }
  guardNoOp(r);
  if (rest.length !== 1) fail("fatal: the lab merges exactly one branch, tag or commit: git merge <name>");
  const name = rest[0], theirs = resolveRev(r, name);
  if (!theirs) fail(`merge: ${name} - not something we can merge`);
  const ours = headId(r);
  if (!ours) fail("fatal: HEAD does not point to a commit yet; make a first commit before merging");
  const kind = r.branches[name] ? "branch" : r.tags[name] ? "tag" : "commit";
  const message = msg ?? mergeMessage(r, name, kind);
  const oursTree = r.commits[ours!].tree, theirsTree = r.commits[theirs!].tree;
  if (isAncestor(r, theirs!, ours!)) return { out: "Already up to date." };
  if (isAncestor(r, ours!, theirs!) && !noFf) {
    guardOverwrite(r, oursTree, theirsTree, "merge");
    checkoutTree(r, oursTree, theirsTree);
    r.origHead = ours;
    moveHead(r, theirs!);
    return { out: [`Updating ${short(ours!)}..${short(theirs!)}`, "Fast-forward", ...statLines(diffStat(oursTree, theirsTree), true)].join("\n") };
  }
  if (ffOnly) fail("fatal: Not possible to fast-forward, aborting.");
  const base = mergeBase(r, ours!, theirs!);
  if (!base) fail("fatal: refusing to merge unrelated histories");
  const res = mergeTrees(r.commits[base!].tree, oursTree, theirsTree, { ours: "HEAD", theirs: name });
  guardOverwrite(r, oursTree, res.tree, "merge");
  r.origHead = ours;
  if (!res.conflicts.length) {
    checkoutTree(r, oursTree, res.tree);
    const c = makeCommit(r, r.index, [ours!, theirs!], message);
    moveHead(r, c.id);
    return { out: ["Merge made by the 'ort' strategy.", ...statLines(diffStat(oursTree, c.tree), true)].join("\n") };
  }
  const bad = res.conflicts.map((c) => c.path);
  checkoutTree(r, oursTree, Object.fromEntries(Object.entries(res.tree).filter(([p]) => !bad.includes(p))));
  for (const p of Object.keys(oursTree)) if (res.tree[p] === undefined && !bad.includes(p)) { delete r.work[p]; delete r.index[p]; }
  for (const p of bad) { r.work[p] = res.tree[p]; const ix = oursTree[p] ?? theirsTree[p]; if (ix !== undefined) r.index[p] = ix; }
  r.op = { kind: "merge", theirs: theirs!, theirsName: name, message, unmerged: bad };
  return { out: [...res.log, "Automatic merge failed; fix conflicts and then commit the result."].join("\n"), ok: false };
}

/** Move the branch (or detached HEAD) to `id`; `hard` also resets index and working tree to that commit's files. */
function hardTo(r: Repo, id: string, move = true) {
  const to = r.commits[id].tree;
  if (move) moveHead(r, id);
  for (const p of Object.keys(r.index)) if (to[p] === undefined) { delete r.index[p]; delete r.work[p]; }
  for (const p of Object.keys(to)) { r.index[p] = to[p]; r.work[p] = to[p]; }
}

function cmdReset(r: Repo, args: string[]): Out {
  needRepo(r);
  let mode: "soft" | "mixed" | "hard" = "mixed";
  const rest: string[] = [];
  for (const a of args) {
    if (a === "--soft") mode = "soft"; else if (a === "--mixed") mode = "mixed"; else if (a === "--hard") mode = "hard";
    else if (a === "--keep" || a === "--merge") fail(`error: reset ${a} is not available in the lab`);
    else if (a === "-q") continue;
    else rest.push(a);
  }
  const dd = rest.indexOf("--");
  let spec = "HEAD", paths: string[] = [];
  if (dd >= 0) { if (dd > 0) spec = rest[0]; paths = rest.slice(dd + 1); }
  else if (rest.length) {
    const isPath = (x: string) => [r.work, r.index, headTree(r)].some((f) => matchPaths(f, x).length > 0);
    if (resolveRev(r, rest[0])) { spec = rest[0]; paths = rest.slice(1); }
    else if (isPath(rest[0])) paths = rest;
    else fail(`fatal: ambiguous argument '${rest[0]}': unknown revision or path not in the working tree.`);
  }
  const id = resolveRev(r, spec);
  if (!id) fail(headId(r) ? `fatal: ambiguous argument '${spec}': unknown revision or path not in the working tree.` : "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.");
  const to = r.commits[id!].tree;
  if (paths.length) {
    if (mode !== "mixed") fail(`fatal: Cannot do ${mode} reset with paths.`);
    for (const spec2 of paths) {
      const hits = [...new Set([...matchPaths(r.index, spec2), ...matchPaths(to, spec2)])];
      if (!hits.length) fail(`fatal: ambiguous argument '${spec2}': unknown revision or path not in the working tree.`);
      for (const p of hits) { if (to[p] === undefined) delete r.index[p]; else r.index[p] = to[p]; }
    }
    return { out: unstagedNote(r) };
  }
  if (r.op && mode !== "hard") fail(`fatal: Cannot do a ${mode} reset in the middle of a ${r.op.kind}.`);
  const prev = headId(r);
  if (prev) r.origHead = prev;
  moveHead(r, id!);
  r.op = null;
  if (mode === "soft") return { out: "" };
  if (mode === "hard") { hardTo(r, id!, false); return { out: `HEAD is now at ${short(id!)} ${subject(r.commits[id!])}` }; }
  r.index = { ...to };
  return { out: unstagedNote(r) };
}
function unstagedNote(r: Repo): string {
  const s = statusParts(r).unstaged;
  return s.length ? ["Unstaged changes after reset:", ...s.map((c) => `${c.kind === "deleted" ? "D" : "M"}\t${c.path}`)].join("\n") : "";
}

// ── Replaying commits: cherry-pick, revert, rebase ───────────────────────

interface PickResult { conflicted: boolean; log: string[]; commit?: Commit; empty?: boolean }

/** Apply the change `base → theirs` on top of HEAD (a three-way merge). Used by cherry-pick, revert and each rebase step. */
function applyPick(r: Repo, base: Files, theirs: Files, labels: { ours: string; theirs: string }, message: string, op: PendingOp | null): PickResult {
  const hid = headId(r)!, ours = r.commits[hid].tree;
  const res = mergeTrees(base, ours, theirs, labels);
  const bad = res.conflicts.map((c) => c.path);
  if (!bad.length) {
    if (treeId(res.tree) === treeId(ours)) return { conflicted: false, log: res.log, empty: true };
    checkoutTree(r, ours, res.tree);
    const c = makeCommit(r, r.index, [hid], message);
    moveHead(r, c.id);
    return { conflicted: false, log: res.log, commit: c };
  }
  checkoutTree(r, ours, Object.fromEntries(Object.entries(res.tree).filter(([p]) => !bad.includes(p))));
  for (const p of Object.keys(ours)) if (res.tree[p] === undefined && !bad.includes(p)) { delete r.work[p]; delete r.index[p]; }
  for (const p of bad) { r.work[p] = res.tree[p]; const ix = ours[p] ?? theirs[p]; if (ix !== undefined) r.index[p] = ix; }
  if (op) { op.unmerged = bad; r.op = op; }
  return { conflicted: true, log: res.log };
}

function pickOutput(r: Repo, c: Commit): string {
  const before = c.parents[0] ? r.commits[c.parents[0]].tree : {};
  return [`[${headLabel(r) === "detached HEAD" ? "detached HEAD" : headLabel(r)} ${short(c.id)}] ${subject(c)}`, ...statLines(diffStat(before, c.tree), false)].join("\n");
}

function cmdPickLike(r: Repo, args: string[], kind: "cherry-pick" | "revert"): Out {
  needRepo(r);
  const flag = args.find((a) => a === "--continue" || a === "--abort" || a === "--skip");
  if (flag === "--abort") {
    if (r.op?.kind !== kind) fail(`error: no ${kind} in progress`);
    hardTo(r, headId(r)!, false);
    r.op = null;
    return { out: "" };
  }
  if (flag === "--continue") {
    if (r.op?.kind !== kind) fail(`error: no ${kind} in progress`);
    return cmdCommit(r, []);
  }
  if (flag) fail(`error: ${kind} ${flag} is not available in the lab`);
  const specs = args.filter((a) => !a.startsWith("-"));
  for (const a of args) if (a.startsWith("-") && a !== "--no-edit" && a !== "-x" && a !== "--no-commit" && a !== "-n") fail(`error: unknown option '${a}'`);
  if (specs.length !== 1) fail(`fatal: the lab ${kind === "revert" ? "reverts" : "cherry-picks"} exactly one commit: git ${kind} <commit>`);
  guardNoOp(r);
  const id = needRev(r, specs[0]), c = r.commits[id];
  if (c.parents.length > 1) fail(`error: commit ${id} is a merge but no -m option was given.\nfatal: ${kind} failed`);
  if (!headId(r)) fail(`fatal: ${kind} needs a commit on the current branch`);
  const parentTree = c.parents[0] ? r.commits[c.parents[0]].tree : {};
  const ours = r.commits[headId(r)!].tree;
  const message = kind === "revert" ? `Revert "${subject(c)}"\n\nThis reverts commit ${c.id}.` : c.message;
  const [base, theirs] = kind === "revert" ? [c.tree, parentTree] : [parentTree, c.tree];
  guardOverwrite(r, ours, mergeTrees(base, ours, theirs, { ours: "HEAD", theirs: "x" }).tree, kind);
  const label = kind === "revert" ? `parent of ${short(c.id)} (${subject(c)})` : `${short(c.id)} (${subject(c)})`;
  const op: PendingOp = { kind, commit: id, message, unmerged: [] };
  const res = applyPick(r, base, theirs, { ours: "HEAD", theirs: label }, message, op);
  if (res.conflicted) return { out: [...res.log, `error: could not ${kind === "revert" ? "revert" : "apply"} ${short(c.id)}... ${subject(c)}`, `hint: After resolving the conflicts, mark them with "git add <paths>", then run "git ${kind} --continue".`].join("\n"), ok: false };
  if (res.empty) fail(`error: nothing to commit: ${kind === "revert" ? "the revert would change nothing" : "the change is already in this branch"}`);
  return { out: pickOutput(r, res.commit!) };
}

/** Commits on `head` that are not on `upstream`, oldest first, merge commits left out (a rebase replays plain commits). */
export function commitsToReplay(r: Repo, head: string, upstream: string): string[] {
  const hide = ancestors(r, upstream);
  return topoOrder(r, [head]).filter((c) => !hide.has(c) && r.commits[c].parents.length <= 1).reverse();
}

function continueRebase(r: Repo, lines: string[]): Out {
  const op = r.op as Extract<PendingOp, { kind: "rebase" }>;
  while (op.todo.length) {
    const cid = op.todo.shift()!, c = r.commits[cid];
    op.current = cid; op.done += 1;
    const res = applyPick(r, c.parents[0] ? r.commits[c.parents[0]].tree : {}, c.tree, { ours: "HEAD", theirs: `${short(c.id)} (${subject(c)})` }, c.message, op);
    lines.push(...res.log);
    if (res.conflicted) {
      lines.push(`error: could not apply ${short(c.id)}... ${subject(c)}`, 'hint: Resolve all conflicts manually, mark them as resolved with', 'hint: "git add/rm <conflicted_files>", then run "git rebase --continue".', 'hint: You can instead skip this commit: run "git rebase --skip".', 'hint: To abort and get back to the state before "git rebase", run "git rebase --abort".', `Could not apply ${short(c.id)}... ${subject(c)}`);
      return { out: lines.join("\n"), ok: false };
    }
    if (res.empty) lines.push(`dropping ${short(c.id)} ${subject(c)} -- patch contents already upstream`);
    op.unmerged = [];
  }
  const tip = headId(r)!;
  r.branches[op.branch] = tip;
  r.head = { kind: "branch", name: op.branch };
  r.op = null;
  lines.push(`Successfully rebased and updated refs/heads/${op.branch}.`);
  return { out: lines.join("\n") };
}

function cmdRebase(r: Repo, args: string[]): Out {
  needRepo(r);
  const flag = args.find((a) => a === "--continue" || a === "--abort" || a === "--skip");
  if (flag) {
    const op = r.op;
    if (op?.kind !== "rebase") return fail("fatal: No rebase in progress?");
    if (flag === "--abort") {
      r.head = { kind: "branch", name: op.branch };
      r.branches[op.branch] = op.origHead;
      hardTo(r, op.origHead, false);
      r.op = null;
      return { out: "" };
    }
    if (flag === "--skip") {
      hardTo(r, headId(r)!, false);
      op.unmerged = [];
      return continueRebase(r, []);
    }
    if (op.unmerged.length) fail(`${op.unmerged.map((p) => `${p}: needs merge`).join("\n")}\nYou must edit all merge conflicts and then\nmark them as resolved using git add`);
    const cur = r.commits[op.current];
    if (treeId(r.index) === treeId(headTree(r))) fail("error: No changes - did you forget to use 'git add'?\nIf there is nothing left to stage, chances are that something else\nalready introduced the same changes; you might want to skip this patch (git rebase --skip).");
    const c = makeCommit(r, r.index, [headId(r)!], cur.message);
    moveHead(r, c.id);
    op.unmerged = [];
    return continueRebase(r, []);
  }
  for (const a of args) if (a.startsWith("-")) fail(a === "-i" || a === "--interactive" ? "error: interactive rebase is not available in the lab" : `error: rebase ${a} is not available in the lab (the lab supports git rebase <upstream>, --continue, --skip, --abort)`);
  guardNoOp(r);
  if (args.length !== 1) fail("fatal: the lab rebases onto exactly one upstream: git rebase <branch>");
  const branch = currentBranch(r);
  if (!branch) fail("fatal: no branch checked out: switch to the branch you want to rebase first");
  const head = headId(r);
  if (!head) fail("fatal: no commits on this branch yet");
  const up = needRev(r, args[0]);
  const s = statusParts(r);
  if (s.unstaged.length) fail("error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.");
  if (s.staged.length) fail("error: cannot rebase: Your index contains uncommitted changes.\nerror: Please commit or stash them.");
  if (isAncestor(r, up, head!)) return { out: `Current branch ${branch} is up to date.` };
  if (isAncestor(r, head!, up)) {
    guardOverwrite(r, r.commits[head!].tree, r.commits[up].tree, "rebase");
    checkoutTree(r, r.commits[head!].tree, r.commits[up].tree);
    r.origHead = head;
    r.branches[branch!] = up;
    return { out: `Successfully rebased and updated refs/heads/${branch}.` };
  }
  const todo = commitsToReplay(r, head!, up);
  r.origHead = head;
  checkoutTree(r, r.commits[head!].tree, r.commits[up].tree);
  r.head = { kind: "detached", id: up };
  r.op = { kind: "rebase", branch: branch!, origHead: head!, onto: up, todo, current: "", done: 0, total: todo.length, unmerged: [] };
  return continueRebase(r, []);
}

// ── Stash, tag, plumbing ─────────────────────────────────────────────────

function cmdStash(r: Repo, args: string[]): Out {
  needRepo(r);
  const sub = args[0] && !args[0].startsWith("-") ? args[0] : "push";
  const rest = sub === args[0] ? args.slice(1) : args;
  const label = (e: StashEntry, i: number) => `stash@{${i}}: ${e.message}`;
  if (sub === "list") return { out: r.stash.map((e, i) => label(e, i)).join("\n") };
  if (sub === "push" || sub === "save") {
    if (rest.includes("-u") || rest.includes("--include-untracked")) fail("error: stash -u (untracked files) is not available in the lab");
    const hid = headId(r);
    if (!hid) fail("fatal: You do not have the initial commit yet");
    const s = statusParts(r);
    if (!s.staged.length && !s.unstaged.length) return { out: "No local changes to save" };
    if (r.op) fail("error: cannot stash while a merge, rebase or pick is in progress");
    const mi = rest.indexOf("-m");
    const c = r.commits[hid!];
    const message = mi >= 0 && rest[mi + 1] ? `On ${headLabel(r)}: ${rest[mi + 1]}` : `WIP on ${headLabel(r)}: ${short(hid!)} ${subject(c)}`;
    const work: Files = {};
    for (const p of Object.keys(r.index)) if (r.work[p] !== undefined) work[p] = r.work[p];
    r.stash.unshift({ message, base: hid!, index: { ...r.index }, work });
    for (const p of Object.keys(r.index)) delete r.work[p];
    for (const p of Object.keys(c.tree)) r.work[p] = c.tree[p];
    r.index = { ...c.tree };
    return { out: `Saved working directory and index state ${message}` };
  }
  const idx = rest[0] ? Number(/\{(\d+)\}/.exec(rest[0])?.[1] ?? NaN) : 0;
  if (!r.stash.length) fail("error: No stash entries found.");
  if (!Number.isInteger(idx) || !r.stash[idx]) fail(`error: ${rest[0]} is not a valid reference`);
  const e = r.stash[idx];
  if (sub === "drop") { r.stash.splice(idx, 1); return { out: `Dropped stash@{${idx}}` }; }
  if (sub === "apply" || sub === "pop") {
    const hid = headId(r)!, cur = r.commits[hid].tree, base = r.commits[e.base].tree;
    const changed = [...new Set([...Object.keys(base), ...Object.keys(e.work)])].filter((p) => base[p] !== e.work[p]);
    const dirty = changed.filter((p) => r.index[p] !== cur[p] || (r.work[p] !== r.index[p] && r.index[p] !== undefined));
    if (dirty.length) fail(`error: Your local changes to the following files would be overwritten by merge:\n${dirty.map((p) => `\t${p}`).join("\n")}\nPlease commit your changes or stash them before you merge.\nAborting`);
    const lines: string[] = [];
    let conflicted = false;
    const labels = { ours: "Updated upstream", theirs: "Stashed changes" };
    for (const p of changed) {
      const b = base[p], o = cur[p], t = e.work[p];
      const m = mergeTrees(b === undefined ? {} : { [p]: b }, o === undefined ? {} : { [p]: o }, t === undefined ? {} : { [p]: t }, labels);
      if (m.conflicts.length) { conflicted = true; lines.push(...m.log); }
      if (m.tree[p] === undefined) delete r.work[p]; else r.work[p] = m.tree[p];
      if (b === undefined && m.tree[p] !== undefined) r.index[p] = m.tree[p]; // a staged new file stays staged, as in Git
    }
    if (conflicted) return { out: [...lines, `The stash entry is kept in case you need it again.`].join("\n"), ok: false };
    if (sub === "pop") r.stash.splice(idx, 1);
    return { out: [statusLong(r), ...(sub === "pop" ? [`Dropped stash@{${idx}} (${short(e.base)})`] : [])].join("\n") };
  }
  return fail(`error: unknown stash command '${sub}' (the lab supports push, list, pop, apply, drop)`);
}

function cmdTag(r: Repo, args: string[]): Out {
  needRepo(r);
  const flags = args.filter((a) => a.startsWith("-")), rest = args.filter((a) => !a.startsWith("-"));
  if (flags.some((f) => f === "-a" || f === "-s" || f === "-m" || f === "--annotate")) fail("error: annotated and signed tags are not available in the lab (git tag <name> makes a lightweight tag)");
  if (flags.includes("-d") || flags.includes("--delete")) {
    const lines = rest.map((n) => { const id = r.tags[n] ?? fail(`error: tag '${n}' not found.`); delete r.tags[n]; return `Deleted tag '${n}' (was ${short(id)})`; });
    return { out: lines.join("\n") };
  }
  if (!rest.length) return { out: Object.keys(r.tags).sort().join("\n") };
  const [name, spec] = rest;
  if (!validBranchName(name)) fail(`fatal: '${name}' is not a valid tag name.`);
  if (r.tags[name]) fail(`fatal: tag '${name}' already exists`);
  const id = resolveRev(r, spec ?? "HEAD");
  if (!id) fail(spec ? `fatal: Failed to resolve '${spec}' as a valid ref.` : "fatal: Failed to resolve 'HEAD' as a valid ref.");
  r.tags[name] = id!;
  return { out: "" };
}

function cmdRevParse(r: Repo, args: string[]): Out {
  needRepo(r);
  const lines = args.filter((a) => !a.startsWith("--short")).map((a) => needRev(r, a));
  return { out: (args.some((a) => a.startsWith("--short")) ? lines.map(short) : lines).join("\n") };
}
function cmdRevList(r: Repo, args: string[]): Out {
  needRepo(r);
  const count = args.includes("--count");
  const ids = logIds(r, args.filter((a) => !a.startsWith("-")), args.includes("--all"));
  return { out: count ? String(ids.length) : ids.join("\n") };
}
function cmdCatFile(r: Repo, args: string[]): Out {
  needRepo(r);
  const flag = args.find((a) => a === "-p" || a === "-t"), spec = args.find((a) => !a.startsWith("-"));
  if (!flag || !spec) fail("usage: git cat-file (-p|-t) <commit>   (the lab can show commit objects)");
  const c = r.commits[needRev(r, spec!)];
  return { out: flag === "-t" ? "commit" : commitText(c.treeId, c.parents, c.tick, c.message).replace(/\n$/, "") };
}

function gitCommand(r: Repo, args: string[]): Out {
  const [cmd, ...rest] = args;
  switch (cmd) {
    case "init": return cmdInit(r, rest);
    case "add": return cmdAdd(r, rest);
    case "rm": return cmdRm(r, rest);
    case "restore": return cmdRestore(r, rest);
    case "commit": return cmdCommit(r, rest);
    case "status": return cmdStatus(r, rest);
    case "diff": return cmdDiff(r, rest);
    case "show": return cmdShow(r, rest);
    case "log": return cmdLog(r, rest);
    case "branch": return cmdBranch(r, rest);
    case "switch": return cmdSwitch(r, rest, false);
    case "checkout": return cmdSwitch(r, rest, true);
    case "merge": return cmdMerge(r, rest);
    case "rebase": return cmdRebase(r, rest);
    case "reset": return cmdReset(r, rest);
    case "revert": return cmdPickLike(r, rest, "revert");
    case "cherry-pick": return cmdPickLike(r, rest, "cherry-pick");
    case "stash": return cmdStash(r, rest);
    case "tag": return cmdTag(r, rest);
    case "rev-parse": return cmdRevParse(r, rest);
    case "rev-list": return cmdRevList(r, rest);
    case "cat-file": return cmdCatFile(r, rest);
    case "push": case "pull": case "fetch": case "clone": case "remote":
      return fail(`fatal: '${cmd}' needs a remote. The lab has no network and no remotes: it simulates one local repository.`);
    case undefined: return { out: "usage: git <command> [<args>]   (type help for the commands the lab supports)" };
    default: return fail(`git: '${cmd}' is not a git command in this lab. Type help to see what is supported.`);
  }
}

export const HELP_TEXT = [
  "Git commands in this lab:",
  "  git init [-b name]   git add <paths|.>   git commit [-a] [-m msg] [--amend]   git status [-s]",
  "  git diff [--staged] [rev [rev]]   git show [rev]   git log [--oneline] [--graph] [--all] [-n N] [a..b]",
  "  git branch [name [rev]] [-d|-D name] [-m old new] [-v]   git switch [-c] name   git checkout [-b] name|rev",
  "  git merge [--no-ff|--ff-only|--abort] name   git rebase upstream|--continue|--skip|--abort",
  "  git reset [--soft|--mixed|--hard] [rev]   git revert rev   git cherry-pick rev   git restore [--staged] paths",
  "  git stash [push|list|pop|apply|drop]   git tag [name [rev]] [-d name]   git rm [--cached] paths",
  "  git rev-parse rev   git rev-list --count rev   git cat-file -p rev",
  "Shell helpers (the lab edits files with these):",
  '  echo "text" > file   echo "text" >> file   touch file   rm file   cat file   ls',
  "  resolve <file> ours|theirs|both   (lab only: replaces every conflict block, like choosing a side in an editor)",
].join("\n");

/** Shell helpers that edit the working tree. Real `git` is not involved. */
function shellCommand(r: Repo, tokens: string[]): Out {
  const [cmd, ...rest] = tokens;
  switch (cmd) {
    case "echo": {
      const gt = rest.findIndex((t) => t === ">" || t === ">>");
      const glued = rest.findIndex((t) => /^>>?.+/.test(t));
      const i = gt >= 0 ? gt : glued;
      const textParts = i >= 0 ? rest.slice(0, i) : rest;
      const text = textParts.join(" ");
      if (i < 0) return { out: text };
      const append = (gt >= 0 ? rest[gt] : rest[glued]).startsWith(">>");
      const path = gt >= 0 ? rest[gt + 1] : rest[glued].replace(/^>>?/, "");
      if (!path) fail("bash: syntax error near unexpected token `newline'");
      setFile(r, path, `${append ? r.work[path] ?? "" : ""}${text}\n`);
      return { out: "" };
    }
    case "touch": for (const p of rest) { checkPath(p); if (r.work[p] === undefined) setFile(r, p, ""); } return { out: "" };
    case "rm": {
      for (const p of rest.filter((a) => !a.startsWith("-"))) { const hits = matchPaths(r.work, p); if (!hits.length) fail(`rm: ${p}: No such file or directory`); for (const h of hits) delete r.work[h]; }
      return { out: "" };
    }
    case "cat": return { out: rest.map((p) => r.work[p] ?? fail(`cat: ${p}: No such file or directory`)).join("").replace(/\n$/, "") };
    case "ls": return { out: Object.keys(r.work).sort().join("\n") };
    case "resolve": {
      const [path, choice] = rest;
      if (!path || !["ours", "theirs", "both"].includes(choice)) fail("usage: resolve <file> ours|theirs|both");
      if (r.work[path] === undefined) fail(`resolve: ${path}: No such file`);
      if (!hasMarkers(r.work[path])) fail(`resolve: ${path} has no conflict markers`);
      r.work[path] = resolveAll(r.work[path], choice as Choice);
      return { out: "" };
    }
    case "help": return { out: HELP_TEXT };
    default: return fail(`bash: ${cmd}: command not found (type help for what the lab supports)`);
  }
}

export interface CmdResult { repo: Repo; output: string; ok: boolean }

function runOne(repo: Repo, seg: string): CmdResult {
  const tokens = tokenize(seg);
  if (!tokens) return { repo, output: "bash: unexpected EOF while looking for matching quote", ok: false };
  if (!tokens.length) return { repo, output: "", ok: true };
  const r = cloneRepo(repo);
  try {
    const res = tokens[0] === "git" ? gitCommand(r, tokens.slice(1)) : shellCommand(r, tokens);
    return { repo: r, output: res.out, ok: res.ok !== false };
  } catch (e) {
    if (e instanceof GitError) return { repo, output: e.message, ok: false };
    throw e;
  }
}

/** Run one command line (commands may be chained with &&). A failed command changes nothing, except a merge, rebase or pick that stops on conflicts. */
export function runCommand(repo: Repo, line: string): CmdResult {
  let cur = repo, ok = true;
  const outs: string[] = [];
  for (const seg of splitChain(line)) {
    const res = runOne(cur, seg);
    cur = res.repo;
    if (res.output) outs.push(res.output);
    if (!res.ok) { ok = false; break; }
  }
  return { repo: cur, output: outs.join("\n"), ok };
}

/** Replace a file's text as an editor would (the lab's "edit" action). */
export function writeFile(repo: Repo, path: string, content: string): CmdResult {
  const r = cloneRepo(repo);
  try { setFile(r, path, content); return { repo: r, output: "", ok: true }; }
  catch (e) { if (e instanceof GitError) return { repo, output: e.message, ok: false }; throw e; }
}

// ── What a command changed ───────────────────────────────────────────────

/** Plain sentences describing exactly what changed between two states of the repository. */
export function describeChanges(a: Repo, b: Repo): string[] {
  const out: string[] = [];
  const subj = (id: string) => `"${subject(b.commits[id] ?? a.commits[id])}"`;
  for (const id of Object.keys(b.commits)) if (!a.commits[id]) out.push(`New commit ${short(id)} ${subj(id)}${b.commits[id].parents.length ? ` (parent${b.commits[id].parents.length > 1 ? "s" : ""} ${b.commits[id].parents.map(short).join(", ")})` : " (no parent: the first commit)"}`);
  for (const n of Object.keys(b.branches).sort()) {
    if (a.branches[n] === undefined) out.push(`Branch ${n} created at ${short(b.branches[n])}`);
    else if (a.branches[n] !== b.branches[n]) out.push(`Branch ${n} moved ${short(a.branches[n])} to ${short(b.branches[n])}`);
  }
  for (const n of Object.keys(a.branches).sort()) if (b.branches[n] === undefined) out.push(`Branch ${n} deleted (it pointed at ${short(a.branches[n])})`);
  for (const n of Object.keys(b.tags).sort()) if (a.tags[n] === undefined) out.push(`Tag ${n} created at ${short(b.tags[n])}`);
  for (const n of Object.keys(a.tags).sort()) if (b.tags[n] === undefined) out.push(`Tag ${n} deleted`);
  const hl = (r: Repo) => (r.head.kind === "branch" ? `branch ${r.head.name}` : `detached at ${short(r.head.id)}`);
  if (hl(a) !== hl(b) && b.initialized) out.push(`HEAD now points to ${hl(b)}`);
  const files = (x: Files, y: Files, area: string) => {
    for (const p of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      if (x[p] === y[p]) continue;
      out.push(`${area}: ${p} ${x[p] === undefined ? "added" : y[p] === undefined ? "removed" : "changed"}`);
    }
  };
  files(a.work, b.work, "Working tree");
  files(a.index, b.index, "Staging area");
  if (a.stash.length !== b.stash.length) out.push(`Stash: ${b.stash.length} entr${b.stash.length === 1 ? "y" : "ies"} (was ${a.stash.length})`);
  if (!a.op && b.op) out.push(`${b.op.kind} started and stopped on ${b.op.unmerged.length} conflicted file${b.op.unmerged.length === 1 ? "" : "s"}: ${b.op.unmerged.join(", ")}`);
  else if (a.op && !b.op) out.push(`${a.op.kind} finished`);
  else if (a.op && b.op && a.op.kind === "rebase" && b.op.kind === "rebase" && a.op.current !== b.op.current) out.push(`rebase moved on to commit ${b.op.done} of ${b.op.total}`);
  if (a.origHead !== b.origHead && b.origHead) out.push(`ORIG_HEAD saved as ${short(b.origHead)} (use git reset --hard ORIG_HEAD to undo)`);
  if (!out.length) out.push("Nothing changed in the repository (this command only reads).");
  return out;
}

export interface Frame {
  /** Typed command ("" for the starting state). */
  cmd: string;
  ok: boolean;
  output: string;
  repo: Repo;
  /** Why this command, in plain words (for scenarios). */
  why: string;
  changes: string[];
  newCommits: string[];
}

export const startFrame = (why: string, repo: Repo = emptyRepo()): Frame => ({ cmd: "", ok: true, output: "", repo, why, changes: [], newCommits: [] });

export function stepFrame(prev: Repo, cmd: string, why = ""): Frame {
  const res = runCommand(prev, cmd);
  return { cmd, ok: res.ok, output: res.output, repo: res.repo, why, changes: describeChanges(prev, res.repo), newCommits: Object.keys(res.repo.commits).filter((id) => !prev.commits[id]) };
}

/** A frame for "the learner edited a file by hand" (not a typed command). */
export function editFrame(prev: Repo, path: string, content: string): Frame {
  const res = writeFile(prev, path, content);
  return { cmd: `# edit ${path}`, ok: res.ok, output: res.output, repo: res.repo, why: `You changed ${path} in the working tree. Nothing is staged yet.`, changes: describeChanges(prev, res.repo), newCommits: [] };
}

export interface ScriptStep { cmd: string; why: string; /** The command is expected to fail or stop on conflicts. */ expectFail?: boolean }
export function runScript(steps: ScriptStep[], intro: string, from: Repo = emptyRepo()): Frame[] {
  const frames: Frame[] = [startFrame(intro, from)];
  for (const s of steps) frames.push(stepFrame(frames[frames.length - 1].repo, s.cmd, s.why));
  return frames;
}

// ── Commit graph layout (for the SVG) ────────────────────────────────────

export interface GraphNode { id: string; short: string; message: string; lane: number; row: number; parents: string[]; refs: string[]; isHead: boolean; isMerge: boolean; /** Not reachable from any branch, tag or HEAD (an old commit that still exists as an object). */ orphan: boolean }
export interface GraphEdge { from: string; to: string; fromLane: number; fromRow: number; toLane: number; toRow: number; second: boolean }
export interface GraphLayout { nodes: GraphNode[]; edges: GraphEdge[]; lanes: number; rows: number }

/**
 * Deterministic lane layout. Rows run newest (top) to oldest (bottom), in `topoOrder`. A branch tip claims a lane before the
 * walk starts, in this priority: the checked-out branch, main/master, other branches alphabetically, then tags and loose tips.
 * A commit sits in the first lane waiting for it; its first parent keeps the lane, other parents take free lanes.
 */
export function layoutGraph(r: Repo, opts: { includeUnreachable?: boolean } = {}): GraphLayout {
  const cur = currentBranch(r);
  const names = Object.keys(r.branches).sort((x, y) => (x === cur ? -1 : y === cur ? 1 : x === "main" ? -1 : y === "main" ? 1 : x === "master" ? -1 : y === "master" ? 1 : x < y ? -1 : 1));
  const reachableTips = [...(r.head.kind === "detached" ? [r.head.id] : []), ...names.map((n) => r.branches[n]), ...Object.keys(r.tags).sort().map((t) => r.tags[t])];
  const reach = new Set<string>();
  for (const t of reachableTips) for (const c of ancestors(r, t)) reach.add(c);
  const tips = [...new Set(reachableTips)];
  if (opts.includeUnreachable) {
    const hasChild = new Set<string>();
    for (const c of Object.values(r.commits)) for (const p of c.parents) hasChild.add(p);
    for (const id of Object.keys(r.commits).sort((x, y) => r.commits[y].tick - r.commits[x].tick)) if (!hasChild.has(id) && !reach.has(id)) tips.push(id);
  }
  const order = topoOrder(r, tips);
  const lanes: (string | null)[] = [...tips];
  const pos = new Map<string, { lane: number; row: number }>();
  let maxLane = 0;
  order.forEach((id, row) => {
    const idxs = lanes.flatMap((l, i) => (l === id ? [i] : []));
    let col = idxs[0];
    if (col === undefined) { col = lanes.indexOf(null); if (col < 0) { col = lanes.length; lanes.push(null); } }
    for (const j of idxs) lanes[j] = null;
    pos.set(id, { lane: col, row });
    maxLane = Math.max(maxLane, col);
    const ps = r.commits[id].parents;
    if (ps[0]) lanes[col] = ps[0];
    for (const p of ps.slice(1)) {
      if (lanes.includes(p)) continue;
      let slot = lanes.indexOf(null);
      if (slot < 0) { slot = lanes.length; lanes.push(null); }
      lanes[slot] = p; maxLane = Math.max(maxLane, slot);
    }
  });
  const labels = refLabels(r);
  const nodes: GraphNode[] = order.map((id) => ({ id, short: short(id), message: subject(r.commits[id]), lane: pos.get(id)!.lane, row: pos.get(id)!.row, parents: r.commits[id].parents, refs: labels[id] ?? [], isHead: headId(r) === id, isMerge: r.commits[id].parents.length > 1, orphan: !reach.has(id) }));
  const edges: GraphEdge[] = order.flatMap((id) => r.commits[id].parents.map((p, k) => ({ from: id, to: p, fromLane: pos.get(id)!.lane, fromRow: pos.get(id)!.row, toLane: pos.get(p)!.lane, toRow: pos.get(p)!.row, second: k > 0 })));
  return { nodes, edges, lanes: order.length ? maxLane + 1 : 0, rows: order.length };
}

// ── History facts ────────────────────────────────────────────────────────

export interface HistoryFacts { commits: number; merges: number; linear: boolean; tip: string | null }
/** Facts about the history reachable from a ref: how many commits, how many merge commits, and whether it is a single straight line. */
export function historyFacts(r: Repo, spec: string): HistoryFacts {
  const tip = resolveRev(r, spec);
  if (!tip) return { commits: 0, merges: 0, linear: true, tip: null };
  const all = [...ancestors(r, tip)];
  const merges = all.filter((c) => r.commits[c].parents.length > 1).length;
  return { commits: all.length, merges, linear: merges === 0 && all.every((c) => all.filter((d) => r.commits[d].parents.includes(c)).length <= 1), tip };
}

/** Validate that the object graph is sound: every parent exists, ids match their content, no cycles, refs point at commits. */
export function checkIntegrity(r: Repo): string[] {
  const problems: string[] = [];
  for (const c of Object.values(r.commits)) {
    for (const p of c.parents) if (!r.commits[p]) problems.push(`commit ${short(c.id)} has missing parent ${short(p)}`); else if (r.commits[p].tick >= c.tick) problems.push(`commit ${short(c.id)} is not newer than its parent ${short(p)}`);
    if (commitIdOf(commitText(treeId(c.tree), c.parents, c.tick, c.message)) !== c.id) problems.push(`commit ${short(c.id)} id does not match its content`);
  }
  for (const [n, id] of Object.entries({ ...r.branches, ...r.tags })) if (!r.commits[id]) problems.push(`ref ${n} points at a missing commit`);
  if (r.head.kind === "detached" && !r.commits[r.head.id]) problems.push("HEAD points at a missing commit");
  return problems;
}

// ── Merge versus rebase: the same starting repository, run both ways ─────

export type CompareVariant = "clean" | "conflict";
export interface Rewritten { message: string; oldId: string; newId: string }
export interface CompareOutcome {
  title: string;
  /** Commands run from the shared starting point, including the lab's `resolve` helper for conflicts. */
  steps: string[];
  frames: Frame[];
  repo: Repo;
  facts: HistoryFacts;
  /** How many times the run stopped and a person had to resolve conflicts. */
  conflictStops: number;
  rewritten: Rewritten[];
  /** Id of the final tree on main (equal ids mean identical files). */
  finalTree: string;
}
export interface MergeRebaseComparison { start: Repo; startSteps: string[]; merge: CompareOutcome; rebase: CompareOutcome; sameFinalFiles: boolean }

const A = (s: string) => `echo "${s}"`;
const SETUP: Record<CompareVariant, string[]> = {
  clean: [
    "git init", `${A("# Project")} > README.md`, 'git add . && git commit -m "Initial commit"',
    "git switch -c feature", `${A("export")} > export.txt`, 'git add . && git commit -m "Add export"', `${A("report")} > report.txt`, 'git add . && git commit -m "Add report"',
    "git switch main", `${A("fix")} > fix.txt`, 'git add . && git commit -m "Fix typo"', `${A("docs")} > docs.txt`, 'git add . && git commit -m "Update docs"',
  ],
  conflict: [
    "git init", `${A("theme=light")} > settings.txt`, 'git add . && git commit -m "Initial commit"',
    "git switch -c feature", `${A("theme=blue")} > settings.txt`, 'git commit -am "Blue theme"', `${A("theme=teal")} > settings.txt`, 'git commit -am "Teal theme"',
    "git switch main", `${A("theme=dark")} > settings.txt`, 'git commit -am "Dark theme"', `${A("docs")} > docs.txt`, 'git add . && git commit -m "Update docs"',
  ],
};

/** Run `cmd`; while it leaves conflicts, resolve every file with `both`, stage it and continue, recording every command. */
function runResolving(start: Repo, cmds: string[], cont: (r: Repo) => string): { frames: Frame[]; steps: string[]; stops: number } {
  const frames: Frame[] = [startFrame("Both runs start from the same repository.", start)];
  const steps: string[] = [];
  let stops = 0;
  const go = (cmd: string, why = "") => { const f = stepFrame(frames[frames.length - 1].repo, cmd, why); frames.push(f); steps.push(cmd); return f; };
  for (const c of cmds) {
    go(c);
    for (let guard = 0; frames[frames.length - 1].repo.op && guard < 20; guard++) {
      stops += 1;
      const op = frames[frames.length - 1].repo.op!;
      for (const p of [...op.unmerged]) { go(`resolve ${p} both`); go(`git add ${p}`); }
      go(cont(frames[frames.length - 1].repo));
    }
  }
  return { frames, steps, stops };
}

/**
 * Build the same repository twice: `main` and `feature` have diverged. One run merges feature into main; the other rebases
 * feature onto main and then fast-forwards main. The "conflict" variant makes both branches edit the same line.
 */
export function compareMergeRebase(variant: CompareVariant = "clean"): MergeRebaseComparison {
  const setup = runScript(SETUP[variant].map((cmd) => ({ cmd, why: "" })), "");
  const start = setup[setup.length - 1].repo;
  const cont = (kind: "commit" | "rebase") => (r: Repo) => (r.op?.kind === "rebase" || kind === "rebase" ? "git rebase --continue" : "git commit");
  const m = runResolving(start, ["git merge feature"], cont("commit"));
  const rb = runResolving(start, ["git switch feature", "git rebase main", "git switch main", "git merge feature"], cont("rebase"));
  const mergeRepo = m.frames[m.frames.length - 1].repo, rebaseRepo = rb.frames[rb.frames.length - 1].repo;
  const oldTip = start.branches.feature, mainTip = start.branches.main;
  const oldChain = commitsToReplay(start, oldTip, mainTip), newChain = commitsToReplay(rebaseRepo, rebaseRepo.branches.feature, mainTip);
  const rewritten = oldChain.map((oldId, i) => ({ message: subject(start.commits[oldId]), oldId, newId: newChain[i] }));
  const tree = (r: Repo) => r.commits[r.branches.main].treeId;
  return {
    start, startSteps: SETUP[variant],
    merge: { title: "git merge feature", steps: m.steps, frames: m.frames, repo: mergeRepo, facts: historyFacts(mergeRepo, "main"), conflictStops: m.stops, rewritten: [], finalTree: tree(mergeRepo) },
    rebase: { title: "git rebase main, then merge", steps: rb.steps, frames: rb.frames, repo: rebaseRepo, facts: historyFacts(rebaseRepo, "main"), conflictStops: rb.stops, rewritten, finalTree: tree(rebaseRepo) },
    sameFinalFiles: tree(mergeRepo) === tree(rebaseRepo),
  };
}

// ── Presets (guided scenarios) ───────────────────────────────────────────

export interface GitPreset { id: string; label: string; teaches: string; steps: ScriptStep[] }

export const PRESETS: GitPreset[] = [
  { id: "first-commit", label: "First commit", teaches: "init, the three areas, add, commit, log", steps: [
    { cmd: "git init", why: "Create the repository. The history is empty and HEAD points at a branch called main that has no commit yet." },
    { cmd: `${A("# Sales report")} > README.md`, why: "Create a file in the working tree. Git has not been told about it, so it is untracked." },
    { cmd: "git status", why: "Status compares the three areas. The new file is only in the working tree." },
    { cmd: "git add README.md", why: "Copy the file into the staging area (the index). This chooses what the next commit will contain." },
    { cmd: "git status", why: "The file is now in the working tree and the staging area, but not yet in the repository." },
    { cmd: 'git commit -m "Add README"', why: "Turn the staged snapshot into a commit. It has no parent because it is the first. The branch main now points at it." },
    { cmd: `${A("Revenue by region")} >> README.md`, why: "Edit the file again. The working tree now differs from the staging area and from the commit." },
    { cmd: 'git commit -am "Add summary line"', why: "-a stages every change to tracked files before committing. The new commit's parent is the first commit." },
    { cmd: "git log --oneline", why: "The log walks parent links from HEAD: newest commit first." },
  ] },
  { id: "branching", label: "Branching", teaches: "a branch is a movable pointer; commits move only the current branch", steps: [
    { cmd: "git init", why: "Start a repository." },
    { cmd: `${A("line 1")} > notes.txt`, why: "Create a file in the working tree. It is not tracked yet." },
    { cmd: 'git add . && git commit -m "Add notes"', why: "One commit on main." },
    { cmd: "git branch feature", why: "Create a branch: just a new pointer to the same commit. Nothing is copied." },
    { cmd: "git switch feature", why: "Move HEAD to the new branch. The files do not change because both branches point at the same commit." },
    { cmd: `${A("feature line")} >> notes.txt`, why: "Edit the file on the feature branch." },
    { cmd: 'git commit -am "Add feature line"', why: "The new commit moves only the feature pointer; main stays where it was." },
    { cmd: "git switch main", why: "Switching back rewrites the working tree to main's snapshot." },
    { cmd: "cat notes.txt", why: "The feature line is not here: it lives only on the feature branch." },
    { cmd: "git log --oneline --graph --all", why: "--all shows every branch. Two pointers, two different commits." },
    { cmd: "git branch -v", why: "Branches are just names and the commit each points at. * marks the one HEAD is on." },
    { cmd: "git switch --detach feature", why: "Detached HEAD: HEAD points straight at a commit instead of at a branch name. You can look around, but a commit made now belongs to no branch." },
    { cmd: "git status", why: "Status says HEAD is detached. To keep new work, create a branch here with git switch -c <name>." },
    { cmd: "git switch main", why: "Re-attach HEAD to a branch." },
  ] },
  { id: "fast-forward-merge", label: "Fast-forward merge", teaches: "when main has not moved, merge only moves the pointer", steps: [
    { cmd: "git init", why: "Start a repository." },
    { cmd: `${A("app v1")} > app.txt`, why: "Create a file in the working tree. It is not tracked yet." },
    { cmd: 'git add . && git commit -m "Add app"', why: "The base commit on main." },
    { cmd: "git switch -c feature", why: "Create and switch to feature in one step." },
    { cmd: `${A("feature A")} >> app.txt`, why: "Edit the file while on the feature branch." },
    { cmd: 'git commit -am "Add feature A"', why: "First feature commit." },
    { cmd: `${A("feature B")} >> app.txt`, why: "Edit the file again on feature." },
    { cmd: 'git commit -am "Add feature B"', why: "Second feature commit. main has not moved since feature branched off." },
    { cmd: "git switch main", why: "Go back to the branch that will receive the work." },
    { cmd: "git merge feature", why: "main is an ancestor of feature, so there is nothing to combine: Git moves the main pointer forward (a fast-forward). No merge commit is created." },
    { cmd: "git log --oneline --graph --all", why: "One straight line. Both branch names point at the same commit." },
  ] },
  { id: "three-way-merge", label: "Three-way merge", teaches: "diverged branches, merge-base, a merge commit with two parents", steps: [
    { cmd: "git init", why: "Start a repository." },
    { cmd: `${A("base")} > a.txt`, why: "Create a file in the working tree. It is not tracked yet." },
    { cmd: 'git add . && git commit -m "Add a.txt"', why: "The common ancestor of both branches (the merge base)." },
    { cmd: "git switch -c feature", why: "Create a branch and move HEAD onto it." },
    { cmd: `${A("feature work")} > c.txt`, why: "A new file only on feature." },
    { cmd: 'git add . && git commit -m "Add c.txt"', why: "feature moves one commit ahead." },
    { cmd: "git switch main", why: "Switch back to main; the working tree follows." },
    { cmd: `${A("main work")} > b.txt`, why: "A different new file on main." },
    { cmd: 'git add . && git commit -m "Add b.txt"', why: "Now both branches have a commit the other lacks: their histories have diverged." },
    { cmd: "git merge feature", why: "Neither branch contains the other, so Git finds the merge base (the commit where they split), combines both sets of changes and records a merge commit with two parents." },
    { cmd: "git log --oneline --graph", why: "The graph shows the split and the merge commit joining both lines." },
    { cmd: "ls", why: "The working tree now has the files from both branches." },
  ] },
  { id: "merge-conflict", label: "Merge conflict", teaches: "same line changed on both branches, conflict markers, resolve and finish", steps: [
    { cmd: "git init", why: "Start a repository." },
    { cmd: `${A("title: Sales")} > report.txt`, why: "Create a one-line file to fight over later." },
    { cmd: 'git add . && git commit -m "Add report"', why: "This commit becomes the merge base: the last commit both branches share." },
    { cmd: "git switch -c feature", why: "Create a branch and move HEAD onto it." },
    { cmd: `${A("title: Sales 2026")} > report.txt`, why: "Change line 1 on feature." },
    { cmd: 'git commit -am "Retitle on feature"', why: "Commit on feature." },
    { cmd: "git switch main", why: "Switch back to main; the working tree follows." },
    { cmd: `${A("title: Revenue")} > report.txt`, why: "Change the same line on main, differently." },
    { cmd: 'git commit -am "Retitle on main"', why: "Record the main-side change as a commit." },
    { cmd: "git merge feature", why: "Both sides changed the same line since the merge base, so Git cannot choose. It stops, writes conflict markers into the file and waits.", expectFail: true },
    { cmd: "git status", why: "The file is listed as unmerged (both modified). The merge is still in progress." },
    { cmd: "cat report.txt", why: "Between <<<<<<< and ======= is our side (HEAD, main); between ======= and >>>>>>> is theirs (feature)." },
    { cmd: "resolve report.txt both", why: "Choose a resolution, here keeping both lines. In a real editor you would edit the text and delete the three marker lines." },
    { cmd: "git add report.txt", why: "Staging the file tells Git the conflict in it is resolved." },
    { cmd: "git commit", why: "With every conflict resolved, commit to finish the merge. Git supplies the merge message." },
    { cmd: "git log --oneline --graph", why: "A merge commit with two parents, as for any merge of diverged branches." },
  ] },
  { id: "rebase-vs-merge", label: "Rebase vs merge", teaches: "rebase replays commits on a new base: a straight line but new commit ids", steps: [
    { cmd: "git init", why: "Start a repository." },
    { cmd: `${A("# Project")} > README.md`, why: "Create a file in the working tree. It is not tracked yet." },
    { cmd: 'git add . && git commit -m "Initial commit"', why: "The common starting point." },
    { cmd: "git switch -c feature", why: "Create a branch and move HEAD onto it." },
    { cmd: `${A("export")} > export.txt`, why: "New file for the feature." },
    { cmd: 'git add . && git commit -m "Add export"', why: "First feature commit." },
    { cmd: `${A("report")} > report.txt`, why: "Another new file." },
    { cmd: 'git add . && git commit -m "Add report"', why: "Second feature commit." },
    { cmd: "git switch main", why: "main moves on while the feature is in progress." },
    { cmd: `${A("fix")} > fix.txt`, why: "Meanwhile a fix lands on main." },
    { cmd: 'git add . && git commit -m "Fix typo"', why: "main is now one commit ahead of the point where feature branched." },
    { cmd: "git log --oneline --graph --all", why: "Diverged histories. Note the ids of the two feature commits." },
    { cmd: "git switch feature", why: "Rebase is run from the branch being moved." },
    { cmd: "git rebase main", why: "Git replays each feature commit on top of main, one at a time, creating new commits with the same changes and messages but new parents, hence new ids." },
    { cmd: "git log --oneline --graph --all", why: "A straight line. The feature commits have different ids from before; the old ones still exist but no branch points at them." },
  ] },
  { id: "reset-modes", label: "Reset modes", teaches: "--soft, --mixed and --hard move the branch and differ in what they do to the other two areas", steps: [
    { cmd: "git init", why: "Start a repository." },
    { cmd: `${A("one")} > f.txt`, why: "Write the first version of the file." },
    { cmd: 'git add . && git commit -m "Version 1"', why: "Record the first snapshot as a commit." },
    { cmd: `${A("two")} >> f.txt`, why: "Add a second line to the file." },
    { cmd: 'git commit -am "Version 2"', why: "Record the second snapshot as a commit." },
    { cmd: `${A("three")} >> f.txt`, why: "Add a third line to the file." },
    { cmd: 'git commit -am "Version 3"', why: "Record the third snapshot as a commit." },
    { cmd: "git reset --soft HEAD~1", why: "--soft moves only the branch back one commit. The staging area and working tree keep Version 3's content, so it shows as staged." },
    { cmd: "git status", why: "The change from Version 3 is staged, ready to be committed again." },
    { cmd: 'git commit -m "Version 3 again"', why: "Recommit it (a new commit, so a new id)." },
    { cmd: "git reset --mixed HEAD~1", why: "--mixed (the default) moves the branch and also resets the staging area. The working tree is untouched, so the change is now unstaged." },
    { cmd: "git status", why: "The change is still in the file but no longer staged." },
    { cmd: "git add . && git commit -m \"Version 3 once more\"", why: "Commit the staged change again." },
    { cmd: "git reset --hard HEAD~1", why: "--hard moves the branch and resets the staging area and the working tree: the content of Version 3 is thrown away from your files." },
    { cmd: "git status", why: "Clean: the file is back to Version 2." },
    { cmd: "git reset --hard ORIG_HEAD", why: "ORIG_HEAD remembers where HEAD was before the reset, so a hard reset can be undone while the commit still exists." },
    { cmd: "cat f.txt", why: "The lines are back." },
  ] },
  { id: "staging-area", label: "Staging area", teaches: "choose what goes into a commit; compare working tree, index and HEAD", steps: [
    { cmd: "git init", why: "Start a repository." },
    { cmd: `${A("def total(): pass")} > calc.py`, why: "Create a small code file." },
    { cmd: `${A("# Notes")} > notes.md`, why: "Create a notes file." },
    { cmd: 'git add . && git commit -m "Add calc and notes"', why: "Both files committed." },
    { cmd: `${A("def mean(): pass")} >> calc.py`, why: "Change the code file in the working tree." },
    { cmd: `${A("todo: write tests")} >> notes.md`, why: "Change the notes: an unrelated change." },
    { cmd: "git status -s", why: "Two files modified in the working tree, none staged (the second column shows M)." },
    { cmd: "git add calc.py", why: "Stage only the code change so the commit stays focused." },
    { cmd: "git status -s", why: "calc.py is now staged (M in the first column); notes.md is still unstaged." },
    { cmd: "git diff", why: "git diff compares the working tree with the staging area: only the unstaged notes change." },
    { cmd: "git diff --staged", why: "--staged compares the staging area with the last commit: the code change that will be committed." },
    { cmd: 'git commit -m "Add mean function"', why: "Only the staged change is committed." },
    { cmd: "git status -s", why: "The notes change is still pending." },
    { cmd: 'git commit -am "Add todo note"', why: "-a stages tracked changes, then commits." },
    { cmd: "git log --oneline", why: "Two focused commits instead of one mixed commit." },
  ] },
  { id: "undo-changes", label: "Undo changes", teaches: "restore, unstage, revert, stash, cherry-pick and tags: undoing safely", steps: [
    { cmd: "git init", why: "Start a repository." },
    { cmd: `${A("price = 10")} > shop.py`, why: "Create a file with one line." },
    { cmd: 'git add . && git commit -m "Add price"', why: "Record the first snapshot as a commit." },
    { cmd: "git tag good-state", why: "A tag is a permanent name for a commit: a bookmark you can come back to." },
    { cmd: `${A("price = 999")} > shop.py`, why: "A mistake in the working tree." },
    { cmd: "git restore shop.py", why: "Discard the working-tree change by copying the file back from the staging area. This cannot be undone: the edit was never committed." },
    { cmd: "cat shop.py", why: "Back to price = 10." },
    { cmd: `${A("price = 12")} > shop.py`, why: "Make a change you do want to keep." },
    { cmd: "git add shop.py", why: "Copy the change into the staging area." },
    { cmd: "git restore --staged shop.py", why: "Unstage it: the staging area goes back to HEAD, while your edit stays in the working tree." },
    { cmd: "git stash", why: "Stash saves the modified tracked files and cleans the working tree so you can switch tasks." },
    { cmd: "git status", why: "Clean working tree. The change is parked in the stash." },
    { cmd: "git stash pop", why: "Bring the change back and drop the stash entry." },
    { cmd: 'git commit -am "Raise price"', why: "Record the second snapshot as a commit." },
    { cmd: `${A("price = 0")} > shop.py`, why: "Now a bad change appears in the file..." },
    { cmd: 'git commit -am "Set price to zero"', why: "...that gets committed." },
    { cmd: "git revert HEAD", why: "Revert adds a NEW commit that undoes the change. History is kept, so it is safe on shared branches." },
    { cmd: "git log --oneline", why: "The bad commit and its revert are both in the history." },
    { cmd: "git switch -c hotfix", why: "Another branch for a separate fix." },
    { cmd: `${A("tax = 5")} > tax.py`, why: "A new file for the fix." },
    { cmd: 'git add . && git commit -m "Add tax"', why: "A commit on hotfix." },
    { cmd: "git switch main", why: "Switch back to main; the working tree follows." },
    { cmd: "git cherry-pick hotfix", why: "cherry-pick copies one commit onto the current branch as a new commit (new id, same change), without merging the whole branch." },
    { cmd: "git log --oneline --all", why: "The copy on main and the original on hotfix are two different commits." },
  ] },
];

export const SUPPORTED_COMMANDS = ["init", "add", "rm", "restore", "commit (-m, -a, --amend, --allow-empty)", "status (-s)", "diff (--staged, revs, --stat, --name-only)", "show", "log (--oneline, --graph, --all, -n, a..b, --format)", "branch (create, list, -d, -D, -m, -v)", "switch / checkout", "merge (fast-forward, three-way, --no-ff, --ff-only, --abort)", "rebase (--continue, --skip, --abort)", "reset (--soft, --mixed, --hard, paths)", "revert", "cherry-pick", "stash (push, list, pop, apply, drop)", "tag (lightweight)", "rev-parse, rev-list --count, cat-file -p"];

/** What the lab does not model, shown to the learner and reported to the teacher. */
export const NOT_IMPLEMENTED = [
  "Remotes: clone, fetch, pull, push, remote, upstream tracking, pull requests",
  "Interactive rebase (-i), rebase --onto, --rebase-merges, and skipping commits whose patch is already upstream; merge commits are dropped by a rebase",
  "Annotated and signed tags (only lightweight tags), reflog (only ORIG_HEAD), git bisect, blame, worktree, submodules, hooks, gc, fsck",
  ".gitignore, git config (the identity is fixed), git mv, add -p, checkout <rev> -- <path>, restore --source, wildcards and globs in paths, the current directory (all paths are relative to the project root)",
  "Binary files, executable bits, symlinks, line endings, files without a final newline, renames (a rename is a delete plus an add), file modes",
  "Merge strategies and options (octopus, -X, -s), a virtual merge base for criss-cross histories (the lab picks one base), rename detection, diff3 or zdiff3 conflict style, merge --squash",
  "Stash of untracked files (-u), stash --index, stash branch; stash apply into a conflicting working tree keeps markers but does not mark the paths unmerged",
  "git commit during a rebase conflict (the lab asks for --continue), revert -m, cherry-pick ranges, -x, --no-commit, commit --fixup, an editor for messages (use -m)",
  "git log filters (--author, --since, -S, pathspecs), --stat in log, reset --keep and --merge",
  "Limits: 40 files and 300 lines per file",
];
