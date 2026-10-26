import type { EnvironmentId, PeerFounding, PeerHubStatus } from "@t3tools/contracts";
import { foundingWords, pendingFoundings } from "@t3tools/client-runtime/peer-organizations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * Organizations a hub administrator founded for the signed-in person, with Accept and Decline:
 * the same offer web and desktop make. An expired one can only be declined.
 */
export function PeerFoundings({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  const foundings = pendingFoundings(status);
  if (foundings.length === 0) return null;
  return (
    <View className="gap-3">
      {foundings.map((founding) => (
        <FoundingRow key={founding.slug} environmentId={environmentId} founding={founding} />
      ))}
    </View>
  );
}

function FoundingRow({
  environmentId,
  founding,
}: {
  readonly environmentId: EnvironmentId;
  readonly founding: PeerFounding;
}) {
  const accept = useAtomCommand(serverEnvironment.peerHubAcceptFounding, { reportFailure: false });
  const decline = useAtomCommand(serverEnvironment.peerHubDeclineFounding, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const words = foundingWords(founding, now);
  const answer = (action: "accept" | "decline") => {
    setBusy(true);
    setError(null);
    const command = action === "accept" ? accept : decline;
    void command({ environmentId, input: { slug: founding.slug } })
      .then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => setBusy(false));
  };
  return (
    <View className="gap-2">
      <Text className="font-t3-medium text-foreground">{words.title}</Text>
      <Text className="text-sm text-foreground-muted">{words.detail}</Text>
      <View className="flex-row gap-4">
        {words.expired ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => answer("accept")}
          >
            <Text className="text-primary">Accept</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() =>
            Alert.alert(`Decline ${founding.name}?`, "The offer ends and its name is free again.", [
              { text: "Cancel", style: "cancel" },
              { text: "Decline", style: "destructive", onPress: () => answer("decline") },
            ])
          }
        >
          <Text className="text-foreground-muted">Decline</Text>
        </Pressable>
      </View>
      {error === null ? null : (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      )}
    </View>
  );
}
