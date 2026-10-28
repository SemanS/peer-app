import {
  threadPlace,
  threadRole,
  ROLE_MENU,
  roleMenuItem,
} from "@t3tools/client-runtime/peer/roles";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { serverEnvironment } from "../../../state/server";
import type { ThreadMenuEntry } from "../slots.types";
import { reportFailure } from "../workFeedback";
import type { WorkThreadNode } from "../workTree.logic";

const changing = new Set<string>();

/**
 * Set role: review and Clear role in the menu of a thread of the person's on this computer. The
 * menu reads the status as it is when it opens; a thread the Hub has no report of yet has no
 * project to keep a role in, so it offers neither.
 */
export function roleThreadMenu(
  thread: WorkThreadNode,
  environmentId: EnvironmentId | null,
): ReadonlyArray<ThreadMenuEntry> {
  if (environmentId === null) return [];
  const status = Option.getOrNull(
    AsyncResult.value(
      appAtomRegistry.get(serverEnvironment.peerHubLive({ environmentId, input: {} })),
    ),
  );
  const role = threadRole(status, thread);
  const item = roleMenuItem(thread, role);
  const place = threadPlace(status, thread.key);
  if (item === null || place === undefined) return [];
  const command =
    item === ROLE_MENU.set ? serverEnvironment.peerRoles.set : serverEnvironment.peerRoles.clear;
  if (!appAtomRegistry.get(command.permissionAtom(environmentId))) return [];
  return [
    {
      item: { id: item.id, label: item.label },
      place: "end",
      run: () => {
        const key = `${environmentId}:${thread.key}`;
        if (changing.has(key)) return;
        changing.add(key);
        const input = { ...place, thread: thread.key };
        void (
          item === ROLE_MENU.set
            ? runAtomCommand(
                appAtomRegistry,
                serverEnvironment.peerRoles.set,
                { environmentId, input: { ...input, role: "review" } },
                { reportFailure: false },
              ).then((result) => reportFailure("Could not set the role", result))
            : runAtomCommand(
                appAtomRegistry,
                serverEnvironment.peerRoles.clear,
                { environmentId, input },
                { reportFailure: false },
              ).then((result) => reportFailure("Could not clear the role", result))
        ).finally(() => changing.delete(key));
      },
    },
  ];
}
