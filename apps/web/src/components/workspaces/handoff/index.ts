import type { PeerWebPlugin } from "../slots.types";
import {
  HandoffTaskAction,
  HandoffSection,
  HandoffBadge,
  HandoffSettings,
  HandoffProjectSettings,
} from "./Handoff";
export const handoffWebPlugin: PeerWebPlugin = {
  id: "handoff",
  taskActions: HandoffTaskAction,
  taskContext: HandoffSection,
  taskBadges: HandoffBadge,
  settings: HandoffSettings,
  projectSettings: HandoffProjectSettings,
};
