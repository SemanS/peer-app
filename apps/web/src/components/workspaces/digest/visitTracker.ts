import {
  createActivityVisits,
  VisitRecord,
  HEARTBEAT_MS,
} from "@t3tools/client-runtime/peer-digest";
import { getLocalStorageItem, setLocalStorageItem } from "../../../hooks/useLocalStorage";
export function makeVisitTracker(storage: {
  read: (email: string) => VisitRecord | null;
  write: (email: string, visit: VisitRecord) => void;
}) {
  return createActivityVisits(storage);
}
const key = (email: string) => `peer.digest.visit:${email}`;
export const visits = makeVisitTracker({
  read: (email) => {
    try {
      return getLocalStorageItem(key(email), VisitRecord);
    } catch {
      return null;
    }
  },
  write: (email, value) => {
    try {
      setLocalStorageItem(key(email), value, VisitRecord);
    } catch {
      /* device privacy settings may disable storage */
    }
  },
});
let refs = 0,
  stop: (() => void) | undefined;
/** One browser listener set survives navigation for every active signed-in environment. */
export function activateVisits(email: string) {
  const release = visits.activate(email, Date.now());
  refs++;
  if (refs === 1 && typeof window !== "undefined") {
    let lastInput = 0;
    const signal = () => visits.signal(Date.now());
    const input = () => {
      const now = Date.now();
      if (now - lastInput >= 30_000) {
        lastInput = now;
        visits.signal(now);
      }
    };
    const visibility = () => visits.signal(Date.now(), document.visibilityState === "hidden");
    window.addEventListener("focus", signal);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", input);
    window.addEventListener("pointerdown", input);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") signal();
    }, HEARTBEAT_MS);
    stop = () => {
      window.removeEventListener("focus", signal);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", input);
      window.removeEventListener("pointerdown", input);
      window.clearInterval(timer);
    };
  }
  return () => {
    release();
    refs--;
    if (refs === 0) {
      stop?.();
      stop = undefined;
    }
  };
}
