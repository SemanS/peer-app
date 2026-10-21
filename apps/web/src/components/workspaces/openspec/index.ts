import type { PeerWebPlugin } from "../slots.types";
import { OpenSpecPreparation } from "./OpenSpecPreparation";

export const openspecWebPlugin: PeerWebPlugin = {
  id: "openspec",
  taskPreparation: OpenSpecPreparation,
};
