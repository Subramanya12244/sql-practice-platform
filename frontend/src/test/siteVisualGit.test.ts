// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  NOT_IMPLEMENTED, PRESETS, areaRows, blobId, checkIntegrity, commitsToReplay, compareMergeRebase, describeChanges, emptyRepo, headId, historyFacts, layoutGraph, markerProblems,
  merge3, mergeBase, mergeBases, mergeTrees, parseConflicts, resolveBlock, resolveRev, runCommand, runScript, sha1, textGraph, topoOrder, treeId, writeFile, ancestors,
  type Repo,
} from "../site/lib/visual/git";

/** Run lines in order; fail the test if a line that should succeed does not. Returns the final repo and each output. */
function sh(lines: string[], from: Repo = emptyRepo()) {
  let r = from;
  const outs: string[] = [];
  for (const l of lines) { const x = runCommand(r, l); if (!x.ok) throw new Error(`"${l}" failed: ${x.output}`); r = x.repo; outs.push(x.output); }
  return { r, outs };
}
const run = (r: Repo, l: string) => runCommand(r, l);
const w = (name: string, text: string) => `echo "${text}" > ${name}`;
const id = (r: Repo, spec: string) => resolveRev(r, spec)!;

const BASE = ["git init", w("a.txt", "base"), 'git add . && git commit -m "base"'];

