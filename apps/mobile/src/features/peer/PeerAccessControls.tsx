import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

export function PeerAccessControls({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  const signOut = useAtomCommand(serverEnvironment.peerHubSignOutEverywhere, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="gap-3">
      {(status.removedFrom ?? []).map((removed) => (
        <Text key={removed.slug} className="text-foreground-muted">
          An admin removed you from {removed.name}. Ask an admin to invite you back.
        </Text>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() =>
          Alert.alert(
            "Sign out everywhere?",
            "Every Peer Hub session ends and your shared-capacity keys in all workspaces are revoked. Local checkouts stay on your computers.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Sign out everywhere",
                style: "destructive",
                onPress: () => {
                  setBusy(true);
                  setError(null);
                  void signOut({ environmentId, input: {} })
                    .then((result) => {
                      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                        const cause = squashAtomCommandFailure(result);
                        setError(cause instanceof Error ? cause.message : String(cause));
                      }
                    })
                    .finally(() => setBusy(false));
                },
              },
            ],
          )
        }
      >
        <Text className="text-primary">{busy ? "Signing out…" : "Sign out everywhere"}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
