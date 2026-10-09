import type { PeerMobilePlugin } from "../slotTypes";
import { PeerForecastSection } from "./PeerForecastSection";
export const forecastMobilePlugin: PeerMobilePlugin = {
  id: "forecast",
  alwaysWorkspaceSections: [{ key: "forecast", place: "tasks", Component: PeerForecastSection }],
};
