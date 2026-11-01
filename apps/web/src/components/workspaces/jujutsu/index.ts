import type { PeerWebPlugin } from "../slots.types";
import { JujutsuSettings } from "./JujutsuSettings";

/**
 * Jujutsu workspaces: its state and protection in Settings › This computer. The Operations page is
 * a route (`/operations/$workspace/$project`).
 */
export const jujutsuWebPlugin: PeerWebPlugin = {
  id: "jujutsu",
  alwaysSettings: JujutsuSettings,
};
