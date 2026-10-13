import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * The time, read again every minute while the app is in front and as it comes back to the front:
 * what a wait is counted from, so "40 min ago" and a signal that passed its limit keep up while
 * the screen stays open.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => {
      if (AppState.currentState === "active") setNow(Date.now());
    };
    const timer = setInterval(tick, 60_000);
    const listener = AppState.addEventListener("change", tick);
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, []);
  return now;
}
