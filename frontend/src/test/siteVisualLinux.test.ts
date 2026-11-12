// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHALLENGES, COMMAND_NAMES, LIMITS, MAN, PRESETS, UNSUPPORTED, absPath, applyMode, can, cloneSession, createSession, execLine, explainMode, expandWord, lookup, modeString,
  octal, parseLine, peek, permClass, treeRows, viewFile, type Session, type Transcript,
} from "../site/lib/visual/linux";

const sh = () => createSession();
interface R { out: string; err: string; text: string; status: number; pipelines: ReturnType<typeof execLine>["pipelines"] }
function run(s: Session, line: string): R {
  const r = execLine(s, line);
  const out = r.chunks.filter((c) => c.s === "out").map((c) => c.text).join(""), err = r.chunks.filter((c) => c.s === "err").map((c) => c.text).join("");
  return { out, err, text: r.chunks.map((c) => c.text).join(""), status: r.status, pipelines: r.pipelines };
}
const out = (line: string, s = sh()) => run(s, line).out;
const lines = (t: string) => t.split("\n").filter(Boolean);

describe("virtual file system and permission model", () => {
  it("resolves paths inside the virtual tree only", () => {
    expect(absPath("/home/learner", "../alice/x")).toBe("/home/alice/x");
    expect(absPath("/home/learner", "../../../../..")).toBe("/");
    expect(absPath("/", "a/./b//c/../d")).toBe("/a/b/d");
    expect(absPath("/x", "/etc/hostname")).toBe("/etc/hostname");
  });
  it("applies owner, then group, then other, as real UNIX does", () => {
    const s = sh();
    const f = peek(s, "/srv/team/report.txt")!; // alice:staff 664, learner is in staff
    expect(permClass(s.user, f)).toBe("group");
    expect(can(s.user, f, "w")).toBe(true); expect(can(s.user, f, "x")).toBe(false);
    const sh2 = peek(s, "/etc/shadow")!; // root:shadow 640
    expect(permClass(s.user, sh2)).toBe("other"); expect(can(s.user, sh2, "r")).toBe(false);
    const mine = peek(s, "/home/learner/secret.txt")!; // learner 600
    expect(permClass(s.user, mine)).toBe("owner"); expect(can(s.user, mine, "r")).toBe(true);
    // The owner class wins even when it is stricter than "other".
    mine.mode = 0o077; expect(can(s.user, mine, "r")).toBe(false);
  });
  it("mode strings, octal and the sticky bit", () => {
    const s = sh();
    expect(modeString(peek(s, "/home/learner")!)).toBe("drwxr-xr-x");
    expect(modeString(peek(s, "/home/learner/secret.txt")!)).toBe("-rw-------");
    expect(modeString(peek(s, "/tmp")!)).toBe("drwxrwxrwt"); expect(octal(peek(s, "/tmp")!)).toBe("1777");
    expect(octal(peek(s, "/etc/shadow")!)).toBe("640");
  });
  it("explains a mode in words", () => {
    const s = sh();
    const e = explainMode(peek(s, "/home/learner/scripts/backup.sh")!, s.user);
    expect(e.text).toBe("-rw-r--r--"); expect(e.octal).toBe("644"); expect(e.you).toBe("owner");
    expect(e.classes.map((c) => c.digit)).toEqual([6, 4, 4]);
    expect(e.sentence).toContain("the owner"); expect(e.sentence).toContain("read, write");
    expect(e.sentence).not.toContain("execute");
    expect(explainMode(peek(s, "/etc/shadow")!, s.user).sentence).toContain("may do nothing");
  });
  it("a locked directory hides what is inside it", () => {
    const s = sh();
    expect(lookup(s, "/home/alice/private.txt")).toMatchObject({ ok: false, err: "EACCES" });
    expect(lookup(s, "/home/learner/nothing")).toMatchObject({ ok: false, err: "ENOENT" });
    expect(lookup(s, "/home/learner/notes.txt/x")).toMatchObject({ ok: false, err: "ENOTDIR" });
  });
  it("the tree view reports locked directories and viewFile checks permission", () => {
    const s = sh();
    const rows = treeRows(s, "/home");
    expect(rows.find((r) => r.path === "/home/alice")!.denied).toBe(true);
    expect(rows.some((r) => r.path === "/home/alice/private.txt")).toBe(false);
    expect(rows.some((r) => r.path === "/home/learner/notes.txt")).toBe(true);
    expect(viewFile(s, "/etc/shadow")).toMatchObject({ ok: false, error: "Permission denied" });
    expect(viewFile(s, "/etc/hostname")).toMatchObject({ ok: true, text: "dataforge-lab\n" });
  });
});

describe("parser", () => {
  const words = (l: string) => parseLine(l)[0].cmds[0].words.map((w) => w.map((x) => x.t).join(""));
  it("splits words and honours quotes and escapes", () => {
    expect(words("echo a   b")).toEqual(["echo", "a", "b"]);
    expect(words("echo 'a  b' \"c  d\"")).toEqual(["echo", "a  b", "c  d"]);
    expect(words("echo a\\ b")).toEqual(["echo", "a b"]);
    expect(words("echo \"say \\\"hi\\\"\"")).toEqual(["echo", 'say "hi"']);
    expect(words("echo it''s")).toEqual(["echo", "its"]);
    expect(words("echo a # comment")).toEqual(["echo", "a"]);
    expect(words("echo a#b")).toEqual(["echo", "a#b"]);
  });
  it("builds pipelines, redirections and lists", () => {
    const p = parseLine("cat a | grep x | wc -l > n.txt && echo ok; ls || pwd");
    expect(p.map((x) => x.sep)).toEqual([null, "&&", ";", "||"]);
    expect(p[0].cmds).toHaveLength(3);
    expect(p[0].cmds[2].redirs[0].op).toBe(">");
    expect(parseLine("a >> f < g")[0].cmds[0].redirs.map((r) => r.op)).toEqual([">>", "<"]);
    expect(parseLine("echo a|b")[0].cmds).toHaveLength(2);
  });
  it("reports syntax errors in bash's words, without throwing from execLine", () => {
    for (const l of ["ls |", "| ls", "ls ;; ls", "echo 'open", "echo \"open", "ls >", "ls && "]) expect(() => parseLine(l), l).toThrow();
    expect(run(sh(), "ls |").err).toContain("syntax error near unexpected token");
    expect(run(sh(), "echo 'open").err).toContain("unexpected EOF");
    expect(run(sh(), "ls |").status).toBe(2);
  });
  it("refuses constructs it cannot simulate, and says so", () => {
    expect(run(sh(), "echo $(whoami)").err).toContain("command substitution is not supported");
    expect(run(sh(), "echo `whoami`").err).toContain("not supported");
    expect(run(sh(), "sleep 5 &").err).toContain("not supported");
    expect(run(sh(), "ls nothing 2> /dev/null").err).toContain("not supported");
    expect(run(sh(), "cat << EOF").err).toContain("not supported");
  });
});

