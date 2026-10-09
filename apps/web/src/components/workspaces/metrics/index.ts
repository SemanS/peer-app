import type { PeerWebPlugin } from "../slots.types";
import {
  MetricsProjectRows,
  MetricsProjectSettings,
  MetricsSettings,
  MetricsWorkspaceSettings,
} from "./Metrics";
export const metricsWebPlugin: PeerWebPlugin = {
  id: "metrics",
  projectRows: MetricsProjectRows,
  projectSettings: MetricsProjectSettings,
  settings: MetricsSettings,
  workspaceSettings: MetricsWorkspaceSettings,
};
