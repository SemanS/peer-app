import { mcpConnectMessage, orderMcpClients } from "@t3tools/client-runtime/peer/mcp";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { PeerMcpClient } from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsRow } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { SettingsRowError } from "../PeerSettingsRows";
import type { PeerSlotProps } from "../slots.types";
import { mcpAtoms } from "./atoms";

const NO_INPUT = {};

export function McpSettings({ environmentId, status }: PeerSlotProps) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; entry?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const clients = useEnvironmentQuery(
    status.mcp === undefined ? null : mcpAtoms.clients({ environmentId, input: NO_INPUT }),
  );
  const connect = useAtomCommand(mcpAtoms.connect, { reportFailure: false });
  const disconnect = useAtomCommand(mcpAtoms.disconnect, { reportFailure: false });
  if (status.mcp === undefined) return null;
  const command = status.mcp.command;

  const change = async (client: PeerMcpClient, kind: "connect" | "disconnect") => {
    setBusy(client.id);
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
      setBusy(null);
    }
  };

  return (
    <SettingsRow
      title="Use Peer from your editor"
      description="Connect an editor or agent and it gets Peer's coordination tools for the folder it opens, while Peer runs. Claude Code and Codex use Peer hooks and need nothing here."
      status={
        error !== null ? (
          <SettingsRowError>{error}</SettingsRowError>
        ) : clients.error !== null ? (
          <SettingsRowError>{clients.error}</SettingsRowError>
        ) : null
      }
      control={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            void navigator.clipboard
              .writeText(command)
              .catch(() => setError("Could not copy the command. Select and copy it below."));
          }}
        >
          Copy command
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-3">
        {clients.data === null ? (
          <p role="status" className="text-xs text-muted-foreground">
            {clients.isPending ? "Looking for editors…" : null}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {orderMcpClients(clients.data.clients).map((client) => (
              <li key={client.id} className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    {client.title}
                    <Badge variant={client.installed ? "success" : "outline"} size="sm">
                      {client.installed ? "Installed" : "Not found"}
                    </Badge>
                  </span>
                  {client.user === undefined ? null : (
                    <code className="truncate font-mono text-xs text-muted-foreground">
                      {client.user.path}
                    </code>
                  )}
                </div>
                {client.user === undefined ? null : (
                  <Button
                    variant={client.user.connected ? "outline" : "default"}
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void change(client, client.user?.connected ? "disconnect" : "connect")
                    }
                  >
                    {client.user.connected ? "Disconnect" : "Connect"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {note === null ? null : (
          <div role="status" className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>{note.text}</p>
            {note.entry === undefined ? null : (
              <pre className="font-mono break-all whitespace-pre-wrap select-all">{note.entry}</pre>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Any other MCP client runs this command, from the folder it works in:
        </p>
        <code className="block font-mono text-xs break-all text-muted-foreground select-all">
          {command}
        </code>
      </div>
    </SettingsRow>
  );
}
