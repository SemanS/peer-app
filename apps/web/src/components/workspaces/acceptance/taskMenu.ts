import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { serverEnvironment } from "../../../state/server";
import type { TaskMenuEntry, TaskSlotProps } from "../slots.types";
import { acceptanceFacts } from "./acceptance.logic";
import { openAcceptanceDialog } from "./acceptanceDialog";

const LABEL = { accept: "Accept…", withdraw: "Withdraw acceptance…" } as const;

/**
 * Accept… and Withdraw acceptance… in a task's menu, on its page and in the sidebar's row, for the
 * project's leads and the workspace's admins on a connection that may send them; each opens the
 * note dialog the background slot mounts.
 */
export function acceptanceMenu(props: TaskSlotProps): ReadonlyArray<TaskMenuEntry> {
  const projectId = props.project?.project.id;
  if (projectId === undefined) return [];
  const allowed = appAtomRegistry.get(
    serverEnvironment.peerAcceptanceAccept.permissionAtom(props.environmentId),
  );
  const facts = acceptanceFacts(
    props.status,
    { workspace: props.workspace, project: projectId, task: props.task.id },
    allowed,
  );
  return (facts?.actions ?? []).map((kind, index) => ({
    item: {
      id: `acceptance:${kind}`,
      label: LABEL[kind],
      ...(index === 0 ? { separatorBefore: true } : {}),
    },
    run: () => openAcceptanceDialog({ kind, environmentId: props.environmentId, ...facts!.place }),
  }));
}
