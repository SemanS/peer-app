import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { withFinally } from "~/lib/withFinally";
import { SettingsRow } from "../../settings/settingsLayout";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Switch } from "../../ui/switch";
import { SettingsRowError } from "../PeerSettingsRows";
import type { PeerSlotProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";
import { RESUME_ROW, resumeEnabled } from "./settle.logic";

/**
 * Whether this computer resumes an ended agent once to close its open overlap. Turning it off
 * stops the next resumption, not one already running.
 */
export function ResumeControl({ environmentId, status }: PeerSlotProps) {
  const change = useAtomCommand(serverEnvironment.peerSettleSetResume, { reportFailure: false });
  // Resuming runs agents headless, so the switch needs the scope that starts them.
  const allowed = useAtomValue(serverEnvironment.peerSettleSetResume.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function turn(enabled: boolean) {
    setBusy(true);
    setError(null);
    await withFinally(
      async () => {
        setError(failureMessage(await change({ environmentId, input: { enabled } })));
      },
      () => {
        setBusy(false);
      },
    );
  }

  return (
    <SettingsRow
      title={RESUME_ROW.title}
      description={RESUME_ROW.description}
      status={error === null ? null : <SettingsRowError>{error}</SettingsRowError>}
      control={
        <Switch
          aria-label={RESUME_ROW.title}
          checked={resumeEnabled(status)}
          disabled={busy || !allowed}
          onCheckedChange={(enabled) => void turn(enabled)}
        />
      }
    />
  );
}
