/**
 * Adapter registry: which engine runs an exercise of a given domain.
 *
 * Domain adapters live in `adapters/<folder>/index.ts` (owned by other agents) and are found with a glob, so a folder that does
 * not exist yet is just "not available". They load lazily, the first time an exercise of that domain opens. `pandas` and `numpy`
 * are separate domains served by the same `data` module. Tests and hosts can register their own adapter, which wins over the glob.
 */
import type { ComponentType } from "react";
import type { AdapterModule, Domain, ExecutionAdapter, VisualizerProps } from "./types";

export const DOMAINS: readonly Domain[] = ["sql", "python", "pandas", "numpy"];
export const DOMAIN_LABEL: Record<Domain, string> = { sql: "SQL", python: "Python", pandas: "pandas", numpy: "NumPy" };

/** Folder under `adapters/` that serves each domain. */
export const DOMAIN_FOLDER: Record<Domain, string> = { sql: "sql", python: "python", pandas: "data", numpy: "data" };

export type Resolution =
  | { status: "ready"; adapter: ExecutionAdapter; Visualizer?: ComponentType<VisualizerProps> }
  | { status: "missing"; reason: string };

type Loose = Record<string, unknown>;
export type AdapterSource = AdapterModule | ExecutionAdapter | (() => Promise<unknown>);

const isAdapter = (x: unknown): x is ExecutionAdapter => !!x && typeof x === "object" && typeof (x as Loose).run === "function" && "capabilities" in (x as Loose);
const isModule = (x: unknown): x is AdapterModule => !!x && typeof x === "object" && typeof (x as Loose).getAdapter === "function";

/** Reads the module shapes the convention allows (see docs/WORKSPACE_ARCHITECTURE.md). Returns null when nothing usable is found. */
export function normalizeModule(mod: unknown, domain: Domain): { adapter: ExecutionAdapter; Visualizer?: ComponentType<VisualizerProps> } | null {
  if (!mod || (typeof mod !== "object" && typeof mod !== "function")) return null;
  const m = mod as Loose;
  const viz = (v: unknown) => (typeof v === "function" || (v && typeof v === "object") ? (v as ComponentType<VisualizerProps>) : undefined);
  const fromModule = (x: AdapterModule) => {
    const adapter = x.getAdapter(domain);
    return isAdapter(adapter) ? { adapter, Visualizer: viz(x.Visualizer) ?? viz(m.Visualizer) } : null;
  };
  if (isModule(m.adapterModule)) return fromModule(m.adapterModule);
  if (isModule(m)) return fromModule(m);
  if (typeof m.getAdapter === "function") return fromModule({ getAdapter: m.getAdapter as AdapterModule["getAdapter"], Visualizer: viz(m.Visualizer) });
  if (isModule(m.default)) return fromModule(m.default);
  for (const key of ["adapter", "default"]) if (isAdapter(m[key])) return { adapter: m[key] as ExecutionAdapter, Visualizer: viz(m.Visualizer) };
  if (isAdapter(m)) return { adapter: m, Visualizer: undefined };
  return null;
}

const globbed = import.meta.glob(["./adapters/*/index.ts", "./adapters/*/index.tsx"]) as Record<string, () => Promise<unknown>>;
const loaders = new Map<string, () => Promise<unknown>>();
for (const [path, load] of Object.entries(globbed)) {
  const folder = path.split("/")[2];
  if (folder) loaders.set(folder, load);
}

const manual = new Map<Domain, AdapterSource>();
const resolved = new Map<string, Promise<Resolution>>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
export const subscribeRegistry = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** Register an adapter (or module, or lazy loader) for a domain. Replaces an earlier registration and the glob. */
export function registerAdapter(domain: Domain, source: AdapterSource) {
  manual.set(domain, source);
  resolved.delete(domain);
  changed();
}
export function unregisterAdapter(domain: Domain) {
  manual.delete(domain);
  resolved.delete(domain);
  changed();
}
/** Test helper: forget every manual registration and cached resolution. */
export function resetRegistry() {
  manual.clear();
  resolved.clear();
  changed();
}

/** Is any adapter source known for this domain (manual or on disk)? Does not load it. */
export const hasAdapterSource = (domain: Domain): boolean => manual.has(domain) || loaders.has(DOMAIN_FOLDER[domain]);

async function load(domain: Domain): Promise<Resolution> {
  const label = DOMAIN_LABEL[domain];
  try {
    const src = manual.get(domain);
    const raw = src ? (typeof src === "function" ? await src() : src) : loaders.has(DOMAIN_FOLDER[domain]) ? await loaders.get(DOMAIN_FOLDER[domain])!() : undefined;
    if (raw === undefined) return { status: "missing", reason: `The ${label} engine is not available in this build.` };
    const ok = normalizeModule(raw, domain);
    return ok ? { status: "ready", ...ok } : { status: "missing", reason: `The ${label} engine did not provide an adapter.` };
  } catch (e) {
    return { status: "missing", reason: `The ${label} engine could not be loaded${e instanceof Error && e.message ? `: ${e.message}` : "."}` };
  }
}

/** Find the adapter for a domain. Resolves to an honest "missing" state (never throws). Cached per domain. */
export function resolveAdapter(domain: Domain): Promise<Resolution> {
  let hit = resolved.get(domain);
  if (!hit) {
    hit = load(domain);
    resolved.set(domain, hit);
    // A failed load of a source that exists may be transient (network): let the next open try again.
    const mine = hit;
    void mine.then((r) => { if (r.status === "missing" && hasAdapterSource(domain) && resolved.get(domain) === mine) resolved.delete(domain); });
  }
  return hit;
}
