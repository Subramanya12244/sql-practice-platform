/** Pass SQL between tools (question → visualizer/comparison) within this tab. Storage may be unavailable. */
const KEY = "sqlp.handoff";

export interface Handoff {
  tool: "visualizer" | "compare" | "tutor";
  a?: string;
  b?: string;
  labelA?: string;
  labelB?: string;
  question?: string;
}

export function sendTo(h: Handoff) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    /* ignore */
  }
}

export function receive(tool: Handoff["tool"]): Handoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as Handoff;
    if (h.tool !== tool) return null;
    sessionStorage.removeItem(KEY);
    return h;
  } catch {
    return null;
  }
}
