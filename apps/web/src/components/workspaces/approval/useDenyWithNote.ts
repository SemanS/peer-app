import type {
  EnvironmentId,
  ProviderApprovalDecision,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { newMessageId } from "../../../lib/utils";
import { readThreadShell } from "../../../state/entities";
import { threadEnvironment } from "../../../state/threads";
import { useAtomCommand } from "../../../state/use-atom-command";
import { denyWithNote } from "./approval.logic";
import { usePeerThread } from "./usePeerThread";

/**
 * Deny with a note, for a thread in a Peer workspace project: declines through the composer's own
 * handler, then sends the note as the person's next message the way the composer sends one
 * (dispatched automatically: queued or steered while a turn runs). Undefined elsewhere.
 */
export function useDenyWithNote(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  respond: (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => Promise<unknown>,
) {
  const peer = usePeerThread(environmentId, threadId);
  const startTurn = useAtomCommand(threadEnvironment.startTurn);
  if (peer === null || threadId === null) return undefined;
  return (requestId: RuntimeRequestId, note: string) =>
    denyWithNote(note, {
      decline: async () => {
        const result = await respond(requestId, "decline");
        return !(
          typeof result === "object" &&
          result !== null &&
          "_tag" in result &&
          result._tag === "Failure"
        );
      },
      send: async (text) => {
        const shell = readThreadShell(scopeThreadRef(environmentId, threadId));
        if (shell === null) return;
        await startTurn({
          environmentId,
          input: {
            threadId,
            message: { messageId: newMessageId(), role: "user", text, attachments: [] },
            runtimeMode: shell.runtimeMode,
            interactionMode: shell.interactionMode,
            dispatchMode: "auto",
          },
        });
      },
    }).then(() => undefined);
}
