import { mcpConnectMessage, orderMcpClients } from "@t3tools/client-runtime/peer/mcp";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { PeerMcpClient } from "@t3tools/contracts";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
import { mcpAtoms } from "./atoms";

const NO_INPUT = {};

export function PeerMcpSettings({ environmentId, status }: PeerSectionProps) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; entry?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const clients = useEnvironmentQuery(
    status.mcp === undefined ? null : mcpAtoms.clients({ environmentId, input: NO_INPUT }),
  );
  const connect = useAtomCommand(mcpAtoms.connect, { reportFailure: false });
  const disconnect = useAtomCommand(mcpAtoms.disconnect, { reportFailure: false });
  if (status.mcp === undefined) return null;
  const command = status.mcp.command;

  const change = async (client: PeerMcpClient, kind: "connect" | "disconnect") => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const run = kind === "connect" ? connect : disconnect;
      const result = await run({ environmentId, input: { client: client.id, scope: "user" } });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
        return;
      }
      setNote({
        text: mcpConnectMessage(kind, client.title, result.value),
        ...(result.value.outcome === "manual" ? { entry: result.value.entry } : {}),
      });
      clients.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Use Peer from your editor">
      <View className="gap-3 p-4">
        <Text className="text-foreground-muted">
          Connect an editor or agent on that computer and it gets Peer's coordination tools for the
          folder it opens, while Peer runs. Claude Code and Codex use Peer hooks instead.
        </Text>
        {clients.data === null ? (
          <Text className="text-foreground-muted">
            {clients.error ?? (clients.isPending ? "Looking for editors…" : "")}
          </Text>
        ) : (
          orderMcpClients(clients.data.clients).map((client) => (
            <View key={client.id} className="flex-row items-center gap-3">
              <View className="flex-1">
                <Text className="text-foreground">{client.title}</Text>
                <Text className="text-sm text-foreground-muted">
                  {client.installed ? "Installed" : "Not found"}
                  {client.user === undefined ? "" : ` · ${client.user.path}`}
                </Text>
              </View>
              {client.user === undefined ? null : (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() =>
                    void change(client, client.user?.connected ? "disconnect" : "connect")
                  }
                >
                  <Text className="text-primary">
                    {client.user.connected ? "Disconnect" : "Connect"}
                  </Text>
                </Pressable>
              )}
            </View>
          ))
        )}
        {note === null ? null : (
          <View className="gap-1">
            <Text className="text-foreground">{note.text}</Text>
            {note.entry === undefined ? null : (
              <Text selectable className="text-sm text-foreground-muted">
                {note.entry}
              </Text>
            )}
          </View>
        )}
        <Text className="text-foreground-muted">Any other MCP client runs this command:</Text>
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
        {error === null ? null : (
          <Text accessibilityRole="alert" className="text-foreground">
            {error}
          </Text>
        )}
      </View>
    </SettingsSection>
  );
}
