import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_MS, SESSION_GAP_MS, activeMinutes, addMinutes, clearActivity, flush, formatMinutes, isActive, mergeQueue, minuteOf, setActivitySink, startsNewSession, summarizeMinutes, track, type ActivityEvent } from "../site/lib/activity";

const ev = (id: string, at: string): ActivityEvent => ({ id, type: "sql_executed", at, session: "s" });

describe("active time rules", () => {
  it("counts only focused, visible tabs with recent interaction", () => {
    const now = 1_000_000;
    expect(isActive(now, now - 10_000, true, true)).toBe(true);
    expect(isActive(now, now - IDLE_MS, true, true)).toBe(false); // idle: an open tab is not learning
    expect(isActive(now, now - 1000, false, true)).toBe(false);
    expect(isActive(now, now - 1000, true, false)).toBe(false);
    expect(isActive(now, 0, true, true)).toBe(false);
  });
  it("buckets by UTC minute and never double-counts overlapping tabs or devices", () => {
    const t = Date.parse("2026-11-05T10:15:42Z");
    expect(minuteOf(t)).toBe("2026-11-05T10:15:00.000Z");
    const tabA = [minuteOf(t), minuteOf(t + 30_000)];
    const tabB = [minuteOf(t + 5_000), minuteOf(t + 70_000)];
    expect(addMinutes(addMinutes([], tabA, t), tabB, t)).toEqual(["2026-11-05T10:15:00.000Z", "2026-11-05T10:16:00.000Z"]);
  });
  it("starts a new session after a long gap", () => {
    expect(startsNewSession(0, 5)).toBe(true);
    expect(startsNewSession(1000, 1000 + SESSION_GAP_MS)).toBe(false);
    expect(startsNewSession(1000, 1001 + SESSION_GAP_MS)).toBe(true);
  });
  it("summarises active minutes per day and formats them", () => {
    const mins = ["2026-11-04T09:00:00.000Z", "2026-11-05T10:00:00.000Z", "2026-11-05T10:01:00.000Z"];
    const s = summarizeMinutes(mins, "2026-11-05", 3);
    expect(s).toMatchObject({ todayMin: 2, weekMin: 3, totalMin: 3 });
    expect(s.days.map((d) => d.minutes)).toEqual([0, 1, 2]);
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(125)).toBe("2 h 5 min");
  });
  it("deduplicates queued events by id and keeps time order", () => {
    const q = mergeQueue([ev("a", "2026-01-02"), ev("b", "2026-01-01")], [ev("a", "2026-01-09"), ev("c", "2026-01-03")]);
    expect(q.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });
});

describe("browser tracker", () => {
  beforeEach(() => { clearActivity(); setActivitySink(null); });
  it("keeps events queued when delivery fails and removes them once delivered", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T10:00:10Z"));
    track("sql_opened", "q25");
    vi.setSystemTime(new Date("2026-11-05T10:03:10Z"));
    let accept = false;
    const sent: string[][] = [];
    setActivitySink({ send: async (events) => { sent.push(events.map((e) => e.type)); return accept; } });
    await flush();
    expect(JSON.parse(localStorage.getItem("sqlp.activity.queue")!).length).toBe(2); // session_start + sql_opened
    accept = true;
    await flush();
    expect(JSON.parse(localStorage.getItem("sqlp.activity.queue")!)).toEqual([]);
    expect(sent.at(-1)).toEqual(["session_start", "sql_opened"]);
    expect(activeMinutes()).toEqual(["2026-11-05T10:00:00.000Z"]);
    await flush();
    expect(sent.length).toBe(2); // nothing left to send, nothing re-sent
    vi.useRealTimers();
  });
});
