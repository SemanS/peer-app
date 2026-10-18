import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PeerAgreementCloseInput } from "@t3tools/contracts";
import { useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { agreementFailure } from "./agreements.logic";
import { withFinally } from "~/lib/withFinally";

/**
 * What a person does with one agreement: close it, or bring back one they closed. The Hub decides:
 * nothing changes on screen until its answer arrives and the agreement is read again (a card leaves
 * Needs you when the status says the agreement is no longer due), and a refusal or a failure stays
 * beside the agreement, with its reason, so the person can try again. While one is on its way the
 * agreement's controls are off.
 */
export function useAgreementActions(input: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly id: string;
  /** The agreements are read again: after the Hub changed one, or refused because one changed. */
  readonly onChanged: () => void;
}) {
  const { environmentId, workspace, project, id, onChanged } = input;
  const closeAgreement = useAtomCommand(serverEnvironment.peerAgreementsClose, {
    reportFailure: false,
  });
  const reopenAgreement = useAtomCommand(serverEnvironment.peerAgreementsReopen, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (command: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setBusy(true);
    setError(null);
    await withFinally(
      async () => {
        const result = await command();
        const failure = agreementFailure(result);
        setError(failure?.message ?? null);
        if (result._tag === "Success" || failure?.stale === true) onChanged();
      },
      () => {
        setBusy(false);
      },
    );
  };
  return {
    busy,
    error,
    close: (why: PeerAgreementCloseInput["why"]) =>
      run(() => closeAgreement({ environmentId, input: { workspace, project, id, why } })),
    reopen: () => run(() => reopenAgreement({ environmentId, input: { workspace, project, id } })),
  };
}
