import { useState } from "react";
import { forecastSettings } from "@t3tools/client-runtime/peer-forecast";
import type { PeerSlotProps } from "../slots.types";
import { SettingsRow } from "../../settings/settingsLayout";
import { Switch } from "../../ui/switch";
import { usePeerPluginControl } from "../usePeerPluginControl";
import { useAtomCommand } from "../../../state/use-atom-command";
import { serverEnvironment } from "../../../state/server";
import { failureMessage } from "../WorkspaceAccess";
import { SettingsRowError } from "../PeerSettingsRows";
import { useForecast } from "./useForecast";
export function ForecastSettings({ environmentId, status }: PeerSlotProps) {
  const { value } = useForecast(environmentId, status),
    control = usePeerPluginControl(environmentId),
    configure = useAtomCommand(serverEnvironment.peerForecastConfigure, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    plugin = status.plugins?.find((p) => p.id === "forecast");
  async function change(enabled: boolean) {
    setBusy(true);
    try {
      setError(await control.change("forecast", enabled));
    } finally {
      setBusy(false);
    }
  }
  async function teammates(enabled: boolean) {
    setBusy(true);
    try {
      setError(failureMessage(await configure({ environmentId, input: { teammates: enabled } })));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SettingsRow
        title="Merge conflict forecast"
        description={forecastSettings(value).join(" ")}
        status={error ? <SettingsRowError>{error}</SettingsRowError> : null}
        control={
          <Switch
            aria-label="Merge conflict forecast"
            checked={plugin?.enabled ?? false}
            disabled={!control.owner || busy}
            onCheckedChange={(enabled) => void change(enabled)}
          />
        }
      />
      {plugin?.active ? (
        <SettingsRow
          title="Forecast teammates’ branches"
          description="Fetch only the named branches from origin. Forecasts use committed tips and stay on this computer."
          control={
            <Switch
              aria-label="Forecast teammates’ branches"
              checked={value !== "unavailable" && value.teammates}
              disabled={!control.owner || busy || value === "unavailable" || value.state !== "on"}
              onCheckedChange={(enabled) => void teammates(enabled)}
            />
          }
        />
      ) : null}
    </>
  );
}
