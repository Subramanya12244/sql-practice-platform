import { useLayoutEffect, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { initialPlayback } from "../site/lib/visual/playback";
import { parseSelect } from "../site/lib/sqlClauses";
import type { Visualization } from "../site/lib/visualize";
import { usePlayback } from "../site/components/visual/Playback";
import { ClassicPlayer } from "../site/components/visual/classic/ClassicPlayer";
import { useClassicStep } from "../site/components/visual/classic/useClassicStep";

/**
 * Player initialisation: the number of steps the player shows is the number of stages that actually exist, in the same render in
 * which the root shows it. The playback reducer learns the count one render later (an effect), so ClassicPlayer takes the real
 * count as a prop and never shows a stale zero-step frame after the data arrived.
 */
const noop = () => {};
const pbWith = (count: number, index = 0) => ({ ...initialPlayback(count), index, dispatch: noop });
const attr = (html: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1];

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe("ClassicPlayer count prop, first render with no effects", () => {
  const labels = ["FROM", "WHERE", "GROUP BY", "SELECT"];

  it("pb.count 0 but count 4: shows 4 steps (aria-valuemax, ticks, label, buttons)", () => {
    const html = renderToString(<ClassicPlayer pb={pbWith(0)} count={4} labels={labels} />);
    expect(attr(html, "aria-valuemax")).toBe("4");
    expect(attr(html, "aria-valuemin")).toBe("1");
    expect(attr(html, "aria-valuenow")).toBe("1");
    expect(attr(html, "data-step-count")).toBe("4");
    expect(html.match(/class="cx-tick"/g)).toHaveLength(3); // 4 steps = 3 inner ticks
    expect(html).toContain("Step 1 of 4 · FROM");
    expect(html).not.toContain("No steps");
    const play = /<button[^>]*aria-label="Play"[^>]*>/.exec(html)![0];
    expect(play).not.toContain('disabled=""');
    expect(/<button[^>]*aria-label="Next step"[^>]*>/.exec(html)![0]).not.toContain('disabled=""');
    expect(/<input[^>]*aria-label="Timeline"[^>]*>/.exec(html)![0]).toContain('max="3"');
    expect(/<input[^>]*aria-label="Timeline"[^>]*>/.exec(html)![0]).not.toContain('disabled=""');
  });

  it("count undefined keeps using pb.count", () => {
    const html = renderToString(<ClassicPlayer pb={pbWith(3)} labels={labels} />);
    expect(attr(html, "aria-valuemax")).toBe("3");
    expect(html).toContain("Step 1 of 3");
    const none = renderToString(<ClassicPlayer pb={pbWith(0)} />);
    expect(attr(none, "aria-valuemax")).toBe("0");
    expect(none).toContain("No steps");
    expect(/<button[^>]*aria-label="Play"[^>]*>/.exec(none)![0]).toContain('disabled=""');
  });

  it("an explicit count of 0 is the truth too (an empty visualization shows no steps)", () => {
    const html = renderToString(<ClassicPlayer pb={pbWith(5)} count={0} />);
    expect(attr(html, "aria-valuemax")).toBe("0");
    expect(html).toContain("No steps");
  });

  it("clamps the displayed index with the count prop", () => {
    const html = renderToString(<ClassicPlayer pb={pbWith(10, 9)} count={4} labels={labels} />);
    expect(attr(html, "aria-valuenow")).toBe("4");
    expect(attr(html, "data-step-index")).toBe("3");
    expect(html).toContain("Step 4 of 4 · SELECT");
    expect(/<button[^>]*aria-label="Next step"[^>]*>/.exec(html)![0]).toContain('disabled=""');
  });
});

/** A visualization with `n` stages: the hook and the player only read the stage list, so a minimal stub is enough. */
const stubViz = (n: number) => ({
  stages: Array.from({ length: n }, (_, i) => ({ clause: ["from", "where", "group by", "select"][i % 4], title: `S${i}`, columns: [], rows: [], rowsIn: 0, rowsOut: 0 })),
  parsed: parseSelect("SELECT a FROM t WHERE a > 1 GROUP BY a"),
}) as unknown as Visualization;

interface Commit { rootCount: string | null; max: string | null; now: string | null; ticks: number; text: string }

describe("host-style mount with data arriving after an initial null", () => {
  it("player and root show the same step count in every committed render, never 0 after the data arrived", async () => {
    const commits: Commit[] = [];
    let arrive: () => void = noop;
    function Host() {
      const [viz, setViz] = useState<Visualization | null>(null);
      arrive = () => setViz(stubViz(4));
      const pb = usePlayback(viz?.stages.length ?? 0);
      const cur = useClassicStep(viz, undefined, pb);
      // runs after the DOM of every commit of this component, children included
      useLayoutEffect(() => {
        const root = document.querySelector('[data-testid="host-root"]')!;
        const bar = root.querySelector('[data-testid="classic-progress"]')!;
        commits.push({ rootCount: root.getAttribute("data-step-count"), max: bar.getAttribute("aria-valuemax"), now: bar.getAttribute("aria-valuenow"), ticks: bar.querySelectorAll(".cx-tick").length, text: root.querySelector('[data-testid="classic-live"]')!.textContent ?? "" });
      });
      return (
        <div data-testid="host-root" data-step-count={cur?.count ?? 0}>
          <ClassicPlayer pb={pb} count={cur?.count} />
        </div>
      );
    }
    render(<Host />);
    expect(commits[0]).toMatchObject({ rootCount: "0", max: "0", text: "No steps" });
    const before = commits.length;
    await act(async () => { arrive(); });
    const after = commits.slice(before);
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const c of commits) expect(c.max).toBe(c.rootCount); // in every commit, loading or loaded
    for (const c of after) {
      expect(c.rootCount).toBe("4");
      expect(c.max).toBe("4");
      expect(c.now).toBe("1");
      expect(c.ticks).toBe(3);
      expect(c.text).toContain("Step 1 of 4");
    }
    // and it stays so after the reducer has caught up
    expect(screen.getByTestId("classic-progress").getAttribute("aria-valuemax")).toBe("4");
  });

  it("without the prop the same mount shows a zero-step commit (what the prop fixes)", async () => {
    const maxes: (string | null)[] = [];
    let arrive: () => void = noop;
    function Old() {
      const [viz, setViz] = useState<Visualization | null>(null);
      arrive = () => setViz(stubViz(4));
      const pb = usePlayback(viz?.stages.length ?? 0);
      const cur = useClassicStep(viz, undefined, pb);
      useLayoutEffect(() => { maxes.push(document.querySelector('[data-testid="classic-progress"]')!.getAttribute("aria-valuemax")); });
      return <div data-step-count={cur?.count ?? 0}><ClassicPlayer pb={pb} /></div>;
    }
    render(<Old />);
    await act(async () => { arrive(); });
    expect(maxes).toContain("0");
    expect(maxes[maxes.length - 1]).toBe("4");
  });
});
