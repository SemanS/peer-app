import { useState } from "react";
import { forecastSettings } from "@t3tools/client-runtime/peer-forecast";
import type { PeerSlotProps } from "../slots.types";
import { computerKinds, forecastTeammatesWords } from "../vcsWords";
import { SettingsRow, useRelativeTimeTick } from "../../settings/settingsLayout";
import { Switch } from "../../ui/switch";
import { usePeerPluginControl } from "../usePeerPluginControl";
import { useAtomCommand } from "../../../state/use-atom-command";
import { serverEnvironment } from "../../../state/server";
import { failureMessage } from "../WorkspaceAccess";
import { SettingsRowError } from "../PeerSettingsRows";
import { useForecast } from "./useForecast";
import { withFinally } from "~/lib/withFinally";
export function ForecastSettings({ environmentId, status }: PeerSlotProps) {
  const { value } = useForecast(environmentId, status),
    now = useRelativeTimeTick(30_000),
    control = usePeerPluginControl(environmentId),
    configure = useAtomCommand(serverEnvironment.peerForecastConfigure, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    plugin = status.plugins?.find((p) => p.id === "forecast"),
    teammatesWords = forecastTeammatesWords(computerKinds(status));
  async function change(enabled: boolean) {
    setBusy(true);
    await withFinally(
      async () => {
        setError(await control.change("forecast", enabled));
      },
      () => {
        setBusy(false);
      },
    );
  }
  async function teammates(enabled: boolean) {
    setBusy(true);
    await withFinally(
      async () => {
        setError(failureMessage(await configure({ environmentId, input: { teammates: enabled } })));
      },
      () => {
        setBusy(false);
      },
    );
  }
  return (
    <>
      <SettingsRow
        title="Merge conflict forecast"
        description={forecastSettings(value, now, computerKinds(status)).join(" ")}
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
          title={teammatesWords.title}
          description={teammatesWords.description}
          control={
            <Switch
              aria-label={teammatesWords.title}
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
