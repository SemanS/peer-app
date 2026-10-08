import type { PeerHubSetCoordinationInput, PeerHubStatus } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SettingsSection } from "../settings/components/SettingsSection";

/**
 * How coordination reaches this environment's agents: Peer Mod for Claude Code, and Peer's hooks
 * for Codex, which need a review in each Codex home before new sessions coordinate.
 */
export function PeerAdapters({
  label,
  status,
  busy,
  message,
  onCoordinate,
}: {
  readonly label: string;
  readonly status: PeerHubStatus;
  readonly busy: boolean;
  /** Why the last change failed, or null. */
  readonly message: string | null;
  readonly onCoordinate: (input: PeerHubSetCoordinationInput) => void;
}) {
  const [codexReviewHome, setCodexReviewHome] = useState<string | null>(null);
  return (
    <>
      <SettingsSection title="Claude Code coordination">
        <View className="gap-2 p-4">
          <Text className="text-foreground-muted">
            Peer Mod needs Claude Code 2.1.291 or newer on {label}. Each running session shows its
            verified coordination level.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            className="py-2"
            onPress={() => onCoordinate({ claudeMod: status.coordination.claudeMod !== true })}
          >
            <Text className="font-t3-medium text-primary-text">
              {status.coordination.claudeMod ? "Disable Peer Mod" : "Enable Peer Mod"}
            </Text>
          </Pressable>
          {message === null ? null : (
            <Text accessibilityRole="alert" className="text-foreground">
              {message}
            </Text>
          )}
        </View>
      </SettingsSection>
      {status.coordination.codexHooks === undefined ? null : (
        <SettingsSection title="Codex coordination">
          <View className="gap-2 p-4">
            <Text className="text-foreground-muted">
              Peer hooks run on {label}. Each configured Codex home needs its own review before new
              sessions can coordinate.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              className="py-2"
              onPress={() => onCoordinate({ enabled: !status.coordination.enabled })}
            >
              <Text className="font-t3-medium text-primary-text">
                {status.coordination.enabled ? "Pause coordination" : "Enable coordination"}
              </Text>
            </Pressable>
            {!status.coordination.codexHooks ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                className="py-2"
                onPress={() => onCoordinate({ codexHooks: true })}
              >
                <Text className="font-t3-medium text-primary-text">Add Peer hooks to Codex</Text>
              </Pressable>
            ) : null}
            {status.coordination.codexHooks ||
            status.coordination.codexHookHomes?.some((home) => home.present) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                className="py-2"
                onPress={() => onCoordinate({ codexHooks: false })}
              >
                <Text className="font-t3-medium text-primary-text">
                  Remove Peer hooks from Codex
                </Text>
              </Pressable>
            ) : null}
            {status.coordination.codexHookHomes?.map((home) => (
              <View key={home.home} className="gap-2">
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setCodexReviewHome(codexReviewHome === home.home ? null : home.home)
                  }
                  className="py-2"
                >
                  <Text className="font-t3-medium text-primary-text">
                    {home.home}:{" "}
                    {!status.coordination.enabled
                      ? "coordination paused"
                      : home.trusted
                        ? "ready for new sessions"
                        : home.installed
                          ? "review Peer hooks"
                          : "hooks missing or changed"}
                  </Text>
                </Pressable>
                {codexReviewHome !== home.home ? null : (
                  <>
                    <Text selectable className="text-foreground-muted">
                      {home.hooksPath}
                    </Text>
                    {home.error === undefined ? null : (
                      <Text className="text-destructive">{home.error}</Text>
                    )}
                    {!home.installed ? (
                      <Text className="text-foreground-muted">
                        Add the current Peer hooks to Codex before reviewing them.
                      </Text>
                    ) : (
                      <>
                        <Text className="text-foreground-muted">
                          These commands run on {label} outside Codex's sandbox. They report agent
                          activity to Peer and coordinate overlapping edits.
                        </Text>
                        {home.hooks.map((hook) => (
                          <Text key={hook.key} selectable className="text-foreground">
                            {hook.event}: {hook.command}
                            {hook.enabled ? "" : " — disabled in Codex"}
                          </Text>
                        ))}
                        {home.hooks.some((hook) => !hook.enabled) ? (
                          <Text className="text-foreground-muted">
                            Enable disabled Peer hooks in Codex before new sessions can coordinate.
                          </Text>
                        ) : null}
                        {home.trusted ? null : (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{
                              disabled: busy || home.hooks.some((hook) => !hook.enabled),
                            }}
                            disabled={busy || home.hooks.some((hook) => !hook.enabled)}
                            className="py-2"
                            onPress={() =>
                              onCoordinate({
                                codexHookApproval: { home: home.home, reviewId: home.reviewId },
                              })
                            }
                          >
                            <Text className="font-t3-medium text-primary-text">
                              Trust these Peer hooks
                            </Text>
                          </Pressable>
                        )}
                      </>
                    )}
                  </>
                )}
              </View>
            ))}
            {message === null ? null : (
              <Text accessibilityRole="alert" className="text-foreground">
                {message}
              </Text>
            )}
          </View>
        </SettingsSection>
      )}
    </>
  );
}
