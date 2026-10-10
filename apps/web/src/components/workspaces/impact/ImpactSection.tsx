import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import type { PeerSlotProps } from "../slots.types";
import { ImpactList } from "./ImpactList";

/** Impact overlaps in the Work panel, only while some exist: advice that never blocks an edit. */
export function ImpactSection(props: PeerSlotProps) {
  if (!activePlugin(props.status, "impact")) return null;
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
