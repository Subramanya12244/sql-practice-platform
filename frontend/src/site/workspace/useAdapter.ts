import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { resolveAdapter, subscribeRegistry, type Resolution } from "./registry";
import type { Domain, ExecutionAdapter, VisualizerProps } from "./types";

export type AdapterState = { status: "loading" } | Resolution;

/** The adapter for a domain: an explicit override, or the registry's (loaded lazily on first use). */
export function useAdapter(domain: Domain, override?: ExecutionAdapter, overrideViz?: ComponentType<VisualizerProps>): AdapterState {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<AdapterState>({ status: "loading" });
  useEffect(() => subscribeRegistry(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    if (override) return;
    let alive = true;
    setState({ status: "loading" });
    void resolveAdapter(domain).then((r) => { if (alive) setState(r); });
    return () => { alive = false; };
  }, [domain, override, tick]);
  return override ? { status: "ready", adapter: override, Visualizer: overrideViz } : state;
}
