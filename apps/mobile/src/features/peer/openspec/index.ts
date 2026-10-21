import type { PeerMobilePlugin } from "../slotTypes";
import { OpenSpecTaskPreparation } from "./OpenSpecTaskPreparation";

export const openSpecMobilePlugin: PeerMobilePlugin = {
  id: "openspec",
  taskPreparation: OpenSpecTaskPreparation,
};
