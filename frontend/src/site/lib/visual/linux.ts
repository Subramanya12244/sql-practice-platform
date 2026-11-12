/**
 * Linux Terminal Lab engine. A SIMULATED shell over an in-memory virtual file system seeded with safe fixtures.
 * Nothing here touches the real machine: there is no file, network, process or child-process API in this module, every
 * path is resolved inside the virtual tree, and the "processes" are rows of a fixture table. Behaviour and error text
 * follow GNU/bash for the commands it implements; everything else is listed in UNSUPPORTED. Pure TypeScript, no React.
 */

// ── Virtual file system ──────────────────────────────────────────────────
export interface FNode { kind: "file" | "dir"; mode: number; owner: string; group: string; mtime: number; data: string; kids: Map<string, FNode> }
export interface User { name: string; uid: number; groups: string[] }
export const USERS: Record<string, User> = {
  root: { name: "root", uid: 0, groups: ["root"] },
  learner: { name: "learner", uid: 1000, groups: ["learner", "staff"] },
  alice: { name: "alice", uid: 1001, groups: ["alice", "staff"] },
  postgres: { name: "postgres", uid: 112, groups: ["postgres"] },
};
const GROUPS = new Set(["root", "learner", "alice", "staff", "adm", "shadow", "postgres"]);

export interface Proc { pid: number; ppid: number; user: string; cpu: number; mem: number; vsz: number; rss: number; stat: string; start: string; time: string; cmd: string; ignoresTerm?: boolean }

export interface Session {
  root: FNode; cwd: string; user: User; env: Record<string, string>; history: string[]; procs: Proc[];
  status: number; clock: number; nextPid: number; oldPwd: string;
}

export const LIMITS = { line: 2000, output: 200_000, fileBytes: 100_000, nodes: 3000, commands: 400, scriptDepth: 3 } as const;

const mk = (kind: FNode["kind"], mode: number, owner: string, group: string, mtime: number, data = ""): FNode => ({ kind, mode, owner, group, mtime, data, kids: new Map() });
const dirNode = (mode: number, owner: string, group: string, mtime: number) => mk("dir", mode, owner, group, mtime);
const fileNode = (mode: number, owner: string, group: string, mtime: number, data: string) => mk("file", mode, owner, group, mtime, data);

