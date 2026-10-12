import type { PeerWebPlugin } from "../slots.types";
import { OwnerBadge } from "./OwnerBadge";
import { OwnerDialogs } from "./OwnerDialogs";
import { taskMenu } from "./taskMenu";

/**
 * The ownership plugin's web UI: a task's owner and its pending owner's calls on its page, the
 * owner items of its menu, and the dialogs those open. The owner's call card in Needs you and the
 * owner on a board card are drawn by the Work board itself, since both belong to its own cards.
 */
export const ownershipWebPlugin: PeerWebPlugin = {
  id: "ownership",
  background: OwnerDialogs,
  taskBadges: OwnerBadge,
  taskMenu,
};
