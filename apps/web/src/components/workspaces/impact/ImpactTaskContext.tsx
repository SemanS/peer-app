import type { TaskContextSlotProps } from "../slots.types";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import { ImpactList } from "./ImpactList";

export function ImpactTaskContext(props: TaskContextSlotProps) {
  if (!activePlugin(props.status, "impact")) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Impact</h3>
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
