import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import type { PeerSlotProps } from "../slots.types";
import { ImpactList } from "./ImpactList";

export function ImpactSection(props: PeerSlotProps) {
  if (!activePlugin(props.status, "impact")) return null;
  return (
    <section aria-label="Impact" className="space-y-2 px-2">
      <h2 className="text-xs font-medium text-secondary-label">Impact</h2>
      <p className="text-xs text-muted-foreground">
        Advice from changed symbols and their callers. It never blocks an edit.
      </p>
      {props.status.workspaces.map((workspace) => (
        <ImpactList
          key={`${props.status.email}/${workspace.slug}`}
          {...props}
          place={{ workspace: workspace.slug }}
        />
      ))}
    </section>
  );
}
