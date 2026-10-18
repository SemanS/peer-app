import type { PeerWebPlugin } from "../slots.types";
import { PredictedConflicts } from "./PredictedConflicts";
import { ForecastTaskBadge } from "./ForecastTaskBadge";
import { ChangePairs } from "./ChangePairs";
import { ForecastSettings } from "./ForecastSettings";
export const forecastWebPlugin: PeerWebPlugin = {
  id: "forecast",
  workPanel: PredictedConflicts,
  taskBadges: ForecastTaskBadge,
  alwaysSettings: ForecastSettings,
  changeSections: ChangePairs,
};