/** Minutes after 2025-03-06 09:00 UTC. Negative = earlier. Every command advances this virtual clock by one minute. */
export const CLOCK_BASE = Date.UTC(2025, 2, 6, 9, 0);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtTime = (m: number) => { const d = new Date(CLOCK_BASE + m * 60000); return `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const DAY = 1440;

// Deterministic fixture log lines (no randomness, so the same commands always give the same output).
const LEVELS = ["INFO", "INFO", "INFO", "WARN", "INFO", "ERROR", "INFO", "DEBUG"];
const MSGS = ["service started", "request handled", "cache refreshed", "slow query detected", "user login", "disk write failed", "job finished", "connection pool size 8"];
const appLog = Array.from({ length: 40 }, (_, i) => `2025-03-05 10:${String(i).padStart(2, "0")}:00 ${LEVELS[i % 8]} ${MSGS[i % 8]} id=${100 + i}`).join("\n") + "\n";
const errorLog = Array.from({ length: 8 }, (_, i) => `2025-03-05 11:${String(i * 5).padStart(2, "0")}:12 ERROR code=E${100 + (i % 3)} ${["timeout", "disk full", "bad input"][i % 3]}`).join("\n") + "\n";
const IPS = ["10.0.0.5", "10.0.0.7", "10.0.0.5", "192.168.1.20", "10.0.0.5", "10.0.0.9", "10.0.0.7", "172.16.4.2", "10.0.0.5", "192.168.1.20", "10.0.0.7", "10.0.0.5"];
const PATHS = ["/", "/login", "/api/items", "/api/items", "/health"];
const accessLog = Array.from({ length: 60 }, (_, i) => `${IPS[i % 12]} - - [05/Mar/2025:12:${String(i).padStart(2, "0")}:00] "GET ${PATHS[i % 5]}" ${i % 7 === 0 ? 404 : 200} ${200 + i * 13}`).join("\n") + "\n";
const debugLog = Array.from({ length: 25 }, (_, i) => `2025-03-05 09:${String(i).padStart(2, "0")}:00 DEBUG tick ${i}`).join("\n") + "\n";
const archiveLog = Array.from({ length: 120 }, (_, i) => `2025-02-${String(1 + (i % 28)).padStart(2, "0")} 08:00:00 INFO archived entry ${i}`).join("\n") + "\n";
const salesCsv = "id,region,product,qty,amount\n1,North,Pen,3,30\n2,South,Pen,1,10\n3,North,Book,2,40\n4,East,Book,5,100\n5,South,Book,1,20\n6,North,Pen,4,40\n7,East,Pen,2,20\n";
const wordsTxt = "banana\napple\ncherry\napple\nbanana\napple\ndate\nElderberry\nfig\n";
const usersCsv = "name,city,age\nada,london,36\ngrace,new york,45\nalan,manchester,41\nmargaret,boston,52\n";

export function createFs(): FNode {
  const root = dirNode(0o755, "root", "root", -9 * DAY);
  const put = (path: string, n: FNode) => {
    const parts = path.split("/").filter(Boolean), name = parts.pop()!;
    let cur = root;
    for (const p of parts) cur = cur.kids.get(p)!;
    cur.kids.set(name, n);
  };
  const L = "learner";
  for (const d of ["home", "var", "etc", "tmp", "srv", "usr"]) put(d, dirNode(0o755, "root", "root", -9 * DAY));
  root.kids.get("tmp")!.mode = 0o1777;
  put("home/learner", dirNode(0o755, L, L, -1 * DAY));
  put("home/alice", dirNode(0o700, "alice", "alice", -3 * DAY));
  put("home/alice/private.txt", fileNode(0o600, "alice", "alice", -3 * DAY, "alice's private notes\n"));
  put("home/learner/notes.txt", fileNode(0o644, L, L, -2 * DAY, "Remember to review the logs.\nCall the data team.\nBuy coffee.\n"));
  put("home/learner/todo.txt", fileNode(0o644, L, L, -1 * DAY, "1. learn pipes\n2. learn chmod\n3. learn grep\n"));
  put("home/learner/secret.txt", fileNode(0o600, L, L, -4 * DAY, "api_key=demo-not-a-real-key\n"));
  put("home/learner/.bashrc", fileNode(0o644, L, L, -8 * DAY, "# simulated .bashrc\nexport PS1='$ '\n"));
  put("home/learner/.hidden", fileNode(0o644, L, L, -8 * DAY, "a hidden file\n"));
  put("home/learner/docs", dirNode(0o755, L, L, -5 * DAY));
  put("home/learner/docs/readme.md", fileNode(0o644, L, L, -5 * DAY, "# Project readme\n\nUse the logs folder for examples.\n"));
  put("home/learner/data", dirNode(0o755, L, L, -3 * DAY));
  put("home/learner/data/sales.csv", fileNode(0o644, L, L, -3 * DAY, salesCsv));
  put("home/learner/data/users.csv", fileNode(0o644, L, L, -3 * DAY, usersCsv));
  put("home/learner/data/words.txt", fileNode(0o644, L, L, -3 * DAY, wordsTxt));
  put("home/learner/logs", dirNode(0o755, L, L, -1 * DAY));
  put("home/learner/logs/app.log", fileNode(0o644, L, L, -1 * DAY, appLog));
  put("home/learner/logs/error.log", fileNode(0o644, L, L, -1 * DAY, errorLog));
  put("home/learner/logs/access.log", fileNode(0o644, L, L, -1 * DAY, accessLog));
  put("home/learner/logs/debug.log", fileNode(0o644, L, L, -1 * DAY, debugLog));
  put("home/learner/logs/notes.txt", fileNode(0o644, L, L, -1 * DAY, "rotate weekly\n"));
  put("home/learner/logs/old", dirNode(0o755, L, L, -6 * DAY));
  put("home/learner/logs/old/archive.log", fileNode(0o644, L, L, -6 * DAY, archiveLog));
  put("home/learner/scripts", dirNode(0o755, L, L, -2 * DAY));
  put("home/learner/scripts/backup.sh", fileNode(0o644, L, L, -2 * DAY, "#!/bin/bash\n# copy the notes into a backup folder\nmkdir -p backup\ncp notes.txt backup/notes.txt\necho backup finished\n"));
  put("var/log", dirNode(0o755, "root", "root", -9 * DAY));
  put("var/log/syslog", fileNode(0o640, "root", "adm", -1 * DAY, "Mar  5 03:00:01 host CRON[101]: job ran\nMar  5 03:00:02 host kernel: simulated message\n"));
  put("var/log/auth.log", fileNode(0o600, "root", "root", -1 * DAY, "Mar  5 04:00:00 host sshd[212]: simulated login\n"));
  put("var/log/dpkg.log", fileNode(0o644, "root", "root", -7 * DAY, "2025-02-27 install demo-package\n"));
  put("etc/passwd", fileNode(0o644, "root", "root", -9 * DAY, "root:x:0:0:root:/root:/bin/bash\nlearner:x:1000:1000:Learner:/home/learner:/bin/bash\nalice:x:1001:1001:Alice:/home/alice:/bin/bash\npostgres:x:112:112::/var/lib/postgresql:/bin/bash\n"));
  put("etc/shadow", fileNode(0o640, "root", "shadow", -9 * DAY, "root:!:19000:0:99999:7:::\n"));
  put("etc/hostname", fileNode(0o644, "root", "root", -9 * DAY, "dataforge-lab\n"));
  put("srv/team", dirNode(0o775, "alice", "staff", -2 * DAY));
  put("srv/team/report.txt", fileNode(0o664, "alice", "staff", -2 * DAY, "Team report draft\n"));
  put("srv/team/alice-only.txt", fileNode(0o600, "alice", "alice", -2 * DAY, "only alice can read this\n"));
  return root;
}

const PROC_FIXTURE: Proc[] = [
  { pid: 1, ppid: 0, user: "root", cpu: 0, mem: 0.1, vsz: 168_000, rss: 11_000, stat: "Ss", start: "Mar03", time: "0:03", cmd: "/sbin/init" },
  { pid: 212, ppid: 1, user: "root", cpu: 0, mem: 0.2, vsz: 15_400, rss: 8_900, stat: "Ss", start: "Mar03", time: "0:00", cmd: "/usr/sbin/sshd -D" },
  { pid: 340, ppid: 1, user: "root", cpu: 0, mem: 0.1, vsz: 8_500, rss: 3_100, stat: "Ss", start: "Mar03", time: "0:00", cmd: "/usr/sbin/cron -f" },
  { pid: 512, ppid: 1, user: "alice", cpu: 1.2, mem: 0.8, vsz: 41_000, rss: 25_000, stat: "S", start: "Mar05", time: "0:12", cmd: "vim todo.md" },
  { pid: 701, ppid: 1, user: "postgres", cpu: 2.3, mem: 3.1, vsz: 220_000, rss: 98_000, stat: "Ss", start: "Mar03", time: "1:20", cmd: "postgres: main" },
  { pid: 777, ppid: 212, user: "learner", cpu: 0, mem: 0.2, vsz: 10_800, rss: 5_200, stat: "Ss", start: "09:00", time: "0:00", cmd: "-bash" },
  { pid: 801, ppid: 777, user: "learner", cpu: 12.5, mem: 1.4, vsz: 88_000, rss: 41_000, stat: "S", start: "09:01", time: "0:45", cmd: "python etl_worker.py" },
  { pid: 802, ppid: 777, user: "learner", cpu: 87, mem: 0.9, vsz: 54_000, rss: 28_000, stat: "R", start: "09:02", time: "4:10", cmd: "stuck_job --no-signal-handlers", ignoresTerm: true },
  { pid: 903, ppid: 777, user: "learner", cpu: 0, mem: 0, vsz: 7_400, rss: 700, stat: "S", start: "09:03", time: "0:00", cmd: "sleep 600" },
];

export function createSession(): Session {
  return {
    root: createFs(), cwd: "/home/learner", user: USERS.learner, oldPwd: "/home/learner",
    env: { HOME: "/home/learner", USER: "learner", PWD: "/home/learner", SHELL: "/bin/bash", LANG: "C", PATH: "/usr/local/bin:/usr/bin:/bin", HOSTNAME: "dataforge-lab" },
    history: [], procs: PROC_FIXTURE.map((p) => ({ ...p })), status: 0, clock: 0, nextPid: 1000,
  };
}
const cloneNode = (n: FNode): FNode => ({ ...n, kids: new Map([...n.kids].map(([k, v]) => [k, cloneNode(v)])) });
export function cloneSession(s: Session): Session {
  return { ...s, root: cloneNode(s.root), env: { ...s.env }, history: [...s.history], procs: s.procs.map((p) => ({ ...p })) };
}
const countNodes = (n: FNode): number => 1 + [...n.kids.values()].reduce((a, k) => a + countNodes(k), 0);

// ── Paths, permissions, lookups ──────────────────────────────────────────
export type FsErr = "ENOENT" | "EACCES" | "ENOTDIR" | "EEXIST" | "EISDIR" | "ENOTEMPTY" | "EPERM";
export const ERR_TEXT: Record<FsErr, string> = { ENOENT: "No such file or directory", EACCES: "Permission denied", ENOTDIR: "Not a directory", EEXIST: "File exists", EISDIR: "Is a directory", ENOTEMPTY: "Directory not empty", EPERM: "Operation not permitted" };

/** Normalise a path against cwd into an absolute path ("." and ".." resolved, "..", at the root, stays at the root). */
export function absPath(cwd: string, p: string): string {
  const out: string[] = [];
  for (const c of (p.startsWith("/") ? p : cwd + "/" + p).split("/")) { if (c === "" || c === ".") continue; if (c === "..") out.pop(); else out.push(c); }
  return "/" + out.join("/");
}
const baseName = (p: string) => (p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1));

export type Perm = "r" | "w" | "x";
const BIT: Record<Perm, number> = { r: 4, w: 2, x: 1 };
/** Classic UNIX check: the owner class applies if you own the file, else the group class if you are in its group, else other. */
export function permClass(user: User, n: FNode): "owner" | "group" | "other" { return user.name === n.owner ? "owner" : user.groups.includes(n.group) ? "group" : "other"; }
export function can(user: User, n: FNode, p: Perm): boolean {
  if (user.uid === 0) return p !== "x" || n.kind === "dir" || (n.mode & 0o111) !== 0;
  const shift = { owner: 6, group: 3, other: 0 }[permClass(user, n)];
  return ((n.mode >> shift) & BIT[p]) !== 0;
}

export type Look = { ok: true; node: FNode; abs: string; parent: FNode | null; name: string } | { ok: false; err: FsErr; abs: string; parent?: FNode; name?: string };
/** Walk the tree; every directory passed through needs the execute ("search") bit, which is why a locked folder hides its children. */
export function lookup(s: Session, abs: string): Look {
  const parts = abs.split("/").filter(Boolean);
  let cur = s.root, parent: FNode | null = null;
  for (let i = 0; i < parts.length; i++) {
    if (cur.kind !== "dir") return { ok: false, err: "ENOTDIR", abs };
    if (!can(s.user, cur, "x")) return { ok: false, err: "EACCES", abs };
    const next = cur.kids.get(parts[i]);
    if (!next) return i === parts.length - 1 ? { ok: false, err: "ENOENT", abs, parent: cur, name: parts[i] } : { ok: false, err: "ENOENT", abs };
    parent = cur; cur = next;
  }
  return { ok: true, node: cur, abs, parent, name: parts[parts.length - 1] ?? "/" };
}

const rwx = (m: number) => ((m & 4) ? "r" : "-") + ((m & 2) ? "w" : "-") + ((m & 1) ? "x" : "-");
/** "drwxr-xr-x": type, then owner, group and other triplets; s/t show the setuid, setgid and sticky bits. */
export function modeString(n: FNode): string {
  const t = rwx((n.mode >> 6) & 7) + rwx((n.mode >> 3) & 7) + rwx(n.mode & 7), c = t.split("");
  if (n.mode & 0o4000) c[2] = c[2] === "x" ? "s" : "S";
  if (n.mode & 0o2000) c[5] = c[5] === "x" ? "s" : "S";
  if (n.mode & 0o1000) c[8] = c[8] === "x" ? "t" : "T";
  return (n.kind === "dir" ? "d" : "-") + c.join("");
}
export const octal = (n: FNode) => (n.mode & 0o7777).toString(8).padStart(n.mode & 0o7000 ? 4 : 3, "0");

export interface ModeExplain { text: string; octal: string; classes: { who: "owner" | "group" | "other"; label: string; r: boolean; w: boolean; x: boolean; digit: number }[]; you: "owner" | "group" | "other"; yourPerms: string; sentence: string }
/** The permission-bits panel: what each triplet allows and which one applies to the current user. */
export function explainMode(n: FNode, user: User): ModeExplain {
  const cls = (who: "owner" | "group" | "other", shift: number, label: string) => { const d = (n.mode >> shift) & 7; return { who, label, r: !!(d & 4), w: !!(d & 2), x: !!(d & 1), digit: d }; };
  const classes = [cls("owner", 6, `owner (${n.owner})`), cls("group", 3, `group (${n.group})`), cls("other", 0, "everyone else")];
  const you = permClass(user, n), mine = classes.find((c) => c.who === you)!;
  const yourPerms = rwx(mine.digit);
  const verbs = [mine.r && "read", mine.w && "write", mine.x && (n.kind === "dir" ? "enter (search)" : "execute")].filter(Boolean) as string[];
  return { text: modeString(n), octal: octal(n), classes, you, yourPerms, sentence: `${user.name} is treated as ${you === "owner" ? "the owner" : you === "group" ? `a member of group ${n.group}` : "someone else (other)"}, so ${verbs.length ? "may " + verbs.join(", ") : "may do nothing"} here (${yourPerms}).` };
}

// ── Parser ───────────────────────────────────────────────────────────────
interface Seg { t: string; q: "n" | "s" | "d" }
type Word = Seg[];
interface Redir { op: ">" | ">>" | "<"; target: Word }
export interface SimpleCmd { words: Word[]; redirs: Redir[]; text: string }
export interface Pipeline { cmds: SimpleCmd[]; text: string; sep: "&&" | "||" | ";" | null }
class ShellSyntax extends Error {}
const ESC_DOLLAR = "\uE000";

/** Tokenise and parse one command line: quotes, escapes, comments, pipes, redirections and the list operators && || ;. */
export function parseLine(line: string): Pipeline[] {
  if (line.length > LIMITS.line) throw new ShellSyntax("bash: command line too long");
  const items: Pipeline[] = [];
  let cmds: SimpleCmd[] = [], words: Word[] = [], redirs: Redir[] = [], cur: Word = [], startOfCmd = 0, pipeStart = 0;
  let pendingRedir: Redir["op"] | null = null, hasWord = false, sep: Pipeline["sep"] = null;
  const pushWord = () => {
    if (!hasWord) return;
    if (pendingRedir) { redirs.push({ op: pendingRedir, target: cur }); pendingRedir = null; } else words.push(cur);
    cur = []; hasWord = false;
  };
  const endCmd = (i: number, token: string) => {
    pushWord();
    if (pendingRedir) throw new ShellSyntax(`bash: syntax error near unexpected token '${token}'`);
    if (!words.length && !redirs.length) throw new ShellSyntax(`bash: syntax error near unexpected token '${token}'`);
    cmds.push({ words, redirs, text: line.slice(startOfCmd, i).trim() }); words = []; redirs = []; startOfCmd = i + token.length;
  };
  const endPipeline = (i: number, token: string, next: Pipeline["sep"]) => {
    endCmd(i, token);
    items.push({ cmds, text: line.slice(pipeStart, i).trim(), sep }); cmds = []; sep = next; pipeStart = i + token.length;
  };
  let i = 0;
  const add = (t: string, q: Seg["q"]) => { cur.push({ t, q }); hasWord = true; };
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'") { const e = line.indexOf("'", i + 1); if (e < 0) throw new ShellSyntax("bash: unexpected EOF while looking for matching `''"); add(line.slice(i + 1, e), "s"); hasWord = true; i = e + 1; continue; }
    if (ch === '"') {
      let j = i + 1, buf = "";
      for (;;) {
        if (j >= line.length) throw new ShellSyntax('bash: unexpected EOF while looking for matching `"\'');
        const c = line[j];
        if (c === '"') break;
        if (c === "\\" && '"\\$`'.includes(line[j + 1] ?? "")) { buf += line[j + 1] === "$" ? ESC_DOLLAR : line[j + 1]; j += 2; continue; }
        if (c === "`") throw new ShellSyntax("bash: command substitution is not supported in this simulator");
        if (c === "$" && line[j + 1] === "(") throw new ShellSyntax("bash: command substitution is not supported in this simulator");
        buf += c; j++;
      }
      add(buf, "d"); hasWord = true; i = j + 1; continue;
    }
    if (ch === "\\") { if (i + 1 < line.length && line[i + 1] !== "\n") add(line[i + 1], "s"); i += 2; continue; }
    if (ch === "`" || (ch === "$" && line[i + 1] === "(")) throw new ShellSyntax("bash: command substitution is not supported in this simulator");
    if (ch === "(" || ch === ")") throw new ShellSyntax(`bash: syntax error near unexpected token '${ch}'`);
    if (ch === "#" && !hasWord) break;
    if (/\s/.test(ch)) { pushWord(); i++; continue; }
    if (ch === "|") {
      if (line[i + 1] === "|") { endPipeline(i, "||", "||"); i += 2; continue; }
      endCmd(i, "|"); i++; continue;
    }
    if (ch === "&") {
      if (line[i + 1] === "&") { endPipeline(i, "&&", "&&"); i += 2; continue; }
      throw new ShellSyntax("bash: background jobs (&) and 2>&1 are not supported in this simulator");
    }
    if (ch === ";") { endPipeline(i, ";", ";"); i++; continue; }
    if (ch === ">" || ch === "<") {
      const plain = cur.length === 1 && cur[0].q === "n" ? cur[0].t : "";
      if (ch === ">" && (plain === "2" || plain === "1" || plain === "&")) throw new ShellSyntax("bash: redirecting stderr (2>, 2>&1) is not supported in this simulator");
      pushWord();
      if (pendingRedir) throw new ShellSyntax(`bash: syntax error near unexpected token '${ch}'`);
      if (ch === ">" && line[i + 1] === ">") { pendingRedir = ">>"; i += 2; } else if (ch === "<" && line[i + 1] === "<") throw new ShellSyntax("bash: here-documents (<<) are not supported in this simulator");
      else { pendingRedir = ch; i++; }
      continue;
    }
    // Plain text up to the next special character.
    let j = i; while (j < line.length && !/[\s'"\\|&;<>()`#]/.test(line[j]) && !(line[j] === "$" && line[j + 1] === "(")) j++;
    if (j === i) j = i + 1;
    add(line.slice(i, j), "n"); i = j;
  }
  pushWord();
  if (pendingRedir) throw new ShellSyntax("bash: syntax error near unexpected token 'newline'");
  if (words.length || redirs.length || cmds.length) { endCmd(line.length, ""); items.push({ cmds, text: line.slice(pipeStart).trim(), sep }); }
  else if (sep === "&&" || sep === "||") throw new ShellSyntax("bash: syntax error: unexpected end of line after " + sep);
  void startOfCmd;
  return items;
}

// ── Expansion and globbing ───────────────────────────────────────────────
const VAR_RE = /\$(?:\{([A-Za-z_]\w*|\?)\}|([A-Za-z_]\w*|\?))/g;
interface Ch { c: string; wild: boolean }
function expandChars(s: Session, w: Word): Ch[] {
  const out: Ch[] = [];
  w.forEach((seg, si) => {
    let text = seg.t;
    if (seg.q !== "s") {
      if (si === 0 && seg.q === "n" && /^~(\/|$)/.test(text)) text = (s.env.HOME ?? "/") + text.slice(1);
      text = text.replace(VAR_RE, (_m, a, b) => ((a ?? b) === "?" ? String(s.status) : s.env[a ?? b] ?? ""));
    }
    for (const c of text) out.push({ c: c === ESC_DOLLAR ? "$" : c, wild: seg.q === "n" && (c === "*" || c === "?") });
  });
  return out;
}
const reEsc = (c: string) => c.replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
const globRe = (chars: Ch[]) => new RegExp("^" + chars.map((x) => (x.wild ? (x.c === "*" ? ".*" : ".") : reEsc(x.c))).join("") + "$");

/** Expand one word: variables, ~, then * and ? against the virtual tree (no match keeps the literal text, as bash does). */
export function expandWord(s: Session, w: Word): string[] {
  const chars = expandChars(s, w), text = chars.map((x) => x.c).join("");
  if (!chars.some((x) => x.wild)) return [text];
  const comps: Ch[][] = [[]];
  for (const x of chars) { if (x.c === "/") comps.push([]); else comps[comps.length - 1].push(x); }
  const abs = text.startsWith("/");
  let level: string[] = [abs ? "/" : ""];
  for (let ci = 0; ci < comps.length; ci++) {
    const comp = comps[ci], next: string[] = [];
    if (ci === 0 && abs && comp.length === 0) continue;
    for (const base of level) {
      if (!comp.some((x) => x.wild)) { next.push(base + (base === "" || base.endsWith("/") ? "" : "/") + comp.map((x) => x.c).join("")); continue; }
      const dir = lookup(s, absPath(s.cwd, base === "" ? "." : base));
      if (!dir.ok || dir.node.kind !== "dir" || !can(s.user, dir.node, "r")) continue;
      const re = globRe(comp), hidden = comp[0].c === ".";
      for (const name of [...dir.node.kids.keys()].sort(byName)) if (re.test(name) && (hidden || name[0] !== ".")) next.push(base + (base === "" || base.endsWith("/") ? "" : "/") + name);
    }
    level = next;
  }
  const hits = level.filter((p) => { const l = lookup(s, absPath(s.cwd, p)); return l.ok; });
  return hits.length ? hits : [text];
}
const byName = (a: string, b: string) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0; };

