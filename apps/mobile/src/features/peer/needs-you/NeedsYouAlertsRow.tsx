import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { View, Pressable } from "react-native";
import { AppText } from "../../../components/AppText";
import { ThemedSwitch } from "../../../components/ThemedSwitch";
import { environmentSession } from "../../../state/session";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import type { PeerEnvironmentProps } from "../slotTypes";
import { alertsRowState } from "./needsYou.logic";
import { useNeedsYou } from "./useNeedsYou";
export function NeedsYouAlertsRow({ environmentId, label, status }: PeerEnvironmentProps) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId)),
    { environments } = useNeedsYou();
  const state = alertsRowState(
    environmentId,
    environments.map((environment) =>
      environment.environmentId === environmentId ? { ...environment, status } : environment,
    ),
    session?.scopes ?? [],
  );
  const change = useAtomCommand(serverEnvironment.peerNeedsYouSetAlerts, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const toggle = (enabled: boolean) => {
    setBusy(true);
    setError(null);
    void change({ environmentId, input: { enabled } })
      .then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => setBusy(false));
  };
  return (
    <View className="gap-2 rounded-xl bg-card p-4">
      <View className="flex-row items-center gap-4">
        <View className="min-w-0 flex-1 gap-1">
          <AppText className="font-t3-medium text-foreground">Phone alerts · {label}</AppText>
          <AppText className="text-sm text-foreground-muted">{state.explanation}</AppText>
        </View>
        {state.state === "hidden" ? null : (
          <ThemedSwitch
            accessibilityLabel={`Phone alerts on ${label}`}
            value={state.enabled}
            disabled={busy || state.disabled}
            onValueChange={toggle}
          />
        )}
      </View>
      {state.duplicates.length > 0 ? (
        <>
          <AppText accessibilityRole="alert" className="text-sm text-foreground-muted">
            Phone alerts are also on for{" "}
            {state.duplicates.map((environment) => environment.label).join(", ")}. Turn them on for
            one computer to avoid duplicate alerts.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || state.disabled }}
            disabled={busy || state.disabled}
            onPress={() => toggle(false)}
          >
            <AppText className="text-primary">Turn off alerts on {label}</AppText>
          </Pressable>
        </>
      ) : null}
      {error ? (
        <AppText accessibilityRole="alert" className="text-destructive">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