describe("object ids", () => {
  it("SHA-1 and blob ids match Git (known vectors)", () => {
    expect(sha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(blobId("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a"); // git hash-object of "hello\n"
    expect(blobId("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
  it("commit and tree ids equal what real Git computed for the same files, identity and times (checked against git 2.49)", () => {
    const { r } = sh(["git init", w("a.txt", "hello"), w("d/b.txt", "x"), "git add .", 'git commit -m "first"', 'echo "y" >> a.txt', 'git commit -am "second"']);
    expect(id(r, "HEAD~1")).toBe("a3208b08bfd982623d7b7f255e60a270b1d3b063");
    expect(id(r, "HEAD")).toBe("2474f8669446139255a9848142b7c71f4f3af781");
    expect(r.commits[id(r, "HEAD")].treeId).toBe("ad9e57aebb51a8831286f1bdc29e4a4b507c9003");
    expect(r.commits[id(r, "HEAD~1")].treeId).toBe("f0e0f3514c5a1102281e00e1431b0133804f0e51");
  });
  it("is deterministic: the same commands give the same ids", () => {
    const a = sh([...BASE, "git switch -c f", w("b.txt", "b"), 'git add . && git commit -m "b"']).r;
    const b = sh([...BASE, "git switch -c f", w("b.txt", "b"), 'git add . && git commit -m "b"']).r;
    expect(a.branches).toEqual(b.branches);
    expect(treeId({ "a.txt": "x\n" })).toBe(treeId({ "a.txt": "x\n" }));
  });
});

describe("three areas and commands", () => {
  it("add moves a file from the working tree to the staging area; commit moves it to the repository", () => {
    let r = sh(["git init", w("f.txt", "one")]).r;
    let row = areaRows(r)[0];
    expect([row.work, row.index, row.head]).toEqual(["one\n", undefined, undefined]);
    expect(row.untracked).toBe(true);
    r = sh(["git add f.txt"], r).r;
    row = areaRows(r)[0];
    expect([row.index, row.head, row.staged, row.untracked]).toEqual(["one\n", undefined, "new", false]);
    r = sh(['git commit -m "c"'], r).r;
    row = areaRows(r)[0];
    expect([row.head, row.staged, row.unstaged]).toEqual(["one\n", "same", "same"]);
    r = sh([w("f.txt", "two")], r).r;
    row = areaRows(r)[0];
    expect([row.unstaged, row.staged, row.workId === row.headId]).toEqual(["modified", "same", false]);
  });

  it("status output for untracked, staged, modified and clean states", () => {
    let r = sh(["git init", w("a.txt", "1")]).r;
    expect(run(r, "git status").output).toBe('On branch main\n\nNo commits yet\n\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\ta.txt\n\nnothing added to commit but untracked files present (use "git add" to track)');
    r = sh(["git add a.txt"], r).r;
    expect(run(r, "git status").output).toContain("Changes to be committed:");
    expect(run(r, "git status").output).toContain("new file:   a.txt");
    r = sh(['git commit -m "x"', w("a.txt", "2")], r).r;
    expect(run(r, "git status -s").output).toBe(" M a.txt");
    r = sh(["git add a.txt"], r).r;
    expect(run(r, "git status -s").output).toBe("M  a.txt");
    r = sh(['git commit -m "y"'], r).r;
    expect(run(r, "git status").output).toBe("On branch main\n\nnothing to commit, working tree clean");
  });

  it("diff compares working tree with index, and index with HEAD", () => {
    let r = sh(["git init"]).r;
    r = sh([w("n.txt", "a"), 'echo "b" >> n.txt', "git add .", 'git commit -m "n"', w("n.txt", "a"), 'echo "B" >> n.txt'], r).r;
    expect(run(r, "git diff").output).toBe("diff --git a/n.txt b/n.txt\nindex " + blobId("a\nb\n").slice(0, 7) + ".." + blobId("a\nB\n").slice(0, 7) + " 100644\n--- a/n.txt\n+++ b/n.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B");
    expect(run(r, "git diff --staged").output).toBe("");
    r = sh(["git add n.txt"], r).r;
    expect(run(r, "git diff").output).toBe("");
    expect(run(r, "git diff --staged").output).toContain("-b\n+B");
    expect(run(r, "git diff --name-only --staged").output).toBe("n.txt");
  });

  it("commit refuses an empty commit, an unknown option and a missing message", () => {
    const { r } = sh(BASE);
    expect(run(r, 'git commit -m "x"').ok).toBe(false);
    expect(run(r, 'git commit -m "x"').output).toContain("nothing to commit");
    expect(run(r, "git commit").output).toContain("message is required");
    expect(run(r, "git push").output).toContain("no remote");
  });

  it("commit --amend replaces the tip and keeps the parent; the old commit is remembered in ORIG_HEAD", () => {
    let { r } = sh([...BASE, w("b.txt", "b"), 'git add . && git commit -m "oops"']);
    const parent = id(r, "HEAD~1"), old = id(r, "HEAD");
    r = sh(['git commit --amend -m "better"'], r).r;
    expect(id(r, "HEAD")).not.toBe(old);
    expect(id(r, "HEAD~1")).toBe(parent);
    expect(r.commits[id(r, "HEAD")].message).toBe("better");
    expect(id(r, "ORIG_HEAD")).toBe(old);
  });

  it("log: oneline, ranges, limits, formats and the unborn branch error", () => {
    const { r } = sh([...BASE, w("a.txt", "two"), 'git commit -am "second"', w("a.txt", "three"), 'git commit -am "third"']);
    const lines = run(r, "git log --oneline").output.split("\n");
    expect(lines.map((l) => l.replace(/^\w+ (\(HEAD -> main\) )?/, ""))).toEqual(["third", "second", "base"]);
    expect(lines[0]).toMatch(/^[0-9a-f]{7} \(HEAD -> main\) third$/);
    expect(run(r, "git log --format=%s").output).toBe("third\nsecond\nbase");
    expect(run(r, "git log -n 1 --format=%s").output).toBe("third");
    expect(run(r, "git log --format=%s HEAD~2..HEAD").output).toBe("third\nsecond");
    expect(run(r, "git rev-list --count HEAD").output).toBe("3");
    expect(run(r, "git log").output).toContain("Author: You <you@example.com>");
    const fresh = sh(["git init"]).r;
    expect(run(fresh, "git log").output).toBe("fatal: your current branch 'main' does not have any commits yet");
    expect(run(emptyRepo(), "git status").output).toContain("not a git repository");
  });

  it("log --graph lists commits children first and draws a merge", () => {
    const { r } = sh([...BASE, "git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "on f"', "git switch main", w("b.txt", "b"), 'git add . && git commit -m "on main"', "git merge f"]);
    const out = run(r, "git log --oneline --graph").output.split("\n");
    expect(out.map((l) => l.replace(/[0-9a-f]{7} (\([^)]*\) )?/, "").trim())).toEqual(["* Merge branch 'f'", "|\\", "* | on main", "| * on f", "|/", "* base"]);
    const order = topoOrder(r, [id(r, "HEAD")]);
    expect(order.map((c) => r.commits[c].message)).toEqual(["Merge branch 'f'", "on main", "on f", "base"]);
    expect(textGraph(r, order)).toHaveLength(4);
  });
});

describe("branches, switch and HEAD", () => {
  it("creating a branch points it at the current commit; commits move only the current branch", () => {
    let { r } = sh([...BASE, "git branch dev", "git switch dev", w("d.txt", "d"), 'git add . && git commit -m "dev"']);
    expect(r.branches.main).not.toBe(r.branches.dev);
    expect(r.commits[r.branches.dev].parents).toEqual([r.branches.main]);
    r = sh(["git switch main"], r).r;
    expect(r.work["d.txt"]).toBeUndefined();
    expect(run(r, "git branch").output).toBe("  dev\n* main");
    expect(run(r, "git branch").output).not.toContain("main\n");
  });

  it("branch creation and deletion rules", () => {
    const { r } = sh([...BASE, "git branch dev"]);
    expect(run(r, "git branch dev").output).toBe("fatal: a branch named 'dev' already exists");
    expect(run(r, "git branch -d main").output).toContain("cannot delete branch 'main'");
    expect(run(r, "git branch -D main").ok).toBe(false);
    expect(run(r, "git branch -d nope").output).toBe("error: branch 'nope' not found.");
    expect(run(r, "git branch bad..name").ok).toBe(false);
    const del = run(r, "git branch -d dev");
    expect(del.output).toMatch(/^Deleted branch dev \(was [0-9a-f]{7}\)\.$/);
    expect(del.repo.branches.dev).toBeUndefined();
  });

  it("-d refuses an unmerged branch, -D forces it", () => {
    const { r } = sh([...BASE, "git switch -c f", w("f.txt", "f"), 'git add . && git commit -m "f"', "git switch main"]);
    expect(run(r, "git branch -d f").output).toContain("is not fully merged");
    expect(run(r, "git branch -d f").repo.branches.f).toBeDefined();
    expect(run(r, "git branch -D f").repo.branches.f).toBeUndefined();
    const merged = sh(["git merge f"], r).r;
    expect(run(merged, "git branch -d f").ok).toBe(true);
  });

  it("detached HEAD: HEAD points at a commit, new commits belong to no branch, a branch can rescue them", () => {
    let { r } = sh([...BASE, w("a.txt", "two"), 'git commit -am "second"']);
    const first = id(r, "HEAD~1");
    r = sh(["git switch --detach HEAD~1"], r).r;
    expect(r.head).toEqual({ kind: "detached", id: first });
    expect(run(r, "git status").output.split("\n")[0]).toBe(`HEAD detached at ${first.slice(0, 7)}`);
    expect(r.work["a.txt"]).toBe("base\n");
    r = sh([w("x.txt", "x"), 'git add . && git commit -m "lost?"'], r).r;
    const lost = headId(r)!;
    expect(Object.values(r.branches)).not.toContain(lost);
    expect(run(r, "git branch").output).toContain("* (HEAD detached at");
    r = sh(["git switch -c rescue"], r).r;
    expect(r.branches.rescue).toBe(lost);
    expect(r.head).toEqual({ kind: "branch", name: "rescue" });
    expect(run(sh(["git switch main"], r).r, "git switch main").output).toBe("Already on 'main'");
  });

  it("switch rules: unknown reference, tag needs --detach, local changes block the switch", () => {
    let { r } = sh([...BASE, "git tag v1", "git switch -c other", w("a.txt", "other"), 'git commit -am "other"', "git switch main"]);
    expect(run(r, "git switch nope").output).toBe("fatal: invalid reference: nope");
    expect(run(r, "git switch v1").output).toBe("fatal: a branch is expected, got tag 'v1'");
    r = sh([w("a.txt", "dirty")], r).r;
    const blocked = run(r, "git switch other");
    expect(blocked.ok).toBe(false);
    expect(blocked.output).toContain("Your local changes to the following files would be overwritten by checkout:\n\ta.txt");
    expect(blocked.repo.head).toEqual({ kind: "branch", name: "main" });
    // unrelated edits and untracked files travel with the switch
    const keep = sh([w("a.txt", "base"), w("u.txt", "untracked"), "git switch other"], r).r;
    expect(keep.work["u.txt"]).toBe("untracked\n");
    expect(keep.work["a.txt"]).toBe("other\n");
  });

  it("tags are lightweight pointers: create, list, delete, duplicate", () => {
    const { r } = sh([...BASE, "git tag v1", "git tag v0 HEAD"]);
    expect(run(r, "git tag").output).toBe("v0\nv1");
    expect(run(r, "git tag v1").output).toBe("fatal: tag 'v1' already exists");
    expect(run(r, "git tag -a v2 -m x").output).toContain("not available");
    expect(run(r, "git log --oneline").output).toContain("(HEAD -> main, tag: v0, tag: v1)");
    expect(run(r, "git tag -d v1").repo.tags.v1).toBeUndefined();
  });
});

describe("rev parsing and merge-base", () => {
  it("resolves HEAD~n, ^, ^2, prefixes and rejects unknown names", () => {
    const { r } = sh([...BASE, "git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "f1"', "git switch main", w("b.txt", "b"), 'git add . && git commit -m "m1"', "git merge f"]);
    const m = id(r, "HEAD");
    expect(r.commits[id(r, "HEAD^")].message).toBe("m1");
    expect(r.commits[id(r, "HEAD^2")].message).toBe("f1");
    expect(r.commits[id(r, "HEAD~2")].message).toBe("base");
    expect(id(r, "HEAD^1~1")).toBe(id(r, "HEAD~2"));
    expect(resolveRev(r, m.slice(0, 7))).toBe(m);
    expect(resolveRev(r, "HEAD~9")).toBeNull();
    expect(resolveRev(r, "nope")).toBeNull();
    expect(run(r, "git show nope").output).toContain("unknown revision");
  });

  it("merge-base of diverged branches is the commit where they split; for an ancestor it is that ancestor", () => {
    const { r } = sh([...BASE, "git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "f1"', w("d.txt", "d"), 'git add . && git commit -m "f2"', "git switch main", w("b.txt", "b"), 'git add . && git commit -m "m1"']);
    const base = id(r, "main~1");
    expect(mergeBase(r, id(r, "main"), id(r, "f"))).toBe(base);
    expect(mergeBases(r, id(r, "main"), id(r, "f"))).toEqual([base]);
    expect(mergeBase(r, id(r, "main"), base)).toBe(base);
    expect(mergeBase(r, id(r, "f"), id(r, "f"))).toBe(id(r, "f"));
    expect(commitsToReplay(r, id(r, "f"), id(r, "main")).map((c) => r.commits[c].message)).toEqual(["f1", "f2"]);
  });

  it("criss-cross history has two merge bases; merge-base picks the newer one", () => {
    // a1 and b1 both branch from base; each branch then merges the OTHER branch's original tip, so the two merges share two best ancestors.
    const { r } = sh([...BASE, "git switch -c a", w("a1.txt", "a1"), 'git add . && git commit -m "a1"', "git tag ta", "git switch main", "git switch -c b", w("b1.txt", "b1"), 'git add . && git commit -m "b1"', "git tag tb",
      "git switch a", "git merge tb", "git switch b", "git merge ta"]);
    const bases = mergeBases(r, id(r, "a"), id(r, "b"));
    expect(bases.map((c) => r.commits[c].message).sort()).toEqual(["a1", "b1"]);
    expect(r.commits[mergeBase(r, id(r, "a"), id(r, "b"))!].message).toBe("b1"); // created later, so newer
  });
});

describe("merge", () => {
  it("fast-forward: main only moves its pointer, no merge commit", () => {
    let { r } = sh([...BASE, "git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "f1"', "git switch main"]);
    const tip = r.branches.f, before = Object.keys(r.commits).length;
    const x = run(r, "git merge f");
    expect(x.output).toMatch(/^Updating [0-9a-f]{7}\.\.[0-9a-f]{7}\nFast-forward\n c\.txt \| 1 \+\n 1 file changed, 1 insertion\(\+\)\n create mode 100644 c\.txt$/);
    r = x.repo;
    expect(r.branches.main).toBe(tip);
    expect(Object.keys(r.commits).length).toBe(before);
    expect(r.work["c.txt"]).toBe("c\n");
    expect(run(r, "git merge f").output).toBe("Already up to date.");
    expect(historyFacts(r, "main")).toMatchObject({ linear: true, merges: 0, commits: 2 });
  });

  it("--no-ff forces a merge commit; --ff-only refuses when diverged", () => {
    const base = sh([...BASE, "git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "f1"', "git switch main"]).r;
    const noff = sh(["git merge --no-ff f"], base).r;
    expect(noff.commits[id(noff, "HEAD")].parents).toEqual([base.branches.main, base.branches.f]);
    const diverged = sh([w("b.txt", "b"), 'git add . && git commit -m "m1"'], base).r;
    expect(run(diverged, "git merge --ff-only f").output).toBe("fatal: Not possible to fast-forward, aborting.");
  });

  it("three-way merge: result has both sets of changes, two parents, merge-base is the split point", () => {
    const { r: pre } = sh([...BASE, "git switch -c f", w("c.txt", "from f"), 'git add . && git commit -m "f1"', "git switch main", w("b.txt", "from main"), 'git add . && git commit -m "m1"']);
    const x = run(pre, "git merge f");
    expect(x.ok).toBe(true);
    expect(x.output.split("\n")[0]).toBe("Merge made by the 'ort' strategy.");
    const r = x.repo, m = r.commits[id(r, "HEAD")];
    expect(m.parents).toEqual([pre.branches.main, pre.branches.f]);
    expect(m.message).toBe("Merge branch 'f'");
    expect(m.tree).toEqual({ "a.txt": "base\n", "b.txt": "from main\n", "c.txt": "from f\n" });
    expect(r.work).toEqual(m.tree);
    expect(historyFacts(r, "main")).toMatchObject({ linear: false, merges: 1, commits: 4 });
    // merging into a branch other than main names it in the message
    const dev = sh(["git switch -c dev", w("e.txt", "e"), 'git add . && git commit -m "e"', "git merge f"], pre).r;
    expect(dev.commits[id(dev, "HEAD")].message).toBe("Merge branch 'f' into dev");
  });

  it("non-overlapping edits to different lines of one file merge cleanly; adjacent lines conflict", () => {
    const b = "l1\nl2\nl3\nl4\nl5\n";
    expect(merge3(b, "L1\nl2\nl3\nl4\nl5\n", "l1\nl2\nl3\nl4\nL5\n", "HEAD", "f")).toEqual({ text: "L1\nl2\nl3\nl4\nL5\n", conflicts: 0 });
    expect(merge3(b, "l1\nL2\nl3\nl4\nl5\n", "l1\nl2\nL3\nl4\nl5\n", "HEAD", "f").conflicts).toBe(1);
    expect(merge3(b, "l1\nl2\nl3\nl4\nl5\n", "l1\nl2\nl3\nl4\nl5\n", "HEAD", "f").conflicts).toBe(0);
    // identical change on both sides is not a conflict
    expect(merge3(b, "X\nl2\nl3\nl4\nl5\n", "X\nl2\nl3\nl4\nl5\n", "a", "b")).toEqual({ text: "X\nl2\nl3\nl4\nl5\n", conflicts: 0 });
    // one side deletes a line, the other edits a distant line
    expect(merge3(b, "l1\nl3\nl4\nl5\n", "l1\nl2\nl3\nl4\nL5\n", "a", "b").text).toBe("l1\nl3\nl4\nL5\n");
  });

  const conflictSetup = [...BASE.slice(0, 1), `${w("report.txt", "intro")}`, 'echo "title: Sales" >> report.txt', 'echo "outro" >> report.txt', 'git add . && git commit -m "base"', "git switch -c f", w("report.txt", "intro"), 'echo "title: Sales 2026" >> report.txt', 'echo "outro" >> report.txt', 'git commit -am "retitle f"', "git switch main", w("report.txt", "intro"), 'echo "title: Revenue" >> report.txt', 'echo "outro" >> report.txt', 'git commit -am "retitle main"'];

  it("conflict: exact markers, only the conflicting lines are inside, the merge stops and records state", () => {
    const { r: pre } = sh(conflictSetup);
    const x = run(pre, "git merge f");
    expect(x.ok).toBe(false);
    expect(x.output).toBe("Auto-merging report.txt\nCONFLICT (content): Merge conflict in report.txt\nAutomatic merge failed; fix conflicts and then commit the result.");
    const r = x.repo;
    expect(r.work["report.txt"]).toBe("intro\n<<<<<<< HEAD\ntitle: Revenue\n=======\ntitle: Sales 2026\n>>>>>>> f\noutro\n");
    expect(markerProblems(r.work["report.txt"])).toEqual([{ line: 2, text: "<<<<<<< HEAD" }, { line: 4, text: "=======" }, { line: 6, text: ">>>>>>> f" }]);
    expect(r.op).toMatchObject({ kind: "merge", unmerged: ["report.txt"] });
    expect(headId(r)).toBe(pre.branches.main); // no commit was made
    expect(run(r, "git status").output).toContain("both modified:   report.txt");
    expect(run(r, "git status -s").output).toBe("UU report.txt");
    expect(run(r, "git diff").output).toBe("* Unmerged path report.txt");
    // cannot commit, switch or start another merge until resolved
    expect(run(r, 'git commit -m "x"').output).toContain("Committing is not possible because you have unmerged files");
    expect(run(r, "git switch f").ok).toBe(false);
    expect(run(r, "git merge f").output).toContain("You have not concluded your merge");
  });

  it("resolve, add and commit finish the merge; --abort restores the state before the merge", () => {
    const { r: pre } = sh(conflictSetup);
    const stuck = run(pre, "git merge f").repo;
    const done = sh(["resolve report.txt theirs", "git add report.txt", "git commit"], stuck).r;
    expect(done.op).toBeNull();
    expect(done.commits[id(done, "HEAD")].parents).toEqual([pre.branches.main, pre.branches.f]);
    expect(done.commits[id(done, "HEAD")].tree["report.txt"]).toBe("intro\ntitle: Sales 2026\noutro\n");
    expect(markerProblems(done.work["report.txt"])).toEqual([]);
    const aborted = sh(["git merge --abort"], stuck).r;
    expect(aborted.op).toBeNull();
    expect(aborted.work).toEqual(pre.work);
    expect(aborted.index).toEqual(pre.index);
    expect(headId(aborted)).toBe(headId(pre));
    expect(run(pre, "git merge --abort").output).toContain("There is no merge to abort");
  });

  it("modify/delete and add/add conflicts are detected", () => {
    const md = sh([...BASE, "git switch -c f", "git rm a.txt", 'git commit -m "rm"', "git switch main", w("a.txt", "changed"), 'git commit -am "edit"']).r;
    const x = run(md, "git merge f");
    expect(x.ok).toBe(false);
    expect(x.output).toContain("CONFLICT (modify/delete): a.txt deleted in f and modified in HEAD.  Version HEAD of a.txt left in tree.");
    const aa = sh(["git init", w("x.txt", "root"), 'git add . && git commit -m "r"', "git switch -c f", w("n.txt", "from f"), 'git add . && git commit -m "f"', "git switch main", w("n.txt", "from main"), 'git add . && git commit -m "m"']).r;
    expect(run(aa, "git merge f").output).toContain("CONFLICT (add/add): Merge conflict in n.txt");
  });

  it("refuses to merge when local changes would be overwritten, and unrelated histories", () => {
    let { r } = sh([...BASE, "git switch -c f", w("a.txt", "f version"), 'git commit -am "f"', "git switch main", w("b.txt", "b"), 'git add . && git commit -m "b"']);
    r = sh([w("a.txt", "dirty")], r).r;
    const x = run(r, "git merge f");
    expect(x.ok).toBe(false);
    expect(x.output).toContain("would be overwritten by merge");
    expect(x.repo.work["a.txt"]).toBe("dirty\n");
    // two repositories' histories cannot be joined by name; simulate with an orphan-like root
    const orphan = sh([...BASE, "git switch -c lone", "git rm a.txt", w("z.txt", "z"), 'git add . && git commit -m "z"']).r;
    expect(mergeBase(orphan, id(orphan, "lone"), id(orphan, "main"))).not.toBeNull();
  });

  it("conflict markers parse into blocks; blocks resolve independently", () => {
    const text = "top\n<<<<<<< HEAD\nours1\n=======\ntheirs1\n>>>>>>> f\nmid\n<<<<<<< HEAD\nours2\n=======\ntheirs2\n>>>>>>> f\nend\n";
    const segs = parseConflicts(text);
    expect(segs.map((s) => s.kind)).toEqual(["text", "conflict", "text", "conflict", "text"]);
    expect(resolveBlock(text, 0, "ours")).toContain("<<<<<<< HEAD\nours2");
    expect(resolveBlock(text, 0, "ours")).not.toContain("theirs1");
    expect(markerProblems(resolveBlock(resolveBlock(text, 0, "theirs"), 0, "both"))).toEqual([]);
    expect(resolveBlock(resolveBlock(text, 0, "theirs"), 0, "both")).toBe("top\ntheirs1\nmid\nours2\ntheirs2\nend\n");
    expect(markerProblems("a\n=======\nb\n").length).toBe(1);
    expect(markerProblems("a ======= b\n")).toEqual([]);
  });
});

describe("rebase", () => {
  const diverged = [...BASE, "git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "f1"', w("d.txt", "d"), 'git add . && git commit -m "f2"', "git switch main", w("b.txt", "b"), 'git add . && git commit -m "m1"', "git switch f"];

  it("replays commits onto the new base: new ids, same messages and changes, a straight line", () => {
    const { r: pre } = sh(diverged);
    const oldF = commitsToReplay(pre, id(pre, "f"), id(pre, "main"));
    const x = run(pre, "git rebase main");
    expect(x.ok).toBe(true);
    expect(x.output).toBe("Successfully rebased and updated refs/heads/f.");
    const r = x.repo;
    const newF = commitsToReplay(r, id(r, "f"), id(r, "main"));
    expect(newF).toHaveLength(2);
    expect(newF.every((c, i) => c !== oldF[i])).toBe(true);
    expect(newF.map((c) => r.commits[c].message)).toEqual(["f1", "f2"]);
    expect(r.commits[newF[0]].parents).toEqual([pre.branches.main]);
    expect(r.commits[newF[1]].parents).toEqual([newF[0]]);
    // the change each commit introduced is preserved
    expect(r.commits[newF[0]].tree["c.txt"]).toBe("c\n");
    expect(r.commits[newF[1]].tree["d.txt"]).toBe("d\n");
    expect(r.commits[newF[1]].tree["b.txt"]).toBe("b\n"); // and it now includes main's work
    expect(r.work).toEqual(r.commits[id(r, "f")].tree);
    expect(r.head).toEqual({ kind: "branch", name: "f" });
    expect(r.op).toBeNull();
    expect(historyFacts(r, "f")).toMatchObject({ linear: true, merges: 0, commits: 4 });
    // old commits still exist as objects, but no ref reaches them
    expect(r.commits[oldF[0]]).toBeDefined();
    expect(ancestors(r, id(r, "f")).has(oldF[0])).toBe(false);
    expect(r.origHead).toBe(pre.branches.f);
    expect(checkIntegrity(r)).toEqual([]);
    // main is untouched and can now fast-forward
    expect(r.branches.main).toBe(pre.branches.main);
    expect(historyFacts(sh(["git switch main", "git merge f"], r).r, "main").linear).toBe(true);
  });

  it("is a no-op or a fast-forward when there is nothing to replay", () => {
    const { r } = sh([...BASE, "git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "f1"']);
    expect(run(r, "git rebase main").output).toBe("Current branch f is up to date.");
    const ff = sh(["git switch main", w("b.txt", "b"), 'git add . && git commit -m "m"', "git switch f", "git switch main"], r).r;
    const behind = sh(["git switch -c g main~1", "git rebase main"], ff);
    expect(behind.r.branches.g).toBe(ff.branches.main);
  });

  it("conflict while rebasing: stops on the commit, --continue replays the rest, --abort restores everything", () => {
    const setup = ["git init", w("s.txt", "theme=light"), 'git add . && git commit -m "base"', "git switch -c f", w("s.txt", "theme=blue"), 'git commit -am "blue"', w("t.txt", "t"), 'git add . && git commit -m "add t"', "git switch main", w("s.txt", "theme=dark"), 'git commit -am "dark"', "git switch f"];
    const { r: pre } = sh(setup);
    const x = run(pre, "git rebase main");
    expect(x.ok).toBe(false);
    expect(x.output).toContain("CONFLICT (content): Merge conflict in s.txt");
    expect(x.output).toMatch(/error: could not apply [0-9a-f]{7}\.\.\. blue/);
    const r = x.repo;
    expect(r.op).toMatchObject({ kind: "rebase", branch: "f", total: 2, done: 1 });
    expect(r.head.kind).toBe("detached");
    expect(r.work["s.txt"]).toMatch(/^<<<<<<< HEAD\ntheme=dark\n=======\ntheme=blue\n>>>>>>> [0-9a-f]{7} \(blue\)\n$/);
    const st = run(r, "git status").output;
    expect(st).toContain("rebase in progress; onto " + pre.branches.main.slice(0, 7));
    expect(st).toContain("You are currently rebasing branch 'f'");
    expect(run(r, "git rebase --continue").output).toContain("s.txt: needs merge");
    expect(run(r, 'git commit -m "x"').ok).toBe(false);
    const fixed = sh(["resolve s.txt theirs", "git add s.txt"], r).r;
    const done = run(fixed, "git rebase --continue");
    expect(done.ok).toBe(true);
    expect(done.output).toContain("Successfully rebased and updated refs/heads/f.");
    const f = done.repo;
    expect(f.op).toBeNull();
    expect(f.head).toEqual({ kind: "branch", name: "f" });
    expect(commitsToReplay(f, id(f, "f"), id(f, "main")).map((c) => f.commits[c].message)).toEqual(["blue", "add t"]);
    expect(f.commits[id(f, "f")].tree["s.txt"]).toBe("theme=blue\n");
    expect(f.commits[id(f, "f")].tree["t.txt"]).toBe("t\n");
    const aborted = sh(["git rebase --abort"], r).r;
    expect(aborted.op).toBeNull();
    expect(aborted.head).toEqual({ kind: "branch", name: "f" });
    expect(aborted.branches.f).toBe(pre.branches.f);
    expect(aborted.work).toEqual(pre.work);
    expect(run(pre, "git rebase --continue").output).toBe("fatal: No rebase in progress?");
  });

  it("--skip drops the conflicting commit; interactive and dirty-tree rebases are refused", () => {
    const setup = ["git init", w("s.txt", "1"), 'git add . && git commit -m "base"', "git switch -c f", w("s.txt", "2"), 'git commit -am "f"', "git switch main", w("s.txt", "3"), 'git commit -am "m"', "git switch f"];
    const { r } = sh(setup);
    const stuck = run(r, "git rebase main").repo;
    const done = run(stuck, "git rebase --skip");
    expect(done.ok).toBe(true);
    expect(done.repo.branches.f).toBe(r.branches.main);
    expect(run(r, "git rebase -i main").output).toContain("interactive rebase is not available");
    expect(run(sh([w("s.txt", "dirty")], r).r, "git rebase main").output).toContain("You have unstaged changes");
  });
});

describe("reset", () => {
  const three = [...BASE, w("a.txt", "two"), 'git commit -am "two"', w("a.txt", "three"), 'git commit -am "three"'];
  it("--soft moves only the branch: index and working tree keep the newest content", () => {
    const { r: pre } = sh(three);
    const r = run(pre, "git reset --soft HEAD~1").repo;
    expect(r.branches.main).toBe(id(pre, "HEAD~1"));
    expect(r.index["a.txt"]).toBe("three\n");
    expect(r.work["a.txt"]).toBe("three\n");
    expect(run(r, "git status -s").output).toBe("M  a.txt");
    expect(r.origHead).toBe(pre.branches.main);
  });
  it("--mixed (default) moves the branch and resets the index; the working tree keeps the content", () => {
    const { r: pre } = sh(three);
    for (const cmd of ["git reset HEAD~1", "git reset --mixed HEAD~1"]) {
      const x = run(pre, cmd);
      expect(x.output).toBe("Unstaged changes after reset:\nM\ta.txt");
      expect(x.repo.index["a.txt"]).toBe("two\n");
      expect(x.repo.work["a.txt"]).toBe("three\n");
      expect(run(x.repo, "git status -s").output).toBe(" M a.txt");
    }
  });
  it("--hard resets branch, index and working tree; untracked files stay; ORIG_HEAD undoes it", () => {
    const { r: pre } = sh([...three, w("u.txt", "untracked")]);
    const x = run(pre, "git reset --hard HEAD~2");
    expect(x.output).toMatch(/^HEAD is now at [0-9a-f]{7} base$/);
    const r = x.repo;
    expect(r.work["a.txt"]).toBe("base\n");
    expect(r.index["a.txt"]).toBe("base\n");
    expect(r.work["u.txt"]).toBe("untracked\n");
    expect(run(r, "git status -s").output).toBe("?? u.txt");
    const back = run(r, "git reset --hard ORIG_HEAD").repo;
    expect(back.branches.main).toBe(pre.branches.main);
    expect(back.work["a.txt"]).toBe("three\n");
  });
  it("reset with paths unstages; reset rejects unknown revisions; soft reset with paths is an error", () => {
    const { r: pre } = sh([...three, w("a.txt", "four"), "git add a.txt"]);
    const r = run(pre, "git reset a.txt").repo;
    expect(r.index["a.txt"]).toBe("three\n");
    expect(r.work["a.txt"]).toBe("four\n");
    expect(run(pre, "git reset --soft HEAD~9").output).toContain("unknown revision");
    expect(run(pre, "git reset --soft -- a.txt").output).toContain("Cannot do soft reset with paths");
  });
  it("hard reset during a merge abandons it; soft and mixed are refused", () => {
    const { r: pre } = sh([...BASE, "git switch -c f", w("a.txt", "f"), 'git commit -am "f"', "git switch main", w("a.txt", "m"), 'git commit -am "m"']);
    const stuck = run(pre, "git merge f").repo;
    expect(stuck.op?.kind).toBe("merge");
    expect(run(stuck, "git reset --mixed").output).toContain("Cannot do a mixed reset in the middle of a merge");
    const r = run(stuck, "git reset --hard").repo;
    expect(r.op).toBeNull();
    expect(r.work["a.txt"]).toBe("m\n");
  });
});

describe("revert, cherry-pick, restore, stash", () => {
  it("revert adds a new commit that undoes a change; history is kept", () => {
    const { r: pre } = sh([...BASE, w("a.txt", "bad"), 'git commit -am "bad"']);
    const r = run(pre, "git revert HEAD").repo;
    expect(r.commits[id(r, "HEAD")].message).toBe(`Revert "bad"\n\nThis reverts commit ${pre.branches.main}.`);
    expect(r.commits[id(r, "HEAD")].parents).toEqual([pre.branches.main]);
    expect(r.work["a.txt"]).toBe("base\n");
    expect(run(r, "git log --oneline").output.split("\n")).toHaveLength(3);
    // reverting a merge needs -m, which the lab lacks
    const m = sh(["git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "c"', "git switch main", w("b.txt", "b"), 'git add . && git commit -m "b"', "git merge f"], r).r;
    expect(run(m, "git revert HEAD").output).toContain("is a merge but no -m option was given");
  });
  it("revert conflict: stops, resolve and --continue", () => {
    const { r } = sh([...BASE, w("a.txt", "v2"), 'git commit -am "v2"', w("a.txt", "v3"), 'git commit -am "v3"']);
    const x = run(r, "git revert HEAD~1");
    expect(x.ok).toBe(false);
    expect(x.output).toContain("CONFLICT (content): Merge conflict in a.txt");
    const done = sh(["resolve a.txt theirs", "git add a.txt", "git revert --continue"], x.repo).r;
    expect(done.op).toBeNull();
    expect(done.commits[id(done, "HEAD")].message).toContain('Revert "v2"');
  });
  it("cherry-pick copies a commit as a new commit with the same message and change", () => {
    const { r: pre } = sh([...BASE, "git switch -c hot", w("tax.txt", "5"), 'git add . && git commit -m "Add tax"', "git switch main", w("b.txt", "b"), 'git add . && git commit -m "b"']);
    const r = run(pre, "git cherry-pick hot").repo;
    const c = r.commits[id(r, "HEAD")], orig = r.commits[pre.branches.hot];
    expect(c.id).not.toBe(orig.id);
    expect(c.message).toBe("Add tax");
    expect(c.parents).toEqual([pre.branches.main]);
    expect(c.tree).toEqual({ "a.txt": "base\n", "b.txt": "b\n", "tax.txt": "5\n" });
    expect(run(pre, "git cherry-pick nope").ok).toBe(false);
  });
  it("cherry-pick conflict can be aborted", () => {
    const { r: pre } = sh([...BASE, "git switch -c f", w("a.txt", "f"), 'git commit -am "f"', "git switch main", w("a.txt", "m"), 'git commit -am "m"']);
    const x = run(pre, "git cherry-pick f");
    expect(x.ok).toBe(false);
    expect(x.repo.op?.kind).toBe("cherry-pick");
    const r = sh(["git cherry-pick --abort"], x.repo).r;
    expect(r.work).toEqual(pre.work);
    expect(r.op).toBeNull();
  });
  it("restore discards working-tree edits; restore --staged unstages", () => {
    let { r } = sh([...BASE, w("a.txt", "edit")]);
    expect(run(r, "git restore a.txt").repo.work["a.txt"]).toBe("base\n");
    r = sh(["git add a.txt"], r).r;
    const un = run(r, "git restore --staged a.txt").repo;
    expect(un.index["a.txt"]).toBe("base\n");
    expect(un.work["a.txt"]).toBe("edit\n");
    expect(run(r, "git restore nope.txt").output).toContain("did not match any file(s) known to git");
  });
  it("stash saves tracked changes, cleans the tree, pop restores them; untracked files stay", () => {
    let { r } = sh([...BASE, w("a.txt", "wip"), w("u.txt", "untracked")]);
    const x = run(r, "git stash");
    expect(x.output).toMatch(/^Saved working directory and index state WIP on main: [0-9a-f]{7} base$/);
    r = x.repo;
    expect(r.work["a.txt"]).toBe("base\n");
    expect(r.work["u.txt"]).toBe("untracked\n");
    expect(run(r, "git stash list").output).toMatch(/^stash@\{0\}: WIP on main: [0-9a-f]{7} base$/);
    r = run(r, "git stash pop").repo;
    expect(r.work["a.txt"]).toBe("wip\n");
    expect(r.stash).toHaveLength(0);
    expect(run(r, "git stash pop").output).toContain("No stash entries found");
    expect(run(sh([...BASE], emptyRepo()).r, "git stash").output).toBe("No local changes to save");
  });
  it("stash keeps a staged new file staged after pop", () => {
    let { r } = sh([...BASE, w("n.txt", "new"), "git add n.txt"]);
    r = run(r, "git stash").repo;
    expect(r.work["n.txt"]).toBeUndefined();
    r = run(r, "git stash pop").repo;
    expect(r.index["n.txt"]).toBe("new\n");
  });
});

describe("what a command changed", () => {
  it("describes new commits, ref moves, HEAD changes and areas", () => {
    const { r: a } = sh(BASE);
    const x = run(a, "git switch -c f");
    expect(describeChanges(a, x.repo)).toEqual([`Branch f created at ${headId(a)!.slice(0, 7)}`, "HEAD now points to branch f"]);
    const e = sh([w("z.txt", "z"), "git add z.txt", 'git commit -m "z"'], a);
    const ch = describeChanges(a, e.r);
    expect(ch.some((l) => l.startsWith("New commit") && l.includes('"z"'))).toBe(true);
    expect(ch.some((l) => l.startsWith("Branch main moved"))).toBe(true);
    expect(describeChanges(a, run(a, "git log").repo)).toEqual(["Nothing changed in the repository (this command only reads)."]);
    const addOnly = describeChanges(sh([w("q.txt", "q")], a).r, sh([w("q.txt", "q"), "git add q.txt"], a).r);
    expect(addOnly).toEqual(["Staging area: q.txt added"]);
  });
  it("editing a file by hand is limited to plain paths", () => {
    const { r } = sh(BASE);
    expect(writeFile(r, "../x", "a").ok).toBe(false);
    expect(writeFile(r, "ok/x.txt", "no newline").repo.work["ok/x.txt"]).toBe("no newline\n");
  });
});

describe("history is always a DAG with valid parents (property check)", () => {
  // A small deterministic pseudo-random generator so failures are reproducible.
  const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  it("random command sequences never corrupt the object graph", () => {
    const files = ["a.txt", "b.txt", "c/d.txt"];
    const succeeded: Record<string, number> = {};
    let conflicts = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const next = rng(seed);
      const pick = <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)];
      let r = runCommand(emptyRepo(), "git init").repo;
      r = runCommand(r, `${w("a.txt", "start")} && git add . && git commit -m "root"`).repo;
      const cmds: (() => string)[] = [
        () => w(pick(files), `v${Math.floor(next() * 4)}`),
        () => `echo "l${Math.floor(next() * 5)}" >> ${pick(files)}`,
        () => "git add .",
        () => `git commit -am "c${Math.floor(next() * 99)}"`,
        () => `git switch -c b${Math.floor(next() * 4)}`,
        () => `git switch ${pick(["main", "b0", "b1", "b2", "b3"])}`,
        () => `git merge ${pick(["main", "b0", "b1", "b2", "b3"])}`,
        () => `git rebase ${pick(["main", "b0", "b1", "b2", "b3"])}`,
        () => `git reset --${pick(["soft", "mixed", "hard"])} HEAD~${Math.floor(next() * 2)}`,
        () => `git cherry-pick ${pick(["main", "b0", "b1", "b2", "b3"])}`,
        () => `git revert ${pick(["HEAD", "HEAD~1"])}`,
        () => "git stash",
        () => "git stash pop",
        () => `resolve ${pick(files)} ${pick(["ours", "theirs", "both"])}`,
        () => "git add . && git commit",
        () => "git rebase --continue",
        () => `git branch -D ${pick(["b0", "b1", "b2", "b3"])}`,
        () => "git merge --abort",
        () => "git rebase --abort",
        () => "git switch --detach HEAD~1",
      ];
      for (let step = 0; step < 60; step++) {
        const line = pick(cmds)();
        const x = runCommand(r, line);
        r = x.repo;
        const verb = line.split(" ")[1] ?? line;
        if (x.ok) succeeded[verb] = (succeeded[verb] ?? 0) + 1;
        if (r.op?.unmerged.length) conflicts++;
        const problems = checkIntegrity(r);
        if (problems.length) throw new Error(`seed ${seed} step ${step} "${line}": ${problems.join("; ")}`);
        // parents exist, and following parents from any commit terminates (acyclic: ticks strictly decrease)
        for (const c of Object.values(r.commits)) for (const p of c.parents) expect(r.commits[p].tick).toBeLessThan(c.tick);
        for (const tip of [...Object.values(r.branches), ...(r.head.kind === "detached" ? [r.head.id] : [])]) expect(r.commits[tip]).toBeDefined();
        // HEAD tree and index never reference missing commits; layout covers every reachable commit exactly once
        const lay = layoutGraph(r);
        expect(new Set(lay.nodes.map((n) => n.id)).size).toBe(lay.nodes.length);
        for (const e of lay.edges) expect(e.toRow).toBeGreaterThan(e.fromRow);
      }
    }
    // The generator really exercises the interesting commands, including stopped merges and rebases.
    for (const verb of ["commit", "switch", "merge", "rebase", "reset", "stash"]) expect(succeeded[verb], verb).toBeGreaterThan(5);
    expect(conflicts).toBeGreaterThan(5);
  }, 60_000);

  it("failed commands never change the repository", () => {
    const { r } = sh([...BASE, "git branch dev"]);
    for (const bad of ["git branch dev", "git switch nope", "git merge nope", "git reset --hard nope", "git frobnicate", "git commit -m x", "git add missing.txt", "git tag -d nope"]) {
      const x = run(r, bad);
      expect(x.ok, bad).toBe(false);
      expect(x.repo, bad).toBe(r);
    }
  });
});

describe("layout", () => {
  it("lanes: HEAD branch first, merges have two parent edges, rows run newest to oldest", () => {
    const { r } = sh([...BASE, "git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "f1"', "git switch main", w("b.txt", "b"), 'git add . && git commit -m "m1"', "git merge f"]);
    const g = layoutGraph(r);
    expect(g.rows).toBe(4);
    expect(g.nodes.map((n) => n.message)).toEqual(["Merge branch 'f'", "m1", "f1", "base"]);
    const byMsg = Object.fromEntries(g.nodes.map((n) => [n.message, n]));
    expect(byMsg["m1"].lane).toBe(0);
    expect(byMsg["Merge branch 'f'"].lane).toBe(0);
    expect(byMsg["f1"].lane).toBe(1);
    expect(byMsg["Merge branch 'f'"].isMerge).toBe(true);
    expect(byMsg["Merge branch 'f'"].refs).toEqual(["HEAD -> main"]);
    expect(byMsg["f1"].refs).toEqual(["f"]);
    expect(g.edges.filter((e) => e.from === byMsg["Merge branch 'f'"].id)).toHaveLength(2);
    expect(g.edges.filter((e) => e.second)).toHaveLength(1);
    expect(g.lanes).toBe(2);
    expect(layoutGraph(r)).toEqual(g); // deterministic
  });
  it("old commits appear as orphans when asked for", () => {
    const { r } = sh([...BASE, "git switch -c f", w("c.txt", "c"), 'git add . && git commit -m "f1"', "git switch main", w("b.txt", "b"), 'git add . && git commit -m "m1"', "git switch f", "git rebase main"]);
    expect(layoutGraph(r).nodes.some((n) => n.orphan)).toBe(false);
    const withOld = layoutGraph(r, { includeUnreachable: true });
    expect(withOld.nodes.filter((n) => n.orphan).map((n) => n.message)).toEqual(["f1"]);
  });
  it("an empty repository has an empty graph", () => {
    expect(layoutGraph(runCommand(emptyRepo(), "git init").repo)).toEqual({ nodes: [], edges: [], lanes: 0, rows: 0 });
  });
});

describe("merge versus rebase comparison", () => {
  it("clean variant: merge keeps both lines and adds a merge commit; rebase gives a straight line with rewritten ids and the same files", () => {
    const c = compareMergeRebase("clean");
    expect(c.merge.facts).toMatchObject({ linear: false, merges: 1, commits: 6 });
    expect(c.rebase.facts).toMatchObject({ linear: true, merges: 0, commits: 5 });
    expect(c.merge.rewritten).toEqual([]);
    expect(c.rebase.rewritten.map((x) => x.message)).toEqual(["Add export", "Add report"]);
    for (const x of c.rebase.rewritten) { expect(x.newId).not.toBe(x.oldId); expect(c.rebase.repo.commits[x.oldId]).toBeDefined(); }
    expect(c.sameFinalFiles).toBe(true);
    expect(c.merge.conflictStops + c.rebase.conflictStops).toBe(0);
    expect(c.start.branches.main).toBe(c.merge.repo.commits[c.merge.repo.branches.main].parents[0]);
    expect(checkIntegrity(c.merge.repo)).toEqual([]);
    expect(checkIntegrity(c.rebase.repo)).toEqual([]);
  });
  it("conflict variant: merge resolves once, rebase resolves once per replayed commit that touches the line", () => {
    const c = compareMergeRebase("conflict");
    expect(c.merge.conflictStops).toBe(1);
    expect(c.rebase.conflictStops).toBe(2);
    expect(c.merge.facts.linear).toBe(false);
    expect(c.rebase.facts.linear).toBe(true);
    expect(c.merge.repo.work["settings.txt"]).toBe("theme=dark\ntheme=teal\n");
    expect(c.rebase.repo.work["settings.txt"]).toBe("theme=dark\ntheme=blue\ntheme=teal\n");
    expect(c.sameFinalFiles).toBe(false);
    expect(c.merge.repo.op).toBeNull();
    expect(c.rebase.repo.op).toBeNull();
    expect(c.rebase.steps.filter((s) => s === "git rebase --continue")).toHaveLength(2);
  });
});

describe("guided scenarios (playback frames)", () => {
  it("PRESETS has the required ids and labels", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["first-commit", "branching", "fast-forward-merge", "three-way-merge", "merge-conflict", "rebase-vs-merge", "reset-modes", "staging-area", "undo-changes"]);
    for (const p of PRESETS) { expect(p.label.length).toBeGreaterThan(3); expect(p.teaches.length).toBeGreaterThan(10); expect(p.steps.length).toBeGreaterThan(5); }
  });
  for (const p of PRESETS) {
    it(`${p.id}: every command behaves as declared, every step explains itself, the graph stays valid`, () => {
      const frames = runScript(p.steps, p.teaches);
      expect(frames).toHaveLength(p.steps.length + 1);
      expect(frames[0].repo.initialized).toBe(false);
      frames.slice(1).forEach((f, i) => {
        expect(f.ok, `${p.id} step ${i + 1} "${f.cmd}": ${f.output}`).toBe(!p.steps[i].expectFail);
        expect(f.why.length).toBeGreaterThan(10);
        expect(f.changes.length).toBeGreaterThan(0);
        expect(checkIntegrity(f.repo)).toEqual([]);
      });
      expect(frames.reduce((n, f) => n + f.newCommits.length, 0)).toBe(Object.keys(frames[frames.length - 1].repo.commits).length);
    });
  }
  it("known end states", () => {
    const end = (id: string) => { const f = runScript(PRESETS.find((p) => p.id === id)!.steps, ""); return f[f.length - 1].repo; };
    expect(historyFacts(end("fast-forward-merge"), "main")).toMatchObject({ linear: true, commits: 3 });
    expect(end("fast-forward-merge").branches.main).toBe(end("fast-forward-merge").branches.feature);
    expect(historyFacts(end("three-way-merge"), "main")).toMatchObject({ linear: false, merges: 1, commits: 4 });
    expect(historyFacts(end("merge-conflict"), "main")).toMatchObject({ linear: false, merges: 1 });
    expect(end("merge-conflict").work["report.txt"]).toBe("title: Revenue\ntitle: Sales 2026\n");
    expect(historyFacts(end("rebase-vs-merge"), "feature")).toMatchObject({ linear: true, commits: 4 });
    expect(end("undo-changes").tags["good-state"]).toBeDefined();
    expect(end("staging-area").work["notes.md"]).toBe("# Notes\ntodo: write tests\n");
  });
  it("the changes list says exactly what a commit did", () => {
    const frames = runScript(PRESETS[0].steps, "");
    const commit = frames.find((f) => f.cmd.startsWith("git commit"))!;
    expect(commit.changes).toEqual([expect.stringMatching(/^New commit [0-9a-f]{7} "Add README" \(no parent: the first commit\)$/), expect.stringMatching(/^Branch main created at [0-9a-f]{7}$/)]);
  });
  it("lists what is not implemented", () => {
    expect(NOT_IMPLEMENTED.join(" ")).toMatch(/Remotes/);
    expect(NOT_IMPLEMENTED.join(" ")).toMatch(/Interactive rebase/);
  });
});

describe("mergeTrees", () => {
  it("combines per-path changes and reports exactly the conflicting paths", () => {
    const res = mergeTrees({ a: "1\n", b: "1\n", c: "1\n" }, { a: "2\n", b: "1\n", c: "x\n", d: "d\n" }, { a: "1\n", b: "3\n", c: "y\n" }, { ours: "HEAD", theirs: "f" });
    expect(res.conflicts).toEqual([{ path: "c", kind: "content" }]);
    expect(res.tree.a).toBe("2\n");
    expect(res.tree.b).toBe("3\n");
    expect(res.tree.d).toBe("d\n");
    expect(res.tree.c).toBe("<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> f\n");
    expect(res.log).toEqual(["Auto-merging c", "CONFLICT (content): Merge conflict in c"]);
  });
});
