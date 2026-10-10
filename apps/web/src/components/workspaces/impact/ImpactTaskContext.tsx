import type { TaskContextSlotProps } from "../slots.types";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import { PeerSectionLabel } from "../PeerPageHeader";
import { ImpactList } from "./ImpactList";

export function ImpactTaskContext(props: TaskContextSlotProps) {
  if (!activePlugin(props.status, "impact")) return null;
  return (
    <section aria-label="Impact" className="flex flex-col gap-2.5">
      <PeerSectionLabel>Impact</PeerSectionLabel>
      <ImpactList
        key={`${props.status.email}/${props.workspace}/${props.project}/${props.scope}`}
        {...props}
        provided
        place={{
          workspace: props.workspace,
          project: props.project,
          ...(props.scope.startsWith("task:") ? { task: props.scope.slice(5) } : {}),
        }}
      />
    </section>
  );
}
