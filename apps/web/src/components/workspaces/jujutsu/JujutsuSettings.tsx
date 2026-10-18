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
import { usePeerPluginControl } from "../usePeerPluginControl";
import { jujutsuCard, PROTECTION_ROW, SNAPSHOT_ROW } from "./settings.logic";

/**
 * The Jujutsu workspaces card in Settings › This computer: jj's state in Peer's connection words,
 * what Peer always does, and the one choice a person has, whether agents may rewrite each other's
 * changes.
 */
export function JujutsuSettings({ environmentId, status }: PeerSlotProps) {
  const control = usePeerPluginControl(environmentId);
  const configure = useAtomCommand(serverEnvironment.peerJujutsuConfigure, {
    reportFailure: false,
  });
  const canConfigure = useAtomValue(
    serverEnvironment.peerJujutsuConfigure.permissionAtom(environmentId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plugin = status.plugins?.find((candidate) => candidate.id === "jujutsu");
  const card = jujutsuCard(status.jujutsu, plugin);

  async function turn(enabled: boolean) {
    setBusy(true);
    await withFinally(
      async () => {
        setError(await control.change("jujutsu", enabled));
      },
      () => {
        setBusy(false);
      },
    );
  }

  async function protect(protection: boolean) {
    setBusy(true);
    await withFinally(
      async () => {
        setError(failureMessage(await configure({ environmentId, input: { protection } })));
      },
      () => {
        setBusy(false);
      },
    );
  }

  return (
    <>
      <SettingsRow
        title="Jujutsu workspaces"
        description={card.line}
        status={error === null ? null : <SettingsRowError>{error}</SettingsRowError>}
        control={
          <Switch
            aria-label="Jujutsu workspaces"
            checked={plugin?.enabled ?? false}
            disabled={!control.owner || busy}
            onCheckedChange={(enabled) => void turn(enabled)}
          />
        }
      />
      {card.showRows ? (
        <>
          <SettingsRow
            title={SNAPSHOT_ROW.title}
            description={SNAPSHOT_ROW.description}
            control={<span className="text-sm text-muted-foreground">{SNAPSHOT_ROW.status}</span>}
          />
          <SettingsRow
            title={PROTECTION_ROW.title}
            description={PROTECTION_ROW.description}
            control={
              <Switch
                aria-label={PROTECTION_ROW.title}
                checked={card.protection}
                disabled={!canConfigure || !card.protectionEditable || busy}
                onCheckedChange={(enabled) => void protect(enabled)}
              />
            }
          />
        </>
      ) : null}
    </>
  );
}
