import { heldResources, resourceLabel } from "@t3tools/client-runtime/peer/resources";

import type { PeerMobilePlugin } from "../slotTypes";
import { PeerHeldResources } from "./PeerHeldResources";
export const resourcesMobilePlugin: PeerMobilePlugin = {
  id: "resources",
  workspaceSections: [{ place: "end", Component: PeerHeldResources }],
  projectSignals: (status, { workspace, projectId }) => {
    const held = heldResources(status).filter(
      (hold) => hold.workspace === workspace && hold.project === projectId,
    );
    return [
      {
        id: "resources",
        label: "Held resources",
        icon: { ios: "lock", android: "lock" },
        count: held.length,
        detail: held.length === 0 ? "None held" : held.map(resourceLabel).join(", "),
        tone: "coordination",
      },
    ];
  },
};
