import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LinuxLab } from "../site/components/visual/LinuxLab";
import { writeMotionPref } from "../site/lib/visual/motion";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
afterEach(() => { cleanup(); try { localStorage.removeItem("sqlp.visual.reduceMotion"); } catch { /* none */ } });

const cmd = () => screen.getByLabelText("Command") as HTMLInputElement;
const type = (line: string) => { fireEvent.change(cmd(), { target: { value: line } }); fireEvent.submit(screen.getByRole("form", { name: "Command line" })); };
const log = () => screen.getByRole("log", { name: "Terminal output" });
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

describe("LinuxLab shell", () => {
  it("is labelled simulated and lists what is not supported", () => {
    render(<LinuxLab />);
    expect(screen.getAllByText("Simulated").length).toBeGreaterThan(0);
    expect(screen.getByText(/Nothing here touches your computer/)).toBeInTheDocument();
    expect(screen.getByText("What is not supported")).toBeInTheDocument();
    expect(screen.getByText(/Command substitution/)).toBeInTheDocument();
  });
  it("the terminal is a real text input with a prompt, and Enter runs the command", () => {
    render(<LinuxLab />);
    expect(cmd().tagName).toBe("INPUT"); expect(cmd().type).toBe("text");
    type("pwd");
    expect(within(log()).getByText("/home/learner")).toBeInTheDocument();
    expect(within(log()).getByText(/learner@lab:~\$/)).toBeInTheDocument();
    expect(cmd().value).toBe("");
  });
  it("shows real-shell errors in the terminal", () => {
    render(<LinuxLab />);
    type("cat /etc/shadow");
    expect(within(log()).getByText("cat: /etc/shadow: Permission denied")).toBeInTheDocument();
    type("nothere");
    expect(within(log()).getByText("bash: nothere: command not found")).toBeInTheDocument();
    type("ls nothing");
    expect(within(log()).getByText("ls: cannot access 'nothing': No such file or directory")).toBeInTheDocument();
  });
  it("Up and Down recall history and restore the draft", () => {
    render(<LinuxLab />);
    type("pwd"); type("ls");
    fireEvent.change(cmd(), { target: { value: "dra" } });
    fireEvent.keyDown(cmd(), { key: "ArrowUp" }); expect(cmd().value).toBe("ls");
    fireEvent.keyDown(cmd(), { key: "ArrowUp" }); expect(cmd().value).toBe("pwd");
    fireEvent.keyDown(cmd(), { key: "ArrowUp" }); expect(cmd().value).toBe("pwd");
    fireEvent.keyDown(cmd(), { key: "ArrowDown" }); expect(cmd().value).toBe("ls");
    fireEvent.keyDown(cmd(), { key: "ArrowDown" }); expect(cmd().value).toBe("dra");
  });
  it("cd changes the prompt and the directory tree marker", () => {
    render(<LinuxLab />);
    type("cd logs");
    expect(screen.getByText(/learner@lab:~\/logs\$/, { selector: "span[aria-hidden]" })).toBeInTheDocument();
    tab("Files");
    expect(within(screen.getByRole("region", { name: "Directory tree" })).getByText(/logs\/\s+← you are here/)).toBeInTheDocument();
  });
  it("the directory tree updates after a command", () => {
    render(<LinuxLab />);
    tab("Files");
    const tree = () => within(screen.getByRole("region", { name: "Directory tree" }));
    expect(tree().queryByText("fresh-file.txt")).toBeNull();
    type("mkdir -p reports && touch reports/fresh-file.txt");
    expect(tree().getByText("fresh-file.txt")).toBeInTheDocument();
    type("rm -r reports");
    expect(tree().queryByText("fresh-file.txt")).toBeNull();
  });
  it("clear and Reset terminal empty the screen", () => {
    render(<LinuxLab />);
    type("pwd"); expect(within(log()).getByText("/home/learner")).toBeInTheDocument();
    type("clear"); expect(within(log()).queryByText("/home/learner")).toBeNull();
    type("touch made.txt"); fireEvent.click(screen.getByRole("button", { name: "Reset terminal" }));
    type("ls"); expect(within(log()).queryByText(/made\.txt/)).toBeNull();
  });
  it("suggested commands run when pressed", () => {
    render(<LinuxLab />);
    fireEvent.click(within(screen.getByRole("group", { name: "Try these commands" })).getByRole("button", { name: "pwd" }));
    expect(within(log()).getByText("/home/learner")).toBeInTheDocument();
  });
});

describe("pipeline view", () => {
  it("shows each stage's input and output and steps through them with the shared player", () => {
    render(<LinuxLab preset="pipes" />);
    type("cut -d, -f2 data/sales.csv | sort | uniq -c");
    const stages = () => within(screen.getByRole("list", { name: "Pipeline stages" })).getAllByRole("listitem");
    expect(stages()).toHaveLength(3);
    expect(stages()[0]).toHaveAttribute("aria-current", "step");
    expect(stages()[2].textContent).toContain("Not run yet.");
    expect(stages()[0].textContent).toContain("none: reads its file arguments");
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(stages()[1]).toHaveAttribute("aria-current", "step");
    expect(stages()[1].textContent).toContain("region"); // stage 2 received stage 1's output
    expect(stages()[1].textContent).toContain("Input (stdin)");
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(stages()[2].textContent).toContain("2 East");
    expect(stages()[2].textContent).toContain("3 North");
    expect(screen.getByText(/runs them one after another/)).toBeInTheDocument();
  });
  it("shows an error stage's stderr separately from what is piped on", () => {
    render(<LinuxLab preset="pipes" />);
    type("cat nothing | wc -l");
    expect(screen.getByText(/Error \(stderr, goes to the terminal, not the pipe\)/)).toBeInTheDocument();
    expect(within(log()).getByText("cat: nothing: No such file or directory")).toBeInTheDocument();
  });
  it("a redirect stage says its output went to a file", () => {
    render(<LinuxLab preset="pipes" />);
    type("echo hi > a.txt | wc -c");
    expect(screen.getByText(/written to file: > a\.txt/)).toBeInTheDocument();
  });
});

