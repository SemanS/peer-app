import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsRow } from "../../settings/settingsLayout";
import { Switch } from "../../ui/switch";
import { SettingsRowError } from "../PeerSettingsRows";
import type { PeerSlotProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";

const TITLE = "Share my agents' work in progress";

/** Whether the moments a room pins of this computer's agents' work go to origin. Off by default. */
export function RoomSharingSettings({ environmentId, status }: PeerSlotProps) {
  const shareWork = useAtomCommand(serverEnvironment.peerRooms.shareWork, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.peerRooms.shareWork.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = status.rooms?.shareWork === true;
  const change = async (share: boolean) => {
    setBusy(true);
    setError(failureMessage(await shareWork({ environmentId, input: { share } })));
    setBusy(false);
  };
  return (
    <SettingsRow
      title={TITLE}
      description="In a Jujutsu checkout, each message an agent posts in a room pins the work as it stood. On: Peer pushes those pins to refs/peer/snapshots/* on origin, so teammates can open them. Off: new pins stay on this computer, and what was pushed stays on origin."
      status={
        error !== null ? (
          <SettingsRowError>{error}</SettingsRowError>
        ) : on ? (
          <p role="note" className="text-xs text-warning-foreground">
            Code leaves this computer while your agents work. Everyone who can read origin can read
            these refs. jj never imports refs/peer/*, so nobody's bookmarks move.
          </p>
        ) : null
      }
      control={
        <Switch
          aria-label={TITLE}
          checked={on}
          disabled={!allowed || busy}
          onCheckedChange={(share) => void change(share)}
        />
      }
    />
  );
}
