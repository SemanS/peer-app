import type { EnvironmentId } from "@t3tools/contracts";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { reportFailure } from "../workFeedback";

/**
 * Takes back an owner's call the person's own agent opened. The board's card has no room for a
 * reason inline, so a refusal (the call was decided meanwhile) is a toast.
 */
export function useWithdrawOwnerCall(environmentId: EnvironmentId | null) {
  const withdraw = useAtomCommand(serverEnvironment.peerOwnership.withdraw, {
    reportFailure: false,
  });
  return async (call: {
    readonly workspace: string;
    readonly project: string;
    readonly id: string;
  }) => {
    if (environmentId === null) return;
    reportFailure("Could not withdraw the call", await withdraw({ environmentId, input: call }));
  };
}
