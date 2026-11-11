import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildResumeEntry, businessProblem, demonstratedTech, readEdits, saveEdit } from "../site/lib/resume";
import { loadAllProjects, type Project, type ProjectProgress } from "../site/lib/projects";
import { ResumeProjects } from "../site/components/ResumeProjects";

const sql = (id: string, title: string) => ({ id, title, type: "sql" as const, instructions: "", starter: "", solution: "", check: "" });
const py = (id: string, title: string) => ({ id, title, type: "python" as const, instructions: "", starter: "", solution: "", tests: "" });
const checklist = (id: string, n: number) => ({ id, title: "Manual", type: "checklist" as const, instructions: "", items: Array.from({ length: n }, (_, i) => `step ${i}`) });
const project = (o: Partial<Project> = {}): Project => ({
  slug: "etl", title: "CSV to PostgreSQL ETL", level: "Beginner", description: "Fallback description.", technologies: ["PostgreSQL", "SQL", "Python", "Airflow"],
  dataset: "northwind", prerequisites: [], minutes: 60,
  body: "## Business problem\n\nFinance needs nightly orders in PostgreSQL.\nThe export is messy.\n\nSecond paragraph that must not appear.\n\n## Steps\n\nstuff",
  tasks: [sql("a", "Load a typed staging table"), py("b", "Parse and clean the CSV"), sql("c", "Remove duplicates"), checklist("m", 3)], ...o,
});
const prog = (o: Partial<ProjectProgress> = {}): ProjectProgress => ({ tasks: {}, checklist: {}, ...o });
const pass = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, { passed: true, at: "2026-11-01T00:00:00Z" }]));

describe("resume entry: evidence only", () => {
  it("nothing to claim until an automated check has passed", () => {
    expect(buildResumeEntry(project(), prog())).toBeNull();
    expect(buildResumeEntry(project(), prog({ tasks: { a: { passed: false, at: "x" } }, checklist: { m: [true, true, true] } }))).toBeNull(); // ticked boxes alone prove nothing
  });
  it("uses the project's own business problem (first paragraph) and the passed tasks, in order", () => {
    const e = buildResumeEntry(project(), prog({ tasks: pass("a", "c") }))!;
    expect(e.problem).toBe("Finance needs nightly orders in PostgreSQL. The export is messy.");
    expect(e.implemented.map((i) => i.title)).toEqual(["Load a typed staging table", "Remove duplicates"]);
    expect(e.text).toContain("- Load a typed staging table (SQL)");
    expect(e.text).not.toContain("Second paragraph");
    expect(e.text).not.toContain("Parse and clean the CSV"); // not passed
  });
  it("lists only technologies a passed check demonstrates; the rest are 'covered', not claimed", () => {
    const sqlOnly = buildResumeEntry(project(), prog({ tasks: pass("a") }))!;
    expect(sqlOnly.demonstrated).toEqual(["PostgreSQL", "SQL"]);
    expect(sqlOnly.covered).toEqual(["Python", "Airflow"]);
    expect(sqlOnly.text).not.toMatch(/Python|Airflow/);
    const both = buildResumeEntry(project(), prog({ tasks: pass("a", "b") }))!;
    expect(both.demonstrated).toEqual(["PostgreSQL", "SQL", "Python"]);
    expect(both.text).not.toContain("Airflow"); // no check exercises it, ever
    expect(demonstratedTech(["dbt", "Spark"], project().tasks, prog({ tasks: pass("a", "b") })).demonstrated).toEqual([]);
  });
  it("every number in the text comes from the evidence; no invented metrics", () => {
    const e = buildResumeEntry(project(), prog({ tasks: pass("a", "b") }))!;
    const numbers = (e.text.match(/\d+/g) ?? []).map(Number).sort();
    expect(numbers).toEqual([e.evidence.automatedPassed, e.evidence.automatedTotal].sort());
    expect(e.text).not.toMatch(/%|\bx\b|faster|reduced|improved|saved|million|thousand|\$/i);
    expect(e.evidence).toMatchObject({ automatedPassed: 2, automatedTotal: 3, manualChecked: 0, manualTotal: 3 });
  });
  it("manual steps are counted as self-reported and never put in the text; reviewer approval is only stated when recorded", () => {
    const e = buildResumeEntry(project(), prog({ tasks: pass("a"), checklist: { m: [true, true, false] } }))!;
    expect(e.evidence).toMatchObject({ manualChecked: 2, manualTotal: 3, reviewApproved: false });
    expect(e.text).not.toMatch(/manual|step 0|reviewer/i);
    const approved = buildResumeEntry(project(), prog({ tasks: pass("a"), submission: { at: "x", review: { status: "Completed" } } }))!;
    expect(approved.text).toContain("reviewer approved");
  });
  it("falls back to the description when there is no business-problem section", () => {
    expect(businessProblem({ body: "## Steps\n\nx", description: "From the description." })).toBe("From the description.");
  });
});

