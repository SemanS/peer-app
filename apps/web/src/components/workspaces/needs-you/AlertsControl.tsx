import { alertsControlState } from "@t3tools/client-runtime/peer/needs-you";
import { AuthAccessWriteScope } from "@t3tools/contracts";
import { useState } from "react";
import { Switch } from "../../ui/switch";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { usePeerPluginControl } from "../usePeerPluginControl";
import { failureMessage } from "../WorkspaceAccess";
import type { PeerSlotProps } from "../slots.types";
export function AlertsControl({ environmentId, status }: PeerSlotProps) {
  const { owner } = usePeerPluginControl(environmentId);
  const state = alertsControlState(status, owner ? [AuthAccessWriteScope] : []);
  const change = useAtomCommand(serverEnvironment.peerNeedsYouSetAlerts, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (state.state === "hidden") return null;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Phone alerts</h3>
          <p className="text-xs text-muted-foreground">{state.explanation}</p>
        </div>
        <Switch
          aria-label="Phone alerts"
          checked={state.enabled}
          disabled={busy || state.disabled}
          onCheckedChange={(enabled) => {
            setBusy(true);
            setError(null);
            void change({ environmentId, input: { enabled } })
              .then((result) => setError(failureMessage(result)))
              .finally(() => setBusy(false));
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
