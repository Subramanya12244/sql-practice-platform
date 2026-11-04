import { describe, expect, it } from "vitest";
import { mergeProgress, progressToRows, usernameToEmail, looksLikeEmail } from "../site/lib/account";
import { parseLesson, parseOrderBy } from "../site/lib/frontmatter";
import type { Progress } from "../site/lib/progress";

const local: Progress = {
  version: 1,
  questions: { 1: { attempts: 3, solvedAt: "2026-02-01T00:00:00Z" }, 2: { attempts: 1 } },
  activeDays: ["2026-02-01"],
  cards: { 1: { box: 3, due: "2026-03-01" } },
  mocks: [{ date: "2026-02-01T10:00:00.000Z", solved: 2, total: 5, usedSec: 600, durationMin: 30 }],
  lessons: { "joins#0": "2026-02-01T00:00:00Z" },
};

describe("account helpers", () => {
  it("maps usernames to synthetic emails", () => {
    expect(usernameToEmail(" Subramanya.a ")).toBe("subramanya.a@users.sqlpractice.local");
    expect(looksLikeEmail("a@b.com")).toBe(true);
    expect(looksLikeEmail("Subramanya.a")).toBe(false);
  });

  it("merges account and browser progress without losing anything", () => {
    const merged = mergeProgress(
      local,
      [
        { question_number: 1, attempts: 1, solved_at: "2026-01-15T00:00:00Z", revealed: false },
        { question_number: 5, attempts: 2, solved_at: "2026-01-10T00:00:00Z", revealed: true },
      ],
      { activeDays: ["2026-01-15"], cards: { 1: { box: 1, due: "2026-01-16" }, 4: { box: 2, due: "2026-02-02" } }, lessons: { "ctes#1": "x" } },
      [{ created_at: "2026-02-01T10:00:00.000Z", solved: 2, total: 5, used_sec: 600, duration_min: 30 }],
    );
    expect(merged.questions[1]).toMatchObject({ attempts: 3, solvedAt: "2026-01-15T00:00:00Z" });
    expect(merged.questions[5]).toMatchObject({ attempts: 2, revealed: true });
    expect(merged.questions[2].attempts).toBe(1);
    expect(merged.activeDays).toEqual(["2026-01-15", "2026-02-01"]);
    expect(merged.cards[1].box).toBe(3);
    expect(merged.cards[4].box).toBe(2);
    expect(merged.mocks).toHaveLength(1);
    expect(Object.keys(merged.lessons!).sort()).toEqual(["ctes#1", "joins#0"]);
    expect(progressToRows(merged).map((r) => r.question_number).sort()).toEqual([1, 2, 5]);
  });
});

describe("lesson parser", () => {
  const raw = `---
title: Joins
slug: joins
order: 7
level: Intermediate
description: d
related: [q01-a]
---

Intro text.

\`\`\`exercise
prompt: List products.
orderBy: p.unit_price DESC, product_name
---
SELECT product_name, unit_price FROM products p ORDER BY unit_price DESC, product_name;
\`\`\`

Middle.

\`\`\`exercise
prompt: Count orders.
---
SELECT count(*) FROM orders;
\`\`\`
`;
  it("splits markdown and exercises", () => {
    const l = parseLesson(raw, "07-joins");
    expect(l).toMatchObject({ slug: "joins", order: 7, level: "Intermediate", related: ["q01-a"] });
    expect(l.segments.map((s) => s.kind)).toEqual(["md", "exercise", "md", "exercise"]);
    const ex = l.segments.filter((s) => s.kind === "exercise").map((s) => (s as { exercise: { prompt: string; orderBy: unknown; index: number } }).exercise);
    expect(ex[0]).toMatchObject({ index: 0, prompt: "List products.", orderBy: [{ column: "unit_price", desc: true }, { column: "product_name", desc: false }] });
    expect(ex[1]).toMatchObject({ index: 1, prompt: "Count orders.", orderBy: null });
  });
  it("parses order keys", () => {
    expect(parseOrderBy("a, b desc")).toEqual([{ column: "a", desc: false }, { column: "b", desc: true }]);
  });
});

import { migrateProgress } from "../site/lib/progress";
describe("renumber migration", () => {
  it("moves Q98–Q142 progress to Q147–Q191 once and leaves other numbers alone", () => {
    const old: Progress = { version: 1, questions: { 5: { attempts: 1 }, 98: { attempts: 2, solvedAt: "x" }, 142: { attempts: 1 } }, activeDays: [], cards: { 100: { box: 3, due: "d" } } };
    const m = migrateProgress(old);
    expect(Object.keys(m.questions).sort()).toEqual(["147", "191", "5"]);
    expect(m.questions[147].solvedAt).toBe("x");
    expect(Object.keys(m.cards)).toEqual(["149"]);
    expect(migrateProgress(m)).toBe(m);
  });
});

describe("auth page helpers", () => {
  it("rates password strength and only follows same-site next paths", async () => {
    const { passwordStrength, safeNext } = await import("../site/pages/AuthPages");
    const { friendlyAuthError } = await import("../site/lib/auth");
    expect(passwordStrength("short").score).toBe(0);
    expect(passwordStrength("abcdefgh").label).toBe("Weak");
    expect(passwordStrength("Abcdefgh1!xyz").label).toBe("Strong");
    expect(safeNext("?next=/projects-lab/x")).toBe("/projects-lab/x");
    expect(safeNext("?next=//evil.example")).toBeNull();
    expect(safeNext("?next=https://evil.example")).toBeNull();
    expect(safeNext("?next=/login")).toBeNull();
    expect(friendlyAuthError("Invalid login credentials")).toBe("Wrong username or password.");
    expect(friendlyAuthError("User already registered")).toBe("That username or email is already taken.");
    expect(friendlyAuthError("Something else")).toBe("Something else");
  });
});

describe("review notifications", () => {
  it("counts reviews newer than the last time the learner looked", async () => {
    const { unseenCount } = await import("../site/lib/reviews");
    const rows = [{ reviewed_at: "2026-11-05T10:00:00Z" }, { reviewed_at: "2026-11-04T10:00:00Z" }];
    expect(unseenCount(rows, "")).toBe(2);
    expect(unseenCount(rows, "2026-11-04T12:00:00Z")).toBe(1);
    expect(unseenCount(rows, "2026-11-05T10:00:00Z")).toBe(0);
  });
});
