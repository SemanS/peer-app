import { heldResources, resourceLabel } from "@t3tools/client-runtime/peer/resources";
import { LockIcon } from "lucide-react";

import type { PeerWebPlugin } from "../slots.types";
import { HeldResources } from "./HeldResources";

export const resourcesWebPlugin: PeerWebPlugin = {
  id: "resources",
  workPanel: HeldResources,
  workPanelPlace: "after-overlaps",
  projectSignals: (status, { workspace, projectId }) => {
    const held = heldResources(status).filter(
      (h) => h.workspace === workspace && h.project === projectId,
    );
    return [
      {
        id: "resources",
        label: "Held resources",
        icon: LockIcon,
        count: held.length,
        detail: held.length === 0 ? "None held" : held.map(resourceLabel).join(", "),
        tone: "coordination",
      },
    ];
  },
};