describe("expansion and globbing", () => {
  it("expands variables, tilde and $?", () => {
    const s = sh();
    expect(out("echo $HOME ~ ${USER}", s)).toBe("/home/learner /home/learner learner\n");
    expect(out("echo \"$HOME/x\" '$HOME' \\$HOME", s)).toBe("/home/learner/x $HOME $HOME\n");
    run(s, "ls nothing"); expect(out("echo $?", s)).toBe("2\n");
    run(s, "NAME=data"); expect(out("ls $NAME", s)).toBe("sales.csv  users.csv  words.txt\n");
    expect(out("echo $UNSET_VAR|wc -c", s)).toBe("1\n");
    run(s, "export GREETING=hello"); expect(out("echo $GREETING", s)).toBe("hello\n");
  });
  it("globs * and ? against the virtual tree, sorted, skipping hidden names", () => {
    const s = sh();
    expect(out("echo *.txt", s)).toBe("notes.txt secret.txt todo.txt\n");
    expect(out("echo logs/?pp.log", s)).toBe("logs/app.log\n");
    expect(out("echo logs/*.log", s)).toBe("logs/access.log logs/app.log logs/debug.log logs/error.log\n");
    expect(out("echo */*.csv", s)).toBe("data/sales.csv data/users.csv\n");
    expect(out("echo /etc/ho*", s)).toBe("/etc/hostname\n");
    expect(out("echo .h*", s)).toBe(".hidden\n");
    expect(out("echo *", s)).not.toContain(".bashrc");
  });
  it("quoted wildcards stay literal and an unmatched pattern is kept as typed", () => {
    const s = sh();
    expect(out("echo \"*.txt\" '*.log' \\*", s)).toBe("*.txt *.log *\n");
    expect(out("echo *.zzz", s)).toBe("*.zzz\n");
    expect(run(s, "cat *.zzz").err).toContain("cat: *.zzz: No such file or directory");
  });
  it("expandWord works on its own", () => {
    const s = sh();
    expect(expandWord(s, parseLine("x data/*")[0].cmds[0].words[1])).toEqual(["data/sales.csv", "data/users.csv", "data/words.txt"]);
  });
});

describe("navigation and reading commands", () => {
  it("pwd and cd", () => {
    const s = sh();
    expect(out("pwd", s)).toBe("/home/learner\n");
    run(s, "cd logs"); expect(out("pwd", s)).toBe("/home/learner/logs\n");
    run(s, "cd .."); expect(out("pwd", s)).toBe("/home/learner\n");
    run(s, "cd /var/log"); expect(out("pwd", s)).toBe("/var/log\n");
    run(s, "cd -"); expect(out("pwd", s)).toBe("/home/learner\n");
    run(s, "cd"); expect(s.cwd).toBe("/home/learner");
    run(s, "cd /"); run(s, "cd .."); expect(s.cwd).toBe("/");
    expect(s.env.PWD).toBe("/");
  });
  it("ls: plain, -a, -l, -h, -R, -S", () => {
    const s = sh();
    expect(out("ls", s)).toBe("data  docs  logs  notes.txt  scripts  secret.txt  todo.txt\n");
    expect(out("ls | head -3", s)).toBe("data\ndocs\nlogs\n"); // piped: one per line
    expect(out("ls -a", s)).toMatch(/^\.  \.\.  \.bashrc  \.hidden  data/);
    const l = lines(out("ls -l", s));
    expect(l[0]).toMatch(/^total \d+$/);
    expect(l.find((x) => x.endsWith(" notes.txt"))).toMatch(/^-rw-r--r-- 1 learner learner +61 [A-Z][a-z]{2} [ \d]\d \d\d:\d\d notes\.txt$/);
    expect(l.find((x) => x.endsWith(" data"))).toMatch(/^drwxr-xr-x 2 learner learner 4096 /);
    expect(l.find((x) => x.endsWith("secret.txt"))).toMatch(/^-rw------- 1 learner learner/);
    expect(out("ls -lh logs", s)).toMatch(/\d\.\dK|\dK|\d+K/);
    const bySize = lines(out("ls -lS logs", s)).slice(1).map((x) => x.split(" ").pop());
    expect(bySize.slice(0, 4)).toEqual(["old", "access.log", "app.log", "debug.log"]); // a directory counts as 4096 bytes
    expect(out("ls -R docs data", s)).toContain("docs:\nreadme.md");
    expect(out("ls -R logs", s)).toContain("logs/old:\narchive.log");
    expect(out("ls docs notes.txt", s)).toBe("notes.txt\n\ndocs:\nreadme.md\n");
    expect(out("ls -1", s).split("\n")).toHaveLength(8);
    expect(out("ls -r data", s)).toBe("words.txt  users.csv  sales.csv\n");
  });
  it("cat, head, tail", () => {
    const s = sh();
    expect(out("cat todo.txt", s)).toBe("1. learn pipes\n2. learn chmod\n3. learn grep\n");
    expect(out("cat -n todo.txt", s)).toBe("     1\t1. learn pipes\n     2\t2. learn chmod\n     3\t3. learn grep\n");
    expect(out("cat todo.txt notes.txt | wc -l", s)).toBe("6\n");
    expect(lines(out("head logs/app.log", s))).toHaveLength(10);
    expect(lines(out("head -n 3 logs/app.log", s))).toHaveLength(3);
    expect(out("head -2 todo.txt", s)).toBe("1. learn pipes\n2. learn chmod\n");
    expect(out("tail -n 1 todo.txt", s)).toBe("3. learn grep\n");
    expect(out("tail -1 todo.txt", s)).toBe("3. learn grep\n");
    expect(out("tail -n +3 todo.txt", s)).toBe("3. learn grep\n");
    expect(out("head -n 1 todo.txt notes.txt", s)).toBe("==> todo.txt <==\n1. learn pipes\n\n==> notes.txt <==\nRemember to review the logs.\n");
    expect(out("head -n 0 todo.txt", s)).toBe("");
    expect(run(s, "head -n x todo.txt").err).toContain("invalid number of lines");
  });
  it("wc", () => {
    const s = sh();
    expect(out("wc -l logs/app.log", s)).toBe("40 logs/app.log\n");
    expect(out("wc -l < logs/app.log", s)).toBe("40\n");
    expect(out("wc notes.txt", s)).toMatch(/^\s*3\s+11\s+61 notes\.txt\n$/);
    expect(out("wc -w notes.txt", s)).toBe("11 notes.txt\n");
    expect(out("wc -c notes.txt", s)).toBe("61 notes.txt\n");
    const m = lines(out("wc -l logs/app.log logs/error.log", s));
    expect(m).toHaveLength(3); expect(m[2]).toMatch(/\s*48 total$/);
    expect(out("echo a b c | wc -w", s)).toBe("3\n");
  });
});

