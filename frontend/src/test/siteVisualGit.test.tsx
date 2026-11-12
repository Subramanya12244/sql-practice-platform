import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GitLab } from "../site/components/visual/GitLab";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* ignore */ } });

const step = () => screen.getByTestId("git-step");
const log = () => screen.getByRole("log", { name: "Terminal transcript" });
const type = (cmd: string) => { fireEvent.change(screen.getByLabelText("Git command"), { target: { value: cmd } }); fireEvent.click(screen.getByRole("button", { name: "Run" })); };
const graphLabel = () => screen.getAllByRole("img").find((e) => /^Commit graph/.test(e.getAttribute("aria-label") ?? ""))!.getAttribute("aria-label")!;

describe("Git Lab: guided lab", () => {
  it("labels the view Simulated and opens on the first scenario's final state", () => {
    render(<GitLab />);
    expect(screen.getByText("Simulated")).toBeInTheDocument();
    expect(screen.getByText(/never touches a real repository/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "First commit" })).toHaveAttribute("aria-pressed", "true");
    expect(graphLabel()).toMatch(/2 commits/);
    expect(screen.getByTestId("git-head")).toHaveTextContent(/HEAD points at branch main \(commit [0-9a-f]{7}\)/);
    expect(within(log()).getByText("git log --oneline")).toBeInTheDocument();
  });

  it("steps through the scenario and says exactly what each command changed", () => {
    render(<GitLab />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(step()).toHaveTextContent("Starting point");
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(step()).toHaveTextContent("git init");
    expect(screen.getByTestId("git-head")).toHaveTextContent("HEAD points at branch main (no commit yet)");
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(step()).toHaveTextContent("git add README.md");
    expect(step()).toHaveTextContent("Staging area: README.md added");
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(step()).toHaveTextContent("git commit");
    expect(step()).toHaveTextContent(/New commit [0-9a-f]{7} "Add README"/);
    expect(step()).toHaveTextContent(/Branch main created at [0-9a-f]{7}/);
    expect(graphLabel()).toMatch(/1 commits/);
  });

  it("the three areas show the file moving from working tree to staging area to repository", () => {
    render(<GitLab />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    const next = () => fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    const row = () => screen.getByRole("button", { name: "README.md" }).closest("tr")!;
    next(); next();
    expect(within(row()).getByText("untracked")).toBeInTheDocument();
    next(); next(); next();
    expect(within(row()).queryByText("untracked")).toBeNull();
    expect(within(row()).getByText("new")).toBeInTheDocument(); // staged as a new file, HEAD has none
    next(); next();
    expect(within(row()).queryByText("new")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(screen.getByLabelText("Text of README.md in each area")).toHaveTextContent("# Sales report");
  });

  it("keyboard: arrows step the player and the scenario buttons switch scenario", () => {
    render(<GitLab preset="rebase-vs-merge" />);
    expect(screen.getByRole("button", { name: "Rebase vs merge" })).toHaveAttribute("aria-pressed", "true");
    const bar = screen.getByRole("group", { name: "Playback controls" });
    fireEvent.keyDown(bar, { key: "Home" });
    expect(step()).toHaveTextContent("Starting point");
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(step()).toHaveTextContent("git init");
    fireEvent.keyDown(bar, { key: "End" });
    expect(within(log()).getAllByText("git rebase main").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Staging area" }));
    expect(screen.getByRole("button", { name: "Staging area" })).toHaveAttribute("aria-pressed", "true");
    expect(within(log()).queryByText("git rebase main")).toBeNull();
  });

  it("an unknown preset falls back to the first scenario", () => {
    render(<GitLab preset="nope" />);
    expect(screen.getByRole("button", { name: "First commit" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets you type commands: output appears, a failure is shown, history recall works", () => {
    render(<GitLab />);
    type("git branch -d main");
    expect(within(log()).getByText(/cannot delete branch 'main'/)).toBeInTheDocument();
    expect(step()).toHaveTextContent("did not complete");
    type("git switch -c topic");
    expect(within(log()).getByText("Switched to a new branch 'topic'")).toBeInTheDocument();
    expect(screen.getByTestId("git-head")).toHaveTextContent("HEAD points at branch topic");
    expect(step()).toHaveTextContent("Branch topic created at");
    const input = screen.getByLabelText("Git command") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("git switch -c topic");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("git branch -d main");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("git switch -c topic");
  });

  it("typing at an earlier step replaces the later steps", () => {
    render(<GitLab />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    type("git status");
    expect(within(log()).queryByText("git log --oneline")).toBeNull();
    expect(screen.getByText(/Step 3 of 3/)).toBeInTheDocument();
  });

  it("blank repository: runs a whole scenario by hand, including a hand edit", () => {
    render(<GitLab />);
    fireEvent.click(screen.getByRole("button", { name: "Blank repository" }));
    type("git init");
    type('echo "hi" > a.txt');
    type("git add a.txt");
    type('git commit -m "first"');
    expect(graphLabel()).toMatch(/1 commits.*HEAD -> main at/);
    fireEvent.click(screen.getByText("Edit a file by hand"));
    fireEvent.change(screen.getByLabelText("File"), { target: { value: "a.txt" } });
    expect((screen.getByLabelText("Text") as HTMLTextAreaElement).value).toBe("hi\n");
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to working tree" }));
    expect(step()).toHaveTextContent("Working tree: a.txt changed");
    type("git status -s");
    expect(within(log()).getByText(" M a.txt", { normalizer: (t) => t })).toBeInTheDocument();
  });

  it("lists what is supported and what is not implemented", () => {
    render(<GitLab />);
    fireEvent.click(screen.getByText("What the lab supports, and what it does not"));
    expect(screen.getByText(/Remotes: clone, fetch, pull, push/)).toBeInTheDocument();
    expect(screen.getByText(/Interactive rebase/)).toBeInTheDocument();
  });

  it("uses no animation when reduced motion is requested", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: /reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
    try {
      const { container } = render(<GitLab />);
      expect(container.querySelector(".animate-pulse")).toBeNull();
    } finally { window.matchMedia = original; }
  });
});

describe("Git Lab: merge versus rebase", () => {
  it("shows both outcomes with facts and rewritten ids, and the warning about shared history", () => {
    render(<GitLab />);
    fireEvent.click(screen.getByRole("tab", { name: "Merge vs rebase" }));
    const merge = screen.getByRole("region", { name: "git merge feature" }), rebase = screen.getByRole("region", { name: "git rebase main, then merge" });
    expect(within(merge).getByText("History is one straight line").nextSibling).toHaveTextContent("No");
    expect(within(rebase).getByText("History is one straight line").nextSibling).toHaveTextContent("Yes");
    expect(within(merge).getByText("Merge commits").nextSibling).toHaveTextContent("1");
    expect(within(rebase).getByText("Commits with new ids").nextSibling).toHaveTextContent("2");
    expect(within(rebase).getAllByText(/Add export/).length).toBeGreaterThan(1); // in the rewritten list and in the graph
    expect(within(merge).getByText(/No commit was rewritten/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Never rebase history that other people already have.");
    expect(screen.getByRole("status")).toHaveTextContent("identical in both runs");
    fireEvent.click(screen.getByLabelText("Both branches change the same line"));
    expect(within(screen.getByRole("region", { name: "git merge feature" })).getByText("Conflict stops to resolve").nextSibling).toHaveTextContent("1");
    expect(within(screen.getByRole("region", { name: "git rebase main, then merge" })).getByText("Conflict stops to resolve").nextSibling).toHaveTextContent("2");
    expect(screen.getByRole("status")).toHaveTextContent("different in the two runs");
  });
});

describe("Git Lab: conflict resolution simulator", () => {
  const openConflict = () => { render(<GitLab />); fireEvent.click(screen.getByRole("tab", { name: "Resolve a conflict" })); };

  it("merge: pick a side per block, validate that no markers remain, stage and finish", () => {
    openConflict();
    expect(screen.getByTestId("conflict-context")).toHaveTextContent("Merging feature into main. 1 file still needs a decision.");
    const file = screen.getByRole("region", { name: "Conflicted file settings.txt" });
    const stage = within(file).getByRole("button", { name: /Stage this file/ });
    expect(stage).toBeDisabled();
    expect(within(file).getByText(/3 conflict marker lines still in the file/)).toBeInTheDocument();
    expect((within(file).getByLabelText(/edit the file text yourself/) as HTMLTextAreaElement).value).toBe("<<<<<<< HEAD\ntheme=dark\n=======\ntheme=teal\n>>>>>>> feature\n");
    fireEvent.click(within(file).getByRole("button", { name: "Keep both" }));
    expect(within(file).getByText(/No conflict markers remain/)).toBeInTheDocument();
    expect((within(file).getByLabelText(/edit the file text yourself/) as HTMLTextAreaElement).value).toBe("theme=dark\ntheme=teal\n");
    fireEvent.click(within(file).getByRole("button", { name: /Stage this file/ }));
    expect(screen.queryByRole("region", { name: "Conflicted file settings.txt" })).toBeNull();
    expect(screen.getByTestId("conflict-context")).toHaveTextContent("All files are staged. Finish the operation.");
    fireEvent.click(screen.getByRole("button", { name: /Complete the merge/ }));
    expect(screen.getByText(/conflict is resolved and Git finished the operation/)).toBeInTheDocument();
    expect(screen.getByText("theme=dark / theme=teal")).toBeInTheDocument();
    expect(graphLabel()).toMatch(/1 merge commits/);
  });

  it("manual editing: leaving a marker keeps staging disabled; clean text enables it", () => {
    openConflict();
    const file = screen.getByRole("region", { name: "Conflicted file settings.txt" });
    const area = within(file).getByLabelText(/edit the file text yourself/);
    fireEvent.change(area, { target: { value: "<<<<<<< HEAD\ntheme=custom\n" } });
    expect(within(file).getByRole("button", { name: /Stage this file/ })).toBeDisabled();
    expect(within(file).getByText(/1 conflict marker line still in the file: line 1/)).toBeInTheDocument();
    fireEvent.change(area, { target: { value: "theme=custom" } });
    expect(within(file).getByRole("button", { name: /Stage this file/ })).toBeEnabled();
    fireEvent.click(within(file).getByRole("button", { name: /Stage this file/ }));
    fireEvent.click(screen.getByRole("button", { name: /Complete the merge/ }));
    expect(screen.getByText("theme=custom")).toBeInTheDocument();
  });

  it("choosing ours or theirs replaces the block with exactly that side", () => {
    openConflict();
    let file = screen.getByRole("region", { name: "Conflicted file settings.txt" });
    fireEvent.click(within(file).getByRole("button", { name: "Keep theirs" }));
    expect((within(file).getByLabelText(/edit the file text yourself/) as HTMLTextAreaElement).value).toBe("theme=teal\n");
    cleanup();
    openConflict();
    file = screen.getByRole("region", { name: "Conflicted file settings.txt" });
    fireEvent.click(within(file).getByRole("button", { name: "Keep ours" }));
    expect((within(file).getByLabelText(/edit the file text yourself/) as HTMLTextAreaElement).value).toBe("theme=dark\n");
  });

  it("rebase: the conflict comes back for the second replayed commit, then the rebase completes", () => {
    openConflict();
    fireEvent.click(screen.getByRole("button", { name: "Rebase conflict" }));
    expect(screen.getByTestId("conflict-context")).toHaveTextContent("replaying commit 1 of 2");
    let file = screen.getByRole("region", { name: "Conflicted file settings.txt" });
    fireEvent.click(within(file).getByRole("button", { name: "Keep both" }));
    fireEvent.click(within(file).getByRole("button", { name: /Stage this file/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue the rebase/ }));
    expect(screen.getByTestId("conflict-context")).toHaveTextContent("replaying commit 2 of 2");
    file = screen.getByRole("region", { name: "Conflicted file settings.txt" });
    expect((within(file).getByLabelText(/edit the file text yourself/) as HTMLTextAreaElement).value).toContain("<<<<<<< HEAD\ntheme=dark\ntheme=blue\n=======\ntheme=teal");
    fireEvent.click(within(file).getByRole("button", { name: "Keep theirs" }));
    fireEvent.click(within(file).getByRole("button", { name: /Stage this file/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue the rebase/ }));
    expect(screen.getByText(/conflict is resolved and Git finished the operation/)).toBeInTheDocument();
    expect(screen.getByText("theme=teal")).toBeInTheDocument();
  });

  it("abort returns to the starting state", () => {
    openConflict();
    fireEvent.click(screen.getByRole("button", { name: /Abort and go back/ }));
    expect(screen.getByText(/operation was aborted: the repository is back where it started/)).toBeInTheDocument();
    expect(screen.getByText("theme=dark")).toBeInTheDocument();
  });
});

describe("Git Lab: tabs", () => {
  it("are a tablist with arrow-key navigation", () => {
    render(<GitLab />);
    const first = screen.getByRole("tab", { name: "Guided lab" });
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Merge vs rebase" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Merge vs rebase" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Guided lab" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "git-tab-play");
  });
});
