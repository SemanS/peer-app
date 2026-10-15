import { impactRunning } from "@t3tools/client-runtime/peer/impact";
import type { PeerSlotProps } from "../slots.types";
import { ImpactList } from "./ImpactList";

/** Impact overlaps in the Work panel, only while some exist: advice that never blocks an edit. */
export function ImpactSection(props: PeerSlotProps) {
  if (!impactRunning(props.status)) return null;
  return (
    <>
      {props.status.workspaces.map((workspace) => (
        <ImpactList
          key={`${props.status.email}/${workspace.slug}`}
          {...props}
          place={{ workspace: workspace.slug }}
          quiet
        />
      ))}
    </>
  );
}