describe("filters", () => {
  it("grep: -i -n -v -c -r -E -l", () => {
    const s = sh();
    expect(out("grep -c ERROR logs/app.log", s)).toBe("5\n");
    expect(out("grep -c error logs/app.log", s)).toBe("0\n");
    expect(out("grep -ci error logs/app.log", s)).toBe("5\n");
    expect(out("grep -n ERROR logs/error.log | head -1", s)).toBe("1:2025-03-05 11:00:12 ERROR code=E100 timeout\n");
    expect(lines(out("grep -v INFO logs/app.log", s))).toHaveLength(40 - 25);
    expect(out("grep -c WARN logs/app.log logs/error.log", s)).toBe("logs/app.log:5\nlogs/error.log:0\n");
    expect(out("grep -r 'disk full' logs", s).split("\n")[0]).toMatch(/^logs\/error\.log:/);
    expect(out("grep -rl 'archived entry 7' .", s)).toBe("logs/old/archive.log\n");
    expect(out("grep -r learn", s)).toContain("todo.txt:1. learn pipes");
    expect(out("grep -E 'WARN|ERROR' logs/app.log | wc -l", s)).toBe("10\n");
    expect(out("grep 'WARN\\|ERROR' logs/app.log | wc -l", s)).toBe("10\n"); // BRE alternation
    expect(out("grep 'a|b' notes.txt", s)).toBe(""); // | is literal in a basic regex
    expect(out("echo hello | grep -i HELLO", s)).toBe("hello\n");
    expect(run(s, "grep zzz notes.txt").status).toBe(1);
    expect(run(s, "grep '[' notes.txt").err).toContain("Invalid regular expression");
  });
  it("sort: default byte order, -n, -r, -u", () => {
    const s = sh();
    expect(out("sort data/words.txt", s)).toBe("Elderberry\napple\napple\napple\nbanana\nbanana\ncherry\ndate\nfig\n");
    expect(out("sort -u data/words.txt", s)).toBe("Elderberry\napple\nbanana\ncherry\ndate\nfig\n");
    expect(out("sort -r data/words.txt | head -2", s)).toBe("fig\ndate\n");
    run(s, "echo 10 > n.txt"); run(s, "echo 9 >> n.txt"); run(s, "echo 100 >> n.txt");
    expect(out("sort n.txt", s)).toBe("10\n100\n9\n"); // text order
    expect(out("sort -n n.txt", s)).toBe("9\n10\n100\n");
    expect(out("sort -nr n.txt", s)).toBe("100\n10\n9\n");
  });
  it("uniq -c only collapses adjacent lines", () => {
    const s = sh();
    expect(out("uniq -c data/words.txt | head -3", s)).toBe("      1 banana\n      1 apple\n      1 cherry\n");
    expect(out("sort data/words.txt | uniq -c", s)).toBe("      1 Elderberry\n      3 apple\n      2 banana\n      1 cherry\n      1 date\n      1 fig\n");
    expect(out("sort data/words.txt | uniq", s).split("\n").length).toBe(7);
  });
  it("cut -d -f and -c", () => {
    const s = sh();
    expect(out("cut -d, -f2,3 data/sales.csv | head -2", s)).toBe("region,product\nNorth,Pen\n");
    expect(out("cut -d, -f1 data/users.csv | head -3", s)).toBe("name\nada\ngrace\n");
    expect(out("cut -d' ' -f1 logs/access.log | head -1", s)).toBe("10.0.0.5\n");
    expect(out("cut -d, -f2-3 data/users.csv | head -2", s)).toBe("city,age\nlondon,36\n");
    expect(out("cut -c1-3 todo.txt", s)).toBe("1. \n2. \n3. \n");
    expect(out("echo abc | cut -d, -f1", s)).toBe("abc\n"); // no delimiter: whole line
    expect(run(s, "cut data/users.csv").err).toContain("you must specify");
  });
  it("tr translates, deletes and squeezes", () => {
    const s = sh();
    expect(out("echo hello world | tr a-z A-Z", s)).toBe("HELLO WORLD\n");
    expect(out("echo hello | tr -d l", s)).toBe("heo\n");
    expect(out("echo 'a   b' | tr -s ' '", s)).toBe("a b\n");
    expect(out("echo hello | tr '[:lower:]' '[:upper:]'", s)).toBe("HELLO\n");
    expect(out("echo abc | tr abc xy", s)).toBe("xyy\n"); // SET2 is padded with its last character
    expect(out("echo a,b | tr ',' '\\n'", s)).toBe("a\nb\n");
    expect(run(s, "tr a").err).toContain("missing operand");
  });
  it("echo flags", () => {
    expect(out("echo -n hi")).toBe("hi");
    expect(out("echo -e 'a\\tb'")).toBe("a\tb\n");
    expect(out("echo")).toBe("\n");
  });
});

