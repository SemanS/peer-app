import { herdrAttachOffer, herdrRuntimeLabel } from "@t3tools/client-runtime/peer/herdr";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { PeerHerdrIntegration } from "@t3tools/contracts";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
import {
  herdrIntegrationConfirmation,
  herdrIntegrationRow,
  herdrRestartConfirmation,
  herdrRuntimeActions,
  herdrRuntimeNotes,
  herdrTurnOffConfirmation,
  type HerdrConfirmation,
} from "./herdrRuntime.logic";

function confirmThen(
  confirmation: HerdrConfirmation | null,
  destructive: boolean,
  run: () => void,
) {
  if (confirmation === null) return run();
  Alert.alert(confirmation.title, confirmation.message, [
    { text: "Cancel", style: "cancel" },
    { text: confirmation.confirm, style: destructive ? "destructive" : "default", onPress: run },
  ]);
}

/**
 * Which herdr serves the environment, its state, and the owner's controls over Peer's own herdr.
 * A phone cannot open a terminal on the computer, so it always shows the command to attach one.
 */
export function HerdrRuntimeSection({ environmentId, status }: PeerSectionProps) {
  const setRuntime = useAtomCommand(serverEnvironment.peerHerdrSetRuntime, {
    reportFailure: false,
  });
  const restartRuntime = useAtomCommand(serverEnvironment.peerHerdrRestartRuntime, {
    reportFailure: false,
  });
  const setIntegration = useAtomCommand(serverEnvironment.peerHerdrSetIntegration, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const herdr = status.herdr;
  // A server from before the runtime reports none: nothing to show or control.
  if (herdr === undefined) return null;
  const { runtime } = herdr;
  const actions = herdrRuntimeActions(herdr);
  const notes = herdrRuntimeNotes(runtime);
  const attach = herdrAttachOffer(status, false) === "copy" ? runtime.attachCommand : undefined;

  const perform = (command: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setBusy(true);
    setError(null);
    void command()
      .then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => setBusy(false));
  };
  const integrationAction = (integration: PeerHerdrIntegration, installed: boolean) =>
    confirmThen(herdrIntegrationConfirmation(integration, installed), !installed, () =>
      perform(() =>
        setIntegration({ environmentId, input: { agent: integration.agent, installed } }),
      ),
    );

  return (
    <SettingsSection title="herdr">
      <View className="gap-3 p-4">
        <Text className="text-foreground">{herdrRuntimeLabel(status)}</Text>
        {runtime.state === "failed" && runtime.log !== undefined ? (
          <Text selectable className="text-sm text-foreground-muted">
            Log: {runtime.log}
          </Text>
        ) : null}
        {notes.map((note) => (
          <Text key={note} className="text-sm text-foreground-muted">
            {note}
          </Text>
        ))}
        {actions.power === null ? null : (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              const on = actions.power === "turn-on";
              confirmThen(
                on
                  ? null
                  : herdrTurnOffConfirmation(
                      runtime,
                      status.agents.list.map((agent) => agent.title),
                    ),
                true,
                () => perform(() => setRuntime({ environmentId, input: { on } })),
              );
            }}
          >
            <Text className="text-primary">
              {actions.power === "turn-on" ? "Turn on" : "Turn off"}
            </Text>
          </Pressable>
        )}
        {actions.restart ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              confirmThen(herdrRestartConfirmation(runtime), true, () =>
                perform(() => restartRuntime({ environmentId, input: {} })),
              )
            }
          >
            <Text className="text-primary">Restart</Text>
          </Pressable>
        ) : null}
        {attach === undefined ? null : (
          <View className="gap-2">
            <Text className="text-sm text-foreground-muted">
              Run this on the computer to attach a terminal to Peer's herdr:
            </Text>
            <Text selectable className="text-foreground">
              {attach}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setError(null);
                void Clipboard.setStringAsync(attach).catch(() =>
                  setError("Could not copy the command. Select and copy it above."),
                );
              }}
            >
              <Text className="text-primary">Copy command</Text>
            </Pressable>
          </View>
        )}
        {herdr.integrations.map((integration) => {
          const row = herdrIntegrationRow(integration);
          return (
            <View key={integration.agent} className="gap-1">
              <Text className="text-foreground">
                {row.name} · {row.stateText}
              </Text>
              <View className="flex-row gap-4">
                {row.install === null ? null : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => integrationAction(integration, true)}
                  >
                    <Text className="text-primary">{row.install}</Text>
                  </Pressable>
                )}
                {row.remove ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => integrationAction(integration, false)}
                  >
                    <Text className="text-primary">Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
        {error === null ? null : (
          <Text accessibilityRole="alert" className="text-destructive">
            {error}
          </Text>
        )}
      </View>
    </SettingsSection>
  );
}
