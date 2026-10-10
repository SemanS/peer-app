import type { PeerWebPlugin } from "../slots.types";
import {
  MetricsProjectHistory,
  MetricsProjectSettings,
  MetricsSettings,
  MetricsWorkspaceSettings,
} from "./Metrics";
export const metricsWebPlugin: PeerWebPlugin = {
  id: "metrics",
  projectHistory: MetricsProjectHistory,
  projectSettings: MetricsProjectSettings,
  settings: MetricsSettings,
  workspaceSettings: MetricsWorkspaceSettings,
};
