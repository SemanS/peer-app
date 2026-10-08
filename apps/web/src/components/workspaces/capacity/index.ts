import type { PeerWebPlugin } from "../slots";
import { CapacityRows } from "./CapacityRows";

/** Shared capacity: a project's API pool, used on this environment with the person's allocation. */
export const capacityWebPlugin: PeerWebPlugin = {
  id: "capacity",
  projectSettings: CapacityRows,
};
