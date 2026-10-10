import type { PeerWebPlugin } from "../slots.types";
import {
  HandoffTaskAction,
  HandoffReview,
  HandoffSection,
  HandoffBadge,
  HandoffSettings,
  HandoffProjectSettings,
} from "./Handoff";
export const handoffWebPlugin: PeerWebPlugin = {
  id: "handoff",
  taskActions: HandoffTaskAction,
  taskContext: HandoffSection,
  taskReview: HandoffReview,
  taskBadges: HandoffBadge,
  settings: HandoffSettings,
  projectSettings: HandoffProjectSettings,
};