describe("resume entries from the real project content", () => {
  it("every project with a passed task yields text built only from that project's own words", async () => {
    const all = await loadAllProjects();
    expect(all.length).toBe(12);
    for (const p of all) {
      const first = p.tasks.find((t) => t.type !== "checklist")!;
      const e = buildResumeEntry(p, prog({ tasks: pass(first.id) }))!;
      expect(e, p.slug).toBeTruthy();
      expect(e.text).toContain(p.title);
      expect(e.text).toContain(first.title);
      expect(e.demonstrated.every((t) => p.technologies.includes(t))).toBe(true);
      // Every number is either in the project's own words (problem, task titles) or an evidence count. None is invented.
      const own = new Set([...(`${e.problem} ${e.title} ${first.title}`.match(/\d+/g) ?? []).map(Number), e.evidence.automatedPassed, e.evidence.automatedTotal, e.implemented.length]);
      for (const n of (e.text.match(/\d+/g) ?? []).map(Number)) expect(own.has(n), `${p.slug}: ${n}`).toBe(true);
    }
  });
});

describe("ResumeProjects (module)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("empty state when nothing has passed", async () => {
    render(<ResumeProjects />);
    expect(await screen.findByText("No project evidence yet")).toBeInTheDocument();
  });

  it("shows an entry after a passed check, lets the learner edit it, keeps the edit, and can reset", async () => {
    const all = await loadAllProjects();
    const p = all.find((x) => x.slug === "csv-to-postgres-etl")!;
    const t = p.tasks.find((x) => x.type !== "checklist")!;
    localStorage.setItem(`sqlp.project.${p.slug}`, JSON.stringify({ tasks: { [t.id]: { passed: true, at: "2026-11-01T00:00:00Z" } }, checklist: {} }));
    render(<ResumeProjects />);
    const box = (await screen.findByRole("textbox", { name: /Description/ })) as HTMLTextAreaElement;
    expect(box.value).toContain(p.title);
    fireEvent.change(box, { target: { value: "My own wording." } });
    expect(readEdits()[p.slug]).toBe("My own wording.");
    cleanup();
    render(<ResumeProjects />); // a reload
    expect(((await screen.findByRole("textbox", { name: /Description/ })) as HTMLTextAreaElement).value).toBe("My own wording.");
    fireEvent.click(screen.getByRole("button", { name: /Reset to generated/ }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: /Description/ }) as HTMLTextAreaElement).value).toContain(p.title));
    expect(readEdits()[p.slug]).toBeUndefined();
    fireEvent.click(screen.getByText("What this is based on"));
    expect(screen.getByText(/automated checks passed in this browser/)).toBeInTheDocument();
  });

  it("saveEdit(null) removes and the stored text is capped", () => {
    saveEdit("x", "a".repeat(9000));
    expect(readEdits().x.length).toBe(4000);
    saveEdit("x", null);
    expect(readEdits().x).toBeUndefined();
  });
});
