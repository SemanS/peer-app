import type { PeerWebPlugin } from "../slots.types";
import { ImpactSection } from "./ImpactSection";
import { ImpactTaskCount } from "./ImpactTaskCount";
import { ImpactTaskContext } from "./ImpactTaskContext";
import { ImpactSettings } from "./ImpactSettings";

export const impactWebPlugin: PeerWebPlugin = {
  id: "impact",
  workPanel: ImpactSection,
  workPanelPlace: "after-overlaps",
  taskBadges: ImpactTaskCount,
  taskContext: ImpactTaskContext,
  alwaysSettings: ImpactSettings,
};
