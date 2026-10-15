import { useState } from "react";
import {
  impactContactLabel,
  impactControl,
  impactRootLabel,
  impactHubLabel,
} from "@t3tools/client-runtime/peer/impact";
import { SettingsRow, useRelativeTimeTick } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { usePeerPluginControl } from "../usePeerPluginControl";
import { SettingsRowError } from "../PeerSettingsRows";
import { failureMessage } from "../WorkspaceAccess";
import type { PeerSlotProps } from "../slots.types";

export function ImpactSettings({ environmentId, status }: PeerSlotProps) {
  const plugin = status.plugins?.find((p) => p.id === "impact"),
    control = usePeerPluginControl(environmentId),
    setting = impactControl(status.impact, plugin),
    configure = useAtomCommand(serverEnvironment.peerImpactConfigure, { reportFailure: false }),
    now = useRelativeTimeTick(60_000);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!plugin) return null;
  async function change(enabled: boolean) {
    if (!control.owner || setting.locked || busy) return;
    setBusy(true);
    try {
      setError(await control.change("impact", enabled));
    } finally {
      setBusy(false);
    }
  }
  async function index(autoIndex: boolean) {
    if (!control.owner || setting.locked || !plugin?.active || busy) return;
    setBusy(true);
    try {
      setError(failureMessage(await configure({ environmentId, input: { autoIndex } })));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SettingsRow
        title="Impact overlaps"
        description={setting.reason}
        status={error ? <SettingsRowError>{error}</SettingsRowError> : null}
        control={
          <Switch
            aria-label="Impact overlaps"
            checked={setting.on}
            disabled={!control.owner || setting.locked || busy}
            onCheckedChange={(value) => void change(value)}
          />
        }
      />
      <SettingsRow
        title="Index new Peer task worktrees"
        description="Opt in to initialize only newly created Peer task worktrees on this environment. Existing checkouts are never initialized automatically."
        control={
          <Switch
            aria-label="Index new Peer task worktrees"
            checked={status.impact?.autoIndex ?? false}
            disabled={!control.owner || setting.locked || !plugin.active || busy}
            onCheckedChange={(value) => void index(value)}
          />
        }
      />
      <SettingsRow
        title="Hub"
        description={`${impactHubLabel(status.impact)} ${impactContactLabel(status.impact, now)}`}
      />
      {status.impact?.roots.map((root) => (
        <SettingsRow key={root.root} title={root.root} description={impactRootLabel(root)}>
          {root.commands.map((command) => (
            <div key={command} className="flex flex-wrap items-start justify-between gap-2 pb-2">
              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {command}
              </pre>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  setError(null);
                  if (!navigator.clipboard) {
                    setError("Could not copy the command. Select and copy it above.");
                    return;
                  }
                  void navigator.clipboard
                    .writeText(command)
                    .catch(() => setError("Could not copy the command. Select and copy it above."));
                }}
              >
                Copy command
              </Button>
            </div>
          ))}
        </SettingsRow>
      ))}
      {!status.impact?.roots.length ? (
        <SettingsRow
          title="Local checkouts"
          description="No local checkout has been checked yet. Install CodeGraph on the environment hosting your agents and initialize each checkout you want to use."
        />
      ) : null}
    </>
  );
}
