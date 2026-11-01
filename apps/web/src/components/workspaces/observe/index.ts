import type { PeerWebPlugin } from "../slots.types";

/** Observe: watching a colleague's thread live; `canWatchThreads` reads that it is active. */
export const observeWebPlugin: PeerWebPlugin = { id: "observe" };