// ── Command infrastructure ───────────────────────────────────────────────
interface Out { out: string; err: string; code: number }
interface Ctx { s: Session; stdin: string | null; tty: boolean; inPipe: boolean; depth: number; budget: { n: number } }
const ok = (out = ""): Out => ({ out, err: "", code: 0 });
const bad = (err: string, code = 1, out = ""): Out => ({ out, err: err.endsWith("\n") ? err : err + "\n", code });
const merge = (a: Out, b: Out): Out => ({ out: a.out + b.out, err: a.err + b.err, code: b.code || a.code });
const q = (p: string) => `'${p}'`;

interface OptSpec { bool?: string; val?: string; num?: boolean }
interface Parsed { flags: Set<string>; vals: Record<string, string>; rest: string[]; num?: string }
function parseOpts(cmd: string, args: string[], spec: OptSpec): Parsed | Out {
  const flags = new Set<string>(), vals: Record<string, string> = {}, rest: string[] = [];
  let num: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") { rest.push(...args.slice(i + 1)); break; }
    if (a.startsWith("--")) return bad(`${cmd}: unrecognized option '${a}'\nTry '${cmd} --help' for more information.`, 2);
    if (spec.num && /^-\d+$/.test(a)) { num = a.slice(1); continue; }
    if (a.length > 1 && a[0] === "-") {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (spec.val?.includes(c)) { const v = a.slice(j + 1) || args[++i]; if (v === undefined) return bad(`${cmd}: option requires an argument -- '${c}'`, 2); vals[c] = v; break; }
        if (spec.bool?.includes(c)) flags.add(c);
        else return bad(`${cmd}: invalid option -- '${c}'\nTry '${cmd} --help' for more information.\n(simulator: this option may exist in real ${cmd} but is not implemented here; see "What is not supported")`, 2);
      }
      continue;
    }
    rest.push(a);
  }
  return { flags, vals, rest, num };
}
const isOut = (x: Parsed | Out): x is Out => "code" in x;

function readText(s: Session, p: string): { text: string } | { err: FsErr } {
  const l = lookup(s, absPath(s.cwd, p));
  if (!l.ok) return { err: l.err };
  if (l.node.kind === "dir") return { err: "EISDIR" };
  if (!can(s.user, l.node, "r")) return { err: "EACCES" };
  return { text: l.node.data };
}
function writeText(s: Session, p: string, data: string, append: boolean): FsErr | null {
  const abs = absPath(s.cwd, p), l = lookup(s, abs);
  if (data.length > LIMITS.fileBytes) return "EPERM";
  if (l.ok) {
    if (l.node.kind === "dir") return "EISDIR";
    if (!can(s.user, l.node, "w")) return "EACCES";
    l.node.data = append ? l.node.data + data : data; l.node.mtime = s.clock; return null;
  }
  if (l.err !== "ENOENT" || !l.parent) return l.err;
  if (!can(s.user, l.parent, "w") || !can(s.user, l.parent, "x")) return "EACCES";
  if (countNodes(s.root) > LIMITS.nodes) return "EPERM";
  l.parent.kids.set(l.name!, fileNode(0o644, s.user.name, s.user.groups[0], s.clock, data)); l.parent.mtime = s.clock; return null;
}

