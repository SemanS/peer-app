import type { PeerMobilePlugin } from "../slotTypes";
import { TeamSection } from "./TeamSection";

/**
 * Ownership on the phone: the Team section of the workspace, read-only, below the tasks. Its other
 * part is not a slot: an owner's call is a kind of Needs you item, which the Needs you list and the
 * Work board draw (`OwnerCallCard`) and decide in a sheet (`OwnerCallSheet`). With the plugin not
 * active the registry leaves it out, and nothing of ownership shows.
 */
export const ownershipMobilePlugin: PeerMobilePlugin = {
  id: "ownership",
  workspaceSections: [{ place: "tasks", Component: TeamSection }],
};
