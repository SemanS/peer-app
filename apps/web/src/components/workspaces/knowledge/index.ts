import type { PeerWebPlugin } from "../slots.types";
import { HarvestContext } from "./HarvestContext";
import { KnowledgeRow } from "./KnowledgeRow";

/** Knowledge: what agents found that a project may keep, and the people who decide on it. */
export const knowledgeWebPlugin: PeerWebPlugin = {
  id: "knowledge",
  projectRows: KnowledgeRow,
  taskContext: HarvestContext,
};