/** Input text for filter commands: named files (errors collected) or stdin. */
function inputs(ctx: Ctx, cmd: string, files: string[], style: "plain" | "open" = "plain"): { texts: { name: string; text: string }[]; err: string; failed: boolean } {
  const texts: { name: string; text: string }[] = []; let err = "", failed = false;
  if (!files.length) return { texts: [{ name: "-", text: ctx.stdin ?? "" }], err, failed };
  for (const f of files) {
    if (f === "-") { texts.push({ name: "-", text: ctx.stdin ?? "" }); continue; }
    const r = readText(ctx.s, f);
    if ("err" in r) { failed = true; err += style === "open" ? `${cmd}: cannot open ${q(f)} for reading: ${ERR_TEXT[r.err]}\n` : `${cmd}: ${f}: ${ERR_TEXT[r.err]}\n`; } else texts.push({ name: f, text: r.text });
  }
  return { texts, err, failed };
}
const lines = (t: string) => { if (t === "") return []; const l = t.split("\n"); if (l[l.length - 1] === "") l.pop(); return l; };
const joinLines = (l: string[]) => (l.length ? l.join("\n") + "\n" : "");
const utf8 = (t: string) => new TextEncoder().encode(t).length;
const human = (n: number) => (n < 1024 ? String(n) : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0).replace(/\.0$/, "")}K` : `${(n / 1048576).toFixed(1).replace(/\.0$/, "")}M`);

type Cmd = (args: string[], ctx: Ctx) => Out;
const CMDS: Record<string, Cmd> = {};

// pwd, cd
CMDS.pwd = (_a, { s }) => ok(s.cwd + "\n");
CMDS.cd = (a, ctx) => {
  const { s } = ctx;
  if (a.length > 1) return bad("bash: cd: too many arguments");
  const target = a[0] === undefined ? s.env.HOME : a[0] === "-" ? s.oldPwd : a[0];
  const abs = absPath(s.cwd, target), l = lookup(s, abs);
  if (!l.ok) return bad(`bash: cd: ${a[0] ?? target}: ${ERR_TEXT[l.err]}`);
  if (l.node.kind !== "dir") return bad(`bash: cd: ${a[0] ?? target}: Not a directory`);
  if (!can(s.user, l.node, "x")) return bad(`bash: cd: ${a[0] ?? target}: Permission denied`);
  if (ctx.inPipe) return ok(); // a pipeline stage is a subshell: its cd does not change your shell
  s.oldPwd = s.cwd; s.cwd = abs; s.env.PWD = abs;
  return ok(a[0] === "-" ? abs + "\n" : "");
};

// ls
CMDS.ls = (a, ctx) => {
  const { s } = ctx;
  const o = parseOpts("ls", a, { bool: "lahRStr1" }); if (isOut(o)) return o;
  const long = o.flags.has("l"), all = o.flags.has("a"), hum = o.flags.has("h"), rec = o.flags.has("R");
  const targets = o.rest.length ? o.rest : ["."];
  let out = "", err = "", code = 0;
  const cmpNodes = (m: Map<string, FNode>) => (x: string, y: string) => {
    if (o.flags.has("S")) { const d = size(m.get(y)!) - size(m.get(x)!); if (d) return d; }
    if (o.flags.has("t")) { const d = m.get(y)!.mtime - m.get(x)!.mtime; if (d) return d; }
    return byName(x, y);
  };
  const size = (n: FNode) => (n.kind === "dir" ? 4096 : utf8(n.data));
  const fmtLong = (entries: [string, FNode][]) => {
    const rows = entries.map(([name, n]) => ({ mode: modeString(n), nl: String(n.kind === "dir" ? 2 + [...n.kids.values()].filter((k) => k.kind === "dir").length : 1), own: n.owner, grp: n.group, size: hum ? human(size(n)) : String(size(n)), date: fmtTime(n.mtime), name }));
    const w = (k: "nl" | "own" | "grp" | "size") => Math.max(...rows.map((r) => r[k].length));
    return rows.map((r) => `${r.mode} ${r.nl.padStart(w("nl"))} ${r.own.padEnd(w("own"))} ${r.grp.padEnd(w("grp"))} ${r.size.padStart(w("size"))} ${r.date} ${r.name}`);
  };
  const listDir = (abs: string, shown: string, header: boolean): void => {
    const l = lookup(s, abs);
    if (!l.ok) { err += `ls: cannot access ${q(shown)}: ${ERR_TEXT[l.err]}\n`; code = 2; return; }
    if (!can(s.user, l.node, "r")) { err += `ls: cannot open directory ${q(shown)}: Permission denied\n`; code = 2; return; }
    if (header) out += `${shown}:\n`;
    const m = l.node.kids;
    let names = [...m.keys()].filter((n) => all || n[0] !== ".").sort(cmpNodes(m));
    if (o.flags.has("r")) names.reverse();
    let entries: [string, FNode][] = names.map((n) => [n, m.get(n)!]);
    if (all) entries = [[".", l.node], ["..", l.parent ?? l.node], ...entries];
    if (long) {
      if (!can(s.user, l.node, "x")) { err += `ls: cannot access ${q(shown + "/" + (names[0] ?? ""))}: Permission denied\n`; code = 2; return; }
      const blocks = entries.reduce((t, [, n]) => t + (n.kind === "dir" ? 4 : Math.max(4, Math.ceil(utf8(n.data) / 4096) * 4)), 0);
      out += `total ${blocks}\n` + joinLines(fmtLong(entries));
    } else out += ctx.tty && !o.flags.has("1") ? entries.map(([n]) => n).join("  ") + (entries.length ? "\n" : "") : joinLines(entries.map(([n]) => n));
    if (rec) for (const [n, c] of entries) if (c.kind === "dir" && n !== "." && n !== "..") { out += "\n"; listDir(abs === "/" ? "/" + n : abs + "/" + n, shown === "." ? "./" + n : shown + "/" + n, true); }
  };
  const files: [string, FNode][] = [], dirs: string[] = [];
  for (const t of targets) {
    const abs = absPath(s.cwd, t), l = lookup(s, abs);
    if (!l.ok) { err += `ls: cannot access ${q(t)}: ${ERR_TEXT[l.err]}\n`; code = 2; continue; }
    if (l.node.kind === "dir") dirs.push(t); else files.push([t, l.node]);
  }
  if (files.length) out += long ? joinLines(fmtLong(files)) : joinLines(files.map(([n]) => n));
  dirs.forEach((d, i) => { if (files.length || i > 0) out += "\n"; listDir(absPath(s.cwd, d), d, targets.length > 1 || rec); });
  return { out, err, code };
};

// cat, head, tail, wc
CMDS.cat = (a, ctx) => {
  const o = parseOpts("cat", a, { bool: "n" }); if (isOut(o)) return o;
  const r = inputs(ctx, "cat", o.rest);
  let out = r.texts.map((t) => t.text).join("");
  if (o.flags.has("n")) { let n = 0; out = out.split("\n").map((l, i, all) => (i === all.length - 1 && l === "" ? l : `${String(++n).padStart(6)}\t${l}`)).join("\n"); }
  return { out, err: r.err, code: r.failed ? 1 : 0 };
};
function headTail(name: "head" | "tail"): Cmd {
  return (a, ctx) => {
    const o = parseOpts(name, a, { val: "n", num: true }); if (isOut(o)) return o;
    const raw = o.vals.n ?? o.num ?? "10";
    if (!/^\+?\d+$/.test(raw)) return bad(`${name}: invalid number of lines: ${q(raw)}`);
    const n = Number(raw.replace("+", ""));
    const r = inputs(ctx, name, o.rest, "open"), multi = o.rest.length > 1;
    let out = "";
    r.texts.forEach((t, i) => {
      if (multi) out += `${i ? "\n" : ""}==> ${t.name} <==\n`;
      const l = lines(t.text);
      out += joinLines(name === "head" ? l.slice(0, n) : n === 0 ? [] : raw.startsWith("+") ? l.slice(n - 1) : l.slice(-n));
    });
    return { out, err: r.err, code: r.failed ? 1 : 0 };
  };
}
CMDS.head = headTail("head");
CMDS.tail = headTail("tail");
CMDS.wc = (a, ctx) => {
  const o = parseOpts("wc", a, { bool: "lwc" }); if (isOut(o)) return o;
  const cols = ["l", "w", "c"].filter((c) => o.flags.has(c)); const use = cols.length ? cols : ["l", "w", "c"];
  const r = inputs(ctx, "wc", o.rest);
  const count = (t: string) => ({ l: (t.match(/\n/g) ?? []).length, w: t.split(/\s+/).filter(Boolean).length, c: utf8(t) });
  const rows = r.texts.map((t) => ({ name: o.rest.length ? t.name : "", ...count(t.text) }));
  const total = rows.reduce((p, c) => ({ l: p.l + c.l, w: p.w + c.w, c: p.c + c.c }), { l: 0, w: 0, c: 0 });
  const single = use.length === 1 && rows.length === 1;
  const width = single ? 0 : Math.max(String(total.c).length, o.rest.length ? 1 : 7);
  const fmt = (c: { l: number; w: number; c: number }, name: string) => use.map((k) => String(c[k as "l"]).padStart(width)).join(" ") + (name ? " " + name : "");
  let out = joinLines(rows.map((x) => fmt(x, x.name)));
  if (rows.length > 1) out += fmt(total, "total") + "\n";
  return { out, err: r.err, code: r.failed ? 1 : 0 };
};

// grep
function breToJs(p: string, ere: boolean): string {
  if (ere) return p;
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\" && i + 1 < p.length) { const n = p[++i]; out += "+?(){}|".includes(n) ? n : "\\" + n; }
    else if ("+?(){}|".includes(c)) out += "\\" + c;
    else out += c;
  }
  return out;
}
CMDS.grep = (a, ctx) => {
  const { s } = ctx;
  const o = parseOpts("grep", a, { bool: "inrvcElh" }); if (isOut(o)) return o;
  if (!o.rest.length) return bad("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.", 2);
  const [pat, ...files0] = o.rest;
  let re: RegExp;
  if (pat.length > 300) return bad("grep: pattern too long for this simulator", 2);
  try { re = new RegExp(breToJs(pat, o.flags.has("E")), o.flags.has("i") ? "i" : ""); } catch { return bad(`grep: Invalid regular expression: ${pat}`, 2); }
  const rec = o.flags.has("r");
  const targets: { name: string; text: string }[] = []; let err = "", failed = false;
  const walk = (abs: string, shown: string) => {
    const l = lookup(s, abs);
    if (!l.ok) { err += `grep: ${shown}: ${ERR_TEXT[l.err]}\n`; failed = true; return; }
    if (l.node.kind === "dir") {
      if (!rec) { err += `grep: ${shown}: Is a directory\n`; return; }
      if (!can(s.user, l.node, "r")) { err += `grep: ${shown}: Permission denied\n`; failed = true; return; }
      for (const n of [...l.node.kids.keys()].sort(byName)) walk(abs === "/" ? "/" + n : abs + "/" + n, shown === "." ? n : shown === "" ? n : shown.replace(/\/$/, "") + "/" + n);
    } else if (!can(s.user, l.node, "r")) { err += `grep: ${shown}: Permission denied\n`; failed = true; } else targets.push({ name: shown, text: l.node.data });
  };
  if (!files0.length && rec) walk(s.cwd, "");
  else if (!files0.length) targets.push({ name: "(standard input)", text: ctx.stdin ?? "" });
  else for (const f of files0) { if (f === "-") targets.push({ name: "(standard input)", text: ctx.stdin ?? "" }); else walk(absPath(s.cwd, f), f); }
  const prefix = (targets.length > 1 || rec) && !o.flags.has("h");
  let out = "", any = false;
  for (const t of targets) {
    let n = 0;
    lines(t.text).forEach((line, i) => {
      if (re.test(line) === o.flags.has("v")) return;
      n++; any = true;
      if (o.flags.has("c") || o.flags.has("l")) return;
      out += (prefix ? t.name + ":" : "") + (o.flags.has("n") ? `${i + 1}:` : "") + line + "\n";
    });
    if (o.flags.has("c")) out += (prefix ? t.name + ":" : "") + n + "\n";
    else if (o.flags.has("l") && n) out += t.name + "\n";
  }
  return { out, err, code: failed ? 2 : any || o.flags.has("c") ? 0 : 1 };
};

// sort, uniq, cut, tr
const leadNum = (l: string) => { const m = /^\s*([+-]?\d+(?:\.\d+)?)/.exec(l); return m ? Number(m[1]) : 0; };
CMDS.sort = (a, ctx) => {
  const o = parseOpts("sort", a, { bool: "nru" }); if (isOut(o)) return o;
  const r = inputs(ctx, "sort", o.rest);
  let l = r.texts.flatMap((t) => lines(t.text));
  const key = o.flags.has("n") ? (x: string, y: string) => leadNum(x) - leadNum(y) : () => 0;
  // C-locale byte order, as with LC_ALL=C; ties fall back to the whole line like GNU sort.
  const cmp = (x: string, y: string) => key(x, y) || (x < y ? -1 : x > y ? 1 : 0);
  l.sort(cmp);
  if (o.flags.has("u")) l = l.filter((x, i) => i === 0 || key(l[i - 1], x) !== 0 || (!o.flags.has("n") && l[i - 1] !== x));
  if (o.flags.has("r")) l.reverse();
  return { out: joinLines(l), err: r.err, code: r.failed ? 2 : 0 };
};
CMDS.uniq = (a, ctx) => {
  const o = parseOpts("uniq", a, { bool: "c" }); if (isOut(o)) return o;
  const r = inputs(ctx, "uniq", o.rest.slice(0, 1));
  const out: string[] = []; let prev: string | null = null, n = 0;
  const flush = () => { if (prev !== null) out.push(o.flags.has("c") ? `${String(n).padStart(7)} ${prev}` : prev); };
  for (const x of lines(r.texts[0]?.text ?? "")) { if (x === prev) n++; else { flush(); prev = x; n = 1; } }
  flush();
  return { out: joinLines(out), err: r.err, code: r.failed ? 1 : 0 };
};
function rangeList(spec: string): ((i: number) => boolean) | null {
  const parts = spec.split(",").map((p) => /^(\d*)-(\d*)$/.exec(p) ?? /^(\d+)$/.exec(p));
  if (parts.some((p) => !p) || !spec) return null;
  const rs = spec.split(",").map((p) => { const [x, y] = p.includes("-") ? p.split("-") : [p, p]; return [x === "" ? 1 : Number(x), y === "" ? Infinity : Number(y)] as [number, number]; });
  return (i) => rs.some(([x, y]) => i >= x && i <= y);
}
CMDS.cut = (a, ctx) => {
  const o = parseOpts("cut", a, { val: "dfc" }); if (isOut(o)) return o;
  if (!o.vals.f && !o.vals.c) return bad("cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.", 1);
  const delim = o.vals.d ?? "\t";
  if ([...delim].length !== 1) return bad("cut: the delimiter must be a single character\nTry 'cut --help' for more information.");
  const pick = rangeList(o.vals.f ?? o.vals.c);
  if (!pick) return bad(`cut: invalid field range`);
  const r = inputs(ctx, "cut", o.rest);
  const out = r.texts.flatMap((t) => lines(t.text)).map((line) => {
    if (o.vals.c) return [...line].filter((_, i) => pick(i + 1)).join("");
    if (!line.includes(delim)) return line;
    return line.split(delim).filter((_, i) => pick(i + 1)).join(delim);
  });
  return { out: joinLines(out), err: r.err, code: r.failed ? 1 : 0 };
};
function trSet(spec: string): string[] {
  const out: string[] = [];
  const cls: Record<string, string> = { upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", lower: "abcdefghijklmnopqrstuvwxyz", digit: "0123456789", space: " \t\n\r\f\v", alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", alnum: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", punct: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~" };
  const chars: string[] = []; // unescape first
  for (let i = 0; i < spec.length; i++) {
    if (spec[i] === "\\" && i + 1 < spec.length) { const n = spec[++i]; chars.push(n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n); } else chars.push(spec[i]);
  }
  for (let i = 0; i < chars.length; i++) {
    const m = chars[i] === "[" && chars[i + 1] === ":" ? /^\[:(\w+):\]/.exec(chars.slice(i).join("")) : null;
    if (m && cls[m[1]]) { out.push(...cls[m[1]]); i += m[0].length - 1; continue; }
    if (chars[i + 1] === "-" && i + 2 < chars.length) { for (let c = chars[i].charCodeAt(0); c <= chars[i + 2].charCodeAt(0); c++) out.push(String.fromCharCode(c)); i += 2; continue; }
    out.push(chars[i]);
  }
  return out;
}
CMDS.tr = (a, ctx) => {
  const o = parseOpts("tr", a, { bool: "ds" }); if (isOut(o)) return o;
  if (!o.rest.length) return bad("tr: missing operand\nTry 'tr --help' for more information.");
  const del = o.flags.has("d"), squeeze = o.flags.has("s");
  if (!del && !squeeze && o.rest.length < 2) return bad(`tr: missing operand after ${q(o.rest[0])}\nTwo strings must be given when translating.`);
  const set1 = trSet(o.rest[0]), set2 = trSet(o.rest[1] ?? "");
  if (o.rest.length > 2) return bad(`tr: extra operand ${q(o.rest[2])}`);
  const text = ctx.stdin ?? "";
  let out = "";
  const map = new Map<string, string>();
  if (!del && set2.length) set1.forEach((c, i) => { if (!map.has(c)) map.set(c, set2[Math.min(i, set2.length - 1)]); });
  const sq = new Set(squeeze ? (o.rest[1] ? set2 : set1) : []);
  let last = "";
  for (const c of text) {
    if (del && set1.includes(c)) continue;
    const t = del ? c : map.get(c) ?? c;
    if (squeeze && sq.has(t) && t === last) continue;
    out += t; last = t;
  }
  return ok(out);
};

// echo, touch, mkdir, cp, mv, rm, find, chmod, chown
CMDS.echo = (a) => {
  let nl = true, esc = false, i = 0;
  for (; i < a.length && /^-[neE]+$/.test(a[i]); i++) { if (a[i].includes("n")) nl = false; if (a[i].includes("e")) esc = true; if (a[i].includes("E")) esc = false; }
  let t = a.slice(i).join(" ");
  if (esc) t = t.replace(/\\(n|t|\\)/g, (_m, c) => (c === "n" ? "\n" : c === "t" ? "\t" : "\\"));
  return ok(t + (nl ? "\n" : ""));
};
const primary = (u: User) => u.groups[0];
const newNode = (s: Session, kind: FNode["kind"]) => (kind === "dir" ? dirNode(0o755, s.user.name, primary(s.user), s.clock) : fileNode(0o644, s.user.name, primary(s.user), s.clock, ""));
CMDS.touch = (a, { s }) => {
  const o = parseOpts("touch", a, {}); if (isOut(o)) return o;
  if (!o.rest.length) return bad("touch: missing file operand\nTry 'touch --help' for more information.");
  let err = "";
  for (const f of o.rest) {
    const l = lookup(s, absPath(s.cwd, f));
    if (l.ok) { if (l.node.owner !== s.user.name && !can(s.user, l.node, "w")) err += `touch: cannot touch ${q(f)}: Permission denied\n`; else l.node.mtime = s.clock; continue; }
    if (l.err !== "ENOENT" || !l.parent) { err += `touch: cannot touch ${q(f)}: ${ERR_TEXT[l.err]}\n`; continue; }
    if (!can(s.user, l.parent, "w") || !can(s.user, l.parent, "x")) { err += `touch: cannot touch ${q(f)}: Permission denied\n`; continue; }
    l.parent.kids.set(l.name!, newNode(s, "file")); l.parent.mtime = s.clock;
  }
  return { out: "", err, code: err ? 1 : 0 };
};
CMDS.mkdir = (a, { s }) => {
  const o = parseOpts("mkdir", a, { bool: "p" }); if (isOut(o)) return o;
  if (!o.rest.length) return bad("mkdir: missing operand\nTry 'mkdir --help' for more information.");
  let err = "";
  for (const f of o.rest) {
    const abs = absPath(s.cwd, f), parts = abs.split("/").filter(Boolean);
    let cur = s.root, failed = false;
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1, next = cur.kids.get(parts[i]);
      if (!can(s.user, cur, "x")) { err += `mkdir: cannot create directory ${q(f)}: Permission denied\n`; failed = true; break; }
      if (next) {
        if (last && !o.flags.has("p")) { err += `mkdir: cannot create directory ${q(f)}: File exists\n`; failed = true; break; }
        if (next.kind !== "dir") { err += `mkdir: cannot create directory ${q(f)}: ${last ? "File exists" : "Not a directory"}\n`; failed = true; break; }
        cur = next; continue;
      }
      if (!last && !o.flags.has("p")) { err += `mkdir: cannot create directory ${q(f)}: No such file or directory\n`; failed = true; break; }
      if (!can(s.user, cur, "w")) { err += `mkdir: cannot create directory ${q(f)}: Permission denied\n`; failed = true; break; }
      if (countNodes(s.root) > LIMITS.nodes) { err += `mkdir: cannot create directory ${q(f)}: No space left on device\n`; failed = true; break; }
      const n = newNode(s, "dir"); cur.kids.set(parts[i], n); cur.mtime = s.clock; cur = n;
    }
    void failed;
  }
  return { out: "", err, code: err ? 1 : 0 };
};
const cloneAs = (n: FNode, s: Session): FNode => ({ ...n, owner: s.user.name, group: primary(s.user), mtime: s.clock, kids: new Map([...n.kids].map(([k, v]) => [k, cloneAs(v, s)])) });
/** Destination for cp and mv: an existing directory receives the source inside it. */
function destFor(s: Session, srcName: string, dest: string): { parent: FNode; name: string; abs: string; existing?: FNode } | FsErr {
  const l = lookup(s, absPath(s.cwd, dest));
  if (l.ok && l.node.kind === "dir") {
    const name = baseName(absPath(s.cwd, srcName)), c = l.node.kids.get(name);
    if (!can(s.user, l.node, "w") || !can(s.user, l.node, "x")) return "EACCES";
    return { parent: l.node, name, abs: l.abs + "/" + name, existing: c };
  }
  if (l.ok) return !l.parent || !can(s.user, l.parent, "w") ? "EACCES" : { parent: l.parent, name: l.name, abs: l.abs, existing: l.node };
  if (l.err !== "ENOENT" || !l.parent) return l.err;
  if (!can(s.user, l.parent, "w") || !can(s.user, l.parent, "x")) return "EACCES";
  return { parent: l.parent, name: l.name!, abs: l.abs };
}
function cpmv(name: "cp" | "mv"): Cmd {
  return (a, { s }) => {
    const o = parseOpts(name, a, { bool: name === "cp" ? "rR" : "f" }); if (isOut(o)) return o;
    if (o.rest.length < 2) return bad(o.rest.length ? `${name}: missing destination file operand after ${q(o.rest[0])}\nTry '${name} --help' for more information.` : `${name}: missing file operand\nTry '${name} --help' for more information.`);
    const srcs = o.rest.slice(0, -1), dest = o.rest[o.rest.length - 1];
    const dl = lookup(s, absPath(s.cwd, dest));
    if (srcs.length > 1 && !(dl.ok && dl.node.kind === "dir")) return bad(`${name}: target ${q(dest)} is not a directory`);
    let err = "";
    for (const src of srcs) {
      const sl = lookup(s, absPath(s.cwd, src));
      if (!sl.ok) { err += `${name}: cannot stat ${q(src)}: ${ERR_TEXT[sl.err]}\n`; continue; }
      if (name === "cp" && sl.node.kind === "dir" && !o.flags.has("r") && !o.flags.has("R")) { err += `cp: -r not specified; omitting directory ${q(src)}\n`; continue; }
      if (name === "cp" && !can(s.user, sl.node, "r")) { err += `cp: cannot open ${q(src)} for reading: Permission denied\n`; continue; }
      const d = destFor(s, src, dest);
      if (typeof d === "string") { err += `${name}: cannot ${name === "cp" ? "create regular file" : "move to"} ${q(dest)}: ${ERR_TEXT[d]}\n`; continue; }
      if (d.existing === sl.node) { err += `${name}: ${q(src)} and ${q(dest)} are the same file\n`; continue; }
      if ((d.abs + "/").startsWith(sl.abs + "/") && sl.node.kind === "dir") { err += name === "cp" ? `cp: cannot copy a directory, ${q(src)}, into itself, ${q(d.abs)}\n` : `mv: cannot move ${q(src)} to a subdirectory of itself, ${q(d.abs)}\n`; continue; }
      if (d.existing?.kind === "dir" && sl.node.kind !== "dir") { err += `${name}: cannot overwrite directory ${q(dest)} with non-directory\n`; continue; }
      if (d.existing && d.existing.kind === "file" && !can(s.user, d.existing, "w") && name === "cp") { err += `cp: cannot create regular file ${q(dest)}: Permission denied\n`; continue; }
      if (name === "mv") {
        if (!sl.parent || !can(s.user, sl.parent, "w") || !can(s.user, sl.parent, "x")) { err += `mv: cannot move ${q(src)} to ${q(dest)}: Permission denied\n`; continue; }
        if ((sl.parent.mode & 0o1000) && s.user.uid !== 0 && sl.node.owner !== s.user.name && sl.parent.owner !== s.user.name) { err += `mv: cannot move ${q(src)} to ${q(dest)}: Operation not permitted\n`; continue; }
        sl.parent.kids.delete(sl.name); sl.parent.mtime = s.clock; sl.node.mtime = s.clock; d.parent.kids.set(d.name, sl.node); d.parent.mtime = s.clock;
      } else {
        if (countNodes(s.root) + countNodes(sl.node) > LIMITS.nodes) { err += `cp: cannot create ${q(dest)}: No space left on device\n`; continue; }
        const copy = cloneAs(sl.node, s); copy.mode = sl.node.mode & 0o777; d.parent.kids.set(d.name, copy); d.parent.mtime = s.clock;
      }
    }
    return { out: "", err, code: err ? 1 : 0 };
  };
}
CMDS.cp = cpmv("cp");
CMDS.mv = cpmv("mv");
CMDS.rm = (a, { s }) => {
  const o = parseOpts("rm", a, { bool: "rRf" }); if (isOut(o)) return o;
  const force = o.flags.has("f"), rec = o.flags.has("r") || o.flags.has("R");
  if (!o.rest.length) return force ? ok() : bad("rm: missing operand\nTry 'rm --help' for more information.");
  let err = "";
  const remove = (parent: FNode, name: string, node: FNode, shown: string): boolean => {
    if (node.kind === "dir") {
      if (!can(s.user, node, "r") || !can(s.user, node, "x") || !can(s.user, node, "w")) { err += `rm: cannot remove ${q(shown)}: Permission denied\n`; return false; }
      let all = true;
      for (const [k, v] of [...node.kids]) if (!remove(node, k, v, shown + "/" + k)) all = false;
      if (!all) return false;
    }
    if (!can(s.user, parent, "w") || !can(s.user, parent, "x")) { err += `rm: cannot remove ${q(shown)}: Permission denied\n`; return false; }
    if ((parent.mode & 0o1000) && s.user.uid !== 0 && node.owner !== s.user.name && parent.owner !== s.user.name) { err += `rm: cannot remove ${q(shown)}: Operation not permitted\n`; return false; }
    parent.kids.delete(name); parent.mtime = s.clock; return true;
  };
  for (const f of o.rest) {
    const base = baseName(f.replace(/\/+$/, "") || "/");
    if (base === "." || base === "..") { err += `rm: refusing to remove '.' or '..' directory: skipping ${q(f)}\n`; continue; }
    const abs = absPath(s.cwd, f);
    if (abs === "/") { err += "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"; continue; }
    const l = lookup(s, abs);
    if (!l.ok) { if (!(force && l.err === "ENOENT")) err += `rm: cannot remove ${q(f)}: ${ERR_TEXT[l.err]}\n`; continue; }
    if (l.node.kind === "dir" && !rec) { err += `rm: cannot remove ${q(f)}: Is a directory\n`; continue; }
    if (s.cwd === abs || s.cwd.startsWith(abs + "/")) { /* like Linux: allowed; the shell is left in a deleted directory */ }
    remove(l.parent!, l.name, l.node, f);
  }
  return { out: "", err, code: err ? 1 : 0 };
};
CMDS.find = (a, { s }) => {
  const paths: string[] = []; let i = 0;
  while (i < a.length && !a[i].startsWith("-")) paths.push(a[i++]);
  let name: RegExp | null = null, type: string | null = null, maxDepth = Infinity;
  for (; i < a.length; i++) {
    if (a[i] === "-name" && a[i + 1] !== undefined) { const pat = a[++i]; name = new RegExp("^" + [...pat].map((c) => (c === "*" ? ".*" : c === "?" ? "." : reEsc(c))).join("") + "$"); }
    else if (a[i] === "-type" && a[i + 1] !== undefined) { type = a[++i]; if (type !== "f" && type !== "d") return bad(`find: Unknown argument to -type: ${type}`); }
    else if (a[i] === "-maxdepth" && /^\d+$/.test(a[i + 1] ?? "")) maxDepth = Number(a[++i]);
    else if (a[i].startsWith("-")) return bad(`find: unknown predicate ${"`"}${a[i]}'\n(simulator: only -name, -type f|d and -maxdepth are implemented)`);
    else return bad(`find: paths must precede expression: ${q(a[i])}`);
  }
  let out = "", err = "";
  const walk = (abs: string, shown: string, depth: number) => {
    const l = lookup(s, abs);
    if (!l.ok) { err += `find: ${q(shown)}: ${ERR_TEXT[l.err]}\n`; return; }
    if ((!name || name.test(baseName(shown) || shown)) && (!type || (type === "d") === (l.node.kind === "dir"))) out += shown + "\n";
    if (l.node.kind !== "dir" || depth >= maxDepth) return;
    if (!can(s.user, l.node, "r")) { err += `find: ${q(shown)}: Permission denied\n`; return; }
    for (const n of [...l.node.kids.keys()].sort(byName)) walk(abs === "/" ? "/" + n : abs + "/" + n, shown.endsWith("/") ? shown + n : shown + "/" + n, depth + 1);
  };
  for (const p of paths.length ? paths : ["."]) walk(absPath(s.cwd, p), p, 0);
  return { out, err, code: err ? 1 : 0 };
};

