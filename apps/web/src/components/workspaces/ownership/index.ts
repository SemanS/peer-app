import type { PeerWebPlugin } from "../slots.types";
import { OwnerBadge } from "./OwnerBadge";
import { OwnershipBackground } from "./OwnershipBackground";
import { OwnersSettings } from "./OwnersSettings";
import { taskMenu } from "./taskMenu";
import { teamPalette } from "./teamPalette";
import { teamSignals } from "./teamTile";

/**
 * The ownership plugin's web UI: a task's owner and its pending owner's calls on its page, the
 * owner items of its menu and the dialogs those open, the Owners row of a project's Basics page,
 * and the Team page: its tile among a project's signals, the route behind it
 * (`team.$workspace.$project`) and the command palette's way to it. The owner's call card in
 * Needs you and the owner on a board card are drawn by the Work board itself, since both belong
 * to its own cards.
 */
export const ownershipWebPlugin: PeerWebPlugin = {
  id: "ownership",
  background: OwnershipBackground,
  taskBadges: OwnerBadge,
  taskMenu,
  projectSettings: OwnersSettings,
  projectSignals: (_status, project) => teamSignals(project, Date.now()),
  palette: teamPalette,
};
