import { LightbulbIcon } from "lucide-react";

import type { PeerWebPlugin } from "../slots.types";
import { HarvestContext } from "./HarvestContext";

/** Knowledge: what agents found that a project may keep, and the people who decide on it. */
export const knowledgeWebPlugin: PeerWebPlugin = {
  id: "knowledge",
  projectSignals: (_status, { workspace, projectId, candidates }) => [
    {
      id: "knowledge",
      label: "Knowledge to keep",
      icon: LightbulbIcon,
      count: candidates,
      detail:
        candidates === 0
          ? "Nothing proposed"
          : candidates === 1
            ? "1 finding to keep or dismiss"
            : `${candidates} findings to keep or dismiss`,
      tone: "knowledge",
      open: (navigate) =>
        void navigate({
          to: "/knowledge/$workspace/$project",
          params: { workspace, project: projectId },
        }),
    },
  ],
  taskContext: HarvestContext,
};
