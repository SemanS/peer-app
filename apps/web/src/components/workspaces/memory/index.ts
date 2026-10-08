import type { PeerWebPlugin } from "../slots.types";
import { MemoryRow } from "./MemoryRow";
import { memoryPalette } from "./palette";
import { WorkMemoryPanel } from "./WorkMemoryPanel";

/** Memory: shared findings, evidence and questions that outlive an agent's session. */
export const memoryWebPlugin: PeerWebPlugin = {
  id: "memory",
  projectRows: MemoryRow,
  taskContext: WorkMemoryPanel,
  palette: memoryPalette,
};
