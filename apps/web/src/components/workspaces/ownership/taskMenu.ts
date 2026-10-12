import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";

import { randomUUID } from "../../../lib/utils";
import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { serverEnvironment } from "../../../state/server";
import type { TaskMenuEntry, TaskSlotProps } from "../slots.types";
import { reportFailure } from "../workFeedback";
import { openOwnerDialog } from "./ownerDialog";
import {
  OWNER_MENU_IDS,
  ownerMenuChoices,
  taskOwnerFacts,
  type OwnerMenuId,
} from "./ownership.logic";
import { requestTeamPage } from "./teamNavigation";

const giving = new Set<string>();

/** The item every member has: it opens the project's owner map, which only leads and admins edit. */
const SEE_MAP_LABEL = "See the owner map";

/**
 * The owner's items in a task's menu, on its page and in the sidebar's row: Set owner… for the
 * project's leads and the workspace's admins, Hand over… and Give back for the task's owner, each
 * only for the person who may use it, and for everyone See the owner map. Set owner… and Hand
 * over… open their dialog (`OwnerDialogs`, mounted once at the root), the owner map opens the Team
 * page's (`TeamNavigator`, mounted there too: a menu has no router); Give back needs no more than
 * the choice.
 */
export function taskMenu(props: TaskSlotProps): ReadonlyArray<TaskMenuEntry> {
  const facts = taskOwnerFacts(props.status, {
    workspace: props.workspace,
    project: props.project?.project.id,
    task: props.task.id,
  });
  if (facts === undefined) return [];
  const { environmentId } = props;
  const target = {
    environmentId,
    workspace: props.workspace,
    project: facts.ownership.project,
    task: facts.task.id,
  };
  const run = (id: OwnerMenuId) => {
    switch (id) {
      case OWNER_MENU_IDS.seeMap:
        requestTeamPage({
          workspace: target.workspace,
          project: target.project,
          view: "owner-map",
        });
        return;
      case OWNER_MENU_IDS.set:
        openOwnerDialog({ kind: "set", ...target });
        return;
      case OWNER_MENU_IDS.handOver:
        openOwnerDialog({ kind: "hand-over", ...target });
        return;
      case OWNER_MENU_IDS.giveBack: {
        const key = `${environmentId}:${target.workspace}:${target.project}:${target.task}`;
        if (giving.has(key)) return;
        giving.add(key);
        void runAtomCommand(
          appAtomRegistry,
          serverEnvironment.peerOwnership.setTaskOwner,
          {
            environmentId,
            input: {
              workspace: target.workspace,
              project: target.project,
              task: target.task,
              owner: null,
              op: randomUUID(),
            },
          },
          { reportFailure: false },
        )
          .then((result) => {
            reportFailure("Could not give the task back", result);
          })
          .finally(() => giving.delete(key));
      }
    }
  };
  return [
    ...ownerMenuChoices(facts.actions),
    { id: OWNER_MENU_IDS.seeMap, label: SEE_MAP_LABEL },
  ].map(({ id, label }, index) => ({
    item: { id, label, ...(index === 0 ? { separatorBefore: true } : {}) },
    run: () => run(id),
  }));
}
