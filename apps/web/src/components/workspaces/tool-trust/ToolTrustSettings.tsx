import {
  TOOL_TRUST_CODEX_NOTICE,
  toolTrustReview,
  toolTrustStateLabel,
} from "@t3tools/client-runtime/peer-tool-trust";
import { useState } from "react";
import { SettingsRow, SettingsSection } from "../../settings/settingsLayout";
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
      <SettingsSection title="Tools on this computer">
        {toolTrustReview(status).map((group) => (
          <SettingsRow
            key={group.workspace}
            title={group.name}
            description={TOOL_TRUST_CODEX_NOTICE}
            control={
              <Button variant="outline" size="sm" onClick={() => setWorkspace(group.workspace)}>
                Review tools and secrets
              </Button>
            }
          >
            {group.tools.map((row) => (
              <div key={row.key} className="flex flex-wrap items-center justify-between gap-2 py-1">
                <p className="text-sm">
                  {row.name} · {toolTrustStateLabel[row.state]}
                </p>
                <div className="flex gap-2">
                  {row.state === "off" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!controls.approve}
                      onClick={() => setWorkspace(group.workspace)}
                    >
                      Turn on
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
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
        {error === null ? null : <p role="alert">{error}</p>}
      </SettingsSection>
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
