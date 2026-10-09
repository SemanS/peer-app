import type { PeerMobilePlugin, PeerTaskProps } from "../slotTypes";
import { PeerImpactList } from "./PeerImpactList";
import { PeerImpactSettings } from "./PeerImpactSettings";

function TaskImpact(props: PeerTaskProps) {
  return (
    <PeerImpactList
      key={`${props.status.email}/${props.workspace}/${props.project.project.id}/${props.task.id}`}
      {...props}
    />
  );
}
export const impactMobilePlugin: PeerMobilePlugin = {
  id: "impact",
  taskSections: TaskImpact,
  alwaysWorkspaceSections: [
    { key: "impact-settings", place: "end", Component: PeerImpactSettings },
  ],
};