describe("pipes and pipeline frames", () => {
  it("three stages: each stage's input is the previous stage's output", () => {
    const s = sh();
    const r = run(s, "cut -d, -f2 data/sales.csv | sort | uniq -c");
    const f = r.pipelines[0].frames;
    expect(f).toHaveLength(3);
    expect(f.map((x) => x.argv[0])).toEqual(["cut", "sort", "uniq"]);
    expect(f[0].stdin).toBeNull();
    expect(f[1].stdin).toBe(f[0].stdout); expect(f[2].stdin).toBe(f[1].stdout);
    expect(f[0].stdout).toBe("region\nNorth\nSouth\nNorth\nEast\nSouth\nNorth\nEast\n");
    expect(f[1].stdout).toBe("East\nEast\nNorth\nNorth\nNorth\nSouth\nSouth\nregion\n");
    expect(f[2].stdout).toBe("      2 East\n      3 North\n      2 South\n      1 region\n");
    expect(r.out).toBe(f[2].stdout);
    expect(f.map((x) => x.stage)).toEqual([0, 1, 2]);
  });
  it("a four-stage log pipeline gives the right top addresses", () => {
    expect(out("cut -d' ' -f1 logs/access.log | sort | uniq -c | sort -nr | head -3")).toBe("     25 10.0.0.5\n     15 10.0.0.7\n     10 192.168.1.20\n");
  });
  it("stderr is not piped on: it reaches the terminal and the next stage sees nothing", () => {
    const s = sh();
    const r = run(s, "cat nothing | wc -l");
    expect(r.err).toBe("cat: nothing: No such file or directory\n");
    expect(r.out).toBe("0\n");
    const f = r.pipelines[0].frames;
    expect(f[0].stderr).toContain("No such file"); expect(f[0].stdout).toBe(""); expect(f[1].stdin).toBe("");
  });
  it("the exit status of a pipeline is the last stage's", () => {
    const s = sh();
    expect(run(s, "grep zzz notes.txt | wc -l").status).toBe(0);
    expect(run(s, "ls | grep zzz").status).toBe(1);
  });
  it("&& || ; run pipelines conditionally and record skipped ones", () => {
    const s = sh();
    expect(out("false && echo no", s)).toBe("");
    expect(out("false || echo yes", s)).toBe("yes\n");
    expect(out("true && echo a; echo b", s)).toBe("a\nb\n");
    expect(out("true || echo no", s)).toBe("");
    const r = run(s, "ls nothing && echo unreachable; echo reached");
    expect(r.out).toBe("reached\n"); expect(r.err).toContain("cannot access");
    expect(r.pipelines.map((p) => !!p.skipped)).toEqual([false, true, false]);
  });
  it("cd inside a pipeline is a subshell and does not move you", () => {
    const s = sh();
    run(s, "cd logs | cat"); expect(s.cwd).toBe("/home/learner");
    run(s, "cd logs && pwd"); expect(s.cwd).toBe("/home/learner/logs");
  });
  it("a redirect on a middle stage sends its output to the file, so the next stage sees an empty input", () => {
    const s = sh();
    const r = run(s, "echo hi > a.txt | wc -c");
    expect(r.out).toBe("0\n"); expect(peek(s, "/home/learner/a.txt")!.data).toBe("hi\n");
    expect(r.pipelines[0].frames[0].redirect).toBe("> a.txt");
  });
});

describe("redirection", () => {
  it("> truncates, >> appends, < reads", () => {
    const s = sh();
    expect(run(s, "echo first > out.txt").text).toBe("");
    run(s, "echo second >> out.txt");
    expect(out("cat out.txt", s)).toBe("first\nsecond\n");
    run(s, "echo again > out.txt"); expect(out("cat out.txt", s)).toBe("again\n");
    expect(out("wc -l < out.txt", s)).toBe("1\n");
    expect(out("sort < data/words.txt | head -1", s)).toBe("Elderberry\n");
    run(s, "grep ERROR logs/app.log > errs.txt"); expect(out("wc -l < errs.txt", s)).toBe("5\n");
  });
  it("redirect errors read like bash", () => {
    const s = sh();
    expect(run(s, "cat < nothing").err).toBe("bash: nothing: No such file or directory\n");
    expect(run(s, "echo x > /etc/new").err).toBe("bash: /etc/new: Permission denied\n");
    expect(run(s, "echo x > /nodir/f").err).toBe("bash: /nodir/f: No such file or directory\n");
    expect(run(s, "echo x > docs").err).toBe("bash: docs: Is a directory\n");
    expect(run(s, "echo x > /etc/hostname").err).toContain("Permission denied");
    expect(peek(s, "/etc/hostname")!.data).toBe("dataforge-lab\n");
    expect(run(s, "cat < docs").err).toContain("Is a directory");
  });
  it("a failed command still creates its redirect target, as in bash", () => {
    const s = sh();
    run(s, "cat nothing > made.txt");
    expect(peek(s, "/home/learner/made.txt")).not.toBeNull();
  });
});

