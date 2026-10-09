import { useState } from "react";
import { SettingsRow, SettingsSection } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import type { PeerSlotProps } from "../slots.types";

export function McpSettings({ status }: PeerSlotProps) {
  const [error, setError] = useState<string | null>(null);
  if (status.mcp === undefined) return null;
  return (
    <SettingsSection title="Coordination tools (MCP)">
      <SettingsRow
        title="Command for an MCP client"
        description="Peer threads of Cursor, Grok, OpenCode and Antigravity get these tools automatically. Claude Code and Codex use the Mod and hooks instead."
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
        <code className="break-all">{status.mcp.command}</code>
        {error === null ? null : <p role="alert">{error}</p>}
      </SettingsRow>
    </SettingsSection>
  );
}
