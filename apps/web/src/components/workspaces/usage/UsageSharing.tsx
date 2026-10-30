import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, PeerUsageSharing } from "@t3tools/contracts";
import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Dialog, DialogPopup } from "../../ui/dialog";
import { Switch } from "../../ui/switch";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
} from "../PeerDialog";
import { PeerCard } from "../PeerPageHeader";
import { SettingsRowError } from "../PeerSettingsRows";
import { failureMessage } from "../WorkspaceAccess";
import {
  SHARING_CONFIRM,
  SHARING_CONFIRM_TITLE,
  SHARING_ERASES,
  SHARING_OFF_NOTE,
  SHARING_SENT,
  SHARING_TITLE,
  sharingErasedText,
  sharingOnNote,
} from "./workspaceUsage.logic";
import { withFinally } from "~/lib/withFinally";

/**
 * The signed-in person's own choice, for every role. The command takes no address, so this switch
 * can only ever act for them. Turning off erases on the Hub, so only that direction asks first.
 */
export function UsageSharingSection({
  environmentId,
  workspace,
  reported,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly reported: boolean;
  readonly onChanged: () => void;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.peerUsageSharing({ environmentId, input: { workspace } }),
  );
  const canChange = useAtomValue(
    serverEnvironment.peerUsageSetSharing.permissionAtom(environmentId),
  );
  const setSharing = useAtomCommand(serverEnvironment.peerUsageSetSharing, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [erased, setErased] = useState<string | null>(null);

  const change = async (sharing: boolean) => {
    setBusy(true);
    setError(null);
    setErased(null);
    await withFinally(
      async () => {
        const result = await setSharing({ environmentId, input: { workspace, sharing } });
        if (result._tag !== "Success") {
          setError(failureMessage(result));
          return;
        }
        setConfirming(false);
        if (!("unsupported" in result.value)) setErased(sharingErasedText(result.value));
        query.refresh();
        onChanged();
      },
      () => {
        setBusy(false);
      },
    );
  };

  const answer: PeerUsageSharing | null =
    query.data === null || "unsupported" in query.data ? null : query.data;
  if (query.data !== null && answer === null) return null;
  const on = answer?.sharing ?? false;
  return (
    <PeerCard aria-label="Your sharing">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id="usage-sharing-title" className="text-sm font-medium text-foreground">
            {SHARING_TITLE}
          </h2>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{SHARING_SENT}</p>
          <p role="status" className="max-w-2xl text-xs leading-relaxed text-foreground">
            {answer === null
              ? null
              : on
                ? `${sharingOnNote(reported)} ${SHARING_ERASES}`
                : SHARING_OFF_NOTE}
          </p>
          {erased === null ? null : (
            <p role="status" className="text-xs text-foreground">
              {erased}
            </p>
          )}
        </div>
        <Switch
          aria-labelledby="usage-sharing-title"
          checked={on}
          disabled={answer === null || busy || query.isPending || !canChange}
          onCheckedChange={(next) => {
            setError(null);
            if (next) void change(true);
            else setConfirming(true);
          }}
        />
      </div>
      {!canChange ? (
        <p className="text-xs text-muted-foreground">
          This connection cannot change sharing. Change it from a computer you own.
        </p>
      ) : null}
      {query.error === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <SettingsRowError>{query.error}</SettingsRowError>
          <Button size="xs" variant="outline" onClick={query.refresh}>
            Try again
          </Button>
        </div>
      )}
      {error === null || confirming ? null : <SettingsRowError>{error}</SettingsRowError>}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogPopup>
          <PeerDialogHeader icon={ShieldCheckIcon} title={SHARING_CONFIRM_TITLE} />
          <PeerDialogBody>
            <p className="text-sm text-muted-foreground">{SHARING_CONFIRM}</p>
            {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
          </PeerDialogBody>
          <PeerDialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Keep sharing
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void change(false)}>
              Turn off and erase
            </Button>
          </PeerDialogFooter>
        </DialogPopup>
      </Dialog>
    </PeerCard>
  );
}
