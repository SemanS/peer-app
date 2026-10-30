import type { PeerWebPlugin } from "../slots.types";
import { usageNavRow, usagePalette } from "./usagePalette";

/** Usage: a workspace's page of tickets, agent work, spend and tokens, reached from Activity. */
export const usageWebPlugin: PeerWebPlugin = {
  id: "usage",
  workspaceNavRow: usageNavRow,
  palette: usagePalette,
};
