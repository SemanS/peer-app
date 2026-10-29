import type { EnvironmentId, PeerOverlap } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { failureMessage } from "../WorkspaceAccess";
import { withFinally } from "~/lib/withFinally";

/**
 * What a person can do about an overlap: ask its agents to settle it (with a message for both, or
 * none), write a note once nobody is left to ask, or close it themselves once nobody answered or
 * the agents ended. The agents write the agreement.
 */
export function useOverlapActions(environmentId: EnvironmentId, overlap: PeerOverlap) {
  const settle = useAtomCommand(serverEnvironment.peerHubSettleOverlap, { reportFailure: false });
  const resolve = useAtomCommand(serverEnvironment.peerHubResolveOverlap, {
    reportFailure: false,
  });
  const note = useAtomCommand(serverEnvironment.peerHubNoteOverlap, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const scope = { workspace: overlap.workspace, project: overlap.project, overlap: overlap.id };
  const act = async (
    title: string,
    action: () => Promise<AtomCommandResult<unknown, unknown>>,
  ): Promise<boolean> => {
    setBusy(true);
    return withFinally(
      async () => {
        const result = await action();
        const message = failureMessage(result);
        if (message !== null) {
          toastManager.add(stackedThreadToast({ type: "error", title, description: message }));
        }
        return result._tag === "Success";
      },
      () => {
        setBusy(false);
      },
    );
  };
  return {
    busy,
    /** Asks both agents to settle it; true once the hub has the request. */
    ask: (message: string) =>
      act("Could not ask the agents", () =>
        settle({
          environmentId,
          input: { ...scope, ...(message.trim() === "" ? {} : { message: message.trim() }) },
        }),
      ),
    /** Writes a note both people read, when no agent is left to ask. */
    note: (text: string) =>
      act("Could not add the message", () =>
        note({ environmentId, input: { ...scope, text: text.trim() } }),
      ),
    /** Closes it without the agents, recording `resolution` (`overlapCloseResolution`). */
    close: (resolution: string) =>
      act("Could not close the overlap", () =>
        resolve({ environmentId, input: { ...scope, resolution } }),
      ),
  };
}