describe("file management", () => {
  it("touch, mkdir, mkdir -p", () => {
    const s = sh();
    run(s, "touch a.txt"); expect(peek(s, "/home/learner/a.txt")!.data).toBe("");
    const before = peek(s, "/home/learner/a.txt")!.mtime;
    run(s, "touch a.txt"); expect(peek(s, "/home/learner/a.txt")!.mtime).toBeGreaterThan(before);
    run(s, "mkdir d"); expect(peek(s, "/home/learner/d")!.kind).toBe("dir");
    expect(run(s, "mkdir d").err).toBe("mkdir: cannot create directory 'd': File exists\n");
    expect(run(s, "mkdir x/y/z").err).toBe("mkdir: cannot create directory 'x/y/z': No such file or directory\n");
    run(s, "mkdir -p x/y/z"); expect(peek(s, "/home/learner/x/y/z")).not.toBeNull();
    expect(run(s, "mkdir -p x/y/z").status).toBe(0);
    expect(run(s, "touch a.txt/b").err).toContain("Not a directory");
    expect(run(s, "mkdir").err).toContain("missing operand");
  });
  it("cp, cp -r, mv", () => {
    const s = sh();
    run(s, "cp notes.txt copy.txt"); expect(out("cat copy.txt", s)).toBe(out("cat notes.txt", s));
    run(s, "cp notes.txt todo.txt docs"); expect(out("ls docs", s)).toBe("notes.txt  readme.md  todo.txt\n");
    expect(run(s, "cp docs d2").err).toBe("cp: -r not specified; omitting directory 'docs'\n");
    run(s, "cp -r docs d2"); expect(out("ls d2", s)).toBe("notes.txt  readme.md  todo.txt\n");
    expect(run(s, "cp nothing x").err).toBe("cp: cannot stat 'nothing': No such file or directory\n");
    expect(run(s, "cp notes.txt notes.txt").err).toContain("are the same file");
    expect(run(s, "cp notes.txt todo.txt nothing").err).toContain("is not a directory");
    expect(run(s, "cp notes.txt nodir/x").err).toContain("No such file or directory");
    expect(run(s, "cp -r docs docs/sub").err).toContain("into itself");
    run(s, "mv copy.txt moved.txt"); expect(peek(s, "/home/learner/copy.txt")).toBeNull(); expect(out("cat moved.txt", s)).toBe(out("cat notes.txt", s));
    run(s, "mv moved.txt docs"); expect(peek(s, "/home/learner/docs/moved.txt")).not.toBeNull();
    run(s, "mv d2 docs"); expect(peek(s, "/home/learner/docs/d2/readme.md")).not.toBeNull();
    expect(run(s, "mv nothing x").err).toBe("mv: cannot stat 'nothing': No such file or directory\n");
    expect(run(s, "mv docs docs/d2/inner").err).toContain("subdirectory of itself");
    // a copy is independent of the original
    run(s, "echo changed > copy2.txt"); run(s, "cp copy2.txt copy3.txt"); run(s, "echo more >> copy3.txt");
    expect(out("cat copy2.txt", s)).toBe("changed\n");
  });
  it("rm, rm -r, rm -f", () => {
    const s = sh();
    run(s, "touch a b"); run(s, "rm a"); expect(peek(s, "/home/learner/a")).toBeNull();
    expect(run(s, "rm docs").err).toBe("rm: cannot remove 'docs': Is a directory\n");
    run(s, "rm -r docs"); expect(peek(s, "/home/learner/docs")).toBeNull();
    expect(run(s, "rm nothing").err).toBe("rm: cannot remove 'nothing': No such file or directory\n");
    expect(run(s, "rm -f nothing").text).toBe(""); expect(run(s, "rm -f nothing").status).toBe(0);
    expect(run(s, "rm -rf logs").status).toBe(0); expect(peek(s, "/home/learner/logs")).toBeNull();
    expect(run(s, "rm -r .").err).toContain("refusing to remove '.' or '..'");
    expect(run(s, "rm").err).toContain("missing operand");
  });
  it("rm -rf / is refused and nothing is removed", () => {
    const s = sh();
    const r = run(s, "rm -rf /");
    expect(r.err).toContain("dangerous to operate recursively on '/'");
    expect(s.root.kids.size).toBeGreaterThan(3);
  });
  it("find: -name, -type, -maxdepth, sorted output, errors", () => {
    const s = sh();
    expect(out("find . -name \"*.log\"", s)).toBe("./logs/access.log\n./logs/app.log\n./logs/debug.log\n./logs/error.log\n./logs/old/archive.log\n");
    expect(out("find data -type f", s)).toBe("data/sales.csv\ndata/users.csv\ndata/words.txt\n");
    expect(out("find . -type d -maxdepth 1", s)).toBe(".\n./data\n./docs\n./logs\n./scripts\n");
    expect(out("find logs -name 'a*'", s)).toBe("logs/access.log\nlogs/app.log\nlogs/old/archive.log\n");
    expect(out("find . -name notes.txt", s)).toBe("./logs/notes.txt\n./notes.txt\n");
    expect(out("find /srv -name '*.txt' | wc -l", s)).toBe("2\n");
    expect(run(s, "find nothing").err).toBe("find: 'nothing': No such file or directory\n");
    expect(run(s, "find /home/alice").err).toContain("Permission denied");
    expect(run(s, "find . -mtime 1").err).toContain("unknown predicate");
  });
});

describe("chmod", () => {
  it("applyMode: octal and symbolic", () => {
    const t: [number, string, number][] = [
      [0o644, "755", 0o755], [0o644, "0600", 0o600], [0o644, "000", 0], [0o644, "u+x", 0o744], [0o644, "+x", 0o755], [0o644, "a+x", 0o755], [0o644, "go-r", 0o600],
      [0o644, "u=rwx,g=rx,o=", 0o750], [0o755, "go-rwx", 0o700], [0o600, "g+r", 0o640], [0o644, "a=r", 0o444], [0o644, "o+w", 0o646], [0o777, "u-w,g-w,o-w", 0o555], [0o600, "ug+rw", 0o660],
    ];
    for (const [cur, spec, want] of t) expect(applyMode(cur, spec, false), `${cur.toString(8)} ${spec}`).toBe(want);
    expect(applyMode(0o755, "+t", true)! & 0o1000).toBe(0o1000);
    expect(applyMode(0o644, "u+X", false)).toBe(0o644); expect(applyMode(0o744, "g+X", false)).toBe(0o754);
    for (const bad of ["999", "u+z", "rwx", "", "u+x,", "u~x", "8"]) expect(applyMode(0o644, bad, false), bad).toBeNull();
  });
  it("changes the bits that ls -l shows", () => {
    const s = sh();
    run(s, "chmod 600 notes.txt"); expect(out("ls -l notes.txt", s)).toMatch(/^-rw------- /);
    run(s, "chmod u+x,g+w notes.txt"); expect(out("ls -l notes.txt", s)).toMatch(/^-rwx-w---- /);
    run(s, "chmod 755 scripts/backup.sh"); expect(octal(peek(s, "/home/learner/scripts/backup.sh")!)).toBe("755");
    run(s, "chmod -R go-rwx data"); expect(out("ls -l data", s)).toMatch(/^total \d+\n(-rw-------.*\n){3}$/);
    expect(modeString(peek(s, "/home/learner/data")!)).toBe("drwx------");
  });
  it("errors", () => {
    const s = sh();
    expect(run(s, "chmod 999 notes.txt").err).toBe("chmod: invalid mode: '999'\nTry 'chmod --help' for more information.\n");
    expect(run(s, "chmod 644 nothing").err).toBe("chmod: cannot access 'nothing': No such file or directory\n");
    expect(run(s, "chmod 777 /etc/hostname").err).toBe("chmod: changing permissions of '/etc/hostname': Operation not permitted\n");
    expect(run(s, "chmod 777").err).toContain("missing operand after");
    expect(octal(peek(s, "/etc/hostname")!)).toBe("644");
  });
  it("chown: a normal user cannot give a file away; regrouping into your own group is allowed", () => {
    const s = sh();
    expect(run(s, "chown alice notes.txt").err).toBe("chown: changing ownership of 'notes.txt': Operation not permitted\n");
    expect(run(s, "chown root:root notes.txt").err).toContain("Operation not permitted");
    expect(run(s, "chown :staff notes.txt").status).toBe(0); expect(out("ls -l notes.txt", s)).toContain("learner staff");
    expect(run(s, "chown :adm notes.txt").err).toContain("Operation not permitted");
    expect(run(s, "chown bob notes.txt").err).toBe("chown: invalid user: 'bob'\n");
    expect(run(s, "chown learner nothing").err).toContain("cannot access");
  });
});

