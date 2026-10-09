import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../../components/AppText";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
export function PeerMcpSettings({ status }: PeerSectionProps) {
  const [error, setError] = useState<string | null>(null);
  if (status.mcp === undefined) return null;
  const command = status.mcp.command;
  return (
    <SettingsSection title="Coordination tools (MCP)">
      <View className="gap-3 p-4">
        <Text selectable className="text-foreground">
          {command}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError(null);
            void Clipboard.setStringAsync(command).catch(() =>
              setError("Could not copy the command. Select and copy it above."),
            );
          }}
        >
          <Text className="text-primary">Copy command</Text>
        </Pressable>
        <Text className="text-foreground-muted">
          Peer threads of Cursor, Grok, OpenCode and Antigravity get these tools automatically.
          Claude Code and Codex use the Mod and hooks instead.
        </Text>
        {error === null ? null : (
          <Text accessibilityRole="alert" className="text-foreground">
            {error}
          </Text>
        )}
      </View>
    </SettingsSection>
  );
}
