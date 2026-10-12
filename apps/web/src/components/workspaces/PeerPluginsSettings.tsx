import { useState } from "react";

import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { SettingsRow } from "../settings/settingsLayout";
import { pluginRows, type PluginRow } from "./PeerPluginsSettings.logic";
import type { PeerSlotProps } from "./slots.types";
import { usePeerPluginControl } from "./usePeerPluginControl";

function PluginState({ row }: { readonly row: PluginRow }) {
  return row.state === "on" ? (
    <Badge variant="success">On</Badge>
  ) : row.state === "off" ? (
    <Badge variant="outline">Off</Badge>
  ) : row.state === "waiting" ? (
    <Badge variant="outline">Waits for a Hub</Badge>
  ) : (
    <Badge variant="warning">Needs a newer Hub</Badge>
  );
}

/**
 * Settings → Peer → Coordination & plugins: turn each of an environment's Peer features off or on. The
 * choice belongs to the environment and applies at once; only its owner gets the switches. An
 * environment that lists no plugins has none to turn.
 */
export function PeerPluginsSettings({ environmentId, status }: PeerSlotProps) {
  return status.plugins === undefined || status.plugins.length === 0 ? null : (
    <PluginRows environmentId={environmentId} status={status} />
  );
}

function PluginRows({ environmentId, status }: PeerSlotProps) {
  const { owner, change } = usePeerPluginControl(environmentId);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = pluginRows(status.plugins ?? [], { owner, pending, signedIn: status.signedIn });
  if (rows.length === 0) return null;

  const toggle = (row: PluginRow, enabled: boolean) => {
    setPending(row.id);
    setError(null);
    void change(row.id, enabled)
      .then((failure) => {
        if (failure !== null) setError(`Could not change ${row.title}: ${failure}`);
      })
      .finally(() => setPending(null));
  };

  return (
    <>
      <SettingsRow
        title="Peer plugins"
        description="Turn Peer’s features off or on for this environment. A change applies at once, and turning one off also undoes what it set up outside Peer."
      />
      {rows.map((row) => (
        <SettingsRow
          key={row.id}
          title={<span className="pl-4 text-muted-foreground">{row.title}</span>}
          description={
            row.note === null && row.error === null ? undefined : (
              <>
                {row.note}
                {row.note !== null && row.error !== null ? " " : null}
                {row.error === null ? null : <span className="text-destructive">{row.error}</span>}
              </>
            )
          }
          control={
            row.control === "switch" ? (
              <Switch
                checked={row.on}
                disabled={row.busy || row.locked}
                aria-label={`Use ${row.title} on this environment`}
                onCheckedChange={(checked) => toggle(row, checked)}
              />
            ) : (
              <PluginState row={row} />
            )
          }
        />
      ))}
      {error === null ? null : (
        <SettingsRow title="Could not change a plugin" description={error} />
      )}
    </>
  );
}