describe("files and permissions panels", () => {
  it("explains rwx bits of the selected file, and updates after chmod", () => {
    render(<LinuxLab />);
    tab("Files");
    fireEvent.click(within(screen.getByRole("region", { name: "Directory tree" })).getByRole("button", { name: "secret.txt" }));
    expect(within(screen.getByRole("region", { name: "File contents" })).getByText(/api_key=demo-not-a-real-key/)).toBeInTheDocument();
    tab("Permissions");
    expect(screen.getByLabelText(/Mode -rw-------, octal 600/)).toBeInTheDocument();
    expect(screen.getByText(/learner is treated as the owner, so may read, write here \(rw-\)/)).toBeInTheDocument();
    type("chmod 755 secret.txt");
    expect(screen.getByLabelText(/Mode -rwxr-xr-x, octal 755/)).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "Permissions by class" })).getAllByRole("row");
    expect(rows[1].textContent).toContain("owner (learner) (you)");
    expect(rows[1].textContent).toContain("7");
  });
  it("a file you may not read shows Permission denied in the contents panel", () => {
    render(<LinuxLab />);
    tab("Files");
    fireEvent.click(within(screen.getByRole("region", { name: "Directory tree" })).getByRole("button", { name: /^shadow$/ }));
    expect(screen.getByRole("alert").textContent).toContain("Permission denied");
    tab("Permissions");
    expect(screen.getByText(/may do nothing/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mode -rw-r-----, octal 640/)).toBeInTheDocument();
  });
  it("a locked directory is marked in the tree", () => {
    render(<LinuxLab />);
    tab("Files");
    expect(screen.getByRole("button", { name: /alice\/\s+\(locked\)/ })).toBeInTheDocument();
  });
});

describe("processes", () => {
  it("kill removes a process from the table, but a process that ignores TERM survives until kill -9", () => {
    render(<LinuxLab preset="processes" />);
    const table = () => within(screen.getByRole("region", { name: "Process table" }));
    expect(table().getByText("stuck_job --no-signal-handlers")).toBeInTheDocument();
    type("kill 801"); expect(table().queryByText("python etl_worker.py")).toBeNull();
    type("kill 802"); expect(table().getByText("stuck_job --no-signal-handlers")).toBeInTheDocument();
    type("kill -9 802"); expect(table().queryByText("stuck_job --no-signal-handlers")).toBeNull();
    type("kill 1"); expect(within(log()).getByText("bash: kill: (1) - Operation not permitted")).toBeInTheDocument();
  });
});

describe("challenges", () => {
  it("checks the goal against the virtual file system and the last output", () => {
    render(<LinuxLab preset="logs" />);
    fireEvent.change(screen.getByLabelText("Choose a challenge"), { target: { value: "count-errors" } });
    fireEvent.click(screen.getByRole("button", { name: "Check my answer" }));
    type("grep -c INFO logs/app.log");
    fireEvent.click(screen.getByRole("button", { name: "Check my answer" }));
    expect(screen.getByText("Not yet.")).toBeInTheDocument();
    type("grep -c ERROR logs/app.log");
    fireEvent.click(screen.getByRole("button", { name: "Check my answer" }));
    expect(screen.getByText("Done.")).toBeInTheDocument();
  });
  it("the executable-script challenge needs both chmod and a run", () => {
    render(<LinuxLab preset="permissions" />);
    fireEvent.change(screen.getByLabelText("Choose a challenge"), { target: { value: "run-backup" } });
    type("scripts/backup.sh");
    expect(within(log()).getByText("bash: scripts/backup.sh: Permission denied")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check my answer" }));
    expect(screen.getByText(/does not have execute permission/)).toBeInTheDocument();
    type("chmod u+x scripts/backup.sh"); type("scripts/backup.sh");
    expect(within(log()).getByText("backup finished")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check my answer" }));
    expect(screen.getByText("Done.")).toBeInTheDocument();
  });
});

describe("presets and motion", () => {
  it("the preset prop selects the example and an unknown one falls back", () => {
    const { unmount } = render(<LinuxLab preset="processes" />);
    expect(screen.getByRole("button", { name: "Processes and signals" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    render(<LinuxLab preset="zzz" />);
    expect(screen.getByRole("button", { name: "Navigate and inspect" })).toHaveAttribute("aria-pressed", "true");
  });
  it("auto-scroll is instant under reduced motion and smooth otherwise", () => {
    const spy = vi.fn();
    (Element.prototype as unknown as { scrollTo: unknown }).scrollTo = spy;
    render(<LinuxLab />);
    type("pwd");
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));
    writeMotionPref("reduce");
    type("ls");
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
    delete (Element.prototype as unknown as { scrollTo?: unknown }).scrollTo;
  });
});