describe("permission denied really happens", () => {
  it("reading", () => {
    const s = sh();
    expect(run(s, "cat /etc/shadow").err).toBe("cat: /etc/shadow: Permission denied\n");
    expect(run(s, "cat /etc/shadow").status).toBe(1);
    expect(run(s, "cat /home/alice/private.txt").err).toBe("cat: /home/alice/private.txt: Permission denied\n");
    expect(run(s, "ls /home/alice").err).toBe("ls: cannot open directory '/home/alice': Permission denied\n");
    expect(run(s, "cd /home/alice").err).toBe("bash: cd: /home/alice: Permission denied\n");
    expect(s.cwd).toBe("/home/learner");
    expect(run(s, "cat /var/log/auth.log").err).toContain("Permission denied");
    expect(run(s, "cat /var/log/syslog").err).toContain("Permission denied"); // root:adm 640, learner not in adm
    expect(run(s, "grep root /etc/shadow").err).toBe("grep: /etc/shadow: Permission denied\n");
    expect(run(s, "head /etc/shadow").err).toBe("head: cannot open '/etc/shadow' for reading: Permission denied\n");
    expect(run(s, "cp /etc/shadow here").err).toContain("Permission denied");
    expect(out("cat /etc/passwd", s)).toContain("learner:x:1000");
  });
  it("writing and creating", () => {
    const s = sh();
    expect(run(s, "touch /etc/x").err).toBe("touch: cannot touch '/etc/x': Permission denied\n");
    expect(run(s, "mkdir /etc/x").err).toBe("mkdir: cannot create directory '/etc/x': Permission denied\n");
    expect(run(s, "rm /etc/hostname").err).toBe("rm: cannot remove '/etc/hostname': Permission denied\n");
    expect(run(s, "mv /etc/hostname /tmp/h").err).toContain("Permission denied");
    expect(run(s, "cp notes.txt /etc/").err).toContain("Permission denied");
    expect(run(s, "echo x >> /var/log/dpkg.log").err).toBe("bash: /var/log/dpkg.log: Permission denied\n");
  });
  it("group permission: staff may write /srv/team/report.txt but not read alice's private file", () => {
    const s = sh();
    expect(run(s, "echo more >> /srv/team/report.txt").status).toBe(0);
    expect(out("cat /srv/team/report.txt", s)).toBe("Team report draft\nmore\n");
    expect(run(s, "cat /srv/team/alice-only.txt").err).toContain("Permission denied");
    expect(run(s, "touch /srv/team/new.txt").status).toBe(0); // group has w and x on the directory (775 staff)
  });
  it("your own bits can lock you out, and chmod gives access back", () => {
    const s = sh();
    run(s, "chmod 000 notes.txt");
    expect(run(s, "cat notes.txt").err).toBe("cat: notes.txt: Permission denied\n");
    run(s, "chmod u+r notes.txt"); expect(run(s, "cat notes.txt").status).toBe(0);
    run(s, "chmod -x data");
    expect(run(s, "cd data").err).toBe("bash: cd: data: Permission denied\n");
    expect(run(s, "cat data/sales.csv").err).toBe("cat: data/sales.csv: Permission denied\n"); // no x on the directory: cannot reach the file
    expect(run(s, "ls data").status).toBe(0); // r still lets you read the names
    run(s, "chmod u+x data"); expect(run(s, "cat data/sales.csv").status).toBe(0);
  });
  it("deleting needs write on the directory, not on the file", () => {
    const s = sh();
    run(s, "chmod a-w logs");
    expect(run(s, "rm logs/notes.txt").err).toBe("rm: cannot remove 'logs/notes.txt': Permission denied\n");
    expect(run(s, "touch logs/new").err).toContain("Permission denied");
    run(s, "chmod u+w logs"); run(s, "chmod a-w logs/notes.txt");
    expect(run(s, "rm logs/notes.txt").status).toBe(0); // file read-only, directory writable: the delete works
  });
  it("redirecting over a read-only file is denied", () => {
    const s = sh();
    run(s, "chmod a-w notes.txt");
    expect(run(s, "echo x > notes.txt").err).toBe("bash: notes.txt: Permission denied\n");
    expect(out("cat notes.txt", s)).toContain("Remember");
  });
  it("scripts need execute permission, `bash script` only read", () => {
    const s = sh();
    const r = run(s, "scripts/backup.sh");
    expect(r.err).toBe("bash: scripts/backup.sh: Permission denied\n"); expect(r.status).toBe(126);
    expect(run(s, "./nothing.sh").err).toBe("bash: ./nothing.sh: No such file or directory\n");
    const b = run(s, "bash scripts/backup.sh");
    expect(b.out).toBe("backup finished\n"); expect(peek(s, "/home/learner/backup/notes.txt")!.data).toBe(peek(s, "/home/learner/notes.txt")!.data);
    const s2 = sh(); run(s2, "chmod u+x scripts/backup.sh");
    expect(run(s2, "./scripts/backup.sh").out).toBe("backup finished\n");
    expect(peek(s2, "/home/learner/backup/notes.txt")).not.toBeNull();
    expect(run(s2, "scripts/backup.sh").status).toBe(0);
  });
  it("sudo is never granted", () => {
    const s = sh();
    expect(run(s, "sudo cat /etc/shadow").err).toContain("not available");
    expect(run(s, "whoami").out).toBe("learner\n");
    expect(run(s, "id").out).toMatch(/^uid=1000\(learner\) gid=1000\(learner\) groups=.*\(staff\)/);
  });
});

