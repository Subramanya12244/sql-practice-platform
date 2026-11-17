import { useEffect, useRef, useState } from "react";

/**
 * Filter state that lives in the address (`?q=...`). The first render always uses `initial`, so the prerendered HTML and the
 * first client render match; the address is applied after mount and kept in step afterwards (with replaceState, so the
 * back button is not filled with one entry per keystroke). The address is parsed once and held in a ref, so a second run of the
 * mount effect (React StrictMode in development) can never read an address this hook has already rewritten.
 */
export function useUrlFilter<T>(initial: T, parse: (search: string) => T, serialize: (value: T) => string): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [applied, setApplied] = useState(false);
  const first = useRef<T | null>(null);
  useEffect(() => {
    first.current ??= parse(window.location.search);
    setValue(first.current);
    setApplied(true);
    // parse is a stable module function; it must not retrigger the one-time read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!applied) return;
    const next = `${window.location.pathname}${serialize(value)}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
  }, [value, applied, serialize]);
  return [value, setValue];
}