/** chmod modes: octal (644, 0755) or symbolic (u+x, go-w, a=rx, +x, u=rw,g=r). */
export function applyMode(cur: number, spec: string, isDir: boolean): number | null {
  if (/^[0-7]{3,4}$/.test(spec)) return parseInt(spec, 8) & 0o7777;
  let mode = cur;
  for (const clause of spec.split(",")) {
    const m = /^([ugoa]*)((?:[-+=][rwxXst]*)+)$/.exec(clause);
    if (!m) return null;
    const who = m[1] === "" || m[1].includes("a") ? "ugo" : m[1];
    for (const op of m[2].match(/[-+=][rwxXst]*/g)!) {
      let bits = 0;
      for (const p of op.slice(1)) bits |= p === "r" ? 4 : p === "w" ? 2 : p === "x" ? 1 : p === "X" ? (isDir || (mode & 0o111) ? 1 : 0) : 0;
      const sticky = op.includes("t") ? 0o1000 : 0;
      for (const w of who) {
        const shift = w === "u" ? 6 : w === "g" ? 3 : 0, mask = 7 << shift;
        if (op[0] === "+") mode |= bits << shift; else if (op[0] === "-") mode &= ~(bits << shift); else mode = (mode & ~mask) | (bits << shift);
      }
      if (sticky) { if (op[0] === "-") mode &= ~0o1000; else mode |= 0o1000; }
    }
  }
  return mode;
}
CMDS.chmod = (a, { s }) => {
  // chmod parses its own arguments: "-x" is a MODE here, not an option, so only -R and -- are options.
  const o = { flags: new Set<string>(), rest: [] as string[] };
  let optsDone = false;
  for (const x of a) { if (!optsDone && x === "-R") o.flags.add("R"); else if (!optsDone && x === "--") optsDone = true; else { optsDone = true; o.rest.push(x); } }
  if (o.rest.length < 2) return bad(o.rest.length ? `chmod: missing operand after ${q(o.rest[0])}\nTry 'chmod --help' for more information.` : "chmod: missing operand\nTry 'chmod --help' for more information.");
  const [spec, ...files] = o.rest;
  if (applyMode(0, spec, false) === null) return bad(`chmod: invalid mode: ${q(spec)}\nTry 'chmod --help' for more information.`);
  let err = "";
  const apply = (n: FNode, shown: string) => {
    if (s.user.uid !== 0 && n.owner !== s.user.name) { err += `chmod: changing permissions of ${q(shown)}: Operation not permitted\n`; return; }
    n.mode = applyMode(n.mode, spec, n.kind === "dir")!;
    if (o.flags.has("R") && n.kind === "dir") for (const [k, v] of n.kids) apply(v, shown + "/" + k);
  };
  for (const f of files) {
    const l = lookup(s, absPath(s.cwd, f));
    if (!l.ok) err += `chmod: cannot access ${q(f)}: ${ERR_TEXT[l.err]}\n`; else apply(l.node, f);
  }
  return { out: "", err, code: err ? 1 : 0 };
};
CMDS.chown = (a, { s }) => {
  const o = parseOpts("chown", a, {}); if (isOut(o)) return o;
  if (o.rest.length < 2) return bad(o.rest.length ? `chown: missing operand after ${q(o.rest[0])}\nTry 'chown --help' for more information.` : "chown: missing operand\nTry 'chown --help' for more information.");
  const [spec, ...files] = o.rest;
  const [own, grp] = spec.split(":");
  if (own && !USERS[own]) return bad(`chown: invalid user: ${q(spec)}`);
  if (grp !== undefined && grp !== "" && !GROUPS.has(grp)) return bad(`chown: invalid group: ${q(spec)}`);
  let err = "";
  for (const f of files) {
    const l = lookup(s, absPath(s.cwd, f));
    if (!l.ok) { err += `chown: cannot access ${q(f)}: ${ERR_TEXT[l.err]}\n`; continue; }
    const n = l.node;
    const ownerChange = !!own && own !== n.owner, groupChange = !!grp && grp !== n.group;
    // Only root may give a file away. The owner may regroup it into a group they belong to.
    if (s.user.uid !== 0 && (ownerChange || (groupChange && (n.owner !== s.user.name || !s.user.groups.includes(grp))))) { err += `chown: changing ownership of ${q(f)}: Operation not permitted\n`; continue; }
    if (own) n.owner = own; if (grp) n.group = grp;
  }
  return { out: "", err, code: err ? 1 : 0 };
};

