import {
  TOOL_TRUST_CODEX_NOTICE,
  toolTrustReview,
  toolTrustStateLabel,
} from "@t3tools/client-runtime/peer-tool-trust";
import { useState } from "react";
import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import type { PeerSlotProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";
import { ToolTrustReview } from "./ToolTrustReview";
import { useToolTrustControls } from "./useToolTrustControls";
export function ToolTrustSettings({ environmentId, status }: PeerSlotProps) {
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controls = useToolTrustControls(environmentId);
  return (
    <>
      {toolTrustReview(status).map((group) => (
        <SettingsRow
          key={group.workspace}
          title={`Tools on this computer · ${group.name}`}
          description={TOOL_TRUST_CODEX_NOTICE}
          control={
            <Button variant="outline" size="sm" onClick={() => setWorkspace(group.workspace)}>
              Review tools and secrets
            </Button>
          }
        >
          {group.tools.map((row) => (
            <div key={row.key} className="flex flex-wrap items-center justify-between gap-2 pb-2">
              <p className="text-sm">
                {row.name}
                <span className="text-muted-foreground"> · {toolTrustStateLabel[row.state]}</span>
              </p>
              <div className="flex gap-2">
                {row.state === "off" ? (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!controls.approve}
                    onClick={() => setWorkspace(group.workspace)}
                  >
                    Turn on
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy || !controls.turnOff}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      void controls
                        .turnOffTools({
                          environmentId,
                          input: { items: [{ workspace: row.workspace, tool: row.tool }] },
                        })
                        .then((result) => setError(failureMessage(result)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Turn off
                  </Button>
                )}
              </div>
            </div>
          ))}
        </SettingsRow>
      ))}
      {error === null ? null : (
        <SettingsRow title="Could not turn the tool off" description={error} />
      )}
      <ToolTrustReview
        environmentId={environmentId}
        status={status}
        {...(workspace === null ? {} : { workspace })}
        open={workspace !== null}
        onOpenChange={(open) => {
          if (!open) setWorkspace(null);
        }}
      />
    </>
  );
}
