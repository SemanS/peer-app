import { useAtomValue } from "@effect/atom-react";
import {
  activePlugin,
  canChangePeerPlugins,
  inactivePluginReason,
} from "@t3tools/client-runtime/peer/plugins";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PeerHubStatus, PeerPluginId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "../settings/components/SettingsScreen";

/** A saved plugin link remains usable when its feature is off; only an owner can enable it. */
export function PluginOff({
  environmentId,
  plugin,
  title,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly plugin: PeerPluginId;
  readonly title: string;
  readonly status: Pick<PeerHubStatus, "plugins"> | null;
}) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const owner = canChangePeerPlugins(session);
  const command = useAtomCommand(serverEnvironment.peerHubSetPlugin, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = inactivePluginReason(status, plugin);
  const text =
    reason === "off"
      ? "is turned off on this environment."
      : reason === "hub"
        ? "needs a newer Peer Hub."
        : "is not available on this environment.";
  return (
    <View className="gap-3">
      <Text accessibilityLiveRegion="polite" className="text-foreground">
        {title} {text}
      </Text>
      {owner && reason === "off" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          className="py-2"
          onPress={() => {
            setBusy(true);
            setError(null);
            void command({ environmentId, input: { id: plugin, enabled: true } })
              .then((result) => {
                if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                  const failure = squashAtomCommandFailure(result);
                  setError(failure instanceof Error ? failure.message : String(failure));
                }
              })
              .finally(() => setBusy(false));
          }}
        >
          <Text className="text-primary">{busy ? "Turning on…" : `Turn on ${title}`}</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Children mount only while active, so inactive screens make no feature query. */
export function PeerPluginGate({
  environmentId,
  plugin,
  title,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly plugin: PeerPluginId;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const query = useEnvironmentQuery(serverEnvironment.peerHubLive({ environmentId, input: {} }));
  if (!query.error && activePlugin(query.data, plugin)) return children;
  return (
    <SettingsScreen title={title}>
      <View className="gap-3 p-5">
        {query.error ? (
          <Text accessibilityRole="alert" className="text-destructive">
            {query.error}
          </Text>
        ) : !query.data ? (
          <Text className="text-foreground-muted">Checking workspace access…</Text>
        ) : (
          <PluginOff
            environmentId={environmentId}
            plugin={plugin}
            title={title}
            status={query.data}
          />
        )}
      </View>
    </SettingsScreen>
  );
}
