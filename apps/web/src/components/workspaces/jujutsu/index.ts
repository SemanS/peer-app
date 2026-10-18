import type { PeerWebPlugin } from "../slots.types";
import { JujutsuSettings } from "./JujutsuSettings";
import { PairActions } from "./PairActions";

/**
 * Jujutsu workspaces: its state and protection in Settings › This computer, and the actions on
 * forecast's pair cards. The Operations page is a route (`/operations/$workspace/$project`).
 */
export const jujutsuWebPlugin: PeerWebPlugin = {
  id: "jujutsu",
  alwaysSettings: JujutsuSettings,
  pairActions: PairActions,
};
