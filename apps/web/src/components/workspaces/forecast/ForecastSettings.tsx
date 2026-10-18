import { useState } from "react";
import { forecastSettings } from "@t3tools/client-runtime/peer-forecast";
import type { PeerForecastConfigure } from "@t3tools/contracts";
import type { PeerSlotProps } from "../slots.types";
import { computerKinds, forecastTeammatesWords } from "../vcsWords";
import { SettingsRow, useRelativeTimeTick } from "../../settings/settingsLayout";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { usePeerPluginControl } from "../usePeerPluginControl";
import { useAtomCommand } from "../../../state/use-atom-command";
import { serverEnvironment } from "../../../state/server";
import { failureMessage } from "../WorkspaceAccess";
import { SettingsRowError } from "../PeerSettingsRows";
import { checkCommandDraft } from "./integration.logic";
import { useForecast } from "./useForecast";
import { withFinally } from "~/lib/withFinally";
export function ForecastSettings({ environmentId, status }: PeerSlotProps) {
  const { value } = useForecast(environmentId, status),
    now = useRelativeTimeTick(30_000),
    control = usePeerPluginControl(environmentId),
    configure = useAtomCommand(serverEnvironment.peerForecastConfigure, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [draftError, setDraftError] = useState<string | null>(null),
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
  async function save(input: PeerForecastConfigure) {
    setBusy(true);
    setError(failureMessage(await configure({ environmentId, input })));
    setBusy(false);
  }
  const available = value !== "unavailable" && value.state === "on",
    shareWip = available && value.shareWip === true,
    command = available ? (value.check ?? "") : "";
  function commit(text: string) {
    const draft = checkCommandDraft(text);
    setDraftError(draft.error);
    if (draft.error === null && draft.value !== command) void save({ check: draft.value });
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
      {plugin?.active ? (
        <>
          <SettingsRow
            title="Share my agents' work in progress"
            description="In a Jujutsu checkout, Peer pushes each agent's working-copy change to refs/peer/wip/<bookmark> on origin, at most every 2 minutes, and deletes it when the session ends. Off: teammates see your pushed versions only."
            status={
              shareWip ? (
                <p role="note" className="text-xs text-warning-foreground">
                  Code leaves this computer while your agents work. Everyone who can read origin can
                  read these refs. jj never imports refs/peer/*, so nobody's bookmarks move.
                </p>
              ) : null
            }
            control={
              <Switch
                aria-label="Share my agents' work in progress"
                checked={shareWip}
                disabled={!control.owner || busy || !available}
                onCheckedChange={(enabled) => void save({ shareWip: enabled })}
              />
            }
          />
          <SettingsRow
            title="Check command"
            description="Runs on each clean merge, in a throwaway change, with jj run. It runs teammates' code on this computer, and a check never stops a push. Empty: no check."
            status={draftError === null ? null : <SettingsRowError>{draftError}</SettingsRowError>}
            control={
              <Input
                key={command}
                aria-label="Check command"
                className="w-64"
                font="mono"
                size="sm"
                placeholder="npm test"
                defaultValue={command}
                disabled={!control.owner || busy || !available}
                onBlur={(event) => commit(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit(event.currentTarget.value);
                }}
              />
            }
          />
        </>
      ) : null}
    </>
  );
}
