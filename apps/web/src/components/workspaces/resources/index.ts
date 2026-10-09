import type { PeerWebPlugin } from "../slots.types";
import { HeldResources } from "./HeldResources";
export const resourcesWebPlugin: PeerWebPlugin = {
  id: "resources",
  workPanel: HeldResources,
  workPanelPlace: "after-overlaps",
};
