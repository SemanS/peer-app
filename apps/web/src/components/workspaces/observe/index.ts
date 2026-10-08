import type { PeerWebPlugin } from "../slots.types";
import { shareThread } from "./shareThread";
import { observeMenuItem } from "./threadMenu";
import { WatchBadge } from "./WatchBadge";

/** Observe: letting the team watch your threads live, and watching a colleague's. */
export const observeWebPlugin: PeerWebPlugin = {
  id: "observe",
  threadMenu: (thread, environmentId) => {
    const item = observeMenuItem(thread);
    if (item === null || environmentId === null) return [];
    return [
      {
        item,
        place: "end",
        run: () => void shareThread(environmentId, thread.key, !thread.observable),
      },
    ];
  },
  threadBadges: WatchBadge,
};
