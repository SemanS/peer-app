import type { PeerMobilePlugin } from "../slotTypes";
import { PeerMetricsSummary } from "./PeerMetricsSummary";
export const metricsMobilePlugin: PeerMobilePlugin = {
  id: "metrics",
  workspaceSections: [{ place: "end", Component: PeerMetricsSummary }],
};
