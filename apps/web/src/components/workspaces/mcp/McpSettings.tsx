import { useState } from "react";
import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { SettingsRowError } from "../PeerSettingsRows";
import type { PeerSlotProps } from "../slots.types";

export function McpSettings({ status }: PeerSlotProps) {
  const [error, setError] = useState<string | null>(null);
  if (status.mcp === undefined) return null;
  return (
    <SettingsRow
      title="Coordination tools (MCP)"
      description="Peer threads of Cursor, Grok, OpenCode and Antigravity get these tools automatically. Claude Code and Codex use the Mod and hooks instead. Another MCP client runs this command."
      status={error === null ? null : <SettingsRowError>{error}</SettingsRowError>}
      control={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            void navigator.clipboard
              .writeText(status.mcp!.command)
              .catch(() => setError("Could not copy the command. Select and copy it below."));
          }}
        >
          Copy command
        </Button>
      }
    >
      <code className="block pb-3 font-mono text-xs break-all text-muted-foreground select-all">
        {status.mcp.command}
      </code>
    </SettingsRow>
  );
}
