import { useMemo } from "react";
import { useTheme } from "../contexts/ThemeContext";

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Chart colors that follow the active light/dark theme tokens. */
export function useChartTheme() {
  const { resolved } = useTheme();

  return useMemo(() => {
    void resolved; // recompute when theme flips
    return {
      grid: cssVar("--chart-grid", "#27272a"),
      tick: cssVar("--chart-tick", "#a1a1aa"),
      tooltipBg: cssVar("--chart-tooltip-bg", "#18181b"),
      tooltipBorder: cssVar("--chart-tooltip-border", "#3f3f46"),
      barMuted: cssVar("--chart-bar-muted", "#3f3f46"),
      barAccent: cssVar("--chart-bar-accent", "#8b7cf8"),
      barSuccess: cssVar("--chart-bar-success", "#34d399"),
      line: cssVar("--chart-bar-accent", "#8b7cf8"),
    };
  }, [resolved]);
}