describe("processes", () => {
  it("ps, ps aux and top read the fixture", () => {
    const s = sh();
    expect(out("ps aux", s)).toContain("stuck_job --no-signal-handlers");
    expect(out("ps aux | grep -c learner", s)).toBe("5\n"); // 777, 801, 802, 903 + the ps process itself
    expect(out("ps", s)).toMatch(/^\s+PID TTY\s+TIME CMD\n\s+777 pts\/0\s+00:00:00 bash\n\s+\d+ pts\/0\s+00:00:00 ps\n$/);
    expect(out("ps -ef", s)).toContain("PPID");
    const top = out("top -b -n 1", s);
    expect(top).toContain("fixture values, not measured");
    expect(lines(top).find((l) => /stuck_job/.test(l))).toBeTruthy();
    const body = lines(top).filter((l) => /^\s+\d+ /.test(l));
    expect(body[0]).toContain("stuck_job"); // sorted by CPU
    expect(run(s, "ps -x -y").err).toContain("only plain");
  });
  it("kill: TERM works on a cooperative process, is ignored by one that traps it, KILL always works", () => {
    const s = sh();
    expect(run(s, "kill 801").status).toBe(0);
    expect(s.procs.some((p) => p.pid === 801)).toBe(false);
    expect(run(s, "kill 802").text).toBe(""); expect(s.procs.some((p) => p.pid === 802)).toBe(true);
    expect(run(s, "kill -TERM 802").status).toBe(0); expect(s.procs.some((p) => p.pid === 802)).toBe(true);
    expect(run(s, "kill -15 802").status).toBe(0); expect(s.procs.some((p) => p.pid === 802)).toBe(true);
    expect(run(s, "kill -9 802").status).toBe(0); expect(s.procs.some((p) => p.pid === 802)).toBe(false);
    expect(out("ps aux | grep stuck", s)).toBe("");
  });
  it("kill errors", () => {
    const s = sh();
    expect(run(s, "kill 99999").err).toBe("bash: kill: (99999) - No such process\n");
    expect(run(s, "kill 1").err).toBe("bash: kill: (1) - Operation not permitted\n");
    expect(run(s, "kill 512").err).toBe("bash: kill: (512) - Operation not permitted\n");
    expect(run(s, "kill abc").err).toContain("arguments must be process or job IDs");
    expect(run(s, "kill -BOGUS 801").err).toContain("invalid signal specification");
    expect(run(s, "kill").err).toContain("usage");
    expect(run(s, "kill -9 777").err).toContain("will not close it");
    expect(s.procs.some((p) => p.pid === 1 || p.pid === 512 || p.pid === 777)).toBe(true);
  });
  it("the fixture is per session", () => {
    const a = sh(), b = sh();
    run(a, "kill -9 802"); expect(b.procs.some((p) => p.pid === 802)).toBe(true);
  });
});

describe("shell errors, help and history", () => {
  it("command not found and friends", () => {
    const s = sh();
    const r = run(s, "foo bar");
    expect(r.err).toBe("bash: foo: command not found\n"); expect(r.status).toBe(127);
    expect(run(s, "ls nothing").err).toBe("ls: cannot access 'nothing': No such file or directory\n");
    expect(run(s, "ls nothing").status).toBe(2);
    expect(run(s, "cat nothing").err).toBe("cat: nothing: No such file or directory\n");
    expect(run(s, "cat docs").err).toBe("cat: docs: Is a directory\n");
    expect(run(s, "cd nothing").err).toBe("bash: cd: nothing: No such file or directory\n");
    expect(run(s, "cd notes.txt").err).toBe("bash: cd: notes.txt: Not a directory\n");
    expect(run(s, "grep x nothing").err).toBe("grep: nothing: No such file or directory\n");
    expect(run(s, "grep x nothing").status).toBe(2);
    expect(run(s, "wc nothing").err).toBe("wc: nothing: No such file or directory\n");
    expect(run(s, "head nothing").err).toContain("cannot open 'nothing' for reading");
    expect(run(s, "ls -z").err).toContain("invalid option -- 'z'");
    expect(run(s, "ls -z").err).toContain("not implemented here");
    expect(run(s, "ls --color").err).toContain("unrecognized option '--color'");
    expect(run(s, "constructor").err).toBe("bash: constructor: command not found\n");
    expect(run(s, "__proto__").err).toContain("command not found");
    expect(run(s, "./docs").err).toContain("Is a directory");
  });
  it("test and [ set exit codes", () => {
    const s = sh();
    expect(out("[ -f notes.txt ] && echo file", s)).toBe("file\n");
    expect(out("[ -d notes.txt ] || echo notdir", s)).toBe("notdir\n");
    expect(out("test -r /etc/shadow || echo unreadable", s)).toBe("unreadable\n");
    expect(out("test -w /etc/hostname || echo readonly", s)).toBe("readonly\n");
    expect(out("[ -e nothing ] || echo missing", s)).toBe("missing\n");
    expect(out("[ a = a ] && echo same", s)).toBe("same\n");
  });
  it("help and man exist for every command the task lists, with options", () => {
    const s = sh();
    for (const c of "pwd ls cd cat head tail wc grep sort uniq cut tr echo touch mkdir cp mv rm find chmod chown ps top kill history".split(" ")) {
      expect(COMMAND_NAMES, c).toContain(c);
      expect(MAN[c], c).toBeTruthy();
      expect(out(`man ${c}`, s), c).toContain("SYNOPSIS");
      expect(out(`help ${c}`, s), c).toContain(MAN[c].synopsis);
      expect(out(`${c} --help`, s), c).toContain("DESCRIPTION");
    }
    expect(out("man ls", s)).toContain("-l         long format");
    expect(out("help", s)).toContain("Simulated shell");
    expect(run(s, "man nothing").err).toBe("No manual entry for nothing\n");
    expect(run(s, "man").err).toContain("What manual page");
    for (const c of COMMAND_NAMES.filter((n) => !["[", "clear", "export", "true", "false", "env", "printenv", "whoami", "id", "sudo", "exit"].includes(n))) expect(MAN[c], c).toBeTruthy();
  });
  it("history numbers the commands you ran and ignores blank lines", () => {
    const s = sh();
    run(s, "pwd"); run(s, ""); run(s, "ls");
    expect(out("history", s)).toBe("    1  pwd\n    2  ls\n    3  history\n");
    expect(s.history).toEqual(["pwd", "ls", "history"]);
  });
  it("clear is flagged for the UI", () => { expect(execLine(sh(), "clear").cleared).toBe(true); });
});

