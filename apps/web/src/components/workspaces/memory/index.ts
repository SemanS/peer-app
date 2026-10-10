import { DatabaseIcon } from "lucide-react";

import type { PeerWebPlugin } from "../slots.types";
import { memoryPalette } from "./palette";
import { WorkMemoryPanel } from "./WorkMemoryPanel";

/** Memory: shared findings, evidence and questions that outlive an agent's session. */
export const memoryWebPlugin: PeerWebPlugin = {
  id: "memory",
  // Shared findings, evidence, questions and review stay reachable even when nothing waits.
  projectSignals: (_status, { workspace, projectId }) => [
    {
      id: "memory",
      label: "Memory",
      icon: DatabaseIcon,
      count: null,
      detail: "Findings, evidence, questions",
      tone: "knowledge",
      open: (navigate) =>
        void navigate({
          to: "/memory/$workspace/$project",
          params: { workspace, project: projectId },
          search: {},
        }),
    },
  ],
  taskContext: WorkMemoryPanel,
  palette: memoryPalette,
};
