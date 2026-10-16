import {
  sentPeerRequests,
  requestOutcome,
  canWithdraw,
  expiresIn,
} from "@t3tools/client-runtime/peer/requests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
export function SentRequests({
  environmentId,
  status,
}: Pick<PeerSectionProps, "environmentId" | "status">) {
  const withdraw = useAtomCommand(serverEnvironment.peerHubWithdrawRequest, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState<string | null>(null),
    [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  // Labels use the local clock when this status renders; no timer repaints the list.
  // oxlint-disable-next-line react/purity -- Expiry is a render-time snapshot; requests status replaces expired rows without a timer.
  const now = Date.now();
  const rows = sentPeerRequests(status);
  return (
    <SettingsSection title="Sent team requests">
      <View className="gap-4 p-4">
        {rows.length === 0 ? (
          <Text className="text-foreground-muted">No sent requests.</Text>
        ) : (
          rows.map(({ workspace, request }) => {
            const expiry = request.status === "pending" ? expiresIn(request, now) : undefined;
            const outcome = requestOutcome(request);
            return (
              <View key={`${workspace}/${request.id}`} className="gap-1">
                <Text className="font-t3-medium text-foreground">
                  {request.title} · {outcome === "dismissed" ? "declined" : outcome}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  {request.recipient} · {workspace}
                </Text>
                {request.reason === undefined ? null : (
                  <Text className="text-sm text-foreground">
                    <Text className="text-sm text-foreground-muted">Their reason: </Text>
                    {request.reason}
                  </Text>
                )}
                {expiry === undefined ? null : (
                  <Text className="text-sm text-foreground-muted">
                    Expires {expiry === "today" || expiry === "tomorrow" ? expiry : `in ${expiry}`}
                  </Text>
                )}
                {canWithdraw(request, status.email) ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy !== null}
                    onPress={() => {
                      setBusy(request.id);
                      setErrors((previous) => {
                        const next = new Map(previous);
                        next.delete(request.id);
                        return next;
                      });
                      void withdraw({
                        environmentId,
                        input: { workspace, projectId: request.project, requestId: request.id },
                      })
                        .then((result) => {
                          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                            const error = squashAtomCommandFailure(result);
                            setErrors((previous) =>
                              new Map(previous).set(
                                request.id,
                                error instanceof Error ? error.message : String(error),
                              ),
                            );
                          }
                        })
                        .finally(() => setBusy(null));
                    }}
                  >
                    <Text className="py-2 text-primary">
                      {busy === request.id ? "Withdrawing…" : "Withdraw"}
                    </Text>
                  </Pressable>
                ) : null}
                {errors.has(request.id) ? (
                  <Text accessibilityRole="alert" className="text-foreground-muted">
                    {errors.get(request.id)}
                  </Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </SettingsSection>
  );
}