// whoami, id, env, export, true/false, test, history, clear, sudo, exit
CMDS.whoami = (_a, { s }) => ok(s.user.name + "\n");
CMDS.id = (_a, { s }) => ok(`uid=${s.user.uid}(${s.user.name}) gid=${s.user.uid}(${primary(s.user)}) groups=${s.user.groups.map((g, i) => `${i === 0 ? s.user.uid : 1500 + i}(${g})`).join(",")}\n`);
CMDS.env = (_a, { s }) => ok(Object.entries(s.env).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
CMDS.printenv = (a, ctx) => (a.length ? (a[0] in ctx.s.env ? ok(ctx.s.env[a[0]] + "\n") : { out: "", err: "", code: 1 }) : CMDS.env([], ctx));
CMDS.export = (a, { s }) => { for (const x of a) { const m = /^([A-Za-z_]\w*)=(.*)$/.exec(x); if (m) s.env[m[1]] = m[2]; else if (!/^[A-Za-z_]\w*$/.test(x)) return bad(`bash: export: ${q(x)}: not a valid identifier`); } return ok(); };
CMDS.true = () => ok();
CMDS.false = () => ({ out: "", err: "", code: 1 });
CMDS.history = (_a, { s }) => ok(s.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join("\n") + (s.history.length ? "\n" : ""));
CMDS.clear = () => ok("\u000c");
CMDS.sudo = () => bad("sudo: not available in this simulator. You stay a normal user, so permission checks stay real.", 1);
CMDS.exit = () => ok("(simulated terminal: there is nothing to exit; close the page instead)\n");
CMDS.test = (a, { s }) => {
  const args = a[a.length - 1] === "]" ? a.slice(0, -1) : a;
  const [f, v] = args;
  if (args.length === 0) return { out: "", err: "", code: 1 };
  const un = (fn: () => boolean) => ({ out: "", err: "", code: fn() ? 0 : 1 });
  const node = () => { const l = lookup(s, absPath(s.cwd, v ?? "")); return l.ok ? l.node : null; };
  if (args.length === 2) {
    switch (f) {
      case "-e": return un(() => !!node());
      case "-f": return un(() => node()?.kind === "file");
      case "-d": return un(() => node()?.kind === "dir");
      case "-r": return un(() => { const n = node(); return !!n && can(s.user, n, "r"); });
      case "-w": return un(() => { const n = node(); return !!n && can(s.user, n, "w"); });
      case "-x": return un(() => { const n = node(); return !!n && can(s.user, n, "x"); });
      case "-z": return un(() => v === "");
      case "-n": return un(() => v !== "");
    }
  }
  if (args.length === 1) return un(() => f !== "");
  if (args.length === 3) { const [x, op, y] = args; if (op === "=" || op === "==") return un(() => x === y); if (op === "!=") return un(() => x !== y); }
  return bad("bash: test: only -e -f -d -r -w -x -z -n, =, != and a single string are implemented in this simulator", 2);
};
CMDS["["] = CMDS.test;

// ps, top, kill
const padR = (v: string | number, n: number) => String(v).padEnd(n), padL = (v: string | number, n: number) => String(v).padStart(n);
CMDS.ps = (a, ctx) => {
  const { s } = ctx;
  const own: Proc = { pid: s.nextPid++, ppid: 777, user: s.user.name, cpu: 0, mem: 0, vsz: 9_000, rss: 3_000, stat: "R+", start: "09:00", time: "0:00", cmd: "ps" };
  const all = [...s.procs, own];
  const f = a.join(" ").replace(/^-/, "");
  if (a.length === 0) return ok("    PID TTY          TIME CMD\n" + [all.find((p) => p.pid === 777), own].filter(Boolean).map((p) => `${padL(p!.pid, 7)} pts/0    00:00:00 ${p!.cmd.replace(/^-/, "")}`).join("\n") + "\n");
  if (/^(aux|-aux|ax|auxww|-ef|ef|-e|e)$/.test(a.join(" ")) || /^a?u?x?$/.test(f)) {
    if (/ef$/.test(f)) return ok("UID          PID    PPID  C STIME TTY          TIME CMD\n" + all.map((p) => `${padR(p.user, 8)} ${padL(p.pid, 7)} ${padL(p.ppid, 7)}  ${Math.round(p.cpu)} ${padR(p.start, 5)} ?        00:${p.time.padStart(5, "0")} ${p.cmd}`).join("\n") + "\n");
    return ok("USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n" + all.map((p) => `${padR(p.user, 8)} ${padL(p.pid, 7)} ${padL(p.cpu.toFixed(1), 4)} ${padL(p.mem.toFixed(1), 4)} ${padL(p.vsz, 6)} ${padL(p.rss, 5)} ?        ${padR(p.stat, 4)} ${padR(p.start, 6)} ${padL(p.time, 4)} ${p.cmd}`).join("\n") + "\n");
  }
  return bad(`ps: only plain "ps", "ps aux", "ps -ef" are implemented in this simulator`, 1);
};
CMDS.top = (a, { s }) => {
  const o = parseOpts("top", a, { bool: "b", val: "n" }); if (isOut(o)) return o;
  const rows = [...s.procs].sort((x, y) => y.cpu - x.cpu || x.pid - y.pid);
  const cpu = rows.reduce((t, p) => t + p.cpu, 0);
  return ok([
    `top - 09:00:00 up 3 days,  2:14,  1 user,  load average: 0.42, 0.37, 0.31   (fixture values, not measured)`,
    `Tasks: ${rows.length} total, ${rows.filter((p) => p.stat[0] === "R").length} running, ${rows.filter((p) => p.stat[0] !== "R").length} sleeping`,
    `%Cpu(s): ${Math.min(100, cpu).toFixed(1)} us, ${(100 - Math.min(100, cpu)).toFixed(1)} id`,
    "", "    PID USER      %CPU  %MEM     TIME COMMAND",
    ...rows.map((p) => `${padL(p.pid, 7)} ${padR(p.user, 9)} ${padL(p.cpu.toFixed(1), 5)} ${padL(p.mem.toFixed(1), 5)} ${padL(p.time, 8)} ${p.cmd}`),
  ].join("\n") + "\n");
};
const SIGS: Record<string, number> = { HUP: 1, INT: 2, KILL: 9, TERM: 15 };
CMDS.kill = (a, { s }) => {
  let sig = 15; const pids: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "-s" && a[i + 1]) { const n = SIGS[a[++i].replace(/^SIG/, "")]; if (!n) return bad(`bash: kill: ${a[i]}: invalid signal specification`); sig = n; }
    else if (/^-\d+$/.test(x)) { sig = Number(x.slice(1)); if (![1, 2, 9, 15].includes(sig)) return bad(`bash: kill: ${x.slice(1)}: signal not implemented in this simulator (1, 2, 9, 15)`); }
    else if (/^-[A-Za-z]+$/.test(x)) { const n = SIGS[x.slice(1).replace(/^SIG/, "")]; if (!n) return bad(`bash: kill: ${x.slice(1)}: invalid signal specification`); sig = n; }
    else pids.push(x);
  }
  if (!pids.length) return bad("kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]", 2);
  let err = "";
  for (const p of pids) {
    if (!/^\d+$/.test(p)) { err += `bash: kill: ${p}: arguments must be process or job IDs\n`; continue; }
    const pr = s.procs.find((x) => x.pid === Number(p));
    if (!pr) { err += `bash: kill: (${p}) - No such process\n`; continue; }
    if (pr.user !== s.user.name && s.user.uid !== 0) { err += `bash: kill: (${p}) - Operation not permitted\n`; continue; }
    if (pr.pid === 777) { err += "bash: kill: (777): that is your own terminal shell; the simulator will not close it\n"; continue; }
    if (pr.ignoresTerm && sig !== 9) continue; // the process ignores this signal: it survives, silently, as in a real system
    s.procs = s.procs.filter((x) => x.pid !== pr.pid);
  }
  return { out: "", err, code: err ? 1 : 0 };
};

