/**
 * Fails when any prerendered page contains a failed Suspense boundary marker (`<!--$!-->`).
 * That marker is what React 18's server renderer writes when a lazy component suspends during
 * prerender, and it makes the browser throw React error #419 while hydrating.
 * Usage: node scripts/check-prerender.mjs [dir]   (default: dist-site)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const MARKER = "<!--$!-->";

export function findFailedBoundaries(dir) {
  const bad = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".html") && readFileSync(p, "utf8").includes(MARKER)) bad.push(p);
    }
  };
  walk(dir);
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? "dist-site";
  const bad = findFailedBoundaries(dir);
  if (bad.length) {
    console.error(`${bad.length} prerendered page(s) contain a failed Suspense boundary (React error #419 on hydrate):`);
    for (const f of bad.slice(0, 20)) console.error("  " + f);
    process.exit(1);
  }
  console.log(`check-prerender: no failed Suspense boundaries in ${dir}`);
}
