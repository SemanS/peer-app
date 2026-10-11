import { useState } from "react";

/**
 * `value` while there is one, else the last one seen for the same `key`: a query that reads again
 * under a new key (the revision moved) answers nothing for a moment, and a page that shows what it
 * has read should not blank in between. A new `key` forgets it.
 */
export function useRetained<T>(value: T | null, key: string): T | null {
  const [kept, setKept] = useState<{ readonly key: string; readonly value: T } | null>(null);
  if (value !== null && (kept === null || kept.key !== key || kept.value !== value)) {
    setKept({ key, value });
  }
  if (value !== null) return value;
  return kept !== null && kept.key === key ? kept.value : null;
}