// ── Help and man ─────────────────────────────────────────────────────────
export interface ManPage { name: string; synopsis: string; about: string; options: [string, string][]; examples: string[] }
export const MAN: Record<string, ManPage> = {
  pwd: { name: "pwd", synopsis: "pwd", about: "Print the absolute path of the current directory.", options: [], examples: ["pwd"] },
  cd: { name: "cd", synopsis: "cd [dir]", about: "Change directory. With no argument go to $HOME; `cd -` goes back. Needs the execute (search) bit on the directory.", options: [], examples: ["cd logs", "cd ..", "cd -"] },
  ls: { name: "ls", synopsis: "ls [-lahRStr1] [file...]", about: "List directory contents.", options: [["-l", "long format: mode, links, owner, group, size, date"], ["-a", "include hidden names (those starting with .)"], ["-h", "human sizes with -l"], ["-R", "recurse into directories"], ["-S", "sort by size, largest first"], ["-t", "sort by modified time, newest first"], ["-r", "reverse the order"], ["-1", "one name per line"]], examples: ["ls -la", "ls -lS logs", "ls -R docs"] },
  cat: { name: "cat", synopsis: "cat [-n] [file...]", about: "Print files (or standard input) in order.", options: [["-n", "number all lines"]], examples: ["cat notes.txt", "cat -n todo.txt"] },
  head: { name: "head", synopsis: "head [-n N | -N] [file...]", about: "Print the first N lines (default 10).", options: [["-n N", "number of lines"]], examples: ["head -n 3 logs/app.log"] },
  tail: { name: "tail", synopsis: "tail [-n N | -N | -n +N] [file...]", about: "Print the last N lines (default 10); -n +N starts at line N.", options: [["-n N", "number of lines"]], examples: ["tail -n 5 logs/error.log"] },
  wc: { name: "wc", synopsis: "wc [-lwc] [file...]", about: "Count lines, words and bytes.", options: [["-l", "lines"], ["-w", "words"], ["-c", "bytes"]], examples: ["wc -l logs/app.log", "wc -c logs/*.log"] },
  grep: { name: "grep", synopsis: "grep [-inrvcElhE] PATTERN [file...]", about: "Print lines that match a pattern. The pattern is a basic regular expression (use -E for extended). Exit status 1 means no line matched.", options: [["-i", "ignore case"], ["-n", "show line numbers"], ["-v", "invert: print lines that do not match"], ["-c", "print only a count of matching lines"], ["-r", "search directories recursively"], ["-E", "extended regular expressions (|, +, ?, groups)"], ["-l", "print only names of matching files"], ["-h", "no file name prefix"]], examples: ["grep -n ERROR logs/app.log", "grep -ri warn logs", "ls | grep log"] },
  sort: { name: "sort", synopsis: "sort [-nru] [file...]", about: "Sort lines. Uses plain byte (C locale) order, so capitals sort before lower case.", options: [["-n", "compare as numbers"], ["-r", "reverse"], ["-u", "drop duplicate lines"]], examples: ["sort data/words.txt", "sort -nr numbers.txt"] },
  uniq: { name: "uniq", synopsis: "uniq [-c] [file]", about: "Collapse ADJACENT identical lines (sort first to group them).", options: [["-c", "prefix each line with its count"]], examples: ["sort data/words.txt | uniq -c"] },
  cut: { name: "cut", synopsis: "cut -d DELIM -f LIST [file...]  or  cut -c LIST", about: "Select fields (or characters) from each line. LIST is like 1,3 or 2-4.", options: [["-d", "field delimiter (one character, default tab)"], ["-f", "fields to keep"], ["-c", "characters to keep"]], examples: ["cut -d, -f2,3 data/sales.csv"] },
  tr: { name: "tr", synopsis: "tr [-ds] SET1 [SET2]", about: "Translate or delete characters from standard input. Sets accept ranges (a-z) and classes ([:upper:]).", options: [["-d", "delete characters in SET1"], ["-s", "squeeze repeats"]], examples: ["echo hello | tr a-z A-Z", "echo a--b | tr -s -"] },
  echo: { name: "echo", synopsis: "echo [-ne] [text...]", about: "Print its arguments.", options: [["-n", "no trailing newline"], ["-e", "interpret \\n and \\t"]], examples: ["echo hello > hi.txt", "echo \"$HOME\""] },
  touch: { name: "touch", synopsis: "touch file...", about: "Create an empty file or update its modified time.", options: [], examples: ["touch new.txt"] },
  mkdir: { name: "mkdir", synopsis: "mkdir [-p] dir...", about: "Create directories. Needs write and execute on the parent.", options: [["-p", "create parents, no error if it exists"]], examples: ["mkdir -p reports/2025/q1"] },
  cp: { name: "cp", synopsis: "cp [-r] source... dest", about: "Copy files; into dest if it is a directory.", options: [["-r", "copy directories recursively"]], examples: ["cp notes.txt backup.txt", "cp -r docs docs-copy"] },
  mv: { name: "mv", synopsis: "mv source... dest", about: "Move or rename. Needs write and execute on both parent directories.", options: [], examples: ["mv todo.txt done.txt"] },
  rm: { name: "rm", synopsis: "rm [-rf] file...", about: "Remove files (there is no trash: it is gone). Deleting needs write on the PARENT directory, not on the file.", options: [["-r", "remove directories and their contents"], ["-f", "ignore missing files, never complain"]], examples: ["rm old.txt", "rm -r scratch"] },
  find: { name: "find", synopsis: "find [path...] [-name PATTERN] [-type f|d] [-maxdepth N]", about: "Walk directories and print matching paths (sorted by name here; real find uses directory order).", options: [["-name", "match the file name with * and ?"], ["-type", "f for files, d for directories"], ["-maxdepth", "limit the depth"]], examples: ["find . -name \"*.log\"", "find data -type f"] },
  chmod: { name: "chmod", synopsis: "chmod [-R] MODE file...", about: "Change permission bits (owner only). MODE is octal (644) or symbolic (u+x, go-w, a=r).", options: [["-R", "recurse"]], examples: ["chmod 600 secret.txt", "chmod u+x scripts/backup.sh", "chmod go-rwx data"] },
  chown: { name: "chown", synopsis: "chown [owner][:group] file...", about: "Change owner or group. A normal user cannot give a file away (Operation not permitted); the owner can regroup it into a group they belong to.", options: [], examples: ["chown :staff notes.txt", "chown alice notes.txt"] },
  ps: { name: "ps", synopsis: "ps | ps aux | ps -ef", about: "List processes from the FIXTURE table (not real processes).", options: [], examples: ["ps aux", "ps aux | grep learner"] },
  top: { name: "top", synopsis: "top [-b] [-n 1]", about: "A one-shot snapshot of the fixture process table sorted by CPU. It is not live.", options: [], examples: ["top -b -n 1 | head -8"] },
  kill: { name: "kill", synopsis: "kill [-9 | -TERM | -s SIG] PID...", about: "Send a signal to a fixture process. TERM (15) asks politely and can be ignored; KILL (9) cannot. You may signal only your own processes.", options: [], examples: ["kill 801", "kill -9 802"] },
  man: { name: "man", synopsis: "man command", about: "Show a short manual page for a command (written for this simulator; the real man pages are longer).", options: [], examples: ["man grep"] },
  help: { name: "help", synopsis: "help [command]", about: "With no argument list the commands and shell syntax this simulator understands.", options: [], examples: ["help", "help sort"] },
  history: { name: "history", synopsis: "history", about: "Show the commands you typed. Use the Up and Down arrows to recall them.", options: [], examples: ["history | tail -5"] },
  test: { name: "test", synopsis: "test EXPR   or   [ EXPR ]", about: "Check a condition; sets the exit status (0 true, 1 false). Implemented: -e -f -d -r -w -x -z -n, =, !=.", options: [], examples: ["[ -f notes.txt ] && echo yes"] },
  bash: { name: "bash", synopsis: "bash script   or   ./script", about: "Run a script file line by line in THIS simulator (no loops, functions or if/then). ./script needs the execute bit; `bash script` only needs read.", options: [], examples: ["chmod u+x scripts/backup.sh && scripts/backup.sh"] },
};
MAN.sh = { ...MAN.bash, name: "sh" };
const manText = (m: ManPage) => `NAME\n    ${m.name} (simulated manual page, shortened)\n\nSYNOPSIS\n    ${m.synopsis}\n\nDESCRIPTION\n    ${m.about}\n` + (m.options.length ? `\nOPTIONS\n${m.options.map(([o, d]) => `    ${o.padEnd(10)} ${d}`).join("\n")}\n` : "") + `\nEXAMPLES\n${m.examples.map((e) => `    $ ${e}`).join("\n")}\n`;
CMDS.man = (a) => (a[0] ? (MAN[a[0]] ? ok(manText(MAN[a[0]])) : bad(`No manual entry for ${a[0]}${COMMAND_NAMES.includes(a[0]) ? " (the simulator has no page for this one)" : ""}`)) : bad("What manual page do you want?\nFor example, try 'man man'.", 1));
CMDS.help = (a) => (a[0] ? (MAN[a[0]] ? ok(manText(MAN[a[0]])) : bad(`bash: help: no help topics match ${q(a[0])}.`)) : ok(`Simulated shell. Commands:\n  ${COMMAND_NAMES.join(" ")}\n\nSyntax: quotes ' " and \\, pipes |, redirection > >> <, lists && || ;, variables $HOME ${"${VAR}"} $?, globs * ?, assignments VAR=value.\nType "help <command>" or "man <command>" for a short manual page, or "<command> --help".\nNot implemented: see the "What is not supported" list.\n`));

// Scripts: lines run through the same simulator, so permission checks are real.
function runScript(path: string, ctx: Ctx, needExec: boolean, shown: string): Out {
  const l = lookup(ctx.s, absPath(ctx.s.cwd, path));
  if (!l.ok) return bad(`bash: ${shown}: ${ERR_TEXT[l.err]}`, 127);
  if (l.node.kind === "dir") return bad(`bash: ${shown}: Is a directory`, 126);
  if (needExec ? !can(ctx.s.user, l.node, "x") : !can(ctx.s.user, l.node, "r")) return bad(`bash: ${shown}: Permission denied`, 126);
  if (!can(ctx.s.user, l.node, "r")) return bad(`bash: ${shown}: Permission denied`, 126);
  if (ctx.depth >= LIMITS.scriptDepth) return bad(`bash: ${shown}: scripts are nested too deeply for this simulator`, 1);
  let acc: Out = ok();
  for (const line of lines(l.node.data)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const r = execInner(ctx.s, line, { depth: ctx.depth + 1, budget: ctx.budget, tty: false, record: false });
    acc = merge(acc, { out: r.chunks.filter((c) => c.s === "out").map((c) => c.text).join(""), err: r.chunks.filter((c) => c.s === "err").map((c) => c.text).join(""), code: r.status });
    if (ctx.s.status !== 0) { acc.code = ctx.s.status; if (/not supported|command not found/.test(acc.err)) break; }
  }
  return acc;
}
CMDS.bash = (a, ctx) => { if (!a.length) return bad("bash: interactive sub-shells are not supported; give a script file name", 2); return runScript(a[0], ctx, false, a[0]); };
CMDS.sh = CMDS.bash;

export const COMMAND_NAMES = Object.keys(CMDS).filter((c) => c !== "[").sort();

// ── Execution ────────────────────────────────────────────────────────────
export interface Frame { stage: number; cmd: string; argv: string[]; stdin: string | null; stdout: string; stderr: string; status: number; redirect?: string }
export interface PipelineRecord { text: string; frames: Frame[]; status: number; skipped?: boolean }
export interface Chunk { s: "out" | "err"; text: string }
export interface RunResult { line: string; chunks: Chunk[]; status: number; pipelines: PipelineRecord[]; cleared: boolean; changedFs: boolean }

const capText = (t: string) => (t.length > LIMITS.output ? t.slice(0, LIMITS.output) + "\n[output truncated by the simulator]\n" : t);

function runCommand(ctx: Ctx, cmd: SimpleCmd, stdin: string | null): { frame: Omit<Frame, "stage">; out: Out; toFile: boolean } {
  const { s } = ctx;
  const argv = cmd.words.flatMap((w) => expandWord(s, w));
  // Assignments only (VAR=value): set shell variables.
  if (argv.length && cmd.words.every((w) => /^[A-Za-z_]\w*=/.test(w[0]?.t ?? "") && w[0].q === "n")) {
    if (!ctx.inPipe) for (const x of argv) { const i = x.indexOf("="); s.env[x.slice(0, i)] = x.slice(i + 1); }
    return { frame: { cmd: cmd.text, argv, stdin, stdout: "", stderr: "", status: 0 }, out: ok(), toFile: false };
  }
  let input = stdin, redirect: string | undefined, outFile: { path: string; append: boolean } | null = null;
  const early: string[] = [];
  for (const r of cmd.redirs) {
    const tgt = expandWord(s, r.target);
    if (tgt.length !== 1) { early.push(`bash: ${tgt.join(" ") || "(empty)"}: ambiguous redirect`); continue; }
    const path = tgt[0];
    if (r.op === "<") {
      const t = readText(s, path);
      if ("err" in t) early.push(`bash: ${path}: ${ERR_TEXT[t.err]}`); else input = t.text;
    } else { outFile = { path, append: r.op === ">>" }; redirect = `${r.op} ${path}`; }
  }
  if (early.length) { const e = early.join("\n") + "\n"; return { frame: { cmd: cmd.text, argv, stdin: input, stdout: "", stderr: e, status: 1, redirect }, out: { out: "", err: e, code: 1 }, toFile: false }; }
  let out: Out;
  const name = argv[0];
  if (!name) out = ok();
  else if (--ctx.budget.n < 0) out = bad("bash: too many commands for one simulator run", 1);
  else if (argv.includes("--help") && MAN[name]) out = ok(manText(MAN[name]));
  else if (Object.prototype.hasOwnProperty.call(CMDS, name)) {
    try { out = CMDS[name](argv.slice(1), { ...ctx, stdin: input, tty: ctx.tty && !outFile }); } catch (e) { out = bad(`${name}: internal simulator error: ${(e as Error).message}`, 1); }
  } else if (name.includes("/")) out = runScript(name, { ...ctx, stdin: input }, true, name);
  else out = bad(`bash: ${name}: command not found`, 127);
  out = { ...out, out: capText(out.out) };
  let toFile = false;
  if (outFile) {
    const e = writeText(s, outFile.path, out.out, outFile.append);
    if (e) out = { out: "", err: out.err + `bash: ${outFile.path}: ${ERR_TEXT[e]}\n`, code: 1 };
    else { toFile = true; }
  }
  return { frame: { cmd: cmd.text, argv, stdin: input, stdout: toFile ? "" : out.out, stderr: out.err, status: out.code, redirect }, out, toFile };
}

function execInner(s: Session, line: string, opt: { depth: number; budget: { n: number }; tty: boolean; record: boolean }): RunResult {
  const res: RunResult = { line, chunks: [], status: 0, pipelines: [], cleared: false, changedFs: false };
  const push = (t: Chunk["s"], text: string) => { if (text) res.chunks.push({ s: t, text }); };
  let items: Pipeline[];
  try { items = parseLine(line); } catch (e) {
    if (e instanceof ShellSyntax) { push("err", e.message + "\n"); s.status = 2; res.status = 2; return res; }
    throw e;
  }
  for (const it of items) {
    if ((it.sep === "&&" && s.status !== 0) || (it.sep === "||" && s.status === 0)) { res.pipelines.push({ text: it.text, frames: [], status: s.status, skipped: true }); continue; }
    const frames: Frame[] = []; let stdin: string | null = null, status = 0;
    const inPipe = it.cmds.length > 1;
    it.cmds.forEach((cmd, i) => {
      const last = i === it.cmds.length - 1;
      const r = runCommand({ s, stdin: null, tty: opt.tty && last, inPipe, depth: opt.depth, budget: opt.budget }, cmd, stdin);
      frames.push({ stage: i, ...r.frame });
      push("err", r.out.err);
      if (last) { if (!r.toFile) { if (r.out.out.includes("\u000c")) res.cleared = true; else push("out", r.out.out); } status = r.out.code; }
      stdin = r.toFile ? "" : r.out.out;
    });
    s.status = status; res.status = status;
    res.pipelines.push({ text: it.text, frames, status });
  }
  if (opt.record) res.changedFs = true;
  return res;
}

