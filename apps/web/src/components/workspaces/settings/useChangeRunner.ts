import type { PeerSettingsChangeResult } from "@t3tools/contracts";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { failureMessage } from "../WorkspaceAccess";
import { usePeerSettings } from "./PeerSettingsContext";
import type { ChangeCall } from "./reviewChanges.logic";

/** What a change came to: the Hub's answer, or why it could not be had. */
export type ChangeOutcome =
  | { readonly ok: true; readonly result: PeerSettingsChangeResult }
  | { readonly ok: false; readonly message: string };

/**
 * Runs the call a review makes (`changeCall`) on this environment. The Hub's refusals that a person
 * settles (a conflict, a path they may not change, a configuration that does not check) arrive as
 * results; anything else is a message, since the review shows it where it happened.
 */
export function useChangeRunner() {
  const { environmentId } = usePeerSettings();
  const options = { reportFailure: false };
  const preview = useAtomCommand(serverEnvironment.peerSettings.preview, options);
  const save = useAtomCommand(serverEnvironment.peerSettings.save, options);
  const revert = useAtomCommand(serverEnvironment.peerSettings.revert, options);
  const importYaml = useAtomCommand(serverEnvironment.peerSettings.importYaml, options);
  const applyProposal = useAtomCommand(serverEnvironment.peerSettings.applyProposal, options);
  const githubDisable = useAtomCommand(serverEnvironment.peerSettings.githubDisable, options);
  return async (call: ChangeCall): Promise<ChangeOutcome> => {
    const settled = await (() => {
      switch (call.command) {
        case "preview":
          return preview({ environmentId, input: call.input });
        case "save":
          return save({ environmentId, input: call.input });
        case "revert":
          return revert({ environmentId, input: call.input });
        case "importYaml":
          return importYaml({ environmentId, input: call.input });
        case "applyProposal":
          return applyProposal({ environmentId, input: call.input });
        case "githubDisable":
          return githubDisable({ environmentId, input: call.input });
      }
    })();
    if (settled._tag === "Success") return { ok: true, result: settled.value };
    return { ok: false, message: failureMessage(settled) ?? "The request was interrupted." };
  };
}
