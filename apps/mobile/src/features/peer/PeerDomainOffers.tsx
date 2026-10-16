import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { describeOffer } from "@t3tools/client-runtime/peer-domain-offers";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

export function PeerDomainOffers({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  const join = useAtomCommand(serverEnvironment.peerHubJoinWorkspace, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="gap-3">
      {(status.domainOffers ?? []).map((offer) => {
        const text = describeOffer(offer);
        return (
          <View key={offer.slug} className="gap-2">
            <Text className="text-muted-foreground">Also list @{offer.domain}</Text>
            <Text className="text-foreground">{text.summary}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                Alert.alert(text.title, text.message, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Join",
                    onPress: () => {
                      setBusy(true);
                      setError(null);
                      void join({
                        environmentId,
                        input: { workspace: offer.slug, confirmDomainMatch: true },
                      })
                        .then((result) => {
                          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                            const cause = squashAtomCommandFailure(result);
                            setError(cause instanceof Error ? cause.message : String(cause));
                          }
                        })
                        .finally(() => setBusy(false));
                    },
                  },
                ])
              }
            >
              <Text className="text-primary">Review {offer.name}</Text>
            </Pressable>
          </View>
        );
      })}
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