/** Run one command line in the session (mutating it) and return the terminal output plus every pipeline stage's input and output. */
export function execLine(s: Session, line: string): RunResult {
  if (line.trim() !== "") s.history.push(line);
  s.clock += 1;
  const r = execInner(s, line, { depth: 0, budget: { n: LIMITS.commands }, tty: true, record: true });
  s.env.PWD = s.cwd;
  return r;
}

// ── Tree and file views for the UI ───────────────────────────────────────
export interface TreeRow { path: string; name: string; depth: number; kind: "file" | "dir"; mode: string; denied?: boolean }
/** Directory tree as the current user can see it: a locked directory shows as denied and is not opened. */
export function treeRows(s: Session, root = "/", maxDepth = 6): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (abs: string, name: string, depth: number) => {
    const l = lookup(s, abs);
    if (!l.ok) return;
    const denied = l.node.kind === "dir" && !can(s.user, l.node, "r");
    rows.push({ path: abs, name, depth, kind: l.node.kind, mode: modeString(l.node), denied });
    if (l.node.kind !== "dir" || denied || depth >= maxDepth) return;
    for (const n of [...l.node.kids.keys()].sort((a, b) => ((l.node.kids.get(a)!.kind === "dir") === (l.node.kids.get(b)!.kind === "dir") ? byName(a, b) : l.node.kids.get(a)!.kind === "dir" ? -1 : 1))) walk(abs === "/" ? "/" + n : abs + "/" + n, n, depth + 1);
  };
  walk(root, root === "/" ? "/" : baseName(root), 0);
  return rows;
}
export function viewFile(s: Session, abs: string): { ok: true; node: FNode; text: string } | { ok: false; node?: FNode; error: string } {
  const l = lookup(s, abs);
  if (!l.ok) return { ok: false, error: ERR_TEXT[l.err] };
  if (l.node.kind === "dir") return { ok: false, node: l.node, error: "Is a directory" };
  if (!can(s.user, l.node, "r")) return { ok: false, node: l.node, error: "Permission denied" };
  return { ok: true, node: l.node, text: l.node.data };
}
export const nodeAt = (s: Session, abs: string): FNode | null => { const l = lookup(s, abs); return l.ok ? l.node : null; };
/** Raw access without permission checks, only for tests and for validators that inspect the fixture. */
export function peek(s: Session, abs: string): FNode | null {
  let cur = s.root;
  for (const p of abs.split("/").filter(Boolean)) { const n = cur.kids.get(p); if (!n) return null; cur = n; }
  return cur;
}

// ── Challenges ───────────────────────────────────────────────────────────
export interface Transcript { lastLine: string; lastOut: string; lines: string[]; outs: string[] }
export interface Challenge { id: string; title: string; goal: string; hint: string; check: (s: Session, t: Transcript) => { ok: boolean; message: string } }
const norm = (t: string) => t.split("\n").map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean);
const logSizes = (s: Session) => [...peek(s, "/home/learner/logs")!.kids].filter(([n, v]) => v.kind === "file" && n.endsWith(".log")).map(([n, v]) => ({ n, size: utf8(v.data) })).sort((a, b) => b.size - a.size);

export const CHALLENGES: Challenge[] = [
  {
    id: "largest-logs", title: "Find the three largest log files", goal: "In ~/logs (not the old folder), show which three .log files are the largest. Your last command's output must list exactly those three files.",
    hint: "ls -lS logs/*.log lists the files by size, largest first (the glob skips the old folder); pipe it to head -3. Or: wc -c logs/*.log | sort -n.",
    check: (s, t) => {
      const top = logSizes(s).slice(0, 3).map((x) => x.n), all = logSizes(s).map((x) => x.n);
      const seen = all.filter((n) => new RegExp(`(^|[\\s/])${n.replace(".", "\\.")}($|\\s)`, "m").test(t.lastOut));
      const good = seen.length === 3 && top.every((n) => seen.includes(n));
      return good ? { ok: true, message: `Correct: ${top.join(", ")}.` } : { ok: false, message: seen.length ? `Your output names ${seen.join(", ")}. It must name exactly the three largest.` : "Your last command's output does not name any .log file yet." };
    },
  },
  {
    id: "count-errors", title: "Count ERROR lines", goal: "Print how many lines of ~/logs/app.log contain ERROR. Your last output must be that number.",
    hint: "grep -c ERROR logs/app.log, or grep ERROR logs/app.log | wc -l.",
    check: (s, t) => { const n = lines(peek(s, "/home/learner/logs/app.log")!.data).filter((l) => l.includes("ERROR")).length; return norm(t.lastOut).join("") === String(n) ? { ok: true, message: `Yes: ${n}.` } : { ok: false, message: `The last output is ${JSON.stringify(t.lastOut.trim())}; expected just the count.` }; },
  },
  {
    id: "top-ips", title: "Top three IP addresses", goal: "From ~/logs/access.log print the three most frequent client addresses with their counts, most frequent first.",
    hint: "cut -d' ' -f1 logs/access.log | sort | uniq -c | sort -nr | head -3",
    check: (s, t) => {
      const c = new Map<string, number>();
      for (const l of lines(peek(s, "/home/learner/logs/access.log")!.data)) { const ip = l.split(" ")[0]; c.set(ip, (c.get(ip) ?? 0) + 1); }
      const want = [...c].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([ip, n]) => `${n} ${ip}`);
      const got = norm(t.lastOut);
      return want.join("|") === got.join("|") ? { ok: true, message: "Correct, and it is a four-stage pipeline." } : { ok: false, message: `Expected ${want.length} lines like "${want[0]}"; got ${got.length}.` };
    },
  },
  {
    id: "run-backup", title: "Make the backup script executable and run it", goal: "scripts/backup.sh is not executable. Give yourself execute permission and run it so that ~/backup/notes.txt exists.",
    hint: "chmod u+x scripts/backup.sh, then scripts/backup.sh (or ./scripts/backup.sh).",
    check: (s) => {
      const sh = peek(s, "/home/learner/scripts/backup.sh"), copy = peek(s, "/home/learner/backup/notes.txt");
      if (!sh || !(sh.mode & 0o100)) return { ok: false, message: "The owner does not have execute permission on backup.sh yet." };
      return copy ? { ok: true, message: "The script ran: backup/notes.txt exists." } : { ok: false, message: "backup.sh is executable, but backup/notes.txt does not exist yet. Run the script." };
    },
  },
  {
    id: "private-copy", title: "A private copy of the secret", goal: "Create ~/vault with mode 700 and copy secret.txt into it. Nobody but you may enter it.",
    hint: "mkdir vault && chmod 700 vault && cp secret.txt vault/",
    check: (s) => {
      const v = peek(s, "/home/learner/vault"), f = peek(s, "/home/learner/vault/secret.txt");
      if (!v || v.kind !== "dir") return { ok: false, message: "There is no ~/vault directory yet." };
      if ((v.mode & 0o777) !== 0o700) return { ok: false, message: `vault has mode ${octal(v)}; it must be 700.` };
      return f && f.data === peek(s, "/home/learner/secret.txt")!.data ? { ok: true, message: "vault is rwx------ and holds the copy." } : { ok: false, message: "secret.txt is not inside vault yet." };
    },
  },
  {
    id: "stop-stuck", title: "Stop the stuck job", goal: "Process stuck_job (it ignores polite signals) is eating the CPU. Stop it, but leave the ETL worker running.",
    hint: "ps aux | grep stuck, then kill PID. If nothing happens, the process ignores SIGTERM: try kill -9 PID.",
    check: (s) => {
      const stuck = s.procs.some((p) => p.cmd.startsWith("stuck_job")), worker = s.procs.some((p) => p.cmd.includes("etl_worker"));
      return !stuck && worker ? { ok: true, message: "stuck_job is gone and etl_worker still runs." } : stuck ? { ok: false, message: "stuck_job is still running." } : { ok: false, message: "You also stopped the ETL worker; it must keep running." };
    },
  },
  {
    id: "explain-denied", title: "Explain a Permission denied", goal: "Try to read /etc/shadow, then inspect its permissions with ls -l so you can say why it failed.",
    hint: "cat /etc/shadow, then ls -l /etc/shadow: owner root, group shadow, mode 640, and you are in neither class.",
    check: (_s, t) => {
      const denied = t.lines.some((l, i) => /\bcat\b.*\/etc\/shadow/.test(l) && /Permission denied/.test(t.outs[i] ?? ""));
      const looked = t.lines.some((l) => /\bls\b.*-\w*l.*\/etc\/shadow|\bls\b.*\/etc\/shadow.*-\w*l|\bls\b.*-l.*\/etc/.test(l));
      return denied && looked ? { ok: true, message: "-rw-r----- root shadow: you are 'other', which has no permissions." } : { ok: false, message: denied ? "Now run ls -l /etc/shadow to see its mode." : "First run cat /etc/shadow and read the error." };
    },
  },
];
export const challengeById = (id: string | undefined) => CHALLENGES.find((c) => c.id === id);

// ── Presets ──────────────────────────────────────────────────────────────
export interface LinuxPreset { id: string; label: string; blurb: string; cwd: string; try: string[]; challenge?: string }
export const PRESETS: LinuxPreset[] = [
  { id: "navigation", label: "Navigate and inspect", blurb: "pwd, ls, cd, cat, head, tail and wc on the sample home directory.", cwd: "/home/learner", try: ["pwd", "ls -la", "cd logs", "head -n 3 app.log", "wc -l *.log", "cd .."] },
  { id: "pipes", label: "Pipes and filters", blurb: "Build pipelines with grep, sort, uniq, cut and tr, and watch each stage's input and output.", cwd: "/home/learner", try: ["cut -d, -f2 data/sales.csv | sort | uniq -c", "sort data/words.txt | uniq -c | sort -nr", "grep -c ERROR logs/app.log", "echo hello world | tr a-z A-Z", "cut -d' ' -f1 logs/access.log | sort | uniq -c | sort -nr | head -3"], challenge: "top-ips" },
  { id: "redirection", label: "Redirection and files", blurb: "> and >> write to files, < reads from one; touch, mkdir, cp, mv, rm.", cwd: "/home/learner", try: ["echo first > out.txt", "echo second >> out.txt", "cat out.txt", "mkdir -p reports/2025", "cp out.txt reports/2025/", "mv out.txt reports/", "find . -name \"*.txt\"", "rm -r reports"] },
  { id: "permissions", label: "Permissions", blurb: "Read rwxr-xr-x, use chmod, and meet Permission denied as a normal user.", cwd: "/home/learner", try: ["ls -l secret.txt scripts/backup.sh", "cat /etc/shadow", "ls -l /etc/shadow", "chmod 755 scripts/backup.sh", "cat /home/alice/private.txt", "echo hi >> /srv/team/report.txt", "chmod 777 /etc/hostname"], challenge: "run-backup" },
  { id: "processes", label: "Processes and signals", blurb: "ps, top and kill on a fixture process table, including a process that ignores SIGTERM.", cwd: "/home/learner", try: ["ps aux", "top -b -n 1 | head -8", "kill 801", "kill 802", "ps aux | grep stuck", "kill -9 802", "kill 512"], challenge: "stop-stuck" },
  { id: "logs", label: "Log detective", blurb: "Challenge: which log files are largest, and how many errors are there?", cwd: "/home/learner", try: ["ls -lS logs", "wc -c logs/*.log", "grep -n ERROR logs/error.log | head -3"], challenge: "largest-logs" },
];
export const presetById = (id: string | undefined) => PRESETS.find((p) => p.id === id);

export const UNSUPPORTED = [
  "Real system access of any kind: this is an in-memory simulation and cannot read or change your computer",
  "Background jobs (&), job control (jobs, fg, bg), 2> and 2>&1 redirection, here-documents (<<), pipes of builtins that need a terminal",
  "Command substitution ($(...) and backticks), arithmetic, arrays, functions, if/for/while, aliases, tab completion, history expansion (!!)",
  "Symbolic and hard links, sudo/su, real users and groups, setuid execution, umask (new files are 644, directories 755)",
  "Most flags: ls -d/-i/--color, grep -w/-F/-A/-B/-P, sort -k/-t/-f/-h, cut -b, head/tail -c and -f, cp/mv -i/-p/-a, rm -i, find -exec/-mtime/-size/-and/-or",
  "Commands not listed by help: awk, sed, xargs, tee, du, df, diff, tar, gzip, ssh, curl, wget, vim, nano, less, date, sleep, which, stat, ln, nohup",
  "Regular expressions are translated to JavaScript regular expressions, so rare POSIX features (back-references in BRE, [[:class:]] inside brackets) can differ",
  "The process table is a fixed fixture: CPU, memory and time figures are made up and never change; top is a single snapshot",
  "sort uses C-locale byte order; ls sorts names ignoring case; find prints sorted names instead of directory order",
];