describe("challenges have working validators", () => {
  function attempt(id: string, cmds: string[]) {
    const s = sh(), t: Transcript = { lastLine: "", lastOut: "", lines: [], outs: [] };
    for (const c of cmds) { const r = run(s, c); t.lines.push(c); t.outs.push(r.text); t.lastLine = c; t.lastOut = r.text; }
    return CHALLENGES.find((x) => x.id === id)!.check(s, t);
  }
  it("each challenge fails before the goal is met", () => {
    for (const c of CHALLENGES) expect(attempt(c.id, ["pwd"]).ok, c.id).toBe(false);
  });
  it("largest-logs accepts both documented approaches and rejects a wrong list", () => {
    expect(attempt("largest-logs", ["ls -lS logs/*.log | head -3"]).ok).toBe(true);
    expect(attempt("largest-logs", ["wc -c logs/*.log | sort -n | tail -4"]).ok).toBe(true);
    expect(attempt("largest-logs", ["ls -lS logs/*.log"]).ok).toBe(false); // all four files
    expect(attempt("largest-logs", ["ls -lS logs/*.log | head -2"]).ok).toBe(false);
    expect(attempt("largest-logs", ["ls -lS logs"]).ok).toBe(false); // the old/ directory sorts first (4096 bytes)
  });
  it("count-errors, top-ips, run-backup, private-copy, stop-stuck, explain-denied", () => {
    expect(attempt("count-errors", ["grep -c ERROR logs/app.log"]).ok).toBe(true);
    expect(attempt("count-errors", ["grep ERROR logs/app.log | wc -l"]).ok).toBe(true);
    expect(attempt("count-errors", ["grep -c INFO logs/app.log"]).ok).toBe(false);
    expect(attempt("top-ips", ["cut -d' ' -f1 logs/access.log | sort | uniq -c | sort -nr | head -3"]).ok).toBe(true);
    expect(attempt("top-ips", ["cut -d' ' -f1 logs/access.log | sort | uniq -c | sort -nr | head -2"]).ok).toBe(false);
    expect(attempt("run-backup", ["chmod u+x scripts/backup.sh"]).ok).toBe(false);
    expect(attempt("run-backup", ["chmod u+x scripts/backup.sh", "scripts/backup.sh"]).ok).toBe(true);
    expect(attempt("run-backup", ["bash scripts/backup.sh"]).ok).toBe(false); // ran, but never made it executable
    expect(attempt("private-copy", ["mkdir vault", "chmod 700 vault", "cp secret.txt vault/"]).ok).toBe(true);
    expect(attempt("private-copy", ["mkdir vault", "cp secret.txt vault/"]).ok).toBe(false);
    expect(attempt("stop-stuck", ["kill 802"]).ok).toBe(false);
    expect(attempt("stop-stuck", ["kill 802", "kill -9 802"]).ok).toBe(true);
    expect(attempt("stop-stuck", ["kill -9 802", "kill 801"]).ok).toBe(false);
    expect(attempt("explain-denied", ["cat /etc/shadow"]).ok).toBe(false);
    expect(attempt("explain-denied", ["cat /etc/shadow", "ls -l /etc/shadow"]).ok).toBe(true);
  });
  it("presets reference real challenges and their suggested commands run without a simulator error", () => {
    for (const p of PRESETS) {
      if (p.challenge) expect(CHALLENGES.some((c) => c.id === p.challenge), p.id).toBe(true);
      const s = sh();
      for (const cmd of p.try) { const r = run(s, cmd); expect(r.err, `${p.id}: ${cmd}`).not.toMatch(/not supported|not implemented|command not found|syntax error|internal simulator/); }
    }
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
  });
});

describe("safety: nothing outside the virtual file system is reachable", () => {
  it("the engine source imports nothing that could reach the real system", () => {
    const src = readFileSync(new URL("../site/lib/visual/linux.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'](node:)?(fs|child_process|os|path|net|http|https|worker_threads|vm)["']/);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).not.toMatch(/\b(eval|Function)\s*\(/);
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|document\.|window\.|process\.(env|exit|cwd)/);
  });
  it("/etc/passwd is the fixture, not the host's", () => {
    const t = out("cat /etc/passwd");
    expect(t).toContain("learner:x:1000:1000:Learner");
    expect(lines(t)).toHaveLength(4);
  });
  it("../ cannot climb above the virtual root", () => {
    const s = sh();
    expect(out("cat ../../../../../../../../etc/hostname", s)).toBe("dataforge-lab\n");
    run(s, "cd /"); run(s, "cd ../../.."); expect(s.cwd).toBe("/");
    expect(out("ls /..", s)).toBe(out("ls /", s));
  });
  it("odd names cannot poison the tree", () => {
    const s = sh();
    run(s, "mkdir __proto__ constructor toString"); run(s, "touch hasOwnProperty");
    expect(out("ls", s)).toContain("__proto__"); expect(out("ls", s)).toContain("hasOwnProperty");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(run(s, "cd __proto__").status).toBe(0);
    expect(run(s, "echo x > a/../../..").status).not.toBe(0);
  });
  it("sessions are isolated and clones are deep", () => {
    const a = sh(), b = cloneSession(a);
    run(b, "rm -rf logs"); run(b, "echo x > new"); run(b, "cd /tmp");
    expect(peek(a, "/home/learner/logs")).not.toBeNull(); expect(peek(a, "/home/learner/new")).toBeNull(); expect(a.cwd).toBe("/home/learner");
    expect(a.history).toEqual([]);
  });
  it("limits stop runaway input: long lines, huge files, many commands, deep scripts", () => {
    const s = sh();
    expect(run(s, "echo " + "a".repeat(LIMITS.line + 10)).err).toContain("command line too long");
    expect(run(s, "grep " + "(".repeat(400) + " notes.txt").status).toBe(2);
    run(s, "echo " + "x".repeat(900) + " > big");
    for (let i = 0; i < 8; i++) run(s, "cat big big big big big big big big big big big big > big2; cp big2 big");
    expect(peek(s, "/home/learner/big")!.data.length).toBeLessThanOrEqual(LIMITS.fileBytes);
    // a script that runs itself is cut off
    run(s, "echo 'bash loop.sh' > loop.sh");
    const r = run(s, "bash loop.sh");
    expect(r.err).toContain("nested too deeply");
  });
  it("the unsupported list is honest and non-empty", () => {
    expect(UNSUPPORTED.length).toBeGreaterThan(5);
    expect(UNSUPPORTED.join(" ")).toMatch(/Command substitution/); expect(UNSUPPORTED.join(" ")).toMatch(/awk, sed, xargs/);
  });
});
